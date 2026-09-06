import "server-only";

/**
 * The error taxonomy.
 *
 * WHY CLASSIFY AT ALL
 * -------------------
 * Most of what goes wrong in this application is *expected*: a session absent,
 * a link already used, a permission not held. Treating those the same as a
 * genuine fault produces two failures at once — the user gets a crash screen
 * for something routine, and the real faults are buried in the noise.
 *
 * WHY IT HAPPENS ON THE SERVER
 * ----------------------------
 * Next strips an error's message before it reaches a client error boundary in
 * production, leaving only a digest. So a boundary *cannot* classify — by the
 * time the browser sees it, the information is gone. Classification therefore
 * happens where the error is thrown, and its category goes into the log.
 *
 * That is also the right privacy answer: the user-facing text for a database
 * timeout and an unexpected fault can reasonably be the same ("something
 * temporary went wrong, try again"), because the difference is operational.
 * What must differ is what gets recorded and whether a retry is worth
 * suggesting.
 */

export type ErrorCategory =
  | "UNAUTHENTICATED"
  | "AUTH_LINK_EXPIRED"
  | "AUTH_LINK_ALREADY_USED"
  | "AUTH_PROVIDER_UNAVAILABLE"
  | "DATABASE_TIMEOUT"
  | "DATABASE_UNAVAILABLE"
  | "VALIDATION_ERROR"
  | "PERMISSION_DENIED"
  | "NOT_FOUND"
  | "SERVER_ERROR";

/** Whether trying the same thing again could plausibly work. */
const RETRYABLE = new Set<ErrorCategory>([
  "DATABASE_TIMEOUT",
  "DATABASE_UNAVAILABLE",
  "AUTH_PROVIDER_UNAVAILABLE",
]);

export function isRetryable(category: ErrorCategory): boolean {
  return RETRYABLE.has(category);
}

/**
 * Whether this is something that went wrong, or something that happened.
 *
 * An absent session and a refused permission are outcomes the system is
 * designed to produce. Logging them at the same level as a database outage is
 * how a log stops being read.
 */
export function isExpected(category: ErrorCategory): boolean {
  return (
    category === "UNAUTHENTICATED" ||
    category === "AUTH_LINK_EXPIRED" ||
    category === "AUTH_LINK_ALREADY_USED" ||
    category === "PERMISSION_DENIED" ||
    category === "VALIDATION_ERROR" ||
    category === "NOT_FOUND"
  );
}

interface DriverError {
  name?: unknown;
  code?: unknown;
  message?: unknown;
  cause?: unknown;
}

/**
 * Sorts a thrown value into the taxonomy.
 *
 * Matches on the driver's `code` before its message wherever possible: message
 * text is not a stable interface and changes between driver versions, while
 * `CONNECT_TIMEOUT` and the Postgres SQLSTATE classes do not.
 */
export function classifyError(error: unknown): ErrorCategory {
  const e = error as DriverError;
  const name = typeof e?.name === "string" ? e.name : "";
  const code = typeof e?.code === "string" ? e.code : "";
  const message = typeof e?.message === "string" ? e.message : "";

  // Application errors name themselves.
  if (name === "NotAuthenticatedError") return "UNAUTHENTICATED";
  // "We could not reach the auth provider", which is emphatically not the same
  // as "this person is not signed in" — see `@/server/auth/session`.
  if (name === "AuthProviderUnavailableError") return "AUTH_PROVIDER_UNAVAILABLE";
  if (name === "AdminAuthorizationError" || name === "NotAuthenticatedOperatorError") {
    return "PERMISSION_DENIED";
  }
  if (name === "ProfileIncompleteError") return "VALIDATION_ERROR";
  if (
    name === "MoneyError" ||
    name === "KycError" ||
    name === "InvestmentError" ||
    name === "WithdrawalError" ||
    name === "DepositError" ||
    name === "DepositAddressServiceError" ||
    name === "AddressReleaseError" ||
    name === "PoolExhaustedError"
  ) {
    return "VALIDATION_ERROR";
  }

  /*
   * Connection problems, which are the ones this taxonomy was written for.
   *
   * `CONNECT_TIMEOUT` is postgres.js's own code when a connection cannot be
   * established inside `connect_timeout`. `ConnectTimeoutError` is undici's,
   * seen when the Supabase Auth API is unreachable. `ECONNREFUSED` /
   * `ENOTFOUND` / `EAI_AGAIN` are the network underneath either.
   */
  if (code === "CONNECT_TIMEOUT" || name === "ConnectTimeoutError") {
    return message.includes("supabase.co") || name === "ConnectTimeoutError"
      ? "AUTH_PROVIDER_UNAVAILABLE"
      : "DATABASE_TIMEOUT";
  }
  if (/exceeded \d+ms\. The database is/.test(message)) return "DATABASE_TIMEOUT";
  if (
    code === "ECONNREFUSED" ||
    code === "ENOTFOUND" ||
    code === "EAI_AGAIN" ||
    code === "ECONNRESET" ||
    code === "CONNECTION_CLOSED" ||
    code === "CONNECTION_ENDED"
  ) {
    return "DATABASE_UNAVAILABLE";
  }
  // SQLSTATE class 08 — connection exception.
  if (/^08/.test(code)) return "DATABASE_UNAVAILABLE";
  // 57P01/57P03 — admin shutdown, cannot connect now.
  if (code === "57P01" || code === "57P03") return "DATABASE_UNAVAILABLE";

  if (name === "WritesUnavailableError" || name === "AccountUnavailableError") {
    return "DATABASE_UNAVAILABLE";
  }

  // Supabase's own vocabulary for a spent link.
  if (/otp_expired|expired or has already been used|Email link is invalid/i.test(message)) {
    return "AUTH_LINK_EXPIRED";
  }
  if (/already been used|already consumed|code verifier/i.test(message)) {
    return "AUTH_LINK_ALREADY_USED";
  }

  // A nested cause often carries the real reason — undici wraps, drizzle wraps.
  if (e?.cause && e.cause !== error) {
    const nested = classifyError(e.cause);
    if (nested !== "SERVER_ERROR") return nested;
  }

  return "SERVER_ERROR";
}
