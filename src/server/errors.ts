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

import { isPoolExhaustionError } from "@/db/resilience";

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
  if (name === "AuthProviderUnavailableError" || name === "FirebaseUnavailableError") {
    return "AUTH_PROVIDER_UNAVAILABLE";
  }
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
  // 53300/53400 — the server itself is out of connection slots.
  if (code === "53300" || code === "53400") return "DATABASE_UNAVAILABLE";
  /*
   * The pooler refusing a new client because the project is at its ceiling.
   *
   * `XX000` is `internal_error` and must never be classified on its own; this
   * pairs it with the message, exactly as `isPoolExhaustionError` does. It is
   * `DATABASE_UNAVAILABLE` rather than `SERVER_ERROR` because that is the
   * truth — the database is fine and we could not get to it — and because
   * that category is `isRetryable`, which is what tells a sign-in page to
   * offer "try again" instead of "your credentials are wrong".
   */
  if (isPoolExhaustionError(error)) return "DATABASE_UNAVAILABLE";

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

/* -------------------------------------------------------------------------- */
/* Turning a thrown value into something safe to show                          */
/* -------------------------------------------------------------------------- */

/**
 * Error classes whose `message` this application wrote and may therefore show.
 *
 * WHY AN ALLOWLIST RATHER THAN "SHOW `error.message`"
 * ----------------------------------------------------
 * Because `error.message` is whatever threw. On 2026-09-14 an operator signing
 * in was shown, in the browser:
 *
 *   Failed query: select "admin_agents"."id", … where "auth_user_id" = $1
 *   params: 84555b4d-c50d-4486-9f15-59f0e61c3616
 *
 * That is Drizzle's message, reported as the reason their sign-in failed. It
 * leaks the schema and an internal identifier, it tells the operator nothing
 * they can act on, and — worse — it describes an *infrastructure* failure as an
 * *authentication* one. The sign-in had not been refused; the pooler had
 * refused a connection.
 *
 * So the rule is inverted: a message is shown only when this codebase composed
 * it for a person to read. Everything else gets text chosen from the category,
 * and the real reason goes to `pipeline_events` where an operator can find it.
 */
const SPEAKABLE_ERROR_NAMES = new Set([
  "AdminAuthorizationError",
  "NotAuthenticatedOperatorError",
  "AdminValidationError",
  "AuthError",
  "ProfileIncompleteError",
  "MoneyError",
  "KycError",
  "KycStorageError",
  "InvestmentError",
  "WithdrawalError",
  "DepositError",
  "DepositRequestError",
  "DepositSettingsError",
  "FirebaseCredentialError",
  "WritesUnavailableError",
  "AccountUnavailableError",
]);

export interface SafeFailure {
  category: ErrorCategory;
  /** Safe to render. Never a driver message, never SQL, never a parameter. */
  message: string;
  /** Whether the same action, tried again, could plausibly work. */
  retryable: boolean;
}

/** What a person is told when the reason is not theirs to read. */
function genericMessage(category: ErrorCategory, fallback: string): string {
  switch (category) {
    case "DATABASE_TIMEOUT":
    case "DATABASE_UNAVAILABLE":
      return (
        "We could not reach the service just now. This is temporary — " +
        "please try again in a moment."
      );
    case "AUTH_PROVIDER_UNAVAILABLE":
      return (
        "The sign-in service is temporarily unreachable. Please try again in " +
        "a moment."
      );
    case "UNAUTHENTICATED":
      return "Your session has expired. Sign in again.";
    case "PERMISSION_DENIED":
      return "You do not have access to do that.";
    case "NOT_FOUND":
      return "That no longer exists.";
    default:
      return fallback;
  }
}

/**
 * Classifies a thrown value and picks text that is safe to return to a client.
 *
 * `fallback` is the caller's own wording for "this did not work", used when the
 * category has nothing more specific to say.
 */
export function toSafeFailure(error: unknown, fallback: string): SafeFailure {
  const category = classifyError(error);
  const name = error instanceof Error ? error.name : "";
  const own = SPEAKABLE_ERROR_NAMES.has(name);

  return {
    category,
    message: own && error instanceof Error
      ? error.message
      : genericMessage(category, fallback),
    retryable: isRetryable(category),
  };
}

/**
 * Whether a failure means "we could not find out", as opposed to "the answer
 * is no".
 *
 * The distinction every gate in this application needs: an absent session and
 * an unreachable database both stop a page rendering, and only one of them is
 * a reason to sign somebody out.
 */
export function isInfrastructureFailure(error: unknown): boolean {
  const category = classifyError(error);
  return (
    category === "DATABASE_TIMEOUT" ||
    category === "DATABASE_UNAVAILABLE" ||
    category === "AUTH_PROVIDER_UNAVAILABLE"
  );
}
