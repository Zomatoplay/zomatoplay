import { probe } from "./measure.mjs";
const r1 = await probe("/settings/investments", "Active investments", "Back to settings");
console.log("\n/settings/investments  ttfb=%d  header(struct)=%s  overview(data)=%s  done=%d",
  Math.round(r1.ttfb), r1.structure ? Math.round(r1.structure) : "-", r1.data ? Math.round(r1.data) : "-", Math.round(r1.done));
