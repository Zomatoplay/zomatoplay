"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BadgeCheck, Loader2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { AdminSection } from "@/components/admin/layout/admin-shell";
import {
  DetailCard,
  DetailList,
  DetailRow,
  MonoValue,
} from "@/components/admin/shared/detail-list";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  lookupCustomerForCreditAction,
  manualCreditAction,
} from "@/app/admin/actions";
import { canManage } from "@/lib/admin-permissions";
import { useAdminStore } from "@/lib/admin-store";
import { formatUsdt } from "@/lib/currency";
import { formatDateTimeUtc } from "@/utils/format";
import type { ManualCreditCustomer, ManualCreditRecord } from "@/types/admin";

/**
 * Manual USDT credit: customer id + amount (+ note) → review the customer →
 * confirm → the reference of what was written.
 *
 * WHY A REVIEW STEP, NOT A CONFIRM BOX
 * ------------------------------------
 * The most likely mistake is the wrong customer id, and a dialog repeating the
 * id the operator typed cannot catch it. The review shows who that id belongs
 * to — name, member id, masked number, status — as the server resolved it.
 *
 * ONE KEY PER CONFIRMATION
 * ------------------------
 * The idempotency key is generated when the review opens and sent with the
 * confirmation; a double-click or a retry after a dropped response carries the
 * same key, and the server credits it once (`creditWalletManually`). Editing
 * the form discards the key, so a genuinely new credit gets a new one.
 *
 * Everything here is a courtesy: the permission, the customer, the amount and
 * the key are all checked again on the server.
 */

type Stage =
  | { kind: "form" }
  | { kind: "review"; customer: ManualCreditCustomer; idempotencyKey: string }
  | { kind: "done"; message: string; creditId?: string; ledgerTxId?: string; duplicate: boolean };

export function ManualCreditView({ recent }: { recent: ManualCreditRecord[] | null }) {
  const { session } = useAdminStore();
  const router = useRouter();
  const allowed = canManage(session, "wallet_credits");
  const [customerId, setCustomerId] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [stage, setStage] = useState<Stage>({ kind: "form" });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const amountShape = /^\d{1,7}(\.\d{1,6})?$/.test(amount.trim().replace(/,/g, ""));
  const amountPositive = amountShape && Number(amount.replace(/,/g, "")) > 0;
  const canReview = allowed && customerId.trim().length >= 4 && amountPositive && !pending;

  function review() {
    if (!canReview) return;
    setError(null);
    startTransition(async () => {
      const result = await lookupCustomerForCreditAction({ customerId: customerId.trim() });
      if (!result.ok || !result.customer) {
        setError(result.message);
        return;
      }
      setStage({ kind: "review", customer: result.customer, idempotencyKey: newIdempotencyKey() });
    });
  }

  function confirm() {
    if (stage.kind !== "review" || pending) return;
    const { customer, idempotencyKey } = stage;
    setError(null);
    startTransition(async () => {
      let result;
      try {
        result = await manualCreditAction({
          userId: customer.userId,
          amount: amount.trim().replace(/,/g, ""),
          note: note.trim() || undefined,
          idempotencyKey,
        });
      } catch {
        // The request may or may not have reached the server. Keep the same
        // key, so pressing Confirm again cannot credit twice.
        setError("The request did not complete. Press Confirm again — it will not be applied twice.");
        return;
      }
      if (!result.ok) {
        setError(result.message);
        return;
      }
      toast.success(result.message);
      setStage({
        kind: "done",
        message: result.message,
        creditId: result.creditId,
        ledgerTxId: result.ledgerTxId,
        duplicate: Boolean(result.duplicate),
      });
      router.refresh();
    });
  }

  function startOver() {
    setCustomerId("");
    setAmount("");
    setNote("");
    setError(null);
    setStage({ kind: "form" });
  }

  return (
    <AdminSection className="space-y-4">
      {!allowed ? (
        <p className="rounded-xl border border-border bg-secondary/60 p-3.5 text-sm leading-relaxed text-muted-foreground">
          You can view manual credits but not make one. Crediting requires the
          <span className="font-medium text-foreground"> Manual wallet credits </span>
          permission at manage level, granted by a master admin.
        </p>
      ) : null}

      {stage.kind === "form" ? (
        <DetailCard
          title="Credit USDT to a wallet"
          description="The amount is added to the customer's available balance as a ledger entry, and the credit is recorded in the audit log under your name."
        >
          <form
            className="grid gap-4 sm:max-w-lg"
            onSubmit={(event) => {
              event.preventDefault();
              review();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="credit-customer">Customer ID</Label>
              <Input
                id="credit-customer"
                autoComplete="off"
                spellCheck={false}
                placeholder="NT-1234567 or usr_…"
                value={customerId}
                onChange={(event) => setCustomerId(event.target.value)}
                disabled={!allowed || pending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="credit-amount">Amount (USDT)</Label>
              <Input
                id="credit-amount"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0.00"
                className="tabular"
                value={amount}
                onChange={(event) => setAmount(event.target.value.replace(/[^0-9.,]/g, ""))}
                aria-invalid={amount !== "" && !amountPositive ? true : undefined}
                disabled={!allowed || pending}
              />
              <p className="text-xs text-muted-foreground">
                USDT only, up to six decimal places. Credits only — this cannot debit a wallet.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="credit-note">Internal note (optional)</Label>
              <Textarea
                id="credit-note"
                rows={3}
                maxLength={500}
                placeholder="Why this credit is being made — never shown to the customer."
                value={note}
                onChange={(event) => setNote(event.target.value)}
                disabled={!allowed || pending}
              />
            </div>
            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
            <div>
              <Button type="submit" variant="brand" disabled={!canReview}>
                {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                {pending ? "Looking up…" : "Review credit"}
              </Button>
            </div>
          </form>
        </DetailCard>
      ) : null}

      {stage.kind === "review" ? (
        <DetailCard
          title="Confirm this credit"
          description="Check the customer below is the one you mean. This adds money to their wallet and cannot be undone from this screen."
        >
          <div className="space-y-4">
            <p className="tabular text-3xl font-semibold tracking-tight">
              {formatUsdt(Number(amount.replace(/,/g, "")))}
            </p>
            <DetailList>
              <DetailRow label="Customer">{stage.customer.fullName || "—"}</DetailRow>
              <DetailRow label="Member ID">
                <MonoValue>{stage.customer.displayId}</MonoValue>
              </DetailRow>
              <DetailRow label="Mobile">{stage.customer.phone ?? "Not linked"}</DetailRow>
              <DetailRow label="Account status">{stage.customer.status}</DetailRow>
              <DetailRow label="KYC">{stage.customer.kycStatus.replace(/_/g, " ")}</DetailRow>
              <DetailRow label="Available now">{formatUsdt(stage.customer.availableUsdt)}</DetailRow>
              <DetailRow label="Note" wide>
                {note.trim() || "—"}
              </DetailRow>
            </DetailList>
            {stage.customer.status !== "active" ? (
              <p className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/8 p-3 text-sm text-foreground">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                This account is {stage.customer.status}. Make sure crediting it is intended.
              </p>
            ) : null}
            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button variant="brand" onClick={confirm} disabled={pending}>
                {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                {pending ? "Crediting…" : `Confirm credit to ${stage.customer.displayId}`}
              </Button>
              <Button
                variant="ghost"
                disabled={pending}
                onClick={() => {
                  setError(null);
                  setStage({ kind: "form" });
                }}
              >
                Edit
              </Button>
            </div>
          </div>
        </DetailCard>
      ) : null}

      {stage.kind === "done" ? (
        <DetailCard title={stage.duplicate ? "Already applied" : "Credit applied"}>
          <div className="space-y-4">
            <p className="flex items-start gap-2 text-sm text-foreground">
              <BadgeCheck className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
              {stage.message}
            </p>
            <DetailList>
              <DetailRow label="Credit reference">
                <MonoValue>{stage.creditId ?? "—"}</MonoValue>
              </DetailRow>
              <DetailRow label="Ledger entry">
                <MonoValue>{stage.ledgerTxId ?? "—"}</MonoValue>
              </DetailRow>
            </DetailList>
            <Button variant="outline" onClick={startOver}>
              New credit
            </Button>
          </div>
        </DetailCard>
      ) : null}

      <DetailCard
        title="Recent manual credits"
        description="Newest first. Each row is also in the audit log."
      >
        {recent === null ? (
          <p className="text-sm text-muted-foreground">
            You do not have access to the credit history.
          </p>
        ) : recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">No manual credits yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {recent.map((credit) => (
              <li key={credit.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 py-3">
                <div className="min-w-0 space-y-0.5">
                  <p className="text-sm font-medium text-foreground">
                    <Link href={`/admin/users/${credit.userId}`} className="hover:underline">
                      {credit.customerName || credit.displayId}
                    </Link>{" "}
                    <span className="font-mono text-xs text-muted-foreground">{credit.displayId}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDateTimeUtc(credit.createdAt)} · by {credit.createdByName} ·{" "}
                    <span className="font-mono">{credit.id}</span>
                  </p>
                  {credit.note ? (
                    <p className="break-words text-xs text-muted-foreground">{credit.note}</p>
                  ) : null}
                </div>
                <p className="tabular text-sm font-semibold text-foreground">
                  + {formatUsdt(credit.amountUsdt)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </DetailCard>
    </AdminSection>
  );
}

/** A v4 UUID, from the CSPRNG, without needing a secure context. */
function newIdempotencyKey(): string {
  // `randomUUID` needs a secure context; `getRandomValues` does not.
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte: number) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
