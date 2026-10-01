import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
import postgres from "postgres";
const UID = 'b0271b3e-7a1d-43b3-a7a3-a6bbe3988d54';
async function main() {
  for (const max of [5, 12]) {
    const sql = postgres(process.env.DATABASE_URL!, { ssl: "require", max, prepare: true, idle_timeout: 0 });
    // Cold: how long does the very first burst cost?
    let s = Date.now();
    await Promise.all(Array.from({length: 5}, () => sql`select 1`));
    const cold = Date.now() - s;

    // Warm: same burst again.
    s = Date.now();
    await Promise.all(Array.from({length: 5}, () => sql`select 1`));
    const warm = Date.now() - s;

    // The Home shape: 1 account query, then 4 parallel slice queries.
    s = Date.now();
    const [u] = await sql`select id from users where auth_user_id = ${UID} limit 1`;
    const afterAuth = Date.now() - s;
    const uid = (u as {id:string})?.id;
    await Promise.all([
      sql`select * from users where id = ${uid} limit 1`,
      sql`select * from wallet_balances where user_id = ${uid} limit 1`,
      sql`select * from investments where user_id = ${uid}`,
      sql`select * from transactions where user_id = ${uid} order by created_at desc limit 50`,
    ]);
    const total = Date.now() - s;
    console.log(`max=${String(max).padEnd(2)} coldBurst=${String(cold).padStart(5)}ms warmBurst=${String(warm).padStart(4)}ms  authQuery=${String(afterAuth).padStart(4)}ms  home(auth+4parallel)=${String(total).padStart(4)}ms`);
    await sql.end();
  }
}
main().catch(e=>{console.error(e);process.exit(1)});
