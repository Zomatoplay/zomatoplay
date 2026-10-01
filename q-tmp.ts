import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
import postgres from "postgres";
async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { ssl: "require", max: 1, prepare: false });
  console.log("--- slowest operations (last 40 min) ---");
  console.table(await sql`
    select operation, count(*)::int as n,
           round(avg(duration_ms))::int as avg_ms,
           max(duration_ms)::int as max_ms,
           count(*) filter (where status <> 'ok')::int as fails
    from pipeline_events
    where occurred_at > now() - interval '40 minutes' and duration_ms is not null
    group by operation order by avg(duration_ms) desc nulls last limit 25`);
  console.log("--- busiest renders (db calls per correlation) ---");
  console.table(await sql`
    select correlation_id,
           count(*) filter (where layer = 'database')::int as db_calls,
           count(*) filter (where operation like 'auth%')::int as auth_calls,
           max(duration_ms)::int as slowest, min(route) as route
    from pipeline_events
    where occurred_at > now() - interval '40 minutes'
    group by correlation_id order by db_calls desc limit 15`);
  console.log("--- failures (60 min) ---");
  console.table(await sql`
    select operation, status, metadata->>'errorCategory' as category, count(*)::int as n
    from pipeline_events
    where occurred_at > now() - interval '60 minutes' and status <> 'ok'
    group by 1,2,3 order by n desc limit 20`);
  await sql.end();
}
main().catch(e=>{console.error(e);process.exit(1)});
