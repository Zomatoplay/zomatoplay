import { Suspense } from "react";
import type { Metadata } from "next";

import { UserDataProvider } from "@/lib/prototype-store";
import { getUserSlices } from "@/server/services/account.service";
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
  Send,
  ShieldAlert,
  ShieldCheck,
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
import { APP_NAME, SUPPORT_EMAIL } from "@/constants/app";
import { getSupportTelegramUrl } from "@/server/services/catalogue.service";

export const metadata: Metadata = {
  title: "Settings",
  description: "Profile, verification, security, notifications and support.",
};

/**
 * Settings renders its whole menu before any database read completes.
 *
 * Everything on this screen except the profile card and the verification
 * badge is fixed: section titles, row labels, descriptions, icons and
 * destinations. It used to await a profile and an unread count before
 * emitting any of it, so the menu — which is what somebody opens Settings to
 * tap — waited on two values it does not render. Measured before the change:
 * the static "Identity verification" row reached the browser at ~910ms.
 *
 * The page is therefore synchronous. The two account-dependent pieces are
 * suspended individually, and `TopBar` suspends its own controls.
 */
export default function SettingsPage() {
  return (
    <>
      <TopBar eyebrow="Your account" title="Settings" showActions={false} />

      <PageContainer className="space-y-5">
          <Suspense fallback={<ProfileHeaderPlaceholder />}>
            <ProfileSection />
          </Suspense>

          <ListGroup title="Verification">
            <Suspense fallback={<KycStatusRowPlaceholder />}>
              <KycStatusSection />
            </Suspense>
          </ListGroup>

          <ListGroup title="Security">
            <ListRow
              href="/settings/security"
              icon={KeyRound}
              title="Sign-in & authentication"
              description="Sign-in method, 2FA and authenticator app"
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
            <Suspense fallback={<ContactSupportPlaceholder />}>
              <ContactSupportRow />
            </Suspense>
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
            {APP_NAME}
          </p>
      </PageContainer>
    </>
  );
}

/** Same row, same height, while the destination is read. */
function ContactSupportPlaceholder() {
  return <ListRow as="div" icon={Send} title="Contact support" description="Telegram" />;
}

/**
 * Support → Contact Support → Telegram, from the destination an operator
 * saved in Admin → Settings → Customer support (`getSupportTelegramUrl`, cached
 * across requests with the catalogue). Unconfigured, the row says so instead
 * of linking somewhere that does not exist.
 */
async function ContactSupportRow() {
  const url = await getSupportTelegramUrl();
  if (!url) {
    return (
      <ListRow
        as="div"
        icon={Send}
        title="Contact support"
        description={
          SUPPORT_EMAIL
            ? `Telegram support is currently unavailable. Email ${SUPPORT_EMAIL}.`
            : "Telegram support is currently unavailable."
        }
      />
    );
  }
  return (
    <ListRow
      href={url}
      external
      icon={Send}
      title="Contact support"
      description="Chat with us on Telegram"
      meta={<span className="text-sm text-muted-foreground">Telegram</span>}
    />
  );
}

/**
 * The profile card and the verification badge, which are the only two things
 * here that belong to the account.
 *
 * One read serves both, and it is request-memoised, so the two boundaries
 * below cost one round trip between them rather than two.
 */
async function ProfileSection() {
  const slices = await getUserSlices(["profile"] as const);
  return (
    <UserDataProvider data={slices}>
      <ProfileHeader />
    </UserDataProvider>
  );
}

async function KycStatusSection() {
  const slices = await getUserSlices(["profile"] as const);
  return (
    <UserDataProvider data={slices}>
      <KycStatusRow />
    </UserDataProvider>
  );
}

/**
 * Holds the profile card's shape without inventing its contents.
 *
 * No name, no email, no user id and no verification badge — a placeholder
 * identity is worse than an obviously-loading one, and a fabricated
 * verification state is the exact class of thing this codebase refuses to
 * render (CLAUDE.md §23).
 */
function ProfileHeaderPlaceholder() {
  return (
    <section
      className="rounded-2xl border border-border bg-card p-5"
      aria-busy="true"
      aria-label="Loading your profile"
    >
      <div className="flex items-start gap-4">
        <div className="size-14 shrink-0 animate-pulse rounded-full bg-secondary" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="h-5 w-40 animate-pulse rounded bg-secondary" />
          <div className="h-4 w-52 animate-pulse rounded bg-secondary" />
          <div className="h-5 w-24 animate-pulse rounded-full bg-secondary" />
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-4">
        <div className="space-y-1.5">
          <div className="h-3 w-14 animate-pulse rounded bg-secondary" />
          <div className="h-4 w-28 animate-pulse rounded bg-secondary" />
        </div>
      </div>
    </section>
  );
}

/** The verification row, with its label but without claiming a status. */
function KycStatusRowPlaceholder() {
  return (
    <ListRow
      href="/settings/kyc"
      icon={ShieldCheck}
      title="Identity verification"
      description="Required before investing or withdrawing"
      meta={
        <span
          className="block h-5 w-16 animate-pulse rounded-full bg-secondary"
          aria-label="Loading verification status"
        />
      }
    />
  );
}
