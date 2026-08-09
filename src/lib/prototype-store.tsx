"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  type ReactNode,
} from "react";

import { activeInvestments, investments as seedInvestments } from "@/data/investments";
import { notificationPreferences } from "@/data/notifications";
import { transactions as seedTransactions } from "@/data/transactions";
import { currentUser, walletBalance } from "@/data/user";
import type {
  DepositNetworkId,
  Investment,
  KycStatus,
  NotificationCategory,
  Plan,
  Transaction,
  WalletBalance,
} from "@/types";

/**
 * In-memory prototype state.
 *
 * WHY THIS EXISTS
 * ---------------
 * The brief is frontend-only, but the deposit / withdraw / invest / KYC flows
 * have to actually *do* something for the UI to be reviewable. This store holds
 * the small slice of state a real backend would own, seeded from `@/data`.
 *
 * SCOPE
 * -----
 * - Deliberately in-memory: state resets on reload. No persistence layer is
 *   introduced that would later have to be unwound.
 * - Only genuinely mutable account state lives here. Static catalogue content
 *   (plans, VIP levels, FAQs, legal copy) stays in server components.
 *
 * INTEGRATION POINT
 * -----------------
 * Each action below maps 1:1 to a future API call. Replace the reducer cases
 * with server actions / mutations plus `router.refresh()`, and the components
 * consuming this context keep working unchanged.
 */

interface State {
  kycStatus: KycStatus;
  balance: WalletBalance;
  investments: Investment[];
  transactions: Transaction[];
  notificationPrefs: Record<NotificationCategory, boolean>;
  twoFactorEnabled: boolean;
  googleAuthEnabled: boolean;
}

type Action =
  | { type: "kyc/start" }
  | { type: "kyc/submit" }
  | { type: "kyc/approve" }
  | {
      type: "deposit/credit";
      payload: { amount: number; network: DepositNetworkId; reference: string };
    }
  | {
      type: "withdrawal/request";
      payload: { amountUsdt: number; feeUsdt: number; netInr: number; destination: string };
    }
  | { type: "investment/create"; payload: { plan: Plan; amount: number } }
  | { type: "notifications/toggle"; payload: { id: NotificationCategory } }
  | { type: "security/set2fa"; payload: { enabled: boolean } }
  | { type: "security/setGoogleAuth"; payload: { enabled: boolean } }
  | { type: "reset" };

const seedPrefs = Object.fromEntries(
  notificationPreferences.map((pref) => [pref.id, pref.enabled]),
) as Record<NotificationCategory, boolean>;

const initialState: State = {
  kycStatus: currentUser.kycStatus,
  balance: walletBalance,
  investments: seedInvestments,
  transactions: seedTransactions,
  notificationPrefs: seedPrefs,
  twoFactorEnabled: currentUser.twoFactorEnabled,
  googleAuthEnabled: currentUser.googleAuthEnabled,
};

/** Monotonic ids for records created during a session. */
let sequence = 0;
function nextId(prefix: string) {
  sequence += 1;
  return `${prefix}_local_${sequence}`;
}

function addDays(from: Date, days: number) {
  const next = new Date(from);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString();
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "kyc/start":
      return state.kycStatus === "not_started"
        ? { ...state, kycStatus: "in_progress" }
        : state;

    case "kyc/submit":
      return { ...state, kycStatus: "pending_review" };

    /** Stands in for the provider's webhook approving the submission. */
    case "kyc/approve":
      return { ...state, kycStatus: "verified" };

    case "deposit/credit": {
      const { amount, network, reference } = action.payload;
      const transaction: Transaction = {
        id: nextId("tx"),
        type: "deposit",
        amount,
        currency: "USDT",
        status: "completed",
        date: new Date().toISOString(),
        description: "Deposit received",
        reference,
        network,
        confirmations: { current: 20, required: 20 },
      };
      return {
        ...state,
        balance: {
          ...state.balance,
          available: state.balance.available + amount,
          totalDeposited: state.balance.totalDeposited + amount,
        },
        transactions: [transaction, ...state.transactions],
      };
    }

    case "withdrawal/request": {
      const { amountUsdt, feeUsdt, netInr, destination } = action.payload;
      const transaction: Transaction = {
        id: nextId("tx"),
        type: "withdrawal",
        amount: -amountUsdt,
        currency: "USDT",
        status: "processing",
        date: new Date().toISOString(),
        description: `Withdrawal to ${destination}`,
        reference: `WD-${90000 + sequence}`,
        inrAmount: netInr,
        feeUsdt,
      };
      return {
        ...state,
        balance: {
          ...state.balance,
          available: state.balance.available - amountUsdt,
          totalWithdrawn: state.balance.totalWithdrawn + amountUsdt,
        },
        transactions: [transaction, ...state.transactions],
      };
    }

    case "investment/create": {
      const { plan, amount } = action.payload;
      const now = new Date();
      const investment: Investment = {
        id: nextId("inv"),
        planId: plan.id,
        planName: plan.name,
        amount,
        profit: 0,
        projectedProfit: (amount * plan.estimatedReturnPercent) / 100,
        startDate: now.toISOString(),
        endDate: addDays(now, plan.durationDays),
        durationDays: plan.durationDays,
        elapsedDays: 0,
        status: "active",
        rewardFrequency: plan.rewardFrequency,
        nextRewardDate: addDays(
          now,
          plan.rewardFrequency === "daily"
            ? 1
            : plan.rewardFrequency === "weekly"
              ? 7
              : plan.rewardFrequency === "monthly"
                ? 30
                : plan.durationDays,
        ),
        nextRewardAmount:
          plan.rewardFrequency === "on_maturity"
            ? (amount * plan.estimatedReturnPercent) / 100
            : null,
        risk: plan.risk,
      };
      const transaction: Transaction = {
        id: nextId("tx"),
        type: "investment",
        amount: -amount,
        currency: "USDT",
        status: "completed",
        date: now.toISOString(),
        description: `Allocation · ${plan.name}`,
        reference: investment.id,
      };
      return {
        ...state,
        balance: {
          ...state.balance,
          available: state.balance.available - amount,
          totalInvested: state.balance.totalInvested + amount,
          lockedInInvestments: state.balance.lockedInInvestments + amount,
        },
        investments: [investment, ...state.investments],
        transactions: [transaction, ...state.transactions],
      };
    }

    case "notifications/toggle":
      return {
        ...state,
        notificationPrefs: {
          ...state.notificationPrefs,
          [action.payload.id]: !state.notificationPrefs[action.payload.id],
        },
      };

    case "security/set2fa":
      return { ...state, twoFactorEnabled: action.payload.enabled };

    case "security/setGoogleAuth":
      return { ...state, googleAuthEnabled: action.payload.enabled };

    case "reset":
      return initialState;
  }
}

interface StoreValue extends State {
  activeInvestments: Investment[];
  completedInvestments: Investment[];
  isVerified: boolean;
  startKyc: () => void;
  submitKyc: () => void;
  approveKyc: () => void;
  creditDeposit: (payload: {
    amount: number;
    network: DepositNetworkId;
    reference: string;
  }) => void;
  requestWithdrawal: (payload: {
    amountUsdt: number;
    feeUsdt: number;
    netInr: number;
    destination: string;
  }) => void;
  createInvestment: (plan: Plan, amount: number) => void;
  toggleNotification: (id: NotificationCategory) => void;
  setTwoFactor: (enabled: boolean) => void;
  setGoogleAuth: (enabled: boolean) => void;
  reset: () => void;
}

const PrototypeStoreContext = createContext<StoreValue | null>(null);

export function PrototypeStoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const createInvestment = useCallback(
    (plan: Plan, amount: number) =>
      dispatch({ type: "investment/create", payload: { plan, amount } }),
    [],
  );

  const value = useMemo<StoreValue>(
    () => ({
      ...state,
      activeInvestments: state.investments.filter((i) => i.status === "active"),
      completedInvestments: state.investments.filter((i) => i.status === "completed"),
      isVerified: state.kycStatus === "verified",
      startKyc: () => dispatch({ type: "kyc/start" }),
      submitKyc: () => dispatch({ type: "kyc/submit" }),
      approveKyc: () => dispatch({ type: "kyc/approve" }),
      creditDeposit: (payload) => dispatch({ type: "deposit/credit", payload }),
      requestWithdrawal: (payload) =>
        dispatch({ type: "withdrawal/request", payload }),
      createInvestment,
      toggleNotification: (id) =>
        dispatch({ type: "notifications/toggle", payload: { id } }),
      setTwoFactor: (enabled) =>
        dispatch({ type: "security/set2fa", payload: { enabled } }),
      setGoogleAuth: (enabled) =>
        dispatch({ type: "security/setGoogleAuth", payload: { enabled } }),
      reset: () => dispatch({ type: "reset" }),
    }),
    [state, createInvestment],
  );

  return (
    <PrototypeStoreContext.Provider value={value}>
      {children}
    </PrototypeStoreContext.Provider>
  );
}

export function usePrototypeStore() {
  const context = useContext(PrototypeStoreContext);
  if (!context) {
    throw new Error(
      "usePrototypeStore must be used inside <PrototypeStoreProvider>.",
    );
  }
  return context;
}

/** Seed values, for server components that render the initial view. */
export const seedState = {
  activeInvestments,
  balance: walletBalance,
};
