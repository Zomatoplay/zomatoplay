import { probe } from "./measure.mjs";

// Rapid tab-hopping: no pause between navigations, the way an impatient
// person actually uses a bottom nav.
const SEQ = ["/", "/plans", "/wallet", "/referral", "/settings"];
console.log("\n=== RAPID sequential navigation (no think time), 3 laps ===");
console.log("lap route        ttfb  struct   data");
for (let lap = 1; lap <= 3; lap += 1) {
  for (const r of SEQ) {
    const x = await probe(r, "≈ ₹", null);
    console.log(
      `${lap}   ${r.padEnd(11)} ${String(Math.round(x.ttfb)).padStart(5)} ${String(Math.round(x.shell)).padStart(6)} ${x.data ? String(Math.round(x.data)).padStart(6) : "     -"}`,
    );
  }
}

// Overlapping: five navigations in flight at once, which is what abandoning
// a page mid-load produces (the server keeps rendering it — CLAUDE.md §16.1a).
console.log("\n=== OVERLAPPING navigation (5 concurrent) ===");
const t0 = Date.now();
const all = await Promise.all(SEQ.map((r) => probe(r, null, null)));
all.forEach((x, i) =>
  console.log(
    `${SEQ[i].padEnd(11)} ttfb=${String(Math.round(x.ttfb)).padStart(5)}  shell=${String(Math.round(x.shell)).padStart(5)}  done=${String(Math.round(x.done)).padStart(5)}`,
  ),
);
console.log(`wall ${Date.now() - t0}ms`);
