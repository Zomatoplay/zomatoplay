/**
 * Navigation timing harness.
 *
 * Signs in with the development credentials, reproduces the exact Supabase SSR
 * cookies the browser would hold, then times real requests against a running
 * server. Prints timings only — never a cookie, token or connection string.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

// realtime-js requires a global WebSocket on Node 20 and throws without one.
// This harness never opens a realtime channel; the stub only gets it past the
// constructor check.
if (!(globalThis as { WebSocket?: unknown }).WebSocket) {
  (globalThis as { WebSocket?: unknown }).WebSocket = class {} as unknown;
}

import { createServerClient } from "@supabase/ssr";

const BASE = process.env.MEASURE_BASE ?? "http://127.0.0.1:3000";

interface Jar {
  [name: string]: string;
}

async function signIn(email: string, password: string): Promise<Jar> {
  const jar: Jar = {};
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return Object.entries(jar).map(([name, value]) => ({ name, value }));
        },
        setAll(list) {
          for (const { name, value } of list) jar[name] = value;
        },
      },
    },
  );
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in failed: ${error.message}`);
  return jar;
}

function cookieHeader(jar: Jar): string {
  return Object.entries(jar)
    .map(([n, v]) => `${n}=${encodeURIComponent(v)}`)
    .join("; ");
}

async function time(path: string, jar: Jar, rsc: boolean) {
  const started = Date.now();
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      cookie: cookieHeader(jar),
      // An RSC request is what a client-side navigation actually issues.
      ...(rsc ? { RSC: "1" } : {}),
    },
    redirect: "manual",
  });
  const body = await res.arrayBuffer();
  return { ms: Date.now() - started, status: res.status, bytes: body.byteLength };
}

async function main() {
  const userJar = await signIn(
    process.env.DEV_TEST_EMAIL!,
    process.env.DEV_TEST_PASSWORD!,
  );
  const adminJar = await signIn(
    process.env.DEV_ADMIN_EMAIL!,
    process.env.DEV_ADMIN_PASSWORD!,
  );

  const userRoutes = [
    "/",
    "/plans",
    "/wallet",
    "/wallet/deposit",
    "/wallet/withdraw",
    "/wallet/transactions",
    "/referral",
    "/settings",
    "/settings/profile",
    "/settings/security",
    "/settings/notifications",
    "/settings/wallet",
    "/settings/investments",
    "/settings/kyc",
  ];
  const adminRoutes = ["/admin", "/admin/users", "/admin/kyc", "/admin/deposits"];

  const rounds = Number(process.env.MEASURE_ROUNDS ?? 3);
  const gap = Number(process.env.MEASURE_GAP_MS ?? 1500);

  // /login is unauthenticated.
  console.log("route                          status   " +
    Array.from({ length: rounds }, (_, i) => `run${i + 1}`.padStart(7)).join("") +
    "   median   bytes");

  const all: Array<[string, Jar]> = [
    ["/login", {}],
    ...userRoutes.map((r) => [r, userJar] as [string, Jar]),
    ...adminRoutes.map((r) => [r, adminJar] as [string, Jar]),
  ];

  const summary: Record<string, number> = {};

  for (const [route, jar] of all) {
    const runs: number[] = [];
    let status = 0;
    let bytes = 0;
    for (let i = 0; i < rounds; i++) {
      // An idle gap between requests: back-to-back requests keep the pool warm
      // and hide the cost that actually reaches users.
      await new Promise((r) => setTimeout(r, gap));
      const out = await time(route, jar, i > 0);
      runs.push(out.ms);
      status = out.status;
      bytes = out.bytes;
    }
    const median = [...runs].sort((a, b) => a - b)[Math.floor(runs.length / 2)];
    summary[route] = median;
    console.log(
      route.padEnd(30) +
        String(status).padEnd(9) +
        runs.map((r) => String(r).padStart(7)).join("") +
        String(median).padStart(9) +
        String(bytes).padStart(8),
    );
  }

  console.log("\nJSON " + JSON.stringify(summary));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
