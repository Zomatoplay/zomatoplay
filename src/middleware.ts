import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase/env";

/**
 * Session refresh.
 *
 * Supabase access tokens are short-lived. Without a middleware pass the refresh
 * would have to happen inside a Server Component, which cannot write cookies —
 * so the session would expire mid-visit and the user would be signed out while
 * still clicking around.
 *
 * This deliberately does **not** enforce authorization. Middleware runs before
 * the route and sees only a cookie; the actual gate is in the route group's
 * layout and in every server action, where the session is verified against
 * Supabase. Treating middleware as the security boundary is a well-worn way to
 * ship an app that is protected only where somebody remembered to add a matcher.
 *
 * IT ALSO STAMPS THE CORRELATION ID
 * ---------------------------------
 * One id per request, forwarded on the request headers so the layout, the page
 * and every service in that render read the same one. Without it each of them
 * would open its own trace and a single page load would appear in the system
 * log as three unrelated fragments.
 *
 * A client-supplied id is preserved when it is id-shaped, which is what joins
 * the browser's half of the trace — the click, the navigation — to the
 * server's. It is a diagnostic label: it grants nothing, selects nothing, and
 * is validated purely so it cannot smuggle text into the log.
 */
const CORRELATION_HEADER = "x-nanotron-correlation";

const TRACE_COOKIE = "nanotron-trace";
const REFERRAL_COOKIE = "nanotron-ref";

/**
 * Referral codes are captured here, on any route, not just `/signup`.
 *
 * A shared link can point anywhere — `/?ref=X`, `/plans?ref=X` — and the person
 * who follows it may browse for a while, sign up, then confirm their email in a
 * second request minutes later. Client memory does not survive that; a cookie
 * does, which is what "persist attribution safely through signup" requires.
 *
 * The code is stored, never resolved here: middleware makes no database call
 * and no decision. `ensureAccountForCurrentPrincipal` validates it against a
 * real user at account-creation time, which is the only moment it can be
 * applied — and after that it is immutable.
 *
 * First one wins. Overwriting on a later visit would let a second link steal an
 * attribution the first had already earned.
 */
function captureReferral(request: NextRequest, response: NextResponse): void {
  const code = request.nextUrl.searchParams.get("ref")?.trim();
  if (!code) return;
  // Shape only. Whether it names anybody is the server's question, later.
  if (!/^[A-Za-z0-9]{4,32}$/.test(code)) return;
  if (request.cookies.get(REFERRAL_COOKIE)) return;

  response.cookies.set(REFERRAL_COOKIE, code.toUpperCase(), {
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
    httpOnly: true,
    sameSite: "lax",
  });
}

function correlationIdFor(request: NextRequest): string {
  // A server action can set the header directly.
  const supplied = request.headers.get(CORRELATION_HEADER)?.trim();
  if (supplied && /^[A-Za-z0-9_-]{8,64}$/.test(supplied)) return supplied;

  /*
   * A navigation cannot.
   *
   * Client-side navigation is an RSC fetch Next issues itself: no hook to add a
   * header, no way to read one back. A short-lived cookie is the one channel
   * that rides along automatically, so `NavigationTracer` writes the id it
   * generated on click and this adopts it — which is what puts the browser's
   * `navigation.start` and the server's render under one correlation id.
   *
   * Validated for shape, never for authority. It selects nothing and grants
   * nothing; the worst a forged value achieves is mislabelling its own log
   * rows.
   */
  const fromCookie = request.cookies.get(TRACE_COOKIE)?.value?.trim();
  if (fromCookie && /^[A-Za-z0-9_-]{8,64}$/.test(fromCookie)) return fromCookie;
  // Web Crypto, not `node:crypto`: middleware runs on the Edge runtime, which
  // has the global but not the Node module.
  return `req_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

export async function middleware(request: NextRequest) {
  const correlationId = correlationIdFor(request);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(CORRELATION_HEADER, correlationId);
  requestHeaders.set("x-nanotron-route", request.nextUrl.pathname);

  const url = getSupabaseUrl();
  const anonKey = getSupabaseAnonKey();

  // Not configured: nothing to refresh, and no reason to fail the request.
  if (!url || !anonKey) {
    const bare = NextResponse.next({ request: { headers: requestHeaders } });
    captureReferral(request, bare);
    return bare;
  }

  let response = NextResponse.next({ request: { headers: requestHeaders } });

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request: { headers: requestHeaders } });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  /*
   * Refresh the session cookie — and only that.
   *
   * WHY `getSession()` HERE AND `getUser()` EVERYWHERE ELSE
   * ------------------------------------------------------
   * `getUser()` verifies the token against Supabase: a network round trip,
   * measured at ~240ms from this deployment. It ran here on *every* request,
   * including ones that then verified again inside the render — the same
   * cookie, checked twice, ~240ms apiece.
   *
   * `getSession()` reads and decodes the cookie locally, and refreshes it only
   * when the access token has actually expired. No network call in the common
   * case.
   *
   * That swap is safe **because this middleware authorizes nothing**, which is
   * the property the comment above already insisted on. It never decides who
   * anybody is; the gate is in `(app)/layout.tsx`, in the console layout and in
   * every server action, all of which call `getAuthPrincipal()` → `getUser()`
   * and verify against Supabase. Trusting the cookie here would be a bug only
   * if something downstream trusted this result, and nothing does — the value
   * is discarded.
   *
   * If this ever starts gating a route, it must go back to `getUser()`.
   */
  await supabase.auth.getSession();

  // Echoed so the browser can label its own client-side events with the same
  // id the server used.
  response.headers.set(CORRELATION_HEADER, correlationId);
  captureReferral(request, response);

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and image optimisation, which never
     * carry a session and would only add latency.
     */
    // The PWA's static files (worker, manifest, offline page, icons) too.
    "/((?!_next/static|_next/image|favicon.ico|sw\\.js|manifest\\.webmanifest|offline\\.html|pwa-icon/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
