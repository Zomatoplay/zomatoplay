import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

/**
 * Provisions the two pieces of Supabase configuration this application needs
 * and cannot express as a Drizzle migration.
 *
 *     npm run db:secure
 *
 * Idempotent, and safe to re-run: every statement is guarded. Run it after
 * `db:migrate` and after any migration that adds a table.
 *
 * IT NEEDS NO SERVICE-ROLE KEY
 * ----------------------------
 * Everything here is ordinary SQL against `DIRECT_DATABASE_URL`, which the
 * project already holds. Supabase's storage service keeps its buckets and its
 * access rules in Postgres — `storage.buckets` and policies on
 * `storage.objects` — so the credential that runs migrations can provision
 * them. That matters: CLAUDE.md §19.6 refuses the service-role key outright,
 * and this stays inside that rule.
 *
 * ---------------------------------------------------------------------------
 * PART 1 — ROW LEVEL SECURITY, WHICH WAS OFF ON EVERY TABLE
 * ---------------------------------------------------------------------------
 * Supabase publishes the `public` schema over PostgREST at `/rest/v1/...`, and
 * grants `anon` and `authenticated` SELECT on it. Drizzle creates tables with
 * RLS disabled, because RLS is not part of a table definition. The two
 * combined meant **every application table was readable by anyone holding the
 * anon key** — which is public by design and inlined into the browser bundle.
 *
 * Verified against the live project before this script existed: an unauthenticated
 * `GET /rest/v1/users` returned full names, emails, phone numbers, KYC status
 * and wallet addresses; `wallet_balances`, `transactions`, `deposits`,
 * `kyc_submissions` and `admin_agents` were equally open. No application code
 * was involved — the API is a property of the database, and the database was
 * open.
 *
 * Enabling RLS with **no policies** closes it completely: PostgREST sees
 * nothing, and the application is unaffected because it does not connect
 * through PostgREST. It connects as `postgres` over `DATABASE_URL`, and
 * `postgres` has `rolbypassrls` — verified, not assumed. `ENABLE` rather than
 * `FORCE` is deliberate: `FORCE` would apply RLS to the table owner too and
 * lock the application out of its own data.
 *
 * ---------------------------------------------------------------------------
 * PART 2 — THE PRIVATE KYC DOCUMENT BUCKET
 * ---------------------------------------------------------------------------
 * A private bucket plus three policies. Uploads go **straight from the browser
 * to Supabase Storage**, never through this application's server, for a reason
 * that is not preference: a Vercel serverless function has a ~4.5 MB request
 * body limit, and identity documents routinely exceed it. Routing a 10 MB
 * passport scan through a server action would fail in production and work
 * everywhere else.
 *
 * That makes the *storage service* the enforcement point, which is stronger
 * than application validation rather than weaker:
 *
 *   - `file_size_limit` and `allowed_mime_types` are enforced by Storage on
 *     every upload, server-side, before an object exists. A client that lies
 *     about a file's type or size is rejected by the service, not by code that
 *     trusted it.
 *   - The INSERT policy pins the path: an object may only be written under a
 *     folder named for the uploader's own `auth.uid()`. A client choosing its
 *     own path cannot write into somebody else's folder.
 *
 * Reads are equally narrow. A person reads their own folder; an operator reads
 * the bucket only while `is_kyc_operator()` says so.
 *
 * There is **no UPDATE policy**, so an object is never overwritten — a
 * resubmission writes a new key rather than replacing one a reviewer may
 * already have acted on. DELETE exists but stops at the submission boundary: a
 * person may remove their own upload only while no `kyc_documents` row points
 * at it, which lets an abandoned upload be cleaned up and makes an attached
 * document immutable to the person it describes.
 */

/** The bucket. Private; nothing in it is reachable without a signed URL. */
const BUCKET = "kyc-documents";

/** 10 MB, the limit the flow shows the person. Enforced by Storage, not by us. */
const MAX_BYTES = 10 * 1024 * 1024;

/**
 * What Storage will accept.
 *
 * HEIC is included because it is what an iPhone produces by default. PDF
 * because a scan of a document is usually one.
 */
const MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
];

async function main() {
  const { createAdminDb, closeAdminDb } = await import("../client");

  const db = createAdminDb();
  const sql = db.$client as unknown as {
    unsafe: (query: string, params?: unknown[]) => Promise<unknown[]>;
  };

  const run = async (label: string, statement: string, params?: unknown[]) => {
    try {
      await sql.unsafe(statement, params);
      console.log(`  ok    ${label}`);
    } catch (error) {
      console.error(
        `  FAIL  ${label}: ${error instanceof Error ? error.message : error}`,
      );
      throw error;
    }
  };

  try {
    /* ------------------------------------------------------------------ */
    /* Part 1 — lock the PostgREST door on every application table         */
    /* ------------------------------------------------------------------ */
    console.log("Row level security");

    const tables = (await sql.unsafe(`
      select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
      order by c.relname
    `)) as { relname: string }[];

    let enabled = 0;
    for (const { relname } of tables) {
      // Quoted with `format(%I)` semantics by hand — these names come from the
      // catalogue rather than from input, but the quoting keeps it correct for
      // any identifier a future migration introduces.
      await sql.unsafe(`alter table public."${relname}" enable row level security`);
      enabled += 1;
    }
    console.log(`  ok    RLS enabled on ${enabled} table(s), no policies added`);
    console.log(
      "        (the application connects as `postgres`, which bypasses RLS —\n" +
        "         this closes PostgREST, not the app)",
    );

    /* ------------------------------------------------------------------ */
    /* Part 2 — the private KYC bucket                                     */
    /* ------------------------------------------------------------------ */
    console.log("\nKYC document storage");

    await run(
      `bucket "${BUCKET}" (private, ${MAX_BYTES} bytes, ${MIME_TYPES.length} mime types)`,
      `insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
       values ($1, $1, false, $2, $3)
       on conflict (id) do update
         set public = false,
             file_size_limit = excluded.file_size_limit,
             allowed_mime_types = excluded.allowed_mime_types`,
      [BUCKET, MAX_BYTES, MIME_TYPES],
    );

    /*
     * Why a SECURITY DEFINER function rather than a subquery in the policy.
     *
     * Part 1 turned RLS on for `admin_agents` and `admin_agent_permissions`, so
     * a policy body that selected from them as the invoking `authenticated`
     * role would read nothing and every operator would be denied. This function
     * runs as its owner (`postgres`), which bypasses RLS, and returns a single
     * boolean — so it discloses whether *you* are a KYC operator and nothing
     * else about the operator directory.
     *
     * `search_path` is pinned: a SECURITY DEFINER function that resolves names
     * through the caller's `search_path` can be pointed at a table the caller
     * controls.
     */
    await run(
      "function public.is_kyc_operator()",
      `create or replace function public.is_kyc_operator()
       returns boolean
       language sql
       stable
       security definer
       set search_path = public, pg_temp
       as $$
         select exists (
           select 1
           from public.admin_agents a
           left join public.admin_agent_permissions p
             on p.agent_id = a.id and p.permission = 'kyc'
           where a.auth_user_id = auth.uid()
             and a.status = 'active'
             and (a.role = 'master_admin' or p.level in ('view', 'manage'))
         )
       $$`,
    );
    await run(
      "grant execute to authenticated",
      `grant execute on function public.is_kyc_operator() to authenticated`,
    );

    // Dropped first so the script is idempotent and a changed rule actually
    // replaces the old one rather than sitting beside it.
    /*
     * Whether an object has been attached to a submission yet.
     *
     * SECURITY DEFINER for the same reason as above: `kyc_documents` has RLS on,
     * so an `authenticated` caller evaluating this as itself would see no rows
     * and conclude every object is unattached — which would let somebody delete
     * a document a reviewer was about to open.
     */
    await run(
      "function public.is_unsubmitted_kyc_object(text)",
      `create or replace function public.is_unsubmitted_kyc_object(object_name text)
       returns boolean
       language sql
       stable
       security definer
       set search_path = public, pg_temp
       as $$
         select not exists (
           select 1 from public.kyc_documents d where d.storage_path = object_name
         )
       $$`,
    );
    await run(
      "grant execute to authenticated",
      `grant execute on function public.is_unsubmitted_kyc_object(text) to authenticated`,
    );

    for (const name of [
      "nanotron kyc owner insert",
      "nanotron kyc owner read",
      "nanotron kyc operator read",
      "nanotron kyc owner delete unsubmitted",
    ]) {
      await sql.unsafe(`drop policy if exists "${name}" on storage.objects`);
    }

    await run(
      "policy: a person may write only into their own folder",
      `create policy "nanotron kyc owner insert" on storage.objects
       for insert to authenticated
       with check (
         bucket_id = '${BUCKET}'
         and (storage.foldername(name))[1] = auth.uid()::text
       )`,
    );

    await run(
      "policy: a person may read only their own folder",
      `create policy "nanotron kyc owner read" on storage.objects
       for select to authenticated
       using (
         bucket_id = '${BUCKET}'
         and (storage.foldername(name))[1] = auth.uid()::text
       )`,
    );

    await run(
      "policy: a KYC operator may read the bucket",
      `create policy "nanotron kyc operator read" on storage.objects
       for select to authenticated
       using (bucket_id = '${BUCKET}' and public.is_kyc_operator())`,
    );

    await run(
      "policy: a person may delete only their own *unsubmitted* uploads",
      `create policy "nanotron kyc owner delete unsubmitted" on storage.objects
       for delete to authenticated
       using (
         bucket_id = '${BUCKET}'
         and (storage.foldername(name))[1] = auth.uid()::text
         and public.is_unsubmitted_kyc_object(name)
       )`,
    );

    console.log(
      "  ok    no UPDATE policy, and DELETE stops at the submission boundary —\n" +
        "        an attached document cannot be removed by the person it describes",
    );

    console.log("\nDone. Re-run after any migration that adds a table.");
  } finally {
    await closeAdminDb(db);
  }
}

main().catch((error) => {
  console.error(
    "\nsecure failed:",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
