"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Clock, Landmark, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import { InfoRow } from "@/components/shared/info-row";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  MIN_WITHDRAWAL_USDT,
  WITHDRAWAL_FEE_PERCENT,
  WITHDRAWAL_FEE_USDT,
  WITHDRAWAL_PROCESSING_WINDOW,
} from "@/constants/app";
import { savedBankAccounts } from "@/data/user";
import {
  formatInr,
  formatUsdt,
  formatUsdtAsInr,
  getUsdtInrPayoutRate,
  usdtToInr,
} from "@/lib/currency";
import { usePrototypeStore } from "@/lib/prototype-store";
import { cn } from "@/lib/utils";
import type { WithdrawalQuote } from "@/types";

type Stage = "amount" | "confirm" | "done";

/** Fee model lives in one place so the quote and the receipt cannot disagree. */
function buildQuote(amountUsdt: number, rate: number): WithdrawalQuote {
  const percentFeeUsdt = (amountUsdt * WITHDRAWAL_FEE_PERCENT) / 100;
  const totalFeeUsdt = WITHDRAWAL_FEE_USDT + percentFeeUsdt;
  const netUsdt = Math.max(amountUsdt - totalFeeUsdt, 0);
  return {
    amountUsdt,
    flatFeeUsdt: WITHDRAWAL_FEE_USDT,
    percentFeeUsdt,
    totalFeeUsdt,
    netUsdt,
    rate,
    netInr: netUsdt * rate,
  };
}

/**
 * Withdrawal flow: USDT balance out, INR into a registered bank account.
 *
 * The payout rate is quoted explicitly and differs from the indicative display
 * rate, so the user always sees the exact INR figure they will receive rather
 * than an approximation.
 */
export function WithdrawFlow() {
  const { balance, isVerified, requestWithdrawal } = usePrototypeStore();
  const payoutRate = getUsdtInrPayoutRate();

  const [stage, setStage] = useState<Stage>("amount");
  const [rawAmount, setRawAmount] = useState("");
  const [accountId, setAccountId] = useState(
    savedBankAccounts.find((account) => account.isDefault)?.id ??
      savedBankAccounts[0].id,
  );

  const account = savedBankAccounts.find((item) => item.id === accountId)!;
  const amount = Number.parseFloat(rawAmount);

  const error = useMemo(() => {
    if (rawAmount.trim() === "") return null;
    if (!Number.isFinite(amount) || amount <= 0) return "Enter a valid amount.";
    if (amount < MIN_WITHDRAWAL_USDT)
      return `Minimum withdrawal is ${formatUsdt(MIN_WITHDRAWAL_USDT)}.`;
    if (amount > balance.available)
      return `You only have ${formatUsdt(balance.available)} available.`;
    return null;
  }, [rawAmount, amount, balance.available]);

  const valid = rawAmount.trim() !== "" && error === null;
  const quote = useMemo(
    () => buildQuote(valid ? amount : 0, payoutRate.rate),
    [valid, amount, payoutRate.rate],
  );

  function handleConfirm() {
    requestWithdrawal({
      amountUsdt: quote.amountUsdt,
      feeUsdt: quote.totalFeeUsdt,
      netInr: quote.netInr,
      destination: `${account.bankName} ${account.accountNumberMasked.slice(-4)}`,
    });
    setStage("done");
    toast.success("Withdrawal requested", {
      description: `${formatInr(quote.netInr, { approximate: false, precise: true })} on its way to ${account.bankName}.`,
    });
  }

  /* ---------------------------------------------------------------- */
  /* Verification gate                                                 */
  /* ---------------------------------------------------------------- */
  if (!isVerified) {
    return (
      <Card className="space-y-4 p-6 text-center">
        <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-warning/12 text-warning">
          <ShieldAlert className="size-6" aria-hidden />
        </span>
        <div className="space-y-1.5">
          <h2 className="text-base font-semibold">Verification required</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            You need a verified account before you can withdraw funds. It usually
            takes under three minutes to submit your details.
          </p>
        </div>
        <Button asChild variant="brand" size="lg" block>
          <Link href="/settings/kyc">Complete KYC</Link>
        </Button>
      </Card>
    );
  }

  /* ---------------------------------------------------------------- */
  /* Stage: receipt                                                    */
  /* ---------------------------------------------------------------- */
  if (stage === "done") {
    return (
      <div className="space-y-5">
        <Card className="p-6 text-center">
          <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-brand-soft text-brand">
            <CheckCircle2 className="size-7" aria-hidden />
          </span>
          <h2 className="mt-4 text-lg font-semibold">Withdrawal requested</h2>
          <p className="tabular mt-2 text-3xl font-semibold tracking-tight">
            {formatInr(quote.netInr, { approximate: false, precise: true })}
          </p>
          <p className="tabular text-sm text-muted-foreground">
            from {formatUsdt(quote.amountUsdt)}
          </p>
        </Card>

        <div className="flex items-start gap-2.5 rounded-xl border border-border bg-secondary/60 p-3.5">
          <Clock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <p className="text-xs leading-relaxed text-muted-foreground">
            {WITHDRAWAL_PROCESSING_WINDOW}. You can follow its status in your
            transaction history.
          </p>
        </div>

        <div className="divide-y divide-border rounded-2xl border border-border bg-card px-4">
          <InfoRow label="To" value={account.bankName} hint={account.accountNumberMasked} />
          <InfoRow
            label="Payout rate"
            value={`1 USDT = ₹${quote.rate.toFixed(2)}`}
          />
          <InfoRow label="Fees" value={formatUsdt(quote.totalFeeUsdt)} />
          <InfoRow label="Status" value="Processing" />
        </div>

        <div className="space-y-2">
          <Button asChild variant="brand" size="lg" block>
            <Link href="/wallet">Back to wallet</Link>
          </Button>
          <Button asChild variant="ghost" size="lg" block>
            <Link href="/wallet/transactions">View transactions</Link>
          </Button>
        </div>
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /* Stage: confirm                                                    */
  /* ---------------------------------------------------------------- */
  if (stage === "confirm") {
    return (
      <div className="space-y-5">
        <Card className="p-5 text-center">
          <p className="text-xs font-medium text-muted-foreground">
            You will receive
          </p>
          <p className="tabular mt-1 text-[2.125rem] font-semibold leading-10 tracking-tight">
            {formatInr(quote.netInr, { approximate: false, precise: true })}
          </p>
          <p className="tabular mt-1 text-sm text-muted-foreground">
            Withdrawing {formatUsdt(quote.amountUsdt)}
          </p>
        </Card>

        <div className="divide-y divide-border rounded-2xl border border-border bg-card px-4">
          <InfoRow label="Withdrawal amount" value={formatUsdt(quote.amountUsdt)} />
          <InfoRow
            label="Network & processing fee"
            value={`− ${formatUsdt(quote.flatFeeUsdt)}`}
          />
          <InfoRow
            label={`Service fee (${WITHDRAWAL_FEE_PERCENT}%)`}
            value={`− ${formatUsdt(quote.percentFeeUsdt)}`}
          />
          <InfoRow label="Net amount" value={formatUsdt(quote.netUsdt)} />
          <InfoRow
            label="Payout rate"
            value={`1 USDT = ₹${quote.rate.toFixed(2)}`}
            hint="Quoted rate, locked for this request"
          />
          <InfoRow
            label="You receive"
            value={formatInr(quote.netInr, { approximate: false, precise: true })}
            emphasis
          />
        </div>

        <div className="divide-y divide-border rounded-2xl border border-border bg-card px-4">
          <InfoRow label="Bank" value={account.bankName} />
          <InfoRow label="Account" value={account.accountNumberMasked} />
          <InfoRow label="IFSC" value={account.ifsc} />
          <InfoRow label="Holder" value={account.holderName} />
        </div>

        <div className="flex items-start gap-2.5 rounded-xl border border-border bg-secondary/60 p-3.5">
          <Clock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <p className="text-xs leading-relaxed text-muted-foreground">
            {WITHDRAWAL_PROCESSING_WINDOW}. Demo build — no funds actually leave
            your account.
          </p>
        </div>

        <div className="space-y-2">
          <Button variant="brand" size="lg" block onClick={handleConfirm}>
            Confirm withdrawal
          </Button>
          <Button variant="ghost" size="lg" block onClick={() => setStage("amount")}>
            Back
          </Button>
        </div>
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /* Stage: amount                                                     */
  /* ---------------------------------------------------------------- */
  return (
    <div className="space-y-5">
      <Card className="p-5">
        <p className="text-xs font-medium text-muted-foreground">
          Available to withdraw
        </p>
        <p className="tabular mt-1 text-2xl font-semibold tracking-tight">
          {formatUsdt(balance.available)}
        </p>
        <p className="tabular text-xs text-muted-foreground">
          {formatUsdtAsInr(balance.available)}
        </p>
      </Card>

      <div className="space-y-2">
        <Label htmlFor="withdraw-amount">Withdrawal amount (USDT)</Label>
        <Input
          id="withdraw-amount"
          inputMode="decimal"
          type="text"
          autoComplete="off"
          placeholder={`Min ${MIN_WITHDRAWAL_USDT}`}
          value={rawAmount}
          onChange={(event) =>
            setRawAmount(event.target.value.replace(/[^0-9.]/g, ""))
          }
          aria-invalid={Boolean(error)}
          aria-describedby="withdraw-amount-help"
        />
        <p
          id="withdraw-amount-help"
          className={cn(
            "text-xs leading-relaxed",
            error ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {error ??
            (valid
              ? `You will receive about ${formatInr(usdtToInr(quote.netUsdt, quote.rate), { approximate: false })}`
              : `Minimum ${formatUsdt(MIN_WITHDRAWAL_USDT)}. Fees apply.`)}
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          {[0.25, 0.5, 1].map((fraction) => {
            const value = Math.floor(balance.available * fraction * 100) / 100;
            return (
              <Button
                key={fraction}
                type="button"
                variant="outline"
                size="sm"
                disabled={value < MIN_WITHDRAWAL_USDT}
                onClick={() => setRawAmount(String(value))}
              >
                {fraction === 1 ? "Max" : `${fraction * 100}%`}
              </Button>
            );
          })}
        </div>
      </div>

      {/* Destination account */}
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Pay into</legend>
        {savedBankAccounts.map((item) => {
          const selected = item.id === accountId;
          return (
            <label
              key={item.id}
              className={cn(
                "flex cursor-pointer items-center gap-3 rounded-2xl border p-4 transition-colors",
                "focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring",
                selected
                  ? "border-brand bg-brand-soft"
                  : "border-border bg-card hover:bg-secondary/50",
              )}
            >
              <input
                type="radio"
                name="withdraw-account"
                value={item.id}
                checked={selected}
                onChange={() => setAccountId(item.id)}
                className="sr-only"
              />
              <span
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-full",
                  selected ? "bg-brand/15 text-brand" : "bg-secondary text-foreground",
                )}
              >
                <Landmark className="size-4" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-foreground">
                  {item.bankName}
                </span>
                <span className="tabular mt-0.5 block text-xs text-muted-foreground">
                  {item.accountNumberMasked} · {item.holderName}
                </span>
              </span>
              <span
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full border-2",
                  selected ? "border-brand bg-brand" : "border-border",
                )}
              >
                {selected ? (
                  <span className="size-1.5 rounded-full bg-brand-foreground" />
                ) : null}
              </span>
            </label>
          );
        })}
      </fieldset>

      {/* Live quote */}
      <div className="divide-y divide-border rounded-2xl border border-border bg-card px-4">
        <InfoRow
          label="Payout rate"
          value={`1 USDT = ₹${payoutRate.rate.toFixed(2)}`}
          hint={payoutRate.label}
        />
        <InfoRow
          label="Fees"
          value={
            valid ? formatUsdt(quote.totalFeeUsdt) : `${WITHDRAWAL_FEE_USDT} + ${WITHDRAWAL_FEE_PERCENT}%`
          }
        />
        <InfoRow
          label="You receive"
          value={formatInr(quote.netInr, { approximate: false, precise: true })}
          emphasis
        />
      </div>

      <Button
        variant="brand"
        size="lg"
        block
        disabled={!valid}
        onClick={() => setStage("confirm")}
      >
        Review withdrawal
      </Button>
    </div>
  );
}
