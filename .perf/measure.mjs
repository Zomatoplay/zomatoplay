/**
 * Streaming-SSR timing probe.
 *
 * For a streamed React response the useful question is not "when did the
 * response finish" but "when did each piece of markup reach the client".
 * So this records the wall-clock offset at which each marker substring first
 * appears in the byte stream.
 *
 *   ttfb        first byte of the response
 *   shell       the primary navigation (AppShell is on screen)
 *   skeleton    a loading placeholder is on screen
 *   data        a route-specific piece of real, user-specific content
 *   done        stream closed
 */
import { readFileSync } from "node:fs";
import http from "node:http";

const cookie = readFileSync(".perf/cookies.txt", "utf8").trim();
const BASE = process.env.PERF_BASE ?? "http://127.0.0.1:3000";

const MARKERS = {
  shell: 'aria-label="Primary"',
  skeleton: "sr-only",
  main: 'id="main-content"',
};

export function probe(path, dataMarker, structMarker) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const started = process.hrtime.bigint();
    const ms = () => Number(process.hrtime.bigint() - started) / 1e6;
    const hit = {};
    let buf = "";

    const req = http.request(
      url,
      { headers: { cookie, "user-agent": "nanotron-perf" } },
      (res) => {
        hit.ttfb = undefined;
        res.on("data", (chunk) => {
          if (hit.ttfb === undefined) hit.ttfb = ms();
          buf += chunk.toString("utf8");
          for (const [name, needle] of Object.entries(MARKERS)) {
            if (hit[name] === undefined && buf.includes(needle)) hit[name] = ms();
          }
          if (structMarker && hit.structure === undefined && buf.includes(structMarker)) {
            hit.structure = ms();
          }
          if (dataMarker && hit.data === undefined && buf.includes(dataMarker)) {
            hit.data = ms();
          }
        });
        res.on("end", () => {
          hit.done = ms();
          hit.status = res.statusCode;
          hit.bytes = buf.length;
          hit.location = res.headers.location;
          resolve(hit);
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

const ROUTES = [
  // [route, structure marker (static page chrome), data marker (user-specific)]
  ["/",                    "Earnings overview",     "\u2248 \u20b9"],
  ["/plans",               "Choose a plan that",    "\u2248 \u20b9"],
  ["/wallet",              "Transactions",          "\u2248 \u20b9"],
  ["/referral",            "How referrals work",    "?ref="],
  ["/settings",            "Identity verification", "nanotron.user"],
  ["/wallet/transactions", "Transaction",           "nanotron.user"],
  ["/settings/security",   "Security",              "nanotron.user"],
  ["/settings/investments", "Active investments",   "USDT"],
  ["/wallet/deposit",      "USDT (TRC-20)",         "T"],
];

function fmt(v) {
  return v === undefined ? "    -" : String(Math.round(v)).padStart(5);
}

const label = process.argv[2] ?? "run";
console.log(`\n=== ${label} ===`);
console.log("route                    status   ttfb  shell  struct   data   done   bytes");
for (const [route, structMarker, dataMarker] of ROUTES) {
  try {
    const r = await probe(route, dataMarker, structMarker);
    console.log(
      `${route.padEnd(24)} ${String(r.status).padEnd(6)} ${fmt(r.ttfb)} ${fmt(r.shell)} ${fmt(r.structure)} ${fmt(r.data)} ${fmt(r.done)} ${String(r.bytes).padStart(7)}` +
        (r.location ? `  -> ${r.location}` : ""),
    );
  } catch (e) {
    console.log(`${route.padEnd(24)} ERROR ${e.message}`);
  }
}
