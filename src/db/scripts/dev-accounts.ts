import { config as loadEnv } from "dotenv";
import { eq } from "drizzle-orm";


import {
  signInWithPassword,
  signUpWithPassword,
  type AuthRestConfig,
} from "@/lib/supabase/auth-rest";

import { closeAdminDb, createAdminDb } from "../client";
import { isDatabaseConfigured } from "../env";
import * as t from "../schema";

/**
 * Links development sign-in credentials to seeded accounts.
 *
 * WHY THIS SCRIPT EXISTS
 * ----------------------
 * The seeded dataset has thirty users and nine operators and not one of them
 * can sign in, because none has an `auth_user_id`. That is correct — inventing
 * credentials for fixtures would mean thirty-nine sign-in-able accounts nobody
 * owns — but it leaves a fresh clone with no way into either application.
 *
 * WHERE THE PASSWORD COMES FROM
 * -----------------------------
 * Environment variables, never source and never the database:
 *
 *   DEV_ADMIN_EMAIL / DEV_ADMIN_PASSWORD   an operator, linked to admin_agents
 *
 * It used to create a customer too (`DEV_TEST_EMAIL` / `DEV_TEST_PASSWORD`),
 * an email-and-password login. Customers sign in by mobile number now, so that
 * target is gone: the local test customer is created by signing in once through
 * the local test path (`DEV_TEST_CUSTOMER_PHONE`, see dev-test-auth.ts). An
 * account a previous run created is left alone — it may carry test deposits.
 *
 * Nothing is printed but the email addresses. The password is passed to
 * Supabase and forgotten.
 *
 * HOW THE AUTH USER IS CREATED
 * ----------------------------
 * Through the ordinary public `signUp` endpoint with the anon key — the same
 * call the sign-up form makes. Deliberately *not* through the admin API: that
 * needs the service-role key, which bypasses row-level security and which this
 * project does not hold anywhere, not even in a script (CLAUDE.md §19.6).
 *
 * The cost of that choice is that email confirmation applies. If the Supabase
 * project has confirmation on, the address must be confirmed once before the
 * account can sign in; the script says so rather than pretending otherwise.
 *
 * REFUSES IN PRODUCTION
 * ---------------------
 * A development convenience that could run against production data is not a
 * convenience.
 */

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const SUPABASE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

interface Target {
  label: string;
  email?: string;
  password?: string;
  emailVar: string;
  passwordVar: string;
  link: (authUserId: string, email: string) => Promise<string>;
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to run against NODE_ENV=production.");
  }
  if (!isDatabaseConfigured()) {
    throw new Error("DATABASE_URL is not set.");
  }
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY " +
        "(or ..._ANON_KEY) must be set.",
    );
  }

  const db = createAdminDb();
  const auth: AuthRestConfig = { url: SUPABASE_URL, anonKey: SUPABASE_KEY };

  const targets: Target[] = [
    {
      label: "operator",
      email: process.env.DEV_ADMIN_EMAIL?.trim(),
      password: process.env.DEV_ADMIN_PASSWORD,
      emailVar: "DEV_ADMIN_EMAIL",
      passwordVar: "DEV_ADMIN_PASSWORD",
      async link(authUserId, email) {
        // The seeded master admin, so the console opens with full access.
        // A development account, and the script says as much in the note.
        const [agent] = await db
          .select({ id: t.adminAgents.id, name: t.adminAgents.name })
          .from(t.adminAgents)
          .where(eq(t.adminAgents.role, "master_admin"))
          .limit(1);
        if (!agent) throw new Error("No master admin row to link to.");

        await db
          .update(t.adminAgents)
          .set({
            authUserId,
            email,
            status: "active",
            note: "Development sign-in linked by npm run db:dev-accounts.",
          })
          .where(eq(t.adminAgents.id, agent.id));
        return `${agent.name} (${agent.id})`;
      },
    },
  ];

  for (const target of targets) {
    if (!target.email || !target.password) {
      console.log(
        `- ${target.label}: skipped (set ${target.emailVar} and ${target.passwordVar})`,
      );
      continue;
    }

    const email = target.email.toLowerCase();

    /*
     * Create the credential if it does not exist, then establish the
     * authoritative principal id.
     *
     * `signUp` CANNOT BE TRUSTED FOR THE ID.
     *
     * When the address is already registered, Supabase's signup endpoint
     * answers 200 with a *fabricated* user object carrying a random uuid. That
     * is deliberate on their side — a different answer would turn the endpoint
     * into an account-existence oracle — and it means a repeat run of this
     * script previously wrote a made-up id over a correct link, silently
     * locking the operator out of the console.
     *
     * So the id comes from a password sign-in, which only succeeds for the
     * real account, and `signUp` is used only for its side effect.
     */
    let authUserId: string | null = null;
    let created = false;
    let confirmationPending = false;

    try {
      const result = await signUpWithPassword(auth, {
        email,
        password: target.password,
      });
      created = true;
      confirmationPending = !result.hasSession;
    } catch {
      // Already registered, or signups disabled. Either way the sign-in below
      // is what decides whether there is a usable account.
    }

    try {
      const signedIn = await signInWithPassword(auth, {
        email,
        password: target.password,
      });
      authUserId = signedIn.userId;
      confirmationPending = false;
    } catch (signInError) {
      const message =
        signInError instanceof Error ? signInError.message : String(signInError);
      console.log(
        `- ${target.label}: ${email} — ${message}` +
          (created
            ? ". The credential exists; confirm the emailed link, then re-run."
            : ""),
      );
      continue;
    }

    if (!authUserId) {
      console.log(
        `- ${target.label}: ${email} — created, but Supabase returned no user id. ` +
          `Confirm the address, then re-run to link it.`,
      );
      continue;
    }

    const linked = await target.link(authUserId, email);
    console.log(
      `- ${target.label}: ${email} → ${linked}${created ? " (credential created)" : ""}`,
    );

    if (created && confirmationPending) {
      console.log(
        `    email confirmation is on for this project: open the link sent to ` +
          `${email} once, then sign in.`,
      );
    }
  }

  await closeAdminDb(db);
  console.log("\nDone. Passwords were never printed and are not stored here.");
}

/**
 * Grants operator access to an account that has already signed in.
 *
 * `npm run db:link-admin -- someone@example.com`
 *
 * WHY THIS EXISTS ALONGSIDE THE SCRIPT ABOVE
 * ------------------------------------------
 * Creating a credential means sending a confirmation email, and Supabase's
 * built-in sender is rate-limited to a handful an hour. When that limit is hit
 * — or when somebody has already registered through the real sign-up flow —
 * there is no credential left to create, only a link to make.
 *
 * It needs no Supabase call at all. Signing in already wrote
 * `public.users.auth_user_id`, so the principal is sitting in the database;
 * this copies it onto the operator row. No password, no email, no
 * service-role key.
 *
 * The two lookups stay independent, as §20 requires: this account is now both
 * a customer and an operator, which is a thing a principal is allowed to be.
 * It does not add a role to `public.users`.
 */
async function linkAdmin(email: string) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to run against NODE_ENV=production.");
  }
  if (!isDatabaseConfigured()) throw new Error("DATABASE_URL is not set.");

  const db = createAdminDb();
  const normalised = email.trim().toLowerCase();

  const [account] = await db
    .select({
      id: t.users.id,
      email: t.users.email,
      authUserId: t.users.authUserId,
    })
    .from(t.users)
    .where(eq(t.users.email, normalised))
    .limit(1);

  if (!account) {
    throw new Error(
      `No application account for ${normalised}. Sign up at /signup and confirm ` +
        `the email first — the account is created on first sign-in.`,
    );
  }
  if (!account.authUserId) {
    throw new Error(
      `${normalised} has an application account but no Supabase credential ` +
        `linked yet. Sign in once, then re-run.`,
    );
  }

  const [agent] = await db
    .select({ id: t.adminAgents.id, name: t.adminAgents.name })
    .from(t.adminAgents)
    .where(eq(t.adminAgents.role, "master_admin"))
    .limit(1);
  if (!agent) throw new Error("No master admin row to link to.");

  await db
    .update(t.adminAgents)
    .set({
      authUserId: account.authUserId,
      status: "active",
      note: `Development sign-in linked to ${normalised} by npm run db:link-admin.`,
    })
    .where(eq(t.adminAgents.id, agent.id));

  console.log(
    `Linked ${normalised} to ${agent.name} (${agent.id}). ` +
      `Sign in at /admin/login with that account's existing password.`,
  );
  await closeAdminDb(db);
}

const linkTarget = process.argv[2];

(linkTarget ? linkAdmin(linkTarget) : main()).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
