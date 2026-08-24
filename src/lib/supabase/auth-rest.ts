/**
 * Supabase Auth over plain HTTP.
 *
 * WHY NOT `createClient()`
 * -----------------------
 * `@supabase/supabase-js`'s `createClient` builds a realtime client as part of
 * construction, and on Node 20 that throws outright — there is no global
 * `WebSocket` and the library refuses rather than degrading. Next's runtime
 * polyfills one, so the request path is fine; a plain `tsx` script is not, and
 * a helper that works in the application but not in the seed script is a trap.
 *
 * These three calls need no session, no storage and no socket. They are the
 * documented GoTrue endpoints, called with `fetch` and the publishable key —
 * which is the same credential the browser already holds.
 *
 * NO SERVICE-ROLE KEY IS USED OR ACCEPTED HERE. Everything below is reachable
 * with the public key by design: signing up, exchanging a password for a token,
 * and asking for a recovery email are all things an anonymous client may do.
 */

export interface AuthRestConfig {
  url: string;
  anonKey: string;
}

export class SupabaseAuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "SupabaseAuthError";
  }
}

async function call(
  config: AuthRestConfig,
  path: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${config.url.replace(/\/$/, "")}/auth/v1/${path}`, {
    method: "POST",
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${config.anonKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let payload: Record<string, unknown> = {};
  if (text) {
    try {
      payload = JSON.parse(text) as Record<string, unknown>;
    } catch {
      // A non-JSON body from an auth endpoint is a failure however it reads —
      // a proxy error page, a rate-limit notice. Never treated as success.
      throw new SupabaseAuthError(
        `Supabase Auth returned a non-JSON response (${response.status}).`,
        response.status,
      );
    }
  }

  if (!response.ok) {
    const message =
      (typeof payload.msg === "string" && payload.msg) ||
      (typeof payload.error_description === "string" && payload.error_description) ||
      (typeof payload.message === "string" && payload.message) ||
      `Supabase Auth refused the request (${response.status}).`;
    throw new SupabaseAuthError(message, response.status);
  }

  return payload;
}

export interface SignUpResult {
  /** `auth.users.id`, when Supabase returns the user immediately. */
  userId: string | null;
  /** True when a session came back, i.e. email confirmation is off. */
  hasSession: boolean;
}

export async function signUpWithPassword(
  config: AuthRestConfig,
  input: { email: string; password: string; fullName?: string },
): Promise<SignUpResult> {
  const payload = await call(config, "signup", {
    email: input.email,
    password: input.password,
    data: input.fullName ? { full_name: input.fullName } : undefined,
  });

  const user = payload.user as { id?: unknown } | undefined;
  const id = typeof payload.id === "string" ? payload.id : undefined;

  return {
    userId: (typeof user?.id === "string" ? user.id : undefined) ?? id ?? null,
    hasSession: typeof payload.access_token === "string",
  };
}

/** Exchanges a password for a token. Used only to learn an existing user's id. */
export async function signInWithPassword(
  config: AuthRestConfig,
  input: { email: string; password: string },
): Promise<{ userId: string }> {
  const payload = await call(config, "token?grant_type=password", {
    email: input.email,
    password: input.password,
  });

  const user = payload.user as { id?: unknown } | undefined;
  if (typeof user?.id !== "string") {
    throw new SupabaseAuthError("Supabase returned no user for those details.", 200);
  }
  return { userId: user.id };
}

/**
 * Asks Supabase to email a password reset link.
 *
 * Answers 200 whether or not the address is registered, which is Supabase's
 * choice and the right one: a different answer would turn this into an
 * account-existence oracle.
 */
export async function sendPasswordRecovery(
  config: AuthRestConfig,
  input: { email: string; redirectTo: string },
): Promise<void> {
  await call(
    config,
    `recover?redirect_to=${encodeURIComponent(input.redirectTo)}`,
    { email: input.email },
  );
}
