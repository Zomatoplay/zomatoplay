import type { Metadata } from "next";

import { UserDataProvider } from "@/lib/prototype-store";
import { getUserSlices } from "@/server/services/account.service";
import { notFound } from "next/navigation";
import { CircleCheck, Info } from "lucide-react";

import { PageContainer } from "@/components/navigation/app-shell";
import { AllocationReadiness } from "@/components/plans/allocation-readiness";
import { InvestSheet } from "@/components/plans/invest-sheet";
import { RiskIndicator } from "@/components/plans/risk-indicator";
import { InfoRow } from "@/components/shared/info-row";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { rewardFrequencyLabels, riskDescriptions } from "@/data/plans";
import { formatUsdt } from "@/lib/currency";
import { getPlanBySlug } from "@/server/services/catalogue.service";

/**
 * Pre-render every plan page. The catalogue is content, not account state, so
 * it is still worth generating ahead of time — with a database configured the
 * pages render dynamically instead, because an operator's edit should reach the
 * app without a rebuild.
 */
/*
 * `generateStaticParams` was removed, deliberately.
 *
 * This route lives under `(app)`, which is `force-dynamic` — every page below
 * it renders per request for a signed-in account. Prerendering the slugs
 * therefore produced nothing that was ever used, while adding a database query
 * to `next build`.
 *
 * That query is not free: it made the build depend on the database being
 * reachable *at build time*, and it failed exactly that way —
 * `CONNECT_TIMEOUT` while collecting page data, on a cold pool against a
 * distant database. A deployment that cannot ship because a query was slow is
 * a fragility with nothing on the other side of the trade.
 */

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
  /*
   * `profile` as well as `balance`, because `InvestSheet` reads both.
   *
   * The slice list is a page's declaration of what its whole subtree consumes,
   * and it had been trimmed to `balance` alone while the sheet still read
   * `isVerified` — which resolves through `profile`. The store refuses an
   * unprovided slice rather than defaulting it (see `missing()` in
   * `prototype-store`), so every plan detail page threw on render. That refusal
   * is correct and stays: a fabricated verification state on the screen that
   * takes money is worse than a crash. What was wrong was the declaration.
   *
   * Both are read in the same wave as the plan, so this costs no extra round
   * trip — `getUserSlices` resolves its loaders with `Promise.all`.
   */
  const [plan, slices] = await Promise.all([
    getPlanBySlug(slug),
    getUserSlices(["balance", "profile"] as const),
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
              />
              <InfoRow
                label="Maximum"
                value={formatUsdt(plan.maxInvestment)}
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

          {/* What this account can actually do with the plan */}
          <AllocationReadiness />

          {/* Rate tiers */}
          {plan.rateTiers.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-base font-semibold tracking-tight">
                Rate by allocation amount
              </h2>
              <p className="text-sm leading-relaxed text-muted-foreground">
                The projected return depends on how much you allocate. The rate
                that applies is the one whose band your amount falls into — the
                lower figure is included, the upper one is not, so exactly{" "}
                {formatUsdt(plan.rateTiers[0].maxAmountUsdt ?? plan.minInvestment, {
                  withSymbol: false,
                })}{" "}
                USDT falls into the next band up. Every figure is an estimated
                total return over the plan&rsquo;s term and is not guaranteed.
              </p>
              {/*
                A real table, inside its own horizontal scroll container. Three
                columns fit at 360px; the container is what guarantees a longer
                ladder never makes the page itself scroll sideways (§7).
              */}
              <div className="no-scrollbar overflow-x-auto rounded-2xl border border-border bg-card">
                <table className="w-full min-w-[18rem] text-sm">
                  <caption className="sr-only">
                    Projected total return by allocation amount for {plan.name}
                  </caption>
                  <thead>
                    <tr className="border-b border-border text-left">
                      <th scope="col" className="px-4 py-3 text-xs font-medium text-muted-foreground">
                        Allocation
                      </th>
                      <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">
                        Estimated return
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {plan.rateTiers.map((tier) => (
                      <tr key={tier.id}>
                        <th
                          scope="row"
                          className="tabular px-4 py-3 text-left font-medium"
                        >
                          {tier.maxAmountUsdt === null
                            ? `${formatUsdt(tier.minAmountUsdt, { withSymbol: false })} USDT and above`
                            : `${formatUsdt(tier.minAmountUsdt, { withSymbol: false })} – under ${formatUsdt(tier.maxAmountUsdt, { withSymbol: false })} USDT`}
                        </th>
                        <td className="tabular px-4 py-3 text-right font-semibold text-positive">
                          {tier.ratePercent}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

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
            {/*
              This said "This is a demo build. No investment is actually created
              and no funds are moved." That stopped being true when the
              investment engine landed: allocating debits a real available
              balance, writes a real ledger entry and locks real principal. A
              screen that tells somebody their money is not moving while it
              moves their money is the most damaging sentence this page could
              carry, so it says what actually happens instead.
            */}
            <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
              <Info className="mt-px size-3 shrink-0" aria-hidden />
              <span>
                Allocating moves real funds: your available balance is debited and the
                principal is locked for the plan&rsquo;s term. Returns are estimates, not
                guarantees.
              </span>
            </p>
          </section>


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
