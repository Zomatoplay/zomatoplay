import { NextResponse, type NextRequest } from "next/server";

/**
 * Where Supabase sends a failed authentication link.
 *
 * When a one-time code is expired, already consumed, or issued for a different
 * browser, Supabase does not call the redirect target — it bounces to the
 * project's error page with the reason in the query string:
 *
 *   /error?error_code=otp_expired&error_description=Email+link+is+invalid…
 *
 * This route did not exist, so that landed on a 404: the person saw a broken
 * page, learned nothing, and had already spent the only code they had.
 *
 * It is a route handler rather than a page because it renders nothing — it
 * translates Supabase's error into the application's own sign-in screen with a
 * message the person can act on.
 *
 * WHY IT DOES NOT RETRY
 * ---------------------
 * A consumed one-time code cannot be re-used, and a second attempt would fail
 * identically while looking to the user like the app is stuck. The only useful
 * next step is requesting a fresh link, which is what `/login` offers.
 */

/** Supabase's codes, in language a person can act on. */
const MESSAGES: Record<string, string> = {
  otp_expired:
    "That link has expired or has already been used. Request a new one below.",
  access_denied:
    "That link is no longer valid. Request a new one below.",
  invalid_request:
    "That link was not valid. Request a new one below.",
  server_error:
    "The sign-in service could not complete that request. Please try again.",
};

const FALLBACK =
  "That authentication link has expired or has already been used. " +
  "Please request a new one.";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  // Supabase puts these in the query string on a redirect, and sometimes in the
  // URL fragment — which never reaches a server. The client-side handler in the
  // sign-in form covers that case; this covers the query form.
  const code = params.get("error_code") ?? params.get("error");
  const described = params.get("error_description")?.trim();

  const message =
    (code && MESSAGES[code]) ||
    // Supabase's own description is safe to show: it is their fixed copy, not
    // anything a caller supplied about this account. Capped so a long or
    // crafted value cannot be used to push text at the user.
    (described && described.length <= 200 ? described : null) ||
    FALLBACK;

  const url = new URL("/login", request.url);
  url.searchParams.set("error", message);

  const response = NextResponse.redirect(url);

  /*
   * Clear any half-established auth cookies.
   *
   * A failed exchange can leave `@supabase/ssr`'s chunked cookies behind. The
   * next request then presents a session that cannot be verified, which reads
   * as "signed in" for exactly long enough to fail somewhere less obvious.
   * Removing them here means the visitor arrives at sign-in genuinely signed
   * out.
   */
  for (const cookie of request.cookies.getAll()) {
    if (/^sb-.*-auth-token(\.\d+)?$/.test(cookie.name)) {
      response.cookies.set(cookie.name, "", { path: "/", maxAge: 0 });
    }
  }

  return response;
}
