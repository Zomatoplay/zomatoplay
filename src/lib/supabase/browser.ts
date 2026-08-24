"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireSupabaseConfig } from "./env";

/**
 * The browser Supabase client.
 *
 * Used for one thing: the OTP exchange on the sign-in page. Everything else —
 * every read and every write of application data — goes through the server,
 * because the browser is not a place where authorization decisions can be made.
 *
 * The client writes the session to cookies (via `@supabase/ssr`), which is what
 * lets the server read the same session on the next request.
 */
let client: SupabaseClient | null = null;

export function getSupabaseBrowserClient(): SupabaseClient {
  if (!client) {
    const { url, anonKey } = requireSupabaseConfig();
    client = createBrowserClient(url, anonKey);
  }
  return client;
}
