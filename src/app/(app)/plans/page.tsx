import type { Metadata } from "next";

import { PageContainer } from "@/components/navigation/app-shell";
import { TopBar } from "@/components/navigation/top-bar";
import { PlansBrowser } from "@/components/plans/plans-browser";
import { RateNote, RiskNote } from "@/components/shared/notices";
import { plans } from "@/data/plans";

export const metadata: Metadata = {
  title: "Plans",
  description:
    "Browse Nanotron investment plans by term, projected return and risk level.",
};

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

        <PlansBrowser plans={plans} />

        <RiskNote />
        <RateNote />
      </PageContainer>
    </>
  );
}
