import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

import { isAuthConfigured } from "@/lib/supabase/env";
import { ensureAccountForCurrentPrincipal } from "@/server/auth/account";
import { createSupabaseServerClient } from "@/server/auth/session";
import { recordSignIn } from "@/server/auth/sign-in-record";

/**
 * Where every email link lands.
 *
 * WHY THIS ROUTE HAD TO EXIST
 * ---------------------------
 * It did not, and that was the bug. Sign-up confirmation, magic links and
 * password-recovery links all carry a single-use credential in the URL and all
 * need somewhere to *exchange* it for a session. With no such route, Supabase's
 * default redirect landed on `/`, the app found no session, sent the visitor to
 * `/login`, and the credential in the URL expired unused — the "access denied /
 * OTP expired" loop. Nothing was wrong with the token; there was nowhere to
 * spend it.
 *
 * TWO LINK SHAPES, BOTH HANDLED
 * -----------------------------
 * Supabase emits different links depending on the template and the client that
 * requested them, and which one arrives is not this application's choice:
 *
 *   ?code=…                     PKCE. Exchanged with `exchangeCodeForSession`.
 *   ?token_hash=…&type=signup   The verify endpoint's redirect. `verifyOtp`.
 *
 * Handling only one of them works right up until somebody edits an email
 * template, so both are handled here.
 *
 * A RECOVERY LINK IS NOT A SIGN-IN
 * --------------------------------
 * `type=recovery` produces a session whose only purpose is to set a new
 * password, so it is sent to `/update-password` and no application account is
 * created or touched on the way. Treating it as an ordinary sign-in would drop
 * someone into the app mid-recovery with no idea their password is unchanged.
 */

/** Only same-origin paths. An open redirect here is a phishing primitive. */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}

function errorRedirect(request: NextRequest, message: string): NextResponse {
  const url = new URL("/login", request.url);
  url.searchParams.set("error", message);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  // Supabase reports its own failures on the redirect rather than in a body.
  const providerError =
    params.get("error_description") ?? params.get("error") ?? null;
  if (providerError) {
    return errorRedirect(request, providerError);
  }

  if (!isAuthConfigured()) {
    return errorRedirect(request, "Sign-in is not configured on this deployment.");
  }

  const code = params.get("code");
  const tokenHash = params.get("token_hash");
  const type = params.get("type") as EmailOtpType | null;
  const next = safeNext(params.get("next"));

  if (!code && !tokenHash) {
    return errorRedirect(
      request,
      "That link is missing its verification code. Request a new one.",
    );
  }

  const supabase = await createSupabaseServerClient();

  const { error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : await supabase.auth.verifyOtp({ token_hash: tokenHash!, type: type ?? "email" });

  if (error) {
    // Genuinely expired or already used. Say so plainly rather than bouncing
    // the visitor to a sign-in page that looks like nothing happened.
    return errorRedirect(
      request,
      error.message || "That link has expired or has already been used.",
    );
  }

  if (type === "recovery") {
    return NextResponse.redirect(new URL("/update-password", request.url));
  }

  // A verified email, and now an application account to go with it.
  try {
    const account = await ensureAccountForCurrentPrincipal();
    await recordSignIn(account.userId);
    return NextResponse.redirect(
      new URL(account.profileComplete ? next : "/complete-profile", request.url),
    );
  } catch (error) {
    return errorRedirect(
      request,
      error instanceof Error ? error.message : "Could not finish signing you in.",
    );
  }
}
