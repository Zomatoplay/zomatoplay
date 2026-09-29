# Nanotron — Full System Audit

**Date:** 2026-09-30 · **Base commit:** `f508c8f` · **Branch:** `main`

**Scope:**
- the operator sign-in failure;
- phone-only customer auth;
- the localhost test sign-in (customer and operator);
- RDS connectivity and migration readiness;
- admin-configured Telegram support;
- a deposit regression pass;
- a whole-application audit.

This supersedes the 2026-09-28 report.

Classification used throughout: **PASS**, **WARNING**, **FAIL**,
**NOT TESTED**, **BLOCKED**, **NEEDS HUMAN REVIEW**.

> **Security note: read this first.** While I was diagnosing the RDS URL, a Node
> error message echoed the *truncated* `DATABASE_URL` into the session output.
> That exposed the database username and the part of the RDS password before its
> `#`. It was not written to any file, commit or log in the repository.
> **Rotate the RDS master password.** When you set the new one, percent-encode
> any `#`, `@`, `/` or `%` in it inside the URL.

---

## 1. Requested changes completed

| Request | Status |
|---|---|
| Customer auth is mobile number + OTP; old email login removed from the customer path | **PASS.** The email pages and `completeSignIn` are switched off unless `LEGACY_EMAIL_SIGN_IN=true`. The code is kept (§20). |
| Remove dummy customer email auth/data safely | **PASS (auth side)** / **NEEDS HUMAN REVIEW (data).** The email-login test customer is no longer created. No database row was provably safe to delete (§19). |
| Localhost-only test customer (fixed number + code) | **PASS** |
| Fix operator sign-in ("Could not verify operator access") | **PASS.** The root cause was configuration, fixed locally (§3). |
| Operator auth made OTP-based | **PASS (code)** / **NOT TESTED (real email delivery)** |
| Localhost-only test operator + code | **PASS** |
| RDS migration and verification | **BLOCKED.** RDS is in a private VPC subnet (§6, §7). |
| Settings → Support → Contact Support → Telegram | **PASS** |
| Admin → Settings → Customer support → Telegram URL | **PASS** |
| Customer button uses the admin-configured URL | **PASS** |
| Deposit regression | **PASS** (§9) |
| Broad audit, two verification passes, this report | **PASS** |

## 2. Customer authentication status

| Item | Result |
|---|---|
| `/login` is mobile number → OTP only, with no email link | **PASS** (browser, 360 + 1280) |
| `/login/email`, `/signup`, `/forgot-password` → 307 `/login` | **PASS** (dev and production builds) |
| `completeSignIn` refuses and signs out when the legacy switch is off | **PASS** (code) |
| `/update-password`, `/reset-password` still served | **PASS.** Operator password resets land there, so they were deliberately not gated. |
| New number → new account → profile step (no phone field for a verified number) | **PASS** (local test path) |
| Existing number → straight to `/` | **PASS** (1280 run) |
| Wrong code → "Invalid or expired OTP." | **PASS** |
| Expired code (TTL 30 s, correct code submitted at 35 s) → refused, no cookie | **PASS** |
| Session cookie: httpOnly, SameSite=Lax, 14 days | **PASS.** `Secure` is only set in production; `secure: false` was observed on http localhost. |
| Logout → `/login`, cookie cleared | **PASS** |
| Replaying the pre-logout cookie → `/login` (epoch revocation) | **PASS** |
| Protected routes redirect when signed out | **PASS** |
| Real Firebase SMS OTP (send, verify, resend, per-number limits) | **NOT TESTED.** No device and no Firebase test number; not faked. |
| Duplicate phone / never-merge / E.164 | **PASS.** `phone-auth.integration` 6/6, plus the `phone-identity` and `phone` unit tests. |

The server still trusts nothing the browser says about identity:
- Real sign-in verifies a Firebase ID token server-side.
- The local path compares server-held values, then runs the same account and session code.

## 3. Operator authentication status

**Root cause of "Could not verify operator access. Try again.": PASS (found and fixed locally).**

1. `.env.local` had gained `DATABASE_URL` / `DIRECT_DATABASE_URL` for RDS
   *below* the Supabase ones, and the later definition wins.
2. The RDS password contains an unquoted `#`. dotenv treats it as the start of a
   comment, so the application received a **36-character, invalid URL** and
   every database call failed. The operator lookup failure was reported,
   correctly, as the *retryable* infrastructure outcome, and that outcome's
   message is exactly the one you saw. It was never an authorization verdict.
3. Even with the `#` encoded as `%23`, the RDS host resolves to a **private
   `172.31.x.x` address** and the connection times out, because the instance
   is not publicly accessible.

The fix was applied to `.env.local`, which was backed up first; no values were printed:
- `#` became `%23` on the RDS lines.
- Those two lines are commented out with an explanation, so local development uses the reachable Supabase dev database again.

I verified that the dev operator credential signs in and resolves to the active master admin with 13 grants. The root cause needed no code change, and the error message was not changed.

| Item | Result |
|---|---|
| Operator sign-in: work email → emailed one-time code (`signInWithOtp`, `shouldCreateUser: false`) → `verifyOtp` | **PASS (code)** |
| Same answer for known and unknown emails (no enumeration) | **PASS (code)** |
| Authorization unchanged: `completeOperatorSignIn` → `admin_agents` → permissions | **PASS** |
| Real Supabase email code delivery | **NOT TESTED.** I didn't send real email; SMTP needs confirming first (§21). |
| Password form | Kept as a secondary option: **NEEDS HUMAN REVIEW** (§21) |
| Customer (phone session) opening `/admin` or `/admin/settings` → `/admin/login` | **PASS** (browser) |
| Customer cannot become an operator | **PASS.** A phone customer has no Supabase identity, `admin_agents` is looked up only by Supabase `auth_user_id`, and there is no role column on `users`. |
| Wrong operator code → "Invalid or expired code." | **PASS** |

**Architecture chosen: Option A** (work-email identity, with the OTP as the proof). The existing model already uses Supabase for operator identity, and Supabase supports email OTP, so nothing about `admin_agents` or permissions changed.

Option B (operator phone OTP) was not done. It would need a second identity link on `admin_agents`, and it would put operators on the customers' Firebase project.

## 4. Localhost test authentication status

| Item | Result |
|---|---|
| Customer: `DEV_TEST_CUSTOMER_PHONE` + `DEV_TEST_CUSTOMER_OTP` on `/login` | **PASS** |
| Operator: `DEV_ADMIN_EMAIL` + `DEV_TEST_ADMIN_OTP` on `/admin/login` → real master-admin record | **PASS** |
| Gates: `NODE_ENV=development` (inlined at build), `DEV_TEST_AUTH=true`, a localhost `Host`/`X-Forwarded-Host`, and the values configured | **PASS.** `dev-test-auth.test.ts` 11/11, including look-alike hosts and forwarded public hosts. |
| Production build, `DEV_TEST_AUTH=true`, localhost: no banner on either login page | **PASS** |
| Production build: all four local-test actions called directly with the **correct** codes → refused, no cookie | **PASS** |
| Production bundle: `DEV_TEST_AUTH` absent from server output; no test code, admin password or session secret value anywhere in `.next/` | **PASS** |
| A challenge token cannot be used as a session cookie, and vice versa | **PASS** (unit test) |

The values live in `.env.local` (git-ignored), in the "LOCAL TEST SIGN-IN" block:
- The test number is `+91 99999 00001`; I checked that it's unused in the dev database.
- The two codes were generated randomly and aren't printed anywhere.
- Accounts created this way carry a `dev-local:` Firebase uid.
- `.env.example` documents the variables without values.

**Why not Firebase fictional test numbers:** they're configured per Firebase
*project*. This deployment uses one project for every environment, so a test
number added for localhost would also sign in on the production domain.

## 5. Firebase status

| Item | Result |
|---|---|
| Web config and project id present locally; `CUSTOMER_SESSION_SECRET` now set locally (64 chars) | **PASS** |
| Server verifies ID tokens with the public project id only; no service-account key anywhere | **PASS** |
| Authorised domains: localhost, the two Firebase defaults and one IP; **production domain missing** | **FAIL (configuration).** Carried over from 2026-09-28; still to do in the console. |
| An SMS region policy exists (it refused a US number); is India allowed? | **NOT TESTED** without a real SMS |
| Real SMS end to end | **NOT TESTED** |
| Environment separation: one Firebase project for all environments | **WARNING.** This is why fictional numbers are unsafe here (§4). |

## 6. RDS connectivity status

**BLOCKED.**

- Nanotron reads two variables:
  - `DATABASE_URL`;
  - `DIRECT_DATABASE_URL`, used for migrations, which falls back to `DATABASE_URL`.
- Target, identified from the URL without connecting: AWS RDS, `ap-south-1`, database `nanotron`.
- DNS resolves to a private `172.31.x.x` address, and TCP 5432 from this machine times out.
- No SSH key, AWS CLI or Session Manager is configured here, so there's no tunnel.
- Consequently the following are unknown:
  - the PostgreSQL version;
  - the migration state;
  - whether the database is empty, staging or production;
  - its data counts.
- Per the brief, nothing was modified.

## 7. RDS migration status

**BLOCKED: not applied.** Prepared instead:

- **`npm run db:verify`** (new, read-only, runs inside `BEGIN READ ONLY`). It:
  - names the target by kind and region;
  - compares `drizzle.__drizzle_migrations` with the journal and lists pending migrations;
  - checks every table, plus the columns this code reads:
    - `users.firebase_uid`, `users.phone_e164`, `users.session_epoch`;
    - `deposit_requests.cancelled_at`, `deposit_requests.cancellation_reason`;
    - `kyc_documents.storage_backend`;
  - **pre-checks that migration 0020's unique index can build** (no account with two `awaiting_payment` requests);
  - prints aggregate counts;
  - exits 1 on anything that must be fixed first.

  I ran it against the dev database, and against the RDS URL, where it timed out cleanly with a VPC hint and printed no credentials.
- **All 22 migrations were reviewed for destructive statements.** None deletes or truncates data:
  - the `DROP`s rebuild an index or constraint, or relax `NOT NULL`;
  - the two `UPDATE`s are backfills (`deposit_addresses` history, `deposits.acknowledged_at`).
- **Runbook:** `docs/rollout-phone-s3-deposits-pwa.md` §0. On the EC2 host: snapshot → `db:verify` → `db:migrate` → `db:verify`, then compare. **Skip `db:secure` on RDS**; it's Supabase-only.

## 8. Database integrity checks (development database)

| Item | Result |
|---|---|
| `db:verify` on Supabase dev: 22/22 migrations, 38/38 tables, every needed column, the `cancelled` enum value, the one-awaiting index | **PASS** |
| `schema.integration` (live schema vs declared in both directions, enums, FKs, no float money) | **PASS** |
| Counts: 89 users, Σ available 95347.81732188, 38 deposits, 594 ledger rows, 48 investments, 30 KYC documents, 22 referrals. Unchanged by this pass's code (no migration). | **PASS** |
| Rows written by testing, all in the dev database: one `dev-local:` customer (empty wallet); 4 `cancelled` deposit requests from the browser run, plus the integration suites' usual fixtures; the Telegram test value set and then cleared (both audited); support hours changed and restored | recorded |

## 9. Deposit regression results

| Case | Result | Evidence |
|---|---|---|
| Create request (DEP id, exact amount, one address) | **PASS** | Browser 360 + 1280 on the production build; lifecycle tests |
| Change amount → old request cancelled (`amount_changed`), new id and amount | **PASS** | Browser + DB rows |
| Leave page → confirmation → `cancelled` (`left_page`), rows kept | **PASS** | Browser + DB rows |
| A request with a submitted hash cannot be cancelled | **PASS** | `deposit-request-lifecycle` |
| A matched or paid request cannot be erased | **PASS** | Lifecycle |
| Paid after cancel → credited once; the amount stayed reserved | **PASS** | Lifecycle |
| Same hash twice / "already processed" | **PASS** | Lifecycle + `deposit-request` |
| Malformed hash | **PASS** | Browser |
| Wrong recipient, wrong token, wrong amount, expired window, another user's hash, scanner replay, concurrent verification, no double credit | **PASS** | `deposit-request.integration` 8/8, `tron.test`, lifecycle 11/11 |
| One awaiting request per user, enforced by the database | **PASS** | Lifecycle |

The only deposit change in this pass is passing the support URL through as a prop.

## 10. Telegram support status

**PASS.**

- **Admin → Settings → Customer support card.** A "Customer Support Telegram URL" field with its own Save/Clear, disabled without `settings`/`manage`.
- **`updateSupportTelegramAction`:**
  - calls `requirePermission("settings")`;
  - validates server-side to a bare Telegram username of 5–32 characters. It accepts `t.me` and `telegram.me` links and `@name`, and refuses other hosts, paths, queries, fragments, invite links and `javascript:`;
  - locks the row with `SELECT … FOR UPDATE`;
  - writes an audit entry with the old and new values;
  - drops the catalogue cache.
- **Storage:** `platform_settings.platform.supportTelegram`. One source, and no migration (it's jsonb).
- **General settings form:** it never sees the key (the mapper strips it), and its save carries the stored value over in SQL, so it can neither clear nor forge it. **Verified in the browser.**
- **Customer side**, all from `getSupportTelegramUrl()`, which re-validates on read:
  - Settings → Support → Contact support shows the Telegram link, or "Telegram support is currently unavailable. Email …";
  - the Help centre button;
  - the deposit screen's button for unresolved outcomes.
- **Browser run:**
  - an invalid URL was blocked;
  - a test handle was saved, and the customer link became `https://t.me/e2e_test_only_handle` at 360 and 1280;
  - it was then cleared, and the customer saw "currently unavailable".
- **The real handle isn't set**; I didn't invent one.
- `NEXT_PUBLIC_SUPPORT_TELEGRAM` has been removed.

## 11. S3 status

**NOT TESTED.** `KYC_STORAGE_DRIVER`, `KYC_S3_BUCKET` and a region aren't set here, and there's no bucket.

The design is unchanged since 2026-09-28:
- a private-by-default adapter with opaque keys;
- a 5-minute presigned PUT that signs the exact type and length;
- an own-prefix check before `HeadObject`;
- a 120-second reviewer GET after a `kyc`/`view` check;
- no ACLs;
- credentials from the instance role.

`s3-kyc-store.test.ts` passes in both passes.

## 12. PWA status

Unchanged in this pass:
- The service worker caches hashed static assets and `/offline.html` only.
- Navigations are network-only.
- There's no caching of RSC payloads, API responses, auth or the CRM.

Install on real devices: **NOT TESTED**.

## 13. Security findings

| Finding | Class |
|---|---|
| Partial RDS password exposed in session output during diagnosis | **FAIL → rotate** (top of report) |
| The RDS password contained an unencoded `#` in the URL | **FIXED locally.** Documented for EC2 (runbook §0). |
| RDS not publicly accessible | **PASS** (good posture) |
| No secret, test code or session secret in the build output | **PASS** |
| Local test sign-in cannot run in a production build | **PASS** (§4) |
| The Telegram link cannot become an arbitrary URL | **PASS** |
| `CRON_SECRET` not set locally; cron routes refuse without it (by design) | **WARNING.** Set it on EC2. |
| `applyReferralCode` is unauthenticated (by design, pre-signup), not rate-limited, and confirms whether a code exists | **WARNING.** Codes are shared publicly by design. |
| The operator password form remains | **NEEDS HUMAN REVIEW** |
| Legacy email (Supabase) sessions can't be revoked server-side | **WARNING.** A documented limitation (§20.3). |

## 14. Authorization findings

- **Server actions: PASS.** All 56 exported server actions were checked:
  - every admin action calls `requirePermission` first;
  - every customer action resolves the account from the session;
  - none takes a `userId`.

  The exceptions are by design: `applyReferralCode` (pre-signup), the two sign-in completions, and the four local-test actions (gated).
- **ID-taking customer actions: PASS.** `getDepositRequestAction`, `cancelDepositRequestAction`, `acknowledgeDeposit` and `endAllocationAction` scope by the session's user in the query.
- **API routes: PASS.**
  - `/api/cron/*` uses a constant-time `CRON_SECRET` check and refuses when it's unset.
  - `/api/trace` does its work in `after()` and resolves the account itself.
- **Customer → admin: PASS.** Redirected to `/admin/login` (browser).
- **Operator permission denial: PASS (integration).** An agent without `settings`/`manage` is refused in `auth-and-kyc.integration`'s permission tests. Not re-driven in a browser, since there's no agent credential.

## 15. Performance findings

Measured on the production build with a real customer session and 8 s idle gaps, against the dev database in Seoul (about 200 ms per round trip from here):

| Route | TTFB | Complete |
|---|---|---|
| `/` | 50–66 ms | 1.1–1.3 s |
| `/wallet` | 51–57 ms | 1.3–1.4 s |
| `/plans` | ~52 ms | 0.8 s |
| `/referral` | 60 ms | 1.4–1.6 s |
| `/settings` | ~68 ms | 0.8 s |
| `/wallet/deposit` | 42–56 ms | 0.75 s |
| `/wallet/transactions` | 43–56 ms | 0.75 s |
| `/settings/support` | 42–45 ms | 0.72–0.74 s |

- First bytes arrive immediately, because the shell streams. Totals are dominated by round trips, as §16.1a predicts.
- From EC2 in `ap-south-1` to RDS in the same region, round trips should be single-digit milliseconds, so these totals are an upper bound. **Re-measure on EC2.**
- First-load JS: 102 kB shared, 132–159 kB for customer routes, and up to 200 kB for `/login/email` and `/admin/login`.

## 16. Heavy / expensive areas

| Area | Observation | Recommendation |
|---|---|---|
| `/referral` | The slowest customer route (~1.5 s here) | Measure on EC2 before changing anything. |
| Deposit screen poll | One server action every 5 s while a request is open and the tab is visible, with no overlap. Chain work at most once a minute, floored server-side at 20 s per account. | Acceptable. Don't grow it into a scheduler. |
| `/admin/notifications` | Reads every campaign, unbounded | Paginate when campaigns grow. **WARNING** |
| Per-user lists (a user's investments, referrals, commissions) | Unbounded per account | Fine at current volumes. |
| Customer auth bundle | `/login` first load is 159 kB (Firebase auth) | Acceptable. |
| Integration test suite | About 40 minutes against the remote dev DB (latency-bound) | A local Postgres for CI would cut it sharply. |

Nothing expensive was changed in this pass, and nothing that touches money was "optimised".

## 17. Bugs found and fixed

1. **Operator sign-in failing.** Configuration (§3), fixed in `.env.local`.
2. **Customer email sign-in was still reachable** from `/login` and callable server-side. It's now behind `LEGACY_EMAIL_SIGN_IN`, including the action.
3. **The CRM's "send password reset" to a customer** would have mailed a reset for a login that no longer exists. It now refuses while the switch is off.
4. **`npm run db:dev-accounts` created an email-and-password dummy customer** with a placeholder phone number. That target is removed.
5. **The Telegram destination was a build-time env var** that an operator couldn't change. It's now configured in the CRM (§10).

Re-verified from the previous pass:
- a stale poll could bring back a replaced request;
- Verify Payment could queue behind a scan.

## 18. Bugs still present

| Issue | Class |
|---|---|
| `auth-and-kyc`: "holds exactly the seeded number of accounts" fails. Its upper bound is 50, but there are 89 users because integration tests leave 56 `@example.invalid` users behind. Pre-existing, and it contradicts §16.7's rule. | **FAIL (test)** |
| `deposit-confirmation`: "the historical backfill left no seeded deposit unannounced". Pre-existing and dependent on fixture state. | **FAIL (test)** |
| New phone customers have no manual invite-code field, only `?ref=` links, because the only field was on the now-disabled email sign-up form. | **NEEDS HUMAN REVIEW** |
| The Settings footer says "demo build · no real funds" | **NEEDS HUMAN REVIEW** |

## 19. Potential cleanup items (not done)

- **Dev database accounts:**
  - 56 `@example.invalid` integration-test users (414 ledger rows);
  - the old `DEV_TEST_EMAIL` customer (4 deposits, 17 ledger rows, 1 investment, KYC);
  - 2 unknown email accounts.

  **Not deleted:** each carries financial or KYC rows, or can't be proven dummy.
- **30 `@example.com` seed fixtures.** These are CRM/test fixtures, not auth data.
- **`.env.local`:** `DEV_TEST_EMAIL` / `DEV_TEST_PASSWORD` are now unused.
- **Unused exports** with no live callers: `listAdminUsers`, `getAdminCommissionLedger`, `getAdminReferralAccounts`.
- **Legacy email UI:** `sign-in-form`, `sign-up-form`, `forgot-password-form`, `/login/email`, `/signup`, `/forgot-password`, `completeSignIn`. These can be removed once no active account needs linking, which is when this query returns 0:

  ```sql
  select count(*) from users
  where auth_user_id is not null and firebase_uid is null and status = 'active';
  ```
- **Legacy pool tables** (`deposit_addresses`, `deposit_address_assignments`). These are evidence; see §18.8.
- **CLAUDE.md §3 lists `motion`**, which isn't a dependency.

## 20. Items intentionally not removed

- Operator/admin Supabase authentication.
- `/update-password` and `/reset-password` (operator resets).
- Database email columns and historical email data.
- The legacy email sign-in code (switched off, not deleted).
- Every dev-database row listed in §19.
- The legacy deposit pool tables.
- The password form on `/admin/login`.

## 21. Items requiring human review

1. **Rotate the RDS password** (§13), encoding special characters in the URL.
2. **Supabase SMTP for operator codes.** Authentication → Emails → SMTP must be a production sender, and the template must include `{{ .Token }}`. Then decide whether to remove the operator password form.
3. **Does RDS hold customers who signed up by email?**
   - If yes, set `LEGACY_EMAIL_SIGN_IN=true` for a migration window and tell those customers.
   - If it's empty or new, leave it off.
4. **Firebase:** add the production domain to authorised domains, and confirm the SMS region policy allows India.
5. **Set the real Telegram handle** in Admin → Settings → Customer support.
6. **Invite-code entry** for phone sign-ups (§18).
7. **The "Demo build · no real funds" footer** copy.
8. **Whether to clean the dev database's test leftovers.** That would delete ledger rows, so it's a deliberate decision, not a cleanup.

## 22. Tests performed

**Pass 1 (after implementation)**
- `typecheck` and `lint`: clean.
- `npm test` without a database: **205/205**.
- `npm test` against the dev database: two runs covering all 38 files. The first stopped at a 25-minute limit, and the remaining 21 files were run separately. Everything passes except the two pre-existing tests in §18.
- Browser (dev server, headless Chrome over CDP). No console errors or horizontal overflow on any screen:
  - **Operator (1280):**
    - local sign-in;
    - wrong code refused;
    - console opens;
    - Telegram: invalid URL blocked, save, preserved through a general settings save, then restored.
  - **Customer (360 and 1280):**
    - local sign-in;
    - wrong code refused;
    - profile step;
    - Telegram link in Settings;
    - security row;
    - a customer sent back from the CRM;
    - logout;
    - revoked-cookie replay.
  - **Also:**
    - expired code refused;
    - legacy pages redirect;
    - Telegram cleared (360).
- DB: an audit entry for every settings change, and platform settings restored.

**Pass 2 (after all changes)**
- `typecheck` and `lint`: clean. Production `build`: success.
- Bundle inspection: no secret or test-code values, and the gate is compiled out.
- Production server with `DEV_TEST_AUTH=true` on localhost:
  - no test banners;
  - the four local-test actions refused, even with the correct codes;
  - the legacy pages redirect.
- Deposit UI regression at 360 and 1280, with DB states confirmed:
  - create;
  - change amount;
  - malformed hash;
  - leave → cancel;
  - Settings support fallback;
  - security row.
- Route timings (§15).
- `npm test` without a database: **205/205**.
- Key DB files re-run (`phone-auth`, `deposit-request-lifecycle`, `deposit-request`, `schema`, `auth-and-kyc`, `writes`): **65/66**. The one failure is the pre-existing exact-count test.

## 23. Tests blocked by environment

| Test | Class |
|---|---|
| RDS: connectivity, version, migrations, counts | **BLOCKED** (private VPC) |
| Real Firebase SMS OTP (send, resend, per-number limits, region policy for India) | **NOT TESTED** |
| Real Supabase operator email code | **NOT TESTED** |
| S3 upload/download | **NOT TESTED** (no bucket) |
| PWA install on iOS/Android | **NOT TESTED** |
| A real TRON transfer end to end | **NOT TESTED.** Integration tests use recorded or synthetic chain data. |
| EC2 cron, Nginx | **NOT TESTED** |

## 24. Production readiness blockers

1. RDS not migrated or verified. Run the runbook on EC2.
2. RDS password rotation, with URL encoding.
3. `CUSTOMER_SESSION_SECRET` and `CRON_SECRET` on EC2.
4. Firebase authorised domain for production, and the India SMS policy.
5. Supabase SMTP for operator codes (or keep using the password form).
6. The legacy email decision for existing customers (§21.3).
7. An S3 bucket and instance role, if KYC documents are to be stored on AWS.

## 25. Recommended next steps

1. **On EC2, migrate RDS:**
   1. set the encoded `DATABASE_URL`;
   2. run `npm run db:verify`;
   3. take a snapshot;
   4. run `npm run db:migrate`;
   5. run `npm run db:verify` again and compare the counts.
2. **Secrets and cron:** rotate the RDS password, set `CUSTOMER_SESSION_SECRET` and `CRON_SECRET`, and install `deploy/ec2/nanotron.cron`.
3. **Firebase console:** add the production domain, confirm the India policy, then test one real SMS from a phone.
4. **Supabase SMTP:** configure it, test one operator code, then decide on the password form.
5. **Telegram:** save the real handle in the CRM.
6. **Performance:** re-measure route timings on EC2 against RDS.
7. **Test suite:** fix the fixture leak that causes the exact-count failure, and consider a local Postgres for CI.
