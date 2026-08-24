import type { Metadata } from "next";

import { UserDataProvider } from "@/lib/prototype-store";
import { getUserSlices } from "@/server/services/account.service";

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
  const [plans, slices] = await Promise.all([
    getPlans(),
    getUserSlices(["balance"] as const),
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
