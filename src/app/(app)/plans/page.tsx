import type { Metadata } from "next";

import { UserDataProvider } from "@/lib/prototype-store";
import {
  getUnreadNotificationCount,
  getUserSlices,
} from "@/server/services/account.service";

import { PageContainer } from "@/components/navigation/app-shell";
import { TopBar } from "@/components/navigation/top-bar";
import { PlansBrowser } from "@/components/plans/plans-browser";
import { RateNote, RiskNote } from "@/components/shared/notices";
import { getPlans } from "@/server/services/catalogue.service";

export const metadata: Metadata = {
  title: "Plans",
  description:
    "Browse Nanotron investment plans by term, projected return and risk level.",
};

export default async function PlansPage() {
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
  const [plans, slices] = await Promise.all([
    getPlans(),
    getUserSlices(["balance", "profile"] as const),
    // `TopBar`'s unread badge, in this page's wave rather than a later one.
    getUnreadNotificationCount(),
  ]);


  return (
    <UserDataProvider data={slices}>
      <>
        <TopBar eyebrow="Investment products" title="Plans" />

        <PageContainer className="space-y-5">
          <p className="text-sm leading-relaxed text-muted-foreground">
            Choose a plan that matches how long you can leave funds invested and
            how much variance you are comfortable with. All figures shown are
            estimates.
          </p>

          <PlansBrowser plans={plans} />

          <RiskNote />
          <RateNote />
        </PageContainer>
      </>
  </UserDataProvider>
  );
}
