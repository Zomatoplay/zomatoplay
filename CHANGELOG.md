# Changelog

Factual record of development on Nanotron. Newest first.

---

## 2026-09-02c (KYC document storage, RLS, Flexible Reserve withdrawal)

### 0. Every application table was readable by anyone with the anon key

Found while checking where KYC documents could safely live. Supabase publishes
`public` over PostgREST at `/rest/v1/...` and grants `anon` SELECT; Drizzle
creates tables with RLS off, because RLS is not part of a table definition.
Verified against the live project *before* any change:

    GET /rest/v1/users            -> 200  full names, emails, phones, KYC status
    GET /rest/v1/wallet_balances  -> 200  every balance
    GET /rest/v1/kyc_submissions  -> 200  legal names, DOB, addresses
    GET /rest/v1/transactions     -> 200  every ledger entry
    GET /rest/v1/admin_agents     -> 200  the operator directory

…using the key that is inlined into the browser bundle. No application code was
involved.

`npm run db:secure` enables RLS on all 32 tables with **no policies**, which
closes PostgREST completely. The app is unaffected: it connects as `postgres`,
which has `rolbypassrls` (verified, not assumed). Every table now returns `[]`
to `anon` and to a signed-in customer, and there is a regression test that reads
all ten sensitive tables as both.

### 1. KYC documents are real now

Private Supabase Storage bucket, 10 MB limit, MIME allow-list, keys shaped
`{auth_user_id}/{kind}-{ts}-{rand}.{ext}`. `kyc_documents` gained
`storage_path`, `content_type` and `byte_size` (migration `0007`), all nullable
because pre-storage rows have no object.

**The browser uploads straight to Storage** — a Vercel function has a ~4.5 MB
body limit and the flow accepts 10 MB, so a server-action upload would work in
development and fail in production. That puts enforcement in the storage
service, which is stronger: type and size are checked before an object exists,
and the INSERT policy pins every object to the uploader's own folder. The server
then re-reads the object and records what actually landed, not what was claimed.

Four policies: owner-insert, owner-read, operator-read via
`is_kyc_operator()`, and delete restricted to *unsubmitted* uploads via
`is_unsubmitted_kyc_object()`. No UPDATE policy at all, so a resubmission writes
a new key and an attached document cannot be deleted by its subject. Reviewers
open documents through a 120-second signed URL minted after
`requirePermission("kyc", "view")`. **No service-role key anywhere.**

Twelve tests, every one using a real user JWT against the live project — nothing
runs as `postgres`, which would bypass RLS and pass while the bucket stood open.

### 2. The investment reward rule — reported, not implemented

Unchanged, deliberately. `recordInvestmentEarning()` remains uncalled. The
detail is in the report; the short version is that a plan sells an
`estimated_return_range` and `estimated_return_percent` is a point inside it, so
paying `projected_profit ÷ periods` would convert a projection into a guarantee.
`payoutDelayDays` turns out to be a **referral** setting, not an investment one.

### 3. Flexible Reserve can be ended by the customer

The product defines this in four places, with no fee and no forfeiture.
`endOpenEndedInvestment()` verifies ownership, refuses fixed-term plans, honours
`allowEarlyExit`, and delegates to `matureInvestment()` rather than duplicating
the money path — so the guard that makes it idempotent is the one already
tested. Fixed-term early exit stays unimplemented because its fee and forfeiture
arithmetic does not exist.

### 4. Cron

Both routes reject unauthenticated, wrong-secret and customer-session requests
(401), and refuse everybody when `CRON_SECRET` is unset. Two new tests pin the
catch-up property: maturity selects on `matures_at <= now` so one pass clears a
forty-day backlog, and the schedule is *recomputed from `started_at`* rather
than incremented, so a missed run cannot drift. `*/5` and `0 * * * *` require
the Pro plan; Hobby allows one invocation per day.

### 5. Financial audit

No new bugs. Confirmed: nothing writes `wallet_balances` outside
`wallet.repository.ts`; `total_profit` is raised only by rewards and commission,
never by a principal return; every user money action takes its identity from the
session with no `userId` parameter; withdrawal fees and the payout rate are
computed server-side from constants, not accepted from the client; the bank
account is ownership-checked. `recordCommission()` in `account-write.service` is
a second, **uncalled** commission path — worth deleting or wiring, noted rather
than touched.

### Verification

`typecheck`, `lint`, `build` clean. **159 tests pass, 0 fail** (was 142).
All user and admin routes 200 after the RLS change, zero server errors.

---

## 2026-09-02b (money lifecycle, referral attribution, KYC feedback)

Five priorities, worked in order. Nothing was redesigned; four of the five were
completed by finding the piece that had no caller.

### 1. The allocation lifecycle had no ending

`createInvestment` and `matureInvestment` were both implemented and correct, and
**nothing called the second one**. A real allocation took the money and froze:
`elapsed_days` never moved, the term progress bar stayed where it was stamped,
and the row sat `active` indefinitely past its own `matures_at` with the
principal still counted as locked. Nobody's capital ever came back.

- `/api/cron/settle-investments` (hourly, `CRON_SECRET`, same shape as the
  deposit scan) matures what is due and recomputes each running allocation's
  `elapsed_days` / `next_reward_at` / `next_reward_amount` from `started_at` —
  recomputed rather than incremented, so a missed run cannot drift.
- `createInvestment` now stamps the reward schedule. It left both columns null,
  so every allocation a *real* user made read "next reward —" for ever while
  every seeded one looked correct. The arithmetic is the seed's own:
  `projected_profit ÷ (duration_days ÷ period_days)` — Balanced Growth's 90 days
  weekly on 300 USDT gives 23.33, and the seed says 23.4.
- `isCronRequestAuthorised` extracted so both job routes share one timing-safe
  comparison.

**Two bugs found by testing this, one of them mine.** A plan whose only reward
falls exactly on maturity got no schedule at all (`>=` where `>` was meant). And
`duration_days: 0` is not a missing value — it is Flexible Reserve, sold as "no
fixed term — funds stay allocated until you withdraw them" — so `matures_at`
equals `started_at` and the first version of the settler **force-matured every
open-ended allocation on its first pass**, returning principal from a product
whose entire point is that the customer chooses when. The job now filters
`duration_days > 0`, there is a test named for it, and the four allocations the
buggy pass had already returned (7,900 USDT across four seeded accounts) were
repaired with compensating ledger entries rather than by deleting rows.

**The reward *amount* is the one rule this codebase does not define, and nothing
credits one.** A plan sells an `estimated_return_range`;
`estimated_return_percent` is a point inside it. Paying `projected_profit ÷
periods` on a schedule would turn a projection into a guarantee — a product and
compliance decision, not a gap in the plumbing.

### 2. Referral codes were validated for shape and nothing else

A well-formed but wrong code passed every check, was stored, and was silently
dropped at account creation: the person believed they had used their friend's
code and the friend never appeared. `applyReferralCode` now resolves it against
a real, `active` account server-side and refuses with a message. Clearing the
field now *deletes* the cookie, which is what makes manual entry actually beat a
`?ref=` the middleware already captured.

Verified end to end against the real database by driving `completeSignIn` with a
referral cookie: a `referrals` row, `referred_by_code`, `referral_count` and
`referral_accounts.direct_referrals` all landed; an invalid code produced an
unattributed account and touched no counter.

### 3. KYC: the rejection reason was stored, tested, and invisible

`rejectKyc()` requires a reason, its comment calls it "what the user is shown",
and there is a test named "rejection stores the reason the user is shown".
Nothing showed it. A rejected person saw a red badge and had no way to learn
what to fix. Added `getOwnKycCase()` — session-scoped, projecting status, reason
and two timestamps and nothing else — and surfaced it above the form.

### 4. Admin ↔ user synchronisation

Audited all 28 operator actions: **every one has a `requirePermission` check**,
and revalidation coverage is otherwise complete. One real gap — a sent campaign
revalidated only `/settings/notifications`, so the unread badge in `TopBar` (on
every user page) and Home stayed silent until the person opened that one screen.

### 5. TRON: verified, not extended

Config, contract, deposit address, detection, solidification, amount scaling and
idempotency all verified against live Shasta (16 unit tests, plus an inspect run
that finds the 1,000 USDT transfer and reports it correctly). No behaviour
changed.

Documented the analysis that was missing: **a tx-hash claim flow is the obvious
shortcut and is unsafe on its own.** The chain is public, so anyone can watch a
shared deposit address, see a stranger's transfer land and submit that hash
first; verifying the hash proves the transfer happened and nothing about who is
asking. Per-user addresses or sender-address binding are what make it safe, and
both are decisions rather than code.

### Verification

`typecheck`, `lint`, `build` clean. **142 tests pass** (was 136; six added).
All user and admin routes 200 with zero server errors, zero failed
`pipeline_events`, zero connect retries. Every account whose history went
through `applyLedgerEntry` reconciles exactly; the 26 that do not are seeded
fixtures, whose balances the seed writes directly rather than building from a
ledger.

---

## 2026-09-02 (admin console latency, log timestamps, referral completion)

### 1. The console was doing four database round trips to render one screen

Measured with a temporary probe (`src/server/probe.ts`, `NANOTRON_PROBE=1` for
spans, `=sql` for per-statement connection ids) against a production build with
a real operator session. A warm admin page load was **two sequential waves of
~370ms**, and the waves contained four reads of which one was the page's own:

| | |
|---|---|
| `auth.getPrincipal` | 10–15ms (local ES256 verify — not the problem) |
| wave 1 | operator lookup **+ the page's own read** |
| wave 2 | platform settings + admin agents + agent permission grants |

Three defects, all structural, none of them a slow query — server-side execution
for the worst offender (`/admin/system-logs`) is **0.338ms**; everything else is
round trips and transfer.

- **The console shell read the whole operator directory on every page.** Two
  statements (`admin_agents`, then `admin_agent_permissions`, sequentially) to
  serve two screens: `/admin/agents`, which already read its own fresher copy,
  and `/admin/audit-logs`, which resolves actor names against it. Both read it
  themselves now. `AdminShellData` is one row. This also fixes a staleness bug —
  a layout does not re-run on a client navigation, so the audit log was
  resolving names against the directory as it looked when the console opened.
- **The layout awaited the operator, then the shell.** `getAdminShell()` takes
  no argument from the operator. They now start together, after the free local
  principal check. The gate is unchanged and still decides before anything
  renders; the exposure added is that a caller holding a verified Supabase JWT
  who is *not* an operator can cause one `platform_settings` read whose result
  is never sent to them.
- **`listAdminAgents` ran its two statements in sequence.** They are
  independent. Now one wave.

Also: the console layout had no `traceRender`, so its events took the immediate
path in `recordPipelineEvent` and became **two `INSERT`s per page load, issued
while the page was still rendering**, from the same five-connection pool.
Wrapped, they buffer into one insert behind `after()`. §22.1a said recording
must never be measurable; it was.

And `/api/trace` resolved a *customer* account on every beacon — including the
one that rides every admin navigation, where it can only ever return null
(operators are `admin_agents`, not `public.users`). Skipped when every event in
the batch is an `/admin/*` route.

**Before → after**, production build, real session, medians:

| route | serial before | serial after |
|---|---|---|
| `/admin` | 3041ms | 1295ms |
| `/admin/plans` | 780ms | 425ms |
| `/admin/audit-logs` | 768ms | 439ms |
| `/admin/agents` | 1000ms | 452ms |
| `/admin/deposits` | 1390ms | 481ms |
| `/admin/users` | 848ms | 649ms |

Rapid navigation — eight page loads fired 120ms apart, six samples after the
change against two before:

| | p50 | wall |
|---|---|---|
| before | 2497–2550ms | 3285–3351ms |
| after | 842–1480ms (median 1333) | 1906–3660ms (median 2416) |

Zero 500s, zero `EMAXCONNSESSION`, zero `CONNECT_TIMEOUT`, zero
`database.connectRetry` rows across every run.

**What was *not* the cause, stated so nobody re-tests it:** the pool (it was
already raised to 5 and 18-way concurrency showed no deadline breaches); missing
indexes (`pipeline_events_occurred_idx` is used, execution is 0.3ms); data
volume (33 users, 34 audit rows, the system log capped at 200);
`auth.resolveAccount`/`auth.resolvePrincipal` (10–15ms warm, and on admin routes
they came from the trace beacon, not the page).

**What could not be fixed:** abandoned navigations are not cancelled. Measured —
abort the client fetch at 60ms and the server still issues every query. Next
does not stop rendering when the browser stops listening, and nothing threads an
abort signal into postgres.js. Making each render cheaper is the only lever, and
that is what the above does.

`/admin/system-logs` is unchanged at ~1050ms and is transfer-bound: 200 rows
carrying a jsonb `metadata` column, ~213KB, on a link with a ~200ms RTT. The
screen filters and expands that data client-side, so trimming it means paging
server-side — a redesign, not an optimisation.

### 2. Why the system log read 18:00 when the testing was at 23:00 IST

Nothing was wrong with any timestamp. `pipeline_events.occurred_at` is
`timestamptz`, serialised with `toISOString()`, and rendered through the
UTC-pinned formatter in `@/utils/format` — pinned deliberately, because an
`Intl` call without an explicit `timeZone` uses the server's zone during SSR and
the viewer's after hydration, which is a hydration mismatch on every screen that
shows a date. IST is UTC+5:30, and 23:00 − 5:30 = 17:30.

So the display was correct and unlabelled. Added `formatDateTimeUtc()` and used
it on the two screens where a timestamp is correlated against the real world —
the system log and the audit trail. No stored value changed, no conversion
changed, no historical data touched.

### 3. Referrals, finished

Four gaps, all found in the existing code rather than invented:

- **`programmeEnabled` and `maxTiers` were editable in the CRM and ignored.** An
  operator could switch the referral programme off, watch it save, and
  commission would keep accruing. Both are now read inside the accrual
  transaction; `maxTiers` is clamped to 2 because the VIP table defines two
  commission columns.
- **VIP level never advanced.** The thresholds are in `vip_levels` and the
  aggregates started moving when accrual landed, so `nextLevelProgress` could
  climb to 100% and stick there for ever while the account kept earning the
  entry-level rate. Promotion now applies the highest level whose *both*
  requirements are met, after the commission so an allocation pays at the rate
  held when it was made. Promotion only — nothing defines demotion, and doing it
  as a side effect of somebody else's allocation would be the wrong way to find
  out.
- **Pending commission had no path to a wallet.** `/admin/referrals` had no
  actions at all. `releaseCommission()` + a confirmed *Release* control, gated on
  `manage` over `referrals`: one transaction with the ledger row, the balance,
  the aggregate move and the audit entry, and the status transition asserted in
  the `UPDATE`'s own `WHERE` so two operators clicking together pay once.
- **The invite *code* could not be redeemed anywhere.** The referral screen
  shows it as a first-class artifact with a copy affordance, and no field in the
  application accepted one. Added an optional invite-code field to sign-up,
  prefilled from `?ref=`, writing the same cookie the middleware writes. A typed
  code overrides a stored one — the middleware's first-wins rule exists to stop
  one *link* stealing from another, not to overrule a person's explicit choice.

Deliberately unchanged: accrual still credits nobody, and the test asserting
that is still there.

### Verification

`npm run typecheck`, `npm run lint`, `npm run build` clean. **136 tests pass**
with a database configured (was 133; three added: VIP promotion, release
idempotency, the programme switch). All thirteen admin screens render; the
referral release control, the UTC labels and the invite-code field were each
verified in the rendered HTML. One run out of four showed a single unidentified
test failure that did not reproduce in three subsequent full runs — see the
report; it was not captured and is **NOT VERIFIED** as flaky.

---

## 2026-09-01 (production-readiness pass)

Preparing for deployment. Five areas, in order of how much they were actually
broken. No architecture was replaced: same platform, same database, same driver,
same ORM, same auth.

### 1. Connection pool: 3 → 5 (and warm-up 2 → 3)

`DATABASE_POOL_MAX` had been lowered to 3 to stop `EMAXCONNSESSION`, which it
did, and it overcorrected into contention. Measured against a production build
with a real session — eighteen concurrent authenticated requests, same build,
same machine, alternating runs:

| | wall | p50 | errors |
|---|---|---|---|
| `max 3`, warm 2 | 14.0s, 21.9s | 8.3s, 16.5s | 0 |
| `max 5`, warm 3 | 8.2s, 8.4s, 8.8s | 5.3–5.5s | 0 |

At three, individual requests reached 14.3s against the 15s read deadline — one
round trip from failing rather than queuing. Serially five is no worse and
mostly better (Home 1,834 → 1,192ms median; Plans 1,171 → 754ms; the rest
inside noise).

Five is what the arithmetic allows: the project ceiling is fifteen session-mode
clients shared by every instance, the `db:*` scripts, the scanner and the test
suite, so five per instance leaves room for two instances plus the scripts.
`DATABASE_POOL_MAX` still overrides it. Nothing else about the connection
changed — still the session pooler on :5432, still `prepare: true`, still one
globally-cached `postgres()` client (there was never a duplicate).

Zero `EMAXCONNSESSION`, zero `CONNECT_TIMEOUT`, zero `database.connectRetry`
rows and zero 500s across every run.

### 2. The Shasta transfer that "was not detected" had been detected

`dep_mt2nnxzu1jdf0` — 1,000 USDT, tx `bde2fe60…`, contract and recipient both
correct, status `confirmed`, `user_id` null — recorded on 2026-08-21, the day
it arrived. Two things made it look like a failure:

- **Nothing ran the scanner.** The only trigger was `npm run tron:scan`, typed
  by a person. `chain_scan_state.last_success_at` was 2026-08-23 and nothing had
  run in the week since. Added `GET /api/cron/scan-deposits`, authorised by
  `CRON_SECRET` and refusing everybody when it is unset, with the schedule in
  `vercel.json`. Verified end to end: it found the transfer and correctly
  reported it `unchanged`.
- **It is unassigned, on purpose.** One shared receiving address cannot say
  whose money arrived, so an operator attributes it in `/admin/deposits`
  (§18.4). Nothing was wrong with that; it is just invisible from the user app.

Also: `npm run tron:inspect` defaults to a 24-hour window, and the transfer was
eleven days old — the first investigation ran it at 168h and got "(none)". The
default is documented now and the example uses a wider window.

And `tron:inspect` never exited. It calls no deposits service, but every
TronGrid call is instrumented, so it opened the runtime pool to write
`pipeline_events` and — with `idle_timeout: 0` — held those connections out of
the project's fifteen until the process was killed. Added
`flushPipelineEvents()` (scripts only, never requests) and a `closeDb()` on
exit. `EXIT=124` → `EXIT=0`.

**TRON is not, and never was, on the rendering path.** The only chain-adjacent
call in a page is `getPublicDepositTarget()` on `/wallet/deposit`, which reads
environment variables and validates an address locally. No layout, page, auth
path or server action reaches TronGrid.

### 3. Referral: the middle of the chain was missing

Link generation, `?ref=` capture, the cookie that survives signup, self-referral
and bad-code rejection, and the immutable attribution all already worked. What
did not exist was anything between "they signed up" and "you earned
commission": every referral stayed `registered`, `active_referrals` and
`team_volume_usdt` stayed zero so VIP progression could never move, and
`commission_entries` was never written outside the seed.

`accrueReferralCommission` now runs inside `createInvestment`'s transaction —
one commission entry for the direct referrer at their VIP tier-1 rate, one for
that person's referrer at tier 2, the direct edge moved to `active` with its
totals, and both aggregates advanced. `indirect_referrals` is now counted at
signup, where it comes into existence.

Every rate is read from `vip_levels`, never restated. All arithmetic happens in
Postgres against `numeric` — the commission expression is recomputed rather than
read back, because `usdt` columns map to `number` and a `.returning()` would put
a float in a money path.

**It credits nobody.** Entries are `pending`; no ledger row, no balance change.
"Once their allocation settles" has no settlement process, and paying out on a
rule nobody wrote is the one thing worth refusing here. Five new integration
tests, including one asserting the referrer's wallet and ledger are untouched.

### 4. KYC: it was asserting things that had not happened

The document step was a button that set a boolean. So was the liveness step.
The document type was hard-coded `national_id`, the "document number" was
`Math.random()`, the filename was the literal `identity-document.jpg` for every
submission ever made — both real submissions in the database carry it — and the
form then sent `livenessCheckPassed: true`, which an operator reads in the CRM
as a check that ran and passed.

Now:

- the document step opens the real file picker or the real camera
  (`<input capture="environment">`), checks type and size, and records the
  actual filename, byte count and MIME type;
- the person chooses their document type and types their document number, and
  **only its last four characters leave the browser** — the server composes the
  mask, so no full identity number exists in a request, a process or a log;
- the selfie step opens the device camera through `getUserMedia` with a live
  preview, stopping every track on exit, and falls back to the OS camera app.
  The fallback is offered always, not only after a failure: `mediaDevices` does
  not exist on an insecure origin, which is every phone testing a LAN address;
- `livenessCheckPassed` is no longer a parameter. `submitKyc` writes `false`
  plus a `liveness_not_verified` risk flag, and the CRM renders that as
  *"Not checked — compare by hand"* in muted type rather than "Not passed" in
  red — a reviewer must not be told somebody failed a check that never ran;
- the submission records two document rows, "Identity document" and "Selfie
  capture", which is what a reviewer actually compares.

**Still missing, and said on screen rather than implied: no file is
transmitted.** There is no document store and no verification provider, so the
photos stay on the device and only metadata is recorded. Connecting either is a
deployment decision with legal weight, not a component change — see the
readiness list below.

### 5. Failure isolation, finished

`/wallet` and `/referral` had already been given `SectionBoundary`. `/` had the
same defect: `getEarningsSummary()` sat in the page's `Promise.all`, so a
rejected earnings read discarded the balance, the allocations and the activity
list and rendered the route error page. Same treatment — the read still starts
in the page's own wave, and is awaited inside the boundary. Balances,
allocations and verification state stay on the critical path deliberately.

### Mobile

No reproducible mobile-specific defect was found in the code. The fundamentals
are already right: 16px inputs, `viewportFit: cover`, safe-area utilities,
44px targets, guarded `crypto.randomUUID`, guarded `navigator.share`, a
clipboard fallback for insecure origins. The one real divergence is the
secure-context rule, which the new camera code now detects and works around
rather than failing silently. Anything else reported on a phone is most likely
an insecure LAN origin or a Supabase redirect allow-list that does not include
the origin being tested — both configuration, not code.

### Verification

`npm run typecheck`, `npm run lint`, `npm run build` clean. **133 tests pass**
with a database configured (was 127; six added). Routes exercised against
`npm run start` with a real session: `/`, `/wallet`, `/plans`, `/referral`,
`/settings`, `/settings/kyc`, `/wallet/deposit`, `/wallet/transactions` — all
200, no 500s, no connection errors in the server log or in `pipeline_events`.

---

## 2026-08-25 (navigation latency forensic)

A measured hunt for the extra seconds in normal page navigation, and the
smallest set of fixes that removed them. No product behaviour changed and no
architecture was rewritten; every number below is from a production build
(`npm run build && npm run start`) against the configured Supabase project,
five runs per route with a 2s gap, medians reported.

### What was actually measured

`next dev` was **not** the problem. Warm dev requests (1.5–2.6s) and warm
production requests (1.6–2.4s) were within noise of each other; only the first
hit of a route in dev carried compilation. The 10–20s outliers were the two
faults below, not compilation.

A temporary waterfall instrument (removed again) over middleware, auth, every
SQL statement and every render showed that **middleware (4–13ms) and auth
(`getClaims`, 6–17ms) cost almost nothing**, and that a page spent essentially
all of its time in **four strictly sequential database round trips**, each
~200–500ms:

1. `users` by `auth_user_id` — the session gate. Irreducible.
2. `users` by `id` — the profile, which cannot start until (1) resolves.
3. `user_kyc_steps` — awaited *after* (2) inside `findUserProfile`, though it
   only ever needed the same `userId`.
4. `notifications` — read by `TopBar`, an async server component in the tree the
   page *returns*, so it could not begin until the page had already finished.

Three and four were pure waterfall: nothing in them depended on the step before.

### Root causes and fixes

- **`findUserProfile` awaited two independent reads in sequence.** Now one
  `Promise.all`. Removes a whole round trip from every screen that shows a
  profile, which is all five primary sections.
- **`TopBar` read `profile` and `notifications` after its page had resolved.**
  The five pages that render it now name those slices in their own wave; the
  reads are request-memoised, so `TopBar` awaiting them a moment later is free.
- **Every pipeline event recorded by a *page* was its own `INSERT`.**
  `AsyncLocalStorage` does not cross from a layout into the page beneath it, so
  `traceRender` in `(app)/layout.tsx` covered the layout and nothing else, and
  the buffered-then-one-insert design was bypassed for the whole render: five to
  eight single-row inserts per page, each a ~400ms round trip, holding
  connections at exactly the moment the page fired its parallel reads. They are
  now coalesced on a 100ms window into one insert. Nothing is dropped.
- **`/api/trace` did two round trips before answering.** It resolved the account
  and wrote the rows *then* returned 204 — 720–1,270ms per beacon, and a beacon
  is sent on every navigation, so those connections were held while the person's
  next page was reading. All of it moved into `after()`. **720–1,270ms → 12–26ms**,
  and every event still lands (verified by reading `pipeline_events` back).
- **The pool was too small for one wave, and the warm-up too small for the pool.**
  `DATABASE_POOL_MAX` 5 → **8**, `DATABASE_WARM_CONNECTIONS` 4 → **7**. An earlier
  pass had rejected a bigger pool, correctly, because it was raised *without* the
  warm-up: the extra connections were then opened in front of a user. Raised
  together it is better warm *and* cold.
- **Home's earnings rollup was three statements** over the same rows of the same
  table with the same predicate. Now one `UNION ALL` — three round trips become
  one, and Home's wave drops from nine reads to seven, which is what lets it fit
  the pool. Output verified identical against the previous implementation for
  every seeded account, totals and both series.

### The pooler ceiling (found the hard way)

Supavisor answers a sixteenth session-mode client with
`(EMAXCONNSESSION) max clients reached in session mode - max clients are limited
to pool_size: 15`. That is the **whole project's** budget, shared by every
application instance, `npm run db:*`, the TRON scanner and the test suite. A
server holding ten of them stalled the integration suite until it was stopped.

`DATABASE_POOL_MAX` is therefore a *per-instance* number against a fixed global
one. Eight was chosen because it covers every page's wave and leaves seven; a
deployment running several instances must lower it, not raise it.

### Measurements (production build, medians of 5, 2s apart)

| Route | Before | After | Change |
|---|---|---|---|
| `/` | 2.150s | 0.757s | **−64.8%** |
| `/plans` | 1.702s | 0.739s | **−56.6%** |
| `/wallet` | 2.076s | 0.793s | **−61.8%** |
| `/settings` | 1.699s | 0.733s | **−56.9%** |
| `/referral` | 1.845s | 0.870s | **−52.8%** |
| `/settings/kyc` | 1.295s | 0.734s | **−43.3%** |
| `/login` (307) | 0.454s | 0.393s | −13.4% |
| `POST /api/trace` | 0.720–1.270s | 0.012–0.026s | **−98%** |
| `/` first request after boot | 5.021s | 4.233s | −15.7% |

A page is now two database round trips deep instead of four, which is the floor:
one to resolve the session's account, one for everything that account needs.

### What was *not* the cause

Duplicate queries within a request (the request-scoped `cache()` was already
doing its job), unindexed queries, over-wide column lists, React rendering,
Next's server rendering, middleware, retries, and `next dev` compilation. Each
was measured and ruled out rather than assumed.

### Still slow, and why

~200ms per round trip to ap-northeast-2, jittering to 600–850ms. At two round
trips that is most of the remaining 0.75s, and it is geography — out of scope
here. The first request after a cold start still pays ~3.5–4.2s for the pool's
first handshakes.

---

## 2026-08-24 (reliability & performance pass)

Focused pass on reliability, database connectivity and page-load performance.
No product behaviour changed: deposits, referrals, investments, withdrawals,
KYC rules and admin business actions are untouched.

Full analysis, measurements and status table: `FUTURE_TASKS.md` →
"Reliability & Performance Audit".

### Root causes

1. **One Supabase pooler A record intermittently fails the Postgres handshake**,
   and *which* of the three is broken moves over time — the endpoint that failed
   3/3 earlier answered 4/4 when re-probed. Fixed with a bounded retry, not a
   pinned IP and not a longer timeout.

2. **The hottest read path had no deadline.** `account.service` and the `users`
   lookup called `getDb()` directly while only `fromDatabase()` had one.
   `auth.resolveAccount` was failing after an average of **55–71 seconds**;
   requests were observed at 33s, 46s and 49s. Pages hung rather than failed.

3. **`getAuthPrincipal()` returned null on any error**, so a transient failure to
   reach Supabase (measured up to 30.9s) was indistinguishable from "not signed
   in" — it signed valid users out mid-navigation and produced the reported
   `NotAuthenticatedError: Not signed in.` A bug in an error path, not in login.

4. **No `loading.tsx` anywhere and no root error boundary.** A slow read rendered
   as a blank page, and because a boundary does not cover the layout beside it,
   a failure in `(app)/layout.tsx` had nowhere to land and took out the document.

### Changes

- `db/resilience.ts` — retries only connection-establishment failures, bounded by
  count (2) *and* a 12s wall-clock budget. Reads only; `mutate()` is untouched so
  no retry can duplicate a write. Permanent errors re-thrown on the first attempt.
  Retries recorded as `database.connectRetry`.
- `connect_timeout` **lowered** 10s → 6s, chosen against the retry budget so the
  worst case is two attempts (~12s) with room to reach a different endpoint.
- `resilientRead()` — deadline *outside* the retry, applied to the three paths
  that had none.
- `auth/session.ts` — `getUser()` → `getClaims()`. This project signs with ES256,
  so verification is local: **385ms → 1–3ms per request**. Still cryptographic;
  a forged token is still rejected (verified). New `AuthProviderUnavailableError`
  so an outage renders a recoverable notice inside the shell instead of a
  sign-out.
- `db/warmup.ts` — background pool warm-up. Cold five-query burst **2,008ms →
  203ms**. Lives on `getDb()` because `instrumentation.ts` is edge-compiled and
  pulls `node:net` into the edge bundle, failing the build.
- 32 `loading.tsx` files plus shared skeletons; `app/error.tsx` and
  `app/global-error.tsx`.
- `/login` and `/admin/login` now survive a database outage (**500 → 200**,
  8,612ms → 2,089ms) — they are the recovery path.
- Catalogue reads cached across requests, tag-invalidated on plan edits (M8).
  No user-scoped data is cached across requests.

### Measured

Interleaved A/B (both builds served alternately, so network drift hits both):
**every authenticated route improved, 7–29%, aggregate −17%**. Server-side,
`auth.resolvePrincipal` 1,024ms → 21ms average and `auth.resolveAccount`
failures **56 → 0**.

`DATABASE_POOL_MAX` was re-measured and **stays at 5**: raising it to 12 made the
cold burst worse (3,270ms vs 2,008ms). This supersedes the older suggestion in
CLAUDE.md §16.1a for this deployment shape.

**No index was added and no query rewritten.** The hottest query executes in
**0.05ms** on an existing index inside a 200–500ms round trip — the cost is
network, not the plan.

### Not fixed

The ~200ms distance between the application and `ap-northeast-2` is now the
dominant cost and is an infrastructure question (co-location), not a code one.
The unhealthy pooler endpoint needs Supabase. Browser/360px visual verification
was not possible in this session — the Chrome extension was not connected.

`npm run build` exits 0, `npm run lint` clean, `npm run typecheck` clean,
**127/127 tests pass** (20 new).

---

## 2026-08-24 (later still) — The Vercel build no longer touches the database

### Root cause

`/admin/users/[id]` exported `generateStaticParams()`, which called
`getAdminUsers()` — `users LEFT JOIN wallet_balances ORDER BY registered_at`,
the exact query in the Vercel failure. Next runs that during **Collecting page
data**, so `next build` opened a connection to production PostgreSQL and failed
with `CONNECT_TIMEOUT` from `iad1`.

The parent layout is already `force-dynamic`, but that does not stop
`generateStaticParams` — it runs regardless, to decide what to prerender.

**It was also writing user data into the deployment bundle.** The previous build
output shows `● /admin/users/[id]` with one prerendered page per real account
(`/admin/users/usr_bb6207`, `/admin/users/usr_8c41a2`, …). Names, member ids and
wallet balances were being baked into static HTML for a route that exists behind
operator authentication. Prerendering an authenticated screen puts its contents
somewhere the authentication does not reach.

### Fix

`src/app/admin/(console)/users/[id]/page.tsx`, and only that file:

- `generateStaticParams` removed, with a comment explaining why it must not come
  back.
- `findUser` wrapped in React `cache()`. `generateMetadata` and the page body
  both need the record and each was issuing its own full directory scan — the
  same query that was timing out. Now one per request.

Authentication and authorization are untouched: the operator session is resolved
and checked in `(console)/layout.tsx` before this page renders.

`/admin/users` needed no change — it was already `ƒ` (dynamic).

### Verified

Built against a **guaranteed-unroutable** database (`192.0.2.1`, RFC 5737, with
a 5s connect timeout) to reproduce Vercel's condition exactly. **Exit 0**, no
`CONNECT_TIMEOUT`, no "Failed to collect page data" — the build now has zero
database dependency and cannot fail this way again regardless of network.

Route table changed from `● /admin/users/[id]` (SSG, per-user files) to `ƒ`.

`npm run build` exits 0. Against `npm run start`: `/login` 200, `/admin`,
`/admin/users` and `/admin/users/[id]` all 307 → `/admin/login` without a
session; 200 for an operator; 404 for an unknown id; 307 for a customer session.

### The CONNECT_TIMEOUT itself: one Supabase pooler endpoint is broken

Separate from the build, and diagnosed rather than assumed.
`aws-0-ap-northeast-2.pooler.supabase.com` resolves to three A records. Pinning
each and running three fresh connections apiece:

| endpoint | result |
|---|---|
| `15.164.120.176` | **CONNECT_TIMEOUT 3/3** (12,010 / 12,007 / 12,005ms) |
| `15.165.245.138` | ok 3/3 (1,826 / 2,022 / 1,995ms) |
| `13.124.111.232` | ok 3/3 (1,909 / 1,762 / 2,047ms) |

Raw TCP to the hostname succeeded 5/5 at ~200ms, and DNS resolved in 42ms with
no AAAA record. So the bad endpoint **accepts the TCP connection and then never
completes the Postgres startup handshake** — which is why it looks healthy to
anything that only checks TCP, and why failures are intermittent at roughly one
in three.

This rules out the usual suspects: the URL is right (two endpoints work with the
same credentials), the host is reachable, TLS and `sslmode` are unchanged
between working and failing attempts, pool configuration is not involved (these
were single fresh connections at `max: 1`), and the timeout value is not the
problem — a successful handshake takes ~2s, while the failing endpoint does not
complete in 20s.

No retry or timeout change was made: that is outside this task, and raising a
timeout would convert a failure into a longer hang. Recorded in
`FUTURE_TASKS.md` as H-1.

---

## 2026-08-24 (later) — Expected auth failures stopped being crashes

### `NotAuthenticatedError` at HomePage — reproduced, root-caused, fixed

Reproduced in dev exactly as reported:

```
⨯ Error [NotAuthenticatedError]: Not signed in.
    at requireCurrentUserId (src/server/current-user.ts:48:22)
    at async getUserSlices (src/server/services/account.service.ts:251:14)
    at async HomePage (src/app/(app)/page.tsx:19:30)
```

**Root cause: Next renders a layout and its page in parallel.** The gate in
`(app)/layout.tsx` calls `redirect()` when there is no session, but that does
not stop the page — it ran anyway, called a read, and threw. The visitor still
got their redirect because the layout's response won the race, but the page had
already executed authenticated queries and logged a server error. Which of the
two won was never guaranteed.

Fixed with `requireCurrentUserIdForPage()`, which calls `redirect()` instead of
throwing. `redirect()` raises a signal Next understands, so the page stops
cleanly — no error, no query, no log noise. The page-only read funnels
(`getUserSlices`, the earnings rollup, `TopBar`) use it; **server actions keep
the throwing variant**, because an action that redirects gives its caller no way
to show a message.

Verified: dev went from **4 occurrences to 0**, production from 0 to 0, and all
authenticated pages return a clean 307 when signed out.

### `/error` and `/update-password` did not exist

Both 404'd.

- **`/error`** is where Supabase sends a failed link
  (`?error_code=otp_expired&…`). It now translates the code into readable copy,
  redirects to `/login?error=…`, and **clears any half-established `sb-*` auth
  cookies** — a failed exchange could otherwise leave a session that reads as
  "signed in" just long enough to fail somewhere less obvious. It does not
  retry: a consumed one-time code cannot be reused, and a retry would fail
  identically while looking like the app is stuck.
- **`/update-password`** is the route the brief specifies. The screen existed at
  `/reset-password`; it moved, and the old path now redirects rather than 404s,
  because recovery emails already sent point there and those links are
  single-use.

### Production URLs

Audited every `localhost:3000` in the repository. There were **two**: one in
`README.md` (documentation — correct, left alone) and one real defect — a
fallback in `originForEmails()` that could put a development URL into a
production recovery email.

`@/lib/site-url` is now the single source: `NEXT_PUBLIC_SITE_URL` →
`window.location.origin` (browser) → `VERCEL_URL` (server) → localhost. The
localhost fallback is unreachable on a deployed server. Every signup
confirmation, recovery link and referral link resolves through it, and the
referral default is now `https://nanotron.vercel.app`.

**Supabase dashboard still needs `https://nanotron.vercel.app/auth/callback` and
`/update-password` on its redirect allow-list** — that is configuration this
repository cannot set.

### CONNECT_TIMEOUT — reproduced at build time

`next build` failed collecting page data for `/plans/[slug]`:

```
Failed query: select … from "plans" where "plans"."status" <> $1
  [cause]: Error: write CONNECT_TIMEOUT   code: 'CONNECT_TIMEOUT'
```

That page had `generateStaticParams`, but it lives under `(app)`, which is
`force-dynamic` — **the prerendering produced nothing that was ever used** while
making the build depend on the database being reachable. Removed. The build
passes.

The connection architecture itself was audited and found correct: one
`globalThis` singleton pool, no per-request creation, `DIRECT_DATABASE_URL`
confined to scripts and tests. `max_lifetime` is now pinned to 30 minutes so a
socket is replaced on a schedule rather than discovered dead mid-request.

### An error taxonomy

`@/server/errors` classifies a thrown value into ten categories and records the
category on every failure the tracer sees, with an `expected` flag. Verified
against the real errors from these logs — postgres `CONNECT_TIMEOUT` →
`DATABASE_TIMEOUT`, undici to `supabase.co` → `AUTH_PROVIDER_UNAVAILABLE`,
`NotAuthenticatedError` → `UNAUTHENTICATED` (expected), an `otp_expired` message
→ `AUTH_LINK_EXPIRED` (expected), a wrapped cause unwrapped correctly.

It matches on driver `code` before message text, because message text is not a
stable interface and `CONNECT_TIMEOUT` and the SQLSTATE classes are.

Classification happens on the **server** because Next strips an error's message
before it reaches a client boundary in production, leaving only a digest. The
boundary now says what is true — nothing on the account was changed — and shows
the digest that ties the screen to its log row.

### Measured, production build

| Route | cold | warm (median) | p95 |
|---|---|---|---|
| `/` | 2,437 | 2,320 | 2,699 |
| `/wallet` | 2,334 | 2,465 | 2,775 |
| `/plans` | 1,895 | 1,998 | 2,311 |
| `/referral` | 2,405 | 2,480 | 2,822 |
| `/settings` | 2,241 | 1,862 | 2,658 |
| `/settings/kyc` | 1,630 | 1,459 | 1,843 |
| **`/wallet/deposit`** | **594** | **616** | **816** |

`/wallet/deposit` is the control that matters: it is the one page reading no
per-user data, and it renders in ~616ms. The floor is per-user database round
trips, not framework overhead.

**Concurrency is the real ceiling**, and it is new information:

| concurrent `/wallet` | total | slowest | failures |
|---|---|---|---|
| 1 | 2,390ms | 2,390ms | 0 |
| 4 | 6,389ms | 6,387ms | 0 |
| 8 | 11,816ms | 11,810ms | 0 |
| 12 | 15,949ms | 15,946ms | 0 |

Twelve simultaneous users already means a sixteen-second page. Filed as H0.

### Checks

`typecheck` ✅ `lint` ✅ `build` ✅ (after the `generateStaticParams` removal).
**9/9 authentication checks** against the running server: password login, wrong
password refused, session persistence, recovery email accepted, expired code →
`/login` with a message, Supabase `/error` → `/login` with a message,
`/update-password` refusing without a recovery session, every authenticated page
redirecting cleanly, logout.

**The automated suite did not fully pass**, and it is being reported as it is:
99/107 and 88/107 on two consecutive runs, with **zero assertion failures** —
every failure was `write CONNECT_TIMEOUT` or a pending-promise timeout. The same
suite passed 107/107 earlier the same day. The database link is genuinely
degraded from this environment (cold connect measured at 2,664ms, and the build
hit the same error). Filed as H-1. No test failed on logic.

---

## 2026-08-24 — Referral attribution, the deposit mystery, layout fetching

### The deposits that "were not being detected" were not deposits

The reported failure was that test USDT sent to the Shasta receiving address
never appeared. It was investigated by querying TronGrid directly rather than by
reading the scanner's code, and the pipeline turned out to be working correctly.

`GET /v1/accounts/TE9hzp…/transactions/trc20` with **no contract filter at all**
returns exactly **one** transfer to that address, dated 2026-08-20 — the one
already recorded, verified, solidified and sitting `confirmed`/unassigned in the
database.

The native-transaction endpoint tells the rest of the story: **six
`TransferContract` transactions**, three of them on 2026-08-22 (200, 111 and
100 TRX). The account holds **4,461 TRX and exactly 1,000 USDT**.

The payments were **native TRX, not TRC-20 USDT**. Every TRC-20 address is also a
valid address for the chain's own coin, and a wallet will happily send it. Those
transfers succeed on-chain and are invisible to a TRC-20 transfer query — a
different endpoint entirely — so nothing detected them and nothing could credit
them.

Scanner state confirms it was never broken: `last_success_at` 2026-08-23,
`consecutive_failures` 0, `last_error` null.

Two changes follow from this:

- The deposit screen's wrong-asset warning is now the loudest element on the
  card and names TRX explicitly. It was previously one grey footnote about
  contract addresses, which was evidently not enough.
- Recording wrong-asset arrivals so they are at least *visible* is filed as
  H1 in `FUTURE_TASKS.md`. Today a user can send TRX and watch it vanish from
  the product's view entirely, which is the part that should not stand.

### Referral attribution now exists

It did not. `/signup` ignored `?ref=` completely, `users.referred_by_code` was
never set by any code path, and the referral link pointed at
`https://nanotron.app/join/CODE` — a route that does not exist.

- The **middleware** captures `?ref=` on any route into a short-lived httpOnly
  cookie. A shared link can point anywhere, and the person following it may
  browse, sign up, then confirm their email minutes later in a second request;
  client memory does not survive that.
- **First one wins.** An existing capture is never overwritten, so a second link
  cannot steal an attribution the first earned.
- `ensureAccountForCurrentPrincipal` resolves the code **only on the account-
  creation path**, writing `referred_by_code`, the `referrals` row and the
  referrer's counters in the same transaction as the account. An account that
  already exists is never re-attributed — not when adopted by email, not on a
  later sign-in. A referrer that can change afterwards is one that can be
  stolen.
- Refused: an unknown code, a malformed code, and self-referral (matched by
  email, since the new row has no id yet). A bad code costs the signup nothing —
  the account is created unattributed rather than refused, because a broken link
  is not the new user's fault.
- The link is now `/signup?ref=CODE`, which is what the middleware captures.

Verified against the running server: valid code captured (httpOnly, SameSite=Lax),
malformed rejected, captured on `/` as well as `/signup`, existing capture not
overwritten. The lookup and self-referral guards were verified against the
database. **Not verified end to end**: a live signup consuming the cookie, because
that needs an email confirmation and Supabase's development sender is rate
limited.

No commission is calculated or paid. That is C1 in `FUTURE_TASKS.md`.

### Layout fetching, measured rather than assumed

The route-group layout fetched six account slices on **every** user page,
including screens that rendered none of them. It now fetches **nothing**: pages
declare what they need via `getUserSlices([...])` and pass it to a page-level
provider, the same split the CRM already uses.

Reading a slice a page did not provide **throws**, naming the slice, rather than
defaulting. For a wallet, a zero is not a missing value — it is a wrong one, and
a plausible wrong number about money is the worst thing this application can
render. The regression sweep found two pages I had mis-mapped exactly this way;
both were caught immediately rather than shipping a silent zero.

**The result was mixed, and the middle step was worse than the start.** Measured
interleaved with an untouched control route (`/admin/users`, stable at
1,228–1,298ms across all four rounds, so the environment held):

| Route | 6 slices in layout | 1 in layout | 0 in layout | final |
|---|---|---|---|---|
| `/settings/kyc` | 2,048 | 1,799 | 1,608 | **1,823** |
| `/plans` | 1,942 | 2,249 | 2,757 | **2,050** |
| `/wallet` | 2,098 | 2,261 | 2,671 | **2,500** |
| `/` | 2,420 | 2,874 | 2,704 | **2,675** |

Two things were learned the hard way. Leaving a *single* read in the layout was
worse than leaving six, because an await in a layout gates every page beneath it
— one query serialised everything after it. And the page-level rewrite
introduced five sequential awaits where parallel ones belonged; fixing those
recovered `/plans` from 2,757 to 2,050.

`/wallet` and `/` still measure above their starting point and the cause is not
established — both now issue *fewer* distinct queries than before, which makes
the result counter-intuitive. Filed as H2a rather than explained away.

### Also

- `FUTURE_TASKS.md` added: 6 critical, 7 high, 7 medium, 5 low, known
  limitations, and a production-readiness checklist that says "no" in the places
  it should.
- A network blip during measurement produced `ConnectTimeoutError …
  supabase.co:443` and the tracer caught it precisely — `auth.resolvePrincipal`
  averaging 6,030ms, `render.redirected` averaging 10,500ms (the connect
  timeout). That run was discarded rather than reported. It also exposed C5: an
  auth-provider outage is currently indistinguishable from a logout.

### Checks

`typecheck`, `lint`, `next build`, **107/107 tests**, `db:check` (32 tables, 41
enums, 26 foreign keys, 102 indexes), and a sweep confirming **all 27 user and
admin routes render 200** with no missing-slice errors.

---

## 2026-08-23 (later) — The slowness was connection churn, not queries

Navigation felt slow. The cause was not the database being busy, the queries
being unindexed, or authentication being chatty — it was the application
throwing away its database connections every twenty seconds and rebuilding them
on the next click.

### The measurement that found it

Timings against the configured Supabase project (session pooler,
ap-northeast-2, from India), medians:

| | |
|---|---|
| DNS resolution | **1 ms** |
| TCP connect | **~200 ms** |
| **Opening a pooled connection** | **~1,930–2,042 ms** |
| Query on an open connection | **~199–206 ms** |
| Supabase Auth `getUser()` | **~345 ms** |

Opening a connection costs ten times a query, because the Postgres startup
handshake — SSLRequest, TLS, SCRAM, ready-for-query — is roughly ten round
trips at 200 ms each.

`idle_timeout` was **20 seconds**, which is how long a person spends reading a
page before clicking the next thing. Isolated proof, A/B on the same code:

| | after 30 s idle |
|---|---|
| `idle_timeout: 20` | **2,187 ms** — reconnected |
| `idle_timeout: 0` | **278 ms** — stayed warm |

### Two false starts, both worth recording

**The first hypothesis was wrong.** Static analysis said the bottleneck was
repeated session verification: every bare service call resolved the session
again, and the Referral page made five of them — nominally ~2.2 s of redundant
`getUser()`. Memoising it changed nothing measurable, because the instrumented
`auth.supabase.getUser` turned out to average 9 ms on a cold session and ~345 ms
on a live one, not the 2 s the page was losing. The memoisation was kept — it
removes real duplicate work — but it was not the answer.

**Two measurement rounds were void.** `pkill` raced `next start`, the old
process kept port 3100, and two "AFTER" runs silently measured the previous
build. They were discarded, not reported. Every number below comes from a server
whose PID was confirmed on the port after printing *Ready*.

The instrumentation is what settled it: `db.users.findByAuthUserId` averaging
1,095 ms with a 3,375 ms maximum, for a single indexed row, makes no sense as a
query cost and every sense as a connection cost.

### The fix

- **`idle_timeout: 0`** on the runtime pool — never close a connection for being
  idle. Overridable with `DATABASE_IDLE_TIMEOUT`. `max_lifetime` still rotates
  connections every 30–60 minutes, so nothing lives forever.
- **Request-scoped memoisation** with React `cache()` on `getAuthPrincipal`,
  `getAuthenticatedAccount`, `getCurrentOperator`, every read in
  `account.service`, and the earnings rollup. The layout fetched the account
  seed and the page then fetched parts of it again — Home read the profile
  twice, Wallet built the same earnings rollup twice (six queries where three
  would do).
- **`getCurrentOperator()` reads the agent and its grants in one left join**
  rather than two sequential statements: one round trip instead of two, on every
  admin request.
- **The middleware uses `getSession()` instead of `getUser()`.** It authorizes
  nothing — the gate is in the layouts and every action, all of which verify
  against Supabase — so the local decode is sufficient there and saves a network
  round trip per request. Documented in place, with the condition that would
  make it wrong.
- **Narrower columns** on the hottest read (`users` by `auth_user_id` selected
  all thirty-odd columns, including internal notes).

A startup pool warm-up was written and **removed**: `instrumentation.ts` is
compiled for the edge runtime too, where the driver's `node:net` has no scheme,
and the contortions needed to satisfy the bundler cost more than the single
request they would have saved.

### Before / after — same build, only `DATABASE_IDLE_TIMEOUT` differing

Production build, real sessions, 25-second idle gap before each request (the
interval that reproduces the complaint), median of 3.

| Route | Before | After (shipped) | |
|---|---|---|---|
| Home | 5,351 ms | **2,077 ms** | −61% |
| Plans | 4,523 ms | **2,010 ms** | −56% |
| Wallet | 10,374 ms *(307, failed)* | **2,346 ms** | −77% |
| Deposit | 4,895 ms | **2,038 ms** | −58% |
| Withdraw | 5,581 ms | **2,002 ms** | −64% |
| Referral | 5,913 ms | **2,250 ms** | −62% |
| Settings | 5,317 ms | **2,056 ms** | −61% |
| KYC | 5,256 ms | **1,954 ms** | −63% |
| Admin Dashboard | 4,227 ms | **1,240 ms** | −71% |
| Admin Users | 3,243 ms | **1,433 ms** | −56% |
| Admin KYC | 3,139 ms | **1,366 ms** | −56% |
| Admin Deposits | 3,504 ms | **1,399 ms** | −60% |
| Admin Investments | 3,401 ms | **1,413 ms** | −58% |
| Admin Withdrawals | 3,913 ms | **1,422 ms** | −64% |
| Admin System Logs | 3,043 ms | 3,019 ms → page size cut to 200 | see below |

Under the old setting `/wallet` did not merely run slowly — it returned **307**
after 10.4 s, having exhausted `connect_timeout` while rebuilding connections.
That failure is gone.

`DATABASE_POOL_MAX` was measured at 12 (13–20% faster on the widest pages) and
**left at 5**: the documented reason for the small pool — per instance, and a
serverless deployment runs many — still holds. The measurement is recorded so
the trade can be made deliberately for a single long-running server.

### Observability: the technical execution trail

`pipeline_events` gained `layer` (client / server / database / external /
blockchain), `route` and `actor_type` (migrations `0005`, `0006`).

- **One correlation id per request**, stamped by the middleware onto the
  forwarded headers so the layout, the page and every service share it.
- **The browser is joined to the server by a short-lived cookie.** A client-side
  navigation is an RSC fetch Next issues itself — no hook to add a header, no
  way to read one back — so `NavigationTracer` writes the id it generated on
  click and the middleware adopts it. That is what makes one filter show
  `navigation.start` (browser) through to `navigation.complete` (browser).
- **`/admin/system-logs`** gained filters for pipeline, layer, duration band,
  time window, status and a search across operation, route, correlation id and
  account — and a **click-through trace view** rendering one request as an
  ordered waterfall with a wall-clock total.
- Instrumented: sign-in, KYC submit/approve/reject, deposit assign, investment
  create, withdrawal request/approve/reject, profile and settings writes,
  password recovery email, the TRON scanner, **every TronGrid call**, and the
  auth and database steps underneath all of them.

**Recording is never on the critical path.** Events are buffered on the
request's async context and written as one multi-row insert handed to Next's
`after()`, so it runs after the response. `recordPipelineEvent` is synchronous
and issues no query. Every write is swallowed on failure.

A subtle bug found and fixed while verifying this: React's `cache()` runs its
function in its own async context, so instrumentation *inside* a cached function
lost the request's `AsyncLocalStorage` trace — those events landed under fresh
correlation ids and each became its own immediate insert. The timing now wraps
the cached call rather than living inside it, and the two auth steps are
resolved side by side rather than nested. Verified end to end: a single trace
now reads CLIENT → EXTERNAL → DATABASE → SERVER → CLIENT.

`/admin/system-logs` became the slowest page — the instrumentation's own table,
read 500 rows at a time with a jsonb column per row. Default page size cut to
200; the correlation filter, which is the view that matters for debugging,
reads one request's steps.

### Checks

`typecheck`, `lint`, `next build`, **107/107 tests**, `db:check` (32 tables, 41
enums, 26 foreign keys, 102 indexes). One test updated for the two new enums.

43 live checks against the production server: password sign-in for both
audiences, wrong password refused, unauthenticated redirects, a customer session
refused by the CRM, all 14 user routes and all 13 admin routes returning 200,
the newest KYC submission and the unassigned chain deposit visible in the CRM,
investments/withdrawals/ledger intact, and no secrets in the log. The one
failure was my own ad-hoc reconciliation formula applied to seeded fixtures,
whose balances are hand-authored rather than ledger-derived; scoped to accounts
built by `applyLedgerEntry`, it is zero.

The TRON scanner still records one row per transfer (21 deposits, 21 distinct
hashes after repeated runs) and its three TronGrid calls now appear under one
correlation id with per-call timings — which is what shows an 8.9s pass is
2,228ms solid-block + 1,912ms transfers + 605ms lookup, not a slow database.

Verified by query after the run: **0 rows in `pipeline_events` containing a JWT,
a connection string, an API key, an access token or the word "password"**.

---

## 2026-08-23 — Admin authentication, per-page CRM reads, pipeline observability

The Master CRM stopped being reachable without signing in, stopped writing to
browser memory, and stopped showing a snapshot frozen at the moment it was
opened. The user application's last five in-memory mutations became database
writes. A system log was added so a failed click can be traced instead of
guessed at.

### The "KYC does not reach the CRM" report — root cause

The submission was never the problem. A real registered account
(`usr_mt4ox5lp9v4up`) had a `kyc_submissions` row, status `pending`, joined
correctly to its user, and `/admin/kyc` rendered it in the server HTML on a cold
request. The write worked and the read worked.

**The layout did not re-run.** `getAdminSeed()` was called in
`admin/layout.tsx`, and Next.js re-renders only the *changed* route segments on
a client navigation — a layout does not execute again. So the platform snapshot
taken when the console was opened was the snapshot every screen kept rendering,
and a case submitted a minute later did not appear until somebody hard-reloaded.

Fixed by moving every read down a level: the layout now fetches only the shell
(platform settings, operator directory) and **each page fetches its own slice**.
A page segment does re-render, on navigation and on `router.refresh()`.

The user's submit action also revalidates `/admin/kyc`, so the case reaches an
operator who already has the console open.

### The same change was the performance fix

Measured against the live Supabase session pooler (ap-northeast-2, from India),
medians of seven runs:

- **Network floor: ~205ms per round trip.** A bare `select 1` costs that. The
  number of *sequential* round trips is what determines page cost; nothing else
  is close.
- **Before: 1,789ms of database time on every admin page.** Fourteen list
  queries, in parallel, contending for a five-connection pool — the deposits
  screen paid for the audit log, the plans screen paid for every user's device
  sessions.
- **After: ~410ms for eleven of thirteen pages** (shell + one or two slices ≈ two
  round trips). `/admin` is 1,253ms because the dashboard genuinely spans four
  list slices; it is the one screen that legitimately does.

`DATABASE_POOL_MAX` was left at 5. Raising it to 12 did drop the old
fourteen-query case to ~650ms, which confirmed the pool was the contention
source — but the per-page split removes the contention rather than paying for
more connections, and the documented reason for 5 (per-instance, and a
serverless deployment runs many) still holds.

Dev-server first-hit times of 2.8–5.2s were Next.js route compilation, not
database latency: the same routes served in ~400ms once compiled, and the
production build has no such phase.

### Admin authentication — the gap CLAUDE.md called the most significant

Operators now sign in. `admin_agents.auth_user_id` (migration
`0003_admin_auth_link`, unique) links a Supabase principal to an operator row,
exactly as `users.auth_user_id` does for customers. The two lookups are
independent: signing in at `/login` grants nothing in the CRM, and there is no
`role` column on `public.users` — that would put every customer row one `UPDATE`
away from being an administrator.

- `/admin/login`, and `src/app/admin/(console)/` behind a gate that redirects
  without an operator session. Verified by request: `/admin`, `/admin/kyc`,
  `/admin/deposits` and `/admin/users` all return **307 → /admin/login**.
- The demo session switcher is gone. It was the hole: whatever it was set to
  travelled with every mutation as the claimed identity, so a caller could name
  themselves master admin and approve a verification case.
- `server/admin/guard.ts` deleted. Its `requirePermission(claim, …)` took the
  agent id as an argument, which was the whole problem;
  `server/admin/session.ts` takes none.
- The console lives in a `(console)` route group so the sign-in page can sit
  outside its layout. Every `/admin/*` URL is unchanged.

**This is why the admin writes below could be connected at all.** Wiring
twenty-two operator mutations to PostgreSQL while `/admin` was open to the
public would have been a serious regression, not progress.

### The CRM's twenty-two in-memory mutations are now database writes

`admin-store.tsx` went from 1,247 lines to 172. The reducer is gone; the store
is a read cache plus the server-resolved operator session. Every operator
decision is a server action in `src/app/admin/actions.ts` that resolves the
operator from the session, checks the stored permission, writes in one
transaction with its audit entry, and revalidates both applications.

Approving KYC, crediting a deposit, rejecting a withdrawal, blocking an account,
editing a plan, changing an operator's grants, sending a campaign, saving
settings — all of them previously rewrote a JavaScript object and appended a
convincing entry to an in-memory audit log describing a decision that had never
been recorded anywhere.

Three of the new actions deliberately say less than their names suggest:

- **Session revocation** marks a *description* of a session revoked. It does not
  invalidate a Supabase refresh token — that needs the service-role key, which
  this project does not hold — and the action's own message says so. An operator
  who believes an account has been secured when it has not is worse off than one
  who knows exactly what happened.
- **Password resets** (user and operator) send a real Supabase recovery email.
  No operator can see or set a password.
- **Campaigns** deliver in-app only, and report how many `notifications` rows
  were written rather than claiming a send. `recipientCount` is now a count of
  rows written; it used to be a lookup table of made-up reach figures.

Two services were extracted so the actions only authenticate and authorize:
`kyc-write.service.ts` (the decisions, previously inline SQL in the action) and
`failDeposit` / `creditAttributedDeposit` in `deposits.service.ts`.

### The user application's remaining browser-memory state

`prototype-store.tsx` is a read cache too. Five mutations became server actions:

| Was | Now |
|---|---|
| `createInvestment` reducer case | `createInvestmentAction` → allocation + ledger + balance + plan aggregate, one transaction |
| `requestWithdrawal` reducer case | `requestWithdrawalAction` → record + immediate balance hold |
| `setTwoFactor` / `setGoogleAuth` | `setSecondFactorAction` → persisted, with a security event |
| `toggleNotification` | `setNotificationPreferenceAction` → upsert |
| Profile form's `setTimeout(500)` + "changes are not persisted" | `updateProfileAction` |

The withdrawal quote is now **built server-side**. The client sends an amount and
a destination; the fee, payout rate and net INR are computed from
`@/constants/app` where they cannot be edited — a request body carrying
`totalFeeUsdt: 0` would otherwise have been honoured.

Two gaps this exposed and closed:

- **A new account could not withdraw at all.** The withdrawal screen requires a
  payout destination, only seeded accounts had one, and "Add bank account" said
  "not part of this build". Both destination controls now write; account numbers
  are masked server-side before they reach a column.
- **`WithdrawFlow` read `bankAccounts[0].id`**, which threw for an account with
  none — before the "add a destination first" notice could render.

Password changes are real: the browser re-authenticates with the current
password (Supabase's `updateUser` does not require it, so requiring it is the
screen's job) and then calls Supabase directly. The password never passes
through this application.

### Earnings were one demo person's numbers, shown to everybody

`earnings.service` returned a constant from `@/data/investments` — 842.35 USDT
of lifetime profit — to every visitor, including a brand-new account with an
empty wallet, on the home screen, above their real balance of zero.

It now reads that account's own ledger: settled `reward` and `referral` credits,
bucketed by the day and month they were credited, summed as `numeric` in
Postgres. A new account reports zeros.

Not an accrual curve, and the repository says why: the ledger records rewards
when they settle, so deriving a smooth daily line would be inventing a model
rather than running a query. Week-over-week compares fourteen days of real
buckets, seven against seven, instead of estimating from a month.

### Pipeline observability and correlation IDs

New table `pipeline_events` (migration `0004_pipeline_events`) and
`/admin/system-logs`. It answers "what happened when I clicked Submit KYC?" —
the mechanical steps, their timings, their errors — which the audit log does not,
because the audit log answers "who decided what".

They differ in a way that matters: audit entries are written *inside* the
caller's transaction, so a rolled-back decision leaves none; pipeline events are
written *outside* it, because a rolled-back attempt is the interesting kind.

- A correlation id is generated once per action and propagated through
  `AsyncLocalStorage`, so nested services inherit it without a `correlationId`
  parameter on every signature in the codebase.
- `trackPipeline()` times an operation, records the outcome, and **re-throws**.
  Swallowing would turn every instrumented call into one that silently succeeds.
- Recording never throws. An observability table that can fail a KYC submission
  has made the system less reliable in exchange for knowing more about it.
- `redact()` strips connection strings, `apikey`/`token`/`password` pairs and
  JWTs from error text before storage — driver errors quote what they were
  given, and a log an operator browses is not the place for a connection string.
  `metadata` takes named scalars only; nothing writes a request body into it.

Instrumented: `auth.sign_in`, `kyc.submit`, `kyc.approve`, `kyc.reject`,
`deposit.assign`, `chain.scan`, `investment.create`, `withdrawal.request`,
`withdrawal.approve`, `withdrawal.reject`, `email.password_recovery`.

### Authentication, verified against the live project

`GET /auth/v1/settings` on the configured project reports
`mailer_autoconfirm: false`, `disable_signup: false`, email provider enabled.
Confirmation is on, which is exactly why `/auth/callback` had to exist.

- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` accepted alongside the older
  `..._ANON_KEY`, newest name first.
- `getAuthPrincipal()` returns null rather than throwing when there is no
  request scope. "No request" is "nobody is signed in", which is what null
  means — and it fixes a pre-existing test failure that only appeared when
  Supabase credentials were configured.
- `createClient()` from `@supabase/supabase-js` **throws on Node 20**: it builds
  a realtime client during construction and there is no global `WebSocket`.
  Next's runtime polyfills one so the request path was fine, but a `tsx` script
  is not. The three auth calls that need no session now go through
  `lib/supabase/auth-rest.ts` — plain `fetch` against the documented GoTrue
  endpoints, no realtime, no new dependency.
- Blocked, suspended and deactivated accounts are refused at sign-in and by
  `(app)/layout.tsx`. An operator's decision in the CRM now reaches the product.

### Development accounts

`npm run db:dev-accounts` links `DEV_ADMIN_EMAIL` / `DEV_ADMIN_PASSWORD` and
`DEV_TEST_EMAIL` / `DEV_TEST_PASSWORD` to a seeded operator and to an
application account. It refuses under `NODE_ENV=production`, prints no password,
and creates the credential through the ordinary public `signUp` endpoint —
deliberately not the admin API, which needs the service-role key this project
does not hold anywhere.

**Not completed in this session: Supabase's built-in email sender is rate
limited** ("email rate limit exceeded" on every attempt), so neither account
could be created. That is the documented development-only sender doing what
§19.3 says it does. The script, the environment template and the linking logic
are in place and untested end to end.

### Tests — 111, from 96

New `pipeline.integration.test.ts` (9): redaction of connection strings, API
keys and JWTs; one correlation id spanning nested calls and separate ids for
separate requests; a success recorded with a measured duration; a failure
recorded **and** re-thrown; recording swallowing an impossible foreign key.

`auth-and-kyc.integration.test.ts` rewritten where admin auth changed it: the
operator tests now assert that no session means no operator and that server
actions refuse, rather than passing an agent id to a function that no longer
takes one. The KYC lifecycle tests call the service directly — the action in
front of it resolves a session a test process does not have — and `submit()`
now calls the real `submitKyc` instead of hand-writing the rows it writes,
which is what let the test and the code drift.

Four assertions were counting instead of testing, and all four broke the moment
a real user registered and submitted verification:

- `users.length === 30` → at least `SEED_USER_COUNT`. The seeded dataset is a
  baseline, not a limit; an exact assertion made a successful sign-up look like
  a regression.
- `submissions.length === 14`, `documents === 28`, `notes === 5` → assert that
  no document or note appears twice, which is the property the test existed to
  protect (a join multiplying submissions by their documents).
- "seeded accounts carry no Supabase credential" → scoped to seeded ids, since
  registered accounts are *expected* to carry one.
- Schema counts updated for `pipeline_events`: 32 tables, 39 enums, 26 foreign
  keys. `pipeline_events` joins `investment_earnings` and `chain_scan_state` as
  a table the seed deliberately leaves empty — a fixture there would make the
  one screen that exists to diagnose real problems the one screen guaranteed to
  be fiction.

### Also

- `API_DOCUMENTATION.md` added: the two mutation chains, every server action and
  its permission, the lifecycles, and the environment-variable classification.
- `/admin/system-logs` is gated on `audit_logs` rather than a fourteenth
  permission id. Both screens answer "what happened" and both expose other
  people's activity; they are different questions at the same trust level.
- The dashboard's "recent activity" panels and the audit log now read the same
  rows as everything else. The dashboard's *headline* metrics remain seed data
  (CLAUDE.md §16.5) — they describe the whole platform, which is a reporting
  service's job.

---

## 2026-08-21 — Supabase Auth, database as source of truth, scanner fix

The application stopped signing everyone in as the same demo person, the
frontend stopped completing business actions on its own, and the deposit
scanner started working.

### The scanner bug — root cause

`npm run tron:scan` failed on every run while updating `chain_scan_state`. The
error read as a database problem and was not one:

```
TypeError [ERR_INVALID_ARG_TYPE]: The "string" argument must be of type string
or an instance of Buffer or ArrayBuffer. Received an instance of Date
```

…wrapped in Drizzle's "Failed query". A `Date` interpolated into a `sql`
fragment gets **no column type mapper** — a fragment has no column to take one
from — so postgres.js received a raw `Date` and refused it. Every other write in
the same file worked because those values went through `.values()` / `.set()`,
which do apply the mapper.

The tell was in the parameter list: `$6` was `2026-08-20T19:33:15.000Z` and
`$12`, inside `greatest(...)`, was `Fri Aug 21 2026 01:03:15 GMT+0530`.

Fixed with `timestampValue()` in the new `@/db/sql-values`, which passes ISO
text with an explicit `::timestamptz`. The hazard is documented there because it
is general and silent. It was the only occurrence — a sweep of every `sql`
interpolation in the project found no others.

**Verified against live Shasta.** A real 1000 USDT TRC-20 transfer
(`bde2fe6004…6edc`, from `TVF2Mp9QY7…`) was detected, contract-verified,
recipient-verified, confirmed solidified, and recorded as an **unassigned**
deposit. Re-running the scanner leaves one row. It survived a full reseed and
re-detection: still one row.

### Supabase Auth (email OTP)

- Migration `0002_auth_user_link.sql`: `users.auth_user_id uuid`, unique.
  Nullable — seeded accounts have no credential, and inventing auth users for
  them would mean thirty sign-in-able accounts nobody owns.
- `@supabase/supabase-js` + `@supabase/ssr`. No other new dependency.
- `server/auth/session.ts` uses `getUser()` (verifies the token) rather than
  `getSession()` (decodes the cookie). The cookie is attacker-controlled.
- `server/auth/account.ts` resolves `auth.users.id → public.users.auth_user_id`.
  A pre-existing row with the verified email and no link is adopted rather than
  duplicated — safe only because Supabase just proved control of the mailbox,
  so the ordering is verify-then-link.
- `/login` (email → code → verify) and `/complete-profile`. One path for
  sign-in and sign-up; Supabase creates the auth user.
- `middleware.ts` refreshes the session cookie and deliberately authorizes
  nothing.
- Logout is a real sign-out and redirect. The "reset demo data" control is gone.

**No password, hash, OTP or token is stored in `public`.** A test asserts no
column in the schema is named like a credential.

### No automatic demo login

`getCurrentUserId()` returned a fixed demo account, so every visitor saw one
person's wallet, allocations, referrals and verification status. It now resolves
the session or throws `NotAuthenticatedError`.

`(app)/layout.tsx` redirects to `/login` without a session and is
`force-dynamic` — those pages render one account's data and must never be
prerendered.

**The seed-data fallback was removed from every user-scoped read.** It used to
return the demo person's records when no database was configured. Catalogue
content keeps its fallback; it belongs to nobody. A database outage now fails
visibly, which is the point: a wallet rendering a plausible figure from mock
data during an outage is worse than one rendering an error.

### Fake frontend actions removed

- **Deposit.** "Simulate incoming transfer" walked a fake confirmation counter
  and then credited the wallet in the browser. Replaced by a development-only
  control that records a **pending, unverified** deposit through the service
  layer — no ledger entry, a `intent:` prefixed reference that cannot be
  mistaken for a transaction hash, and `assignDepositToUser` refuses anything
  that is not `confirmed`, which only the scanner sets. Absent from a production
  build.
- **KYC.** A "Simulate approval" button set the status to `verified` client-side
  — so the gate on investing and withdrawing was a client-side boolean.
  Submission is now a server action writing `kyc_submissions`, documents
  metadata and `users.kyc_status = pending_review`. Approval is an operator
  decision only.

### The React error, root cause

> Cannot update a component (PrototypeStoreProvider) while rendering a
> different component (DepositFlow).

`creditDeposit()` and `toast()` were called **inside a `setConfirmations`
updater**. Updater functions must be pure — React invokes them during render —
so the dispatch ran mid-render of `DepositFlow`.

Not deferred, not suppressed with a `useEffect`: the call was removed. The
browser has no business crediting a wallet.

### KYC, end to end

User submits → `kyc_submissions` (`pending`) + `users.kyc_status =
pending_review` → CRM queue → operator approves or rejects → status and
`rejection_reason` persist → the user reads it back. One database, one row.

Rejection requires a reason, because the reason is what the user is shown.

### Admin actions, server-side

`server/admin/guard.ts`: every operator mutation resolves the agent **from the
database** and checks the stored permission level. The client says which agent
it is; it does not get to say what that agent may do. Master admin holds
`manage` implicitly, matching §15.3.

KYC approve / reject / request-resubmission / add-note are now server actions
with permission checks and audit entries. Deposit assign / ignore already were.

**This does not make identity real** — there is no admin authentication, so the
agent id still comes from the client. Documented as the build's most significant
gap in CLAUDE.md §20.1.

### Thirty seeded users

`SEED_USER_COUNT = 30`, down from 32. Every dependent collection is filtered
against those ids: wallets, KYC cases and their documents and notes,
investments, deposits, withdrawals, referral accounts, referral edges,
commissions, device sessions, security events, and audit entries whose target is
a user. No orphans; the CRM never links to an account that does not exist.

583 rows across 29 tables. A baseline, not a limit — registrations push it past
thirty.

### Also

- `revalidate()` wraps `revalidatePath` and swallows only its missing-store
  invariant. A mutation has already committed by then; reporting a cache
  failure as an action failure invites retrying completed work, which for an
  approval or a credit is the expensive kind of wrong.
- TRON env aliases: `TRONGRID_API_URL`, `TRONGRID_API_KEY`,
  `TRON_DEPOSIT_ADDRESS`, `TRON_CONFIRMATIONS` accepted alongside the original
  names, so a rename in one place cannot silently disable detection.
- `.env.example` gained the Supabase block and a note that SMTP belongs in the
  Supabase dashboard, not here.

### Tests — 96, from 81

New `auth-and-kyc.integration.test.ts` (15): unauthenticated requests get
nothing rather than a demo account; account reads refuse rather than falling
back; the dataset holds thirty accounts with no orphans and no credential
columns; the full KYC lifecycle including a rejection with its reason and a
refused reasonless rejection; operator permission checks; and that a
development deposit intent is pending, unverified, unlinked to any ledger entry,
and cannot be credited.

Two bugs the suite found in itself and fixed: cleanup deleted audit rows by
`actorId = 'agt_master'`, which is a **seeded** operator, so it was destroying
seed data; and an exact deposit count broke the moment the scanner recorded a
real transfer — the assertion is now about the join it was actually testing.

### Verification

`typecheck`, `lint`, **96/96 tests**, `next build`, `db:check` (31 tables, 37
enums, 25 foreign keys, 30 users), `tron:inspect` and `tron:scan` all pass.

Route protection verified by request against the production build: `/`,
`/wallet`, `/wallet/deposit`, `/referral`, `/settings`, `/settings/kyc` and
`/plans` all return **307 → /login** unauthenticated; `/login` returns 200 and
contains zero demo-account data. The CRM renders the real Shasta transaction
hash, its sender and **Unassigned** from the same database.

**Not verified: OTP email delivery.** No Supabase Auth credentials are
configured in this environment, so no code has been sent or accepted. The
integration is complete in code and untested in practice — see CLAUDE.md §19.3
for exactly what remains to configure.

---

## 2026-08-20 — Persistent writes and TRON Shasta deposit detection

The database stopped being read-only. Money movements are now persisted
transactionally with a ledger entry and an audit record, and incoming TRC-20
USDT transfers on TRON Shasta are detected, verified and recorded by a
server-side scanner. No authentication, no signing, no mainnet, no payouts.

### Money without floating point

The write layer's foundation, and a change of rule rather than of storage.

The columns were already `numeric`; they are read back as JavaScript `number` so
the domain types keep working, which is fine for display and wrong for
arithmetic. `src/db/money.ts` introduces `Decimal` — a branded exact decimal
string — with:

- validating constructors that reject exponents, `NaN`, thousands separators and
  numbers that are not exactly representable (`0.1 + 0.2` throws rather than
  banking 0.30000000000000004);
- `fromTokenUnits` / `toTokenUnits` via `BigInt`, because TRC-20 amounts can
  exceed `MAX_SAFE_INTEGER` and `Number()` would round them;
- `numericValue()`, which binds the exact digits and casts to `numeric`.

Balances move with `UPDATE … SET available = available + $1::numeric` —
Postgres does the arithmetic. Passing a bare `Decimal` where a column expects
`number` is a type error, which is what keeps the rule enforced rather than
merely documented. Balance comparisons read the columns cast to `text` so no
float is involved in deciding whether a withdrawal fits.

A bug this found: `fromTokenUnits` built a fixed-width fraction, so an
18-decimal token reporting 2.500000000000000000 was rejected for exceeding the
storable scale. Trailing zeros are now trimmed before the precision check;
genuine excess precision is still refused rather than silently rounded.

### Schema (2 new tables, 31 total)

- **`deposits` rewritten** for chain data: nullable `user_id`, `sender_address`,
  `token_contract`, `token_symbol`, `chain`, `chain_network`, `block_number`,
  `block_timestamp`, `verification`, `detected_at`, `confirmed_at`,
  `assigned_at`, `assigned_by`, and a **unique index on (chain, tx_hash)**.
- **`investment_earnings`** — accruals, with a unique `(investment_id,
  period_key)` so a replayed scheduler cannot pay twice.
- **`chain_scan_state`** — the scanner's cursor, per (chain, network, address),
  with failure tracking.
- New enums: `deposit_verification`, `chain`, `chain_network`; `ignored` added
  to `deposit_status`.

Migration `0001_chain_deposits.sql`, applied to Supabase. `deposits` gained a
left join in the admin repository — an inner join silently dropped exactly the
unattributed rows an operator opens that screen to deal with.

### Write layer

`mutate()` in `@/server/write` is the unit of work: one transaction, buffered
audit entries written inside it, a named actor, one `now` for every row. Writes
have no seed-data fallback — a write that appears to succeed against mock data
is a lie, so it refuses when `DATABASE_URL` is unset.

`applyLedgerEntry()` in `wallet.repository.ts` is the only place a balance
changes, and it always writes the `transactions` row explaining it. Overdrafts
are refused by a `WHERE available + delta >= 0` clause rather than a prior read,
which two concurrent withdrawals would both pass.

Services added: `wallet.service` (credits, debits, earnings),
`deposits.service` (record, assign, ignore, reopen), `account-write.service`
(users, status, restrictions, KYC, notifications, referrals, commissions),
`investments-write.service` (allocate, mature), `withdrawals-write.service`
(request, approve, reject, mark paid — **records only**).

Idempotency is enforced by database constraints, never by check-then-insert:
unique `(chain, tx_hash)` for deposits, unique `(investment_id, period_key)` for
earnings, and status re-assertions in the `WHERE` of every transition.

### TRON integration (`@/server/tron`)

Read-only, Shasta only, no dependency added — `tronweb` was declined in favour
of forty lines of base58check, because a library that can sign is one that can
be made to.

- `address.ts` — base58check validation (checksum, not length: a mistyped
  address still looks like an address) and base58/hex comparison, because
  TronGrid returns both notations.
- `config.ts` — validates before use. `mainnet` throws. A plaintext
  `TRON_GRID_URL` throws. A contract or deposit address that fails base58check
  throws. `describeTronConfig()` is the only thing that leaves, and it reports
  the API key's *presence*, never its value.
- `trongrid.ts` — transfers, head/solid block heights, per-transaction block
  lookup. Every failure throws, including a body that is not JSON or lacks a
  `data` array: an empty list is indistinguishable from "no deposits arrived".
- `parse.ts` — filters by contract, recipient and direction, with named
  rejection reasons so a skipped transfer can be explained rather than silently
  dropped. Token decimals are read from the response, never assumed.
- `scanner.ts` — polls, records solidified transfers as **unassigned** deposits,
  never advances its cursor past a failed page, and records failures so a
  scanner that has been broken for a day is visible.

### Deposit attribution

`deposits.user_id` is nullable and the scanner never sets it. One platform
address receives everything, and a TRC-20 transfer carries no account
identifier — exchanges pay out from shared wallets, and a user can send from an
address they never mentioned. Attribution is an operator decision, made in the
CRM and audited. The dialog shows the sending address and deliberately offers no
"best match": a plausible suggestion is the one most likely to be accepted
without checking. Per-user deposit addresses remain possible without schema
change.

### Admin CRM

- Server actions (`assign`, `ignore`, `reopen`) that write to the database and
  `revalidatePath`.
- The store gained a `seed/replace` action and an effect that re-syncs when the
  server sends a new snapshot — `useReducer` ignores a changed initial state, so
  without it a successful write left the screen showing stale rows. The chosen
  operator is preserved across a re-sync.
- Deposits table: "Assigned to" (with an explicit **Unassigned**), sender
  address, chain/network/token, and transaction hashes linked to the Shasta
  explorer — only for real 64-hex hashes, since linking seeded placeholders
  would send an operator to a "not found" page and make them distrust the real
  ones.

### User application

The deposit page shows the configured TRC-20 target: TRON, USDT, Shasta,
the address with a copy action, the contract's last six characters, and a
testnet warning — real USDT sent to a Shasta address is lost, and this is the
only place the app can say so first. It receives `PublicDepositTarget`, a
hand-written projection with no field the API key could occupy.

### Tests (81, from 42)

- `money.test.ts` (11) — exactness, token-unit conversion past
  `MAX_SAFE_INTEGER`, refusal to round.
- `tron/tron.test.ts` (16) — base58check including a corrupted checksum,
  mainnet refusal, contract/recipient/direction filtering, decimals scaling at
  6 and 18, and every malformed-transfer case.
- `writes.integration.test.ts` (12) — against the live database: ledger-balance
  agreement to the last digit, rollback on failure, overdraft refusal writing
  nothing, the same tx hash recorded once, unassigned-by-default, credit exactly
  once, unconfirmed and ignored deposits refused, audit entries carrying the
  operator's reason, and earnings settling once per period.

`npm test` now runs with `--test-concurrency=1`: the files run in parallel by
default and together exhausted the Supabase session pooler, which surfaced as a
134-second insert rather than an obvious connection error. The suite leaves the
database exactly as it found it — verified by running it twice and re-counting.

Also fixed: the write suite leaked system-actor audit rows (cleanup matched only
its operator), and `data-access.integration.test.ts` asserted an exact audit-log
count, which is wrong for an append-only table that every write adds to.

### Verified against live Shasta

TronGrid client exercised against the real network without credentials: head
block 67,657,339, solidified 67,657,320 (19 behind), 50 transfers parsed from a
live listing. The Shasta USDT contract
`TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs` reports `decimals: 6`, confirming the code
reads decimals rather than assuming them. A real transfer not addressed to the
configured deposit address was correctly rejected as `wrong_recipient`, and a
block lookup confirmed solidification.

### Checks

`tsc --noEmit`, `eslint .`, 81 tests and `next build` all clean. Schema
verification: 31/31 tables, 37 enums, 25 foreign keys.

### Not implemented, deliberately

Authentication, KYC provider integration, real withdrawals, mainnet, private-key
signing, per-user deposit addresses. The CRM's non-deposit operator actions
still mutate the in-memory store; their write services exist and need admin auth
before being wired up.

---

## 2026-08-19 — Connected to Supabase PostgreSQL

The database layer built the day before is now running against a real Supabase
project (AWS ap-northeast-2, PostgreSQL 17.6). Migration applied, seed loaded,
schema verified. Reads are live; writes still do not exist, and authentication,
blockchain and real withdrawals remain out of scope.

### Connection architecture

Two environment variables, because the workloads differ:

- `DATABASE_URL` — the runtime. Pooled, `max` 5 per instance (down from 10:
  per-instance, not per-database, and a serverless deployment runs many).
- `DIRECT_DATABASE_URL` — `db:migrate`, `db:seed`, `db:studio`. One connection,
  opened and closed by the script. A migration takes an advisory lock and
  issues DDL; it has no business sharing the render pool. Optional, falls back
  to `DATABASE_URL`.

`createAdminDb()` / `closeAdminDb()` were added alongside `getDb()` so the two
are genuinely separate pools with separate lifecycles, and `drizzle.config.ts`
plus all three scripts now use the admin connection.

### Which Supabase endpoint — two rejected, with reasons

Both obvious choices turned out to be wrong, and both failures are silent:

- **Direct** (`db.<ref>.supabase.co:5432`) publishes **AAAA records only**.
  Confirmed: `ENODATA` for A records, `ENETUNREACH` on connect. Vercel's
  serverless runtime has no IPv6 egress either, so it is unusable in production
  regardless.
- **Transaction pooler** (`:6543`) is the standard serverless recommendation and
  was the first configuration. It had to be abandoned: postgres.js pipelines
  queries onto a connection, and past roughly two queued queries the pooler
  stops answering — no error, no timeout, the promise never settles. Measured at
  every pool size from 1 to 10, and **not** fixed by `prepare: false`.
  Reproduced with the stock driver and no local patches, ruling out our own
  socket hook. A page issuing six parallel queries hung.
- **Session pooler** (`:5432` on the pooler host) is what both variables now
  use. IPv4, pooled by Supavisor, and it handled 20 queued queries on a single
  connection in 2.9s.

Transaction-mode support stays in the client (`usesTransactionPooler()` detects
it and disables prepared statements) so switching back is one env change.

### Fixes found while connecting

- **The credential carried the dashboard's placeholder brackets.** The password
  in `.env.local` was wrapped in literal `[ ]` — the Supabase connection string
  is copied as `…:[YOUR-PASSWORD]@…` and the brackets had been left around the
  real value, so every authentication attempt returned `28P01`. Stripped, and
  the value re-encoded for URL safety.
- **A ~5s stall on every new connection**, traced to `getaddrinfo` waiting on
  AAAA before falling back to IPv4 — `dns.lookup` 4.3s vs 3ms with `family: 4`.
  Added `DATABASE_FORCE_IPV4` (default **off**), which opens the socket via
  postgres.js's `socket` hook with `family: 4`. Enabled in this machine's
  `.env.local` only; the stall is a property of the host, not the application.
- **A dead database hung instead of failing.** postgres.js retries a refused
  connection indefinitely, so the query never settled and the request sat open —
  on a serverless platform, a billed silent stall. `fromDatabase()` now races
  every read against `DATABASE_QUERY_TIMEOUT_MS` (default 15s). Before: no
  response at 60s. After: 500 in 15s, with no mock data served.

### Layering fix

`admin.repository.ts` imported `ADMIN_PERMISSIONS` from `@/constants/admin`,
which also carried the CRM's navigation and therefore `lucide-react` — a UI
dependency reaching the server bundle to answer a question about a column.

- Navigation moved to `src/constants/admin-navigation.ts` (the only consumer is
  `admin-sidebar.tsx`). `@/constants/admin` is now free of UI imports.
- The repository takes its permission ids from `schema.adminPermissionEnum`
  instead — the database enum *is* what the column accepts.
- The two lists are pinned to each other by a compile-time assertion in
  `db/schema/enums.ts`, so adding an id to one without the other is a type error.

No UI changed.

### Migration and seed

`npm run db:migrate` applied `drizzle/0000_init.sql` cleanly. `npm run db:seed`
loaded **602 rows across all 29 tables** — 32 users, 32 wallets, 128 KYC steps,
31 investments, 22 deposits, 15 withdrawals, 14 KYC submissions with 28
documents, 22 referrals, 21 commission entries, 9 agents with 117 permission
grants, 25 audit entries, 1 settings row.

### Verification

`npm run db:check` was extended to report both connections, the pooler mode in
use, and — scoped to the `public` schema, which a Supabase database needs, since
its own `auth`/`storage`/`realtime` schemas otherwise inflate every count — the
table, enum, foreign-key and index totals. Result: **29/29 tables, 34 enums,
23 foreign keys, 82 indexes, 32 users.**

Against the running production build, `/admin/investments` renders "31 in total,
all time" — the seeded count. The mock module holds 29, so the page could not
have come from the fallback. Every route returns 200; the admin catch-all still
404s; the server log is clean.

### Tests

41 with a database, 16 without (integration suites skip themselves, so a fresh
clone stays green). `npm test` now passes `--conditions=react-server`, which is
how `server-only` modules resolve under Next — without it they throw, and the
service layer could not be tested at all.

- `db/connection.integration.test.ts` (new) — both connections, prepared-statement
  selection, and 20-then-40 parallel queries. That last one is the regression
  test for the transaction-pooler stall: every individual query passed, and the
  only symptom was a page that never loaded.
- `db/schema.integration.test.ts` (new) — live database against the declared
  schema in **both** directions, every enum's labels in order, every foreign
  key's target, a primary key per table, every declared index, and that no money
  column has become a float.
- `server/data-access.integration.test.ts` (new) — repositories and services
  against seeded records: profile with ordered KYC steps, wallet reconciling
  against active allocations, `matured`→`completed` translation, KYC documents
  grouped without join multiplication, each agent's 13-key permission map,
  audit trail ordering, and settings.
- `server/database.test.ts` (new, no database needed) — unset URL falls back to
  seed data, blank URL counts as unset, an unreachable database rejects rather
  than faking, an unresponsive one fails on the deadline, and a failure is not
  cached into a permanent outage.

### Documentation

CLAUDE.md §16.1 rewritten with the real setup, the two connections, and the
endpoint findings above; §16.3 documents the deadline; §16.7 added covering the
test layout. `.env.example` rewritten with both variables and the tuning knobs.

### Unchanged

No user or admin UI was modified. Authentication stays disabled, no blockchain
integration, no real withdrawals. `.env.local` remains git-ignored and holds the
only copy of the credentials.

---

## 2026-08-18 — PostgreSQL, Drizzle ORM and the server layer

Introduced a real database and moved every read behind a server-side service
layer. Reads come from PostgreSQL; writes deliberately do not exist yet. No UI
was redesigned or removed — with no database configured the application renders
exactly what it did before.

### Dependencies

`drizzle-orm`, `postgres` (postgres.js). Dev: `drizzle-kit`, `tsx`, `dotenv`.
No test framework — the tests run on `node:test` through `tsx --test`.

### Schema (`src/db/schema/`, 29 tables)

Grouped by aggregate, not by application: the two frontends stay isolated from
each other but describe one platform, so a user's balance is the same row
whichever screen reads it.

- `users`, `wallet_balances`, `bank_accounts`, `wallet_addresses`,
  `user_kyc_steps`, `user_device_sessions`, `user_security_events`,
  `support_tickets`
- `plans`, `deposit_networks`, `investments`
- `transactions`, `deposits`, `withdrawals`
- `kyc_submissions`, `kyc_documents`, `kyc_notes`
- `vip_levels`, `referrals`, `referral_accounts`, `commission_entries`
- `notification_categories`, `user_notification_preferences`, `notifications`,
  `notification_campaigns`
- `admin_agents`, `admin_agent_permissions`, `audit_logs`, `platform_settings`

Decisions worth recording:

- **Money is `numeric`, never a float** — USDT carries eight decimals on-chain.
  Shared column builders (`usdt`, `inr`, `percent`, `rate`) map back to `number`
  so the domain types in `@/types` are unchanged.
- **`text` primary keys carrying the seed's meaningful ids** (`usr_8c41a2`,
  `plan_starter`), so links like `/admin/users/usr_8c41a2` stay valid.
- **Postgres enums** mirroring every union in `@/types` and `@/types/admin`,
  including the 13-permission catalogue the CRM's authorization contract needs.
- **One vocabulary where the two apps used two words**: `investment_status`
  stores `matured`, mapped to the user app's "completed"; `plan_status` carries
  `disabled`, which the public catalogue filters out rather than renaming.
- **Both applications read the same plan, VIP and wallet rows** — the CRM cannot
  show a commission rate the user was not promised.
- **Only masked account and document numbers are stored**, and there is no
  password column. There is no payout rail, no document store and no auth; a
  prototype should not accumulate data it cannot yet protect.
- `investments` snapshots `planName`, `rewardFrequency` and `risk` so editing a
  plan does not retroactively rewrite what an existing allocation was sold as.
- `audit_logs` copies the actor's name and role for the same reason — the record
  must still read correctly after an agent is renamed or removed.

### Migrations

`drizzle.config.ts` + `drizzle/0000_init.sql` (generated, checked in).
`npm run db:generate` regenerates after a schema change; `npm run db:migrate`
applies pending migrations on its own single connection.

### Seed (`src/db/seed/`)

Reads the mock modules in `@/data` rather than inventing a second dataset, so
seeding produces the application everyone already knows.

The user app's and the CRM's mock data overlapped in three places, and each is
reconciled explicitly (documented at the top of the module):

- **Investments** — the demo account's allocations come from the user app's
  dataset, because only that one reconciles against the wallet (2,500 + 1,200 +
  200 = the 3,900 USDT shown as locked). The CRM's three rows for the same
  account are dropped. Every other user's come from the CRM.
- **Security events** — `sec_1…4` and `sev_2001…2004` are the same four events
  at the same timestamps. Only the CRM's are stored; the user's security screen
  renders a projection of them.
- **Commissions** — the CRM ledger and the user's history share two entries;
  stored once, with the user's remaining four added to the ledger.

The seed is destructive by design (clears every table first, so it can be
re-run) and refuses to run against `NODE_ENV=production`.

### Server layer (`src/server/`)

```
page → services/*.service.ts → repositories/*.repository.ts → db/schema
```

- Every module carries `server-only`; nothing under `src/db/` does, because the
  scripts run those as plain Node.
- Repositories query tables and return domain types from `@/types`. All
  row→domain mapping lives in `repositories/mappers.ts`.
- Services are the only thing application code imports, and they own the
  fallback.

`fromDatabase()` in `server/database.ts` is the seam: with `DATABASE_URL` unset
it returns the seed modules, so a fresh clone still runs. Two properties are
load-bearing — the fallback is chosen by **configuration, never by failure**
(a failing query throws rather than silently serving mock data), and
`unstable_noStore()` is called only on the database path, so with no database
the build still prerenders every page it did before.

### Reads moved onto the layer

- **User app.** `(app)/layout.tsx` reads the account once via `getUserAppSeed()`
  and passes it to `PrototypeStoreProvider` as a `seed` prop; the store no
  longer imports `@/data`. `TopBar` became an async server component. Pages for
  home, plans, plan detail, wallet, deposit, withdraw, referral, security,
  wallet settings, support and investment detail now call services.
- **CRM.** `admin/layout.tsx` reads the whole platform via `getAdminSeed()` and
  passes it to `AdminStoreProvider`. Four read-only slices were added to the
  store (`investments`, `referralAccounts`, `commissionLedger`,
  `securityEvents`) so the screens that used to import their own copy read the
  same snapshot. `/admin/users/[id]` resolves its static params through the
  service.
- Client components that imported records now take them as props
  (`WalletSettings`, `DepositFlow`, `WithdrawFlow`, `SupportCenter`,
  `SecuritySettings`, `VipLevels`, `EarningsBreakdown`, `InvestmentDetail`) or
  read them from the store (`ProfileHeader`, `ProfileForm`,
  `NotificationSettings`).
- Presentation vocabulary (`rewardFrequencyLabels`, `depositStatusLabels`,
  `auditActionLabels`, FAQs, legal copy) still comes from `@/data`. It is
  wording, not records.

### Deliberately left on seed data

- `earnings.service.ts` — the earnings curve is a daily accrual model; the
  ledger records rewards as they settle. Deriving one from the other is an
  accrual model, not a query.
- The CRM dashboard's metrics and chart series — these describe the whole
  platform rather than the sample slice in the tables, which was a deliberate
  decision before the database existed and is still correct.

Both are marked in place and listed in CLAUDE.md §16.5.

### Not implemented, on purpose

Writes. There is no authentication, so no write can be attributed to a user or
an operator, and persisting money movements without knowing who asked for them
is worse than persisting nothing. Both stores still mutate in memory. Blockchain
connectivity and real withdrawals remain out of scope.

### Configuration

`.env.example` added as the tracked template; `.gitignore` now ignores every
`.env*` except it. No credential appears in source. `DATABASE_URL`,
`DATABASE_SSL`, `DATABASE_POOL_MAX` and `DEMO_USER_ID` are the recognised
variables.

Scripts: `db:generate`, `db:migrate`, `db:seed`, `db:check`, `db:studio`,
`typecheck`, `test`.

### Tests

First tests in the project, on `node:test` via `tsx --test` (no framework
dependency).

- `db/seed/seed.test.ts` runs the seed against a recorder — no database needed —
  and asserts every foreign key resolves, primary and unique keys hold, every
  table declared in the schema is seeded, the overlapping records are stored
  once, and the demo account's wallet reconciles against its allocations.
- `db/env.test.ts` covers the configuration switch, including a whitespace-only
  `DATABASE_URL` not counting as configured.

### Verification

`tsc --noEmit`, `eslint .`, `npm test` (12 passing) and `next build` all clean;
the build still emits 72 prerendered pages, unchanged. Every route was requested
against a dev server and returned 200 with the expected content. The database
path was exercised separately with an unreachable `DATABASE_URL`, confirming it
issues real SQL against the schema and surfaces a 500 rather than silently
falling back.

---

## 2026-08-09 — Master CRM (admin frontend)

Added a complete administrative control panel at `/admin`, architecturally
separated from the user application. Frontend only: no authentication,
database, API, blockchain, KYC provider or payment processing.

### Structural change: route groups

The root layout previously carried `PrototypeStoreProvider` + `AppShell`. A
Next.js layout cannot be removed by a descendant, so `/admin` would have
inherited the mobile bottom navigation.

- Moved every user route into `src/app/(app)/` — a route group, so **no URL
  changed**.
- `src/app/layout.tsx` is now the document only: fonts, skip link, `Toaster`.
- `src/app/(app)/layout.tsx` carries the user app's store and shell.
- `src/app/admin/layout.tsx` carries the CRM's store and shell.
- The global `not-found.tsx` now wraps itself in `AppShell`, preserving the
  previous 404 behaviour for unmatched URLs.
- Added `src/app/admin/[...unmatched]/page.tsx` calling `notFound()`. Without
  it an unknown `/admin/*` URL never enters the admin segment, so Next resolves
  the *root* 404 and drops an administrator into the user app's shell.

### Admin domain model

- `src/types/admin.ts` — roles, graded permissions, agents, sessions, admin
  users, KYC cases, deposits, withdrawals, investments, plans, referrals,
  device sessions, security events, audit entries, notification campaigns,
  platform settings, dashboard metrics. Reuses the user domain (`KycStatus`,
  `RiskLevel`, `VipLevelId`, …) rather than redefining it.
- `src/constants/admin.ts` — CRM navigation, the 13-permission catalogue, agent
  role presets.
- `src/lib/admin-permissions.ts` — `canView` / `canManage` / `permissionLevel`.

### Permission model

Two roles: **master admin** (holds `manage` implicitly — the role is the grant)
and **agent** (holds what is assigned). Permissions are graded `none` / `view` /
`manage` rather than boolean, because support staff who may look but not approve
are a real tier.

Enforced in the UI three ways: nav items omitted, `PermissionGate` replacing a
screen, and `canManage()` disabling individual controls rather than hiding them.
Documented in `CLAUDE.md` §15.3 as a **usability affordance, not a security
boundary**.

Since there is no authentication, the "signed-in" operator is chosen from a
clearly-labelled demo control in the header — which is what makes the model
reviewable at all.

### Mock data (`src/data/admin/`)

32 users (the first is the same account the user app signs in as), 15 KYC
cases, 21 deposits, 15 withdrawals, 28 investments, the plan catalogue derived
from `@/data/plans`, 15 referral accounts + 17 commission entries, 9 agents, 12
device sessions, 15 security events, 8 notification campaigns, 26 seed audit
entries, dashboard aggregates and four chart series.

VIP percentages and thresholds are **not** restated here — both applications
read `@/data/referrals`.

### Admin store (`src/lib/admin-store.tsx`)

Context + reducer, in-memory, seeded from `@/data/admin`. 30 actions, each
mapping 1:1 to a future API call.

Two deliberate properties:

1. **Every mutating case writes its audit entry in the same reducer case** via
   `withAudit()` — the write and its audit record are one transaction, so the
   audit screen shows real consequences of what the operator just did.
2. **Reasons collected by a dialog reach the audit entry** via `withNote()`.

### Routes created (13)

`/admin`, `/admin/users`, `/admin/users/[id]` (SSG, 32 pages), `/admin/kyc`,
`/admin/deposits`, `/admin/withdrawals`, `/admin/investments`, `/admin/plans`,
`/admin/referrals`, `/admin/agents`, `/admin/notifications`,
`/admin/audit-logs`, `/admin/settings`, plus admin `error.tsx`,
`not-found.tsx` and the catch-all.

The user detail page has 10 tabs: Overview, Investments, Deposits, Withdrawals,
Profits, Referrals, KYC, Devices, Security, Activity.

### Components created

`AdminShell`/`AdminPage`/`AdminSection`, `AdminSidebar`, `AdminHeader` (with
operator switcher + mobile drawer), `AdminStatCard`, `DataTable`, `FilterBar`,
`AdminStatusBadge` and its named wrappers, `ConfirmActionDialog`,
`ActivityTimeline`, `AuditLogTable`, `PermissionMatrix`, `PermissionGate`,
`UserActionMenu`, `DetailCard`/`DetailList`, four chart components, and one
folder per section.

`DataTable` renders one column definition two ways — a real `<table>` from `md`
up inside its own scroll container, and a card list below it.

### Charts

`PlatformFlowChart` (deposits above a zero baseline, withdrawals below —
position carries the direction, colour reinforces it), `SeriesBarChart`,
`TrendChart`, `StatusBreakdownBar`. The two-hue pair (`--chart-1` teal /
`--chart-5` amber) was validated against the card surface in both modes: CVD ΔE
10.1 light / 9.7 dark, normal-vision ΔE 17.9 / 18.0, each above 3:1 contrast.
Every chart ships a screen-reader table.

### Shared-component changes

- `ui/sheet.tsx` — added a `side` prop (`bottom` default, `left` for the CRM's
  mobile nav drawer). Default behaviour unchanged; the close control is always
  visible on the edge drawer.
- `ui/dropdown-menu.tsx` — new primitive for table row action menus.

### Dependencies

Added `@radix-ui/react-dropdown-menu` — same family as the nine Radix packages
already in use, and the alternative was hand-rolling an accessible menu for
every table row.

### Testing performed

Automated with Puppeteer against the **production build** (`next start`).

- **Layout audit** — 18 routes × 3 widths (1440, 820, 360): horizontal
  overflow, elements escaping the viewport, text below 11px, missing
  `#main-content`. Result: **0 problems, no console output**.
- **Admin flows — 84 assertions, all passing**: sticky header; table scrolls
  internally without the page scrolling; search by name / member ID / wallet
  address; status filter chips; row → detail navigation; tab switching; device
  logout with a required reason, and the reason appearing in the audit trail;
  KYC review → approve; deposit credit with an under-confirmation warning;
  withdrawal approve with the payout breakdown shown first; plan create
  including validation that rejects a headline projection outside its range;
  agent create with the 13-row permission matrix; **permission gating** (nav
  items disappear, forbidden actions disable) via the operator switcher; audit
  log category filters; settings dirty/save cycle writing an audit entry;
  notification send; admin 404 not rendering the user app's navigation; mobile
  drawer and card-list rendering.
- **User app regression — 22 assertions, all passing**: the route-group move
  changed no behaviour (bottom nav, `aria-current`, KYC gating, 404 with shell,
  desktop sidebar).
- **Visual review** — screenshots of 7 admin screens at 1440px and 390px.

### Issues found during testing and fixed

1. **Document scrolled sideways on wide tables.** The table was correctly
   clipped, but the `sr-only` caption and action-column headers are
   `position: absolute`; with no positioned ancestor their containing block was
   the viewport, so they sat at the table's x-offset and made the whole page
   scrollable. Fixed with `relative` on the scroll container. (An
   `overflow-x-clip` attempt was tried first, measured, found to be a no-op for
   this cause, and removed rather than left in with a wrong comment.)
2. **Dashboard overflowed at 360px** — chart frames and panels needed `min-w-0`
   as grid children; the 12-point axis label rows needed shrinkable labels and
   tighter gaps below `sm`; stat-card figures needed compact notation above 10k
   and a smaller mobile size.
3. **Confirmation dialogs discarded the operator's reason.** Every dialog says
   "This is recorded in the audit log" and several require a reason, but ~14
   actions dropped it. Threaded through the store and into the audit detail.
4. **Unknown `/admin/*` URLs rendered the user app's 404** with its bottom
   navigation. Fixed with the admin catch-all route.
5. **Stale-server false negatives** — a `next start` left running across a
   rebuild served deleted chunks, producing `ChunkLoadError` and a cascade of
   spurious failures. Same trap as the previous session; noted again because
   the first two runs' results were invalid.
6. Table cell polish: VIP labels and INR sub-figures no longer wrap mid-value.

### Build result

```
✓ Compiled successfully
✓ Generating static pages (72/72)
```

- `npx tsc --noEmit` — clean
- `npx eslint .` — clean
- First Load JS shared by all: **102 kB**; largest admin route 217 kB
  (`/admin/users/[id]`, which carries all ten tab panels).

### Known limitations

- Admin state is in-memory: **a full page reload resets** it and restores the
  master-admin session. Permission gating and the session switcher must be
  exercised via in-app navigation.
- The permission model is not enforced anywhere but the UI. All data is in the
  client bundle.
- Editing settings in the CRM does not move the user application, which still
  reads `@/constants/app`. Joining them needs a real configuration service.
- KYC documents are references only; there is no document storage or preview.
- Dashboard aggregates describe a ~2,800-account platform while the tables show
  a ~30-record sample. This is deliberate — a real deployment computes those
  server-side rather than by summing a page of rows — but the two will not
  reconcile.
- Notification audience sizes are static estimates.

---

## 2026-08-09 — Initial frontend implementation

Built the complete frontend of the Nanotron mobile-first crypto investment
platform in a single pass, starting from an empty directory.

### Project setup

- Scaffolded with `create-next-app` (TypeScript, Tailwind, ESLint, App Router,
  `src/`, `@/*` alias).
- The scaffold installed Next.js 16; **pinned down to Next.js 15.5.23** with
  `eslint-config-next@15.5.23` to match the specified stack. React 19.2.8.
- Rewrote `eslint.config.mjs`: the Next 16 scaffold emitted a flat config
  importing `eslint-config-next/core-web-vitals` directly, which does not
  resolve under v15. Replaced with the `FlatCompat` bridge and added
  `@eslint/eslintrc` as an explicit devDependency.
- Added `components.json` so the shadcn CLI recognises the project. The `ui/`
  primitives were written directly into `src/components/ui/` (the shadcn CLI in
  this environment is interactive-only); they follow standard shadcn source.

### Design system

- `src/app/globals.css`: Tailwind v4 CSS-first theme. Light + dark token sets
  (charcoal type, neutral surfaces, muted-teal `--brand` accent, semantic
  positive/negative/warning/info), radius scale, accordion keyframes.
- Utilities added: `.pb-nav` (bottom-nav + safe-area reservation), `.pt-safe`,
  `.pb-safe`, `.no-scrollbar`, `.edge-scroll`, `.tabular`, plus a
  `prefers-reduced-motion` block.
- Root layout: Geist Sans/Mono via `next/font`, metadata template, viewport with
  `viewportFit: "cover"`, theme-color per scheme, skip-to-content link.

### Architecture

- **Currency single source of truth** — `src/constants/app.ts` (mock rates),
  `src/lib/currency.ts` (conversion + all formatting), and the `CurrencyDisplay`
  component. No component performs its own conversion. Display rate
  1 USDT = ₹83.20; a separate quoted payout rate of ₹82.90 is used for INR
  withdrawals. INR is formatted with the `en-IN` locale.
- **Prototype store** — `src/lib/prototype-store.tsx`, a context + reducer over
  the mutable account state (KYC status, balances, investments, transactions,
  notification prefs, security toggles), seeded from `@/data`. In-memory only;
  resets on full reload. Each action maps 1:1 to a future API call.
- **Server/client split** — pages and static catalogue content are Server
  Components; only containers that read the store and components with local UI
  state are client. Presentational components carry no `"use client"` so they
  work on both sides.
- **Data layer** — `src/data/` (user, plans, investments, transactions,
  referrals, notifications, support), shaped like future API payloads.
- **Types** — `src/types/index.ts` defines the domain contract.
- QR codes are generated **server-side** (`src/lib/qr.ts`, `server-only`), so the
  `qrcode` library never reaches the client bundle.

### Pages created (19 routes)

| Route | Contents |
|---|---|
| `/` | KYC banner, hero balance, 4 stat tiles, add-funds card, active investments, earnings chart, recent activity |
| `/plans` | Risk-filterable plan list |
| `/plans/[slug]` | Overview, projection, key details, how it works, conditions, risk, sticky invest action (SSG, 5 plans) |
| `/wallet` | Balances, add funds / withdraw, earnings breakdown, recent transactions |
| `/wallet/deposit` | USDT deposit: network selection → address + QR → detected → confirming → credited |
| `/wallet/withdraw` | INR withdrawal: amount → quote (rate + fees) → confirm → receipt |
| `/wallet/transactions` | Full history with type filters |
| `/referral` | Summary, invite link (copy/share/QR), how it works, VIP 1–3, referrals + commission tabs |
| `/settings` | Profile header, verification, security, wallet, investments, preferences, support, legal, logout |
| `/settings/kyc` | 4-step verification flow with review and approved states |
| `/settings/profile` | Editable profile with locked fields |
| `/settings/security` | Password change, 2FA + authenticator toggles, security activity |
| `/settings/wallet` | Saved addresses, bank accounts, default network, withdrawal security |
| `/settings/investments` | Active, history, reward history |
| `/settings/investments/[id]` | Single investment detail (resolved client-side) |
| `/settings/notifications` | Recent notifications + per-category preferences |
| `/settings/language` | Language selection (English only) |
| `/settings/support` | Help topics, FAQ accordion, tickets, contact sheet |
| `/settings/legal/[document]` | Terms, Privacy, Risk Disclosure (SSG, 3 documents) |

Plus `not-found.tsx` and `error.tsx`.

### Components created

- `ui/` — button, card, badge, input/textarea, label, sheet (bottom sheet on
  mobile, centred modal from `sm`), tabs, progress, separator, switch,
  accordion, avatar, skeleton, sonner toaster.
- `navigation/` — `AppShell`, `PageContainer`, `BottomNavigation` (5 tabs,
  fixed, safe-area aware), `DesktopSidebar` (`lg`+), `TopBar`.
- `shared/` — `CurrencyDisplay`, `StatTile`, `InfoRow`, `SectionHeader`,
  `StatusBadge`, `EmptyState`, `TransactionItem`/`TransactionList`, `ListRow`/
  `ListGroup`, `CopyField`/`CopyButton`, `QrCode`, `EarningsChart`,
  `PageHeader`, `RateNote`/`RiskNote`/`PrototypeNote`.
- Section components under `home/`, `plans/`, `wallet/`, `referral/`,
  `settings/`.

### Charts

`EarningsChart` is a single-series magnitude-over-time bar chart: one hue, no
legend (the heading names the series), 4px rounded data-ends anchored to the
baseline, recessive axis labels. Instead of a floating tooltip — awkward inside
a 360px viewport — each bar is a button that promotes its value into the readout
above, making it touch- and keyboard-accessible. A screen-reader data table
accompanies it so values are never conveyed by bar height alone.

### Dependencies

Added: `@radix-ui/react-{accordion,avatar,dialog,label,progress,separator,slot,switch,tabs}`,
`class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`, `sonner`,
`tw-animate-css`, `qrcode`, `server-only`.
Dev: `@types/qrcode`, `@eslint/eslintrc`.

Changed: `next` and `eslint-config-next` pinned from 16.3.0 → 15.5.23.

Removed: `motion` — installed initially but never used; CSS transitions and
`tw-animate-css` covered every animation, so it was dropped rather than shipped
as a dead dependency.

### Testing performed

Automated with Puppeteer against the **production build** (`next start`).

- **Route crawl** — all 22 routes return 200; an unknown route returns 404.
- **Layout audit** — 20 routes × 5 widths (360, 375, 390, 412, 430), checking
  horizontal overflow, elements escaping the viewport, text below 11px, and
  bottom-nav overlap at full scroll. Result: **no problems, no console
  output**.
- **Flow tests** — 51 assertions, **51 passed, no console errors**:
  - bottom navigation to all five sections, with `aria-current` set
  - invest blocked before KYC → verification-required state
  - full KYC flow: details → document → liveness → submitted → approved
  - Home KYC banner clears once verified
  - deposit: network select → address + QR → detected → confirming → credited,
    and the balance increases by the credited amount (1,250 → 1,500)
  - withdrawal: minimum enforced and CTA disabled below it, INR payout and rate
    quoted, review → confirm → receipt, entry appears in history as Processing
  - transaction filters (Rewards / Deposits / Withdrawals) return only matching
    rows
  - plan risk filter
  - invest: minimum enforced, review, confirm, investment appears in history
  - earnings chart bar selection and week/month tab switch
  - referral QR sheet and commission tab
  - security switch toggles
  - desktop 1440px: sidebar visible, bottom nav hidden, no horizontal overflow
- **Visual review** — screenshots at 390px (10 screens), 360px, and 1440px.

### Issues found during testing and fixed

1. **Broken ESLint config** — the Next 16 scaffold's flat config could not
   resolve `eslint-config-next/core-web-vitals` under v15, failing the build's
   lint step. Rewrote using `FlatCompat`.
2. **10px text** on the deposit "Recommended" badge — raised to 11px, the
   project minimum.
3. **Global `scroll-behavior: smooth`** on `html` was animating programmatic
   scrolls and route changes, leaving content mid-animation and making
   near-viewport-edge controls unreliable. Removed; in-page anchors opt in
   individually.
4. **Truncated stat-tile labels at 360px** ("Active Investme…") — labels now
   wrap instead of truncating.
5. **Stale-server false negative** — a `next start` process left running across
   a rebuild served deleted assets (CSS 400), producing an unstyled page and a
   spurious desktop-nav failure. Rebuilt cleanly and re-ran both suites; noted
   here because the first run's results were invalid.

### Build result

```
✓ Compiled successfully
✓ Linting and checking validity of types
✓ Generating static pages (28/28)
```

- `npx tsc --noEmit` — clean
- `npx eslint .` — clean
- First Load JS shared by all: **103 kB**; largest route 154 kB.
- 26 of 28 pages prerendered as static; `/settings/investments/[id]` is dynamic
  by design (session-created allocations resolve client-side).

### Known limitations

- Prototype state is in-memory: a **full page reload resets** balances,
  investments and KYC status to the seed data. Flows must be exercised via
  in-app navigation. Settings → "Reset demo data" restores the seed explicitly.
- Deposit confirmation and KYC approval are advanced by clearly-labelled
  "Demo control" buttons; there is no chain watcher or verification provider.
- A toast is a transient overlay: while one is visible (~3.2s) it covers the
  top of the scrollable content and intercepts taps there. Standard
  banner behaviour, but worth knowing.
- The earnings figures, VIP thresholds, commission percentages and plan returns
  are illustrative sample values.
- Legal copy is placeholder text and must be replaced with reviewed documents
  before any real launch.
- `npm audit` reports 3 high-severity advisories in transitive dependencies of
  Next.js 15 (`postcss`, `sharp`). They resolve only by upgrading to Next 16,
  which conflicts with the specified stack. Build-time/tooling scope, not
  runtime application code.
- Only English is implemented; other locales are listed as placeholders.

### Remaining future work

See `CLAUDE.md` §13 for the integration sequence: authentication, backend and
database, KYC provider, deposit service and chain watcher, withdrawal/payout
rails, live rates API, investment engine, referral payouts, localisation.
