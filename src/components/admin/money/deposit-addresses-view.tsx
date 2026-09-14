"use client";

import { useMemo, useState } from "react";
import { ExternalLink, Plus, ShieldAlert, Wallet } from "lucide-react";

import { AdminHeader } from "@/components/admin/layout/admin-header";
import { AdminPage, AdminSection } from "@/components/admin/layout/admin-shell";
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
import {
  FilterBar,
  FilterChips,
  SearchField,
  type FilterOption,
} from "@/components/admin/shared/filter-bar";
import { PermissionGate } from "@/components/admin/shared/permission-gate";
import { useAdminAction } from "@/components/admin/shared/use-admin-action";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
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
} from "@/components/ui/sheet";
import { ADMIN_PAGE_SIZE } from "@/constants/admin";
import { addressUrl, NETWORK_LABELS } from "@/lib/tron-explorer";
import type { ChainNetwork } from "@/types/admin";
import {
  addDepositAddressAction,
  releaseDepositAddressAction,
  retireDepositAddressAction,
} from "@/app/admin/actions";
import { canManage } from "@/lib/admin-permissions";
import { useAdminStore } from "@/lib/admin-store";
import { formatUsdt } from "@/lib/currency";
import type {
  AdminDepositAddress,
  DepositAddressStatus,
} from "@/types/admin";
import { formatDateTimeUtc, truncateMiddle } from "@/utils/format";

/**
 * The deposit-address pool.
 *
 * WHAT THIS SCREEN GOVERNS, AND WHAT IT DELIBERATELY DOES NOT
 * ------------------------------------------------------------
 * It manages rows in `deposit_addresses` — which address exists, whose it is,
 * and whether it is still in rotation. That is the part of the deposit
 * configuration that is genuinely runtime state, and it has always been
 * database-backed.
 *
 * It is **not** an environment editor. `TRON_NETWORK`, the TronGrid URL, the
 * API key and `CRON_SECRET` are deployment configuration; no screen in this
 * application reads or writes them, and none should — an API key editable from
 * a browser session is an API key one compromised operator account away from
 * being exfiltrated.
 *
 * It also never *generates* an address. Nothing in this codebase holds a
 * private key, a seed or an xpub (CLAUDE.md §18.8), so an address it produced
 * would be one nobody could ever sweep. The operator generates it with their
 * own wallet tooling and pastes it; only the string arrives, and its base58
 * checksum is verified server-side before a row exists.
 *
 * EVERY MUTATION GOES THROUGH THE EXISTING SERVER ACTIONS
 * -------------------------------------------------------
 * `addDepositAddressAction`, `releaseDepositAddressAction` and
 * `retireDepositAddressAction`, each of which begins with
 * `requirePermission("deposits")` and writes its audit entry inside the same
 * transaction as the change. The refusal that matters — an address with
 * unresolved deposit activity cannot leave its owner — lives in the service
 * and is enforced whatever this screen does. What this screen adds is telling
 * the operator *why* before they try.
 */

type StatusFilter = "all" | DepositAddressStatus;

const STATUS_FILTERS: FilterOption<StatusFilter>[] = [
  { value: "all", label: "All" },
  { value: "available", label: "Available" },
  { value: "assigned", label: "Assigned" },
  { value: "retired", label: "Retired" },
];

const STATUS_TONE: Record<DepositAddressStatus, string> = {
  available: "border-brand/40 bg-brand-soft text-brand",
  assigned: "border-border bg-secondary text-foreground",
  retired: "border-border bg-muted text-muted-foreground",
};

export function DepositAddressesView() {
  return (
    <>
      <AdminHeader
        title="Deposit addresses"
        description="The pool of TRON receiving addresses, and which account holds each one."
      />
      <AdminPage>
        <PermissionGate permission="deposits">
          <AddressManager />
        </PermissionGate>
      </AdminPage>
    </>
  );
}

function AddressManager() {
  const store = useAdminStore();
  const { run, pending } = useAdminAction();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [adding, setAdding] = useState(false);
  const [releasing, setReleasing] = useState<AdminDepositAddress | null>(null);
  const [retiring, setRetiring] = useState<AdminDepositAddress | null>(null);

  const allowed = canManage(store.session, "deposits");
  const addresses = store.depositAddresses;

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return addresses.filter((row) => {
      if (status !== "all" && row.status !== status) return false;
      if (needle === "") return true;
      return (
        row.address.toLowerCase().includes(needle) ||
        (row.assignedUserName ?? "").toLowerCase().includes(needle) ||
        (row.assignedUserDisplayId ?? "").toLowerCase().includes(needle)
      );
    });
  }, [addresses, query, status]);

  const available = addresses.filter((row) => row.status === "available").length;
  const assigned = addresses.filter((row) => row.status === "assigned").length;
  const unresolved = addresses.reduce((sum, row) => sum + row.unresolvedDeposits, 0);

  const columns: DataTableColumn<AdminDepositAddress>[] = [
    {
      id: "address",
      header: "Address",
      cell: (row) => (
        <PrimaryCell
          title={truncateMiddle(row.address, 10, 8)}
          subtitle={`${networkLabel(row.network)} · ${row.asset.toUpperCase()}`}
        />
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (row) => (
        <Badge variant="outline" className={STATUS_TONE[row.status]}>
          {row.status}
        </Badge>
      ),
    },
    {
      id: "holder",
      header: "Assigned to",
      cell: (row) =>
        row.assignedUserId ? (
          <PrimaryCell
            title={row.assignedUserName ?? row.assignedUserId}
            subtitle={row.assignedUserDisplayId ?? undefined}
          />
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        ),
    },
    {
      id: "deposits",
      header: "Deposits",
      numeric: true,
      hideBelow: "lg",
      cell: (row) => (
        <div className="text-right">
          <p className="tabular text-sm font-medium">{row.depositCount}</p>
          <p className="tabular text-[11px] text-muted-foreground">
            {formatUsdt(row.totalCreditedUsdt, { withSymbol: false, compact: true })}{" "}
            credited
          </p>
        </div>
      ),
    },
    {
      id: "unresolved",
      header: "Unresolved",
      numeric: true,
      cell: (row) =>
        row.unresolvedDeposits > 0 ? (
          <span className="tabular text-sm font-medium text-warning">
            {row.unresolvedDeposits}
          </span>
        ) : (
          <span className="tabular text-sm text-muted-foreground">0</span>
        ),
    },
    {
      id: "assignedAt",
      header: "Assigned",
      hideBelow: "xl",
      cell: (row) => (
        <span className="text-xs text-muted-foreground">
          {row.assignedAt ? formatDateTimeUtc(row.assignedAt) : "—"}
        </span>
      ),
    },
    {
      id: "actions",
      header: "Actions",
      cell: (row) => renderActions(row),
    },
  ];

  /*
   * A plain function, not a component defined during render.
   *
   * It closes over `allowed`, `pending` and the two dialog setters, so
   * declaring it as a component would give React a new type on every render
   * and remount the subtree each time. It holds no state, so that would be
   * invisible today and a bug the first time somebody added some.
   */
  function renderActions(row: AdminDepositAddress) {
    /*
     * The same rule the service enforces, stated here so the operator can see
     * it rather than discovering it in a toast. The service is still the
     * boundary: a disabled button prevents nothing, and
     * `assertNoUnresolvedDeposits` refuses the write regardless.
     */
    const blocked = row.unresolvedDeposits > 0;
    // Null when the network has no explorer configured; the link is simply not
    // offered rather than pointing somewhere that 404s.
    const explorer = addressUrl(row.network as ChainNetwork, row.address);
    return (
      <div className="flex flex-wrap justify-end gap-2">
        {explorer ? (
          <Button asChild variant="ghost" size="xs">
            <a href={explorer} target="_blank" rel="noreferrer noopener">
              <ExternalLink className="size-3.5" />
              Explorer
            </a>
          </Button>
        ) : null}
        {row.status === "assigned" ? (
          <Button
            variant="outline"
            size="xs"
            disabled={!allowed || pending || blocked}
            title={
              blocked
                ? "This address has deposit activity that has not been resolved yet."
                : undefined
            }
            onClick={() => setReleasing(row)}
          >
            Release
          </Button>
        ) : null}
        {row.status !== "retired" ? (
          <Button
            variant="outline"
            size="xs"
            disabled={!allowed || pending || blocked}
            title={
              blocked
                ? "This address has deposit activity that has not been resolved yet."
                : undefined
            }
            onClick={() => setRetiring(row)}
          >
            Retire
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <AdminSection
      className="space-y-4"
      actions={
        <Button
          variant="brand"
          size="sm"
          disabled={!allowed}
          onClick={() => setAdding(true)}
        >
          <Plus className="size-4" />
          Add address
        </Button>
      }
    >
      <AdminStatGrid className="md:grid-cols-3">
        <AdminStatCard
          label="Available"
          value={available}
          icon={Wallet}
          hint="Claimable by the next account that opens the deposit screen"
          tone={available === 0 ? "warning" : "default"}
        />
        <AdminStatCard
          label="Assigned"
          value={assigned}
          hint="Held by an account; never reassigned automatically"
        />
        <AdminStatCard
          label="Unresolved deposits"
          value={unresolved}
          icon={ShieldAlert}
          tone={unresolved > 0 ? "warning" : "default"}
          hint="Transfers not yet credited, failed or ignored"
        />
      </AdminStatGrid>

      {available === 0 ? (
        /*
          The pool running dry is the one failure on this screen a customer
          feels directly: `getOrCreateDepositAddress` throws `PoolExhaustedError`
          and the deposit screen says it could not get an address. Said plainly
          rather than left to be inferred from a zero.
        */
        <p className="rounded-xl border border-warning/40 bg-warning/8 p-3 text-sm leading-relaxed text-muted-foreground">
          <strong className="font-medium text-foreground">
            No addresses are available.
          </strong>{" "}
          The next account to open the deposit screen for the first time cannot be
          given one and will see an error. Add an address generated with your own
          wallet tooling.
        </p>
      ) : null}

      <FilterBar>
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="Search address or holder"
          label="Search deposit addresses"
        />
        <FilterChips
          options={STATUS_FILTERS}
          value={status}
          onChange={setStatus}
          label="Filter by status"
        />
      </FilterBar>

      {visible.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="No deposit addresses"
          description={
            addresses.length === 0
              ? "The pool is empty. Add an address to start receiving deposits."
              : "No address matches these filters."
          }
        />
      ) : (
        <DataTable
          caption="Deposit addresses"
          rows={visible}
          columns={columns}
          pageSize={ADMIN_PAGE_SIZE}
          getRowKey={(row) => row.id}
          resetKey={`${query}:${status}`}
          empty={null}
          renderCard={(row) => (
            <DataCard>
              <div className="flex items-start justify-between gap-3">
                <span className="min-w-0 break-all font-medium">
                  {truncateMiddle(row.address, 12, 10)}
                </span>
                <Badge variant="outline" className={STATUS_TONE[row.status]}>
                  {row.status}
                </Badge>
              </div>
              <DataCardRow label="Network">
                {networkLabel(row.network)} · {row.asset.toUpperCase()}
              </DataCardRow>
              <DataCardRow label="Assigned to">
                {row.assignedUserName ?? "—"}
              </DataCardRow>
              <DataCardRow label="Deposits">{row.depositCount}</DataCardRow>
              <DataCardRow label="Unresolved">
                {row.unresolvedDeposits}
              </DataCardRow>
              <DataCardRow label="Credited">
                {formatUsdt(row.totalCreditedUsdt, { withSymbol: false })}
              </DataCardRow>
              <div className="pt-2">{renderActions(row)}</div>
            </DataCard>
          )}
        />
      )}

      <AddAddressSheet
        open={adding}
        onOpenChange={setAdding}
        pending={pending}
        onSubmit={({ address, note }) => {
          run(() => addDepositAddressAction({ address, note }), {
            onSuccess: () => setAdding(false),
          });
        }}
      />

      <ConfirmActionDialog
        open={releasing !== null}
        onOpenChange={(open) => !open && setReleasing(null)}
        title="Release this address back to the pool?"
        description={
          releasing ? (
            <>
              <strong className="font-medium text-foreground">
                {truncateMiddle(releasing.address, 12, 10)}
              </strong>{" "}
              stops belonging to {releasing.assignedUserName ?? "its current holder"}{" "}
              and becomes claimable by the next account that asks for one. A
              transfer that arrives afterwards will not be attributed to them
              automatically. Use <em>Retire</em> instead if the address is being
              replaced.
            </>
          ) : null
        }
        confirmLabel="Release address"
        destructive
        reason={{ label: "Reason", required: true }}
        onConfirm={(reason) => {
          if (!releasing) return;
          run(() =>
            releaseDepositAddressAction({
              addressId: releasing.id,
              reason: reason ?? "",
            }),
          );
          setReleasing(null);
        }}
      />

      <ConfirmActionDialog
        open={retiring !== null}
        onOpenChange={(open) => !open && setRetiring(null)}
        title="Retire this address from rotation?"
        description={
          retiring ? (
            <>
              <strong className="font-medium text-foreground">
                {truncateMiddle(retiring.address, 12, 10)}
              </strong>{" "}
              will never be handed to anybody again. It is{" "}
              <strong className="font-medium text-foreground">not deleted</strong>{" "}
              and the scanner keeps watching it, so a late transfer to it still
              surfaces in the deposits queue instead of vanishing.
            </>
          ) : null
        }
        confirmLabel="Retire address"
        destructive
        reason={{ label: "Reason", required: true }}
        onConfirm={(reason) => {
          if (!retiring) return;
          run(() =>
            retireDepositAddressAction({
              addressId: retiring.id,
              reason: reason ?? "",
            }),
          );
          setRetiring(null);
        }}
      />
    </AdminSection>
  );
}

function AddAddressSheet({
  open,
  onOpenChange,
  onSubmit,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: { address: string; note?: string }) => void;
  pending: boolean;
}) {
  const [address, setAddress] = useState("");
  const [note, setNote] = useState("");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Add a deposit address</SheetTitle>
          <SheetDescription>
            An address you generated with your own wallet tooling. It joins the
            pool as available and the scanner watches it from its next pass.
          </SheetDescription>
        </SheetHeader>

        <SheetBody className="space-y-4">
          <p className="rounded-xl border border-warning/40 bg-warning/8 p-3 text-xs leading-relaxed text-muted-foreground">
            <strong className="font-medium text-foreground">
              Paste the address only.
            </strong>{" "}
            Never a private key, seed phrase or extended private key — this
            application holds no key material of any kind and has no field that
            would accept one. Make sure you can still sign for this address: the
            platform can read deposits to it but can never move funds out.
          </p>

          <div className="space-y-1.5">
            <Label htmlFor="new-deposit-address">TRON address</Label>
            <Input
              id="new-deposit-address"
              value={address}
              autoComplete="off"
              spellCheck={false}
              placeholder="T…"
              onChange={(event) => setAddress(event.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              The base58 checksum is verified on the server before the address is
              saved, so a mistyped one is refused rather than stored.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="new-deposit-note">Note (optional)</Label>
            <Input
              id="new-deposit-note"
              value={note}
              placeholder="Where this address came from"
              onChange={(event) => setNote(event.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              Recorded on the audit entry.
            </p>
          </div>
        </SheetBody>

        <SheetFooter>
          <Button
            variant="brand"
            size="lg"
            block
            disabled={pending || address.trim() === ""}
            onClick={() => {
              onSubmit({ address: address.trim(), note: note.trim() || undefined });
              setAddress("");
              setNote("");
            }}
          >
            {pending ? "Adding…" : "Add to pool"}
          </Button>
          <Button
            variant="ghost"
            size="lg"
            block
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/** The network's display name, falling back to the raw value. */
function networkLabel(network: string): string {
  return NETWORK_LABELS[network as ChainNetwork] ?? network;
}
