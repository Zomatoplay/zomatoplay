import { config as loadEnv } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import { asc, eq } from "drizzle-orm";
import postgres from "postgres";

import * as t from "../schema";
import { plans as catalogue } from "@/data/plans";
import { requireAdminDatabaseUrl, shouldUseSsl } from "../env";

/**
 * Gives every plan that has no rate ladder the one the seed would give it.
 *
 * WHY THIS EXISTS SEPARATELY FROM `db:seed`
 * -----------------------------------------
 * `npm run db:seed` is destructive — it clears every table and reloads — which
 * is exactly wrong for a database that already holds real accounts, real
 * allocations and real deposits. A deployment that ran `db:migrate` to pick up
 * `plan_rate_tiers` therefore has the table and no rows in it, and a plan with
 * no ladder is priced by its own `estimated_return_percent`: correct, and not
 * what an operator who wanted bands was expecting to find.
 *
 * WHAT IT WILL NOT DO
 * -------------------
 * **It never touches a plan that already has a band.** Not to add one, not to
 * correct one, not to fill a gap. A ladder in the database is an operator's
 * configuration, and a script that "reconciles" it against a fixture would
 * silently overwrite a rate somebody chose — on the one table that decides
 * what an allocation is sold at. Plans it skips are reported, not amended.
 *
 * It also matches plans by **id**, so a plan created in the CRM (whose id is
 * not one of the seeded ones) is left alone entirely: this is a backfill for
 * the catalogue that shipped, not a template applied to everything.
 *
 * Safe to run repeatedly: the second run finds every plan already laddered and
 * writes nothing.
 */
async function main() {
  loadEnv({ path: ".env.local", quiet: true });
  loadEnv({ path: ".env", quiet: true });

  const url = requireAdminDatabaseUrl();
  const client = postgres(url, {
    ssl: shouldUseSsl(url) ? "require" : false,
    max: 1,
  });
  const db = drizzle(client, { schema: t });

  try {
    const existing = await db
      .select({ id: t.plans.id, name: t.plans.name })
      .from(t.plans)
      .orderBy(asc(t.plans.sortOrder));

    let inserted = 0;
    for (const plan of existing) {
      const seeded = catalogue.find((candidate) => candidate.id === plan.id);
      if (!seeded) {
        console.log(`  skip  ${plan.name} — not a seeded plan, leaving it alone`);
        continue;
      }

      const [already] = await db
        .select({ id: t.planRateTiers.id })
        .from(t.planRateTiers)
        .where(eq(t.planRateTiers.planId, plan.id))
        .limit(1);
      if (already) {
        console.log(`  skip  ${plan.name} — already has a ladder`);
        continue;
      }

      await db.insert(t.planRateTiers).values(
        seeded.rateTiers.map((tier) => ({
          id: tier.id,
          planId: plan.id,
          minAmountUsdt: tier.minAmountUsdt,
          maxAmountUsdt: tier.maxAmountUsdt,
          ratePercent: tier.ratePercent,
          active: tier.active,
        })),
      );
      inserted += seeded.rateTiers.length;
      console.log(
        `  add   ${plan.name} — ${seeded.rateTiers
          .map(
            (tier) =>
              `${tier.minAmountUsdt}–${tier.maxAmountUsdt ?? "∞"} @ ${tier.ratePercent}%`,
          )
          .join(", ")}`,
      );
    }

    console.log(
      inserted === 0
        ? "\nNothing to do — every plan already has a ladder."
        : `\n${inserted} tier(s) written. Existing allocations are unaffected: each one ` +
            `carries the rate it was sold at on its own row.`,
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(
    "Backfill failed:",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
