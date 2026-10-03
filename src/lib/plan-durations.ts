/**
 * The selectable investment terms and the rule a configured rate must meet —
 * shared by the CRM form (as an affordance) and the write service (as the
 * boundary). Pure: no server or browser imports.
 *
 * The list is repeated in `investment-schedule.ts` (server-only) and in the
 * `plan_duration_rates_duration_allowed` CHECK constraint; all three must
 * stay identical.
 */
export const PLAN_DURATIONS = [7, 15, 30, 60, 90] as const;
export type PlanDuration = (typeof PLAN_DURATIONS)[number];

export interface DurationRateDraft {
  durationDays: number;
  /** Blank means "not offered" — never a derived figure. */
  ratePercent: string;
}

/** Exact validation of one typed rate. Null when acceptable. */
export function durationRateRefusal(raw: string): string | null {
  const value = raw.trim();
  if (value === "") return null;
  if (!/^\d{1,3}(\.\d{1,4})?$/.test(value)) {
    return "Enter a percentage like 2 or 2.5 (up to 4 decimal places).";
  }
  const n = Number(value);
  if (!(n > 0)) return "A rate must be above 0%.";
  if (n > 500) return "A rate above 500% is almost certainly a typo.";
  return null;
}

/** `7 days`, `90 days`. */
export function durationLabel(days: number): string {
  return `${days} day${days === 1 ? "" : "s"}`;
}
