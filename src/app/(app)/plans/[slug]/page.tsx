import type { Metadata } from "next";

import { UserDataProvider } from "@/lib/prototype-store";
import { getUserSlices } from "@/server/services/account.service";
import { notFound } from "next/navigation";
import { CircleCheck, Info } from "lucide-react";

import { PageContainer } from "@/components/navigation/app-shell";
import { InvestSheet } from "@/components/plans/invest-sheet";
import { RiskIndicator } from "@/components/plans/risk-indicator";
import { InfoRow } from "@/components/shared/info-row";
import { RateNote } from "@/components/shared/notices";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { rewardFrequencyLabels, riskDescriptions } from "@/data/plans";
import { formatUsdt, formatUsdtAsInr } from "@/lib/currency";
import { getPlanBySlug, getPlans } from "@/server/services/catalogue.service";

/**
 * Pre-render every plan page. The catalogue is content, not account state, so
 * it is still worth generating ahead of time — with a database configured the
 * pages render dynamically instead, because an operator's edit should reach the
 * app without a rebuild.
 */
export async function generateStaticParams() {
  const plans = await getPlans();
  return plans.map((plan) => ({ slug: plan.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const plan = await getPlanBySlug(slug);
  if (!plan) return { title: "Plan not found" };
  return { title: plan.name, description: plan.description };
}

function Bullets({ items, icon }: { items: string[]; icon?: "check" }) {
  return (
    <ul className="space-y-2.5">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-2.5">
          {icon === "check" ? (
            <CircleCheck
              className="mt-0.5 size-4 shrink-0 text-brand"
              aria-hidden
            />
          ) : (
            <span
              className="mt-[0.45rem] size-1.5 shrink-0 rounded-full bg-muted-foreground"
              aria-hidden
            />
          )}
          <span className="text-sm leading-relaxed text-muted-foreground">
            {item}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default async function PlanDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [plan, slices] = await Promise.all([
    getPlanBySlug(slug),
    getUserSlices(["balance"] as const),
  ]);
  if (!plan) notFound();

  const [low, high] = plan.estimatedReturnRange;


  return (
    <UserDataProvider data={slices}>
      <>
        <PageHeader title={plan.name} backHref="/plans" backLabel="Back to plans" />

        <PageContainer className="space-y-5">
          {/* Overview */}
          <section className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge kind="plan" status={plan.status} />
              <RiskIndicator risk={plan.risk} />
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {plan.description}
            </p>
          </section>

          {/* Headline projection */}
          <Card className="p-5">
            <p className="text-xs font-medium text-muted-foreground">
              Estimated total return over the term
            </p>
            <p className="tabular mt-1 text-[2.125rem] font-semibold leading-10 tracking-tight text-positive">
              {plan.estimatedReturnPercent}%
            </p>
            <p className="tabular mt-1 text-xs text-muted-foreground">
              Projected range {low}%–{high}%. These are estimates based on strategy
              modelling and are not guaranteed.
            </p>

            <div className="mt-4 grid grid-cols-3 gap-3 border-t border-border pt-4">
              {plan.highlights.map((highlight) => (
                <div key={highlight.label} className="min-w-0">
                  <p className="truncate text-[11px] font-medium text-muted-foreground">
                    {highlight.label}
                  </p>
                  <p className="tabular mt-0.5 truncate text-sm font-semibold">
                    {highlight.value}
                  </p>
                </div>
              ))}
            </div>
          </Card>

          {plan.status === "limited" && plan.capacityFilledPercent !== undefined ? (
            <div className="space-y-1.5 rounded-2xl border border-border bg-card p-4">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium">Cohort capacity</span>
                <span className="tabular text-muted-foreground">
                  {plan.capacityFilledPercent}% allocated
                </span>
              </div>
              <Progress
                value={plan.capacityFilledPercent}
                indicatorClassName="bg-warning"
                aria-label="Cohort capacity filled"
              />
            </div>
          ) : null}

          {/* Key figures */}
          <section className="space-y-3">
            <h2 className="text-base font-semibold tracking-tight">Key details</h2>
            <div className="divide-y divide-border rounded-2xl border border-border bg-card px-4">
              <InfoRow
                label="Minimum"
                value={formatUsdt(plan.minInvestment)}
                hint={formatUsdtAsInr(plan.minInvestment)}
              />
              <InfoRow
                label="Maximum"
                value={formatUsdt(plan.maxInvestment)}
                hint={formatUsdtAsInr(plan.maxInvestment)}
              />
              <InfoRow
                label="Duration"
                value={
                  plan.durationDays === 0
                    ? "No lock-in"
                    : `${plan.durationDays} days`
                }
              />
              <InfoRow
                label="Reward frequency"
                value={rewardFrequencyLabels[plan.rewardFrequency]}
              />
              <InfoRow label="Early exit" value={plan.earlyExit} />
            </div>
          </section>

          {/* How it works */}
          <section className="space-y-3">
            <h2 className="text-base font-semibold tracking-tight">How it works</h2>
            <ol className="space-y-3">
              {plan.howItWorks.map((step, index) => (
                <li key={step} className="flex items-start gap-3">
                  <span className="tabular mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand">
                    {index + 1}
                  </span>
                  <span className="text-sm leading-relaxed text-muted-foreground">
                    {step}
                  </span>
                </li>
              ))}
            </ol>
          </section>

          {/* Conditions */}
          <section className="space-y-3">
            <h2 className="text-base font-semibold tracking-tight">
              Important conditions
            </h2>
            <Bullets items={plan.conditions} icon="check" />
          </section>

          {/* Risk */}
          <section className="space-y-3">
            <h2 className="text-base font-semibold tracking-tight">Risk information</h2>
            <div className="rounded-2xl border border-border bg-secondary/50 p-4">
              <div className="flex items-center gap-2">
                <RiskIndicator risk={plan.risk} showLabel={false} />
                <span className="text-sm font-medium">
                  {riskDescriptions[plan.risk]}
                </span>
              </div>
              <div className="mt-3 border-t border-border pt-3">
                <Bullets items={plan.riskNotes} />
              </div>
            </div>
            <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
              <Info className="mt-px size-3 shrink-0" aria-hidden />
              <span>
                This is a demo build. No investment is actually created and no funds
                are moved.
              </span>
            </p>
          </section>

          <RateNote />

          {/* Reserves the height of the fixed action bar below, on top of the
              bottom-navigation space `PageContainer` already reserves. */}
          <div className="h-20" aria-hidden />
        </PageContainer>

        {/* Sticky invest action — always reachable without scrolling to the end. */}
        <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] z-30 border-t border-border bg-background/95 px-4 py-3 backdrop-blur-md lg:bottom-0 lg:left-64">
          <div className="mx-auto w-full max-w-2xl">
            <InvestSheet plan={plan} />
          </div>
        </div>
      </>
  </UserDataProvider>
  );
}
