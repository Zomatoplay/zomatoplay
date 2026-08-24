/**
 * The public Supabase configuration.
 *
 * These two values are the *only* Supabase configuration the browser may see,
 * and they are safe there by design: the publishable (anon) key is a public,
 * RLS-scoped credential that identifies the project, not a user.
 *
 * The service-role key is deliberately absent from this module and from the
 * entire client bundle. It bypasses row-level security, so a copy of it in the
 * browser is a copy of the whole database. Nothing in this application needs
 * it — every privileged operation runs server-side over the Postgres
 * connection, which is a separate credential again.
 *
 * TWO SPELLINGS FOR ONE KEY
 * -------------------------
 * Supabase renamed the anon key to the "publishable" key. Both names are read,
 * newest first, so a project created under either naming works without an
 * edit. They are the same credential; setting both is harmless, and setting
 * neither is what `isAuthConfigured()` reports.
 */

export function getSupabaseUrl(): string | undefined {
  return process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || undefined;
}

export function getSupabaseAnonKey(): string | undefined {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
    undefined
  );
}

/**
 * Whether authentication is configured.
 *
 * When it is not, the application does not silently fall back to a demo
 * account — it shows the sign-in page and says authentication is unavailable.
 * A prototype that logs you in as somebody when auth is misconfigured is worse
 * than one that refuses.
 */
export function isAuthConfigured(): boolean {
  return Boolean(getSupabaseUrl() && getSupabaseAnonKey());
}

export function requireSupabaseConfig(): { url: string; anonKey: string } {
  const url = getSupabaseUrl();
  const anonKey = getSupabaseAnonKey();
  if (!url || !anonKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY " +
        "(or NEXT_PUBLIC_SUPABASE_ANON_KEY) are not set. Copy them from the " +
        "Supabase dashboard (Project Settings → API) into .env.local — see " +
        ".env.example.",
    );
  }
  return { url, anonKey };
}
