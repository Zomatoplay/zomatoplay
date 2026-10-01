import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
import postgres from "postgres";
async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { ssl: "require", max: 1, prepare: false });
  console.log("--- auth.resolvePrincipal: cache hits vs real network calls ---");
  console.table(await sql`
    select case when duration_ms < 5 then 'cache hit (<5ms)' else 'real getUser() call' end as kind,
           count(*)::int as n, round(avg(duration_ms))::int as avg_ms, max(duration_ms)::int as max_ms
    from pipeline_events
    where occurred_at > now() - interval '40 minutes' and operation = 'auth.resolvePrincipal'
    group by 1`);
  console.log("--- auth.resolveAccount: same split ---");
  console.table(await sql`
    select case when duration_ms < 5 then 'cache hit (<5ms)' else 'real query' end as kind,
           status, count(*)::int as n, round(avg(duration_ms))::int as avg_ms, max(duration_ms)::int as max_ms
    from pipeline_events
    where occurred_at > now() - interval '40 minutes' and operation = 'auth.resolveAccount'
    group by 1,2`);
  console.log("--- distinct failure messages ---");
  console.table(await sql`
    select operation, metadata->>'errorCategory' as category, error_message, count(*)::int as n,
           round(avg(duration_ms))::int as avg_ms
    from pipeline_events
    where occurred_at > now() - interval '90 minutes' and status = 'failed'
    group by 1,2,3 order by n desc limit 20`);
  await sql.end();
}
main().catch(e=>{console.error(e);process.exit(1)});
