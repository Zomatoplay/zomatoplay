"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

import type { UserSliceData } from "@/server/services/account.service";
import type {
  AppNotification,
  Investment,
  KycStatus,
  NotificationCategory,
  NotificationPreference,
  Transaction,
  UserProfile,
  WalletBalance,
} from "@/types";

/**
 * The signed-in account, as the server last read it.
 *
 * A **cache**, and only a cache. Nothing here changes business state; every
 * mutation is a server action against PostgreSQL, and the screens re-read after
 * `router.refresh()`.
 *
 * TWO PROVIDERS, AND WHY
 * ----------------------
 * `PrototypeStoreProvider` sits in the route-group layout and holds the one
 * thing every screen's chrome needs: the profile. `UserDataProvider` sits in
 * each *page* and holds that page's slices.
 *
 * The split is a performance decision with a measured cause. The layout used to
 * fetch six slices — balance, allocations, transactions, notifications,
 * preferences and the profile — on every navigation, including screens that
 * rendered none of them. Against a five-connection pool that is two waves of
 * ~200ms round trips, and `/settings/kyc`, which needs a single status field,
 * cost 2,048ms. It is the same mistake the CRM had, fixed the same way.
 *
 * WHY A MISSING SLICE THROWS
 * --------------------------
 * A page that forgets to provide `balance` could be given a zero instead. For a
 * wallet that is not a missing value, it is a **wrong** one — and a plausible
 * wrong number about money is the worst thing this application can render. So
 * reading an unprovided slice raises immediately, naming the slice, rather than
 * defaulting to something that looks like an answer.
 */

interface StoreValue {
  profile: UserProfile;
  kycStatus: KycStatus;
  twoFactorEnabled: boolean;
  googleAuthEnabled: boolean;
  balance: WalletBalance;
  investments: Investment[];
  transactions: Transaction[];
  notifications: AppNotification[];
  notificationCategories: NotificationPreference[];
  notificationPrefs: Record<NotificationCategory, boolean>;
  activeInvestments: Investment[];
  completedInvestments: Investment[];
  unreadNotificationCount: number;
  isVerified: boolean;
}

const MountedContext = createContext(false);
const DataContext = createContext<UserSliceData>({});

/**
 * Marks the user application's frame.
 *
 * Holds no data. It exists so `usePrototypeStore()` can tell "you are outside
 * the user application" (a wiring mistake) from "this page did not provide that
 * slice" (a different wiring mistake) and say which.
 */
export function PrototypeStoreProvider({ children }: { children: ReactNode }) {
  return <MountedContext.Provider value={true}>{children}</MountedContext.Provider>;
}

/**
 * A page's own data.
 *
 * Rendered by the page, around its view. Whatever a page does not provide stays
 * absent rather than empty — see the note above on why that matters.
 */
export function UserDataProvider({
  data,
  children,
}: {
  data: UserSliceData;
  children: ReactNode;
}) {
  return <DataContext.Provider value={data}>{children}</DataContext.Provider>;
}

function missing(slice: keyof UserSliceData): never {
  throw new Error(
    `This screen read "${slice}" but its page did not provide it. Fetch it in ` +
      `the page with getUserSlices([...]) and pass it to <UserDataProvider>. ` +
      `It is not defaulted, because a made-up balance is worse than an error.`,
  );
}

export function usePrototypeStore(): StoreValue {
  const mounted = useContext(MountedContext);
  const data = useContext(DataContext);

  if (!mounted) {
    throw new Error(
      "usePrototypeStore must be used inside <PrototypeStoreProvider>.",
    );
  }

  return useMemo(() => {
    const investments = data.investments;
    const notificationCategories = data.notificationPreferences;

    return {
      get profile() {
        return data.profile ?? missing("profile");
      },
      get kycStatus() {
        return (data.profile ?? missing("profile")).kycStatus;
      },
      get twoFactorEnabled() {
        return (data.profile ?? missing("profile")).twoFactorEnabled;
      },
      get googleAuthEnabled() {
        return (data.profile ?? missing("profile")).googleAuthEnabled;
      },
      // Getters, so a screen that never touches a slice never triggers its
      // absence — only actually reading one it was not given raises.
      get balance() {
        return data.balance ?? missing("balance");
      },
      get investments() {
        return investments ?? missing("investments");
      },
      get transactions() {
        return data.transactions ?? missing("transactions");
      },
      get notifications() {
        return data.notifications ?? missing("notifications");
      },
      get notificationCategories() {
        return notificationCategories ?? missing("notificationPreferences");
      },
      get notificationPrefs() {
        return Object.fromEntries(
          (notificationCategories ?? missing("notificationPreferences")).map(
            (pref) => [pref.id, pref.enabled],
          ),
        ) as Record<NotificationCategory, boolean>;
      },
      get activeInvestments() {
        return (investments ?? missing("investments")).filter(
          (i) => i.status === "active",
        );
      },
      get completedInvestments() {
        return (investments ?? missing("investments")).filter(
          (i) => i.status === "completed",
        );
      },
      get unreadNotificationCount() {
        return (data.notifications ?? []).filter((n) => !n.read).length;
      },
      get isVerified() {
        return (data.profile ?? missing("profile")).kycStatus === "verified";
      },
    } as StoreValue;
  }, [data]);
}
