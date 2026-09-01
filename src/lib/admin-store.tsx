"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

import type {
  AdminShellData,
  AdminSliceData,
} from "@/server/services/admin.service";
import type {
  AdminAgent,
  AdminCommissionEntry,
  AdminDeposit,
  AdminInvestment,
  AdminNotificationCampaign,
  AdminPlan,
  AdminReferralAccount,
  AdminSession,
  AdminUser,
  AdminWithdrawal,
  AuditLogEntry,
  KycSubmission,
  PipelineEvent,
  PlatformSettings,
  UserDeviceSession,
  UserSecurityEvent,
} from "@/types/admin";

/**
 * The platform, as the server last read it for this operator.
 *
 * WHAT THIS IS NOW
 * ----------------
 * A read cache and a session holder. Nothing here mutates platform state, and
 * there is no action on the context that could — every operator decision is a
 * server action that opens a transaction, checks the operator's permission
 * against the database, writes its audit entry in the same transaction, and
 * ends with `router.refresh()`.
 *
 * WHAT IT USED TO BE
 * ------------------
 * A 1,247-line reducer with twenty-two mutating cases. Approving a KYC
 * submission, crediting a deposit, rejecting a withdrawal, blocking an account,
 * editing a plan, sending a campaign — all of them rewrote a JavaScript object
 * and appended a convincing entry to an in-memory audit log. None of it reached
 * PostgreSQL, none of it reached the user application, and all of it vanished
 * on reload. The audit log was the worst of it: it described decisions that had
 * never been recorded anywhere.
 *
 * THE SESSION IS NOT CHOSEN HERE ANY MORE
 * ---------------------------------------
 * `session` arrives from the server, resolved from a verified Supabase
 * principal through `admin_agents.auth_user_id`. It used to be picked from a
 * dropdown in the header, which meant the permission model was enforced against
 * whichever operator the browser claimed to be.
 *
 * TWO PROVIDERS, AND WHY
 * ----------------------
 * `AdminStoreProvider` sits in the console layout and holds what the frame
 * needs. `AdminDataProvider` sits in each *page* and holds that page's slice.
 * The split is what keeps the console fresh: Next.js re-renders only changed
 * route segments on a client navigation, so a layout does not run again — data
 * read there is frozen at the moment the console was opened. A page segment
 * does re-render, and it re-reads.
 *
 * Both are plain context over server-rendered props. No effects, so no
 * empty-then-populated flash and no window where the screen disagrees with the
 * server.
 */

interface AdminStoreValue {
  /** The signed-in operator. Server-resolved; never client-selected. */
  session: AdminSession;
  settings: PlatformSettings;

  users: AdminUser[];
  kyc: KycSubmission[];
  deposits: AdminDeposit[];
  withdrawals: AdminWithdrawal[];
  plans: AdminPlan[];
  agents: AdminAgent[];
  sessions: UserDeviceSession[];
  campaigns: AdminNotificationCampaign[];
  auditLog: AuditLogEntry[];
  pipelineEvents: PipelineEvent[];
  investments: AdminInvestment[];
  referralAccounts: AdminReferralAccount[];
  commissionLedger: AdminCommissionEntry[];
  securityEvents: UserSecurityEvent[];
}

const EMPTY: Omit<AdminStoreValue, "session" | "settings"> = {
  users: [],
  kyc: [],
  deposits: [],
  withdrawals: [],
  plans: [],
  agents: [],
  sessions: [],
  campaigns: [],
  auditLog: [],
  pipelineEvents: [],
  investments: [],
  referralAccounts: [],
  commissionLedger: [],
  securityEvents: [],
};

const ShellContext = createContext<{
  session: AdminSession;
  shell: AdminShellData;
} | null>(null);

const DataContext = createContext<AdminSliceData>({});

export function AdminStoreProvider({
  session,
  shell,
  children,
}: {
  session: AdminSession;
  shell: AdminShellData;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ session, shell }), [session, shell]);
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

/**
 * A page's own data.
 *
 * Rendered by the page, around its view. Whatever a page does not provide stays
 * empty rather than being overwritten — the deposits screen has no opinion
 * about the KYC queue and must not clear it on the way past.
 */
export function AdminDataProvider({
  data,
  children,
}: {
  data: AdminSliceData;
  children: ReactNode;
}) {
  return <DataContext.Provider value={data}>{children}</DataContext.Provider>;
}

export function useAdminStore(): AdminStoreValue {
  const shell = useContext(ShellContext);
  const data = useContext(DataContext);

  if (!shell) {
    throw new Error("useAdminStore must be used inside <AdminStoreProvider>.");
  }

  return useMemo(
    () => ({
      ...EMPTY,
      // The shell carries only what the *frame* needs. Everything else — the
      // operator directory included — is the page's own slice, so a screen that
      // needs it reads a fresh copy rather than one frozen when the console was
      // opened. See `getAdminShell`.
      settings: data.settings ?? shell.shell.settings,
      session: shell.session,
      ...stripUndefined(data),
    }),
    [shell, data],
  );
}

/** `{ kyc: undefined }` must not blank the default it is spread over. */
function stripUndefined(data: AdminSliceData): Partial<AdminSliceData> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) result[key] = value;
  }
  return result as Partial<AdminSliceData>;
}

/** The operator alone, for components that need nothing else. */
export function useAdminSession(): AdminSession {
  const shell = useContext(ShellContext);
  if (!shell) {
    throw new Error("useAdminSession must be used inside <AdminStoreProvider>.");
  }
  return shell.session;
}
