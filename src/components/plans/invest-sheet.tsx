"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDownToLine, CheckCircle2, Loader2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import { InfoRow } from "@/components/shared/info-row";
import { RiskNote } from "@/components/shared/notices";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { rewardFrequencyLabels } from "@/data/plans";
import { formatUsdt } from "@/lib/currency";
import { usePrototypeStore } from "@/lib/prototype-store";
import { createInvestmentAction } from "@/app/(app)/plans/actions";
import { cn } from "@/lib/utils";
import { formatDate } from "@/utils/format";
import type { Plan } from "@/types";

type Stage = "amount" | "confirm" | "done";

const QUICK_FRACTIONS = [0.25, 0.5, 1] as const;

/**
 * Investment flow: amount → confirmation → receipt.
 *
 * The validation here — plan limits, available balance, verification — is an
 * affordance, so the person is told before they commit rather than after. Every
 * one of those rules is checked again inside `createInvestment`, against the
 * plan row and the balance as Postgres holds them, because this component runs
 * in a browser and the browser does not get to decide what an account can
 * afford.
 *
 * The allocation, the ledger entry, the balance change and the plan's aggregate
 * all land in one transaction, or none of them do.
 */
export function InvestSheet({
  plan,
  className,
}: {
  plan: Plan;
  className?: string;
}) {
  const { balance, isVerified } = usePrototypeStore();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<Stage>("amount");
  const [rawAmount, setRawAmount] = useState("");
  const [confirmedAmount, setConfirmedAmount] = useState(0);
  const [confirmedRate, setConfirmedRate] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();

  /*
   * The terms an operator configured for this plan (7/15/30/60/90 days). When
   * there are any, the customer must choose one and its rate is the rate —
   * the amount-band ladder does not apply. The rate shown is display only:
   * the action sends the plan, the amount and the term, and the server reads
   * the rate from `plan_duration_rates` itself.
   */
  const durations = plan.durationRates.filter((row) => row.active);
  const choosesDuration = durations.length > 0;
  const [durationDays, setDurationDays] = useState<number | null>(
    durations.length === 1 ? durations[0].durationDays : null,
  );
  const chosenDuration = durations.find((row) => row.durationDays === durationDays) ?? null;
  const termDays = choosesDuration ? (chosenDuration?.durationDays ?? null) : plan.durationDays;

  const amount = Number.parseFloat(rawAmount);
  const maxAllowed = Math.min(plan.maxInvestment, balance.available);

  /*
   * Which band the typed amount falls into, for display only.
   *
   * The rule is the same half-open `[min, max)` one the server applies, so the
   * figure shown and the figure charged agree — but this is an affordance and
   * not an authority. `createInvestment` reads the ladder from `plan_rate_tiers`
   * inside its own transaction and resolves the band again; the browser sends
   * a plan id and an amount and has no field in which to name a rate. A person
   * editing this component's state, or posting the action by hand, changes
   * what they are *shown* and nothing about what they are charged.
   */
  const tier = useMemo(() => {
    if (!Number.isFinite(amount) || amount <= 0) return null;
    return (
      plan.rateTiers.find(
        (candidate) =>
          candidate.active &&
          amount >= candidate.minAmountUsdt &&
          (candidate.maxAmountUsdt === null || amount < candidate.maxAmountUsdt),
      ) ?? null
    );
  }, [amount, plan.rateTiers]);

  // A chosen duration prices the allocation; otherwise the ladder or the
  // plan's own rate, exactly as the server resolves it.
  const hasLadder = !choosesDuration && plan.rateTiers.some((candidate) => candidate.active);
  const applicableRate = choosesDuration
    ? (chosenDuration?.ratePercent ?? null)
    : tier
      ? tier.ratePercent
      : hasLadder
        ? null
        : plan.estimatedReturnPercent;

  /**
   * Not enough funds, specifically — kept apart from the other errors because
   * it is the only one with an action attached. A person 5 USDT short needs a
   * way to deposit, not a red sentence.
   */
  const shortfall =
    Number.isFinite(amount) && amount > 0 && amount > balance.available
      ? amount - balance.available
      : null;

  const error = useMemo(() => {
    if (rawAmount.trim() === "") return null;
    if (!Number.isFinite(amount) || amount <= 0) return "Enter a valid amount.";
    if (amount < plan.minInvestment)
      return `Minimum allocation is ${formatUsdt(plan.minInvestment)}.`;
    if (amount > plan.maxInvestment)
      return `Maximum allocation is ${formatUsdt(plan.maxInvestment)}.`;
    if (amount > balance.available) return "Insufficient USDT balance.";
    // A ladder that cannot price the amount is a refusal the server will make
    // too; saying so here means nobody reaches the confirm step to find out.
    if (hasLadder && !tier)
      return `No rate tier covers ${formatUsdt(amount)} for this plan.`;
    return null;
  }, [
    rawAmount,
    amount,
    plan.minInvestment,
    plan.maxInvestment,
    balance.available,
    hasLadder,
    tier,
  ]);

  const valid =
    rawAmount.trim() !== "" && error === null && (!choosesDuration || chosenDuration !== null);
  const projectedProfit =
    valid && applicableRate !== null ? (amount * applicableRate) / 100 : 0;

  const maturity = useMemo(() => {
    if (!termDays) return null;
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + termDays);
    return date.toISOString();
  }, [termDays]);

  const termLabel =
    termDays === null ? "Choose a duration" : termDays === 0 ? "No lock-in" : `${termDays} days`;
  const rewardsLabel = choosesDuration
    ? "Weekly, final part-week at maturity"
    : rewardFrequencyLabels[plan.rewardFrequency];

  function reset() {
    setStage("amount");
    setRawAmount("");
    setConfirmedAmount(0);
    setConfirmedRate(null);
    setDurationDays(durations.length === 1 ? durations[0].durationDays : null);
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      // Let the close animation finish before resetting the contents.
      setTimeout(reset, 200);
    }
  }

  function handleConfirm() {
    if (pending) return;
    const requested = amount;
    startTransition(async () => {
      const result = await createInvestmentAction({
        planId: plan.id,
        amount: rawAmount.trim(),
        durationDays: chosenDuration?.durationDays,
      });

      if (!result.ok) {
        toast.error(result.message);
        return;
      }

      // The receipt reads from what was sent and from what the *server*
      // resolved, not from the store: the store is a snapshot from before this
      // write, and the rate shown here should be the one actually applied
      // rather than the one this component computed for display.
      setConfirmedAmount(requested);
      setConfirmedRate(result.appliedRatePercent ?? null);
      setStage("done");
      toast.success("Investment created", {
        description: `${formatUsdt(requested)} allocated to ${plan.name}.`,
      });
      router.refresh();
    });
  }

  const closed = plan.status === "closed";

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger asChild>
        <Button
          variant="brand"
          size="lg"
          block
          disabled={closed}
          className={cn(className)}
        >
          {closed ? "Closed to new allocations" : `Invest in ${plan.name}`}
        </Button>
      </SheetTrigger>

      <SheetContent>
        {!isVerified ? (
          <>
            <SheetHeader>
              <SheetTitle>Verification required</SheetTitle>
              <SheetDescription>
                You need a verified account before you can create an investment.
              </SheetDescription>
            </SheetHeader>
            <SheetBody>
              <div className="flex items-start gap-3 rounded-xl bg-secondary/60 p-4">
                <ShieldAlert
                  className="mt-0.5 size-5 shrink-0 text-warning"
                  aria-hidden
                />
                <p className="text-sm leading-relaxed text-muted-foreground">
                  Identity verification protects your account and is required by
                  the regulations we operate under. It usually takes under three
                  minutes to submit.
                </p>
              </div>
            </SheetBody>
            <SheetFooter>
              <Button asChild variant="brand" size="lg" block>
                <Link href="/settings/kyc">Complete KYC</Link>
              </Button>
              <Button variant="ghost" size="lg" block onClick={() => setOpen(false)}>
                Not now
              </Button>
            </SheetFooter>
          </>
        ) : stage === "amount" ? (
          <>
            <SheetHeader>
              <SheetTitle>Invest in {plan.name}</SheetTitle>
              <SheetDescription>
                Allocate from your available balance of{" "}
                {formatUsdt(balance.available)}.
              </SheetDescription>
            </SheetHeader>

            <SheetBody className="space-y-4">
              {choosesDuration ? (
                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium">Duration</legend>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                    {durations.map((row) => {
                      const selected = row.durationDays === durationDays;
                      return (
                        <button
                          key={row.id}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => setDurationDays(row.durationDays)}
                          className={cn(
                            "flex min-h-14 flex-col items-center justify-center rounded-xl border px-2 py-2 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            selected
                              ? "border-brand bg-brand-soft text-foreground"
                              : "border-border hover:bg-secondary/60",
                          )}
                        >
                          <span className="text-sm font-semibold">{row.durationDays} days</span>
                          <span className="tabular text-xs text-muted-foreground">
                            {row.ratePercent}%
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              ) : null}

              <div className="space-y-2">
                <Label htmlFor="invest-amount">Amount (USDT)</Label>
                <Input
                  id="invest-amount"
                  // `decimal` keeps the numeric keypad up on mobile while
                  // still allowing a decimal separator.
                  inputMode="decimal"
                  type="text"
                  autoComplete="off"
                  placeholder={`Min ${plan.minInvestment}`}
                  value={rawAmount}
                  onChange={(event) =>
                    setRawAmount(event.target.value.replace(/[^0-9.]/g, ""))
                  }
                  aria-invalid={Boolean(error)}
                  aria-describedby="invest-amount-help"
                />
                <p
                  id="invest-amount-help"
                  className={cn(
                    "text-xs leading-relaxed",
                    error ? "text-destructive" : "text-muted-foreground",
                  )}
                >
                  {error ??
                    `Between ${formatUsdt(plan.minInvestment)} and ${formatUsdt(plan.maxInvestment)}.`}
                </p>
              </div>

              {/*
                The insufficient-balance state, with the one action that
                resolves it.

                Nothing is debited, no allocation is created and no commission
                accrues — the confirm button is disabled and the server refuses
                the same case independently (`readBalance` inside
                `createInvestment`'s transaction, compared as exact decimals).
                This only makes the shortfall legible and offers the deposit
                screen instead of leaving somebody to find it.
              */}
              {shortfall !== null ? (
                <div className="space-y-3 rounded-xl border border-warning/40 bg-warning/8 p-4">
                  <p className="text-sm font-medium">Insufficient USDT balance</p>
                  <dl className="space-y-1 text-xs">
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">Available</dt>
                      <dd className="tabular font-medium">
                        {formatUsdt(balance.available)}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">Required</dt>
                      <dd className="tabular font-medium">{formatUsdt(amount)}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">Short by</dt>
                      <dd className="tabular font-medium text-destructive">
                        {formatUsdt(shortfall)}
                      </dd>
                    </div>
                  </dl>
                  <Button asChild variant="outline" size="sm" block>
                    <Link href="/wallet/deposit">
                      <ArrowDownToLine className="size-4" aria-hidden />
                      Deposit USDT
                    </Link>
                  </Button>
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2">
                {QUICK_FRACTIONS.map((fraction) => {
                  const value = Math.floor(maxAllowed * fraction * 100) / 100;
                  return (
                    <Button
                      key={fraction}
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={value < plan.minInvestment}
                      onClick={() => setRawAmount(String(value))}
                    >
                      {fraction === 1 ? "Max" : `${fraction * 100}%`}
                    </Button>
                  );
                })}
              </div>

              <div className="divide-y divide-border rounded-xl border border-border px-4">
                {hasLadder ? (
                  <InfoRow
                    label="Applicable tier"
                    value={tier ? describeTier(tier) : "—"}
                    hint={
                      tier
                        ? undefined
                        : "Enter an amount inside one of the plan's tiers."
                    }
                  />
                ) : null}
                <InfoRow
                  label={hasLadder ? "Return for this amount" : "Estimated total return"}
                  value={applicableRate !== null ? `${applicableRate}%` : "—"}
                  hint={termDays ? `Over ${termDays} days` : undefined}
                />
                <InfoRow
                  label="Estimated profit"
                  value={formatUsdt(projectedProfit)}
                />
                <InfoRow
                  label="Term"
                  value={termLabel}
                  hint={maturity ? `Matures ${formatDate(maturity)}` : undefined}
                />
                <InfoRow label="Rewards" value={rewardsLabel} />
              </div>

              <RiskNote />
            </SheetBody>

            <SheetFooter>
              <Button
                variant="brand"
                size="lg"
                block
                disabled={!valid}
                onClick={() => setStage("confirm")}
              >
                Review investment
              </Button>
            </SheetFooter>
          </>
        ) : stage === "confirm" ? (
          <>
            <SheetHeader>
              <SheetTitle>Confirm your investment</SheetTitle>
              <SheetDescription>
                Check the details before allocating.
              </SheetDescription>
            </SheetHeader>

            <SheetBody className="space-y-4">
              <div className="rounded-xl bg-secondary/60 p-4 text-center">
                <p className="text-xs font-medium text-muted-foreground">
                  You are investing
                </p>
                <p className="tabular mt-1 text-3xl font-semibold tracking-tight">
                  {formatUsdt(amount)}
                </p>
              </div>

              <div className="divide-y divide-border rounded-xl border border-border px-4">
                <InfoRow label="Plan" value={plan.name} />
                {tier ? <InfoRow label="Applicable tier" value={describeTier(tier)} /> : null}
                <InfoRow
                  label="Estimated total return"
                  value={applicableRate !== null ? `${applicableRate}%` : "—"}
                />
                <InfoRow label="Term" value={termLabel} />
                <InfoRow label="Rewards" value={rewardsLabel} />
                <InfoRow
                  label="Estimated profit"
                  value={formatUsdt(projectedProfit)}
                />
                <InfoRow
                  label="Balance after"
                  value={formatUsdt(balance.available - amount)}
                />
                <InfoRow label="Early exit" value={plan.earlyExit} />
              </div>

              <RiskNote>
                By continuing you confirm you have read the plan conditions and
                understand that projected returns are estimates, not guarantees,
                and that your capital is at risk.
              </RiskNote>
            </SheetBody>

            <SheetFooter>
              <Button
                variant="brand"
                size="lg"
                block
                onClick={handleConfirm}
                disabled={pending}
              >
                {pending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : null}
                {pending ? "Creating…" : "Confirm investment"}
              </Button>
              <Button
                variant="ghost"
                size="lg"
                block
                disabled={pending}
                onClick={() => setStage("amount")}
              >
                Back
              </Button>
            </SheetFooter>
          </>
        ) : (
          <>
            <SheetHeader>
              <SheetTitle className="sr-only">Investment created</SheetTitle>
              <SheetDescription className="sr-only">
                Your allocation is now active.
              </SheetDescription>
            </SheetHeader>

            <SheetBody className="space-y-4 py-6 text-center">
              <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-brand-soft text-brand">
                <CheckCircle2 className="size-7" aria-hidden />
              </span>
              <div className="space-y-1">
                <p className="text-lg font-semibold">Investment created</p>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {formatUsdt(confirmedAmount)} has been allocated to {plan.name}.
                  You can track it from Home or your investment history.
                </p>
              </div>
              <div className="divide-y divide-border rounded-xl border border-border px-4 text-left">
                <InfoRow label="Plan" value={plan.name} />
                <InfoRow
                  label="Amount"
                  value={formatUsdt(confirmedAmount)}
                />
                {confirmedRate !== null ? (
                  <InfoRow
                    label="Return applied"
                    value={`${confirmedRate}%`}
                    hint={termDays ? `Total over ${termDays} days` : undefined}
                  />
                ) : null}
                {maturity ? (
                  <InfoRow label="Matures" value={formatDate(maturity)} />
                ) : null}
              </div>
            </SheetBody>

            <SheetFooter>
              <Button variant="brand" size="lg" block onClick={() => setOpen(false)}>
                Done
              </Button>
              <Button asChild variant="ghost" size="lg" block>
                <Link href="/settings/investments">View my investments</Link>
              </Button>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** `50–100 USDT` / `100+ USDT`. The band, as a person reads it. */
function describeTier(tier: Plan["rateTiers"][number]): string {
  return tier.maxAmountUsdt === null
    ? `${formatUsdt(tier.minAmountUsdt, { withSymbol: false })}+ USDT`
    : `${formatUsdt(tier.minAmountUsdt, { withSymbol: false })}–${formatUsdt(
        tier.maxAmountUsdt,
        { withSymbol: false },
      )} USDT`;
}
