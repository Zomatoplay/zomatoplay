"use client";

import Link from "next/link";
import { ArrowDownToLine, BadgeCheck, ShieldAlert } from "lucide-react";

import { InfoRow } from "@/components/shared/info-row";
import { Button } from "@/components/ui/button";
import { formatUsdt, formatUsdtAsInr } from "@/lib/currency";
import { usePrototypeStore } from "@/lib/prototype-store";

/**
 * The two facts that decide whether this person can allocate right now.
 *
 * Both were previously visible only *inside* `InvestSheet` — so somebody
 * reading a plan page had to open the sheet to find out they were unverified,
 * or that their balance was short. Putting them on the page turns two dead
 * ends into two next steps, and neither is a new read: `balance` and `profile`
 * are already in the page's slice declaration because the sheet needs them.
 *
 * It reports state and offers a route out of it. It never decides anything —
 * verification and sufficient funds are both re-checked inside
 * `createInvestment`'s own transaction, against the rows Postgres holds.
 */
export function AllocationReadiness() {
  const { balance, isVerified } = usePrototypeStore();

  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold tracking-tight">Your account</h2>
      <div className="divide-y divide-border rounded-2xl border border-border bg-card px-4">
        <InfoRow
          label="Available to allocate"
          value={formatUsdt(balance.available)}
          hint={formatUsdtAsInr(balance.available)}
        />
        <InfoRow
          label="Verification"
          value={
            <span className="inline-flex items-center gap-1.5">
              {isVerified ? (
                <>
                  <BadgeCheck className="size-4 text-brand" aria-hidden />
                  Verified
                </>
              ) : (
                <>
                  <ShieldAlert className="size-4 text-warning" aria-hidden />
                  Required
                </>
              )}
            </span>
          }
          hint={isVerified ? undefined : "Needed before you can allocate"}
        />
      </div>

      {/* Wraps at 360px; both targets clear 44px at `size="sm"`. */}
      {!isVerified || balance.available <= 0 ? (
        <div className="flex flex-wrap gap-2">
          {!isVerified ? (
            <Button asChild variant="outline" size="sm">
              <Link href="/settings/kyc">Complete verification</Link>
            </Button>
          ) : null}
          {balance.available <= 0 ? (
            <Button asChild variant="outline" size="sm">
              <Link href="/wallet/deposit">
                <ArrowDownToLine className="size-4" aria-hidden />
                Deposit USDT
              </Link>
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
