"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, ExternalLink, UserPlus, Wallet, XCircle } from "lucide-react";
import { toast } from "sonner";

import { AdminHeader } from "@/components/admin/layout/admin-header";
import { AdminPage, AdminSection } from "@/components/admin/layout/admin-shell";
import { AdminStatusBadge } from "@/components/admin/shared/admin-status-badge";
import {
  AdminStatCard,
  AdminStatGrid,
} from "@/components/admin/shared/admin-stat-card";
import { ConfirmActionDialog } from "@/components/admin/shared/confirm-action-dialog";
import {
  DataCard,
  DataCardRow,
  DataTable,
  PrimaryCell,
  type DataTableColumn,
} from "@/components/admin/shared/data-table";
import { MonoValue } from "@/components/admin/shared/detail-list";
import {
  FilterBar,
  FilterChips,
  SearchField,
  type FilterOption,
} from "@/components/admin/shared/filter-bar";
import { PermissionGate } from "@/components/admin/shared/permission-gate";
import { EmptyState } from "@/components/shared/empty-state";
import { PrototypeNote } from "@/components/shared/notices";
import { Button } from "@/components/ui/button";
import { DepositAssignmentDialog } from "@/components/admin/money/deposit-assignment-dialog";
import { ADMIN_PAGE_SIZE } from "@/constants/admin";
import { NETWORK_LABELS, transactionUrl } from "@/lib/tron-explorer";
import {
  assignDepositAction,
  creditDepositAction,
  failDepositAction,
  ignoreDepositAction,
} from "@/app/admin/actions";
import { depositNetworkLabels } from "@/data/admin/deposits";
import { canManage } from "@/lib/admin-permissions";
import { useAdminStore } from "@/lib/admin-store";
import { formatUsdt, formatUsdtAsInr } from "@/lib/currency";
import type { AdminDeposit, AdminDepositStatus } from "@/types/admin";
import { formatDateTime, truncateMiddle } from "@/utils/format";

/**
 * Deposit ledger.
 *
 * No blockchain connectivity exists: confirmation counts are static sample
 * values and "credit" is a state change in the prototype store, not an on-chain
 * observation. The screen is built so a real chain watcher can drive the same
 * status transitions later.
 */

type StatusFilter = "all" | AdminDepositStatus;

export function DepositsView() {
  return (
    <>
      <AdminHeader
        title="Deposits"
        description="Incoming USDT transfers and their confirmation state."
      />
      <AdminPage>
        <PermissionGate permission="deposits">
          <DepositsBrowser />
        </PermissionGate>
      </AdminPage>
    </>
  );
}

function DepositsBrowser() {
  const store = useAdminStore();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [crediting, setCrediting] = useState<string | null>(null);
  const [failing, setFailing] = useState<string | null>(null);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const router = useRouter();

  // An affordance. The boundary is `requirePermission("deposits")` inside each
  // action, on the server.
  const allowed = canManage(store.session, "deposits");
  const deposits = store.deposits;

  const options: FilterOption<StatusFilter>[] = useMemo(() => {
    const count = (value: AdminDepositStatus) =>
      deposits.filter((deposit) => deposit.status === value).length;
    return [
      { value: "all", label: "All", count: deposits.length },
      { value: "pending", label: "Pending", count: count("pending") },
      { value: "detected", label: "Detected", count: count("detected") },
      { value: "confirming", label: "Confirming", count: count("confirming") },
      { value: "confirmed", label: "Confirmed", count: count("confirmed") },
      { value: "credited", label: "Credited", count: count("credited") },
      { value: "failed", label: "Failed", count: count("failed") },
    ];
  }, [deposits]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return deposits
      .filter((deposit) => {
        if (status !== "all" && deposit.status !== status) return false;
        if (!needle) return true;
        return [
          deposit.id,
          deposit.userName,
          deposit.userDisplayId,
          deposit.txHash,
          deposit.walletAddress,
        ]
          .join(" ")
          .toLowerCase()
          .includes(needle);
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [deposits, query, status]);

  const totalCredited = deposits
    .filter((deposit) => deposit.status === "credited")
    .reduce((sum, deposit) => sum + deposit.amountUsdt, 0);
  const inFlight = deposits.filter(
    (deposit) =>
      deposit.status !== "credited" && deposit.status !== "failed",
  );
  const inFlightValue = inFlight.reduce(
    (sum, deposit) => sum + deposit.amountUsdt,
    0,
  );

  const creditTarget = deposits.find((deposit) => deposit.id === crediting);
  const failTarget = deposits.find((deposit) => deposit.id === failing);
  const assignTarget = deposits.find((deposit) => deposit.id === assigning) ?? null;

  /**
   * Runs a server action and re-reads.
   *
   * `router.refresh()` re-renders this page segment, which re-reads the
   * deposits slice from the database. Without it the write would land and the
   * screen would keep showing the old row.
   */
  async function run(
    label: string,
    action: () => Promise<{ ok: boolean; message: string }>,
  ) {
    setPending(label);
    try {
      const result = await action();
      if (result.ok) {
        toast.success(result.message, {
          icon: <CheckCircle2 className="size-4 text-positive" />,
        });
        router.refresh();
      } else {
        // Surfaced, never swallowed: a refusal the operator cannot see is a
        // refusal they will retry forever.
        toast.error(result.message, {
          icon: <XCircle className="size-4 text-destructive" />,
        });
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "The deposit was not changed.",
      );
    } finally {
      setPending(null);
    }
  }

  /**
 * A transaction hash, linked to the explorer when it is a real chain hash.
 *
 * The seeded sample rows carry placeholder hashes, and linking those would
 * send an operator to a "not found" page — which is worse than no link,
 * because it makes them distrust the real ones.
 */
function TxLink({ deposit }: { deposit: AdminDeposit }) {
  const href = transactionUrl(deposit.chainNetwork, deposit.txHash);
  const label = truncateMiddle(deposit.txHash, 10, 6);

  if (!href) {
    return <MonoValue className="text-muted-foreground">{label}</MonoValue>;
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex items-center gap-1 rounded font-mono text-xs text-brand underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      {label}
      <ExternalLink className="size-3" aria-hidden />
      <span className="sr-only">
        {" "}
        (opens {NETWORK_LABELS[deposit.chainNetwork]} explorer in a new tab)
      </span>
    </a>
  );
}

/** Only a confirmed deposit is safe to credit; anything earlier can reorg. */
  const canCredit = (deposit: AdminDeposit) =>
    deposit.status === "confirmed" ||
    deposit.status === "confirming" ||
    deposit.status === "detected" ||
    deposit.status === "pending";

  const columns: DataTableColumn<AdminDeposit>[] = [
    {
      id: "id",
      header: "Deposit",
      cell: (deposit) => (
        <PrimaryCell
          title={deposit.id}
          subtitle={formatDateTime(deposit.createdAt)}
        />
      ),
    },
    {
      id: "user",
      header: "Assigned to",
      cell: (deposit) =>
        deposit.userId ? (
          <Link
            href={`/admin/users/${deposit.userId}`}
            className="block rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <PrimaryCell
              title={deposit.userName}
              subtitle={deposit.userDisplayId}
            />
          </Link>
        ) : (
          // Not a placeholder for a missing name — the deposit genuinely
          // belongs to nobody until an operator attributes it.
          <span className="flex flex-col">
            <span className="text-sm font-medium text-warning">Unassigned</span>
            <span className="text-xs text-muted-foreground">
              Needs attribution
            </span>
          </span>
        ),
    },
    {
      id: "sender",
      header: "From",
      hideBelow: "xl",
      cell: (deposit) =>
        deposit.senderAddress ? (
          <MonoValue className="text-muted-foreground">
            {truncateMiddle(deposit.senderAddress, 6, 6)}
          </MonoValue>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      id: "amount",
      header: "Amount",
      numeric: true,
      cell: (deposit) => (
        <span className="flex flex-col items-end">
          <span className="font-medium">
            {formatUsdt(deposit.amountUsdt, { withSymbol: false })}
          </span>
          <span className="text-xs text-muted-foreground">
            {formatUsdtAsInr(deposit.amountUsdt)}
          </span>
        </span>
      ),
    },
    {
      id: "network",
      header: "Network",
      hideBelow: "lg",
      cell: (deposit) => (
        <span className="flex flex-col">
          <span className="text-xs text-muted-foreground">
            {depositNetworkLabels[deposit.network]}
          </span>
          <span className="text-[11px] text-muted-foreground">
            {NETWORK_LABELS[deposit.chainNetwork]} ·{" "}
            {deposit.tokenSymbol ?? "USDT"}
          </span>
        </span>
      ),
    },
    {
      id: "address",
      header: "Address",
      hideBelow: "xl",
      cell: (deposit) => (
        <MonoValue className="text-muted-foreground">
          {truncateMiddle(deposit.walletAddress, 8, 6)}
        </MonoValue>
      ),
    },
    {
      id: "tx",
      header: "Transaction",
      hideBelow: "xl",
      cell: (deposit) => <TxLink deposit={deposit} />,
    },
    {
      id: "confirmations",
      header: "Confirmations",
      numeric: true,
      hideBelow: "lg",
      cell: (deposit) => (
        <span className="text-xs text-muted-foreground">
          {deposit.confirmations.current} / {deposit.confirmations.required}
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (deposit) => (
        <AdminStatusBadge kind="deposit" status={deposit.status} />
      ),
    },
    {
      id: "actions",
      header: "Actions",
      srOnlyHeader: true,
      numeric: true,
      cell: (deposit) =>
        // An unattributed chain deposit needs a user before it can be credited,
        // so its primary action is attribution rather than "Credit".
        deposit.userId === null && deposit.status !== "ignored" ? (
          <span className="flex justify-end gap-1.5">
            <Button
              variant="brand"
              size="sm"
              disabled={!allowed || pending !== null}
              onClick={() => setAssigning(deposit.id)}
            >
              <UserPlus className="size-3.5" aria-hidden />
              Assign
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={!allowed || pending !== null}
              onClick={() => setFailing(deposit.id)}
            >
              Ignore
            </Button>
          </span>
        ) : canCredit(deposit) ? (
          <span className="flex justify-end gap-1.5">
            <Button
              variant="brand"
              size="sm"
              disabled={!allowed}
              onClick={() => setCrediting(deposit.id)}
            >
              Credit
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={!allowed}
              onClick={() => setFailing(deposit.id)}
            >
              Fail
            </Button>
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
  ];

  return (
    <AdminSection className="space-y-4">
      <PrototypeNote>
        Deposits detected on TRON Shasta are real testnet transfers, recorded in
        the database and credited for good when assigned. Rows carrying
        placeholder hashes are sample data from before the chain integration.
        Withdrawals remain records only — nothing pays out.
      </PrototypeNote>

      <AdminStatGrid className="md:grid-cols-3 xl:grid-cols-3">
        <AdminStatCard
          label="Credited to date"
          amount={totalCredited}
          icon={Wallet}
          tone="positive"
          showInr
        />
        <AdminStatCard
          label="In flight"
          value={inFlight.length}
          hint={`${formatUsdt(inFlightValue, { withSymbol: false })} USDT not yet credited`}
          tone={inFlight.length > 0 ? "warning" : "default"}
        />
        <AdminStatCard
          label="Failed"
          value={deposits.filter((deposit) => deposit.status === "failed").length}
          hint="Transfers that never arrived"
          tone="negative"
        />
      </AdminStatGrid>

      <FilterBar>
        <SearchField
          value={query}
          onChange={setQuery}
          label="Search deposits"
          placeholder="Deposit ID, user, transaction hash or wallet address"
        />
      </FilterBar>

      <FilterChips
        options={options}
        value={status}
        onChange={setStatus}
        label="Filter by deposit status"
      />

      <DataTable
        rows={filtered}
        columns={columns}
        getRowKey={(deposit) => deposit.id}
        caption="Incoming USDT deposits with network, confirmations and status"
        pageSize={ADMIN_PAGE_SIZE}
        resetKey={`${query}|${status}`}
        empty={
          <EmptyState
            icon={Wallet}
            title="No matching deposits"
            description="No deposit matches the current search and filters."
          />
        }
        renderCard={(deposit) => (
          <DataCard>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="tabular text-sm font-medium">{deposit.id}</p>
                <Link
                  href={`/admin/users/${deposit.userId}`}
                  className="truncate text-xs text-brand"
                >
                  {deposit.userName}
                </Link>
              </div>
              <AdminStatusBadge kind="deposit" status={deposit.status} />
            </div>
            <DataCardRow label="Amount">
              <span className="tabular block">
                {formatUsdt(deposit.amountUsdt)}
              </span>
              <span className="tabular block text-xs font-normal text-muted-foreground">
                {formatUsdtAsInr(deposit.amountUsdt)}
              </span>
            </DataCardRow>
            <DataCardRow label="Network">
              {depositNetworkLabels[deposit.network]}
            </DataCardRow>
            <DataCardRow label="Confirmations">
              <span className="tabular">
                {deposit.confirmations.current} / {deposit.confirmations.required}
              </span>
            </DataCardRow>
            <DataCardRow label="Transaction">
              <MonoValue>{truncateMiddle(deposit.txHash, 10, 6)}</MonoValue>
            </DataCardRow>
            {canCredit(deposit) ? (
              <div className="flex gap-2">
                <Button
                  variant="brand"
                  size="sm"
                  className="flex-1"
                  disabled={!allowed}
                  onClick={() => setCrediting(deposit.id)}
                >
                  Credit
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  disabled={!allowed}
                  onClick={() => setFailing(deposit.id)}
                >
                  Mark failed
                </Button>
              </div>
            ) : null}
          </DataCard>
        )}
      />

      <ConfirmActionDialog
        open={crediting !== null}
        onOpenChange={(open) => !open && setCrediting(null)}
        title="Credit this deposit?"
        description={
          creditTarget ? (
            <>
              <strong className="font-medium text-foreground">
                {formatUsdt(creditTarget.amountUsdt)}
              </strong>{" "}
              will be added to {creditTarget.userName}&rsquo;s available balance
              and the deposit marked credited.
            </>
          ) : null
        }
        confirmLabel="Credit deposit"
        reason={{ label: "Note", placeholder: "Anything worth recording?" }}
        onConfirm={(note) => {
          if (!crediting) return;
          void run("credit", () =>
            creditDepositAction({ depositId: crediting, note }),
          );
          setCrediting(null);
        }}
      >
        {creditTarget &&
        creditTarget.confirmations.current < creditTarget.confirmations.required ? (
          <p className="rounded-xl border border-warning/30 bg-warning/8 p-3 text-xs leading-relaxed text-muted-foreground">
            This transfer has only{" "}
            <span className="tabular font-medium text-foreground">
              {creditTarget.confirmations.current} of{" "}
              {creditTarget.confirmations.required}
            </span>{" "}
            confirmations. Crediting early risks a chain reorganisation
            reversing the transfer after the funds have been made available.
          </p>
        ) : null}
      </ConfirmActionDialog>

      <ConfirmActionDialog
        open={failing !== null}
        onOpenChange={(open) => !open && setFailing(null)}
        title="Mark this deposit failed?"
        description={
          failTarget ? (
            <>
              {failTarget.id} will be closed as failed and no funds will be
              credited to {failTarget.userName}. The reason is shown to the user.
            </>
          ) : null
        }
        confirmLabel="Mark failed"
        destructive
        reason={{
          label: "Reason",
          required: true,
          presets: [
            "Sent on a network the address does not support.",
            "Transaction dropped from the mempool before confirmation.",
            "Amount below the minimum deposit.",
            "Transfer reversed by a chain reorganisation.",
          ],
        }}
        onConfirm={(reason) => {
          if (!failing) return;
          const target = deposits.find((deposit) => deposit.id === failing);
          // Two different statements, so two different actions. An
          // unattributed transfer is "not ours" — ignored, internal. An
          // attributed one is "your deposit did not go through" — failed, and
          // the reason is shown to that account.
          void run(target?.userId ? "fail" : "ignore", () =>
            target?.userId
              ? failDepositAction({ depositId: failing, reason })
              : ignoreDepositAction({ depositId: failing, reason }),
          );
          setFailing(null);
        }}
      />

      <DepositAssignmentDialog
        deposit={assignTarget}
        users={store.users}
        open={assigning !== null}
        onOpenChange={(open) => !open && setAssigning(null)}
        onConfirm={(userId, note) => {
          if (!assigning) return;
          void run("assign", () =>
            assignDepositAction({
              depositId: assigning,
              userId,
              note,
            }),
          );
          setAssigning(null);
        }}
      />
    </AdminSection>
  );
}
