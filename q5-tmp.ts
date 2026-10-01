import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
import postgres from "postgres";
async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { ssl: "require", max: 1, prepare: false });
  console.log("--- resolveAccount: cache hits vs real queries (12 min) ---");
  console.table(await sql`
    select case when duration_ms < 5 then 'cache hit' else 'real query' end as kind,
           count(*)::int as n, round(avg(duration_ms))::int as avg_ms
    from pipeline_events
    where occurred_at > now() - interval '12 minutes' and operation='auth.resolveAccount'
    group by 1`);
  console.log("--- calls per correlation id ---");
  console.table(await sql`
    select calls_per_render, count(*)::int as renders from (
      select correlation_id, count(*)::int as calls_per_render
      from pipeline_events
      where occurred_at > now() - interval '12 minutes' and operation='auth.resolveAccount'
      group by correlation_id) s
    group by 1 order by 1`);
  console.log("--- real queries per correlation (the duplicates that cost) ---");
  console.table(await sql`
    select real_calls, count(*)::int as renders from (
      select correlation_id, count(*) filter (where duration_ms >= 5)::int as real_calls
      from pipeline_events
      where occurred_at > now() - interval '12 minutes' and operation='auth.resolveAccount'
      group by correlation_id) s
    group by 1 order by 1`);
  await sql.end();
}
main().catch(e=>{console.error(e);process.exit(1)});
