"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Ban,
  CircleSlash,
  KeyRound,
  LogOut,
  MoreHorizontal,
  PauseCircle,
  PencilLine,
  ShieldCheck,
  ShieldOff,
  Snowflake,
  TrendingDown,
  Undo2,
  UserRoundCheck,
} from "lucide-react";

import { ConfirmActionDialog } from "@/components/admin/shared/confirm-action-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { canManage } from "@/lib/admin-permissions";
import { useAdminStore } from "@/lib/admin-store";
import { useAdminAction } from "@/components/admin/shared/use-admin-action";
import {
  resetUserTwoFactorAction,
  revokeUserSessionAction,
  sendUserPasswordResetAction,
  setUserRestrictionAction,
  setUserStatusAction,
} from "@/app/admin/actions";
import type { AdminUser } from "@/types/admin";

/**
 * Row and header action menu for a user.
 *
 * Every entry that changes access, credentials or sessions routes through a
 * confirmation dialog that names the user — a menu item one row off is an easy
 * mistake, and several of these actions are visible to the account holder.
 *
 * The menu is gated on `user_details: manage`. An operator without it still
 * sees the menu (so the feature is discoverable) but the acting items are
 * disabled rather than hidden.
 */

type PendingAction =
  | "block"
  | "unblock"
  | "suspend"
  | "deactivate"
  | "reactivate"
  | "resetPassword"
  | "resetTwoFactor"
  | "logoutAll"
  | "freezeAccount"
  | "unfreezeAccount"
  | "freezeWithdrawals"
  | "unfreezeWithdrawals"
  | "freezeInvestments"
  | "unfreezeInvestments";

export function UserActionMenu({
  user,
  /** Show a labelled button rather than an icon-only trigger. */
  variant = "icon",
  /** Where the "Edit user" item should navigate. */
  editHref,
}: {
  user: AdminUser;
  variant?: "icon" | "button";
  editHref?: string;
}) {
  const store = useAdminStore();
  const { run } = useAdminAction();
  const [pending, setPending] = useState<PendingAction | null>(null);
  const allowed = canManage(store.session, "user_details");

  const isBlocked = user.status === "blocked";
  const isSuspended = user.status === "suspended";
  const isDeactivated = user.status === "deactivated";
  const { accountFrozen, withdrawalsFrozen, investmentsFrozen } =
    user.restrictions;

  function close() {
    setPending(null);
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {variant === "icon" ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Actions for ${user.fullName}`}
            >
              <MoreHorizontal className="size-4" />
            </Button>
          ) : (
            <Button variant="outline" size="sm">
              <MoreHorizontal className="size-4" />
              Actions
            </Button>
          )}
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel>{user.displayId}</DropdownMenuLabel>

          {editHref ? (
            <DropdownMenuItem asChild>
              <Link href={editHref}>
                <PencilLine />
                Edit user
              </Link>
            </DropdownMenuItem>
          ) : null}

          <DropdownMenuSeparator />
          <DropdownMenuLabel>Access</DropdownMenuLabel>

          {isBlocked ? (
            <DropdownMenuItem
              disabled={!allowed}
              onSelect={() => setPending("unblock")}
            >
              <UserRoundCheck />
              Unblock user
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              destructive
              disabled={!allowed}
              onSelect={() => setPending("block")}
            >
              <Ban />
              Block user
            </DropdownMenuItem>
          )}

          {isSuspended || isDeactivated ? (
            <DropdownMenuItem
              disabled={!allowed}
              onSelect={() => setPending("reactivate")}
            >
              <Undo2 />
              Reactivate account
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              disabled={!allowed}
              onSelect={() => setPending("suspend")}
            >
              <PauseCircle />
              Suspend user
            </DropdownMenuItem>
          )}

          {!isDeactivated ? (
            <DropdownMenuItem
              destructive
              disabled={!allowed}
              onSelect={() => setPending("deactivate")}
            >
              <CircleSlash />
              Deactivate account
            </DropdownMenuItem>
          ) : null}

          <DropdownMenuSeparator />
          <DropdownMenuLabel>Holds</DropdownMenuLabel>

          <DropdownMenuItem
            disabled={!allowed}
            onSelect={() =>
              setPending(accountFrozen ? "unfreezeAccount" : "freezeAccount")
            }
          >
            <Snowflake />
            {accountFrozen ? "Unfreeze account" : "Freeze account"}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!allowed}
            onSelect={() =>
              setPending(
                withdrawalsFrozen ? "unfreezeWithdrawals" : "freezeWithdrawals",
              )
            }
          >
            <ShieldOff />
            {withdrawalsFrozen ? "Unfreeze withdrawals" : "Freeze withdrawals"}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!allowed}
            onSelect={() =>
              setPending(
                investmentsFrozen ? "unfreezeInvestments" : "freezeInvestments",
              )
            }
          >
            <TrendingDown />
            {investmentsFrozen ? "Unfreeze investments" : "Freeze investments"}
          </DropdownMenuItem>

          <DropdownMenuSeparator />
          <DropdownMenuLabel>Credentials & sessions</DropdownMenuLabel>

          <DropdownMenuItem
            disabled={!allowed}
            onSelect={() => setPending("resetPassword")}
          >
            <KeyRound />
            Reset password
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!allowed}
            onSelect={() => setPending("resetTwoFactor")}
          >
            <ShieldCheck />
            Reset 2FA
          </DropdownMenuItem>
          <DropdownMenuItem
            destructive
            disabled={!allowed}
            onSelect={() => setPending("logoutAll")}
          >
            <LogOut />
            Log out all devices
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* ------------------------------------------------------ Access */}

      <ConfirmActionDialog
        open={pending === "block"}
        onOpenChange={(open) => !open && close()}
        title="Block this user?"
        description={
          <>
            <strong className="font-medium text-foreground">
              {user.fullName}
            </strong>{" "}
            ({user.displayId}) will be signed out and unable to access their
            account, deposit, invest or withdraw. Their balance is unaffected.
          </>
        }
        confirmLabel="Block user"
        destructive
        reason={{
          label: "Reason for blocking",
          required: true,
          placeholder: "Explain why this account is being blocked…",
          presets: [
            "Failed identity verification",
            "Suspected fraudulent activity",
            "Duplicate account",
            "Requested by compliance",
          ],
        }}
        onConfirm={(reason) => {
          run(() =>
            setUserStatusAction({ userId: user.id, status: "blocked", reason: reason }),
          );
        }}
      />

      <ConfirmActionDialog
        open={pending === "unblock"}
        onOpenChange={(open) => !open && close()}
        title="Unblock this user?"
        description={
          <>
            <strong className="font-medium text-foreground">
              {user.fullName}
            </strong>{" "}
            will regain full access to their account.
          </>
        }
        confirmLabel="Unblock user"
        reason={{ label: "Note", placeholder: "Why is the block being lifted?" }}
        onConfirm={(reason) => {
          run(() =>
            setUserStatusAction({ userId: user.id, status: "active", reason: reason }),
          );
        }}
      />

      <ConfirmActionDialog
        open={pending === "suspend"}
        onOpenChange={(open) => !open && close()}
        title="Suspend this user?"
        description={
          <>
            <strong className="font-medium text-foreground">
              {user.fullName}
            </strong>{" "}
            can still sign in and see their account, but cannot invest or
            withdraw while suspended.
          </>
        }
        confirmLabel="Suspend user"
        reason={{
          label: "Reason for suspension",
          required: true,
          presets: [
            "Pending security review",
            "Unusual sign-in activity",
            "Awaiting document re-verification",
          ],
        }}
        onConfirm={(reason) => {
          run(() =>
            setUserStatusAction({ userId: user.id, status: "suspended", reason: reason }),
          );
        }}
      />

      <ConfirmActionDialog
        open={pending === "reactivate"}
        onOpenChange={(open) => !open && close()}
        title="Reactivate this account?"
        description={
          <>
            <strong className="font-medium text-foreground">
              {user.fullName}
            </strong>{" "}
            will return to active status with full access restored.
          </>
        }
        confirmLabel="Reactivate"
        reason={{ label: "Note" }}
        onConfirm={(reason) => {
          run(() =>
            setUserStatusAction({ userId: user.id, status: "active", reason: reason }),
          );
        }}
      />

      <ConfirmActionDialog
        open={pending === "deactivate"}
        onOpenChange={(open) => !open && close()}
        title="Deactivate this account?"
        description={
          <>
            This closes{" "}
            <strong className="font-medium text-foreground">
              {user.fullName}
            </strong>
            &rsquo;s account. Running allocations continue to maturity, but the
            user can no longer sign in. Reversing this needs a master admin.
          </>
        }
        confirmLabel="Deactivate account"
        destructive
        reason={{
          label: "Reason for deactivation",
          required: true,
          presets: [
            "Closure requested by the user",
            "Prolonged inactivity",
            "Compliance decision",
          ],
        }}
        onConfirm={(reason) => {
          run(() =>
            setUserStatusAction({ userId: user.id, status: "deactivated", reason: reason }),
          );
        }}
      />

      {/* ------------------------------------------------------- Holds */}

      <ConfirmActionDialog
        open={pending === "freezeAccount"}
        onOpenChange={(open) => !open && close()}
        title="Freeze this account?"
        description="All movement of funds is halted — no deposits, allocations or withdrawals. The user can still sign in and see their balance."
        confirmLabel="Freeze account"
        destructive
        reason={{ label: "Reason", required: true }}
        onConfirm={(reason) => {
          run(() =>
            setUserRestrictionAction({
              userId: user.id,
              key: "accountFrozen",
              value: true,
              reason: reason,
            }),
          );
        }}
      />
      <ConfirmActionDialog
        open={pending === "unfreezeAccount"}
        onOpenChange={(open) => !open && close()}
        title="Lift the account freeze?"
        description="Deposits, allocations and withdrawals will be available again."
        confirmLabel="Lift freeze"
        reason={{ label: "Note" }}
        onConfirm={(reason) => {
          run(() =>
            setUserRestrictionAction({
              userId: user.id,
              key: "accountFrozen",
              value: false,
              reason: reason,
            }),
          );
        }}
      />

      <ConfirmActionDialog
        open={pending === "freezeWithdrawals"}
        onOpenChange={(open) => !open && close()}
        title="Freeze withdrawals?"
        description="The user keeps full access but cannot request a payout. Existing requests are unaffected."
        confirmLabel="Freeze withdrawals"
        destructive
        reason={{
          label: "Reason",
          required: true,
          presets: [
            "Bank account re-verification required",
            "Pending security review",
            "Beneficiary name mismatch",
          ],
        }}
        onConfirm={(reason) => {
          run(() =>
            setUserRestrictionAction({
              userId: user.id,
              key: "withdrawalsFrozen",
              value: true,
              reason: reason,
            }),
          );
        }}
      />
      <ConfirmActionDialog
        open={pending === "unfreezeWithdrawals"}
        onOpenChange={(open) => !open && close()}
        title="Lift the withdrawal freeze?"
        description="The user will be able to request payouts again."
        confirmLabel="Lift freeze"
        reason={{ label: "Note" }}
        onConfirm={(reason) => {
          run(() =>
            setUserRestrictionAction({
              userId: user.id,
              key: "withdrawalsFrozen",
              value: false,
              reason: reason,
            }),
          );
        }}
      />

      <ConfirmActionDialog
        open={pending === "freezeInvestments"}
        onOpenChange={(open) => !open && close()}
        title="Freeze investments?"
        description="The user cannot create new allocations. Running allocations continue to accrue as normal."
        confirmLabel="Freeze investments"
        destructive
        reason={{
          label: "Reason",
          required: true,
          presets: [
            "Cooling-off period requested by the user",
            "Pending compliance review",
          ],
        }}
        onConfirm={(reason) => {
          run(() =>
            setUserRestrictionAction({
              userId: user.id,
              key: "investmentsFrozen",
              value: true,
              reason: reason,
            }),
          );
        }}
      />
      <ConfirmActionDialog
        open={pending === "unfreezeInvestments"}
        onOpenChange={(open) => !open && close()}
        title="Lift the investment freeze?"
        description="The user will be able to create new allocations again."
        confirmLabel="Lift freeze"
        reason={{ label: "Note" }}
        onConfirm={(reason) => {
          run(() =>
            setUserRestrictionAction({
              userId: user.id,
              key: "investmentsFrozen",
              value: false,
              reason: reason,
            }),
          );
        }}
      />

      {/* --------------------------------------- Credentials & sessions */}

      <ConfirmActionDialog
        open={pending === "resetPassword"}
        onOpenChange={(open) => !open && close()}
        title="Send a password reset?"
        description={
          <>
            A reset link will be emailed to{" "}
            <strong className="font-medium text-foreground">{user.email}</strong>
            . Their current password keeps working until they use it.
          </>
        }
        confirmLabel="Send reset link"
        reason={{ label: "Note" }}
        onConfirm={(reason) => {
          run(() => sendUserPasswordResetAction({ userId: user.id, note: reason }));
        }}
      />

      <ConfirmActionDialog
        open={pending === "resetTwoFactor"}
        onOpenChange={(open) => !open && close()}
        title="Reset two-factor authentication?"
        description="This removes the user's current 2FA enrolment. They will be prompted to set it up again on next sign-in — verify their identity before doing this."
        confirmLabel="Reset 2FA"
        destructive
        reason={{
          label: "How was identity verified?",
          required: true,
          presets: [
            "Verified over a recorded support call",
            "Verified against KYC documents on file",
          ],
        }}
        onConfirm={(reason) => {
          run(() => resetUserTwoFactorAction({ userId: user.id, reason }));
        }}
      />

      <ConfirmActionDialog
        open={pending === "logoutAll"}
        onOpenChange={(open) => !open && close()}
        title="Log out all devices?"
        description={
          <>
            Every active session for{" "}
            <strong className="font-medium text-foreground">
              {user.fullName}
            </strong>{" "}
            will be revoked immediately, including the device they are using
            right now.
          </>
        }
        confirmLabel="Log out all devices"
        destructive
        reason={{
          label: "Reason",
          required: true,
          presets: [
            "Suspected account compromise",
            "Requested by the user",
            "Unrecognised sign-in location",
          ],
        }}
        onConfirm={(reason) => {
          run(() => revokeUserSessionAction({ userId: user.id, reason: reason }));
        }}
      />
    </>
  );
}
