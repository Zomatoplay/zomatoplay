import type { Metadata } from "next";

import { UserDataProvider } from "@/lib/prototype-store";
import {
  getUnreadNotificationCount,
  getUserSlices,
} from "@/server/services/account.service";
import {
  Bell,
  BookOpen,
  Building2,
  FileText,
  Globe,
  History,
  KeyRound,
  LifeBuoy,
  Network,
  ScrollText,
  ShieldAlert,
  Smartphone,
  TrendingUp,
  Wallet,
} from "lucide-react";

import { PageContainer } from "@/components/navigation/app-shell";
import { TopBar } from "@/components/navigation/top-bar";
import { ListGroup, ListRow } from "@/components/shared/list-row";
import { KycStatusRow } from "@/components/settings/kyc-status-row";
import { AccountActions } from "@/components/settings/logout-button";
import { ProfileHeader } from "@/components/settings/profile-header";
import { APP_NAME } from "@/constants/app";

export const metadata: Metadata = {
  title: "Settings",
  description: "Profile, verification, security, notifications and support.",
};

export default async function SettingsPage() {
  /*
   * `profile` and the unread count are read here for `TopBar`, not for this
   * page.
   *
   * `TopBar` is an async server component in the tree this page *returns*, so
   * its own reads cannot begin until this function has already resolved — a
   * whole extra round trip (~400ms) tacked onto the end of every one of the
   * five primary sections. Naming the slices here puts them in the same wave as
   * everything else; the reads are request-memoised, so `TopBar` awaiting them
   * a moment later costs nothing.
   */
  const [slices] = await Promise.all([
    getUserSlices(["profile"] as const),
    // `TopBar`'s unread badge, in this page's wave rather than a later one.
    getUnreadNotificationCount(),
  ]);

  return (
    <UserDataProvider data={slices}>
      <>
        <TopBar eyebrow="Your account" title="Settings" showActions={false} />

        <PageContainer className="space-y-5">
          <ProfileHeader />

          <ListGroup title="Verification">
            <KycStatusRow />
          </ListGroup>

          <ListGroup title="Security">
            <ListRow
              href="/settings/security"
              icon={KeyRound}
              title="Password & authentication"
              description="Change password, 2FA and authenticator app"
            />
            <ListRow
              href="/settings/security#activity"
              icon={Smartphone}
              title="Login & security activity"
              description="Recent sign-ins and account events"
            />
          </ListGroup>

          <ListGroup title="Wallet">
            <ListRow
              href="/settings/wallet"
              icon={Wallet}
              title="Saved wallet addresses"
              description="Withdrawal destinations and network preferences"
            />
            <ListRow
              href="/settings/wallet#banks"
              icon={Building2}
              title="Bank accounts"
              description="Where INR withdrawals are paid"
            />
            <ListRow
              href="/settings/wallet#preferences"
              icon={Network}
              title="Withdrawal preferences"
              description="Default network and confirmation settings"
            />
          </ListGroup>

          <ListGroup title="Investments">
            <ListRow
              href="/settings/investments"
              icon={TrendingUp}
              title="Active investments"
              description="Everything currently allocated"
            />
            <ListRow
              href="/settings/investments#history"
              icon={History}
              title="Investment history"
              description="Matured and closed allocations"
            />
            <ListRow
              href="/settings/investments#rewards"
              icon={ScrollText}
              title="Profit & reward history"
              description="Every reward credited to your balance"
            />
          </ListGroup>

          <ListGroup title="Preferences">
            <ListRow
              href="/settings/notifications"
              icon={Bell}
              title="Notifications"
              description="Choose what you are alerted about"
            />
            <ListRow
              href="/settings/language"
              icon={Globe}
              title="Language"
              meta={<span className="text-sm text-muted-foreground">English</span>}
            />
          </ListGroup>

          <ListGroup title="Support">
            <ListRow
              href="/settings/support"
              icon={LifeBuoy}
              title="Help centre"
              description="Guides, FAQs and contact options"
            />
            <ListRow
              href="/settings/support#tickets"
              icon={BookOpen}
              title="Support tickets"
              description="Track your conversations with us"
            />
          </ListGroup>

          <ListGroup title="Legal">
            <ListRow
              href="/settings/legal/terms"
              icon={FileText}
              title="Terms & Conditions"
            />
            <ListRow
              href="/settings/legal/privacy"
              icon={FileText}
              title="Privacy Policy"
            />
            <ListRow
              href="/settings/legal/risk"
              icon={ShieldAlert}
              title="Risk Disclosure"
            />
          </ListGroup>

          <AccountActions />

          <p className="px-1 pb-2 text-center text-[11px] leading-relaxed text-muted-foreground">
            {APP_NAME} · demo build
            <br />
            Sample data only. No real funds are held, invested or transferred.
          </p>
        </PageContainer>
      </>
  </UserDataProvider>
  );
}
