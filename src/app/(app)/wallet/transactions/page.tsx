import type { Metadata } from "next";

import { UserDataProvider } from "@/lib/prototype-store";
import {
  getUserSlices,
  TRANSACTION_HISTORY_LIMIT,
} from "@/server/services/account.service";

import { PageContainer } from "@/components/navigation/app-shell";
import { PageHeader } from "@/components/shared/page-header";
import { TransactionBrowser } from "@/components/wallet/transaction-browser";

export const metadata: Metadata = {
  title: "Transaction history",
};

/**
 * The one screen that browses an account's ledger.
 *
 * It reads a much larger window than Home or Wallet — this is where somebody
 * actually looks through their past — but it still reads a bounded one. An
 * unbounded read here is a page that gets slower every month the product is
 * used, and the honest alternative to a limit is not "no limit": it is a limit
 * the reader is told about, which is what the notice below does.
 */
export default async function TransactionsPage() {
  const slices = await getUserSlices(["transactions"] as const, undefined, {
    transactionLimit: TRANSACTION_HISTORY_LIMIT,
  });

  // At the ceiling there is probably more history than is shown. Said plainly
  // rather than letting the list end and read as "that is everything".
  const atLimit = slices.transactions.length >= TRANSACTION_HISTORY_LIMIT;

  return (
    <UserDataProvider data={slices}>
      <>
        <PageHeader title="Transaction history" backHref="/wallet" />
        <PageContainer className="space-y-4">
          <TransactionBrowser />
          {atLimit ? (
            <p className="rounded-xl border border-border bg-secondary/60 p-3.5 text-xs leading-relaxed text-muted-foreground">
              Showing your most recent{" "}
              <strong className="font-medium text-foreground">
                {TRANSACTION_HISTORY_LIMIT}
              </strong>{" "}
              entries. Older activity is not shown here — contact support if you
              need a full statement.
            </p>
          ) : null}
        </PageContainer>
      </>
  </UserDataProvider>
  );
}
