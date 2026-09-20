import { Suspense } from "react";
import type { Metadata } from "next";

import { UserDataProvider } from "@/lib/prototype-store";
import { getUserSlices } from "@/server/services/account.service";
import { ListSkeleton } from "@/components/shared/page-skeleton";

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

/**
 * The catalogue's framing renders immediately; only the plan cards wait.
 *
 * The intro paragraph and the two notices are fixed copy, and `RiskNote` in
 * particular must never be late — it is the disclosure that sits beside the
 * projected returns.
 */
export default function PlansPage() {
  return (
    <>
      <TopBar eyebrow="Investment products" title="Plans" />

      <PageContainer className="space-y-5">
        <p className="text-sm leading-relaxed text-muted-foreground">
          Choose a plan that matches how long you can leave funds invested and
          how much variance you are comfortable with. All figures shown are
          estimates.
        </p>

        <Suspense fallback={<ListSkeleton rows={3} />}>
          <PlansSection />
        </Suspense>

        <RiskNote />
        <RateNote />
      </PageContainer>
    </>
  );
}

/**
 * The plan cards and the balance the invest sheet checks against.
 *
 * `getPlans()` is catalogue data and usually served from the cross-request
 * cache; the balance is per-account and never is. They are read in one wave.
 */
async function PlansSection() {
  const [plans, slices] = await Promise.all([
    getPlans(),
    getUserSlices(["balance", "profile"] as const),
  ]);

  return (
    <UserDataProvider data={slices}>
      <PlansBrowser plans={plans} />
    </UserDataProvider>
  );
}
