"use client";

import { useState } from "react";
import { RotateCcw, Save } from "lucide-react";

import { AdminHeader } from "@/components/admin/layout/admin-header";
import { AdminPage, AdminSection } from "@/components/admin/layout/admin-shell";
import { DetailCard } from "@/components/admin/shared/detail-list";
import { PermissionGate } from "@/components/admin/shared/permission-gate";
import { PrototypeNote, RateNote } from "@/components/shared/notices";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { vipLevels } from "@/data/referrals";
import { canManage } from "@/lib/admin-permissions";
import { useAdminStore } from "@/lib/admin-store";
import { useAdminAction } from "@/components/admin/shared/use-admin-action";
import { updateSettingsAction } from "@/app/admin/actions";
import { formatInr, formatUsdt } from "@/lib/currency";
import { cn } from "@/lib/utils";
import type { PlatformSettings } from "@/types/admin";

/**
 * Platform configuration.
 *
 * Edits are held locally until saved, so a half-finished change never leaks
 * into the rest of the CRM. Saving writes the whole settings object plus one
 * audit entry summarising what changed.
 *
 * INTEGRATION POINT: these controls become the write side of a configuration
 * service. Note that changing the display rate here does not move the *user*
 * application in this prototype — that app reads `@/constants/app` directly,
 * and only a real config service can join the two.
 */

export function SettingsView() {
  return (
    <>
      <AdminHeader
        title="Settings"
        description="Platform, currency, fee, investment, referral and security configuration."
      />
      <AdminPage>
        <PermissionGate permission="settings">
          <SettingsForm />
        </PermissionGate>
      </AdminPage>
    </>
  );
}

/** Summarises which top-level groups changed, for the audit entry. */
function summarise(before: PlatformSettings, after: PlatformSettings): string {
  const changed = (Object.keys(before) as (keyof PlatformSettings)[]).filter(
    (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]),
  );
  if (changed.length === 0) return "Settings saved with no changes.";
  return `Updated ${changed.join(", ")} configuration.`;
}

export function SettingsForm() {
  const store = useAdminStore();
  const { run } = useAdminAction();
  const allowed = canManage(store.session, "settings");
  const [draft, setDraft] = useState<PlatformSettings>(store.settings);

  const dirty = JSON.stringify(draft) !== JSON.stringify(store.settings);

  function update<K extends keyof PlatformSettings>(
    group: K,
    changes: Partial<PlatformSettings[K]>,
  ) {
    setDraft((current) => ({
      ...current,
      [group]: { ...current[group], ...changes },
    }));
  }

  return (
    <AdminSection className="space-y-4">
      <PrototypeNote>
        Prototype controls. Saving updates the CRM&rsquo;s in-memory state and
        writes an audit entry; the running user application still reads its
        configuration from <code className="font-mono">@/constants/app</code>{" "}
        until a real configuration service joins the two.
      </PrototypeNote>

      <div className="grid gap-3 xl:grid-cols-2">
        {/* --------------------------------------------------- Platform */}
        <DetailCard title="Platform" description="Identity and availability.">
          <div className="space-y-4">
            <TextField
              id="platform-name"
              label="Platform name"
              value={draft.platform.name}
              disabled={!allowed}
              onChange={(value) => update("platform", { name: value })}
            />
            <TextField
              id="platform-tagline"
              label="Tagline"
              value={draft.platform.tagline}
              disabled={!allowed}
              onChange={(value) => update("platform", { tagline: value })}
            />
            <ToggleField
              id="platform-registrations"
              label="Registrations open"
              hint="Turn off to stop new accounts being created."
              checked={draft.platform.registrationsOpen}
              disabled={!allowed}
              onChange={(value) =>
                update("platform", { registrationsOpen: value })
              }
            />
            <ToggleField
              id="platform-maintenance"
              label="Maintenance mode"
              hint="Puts the user application into a read-only state."
              checked={draft.platform.maintenanceMode}
              disabled={!allowed}
              onChange={(value) =>
                update("platform", { maintenanceMode: value })
              }
            />
          </div>
        </DetailCard>

        {/* ---------------------------------------------------- Support */}
        <DetailCard title="Support" description="What users see in Help.">
          <div className="space-y-4">
            <TextField
              id="support-email"
              label="Support email"
              type="email"
              value={draft.platform.supportEmail}
              disabled={!allowed}
              onChange={(value) => update("platform", { supportEmail: value })}
            />
            <TextField
              id="support-hours"
              label="Support hours"
              value={draft.platform.supportHours}
              disabled={!allowed}
              onChange={(value) => update("platform", { supportHours: value })}
            />
          </div>
        </DetailCard>

        {/* --------------------------------------------------- Currency */}
        <DetailCard
          title="Currency"
          description="USDT is the settlement currency; INR figures are derived from these rates."
        >
          <div className="space-y-4">
            <NumberField
              id="currency-display"
              label="Display rate (1 USDT in ₹)"
              hint="Used for the approximate INR figures shown alongside USDT."
              value={draft.currency.displayRate}
              step={0.01}
              disabled={!allowed}
              onChange={(value) => update("currency", { displayRate: value })}
            />
            <NumberField
              id="currency-payout"
              label="Payout rate (1 USDT in ₹)"
              hint="Quoted when an INR withdrawal is priced. Deliberately distinct from the display rate."
              value={draft.currency.payoutRate}
              step={0.01}
              disabled={!allowed}
              onChange={(value) => update("currency", { payoutRate: value })}
            />
            <TextField
              id="currency-label"
              label="Rate label"
              hint="Shown next to every conversion so it never reads as a live market quote."
              value={draft.currency.rateLabel}
              disabled={!allowed}
              onChange={(value) => update("currency", { rateLabel: value })}
            />
            <RateNote />
          </div>
        </DetailCard>

        {/* ------------------------------------------------ Withdrawals */}
        <DetailCard
          title="Withdrawals"
          description="Limits, fees and review thresholds for INR payouts."
        >
          <div className="space-y-4">
            <NumberField
              id="withdraw-min"
              label="Minimum withdrawal (USDT)"
              value={draft.withdrawals.minimumUsdt}
              disabled={!allowed}
              onChange={(value) => update("withdrawals", { minimumUsdt: value })}
            />
            <NumberField
              id="withdraw-flat"
              label="Flat fee (USDT)"
              value={draft.withdrawals.flatFeeUsdt}
              step={0.1}
              disabled={!allowed}
              onChange={(value) => update("withdrawals", { flatFeeUsdt: value })}
            />
            <NumberField
              id="withdraw-percent"
              label="Percentage fee (%)"
              value={draft.withdrawals.percentFee}
              step={0.1}
              disabled={!allowed}
              onChange={(value) => update("withdrawals", { percentFee: value })}
            />
            <NumberField
              id="withdraw-threshold"
              label="Manual review threshold (USDT)"
              hint="Requests at or above this always need a reviewer."
              value={draft.withdrawals.manualReviewThresholdUsdt}
              disabled={!allowed}
              onChange={(value) =>
                update("withdrawals", { manualReviewThresholdUsdt: value })
              }
            />
            <TextField
              id="withdraw-window"
              label="Processing window"
              value={draft.withdrawals.processingWindow}
              disabled={!allowed}
              onChange={(value) =>
                update("withdrawals", { processingWindow: value })
              }
            />
            <ToggleField
              id="withdraw-kyc"
              label="Require KYC to withdraw"
              checked={draft.withdrawals.requireKyc}
              disabled={!allowed}
              onChange={(value) => update("withdrawals", { requireKyc: value })}
            />

            <FeePreview settings={draft} />
          </div>
        </DetailCard>

        {/* --------------------------------------------------- Deposits */}
        <DetailCard title="Deposits" description="Incoming USDT transfers.">
          <div className="space-y-4">
            <NumberField
              id="deposit-min"
              label="Minimum deposit (USDT)"
              value={draft.deposits.minimumUsdt}
              disabled={!allowed}
              onChange={(value) => update("deposits", { minimumUsdt: value })}
            />
            <ToggleField
              id="deposit-auto"
              label="Auto-credit confirmed deposits"
              hint="When off, every deposit waits for an operator to credit it."
              checked={draft.deposits.autoCreditEnabled}
              disabled={!allowed}
              onChange={(value) =>
                update("deposits", { autoCreditEnabled: value })
              }
            />
          </div>
        </DetailCard>

        {/* ------------------------------------------------ Investments */}
        <DetailCard title="Investments" description="Allocation rules.">
          <div className="space-y-4">
            <ToggleField
              id="invest-kyc"
              label="Require KYC to invest"
              checked={draft.investments.requireKyc}
              disabled={!allowed}
              onChange={(value) => update("investments", { requireKyc: value })}
            />
            <NumberField
              id="invest-max"
              label="Maximum active allocations per user"
              value={draft.investments.maxActivePerUser}
              disabled={!allowed}
              onChange={(value) =>
                update("investments", { maxActivePerUser: value })
              }
            />
            <ToggleField
              id="invest-exit"
              label="Allow early exit"
              hint="Per-plan terms still apply; this is the platform-wide switch."
              checked={draft.investments.allowEarlyExit}
              disabled={!allowed}
              onChange={(value) =>
                update("investments", { allowEarlyExit: value })
              }
            />
          </div>
        </DetailCard>

        {/* -------------------------------------------------- Referrals */}
        <DetailCard
          title="Referrals and VIP"
          description="Programme switches. Commission percentages and thresholds are configured as data."
        >
          <div className="space-y-4">
            <ToggleField
              id="referral-enabled"
              label="Referral programme enabled"
              checked={draft.referrals.programmeEnabled}
              disabled={!allowed}
              onChange={(value) =>
                update("referrals", { programmeEnabled: value })
              }
            />
            <NumberField
              id="referral-delay"
              label="Commission payout delay (days)"
              hint="How long commission stays pending after an allocation settles."
              value={draft.referrals.payoutDelayDays}
              disabled={!allowed}
              onChange={(value) =>
                update("referrals", { payoutDelayDays: value })
              }
            />

            <div className="rounded-xl border border-border bg-secondary/40 p-3">
              <p className="text-xs font-medium">Current VIP configuration</p>
              <ul className="mt-2 space-y-1">
                {vipLevels.map((level) => (
                  <li
                    key={level.id}
                    className="flex justify-between gap-3 text-xs"
                  >
                    <span className="text-muted-foreground">{level.name}</span>
                    <span className="tabular">
                      {level.tier1CommissionPercent}% / {level.tier2CommissionPercent}%
                      {" · "}
                      {level.requirements.activeReferrals}+ referrals
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                Defined in <code className="font-mono">@/data/referrals</code> and
                shared with the user application, so a config service can drive
                both from one place.
              </p>
            </div>
          </div>
        </DetailCard>

        {/* --------------------------------------------------- Security */}
        <DetailCard title="Security" description="Rules applied to operators.">
          <div className="space-y-4">
            <ToggleField
              id="security-2fa"
              label="Require 2FA for agents"
              checked={draft.security.requireTwoFactorForAgents}
              disabled={!allowed}
              onChange={(value) =>
                update("security", { requireTwoFactorForAgents: value })
              }
            />
            <NumberField
              id="security-timeout"
              label="Session timeout (minutes)"
              value={draft.security.sessionTimeoutMinutes}
              disabled={!allowed}
              onChange={(value) =>
                update("security", { sessionTimeoutMinutes: value })
              }
            />
            <NumberField
              id="security-attempts"
              label="Failed sign-ins before lockout"
              value={draft.security.maxFailedLogins}
              disabled={!allowed}
              onChange={(value) =>
                update("security", { maxFailedLogins: value })
              }
            />
            <ToggleField
              id="security-allowlist"
              label="Restrict CRM access to an IP allowlist"
              checked={draft.security.ipAllowlistEnabled}
              disabled={!allowed}
              onChange={(value) =>
                update("security", { ipAllowlistEnabled: value })
              }
            />
          </div>
        </DetailCard>
      </div>

      {/* Save bar. Sticks to the bottom so it stays reachable on a long form. */}
      <div className="sticky bottom-0 -mx-3 border-t border-border bg-background/95 px-3 py-3 backdrop-blur-md sm:-mx-5 sm:px-5 lg:-mx-8 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {dirty
              ? "You have unsaved changes."
              : "Everything is saved."}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!dirty}
              onClick={() => setDraft(store.settings)}
            >
              <RotateCcw className="size-4" />
              Discard
            </Button>
            <Button
              variant="brand"
              size="sm"
              disabled={!allowed || !dirty}
              onClick={() => {
                run(() =>
                  updateSettingsAction({
                    settings: draft,
                    summary: summarise(store.settings, draft),
                  }),
                );
              }}
            >
              <Save className="size-4" />
              Save settings
            </Button>
          </div>
        </div>
      </div>
    </AdminSection>
  );
}

/** Shows the effect of the current fee settings on a worked example. */
function FeePreview({ settings }: { settings: PlatformSettings }) {
  const example = 1000;
  const percentFee = (example * settings.withdrawals.percentFee) / 100;
  const totalFee = settings.withdrawals.flatFeeUsdt + percentFee;
  const net = example - totalFee;

  return (
    <div className="rounded-xl border border-border bg-secondary/40 p-3">
      <p className="text-xs font-medium">
        Worked example — a {formatUsdt(example)} withdrawal
      </p>
      <dl className="mt-2 space-y-1 text-xs">
        <Line label="Fees" value={`−${formatUsdt(totalFee)}`} />
        <Line label="Net USDT" value={formatUsdt(net)} />
        <Line
          label="At the payout rate"
          value={formatInr(net * settings.currency.payoutRate, {
            approximate: false,
          })}
          emphasis
        />
      </dl>
    </div>
  );
}

function Line({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("tabular", emphasis && "font-semibold")}>{value}</dd>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Field primitives                                                            */
/* -------------------------------------------------------------------------- */

function TextField({
  id,
  label,
  value,
  onChange,
  hint,
  type = "text",
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  type?: string;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint ? (
        <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

function NumberField({
  id,
  label,
  value,
  onChange,
  hint,
  step = 1,
  disabled,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
  hint?: string;
  step?: number;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        step={step}
        min={0}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      {hint ? (
        <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

function ToggleField({
  id,
  label,
  checked,
  onChange,
  hint,
  disabled,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <Label htmlFor={id} className="font-normal">
          {label}
        </Label>
        {hint ? (
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            {hint}
          </p>
        ) : null}
      </div>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
        className="shrink-0"
      />
    </div>
  );
}
