/**
 * Pure presentation formatters with no app or currency knowledge.
 * Currency formatting lives in `@/lib/currency`.
 */

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const shortDateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  timeZone: "UTC",
});

const dateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
});

/** `09 Aug 2026` — UTC-pinned so server and client always agree. */
export function formatDate(iso: string) {
  return dateFormatter.format(new Date(iso));
}

/** `09 Aug` */
export function formatShortDate(iso: string) {
  return shortDateFormatter.format(new Date(iso));
}

/** `09 Aug 2026, 14:30` */
export function formatDateTime(iso: string) {
  return dateTimeFormatter.format(new Date(iso));
}

/**
 * `09 Aug 2026, 14:30 UTC` — the same instant, and it says which clock.
 *
 * WHY THE SUFFIX EXISTS
 * ---------------------
 * Every timestamp in this application is stored as `timestamptz`, serialised
 * with `toISOString()` and rendered through the UTC-pinned formatter above.
 * That pinning is deliberate and must not change: an `Intl` call without an
 * explicit `timeZone` uses the *runtime's* zone, which is the server's during
 * SSR and the viewer's after hydration, and the two disagreeing is a
 * hydration mismatch on every screen that shows a date.
 *
 * The cost of pinning is that the reader is silently shown a clock that is not
 * theirs. An operator in India testing at 23:00 read 17:30 in the system log
 * and reasonably concluded the log was wrong; nothing was wrong except that
 * "UTC" was not written anywhere. IST is UTC+5:30, and 23:00 − 5:30 = 17:30.
 *
 * So this is a labelling function, not a conversion: same instant, same
 * formatter, one word of context. Use it on the operations screens where a
 * timestamp is correlated against the real world — the system log and the audit
 * trail. Ordinary product screens keep `formatDateTime`, where a bare date is
 * what a person wants and the extra token is noise.
 */
export function formatDateTimeUtc(iso: string) {
  return `${dateTimeFormatter.format(new Date(iso))} UTC`;
}

/** Truncate a long identifier: `TX9f2c…8a41`. */
export function truncateMiddle(value: string, head = 6, tail = 4) {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

/** Initials for an avatar fallback. */
export function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/** Clamp a number into a range. */
export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

/** `12 of 90 days` style progress percentage, clamped to 0–100. */
export function progressPercent(current: number, total: number) {
  if (total <= 0) return 0;
  return clamp((current / total) * 100, 0, 100);
}

export function pluralize(count: number, singular: string, plural?: string) {
  return count === 1 ? singular : (plural ?? `${singular}s`);
}
