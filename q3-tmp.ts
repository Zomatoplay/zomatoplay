import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
if (!(globalThis as { WebSocket?: unknown }).WebSocket) {
  (globalThis as { WebSocket?: unknown }).WebSocket = class {} as unknown;
}
import { createServerClient } from "@supabase/ssr";
async function main() {
  const jar: Record<string,string> = {};
  const mk = () => createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => Object.entries(jar).map(([name,value])=>({name,value})),
                 setAll: (l) => { for (const {name,value} of l) jar[name]=value; } } });
  const s = mk();
  const { error } = await s.auth.signInWithPassword({
    email: process.env.DEV_TEST_EMAIL!, password: process.env.DEV_TEST_PASSWORD! });
  if (error) throw new Error(error.message);

  for (const label of ["getUser", "getClaims"]) {
    const times: number[] = [];
    for (let i = 0; i < 6; i++) {
      const c = mk();
      const t0 = Date.now();
      const r = label === "getUser" ? await c.auth.getUser() : await c.auth.getClaims();
      times.push(Date.now() - t0);
      if (r.error) { console.log(`${label} error:`, r.error.message); break; }
    }
    console.log(`${label.padEnd(10)} ${times.map(t=>String(t).padStart(6)).join("")}  median=${[...times].sort((a,b)=>a-b)[Math.floor(times.length/2)]}ms`);
  }
}
main().catch(e=>{console.error(e);process.exit(1)});
