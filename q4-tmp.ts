import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
import postgres from "postgres";
async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { ssl: "require", max: 1, prepare: false });
  console.log("--- operations, last 12 minutes (post-change) ---");
  console.table(await sql`
    select operation, count(*)::int as n,
           round(avg(duration_ms))::int as avg_ms,
           percentile_disc(0.5) within group (order by duration_ms)::int as p50,
           max(duration_ms)::int as max_ms,
           count(*) filter (where status='failed')::int as fails
    from pipeline_events
    where occurred_at > now() - interval '12 minutes' and duration_ms is not null
    group by operation order by avg(duration_ms)*count(*) desc limit 20`);
  console.log("--- render.complete by route ---");
  console.table(await sql`
    select route, count(*)::int as n,
           percentile_disc(0.5) within group (order by duration_ms)::int as p50,
           max(duration_ms)::int as max_ms
    from pipeline_events
    where occurred_at > now() - interval '12 minutes' and operation='render.complete'
    group by route order by p50 desc nulls last limit 20`);
  console.log("--- connection retries observed ---");
  console.table(await sql`
    select operation, count(*)::int as n, min(occurred_at) as first, max(occurred_at) as last
    from pipeline_events
    where occurred_at > now() - interval '12 minutes' and operation='database.connectRetry'
    group by 1`);
  await sql.end();
}
main().catch(e=>{console.error(e);process.exit(1)});
