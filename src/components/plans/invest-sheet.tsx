"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, ShieldAlert } from "lucide-react";
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
import { formatUsdt, formatUsdtAsInr } from "@/lib/currency";
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
  const [pending, startTransition] = useTransition();

  const amount = Number.parseFloat(rawAmount);
  const maxAllowed = Math.min(plan.maxInvestment, balance.available);

  const error = useMemo(() => {
    if (rawAmount.trim() === "") return null;
    if (!Number.isFinite(amount) || amount <= 0) return "Enter a valid amount.";
    if (amount < plan.minInvestment)
      return `Minimum allocation is ${formatUsdt(plan.minInvestment)}.`;
    if (amount > plan.maxInvestment)
      return `Maximum allocation is ${formatUsdt(plan.maxInvestment)}.`;
    if (amount > balance.available)
      return `You only have ${formatUsdt(balance.available)} available.`;
    return null;
  }, [rawAmount, amount, plan.minInvestment, plan.maxInvestment, balance.available]);

  const valid = rawAmount.trim() !== "" && error === null;
  const projectedProfit = valid ? (amount * plan.estimatedReturnPercent) / 100 : 0;

  const maturity = useMemo(() => {
    if (plan.durationDays === 0) return null;
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + plan.durationDays);
    return date.toISOString();
  }, [plan.durationDays]);

  function reset() {
    setStage("amount");
    setRawAmount("");
    setConfirmedAmount(0);
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
      });

      if (!result.ok) {
        toast.error(result.message);
        return;
      }

      // The receipt reads from what was sent, not from the store: the store is
      // a snapshot from before this write and only catches up on the refresh.
      setConfirmedAmount(requested);
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
                    (valid
                      ? formatUsdtAsInr(amount)
                      : `Between ${formatUsdt(plan.minInvestment)} and ${formatUsdt(plan.maxInvestment)}.`)}
                </p>
              </div>

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
                <InfoRow
                  label="Estimated return"
                  value={`${plan.estimatedReturnPercent}%`}
                  hint={`Range ${plan.estimatedReturnRange[0]}%–${plan.estimatedReturnRange[1]}%`}
                />
                <InfoRow
                  label="Projected profit"
                  value={formatUsdt(projectedProfit)}
                  hint={formatUsdtAsInr(projectedProfit)}
                />
                <InfoRow
                  label="Term"
                  value={
                    plan.durationDays === 0
                      ? "No lock-in"
                      : `${plan.durationDays} days`
                  }
                  hint={maturity ? `Matures ${formatDate(maturity)}` : undefined}
                />
                <InfoRow
                  label="Rewards"
                  value={rewardFrequencyLabels[plan.rewardFrequency]}
                />
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
                <p className="tabular text-sm text-muted-foreground">
                  {formatUsdtAsInr(amount)}
                </p>
              </div>

              <div className="divide-y divide-border rounded-xl border border-border px-4">
                <InfoRow label="Plan" value={plan.name} />
                <InfoRow
                  label="Term"
                  value={
                    plan.durationDays === 0
                      ? "No lock-in"
                      : `${plan.durationDays} days`
                  }
                />
                <InfoRow
                  label="Projected profit"
                  value={formatUsdt(projectedProfit)}
                  hint={formatUsdtAsInr(projectedProfit)}
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
                  hint={formatUsdtAsInr(confirmedAmount)}
                />
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
