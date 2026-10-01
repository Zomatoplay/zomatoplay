import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
import postgres from "postgres";
async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { ssl: "require", max: 3, prepare: true });
  // Warm one connection first.
  await sql`select 1`;
  const t: number[] = [];
  for (let i = 0; i < 6; i++) { const s = Date.now(); await sql`select 1`; t.push(Date.now()-s); }
  console.log("warm round trip (select 1):", t.join("ms, ")+"ms");

  const idx = await sql`
    select indexname, indexdef from pg_indexes
    where tablename='users' and indexdef ilike '%auth_user_id%'`;
  console.log("indexes covering users.auth_user_id:", idx.length ? idx.map(r=>r.indexname).join(", ") : "NONE");

  const plan = await sql`
    explain (analyze, buffers, format text)
    select id,email,display_id,full_name,phone,status from users
    where auth_user_id = ${'b0271b3e-7a1d-43b3-a7a3-a6bbe3988d54'} limit 1`;
  console.log("--- plan ---");
  for (const r of plan) console.log(" ", (r as Record<string,string>)["QUERY PLAN"]);

  // How long does the same query take end to end, warm?
  const q: number[] = [];
  for (let i = 0; i < 6; i++) {
    const s = Date.now();
    await sql`select id,email,display_id,full_name,phone,status from users where auth_user_id = ${'b0271b3e-7a1d-43b3-a7a3-a6bbe3988d54'} limit 1`;
    q.push(Date.now()-s);
  }
  console.log("warm account query:", q.join("ms, ")+"ms");
  await sql.end();
}
main().catch(e=>{console.error(e);process.exit(1)});
