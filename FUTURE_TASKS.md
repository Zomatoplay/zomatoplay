# Nanotron — future tasks

The real current roadmap. Rewritten after a full repository audit on
**2026-09-13**, against the code rather than against the previous version of
this file.

Companions: `CLAUDE.md` (durable architecture and rules), `CHANGELOG.md` (what
actually happened), `API_DOCUMENTATION.md` (the server interface).

A note on honesty, because it governs how this file should be read: items are
here because they are *known*, not because they are hypothetical. Where a claim
is measured, the measurement is quoted and dated. Where something is suspected
but unproven, it says so. Where an item from an earlier pass turned out to be
already done, it is moved to "Resolved" rather than quietly deleted — the
history of what was wrong is worth keeping.

**Verified state on 2026-09-13 (second pass):** `npm run typecheck`,
`npm run lint` and `npm run build` clean; test totals in the session report.
Shared first-load JS 102 kB; heaviest route 216 kB. Four items from the morning
audit — H7, H8, C3a and M11 — were implemented and measured the same day; see
"Resolved" below.

**2026-09-14:** plan rate tiers, the new-deposit confirmation, admin
deposit-address management and automatic referral commission release landed.
Migration `0012` (four column groups + `plan_rate_tiers`) and `0013` (one enum
value). Two product decisions came out of that work and are recorded at the end
of this file; neither blocks anything.

**2026-09-15:** production hardening — connection-fault classification and
retry, KYC without documents, the deposit-address lifecycle. Migrations
`0014`–`0016`.

**2026-09-16 — performance and scale pass.** H9, M12 and M10 resolved; M1 and
M2 substantially resolved on the user side and the dashboard; migration `0017`
(one composite index). A new section, "Scale ceiling", works through the
connection-budget arithmetic.

> The 2026-09-16 pass had **no network access to the database**, so nothing in
> it was measured or migrated. Everything it left unverified was verified on
> **2026-09-17**; see immediately below.

**2026-09-17 — verification, an index defect, and CRM server-side pagination.**
The database was reachable. Migration `0017` turned out **not to have been
applied**, and once applied the index it adds was **never used** — it was built
`DESC NULLS LAST` while the query orders by a bare `DESC`, which is NULLS
FIRST, and Postgres matches an ordering by null placement as well as direction.
Migration `0018` rebuilds it to match. Measured on a 202k-row fixture with one
account holding 2,000 rows: 3.9-6.3 ms scanning the timestamp index and
discarding 5,135 rows, against 1.2 ms scanning the composite one with no filter
and no sort.

The seven CRM list screens in M1 were converted to real server-side pagination,
search, filtering and sorting — ten rows per page, the predicates in SQL, the
state in the URL. M1 is now resolved.

---

# P0 — must fix before real users

## C3 — Withdrawals move no money

**State:** unchanged. `withdrawals-write.service.ts` writes records.
`requestWithdrawal` genuinely holds the balance (ledger debit, returned on
reject), and KYC / restriction / balance / destination are all checked
server-side. `approved`, `processing` and `paid` record operator decisions;
`payoutReference` is whatever the operator types.

**Risk if ignored:** an operator marks a withdrawal paid and nothing paid.
There is no reconciliation that would ever notice.

**Complexity:** high — provider selection, KYC/AML obligations, webhooks,
reconciliation, reversal. **Dependencies:** a business decision on the payout
provider (see DECISION REQUIRED at the end).

## C4 — Operator session revocation cannot revoke anything

**State:** unchanged and deliberate. The CRM marks a device session revoked and
says plainly that the Supabase refresh token behind it is not invalidated —
that needs the service-role key this project deliberately does not hold
(`CLAUDE.md` §19.6, §20.3).

**Do not "fix" this by adding the service-role key.** The options are a narrow
server-side admin surface holding that key in an isolated environment, or
shortening token lifetime so revocation converges. Both are real decisions.

## C5 — Supabase Auth outage handling *(mostly resolved — verify)*

`getAuthPrincipal()` distinguishes "not signed in" from "provider unreachable"
and `(app)/layout.tsx` renders a recoverable notice. There is a test.

**What is still open, and it is now measured:** `auth.resolveAccount` recorded
**76 failures** in `pipeline_events`, 73 of them for a single `auth_user_id`,
all of the shape `Failed query: select … from "users" where "auth_user_id" = $1`.
That is the *database* read failing after the principal resolved, not Supabase.
Four `render.failed` rows carry `Database query exceeded 15000ms`. So the
outage path exists; what is unproven is that it covers this case cleanly rather
than surfacing a raw driver error.

**Next step:** reproduce with the database unreachable and confirm the user sees
the recoverable notice, not a 500.

---

# P1 — high

## H9 — RESOLVED 2026-09-16: `pipeline_events` retention

**Was:** 28,464 rows / 10 MB — larger than every business table combined
(`users` 256 kB, `transactions` 248 kB, `audit_logs` 192 kB) — from one
developer and a handful of test runs, with nothing pruning it. It grew again
when error recording began keeping whole cause chains.

**Now:** `prunePipelineEvents()`
(`server/services/diagnostics-retention.service.ts`) deletes rows past
`PIPELINE_EVENT_RETENTION_DAYS` (default 30) in bounded batches, with a per-run
ceiling so a first prune of a never-pruned table cannot run unbounded on a
serverless platform. `more: true` in the result distinguishes "caught up" from
"still behind" — without it the two look identical.

It runs from `/api/cron/release-deposit-addresses` rather than a fifth cron
job: that route is the one scheduled job that moves no money, touches no ledger
and makes no chain call, and the plan already caps the number of jobs (H4). The
prune runs *after* the sweep and can never fail it.

**`audit_logs` is untouched and must stay so** — it is evidence, kept; the
schema and §22 both say so, and there is no code path from the retention
service to it. Four tests pin the stop conditions without needing a database.

## H4 — Scheduled jobs run once a day

`vercel.json` schedules `/api/cron/scan-deposits` at 03:00 and
`/api/cron/settle-investments` at 04:00 — the Hobby-plan limit.

**Consequences, plainly:** a deposit that arrives while nobody has the deposit
page open waits up to **24 hours** to be credited. An earning period that
becomes due at 04:01 is credited ~24 hours late. Neither loses money — both
engines are catch-up correct and idempotent — but both are visible to a
customer as the platform being broken.

**Fix:** a paid plan (`*/5 * * * *` for the scanner, hourly for settlement), or
drive the same two URLs from any external scheduler. Nothing about either route
is Vercel-specific; both are `CRON_SECRET`-authorised.

## H10 — No rate limiting anywhere in the application

**NEW, 2026-09-13.** Verified by search: no throttle on sign-in, sign-up,
withdrawal requests, KYC submission, or `checkForDepositsAction`. The only
limiter in the codebase is the in-process single-flight floor in
`scan-trigger.ts`, which is global-per-instance, not per-user.

Supabase applies its own limits to auth endpoints, which covers the worst case
today. What is unprotected is everything behind a valid session: one
authenticated account can drive `checkForDepositsAction` as fast as it likes,
and each call costs TronGrid quota and connections out of a five-connection
pool.

**Fix:** a per-user floor stored alongside the session, or a small
`rate_limits` table. **Complexity:** medium. Do it with or shortly after H7.

**Assessed 2026-09-16 and deliberately not implemented in this pass.** Not
because it is unimportant, but because every honest implementation needs
storage and this session had **no network access to the database**, so nothing
touching a new table could be tested. The three candidate shapes, so the next
pass does not re-derive them:

1. **A `rate_limits` table** keyed on `(user_id, action)` with a window — exact
   and durable, and it costs a round trip on the very paths being protected.
2. **In-process, per-instance** like `scan-trigger.ts`'s single-flight floor —
   free, and worth almost nothing on a platform that answers load by adding
   instances, since the limit multiplies by the instance count.
3. **Postgres advisory locks / a token bucket in an unlogged table** — cheaper
   than (1), still a round trip.

The highest-value target is unchanged: `checkForDepositsAction`, which any
authenticated account can drive and which spends TronGrid quota and connections
out of a five-connection pool. Note its server-side floor already bounds *chain
scans* globally per instance — what is unbounded is the cheap database read.
Supabase's own limits still cover the auth endpoints.

**Re-assessed 2026-09-17, with a database available, and still not
implemented — for a better reason than last time.** The blocker is no longer
testability, it is the connection budget, which was measured this session (see
"Scale ceiling"). Shape (1) adds a **write** to the hot path of exactly the
requests being protected, against a project-wide ceiling of 15 session-mode
connections; a limiter that consumes the scarcest resource on the deployment in
order to protect it is close to self-defeating. Shape (2) is free and multiplies
by the instance count, so it bounds nothing that matters. Shape (3) is cheaper
but still a round trip.

The honest conclusion is that rate limiting here wants the driver migration
(option 2 under "Scale ceiling") or an out-of-band store, and should be
sequenced **after** one of those rather than bolted on before. Until then the
exposure is bounded by what `checkForDepositsAction` actually costs: one
throttled chain scan per instance per 4 s, plus one database read per call.
That is a real cost and a small one. **Trigger:** the driver migration, or the
first sign of a single account driving TronGrid quota.


## H1 — Wrong-asset transfers are invisible

Unchanged. Every TRC-20 deposit address is also a valid TRX address, and a
wallet will happily send TRX to it. Those transfers succeed on-chain and are
invisible to a TRC-20 transfer query. The deposit screen warns prominently;
nothing detects or surfaces them.

**Now materially more serious than when first written,** because the address is
on mainnet and the funds are real.

**Fix:** query the native-transfer endpoint for pool addresses on the same pass
and record what arrives as an `ignored`/`wrong_asset` deposit an operator can
see. **Complexity:** medium.

**Assessed 2026-09-16 and deliberately not implemented in this pass.** It
touches `scanner.ts` and `recordObservedDeposit` — the money-critical path that
has processed real mainnet funds — and this session had no database and no
TronGrid reachability, so nothing written could have been tested against either.
Changing the deposit scanner blind is the one thing this codebase should not do.

The shape is still the one described above: query the native-transfer endpoint
for pool addresses on the same pass and record what arrives as an `ignored`
deposit with a `wrong_asset` reason, so an operator can see it. Two constraints
for whoever picks it up: it must **not** widen what counts as creditable (a TRX
transfer is visible, never credited), and it must not add a second pass over
the addresses — the existing pass already has the address list in hand.

**Re-assessed 2026-09-17. Still not implemented, and the reason has narrowed.**
The database is reachable now, so the storage half could be tested. The half
that still cannot be is the one that matters: verifying this needs a *real
wrong-asset transfer* to a pool address on the network being scanned, and the
only ways to produce one are to send TRX on mainnet — real money, deliberately
misdirected — or to move the deployment to a testnet and back. Neither is a
change to make in passing, and a scanner change validated only against fixtures
is a scanner change validated against the author's own assumptions.

What would make this safe to pick up: a testnet pool address, a small TRX
transfer to it, and `tron:inspect` extended to show native transfers before any
code writes a row. That sequence is cheap and it is the right first step —
**do the read-only half first**, confirm the endpoint returns what is expected,
and only then let anything write a `deposits` row.


## H6 — Operator provisioning has no credential step

Unchanged. Creating an operator in the CRM writes an `invited` row with no
credential; linking a Supabase account still needs `npm run db:dev-accounts`.

---

# P2 — important

## M10 — RESOLVED 2026-09-16: member ids no longer collide

**Was:** a query on every signup whose result was discarded (`void row`), then
`NT-${Date.now().toString().slice(-7)}` — the last seven digits of a
millisecond clock, against a **unique index**. That value repeats every
10,000,000 ms, so two signups in the same millisecond *or exactly 2 h 46 m
apart* failed the whole registration with an opaque constraint error. A
scheduled failure window, not bad luck.

**Now:** the same one round trip generates five cryptographically random
candidates and asks which are already taken, returning a free one — so the
query that was wasted is the query that does the work. Random rather than a
sequence, deliberately: a sequential member id would publish signup order and
total user count to anybody who registers twice. If every candidate collides it
widens rather than failing a registration, and the unique index remains the
real guarantee. A test asserts uniqueness and shape across the live table.

## M1 — RESOLVED 2026-09-17: unbounded list reads

**Done 2026-09-16 — the reads that ran on every navigation:**

- **`listTransactionsForUser()` now takes a limit, and the default is bounded.**
  Home renders 5 entries and Wallet 6; both read an account's *entire* ledger to
  do it, on every navigation. Default is now `RECENT_TRANSACTIONS` (50);
  `/wallet/transactions` raises it to 250 **and says so on screen** when the
  result hits the ceiling, rather than letting the list end and read as "that
  is everything". A limit a reader is not told about is a lie, not an
  optimisation.
- **A composite index for that query.** `transactions_user_recent_idx` on
  `(user_id, occurred_at desc)` — migration `0017`. The existing
  `transactions_user_idx` found the account's rows and Postgres then **sorted
  every one of them** to take the top N; the sort grew with an account's
  history on the hottest query in the product. Added *with* the limits, because
  the limit is what turns it from "avoid a sort" into "read N rows and stop".
- **`TopBar` stopped reading the notification list.** It rendered an unread
  badge on Home, Wallet, Referral, Plans and Settings, and derived the number
  by fetching **every notification the account had ever received** and calling
  `.filter(n => !n.read).length`. That is a `count(*)` written as a full table
  read. It is now `countUnreadNotifications()`, served by the
  `notifications_unread_idx` on `(user_id, read)` that already existed and that
  nothing was using for this. Five pages stopped requesting the slice entirely;
  only `/settings/notifications` renders the list, and it is capped at 100.
- **The CRM dashboard stopped reading the platform.** See below.

**`investments` is deliberately NOT limited**, and this is the interesting one:
every other list here is "the most recent N", which is a safe truncation
because what falls off the end is history. An allocation is not — a fixed-term
investment opened a year ago can still be `active`, and ordering by
`started_at` and taking the most recent N would silently drop it from Home's
"your investments" and from the totals beside it. If it ever needs bounding it
must be by **status**, not by recency.

**RESOLVED 2026-09-17 — the CRM list screens.** `/admin/users`,
`/admin/deposits`, `/admin/withdrawals`, `/admin/investments`, `/admin/kyc` and
`/admin/referrals` each read their whole table (`select *`, joined, no `LIMIT`)
and paginated and filtered in the browser. All six now page in Postgres, ten
rows at a time, with search, status filtering and sorting as SQL predicates.

How it is built, because the shape is reusable:

- **The URL is the state.** A server component reads its inputs from the URL and
  nowhere else, so filters had to leave `useState`. `@/lib/admin-list-query`
  parses and builds it, and the same module is used by the server (to validate)
  and the client (to construct links) — so a token an operator can click is by
  construction one the query accepts. Three things come free: an operator can
  send a colleague a link to the exact queue they are looking at, Back works,
  and a refresh keeps the view.
- **Untrusted input is treated as such.** `page` is clamped positive; `status`
  and `sort` are matched against a per-screen allowlist so neither reaches SQL
  as text; `pageSize` is **not readable from the URL at all**, because a
  caller-chosen page size is an unbounded read wearing a parameter. Search is
  capped at 100 characters and its LIKE wildcards are escaped — without that,
  searching `%` returns the whole table. There is a live check for that.
- **One statement per page, not two.** The row count the pager needs rides
  along as `count(*) over()` on the same filtered scan.
- **A page past the end returns page 1**, rather than an empty screen implying
  the queue is clear.
- **The stat cards became SQL aggregates.** The figures above these tables
  described the whole table, computed by reducing over every row in the
  browser. Left alone they would have silently become "of the ten rows on
  screen" — not a smaller number, a false one.
- **Chip counts are a second, parallel query**, because they must ignore the
  status filter while the page applies it. Issued in the same `Promise.all`, so
  the screen costs one round trip of wall time: measured 608 ms parallel
  against 820 ms sequential.
- **`/admin/referrals` carries two independent lists**, so each owns a URL
  prefix (`a`, `c`) and the query builder passes the sibling's parameters
  through untouched.
- **The deposit-assignment picker no longer needs the directory.** It took the
  whole `users` array as a prop and filtered it in the browser to show eight
  matches; it now calls a permission-gated server action that returns at most
  eight narrow rows, and only from two characters.

**Measured 2026-09-17, and the honest part:** at today's volume this is **not a
speed-up**. `listAdminUsers()` over 44 accounts has a median of 387 ms; the
paged read is 416 ms — the window function and `OFFSET` cost slightly more than
reading 44 rows. What changes is that the cost stops growing: the serialised
payload per screen fell 4.5x (users 29.3 kB → 6.5 kB, investments 15.0 → 4.5,
deposits 21.7 → 7.5) and is now flat in table size rather than linear. This was
a scalability change, and reporting it as a latency win would be wrong.

Two defects surfaced while doing it, both fixed and both older than this pass:

- **`/admin/users/[id]` showed "This user is no longer available" for every
  account.** The page rendered `UserDetailView` without an `AdminDataProvider`,
  so the store's `users` was empty and the lookup missed — all ten tabs. The
  title was right the whole time, because `generateMetadata` did its own read.
  Now provides its slice, from a single-row `where id = $1` rather than a scan
  of the directory.
- **Three screens were reading the whole user directory** for a type-ahead
  (deposits), one resolved name (notifications) and one row (user detail).
  Each has its own bounded read now, and `getAdminUsers()` was deleted rather
  than left exported.
- **`?page=99999999999999999999` rendered the error page**, by overflowing
  `OFFSET`'s `bigint`. `page` is clamped as an overflow guard.

**Still open, and deliberately.** Not every list needed this:

| Screen | Read | Why it is left alone |
|---|---|---|
| `/admin/audit-logs` | capped at 500 | bounded, but an operator cannot reach row 501 |
| `/admin/system-logs` | capped at 200 | same, over the fastest-growing table on the platform |
| `/admin/notifications` | every campaign | grows only when somebody sends one |
| `/admin/agents` | every operator | bounded by the size of the staff |
| `/admin/deposits/addresses` | the whole pool | bounded by configuration (§18.8) |

The two capped ones are the only real gap: a cap is not pagination, and
"there is more history than this and you cannot see it" is a thing the screen
does not say. Same treatment when it is due.

**Search is unindexed.** Every screen's search is `ILIKE '%needle%'`, which no
btree can serve — it is a sequential scan of the filtered set. Invisible at
these volumes and the first thing to bite at scale; the fix is a `pg_trgm`
GIN index per searched column, which means enabling the extension. Not done
because nothing here justifies it yet. **Trigger:** ~50k rows in `users`, or a
search that takes more than a second.

## M2 — CRM dashboard *(queue counts done; headline totals and charts remain fixtures)*

**Done 2026-09-16.** The six "needs attention" figures — KYC awaiting review,
deposits not yet credited (and their USDT), withdrawals in progress (and
theirs), and blocked/suspended accounts — are now counted in SQL by
`readDashboardMetrics()`: one statement of scalar subqueries, one round trip,
six numbers, every count served by an index that already existed.

They used to be derived in the browser with `filter`/`reduce` over four
unbounded reads the page had fetched for the purpose — every user joined to
every wallet, every deposit, every withdrawal, and every KYC case. The KYC one
was three unbounded queries by itself, because attaching documents and notes
read **every document and every note on the platform**. All four were
serialised whole into the RSC payload so the client could count them.

The six recent-activity panels now read `LIMIT 5` (6 for the security
timeline) instead of sorting and slicing a whole table.

**This also fixed a live bug.** `RecentInvestments` and `RecentSecurityEvents`
were rendered on the dashboard but the page never provided their slices, and
the admin store falls back to `[]` for anything a page does not supply — so
both panels showed "nothing recent" regardless of what had happened, silently,
because an empty list is indistinguishable from an empty platform. Both slices
are now fetched.

**Still fixtures:** the platform-wide totals and the four chart series, from
`@/data/admin/metrics`. The `PrototypeNote` at the top of the screen says so.
Replacing them needs a reporting service with real aggregates over date
ranges — a different shape of query from the six counts above, and not one to
fake by summing a page of rows. **Complexity:** medium.

## M3 — Test suite cannot exercise server actions

Unchanged. Services and repositories are covered; the `"use server"` layer —
where authorization lives — is only covered indirectly. `deposit-check.test.ts`
is the sole exception and shows the shape is possible.

## M4 — No end-to-end browser tests

Unchanged. Nothing exercises sign-in → deposit → allocate → settle in a browser.

## M12 — RESOLVED 2026-09-16: bound parameters are redacted

`redact()` now drops the `params:` tail of a driver error, so
`pipeline_events` no longer stores rows reading `params: b0271b3e-…,1` — a
real `auth_user_id`. The **statement is kept**: which query failed is the whole
diagnostic value, and it is schema rather than data.

More urgent than when first written, because error recording began walking the
whole cause chain in September — and the driver error is exactly the level that
quotes its parameters. Regression test in `server/errors.test.ts`.

---

# P3 — improvements

- **L6 — `getPublicDepositTarget()` is orphaned.** Nothing imports it; the only
  reference is a now-incorrect comment in `api/cron/scan-deposits/route.ts:37`
  claiming `/wallet/deposit` reads it. Either delete it or wire it; do not
  leave a projection that looks live and is not.
- **L7 — stale claim in `auth/account.ts`.** The comment beside the referral
  insert says "No money moves. Commission calculation is not implemented; see
  FUTURE_TASKS.md." Commission accrual has been implemented since 2026-09-06.
- **L8 — the four-network `depositNetworks` placeholder catalogue** still ships
  with fake addresses and is read by `/settings/wallet`. It is a withdrawal
  *destination* catalogue there, not a deposit one; the naming misleads.
- **L2 — two words for one investment state** (`matured` / "completed").
  Deliberate; documented; leave it.
- **L5 — `next.config.ts` is empty.** Fine today. Worth revisiting only if
  image domains or headers are needed.
- **L9 — dependency drift.** All minor: `@supabase/ssr` 0.12.4→0.12.7,
  `lucide-react` 1.30→1.45, `sonner`, `tailwind-merge`, `tsx`. Next 15.5.23 and
  React 19.2.8 are current-major. No security-driven upgrade is outstanding.
  Do not chase Next 16 / ESLint 10 / TypeScript 7 during feature work.

---

# P4 — future / nice to have

- Multi-address deposit pool at real scale, and the xpub-derivation decision
  behind it (`CLAUDE.md` §18.8). The mechanism is built and proven; what is
  missing is addresses.
- Sweeping pool addresses to a treasury address — needs a signing key this
  application must never hold.
- Localisation (`/settings/language` lists the intended locales).
- Fixed-term early exit (Starter: after day 7 with forfeiture; Balanced: after
  day 30 with a 2% fee). Both are sold terms; neither is implemented. Refusing
  is currently correct.
- Phone/SMS one-time codes; username sign-in.

---

# Resolved — do not re-open

- **Plan detail pages crashed** *(2026-09-13)*. `/plans/[slug]` declared
  `getUserSlices(["balance"])` while `InvestSheet` also read `profile` via
  `isVerified`. Fixed by correcting the declaration, not by defaulting the
  slice. Verified: all 19 user routes render clean with a real session, and
  `/plans/starter` shows the invest CTA.
- **H7 — the deposit screen's cadence** *(2026-09-13)*. Split into a cheap 5 s
  database read and a 60 s chain-scan request; server floor 4 s → 15 s. Two
  tests pin the interval relationship. Rationale: TRON solidification is ~57 s,
  so a faster chain poll cannot produce an earlier answer.
- **H8 — read-first deposit-address lookup** *(2026-09-13)*. **Measured
  1,118 ms → 316 ms median (72%)**, matching the 1,087 ms p50 previously
  recorded in `pipeline_events`.
- **C3a — the withdrawal quote's floating-point arithmetic** *(2026-09-13)*.
  Now exact via new `add`, `subtract` and `multiplyByRate` in `@/db/money`.
  `Math.max(net, 0)` removed: a fee exceeding the amount is a refusal, not a
  zero.
- **M11 — the intermittent `money-lifecycle` fixture** *(2026-09-13)*. Plan
  selection is now explicitly ordered, with a guard assertion in `before()`.

Kept because knowing what was wrong is worth as much as knowing what is right.

- **C1 — referral commission accrual** *(2026-09-06)*. Accrues on allocation,
  two tiers, at the beneficiary's historical VIP rate, inside the allocation's
  own transaction. Release remains an operator action **by design**; see C1a.
- **C2 — investment earnings engine** *(2026-09-06)*. Credits due periods,
  matures at term end, keeps the display schedule current. Verified against
  scenarios A–G in this audit (see below).
- **C6 — deposit attribution for pool addresses** *(2026-09-06)*. A transfer to
  an assigned address is attributed and credited automatically, in the same
  transaction that records it.
- **TRON mainnet** *(2026-09-13)*. Previously listed here as "refused in code".
  It is enabled, configured and **has processed a real mainnet USDT TRC-20
  deposit end to end** — detected, finality-gated, credited, ledger-backed, UI
  updated without a refresh, and a repeat scan created no second credit.
- **Referral attribution** — previously listed as incomplete. It is complete:
  middleware captures `?ref=` on any route into a 30-day cookie, the signup form
  accepts a typed code that overrides it, and `resolveReferrer()` resolves it
  **once, inside the account-creation transaction**, refusing a code that names
  nobody or names the person signing up.
- **H2/H2a/H3/H-1/H0/M7/M8/M9 — the 2026-08-24 performance pass.** Retry budget,
  read deadline, `getUser()` → `getClaims()` (measured 11 ms p50 today, down
  from ~385 ms), 32 loading boundaries, root error boundaries, pool warm-up,
  catalogue caching. All verified present in this audit.
- **Request-scoped memoisation.** Measured 2026-09-13: of 311 requests,
  **309 resolved the account exactly once**. `cache()` is doing its job.

---

# C1a — RESOLVED 2026-09-14: commission release is automatic

The rule chosen is **`payoutDelayDays` after accrual, at 00:00 IST**, stamped on
the entry at accrual as `release_at`. `/api/cron/release-commissions` pays
everything due; manual release is preserved and calls the same function.

The candidate list that used to live here has moved to
"DECISION REQUIRED — what `payoutDelayDays` is measured from" at the end of this
file, because the *base* of the delay is still a business decision worth
revisiting — it is just no longer blocking anything.

# Investment engine — scenario verification (2026-09-13)

Audited against the code and the live suite, not against the changelog.

| Scenario | Result | Mechanism |
|---|---|---|
| A — settlement runs normally | ✅ | `settleInvestments()`: credit due → mature → refresh schedule |
| B — the same settlement runs twice | ✅ | unique `(investment_id, period_key)` + `onConflictDoNothing`, checked by `.returning().length` |
| C — two workers simultaneously | ✅ | same unique index; the loser writes nothing. Maturity re-asserts `status='active'` in the `UPDATE … WHERE` |
| D — worker crashes halfway | ✅ | one transaction **per period**, so completed periods commit and the next run resumes from the cursor |
| E — settlement is late | ✅ | `earningPeriodsFor()` enumerates every due period; catch-up is tested |
| F — plan rate changes mid-term | ✅ | `projected_profit` is a snapshot taken at allocation; tested |
| G — maturity | ✅ | principal returned through `matureInvestment()` → the ledger, guarded on `status='active'` |

**One gap, low severity:** `settleInvestments()` takes no global lock, so two
overlapping cron invocations both walk every active allocation. Every individual
write is guarded, so this is wasted work rather than double payment. Worth an
advisory lock when the schedule tightens (H4).

---

## Verified 2026-09-17 — the 2026-09-16 checklist, closed

Every item the previous pass left open was run against the live database.

1. **`npm test` with `DATABASE_URL` set:** 314 tests, 313 pass. The one failure
   was `member ids are unique and none was generated from the clock`, and it
   was a real defect in the test rather than in the code — see item 6.
   Re-run after the fix: clean.
2. **`npm run db:migrate`** — `0017` was **pending, not applied**. The previous
   pass generated it without a database and could not apply it. Applied, then
   `npm run db:secure` (RLS re-asserted on 36 tables, storage policies intact).
3. **The index was not used, and could never have been.** `explain (analyze)`
   showed a sort, not the index. Cause: `.desc()` on a Drizzle *index* column
   emits `DESC NULLS LAST`, while `orderBy(desc(...))` in a *query* emits a
   bare `DESC`, which SQL defines as NULLS FIRST. Postgres matches an ordering
   by null placement as well as direction, and does so literally — the column
   is `not null`, so the two orderings cannot actually differ, and the planner
   still refused the index. Migration `0018` rebuilds it as `(user_id,
   occurred_at DESC)` and `.nullsFirst()` is now in the schema with a comment
   saying why it is load-bearing. Measured on a 202k-row fixture, one account
   holding 2,000 rows: **3.9-6.3 ms** discarding 5,135 rows, against **1.2 ms**
   on the corrected index with no filter and no sort. At the production table's
   current 244 rows the planner still — correctly — prefers a sort.
4. **`readDashboardMetrics()` runs.** All six figures match an independent
   cross-check exactly: `kyc_pending 5`, `deposits_pending 5 / 2,100 USDT`,
   `withdrawals_pending 5 / 9,700 USDT`, `users_restricted 2`.
5. **The two dead dashboard panels are provided.** The page now passes
   `investments` and `securityEvents`; both tables hold rows (45 and 46).
6. **`nextDisplayId` is verified against the generator, not the table.** The
   test asserted the shape of *every* row in `users`, and 19 rows fail it — all
   19 are integration-test fixtures (`money-test-…@example.invalid`,
   `referral-test-…`, `deposit-conf-…`) that insert ids in their own shape.
   None is a real registration. That is CLAUDE.md §16.7's rule exactly: assert
   the property the test owns, not a fact about a table several other files
   write to. The table test now asserts **uniqueness** (what the index owes);
   the shape is asserted in `src/server/auth/member-id.test.ts`, which needs no
   database and checks 2,000 draws for shape, distinctness, non-monotonicity
   and digit spread.
7. **The prune is correct but has nothing to do yet.** `pipeline_events` holds
   30,684 rows and **none is older than 30 days** (oldest 2026-08-22). The
   bounds are verified directly: ten full batches stop at 20,000 with
   `more: true`; an empty first batch stops after one call. Growth is roughly
   1,180 rows/day, so retention starts removing rows around 2026-09-21 and
   should settle near 35k.
8. **Measured.** See M1 for the list-screen numbers and "Scale ceiling" below
   for the concurrency run.

### Still unverified

- **The full integration suite was not re-run after the last few changes.** The
  run that covers most of this work is 314 tests / 313 passing, with the single
  failure being the member-id test described above (fixed, and that file
  re-run clean at 26/26). Changes made after that run — the notifications
  composer, the user-detail page, the page clamp, deleting `getAdminUsers()`
  and aligning the fixture pager — are covered by typecheck, lint, build, 24
  new database-free tests and live HTTP checks, but **not** by an integration
  run. The machine lost network access before one could finish. **Re-run
  `npm test` with a database before trusting this.**
- **No browser verification.** The Chrome extension was not connected this
  session, so nothing was checked visually, at 360 px, or for console errors.
  The CRM screens were exercised over HTTP with a real operator session
  instead — pagination, filters, search, sort and the two independent
  referral tables all confirmed from the rendered HTML — but that is not the
  same as looking at them. **Do this before shipping.**
- **The user application's pages were not re-measured**, only audited. They
  were already one-wave with `SectionBoundary` and `loading.tsx`, and were not
  changed this session.
- **19 orphaned test-fixture accounts** are sitting in `users` on the
  development database. Harmless, and they are why a row-count assertion here
  is always wrong; worth a cleanup script eventually.

---

## Scale ceiling — the connection budget, measured 2026-09-17

The question "what happens at 1k / 2k / 5k / 10k users" has an answer, and it
is not about users at all.

**The binding constraint is concurrent serverless instances, not accounts.**
Supavisor session mode allows **15 client connections for the whole project**.
Each application instance holds up to `DATABASE_POOL_MAX` (5) and warms
`DATABASE_WARM_CONNECTIONS` (3) *before serving a request*. So:

| Instances | Held | Result |
|---|---|---|
| 1 | up to 5 | fine |
| 2 | up to 10 | fine; 5 spare for cron, scripts, the scanner |
| 3 | up to 15 | at the ceiling — scripts and cron start being refused |
| 4+ | — | `EMAXCONNSESSION` |

Vercel scales instances by **concurrent requests**, not by registered users. A
Node serverless instance serves roughly one request at a time, and an
authenticated page here does ~2 round trips at ~200 ms each. So the ceiling is
reached at somewhere around **3 concurrent requests**, whether the platform has
100 users or 100,000. Ten thousand mostly-idle accounts are fine; two hundred
of them clicking at the same moment are not.

**What is already true and helps:** a refused connection is now classified as
transient and retried with a pool-aware backoff (see `db/resilience.ts`), so
the failure mode is a slower request rather than a failed sign-in. That is
mitigation, not headroom.

**Do not raise `DATABASE_POOL_MAX` to fix this.** It does not create
connections; it only changes how fast one instance consumes the shared 15, and
raising it makes the third instance fail sooner. The three real options, in
order of cost:

1. **Raise the project's pool size** in the Supabase dashboard. One setting.
2. **Move off session mode by changing driver** — `node-postgres` does not
   pipeline, so the simple-query protocol that rules out the transaction pooler
   for postgres.js is harmless there (`db/env.ts` has the measurements). This
   is the real fix and it is a deliberate migration: `db.execute()` returns a
   `QueryResult` rather than a row array, so every caller changes.
3. **Fewer round trips per page**, which is what this pass and the previous one
   have been doing, and which raises the ceiling proportionally rather than
   removing it.

**Measured 2026-09-17, against a production build with a real operator
session, on one local instance (`DATABASE_POOL_MAX` 5):**

| Concurrent requests | Wall | Slowest request | Failures |
|---|---|---|---|
| 1 (cold) | 2.32 s | 2.30 s | 0 |
| 6 | 2.93 s | 2.89 s | 0 |
| 12 | 3.56 s | 3.51 s | 0 |

Two things worth keeping from that run. **Nothing failed** — not one
`EMAXCONNSESSION`, and this was with the full integration suite hammering the
same project from another process, so the real budget was tighter than five.
Requests **queue**; they do not error. And latency degrades roughly linearly
with concurrency rather than falling off a cliff, which is what a pool that is
saturated but not exhausted looks like.

**A stall was observed, and its cause is NOT established.** Running the
integration suite while a production build was also serving requests, the suite
stopped making progress — its first query, `select 1`, failed after 133 seconds,
and about fifteen minutes produced five lines of TAP output. Killing the web
server appeared to unblock it.

That was written up here as the connection ceiling being reached, and **that
claim has been withdrawn.** Shortly afterwards the machine lost network access
altogether — the pooler *and* GitHub both stopped answering at TCP connect, and
a single-connection probe failed with `CONNECT_TIMEOUT` rather than with
Supavisor's `EMAXCONNSESSION`. A general network fault explains the stall at
least as well as pool exhaustion does, and the apparent recovery after killing
the server is a correlation of one. The environment has now dropped its network
twice across two sessions.

What can honestly be said: **at the ceiling this deployment is expected to
stall rather than fail fast**, because a refused connection is retried with
backoff (2026-09-15), so exhaustion should present as a slow request and
eventually as a hung process. That is reasoning from the code, not an
observation. Distinguishing the two in future needs the error code: pool
exhaustion is `XX000` with `EMAXCONNSESSION` in the message, a network fault is
`CONNECT_TIMEOUT`. Check which one before concluding anything.

What this does **not** test is the multi-instance case, which is the one that
actually produces `EMAXCONNSESSION` — that needs several Vercel instances, not
several requests to one local server. The table above still stands as
arithmetic; the row it verifies is the first one.

---

## Known limitations (unchanged, deliberate)

- **No outbound blockchain.** No signing, no key custody, no sending. Deposits
  are read from the chain; nothing is ever written to it.
- **The service-role key is not used and must not be added.** Its absence is
  why C4 exists; that trade was made deliberately.
- **No KYC provider.** Documents are captured, uploaded to a private bucket and
  reviewed by a human. `liveness_check_passed` is always `false` and carries a
  `liveness_not_verified` flag. Do not reintroduce a path that lets a click set
  it.
- **Only masked account and document numbers are stored.**
- **Seeded fixtures are not ledger-consistent.** The invariant applies to
  accounts built by `applyLedgerEntry`, and holds for those.
- **Earnings report what settled, not what accrued.**

---

## Production readiness — re-measured 2026-09-13

| Area | Ready | Notes |
|---|---|---|
| **Authentication** | Yes | Supabase Auth, `getClaims()` (local ES256 verification, p50 **11 ms**). Outage path exists; see C5 for what is unverified. |
| **Authorization** | Yes | **31/31** admin actions begin with `requirePermission`. No user-facing action accepts a `userId` — verified by search. All six account actions resolve the session through one helper. |
| **Database** | Yes | PostgreSQL 17, session pooler. Migrations generated and checked in; RLS re-provisioned by `npm run db:secure`, with a regression test reading every table as `anon`. |
| **Financial correctness** | Yes, with C3a | `numeric` columns, `Decimal` amounts, balances moved in SQL, overdrafts refused by a `WHERE` clause, idempotency by unique index. The one exception is the withdrawal quote (C3a). |
| **Deposits** | **Yes (mainnet, proven)** | Real mainnet USDT TRC-20 deposit detected, finality-gated, credited, not double-credited. Wrong-asset blind spot remains (H1); scheduler is daily (H4). |
| **Investments** | Yes | Scenarios A–G verified above. Amount/rate tiers added 2026-09-14, with the band an allocation was sold at snapshotted onto its row. |
| **Referrals** | Yes | Attribution, accrual, scheduling and automatic release all complete (2026-09-14). Manual release preserved; both share one guarded function, so they cannot double-pay. |
| **KYC** | Yes | Full lifecycle — submit, approve, reject, resubmit, note — persisted and audited. Private bucket, four RLS policies, no UPDATE policy, 120 s signed URLs, operator permission checked twice (action and Postgres). No provider, by design. |
| **Withdrawals** | **No** | C3 and C3a. |
| **Performance** | Partial | Auth and memoisation fixed and measured. Two specific, measured regressions open: H7 and H8. |
| **Testing** | Partial | **199/199 pass.** No browser E2E (M4); server actions barely covered (M3); one order-dependent fixture (M11). |
| **Monitoring** | **No** | `pipeline_events` supports diagnosis after the fact and nothing else. No alerting, no uptime check, nothing watching `chain_scan_state.consecutive_failures` — which is the one signal that says the scanner has been dead since Tuesday. |
| **Rate limiting** | **No** | H10. |
| **Backups / recovery** | **No** | Not configured, never rehearsed. **Do not launch without a tested restore.** |
| **Deployment** | **No** | No CI config of any kind (verified: no `.github/`). No staging, no migration-on-deploy step, no rollback procedure. |

**Summary.** The application's core is genuinely sound: identity,
authorization, transactional integrity, exact-decimal money, idempotency, audit
and observability are real, and mainnet deposits now work end to end against
real funds. What stands between this and production is not architecture — it is
(1) money that cannot leave (C3/C3a), (2) the absence of any operational
apparatus at all: no backups, no monitoring, no CI, no rate limiting, and (3)
two measured performance regressions on the deposit path (H7, H8).

---

## Recommended order

*(M11, H7, H8 and C3a are done — see Resolved. NEW-1, NEW-2, NEW-3 and C1a
landed on 2026-09-14 — see the end of this file.)*

*(H9, M12 and M10 landed 2026-09-16, along with most of M1 and the queue half
of M2. M1 was finished on 2026-09-17, and the whole 2026-09-16 pass was
verified against a live database that day — including migration `0017`, which
had never been applied and whose index never matched its query. See
"Verified 2026-09-17".)*

0. **Look at the CRM screens in a browser**, at 360 px and at desk width. The
   2026-09-17 pagination work was verified over HTTP with a real operator
   session but never rendered on screen: no Chrome extension was connected.
   This is the cheapest item here and the only one gating a change that has
   already shipped to `Main`.
1. **H4 + the cron-count problem** (a daily scan is a customer-visible defect on
   mainnet, and there are **four** scheduled jobs — one at `*/15` — against a
   Hobby plan that caps both the count and the frequency at far less. The
   deployment is therefore already committed to Pro or to an external
   scheduler, and that should be a stated decision rather than an accident)
2. **Monitoring + backups** (the smallest work with the largest downside if skipped)
3. **H10** (rate limiting — the three candidate designs are assessed above)
4. **H1** (wrong-asset visibility)
5. **C3** (payout rail — the largest piece, and it depends on all of the above)

Deferred, with triggers rather than dates: `pg_trgm` indexes for CRM search
(~50k rows), pagination for `/admin/audit-logs` and `/admin/system-logs` (both
capped rather than paged today), and a cleanup script for orphaned integration
-test accounts.

Two product decisions are open and neither blocks code: the initial tier rates,
and what `payoutDelayDays` is measured from. Both are at the end of this file.

# NEW — requested 2026-09-13, delivered 2026-09-14

**NEW-1 (plan amount/rate tiers), NEW-2 (new-deposit confirmation) and NEW-3
(admin deposit-address management) are implemented.** See CHANGELOG.md for what
each one does and CLAUDE.md §10c, §10d, §18.4a and §18.9 for the durable rules.
Automatic referral commission release, which was not on that list, landed with
them and closed C1a.

What each one deliberately left open is below.

---

# DECISION REQUIRED — initial tier rates for the shipped plans

**Not a defect, and not a blocker: the plans work today.** A product decision
somebody has to actually take.

The request specified an initial ladder of `10–50 → 2%`, `50–100 → 3%`,
`100+ → 5%`. **Those figures were not applied**, and the reason is the rate
unit. In this schema a plan's percentage is the **total return over the plan's
whole term** (CLAUDE.md §10a/§10c), so:

| Plan | Term | Today | Literal request would give |
|---|---|---|---|
| Balanced Growth | 90 days | 12% | 5% |
| Momentum Plan | 180 days | 26% | 5% |
| Institutional | 365 days | 38% | 5% |

That is not a configuration default; it is a repricing of live products, and
two of them have allocations running against them. Applying it silently would
have been exactly the "do not convert a total-return percentage into a periodic
one" failure the request itself warned about — in the other direction.

**What was done instead**, so every plan arrives with a coherent, visible
ladder: three bands per plan on round-number boundaries inside the plan's own
range, with the middle band at the plan's existing headline rate and the outer
bands at the ends of the projected range the plan **already publishes**. Every
figure was already being promised in public, and the commonest allocation size
is priced exactly as before.

```
Starter Plan      50–100 @ 2.8%   100–500 @ 3.5%    500+ @ 4.2%
Balanced Growth   250–500 @ 9.5%  500–1000 @ 12%    1000+ @ 14.5%
Momentum Plan     1k–5k @ 16%     5k–10k @ 26%      10k+ @ 34%
Flexible Reserve  25–50 @ 3.5%    50–100 @ 4.5%     100+ @ 5.5%
Institutional     25k–50k @ 24%   50k–100k @ 38%    100k+ @ 48%
```

**The decisions outstanding:**

1. **Should a larger allocation earn more?** The seeded ladder says yes, within
   the range already disclosed. That is a defensible default, not a mandate.
2. **If the literal 2/3/5 ladder is genuinely wanted**, it needs either a plan
   whose terms make those figures sensible (a short term, or a much smaller
   minimum), or a decision to reprice the existing products — which needs a
   view on what happens to allocations already running. Nothing reprices them
   automatically, by design (§10c).
3. **Do the plan minimums want revisiting?** Starter's is 50 USDT and Balanced's
   is 250, so the `10–50` band the request describes cannot exist on either.
   Only Flexible Reserve (minimum 25) has a band below 50.

All three are one CRM edit away. `/admin/plans → Tiers` changes any of it, with
a preview that prices a test amount through the same function a real allocation
uses, and nothing in the code hard-codes a rate.

---

# DECISION REQUIRED — what `payoutDelayDays` is measured from

Commission release is automatic now: `release_at` is stamped at accrual as
`payoutDelayDays` days later, at 00:00 IST, and the nightly job pays everything
due (CLAUDE.md §10, §10d).

**The delay is measured from the accrual, not from the allocation performing.**
That is the one schedule that uses configuration which already existed rather
than a definition nobody has written, and it is stated plainly in the code and
in the CRM's own copy. What it does *not* do is wait for the allocation to have
earned anything.

The alternatives, and what each costs — this table survives from the old C1a
because the decision it describes is still open, it is just no longer blocking:

| Rule | Consequence |
|---|---|
| **`payoutDelayDays` after accrual** *(implemented)* | Predictable, uses existing configuration. A reversed allocation can still leave a payout that has already gone out |
| On first credited earning period | Referrer paid once the allocation is demonstrably performing. Needs a hook in `recordInvestmentEarning` |
| At maturity | Safest; referrers wait 30–90 days and may find the programme unattractive |

**Changing it is a change to where `release_at` is computed, and nothing else.**
The release job only ever asks whether the stamped date has passed, so a
different rule does not touch the money path, the guards or the audit entry.

Entries accrued before this feature carry `release_at = null` and are never
released automatically — inventing a payment date for them would be inventing a
payment date. An operator releases those by hand, and the CRM marks them
"Not scheduled".

---

# Known limitations of what landed on 2026-09-14

- **The tier ladder has no history table.** Changes are recorded in
  `audit_logs` with the full before-and-after ladder, and every allocation
  carries the band it was sold at — so a dispute is reconstructable. What does
  not exist is a queryable `plan_tier_history` equivalent to
  `plan_rate_history`. Add one if tier changes become frequent enough to want
  a timeline rather than a log search.
- **Three cron jobs now, on a plan that allows one a day.** `vercel.json`
  schedules the deposit scan, settlement and the commission release. Hobby caps
  the *number* of jobs as well as the frequency. If a deploy is rejected, move
  them to an external scheduler — all three are plain `CRON_SECRET`-authorised
  URLs — rather than dropping one. Same constraint as H4 above, and it should
  be solved with it.
- **`releaseDueCommissions()` is bounded to 500 entries a pass** and takes no
  global lock. Every payment is individually guarded, so overlapping passes are
  wasted work rather than double payment — the same shape as the note on
  `settleInvestments()` below, and the same fix (an advisory lock) when the
  schedule tightens.
- **Two test fixtures asserted on facts they did not own, and both are fixed.**
  `schema.integration.test.ts` hard-coded "34 tables / 28 foreign keys", which
  a new table correctly broke; the counts are of what the *code* declares, so
  they are right to be exact and were simply bumped. More interesting:
  `referrals.integration.test.ts` selected its plan with
  `where(status = 'open').limit(1)` and **no `ORDER BY`** — the same
  physical-row-order bug M11 fixed in `money-lifecycle` and left standing here.
  It passed 9/9 alone and failed in a full run with *"Balanced Growth has a
  minimum of 250 USDT"*. Now selected by the property the file owns: the lowest
  minimum that can accept its smallest allocation. **If another file grows a
  `limit(1)` over `plans` without an order, this is the third time.**
- **`createInvestment` costs one extra round trip.** It reads
  `plan_rate_tiers` inside the allocation's transaction — ~200 ms on this
  deployment (CLAUDE.md §16.1a). Correct, and unavoidable if the rate is to be
  resolved from the rows rather than trusted from the caller; it could be
  folded into the plan read with a lateral join if allocation latency ever
  matters. It does not today: an allocation is a deliberate, once-in-a-while
  action, not a page render.
- **`.edge-scroll` with a single child may not scroll at all.** The utility
  sets `scroll-snap-type: x mandatory` and puts the snap point on
  `.edge-scroll > *`. Where the container's only child is one wide wrapper —
  which is the shape `PlansBrowser`'s risk-filter chip row uses — there is a
  single snap position at offset 0 and the row can be pinned there. The new
  rate-tier chip row on `PlanCard` was written the other way (the `<ul>` is the
  scroller, so every chip is a snap point). **Suspected, not confirmed:** no
  browser was available this session to verify it, and it should be checked at
  360px before being changed.
- **The user's own referral screen does not show release dates.** The CRM does;
  `/referral` still shows only a "pending" total. The data exists
  (`commission_entries.release_at`), and the user-facing `CommissionEntry` type
  would need `status` and `releaseAt` added to surface it. Worth doing — a
  referrer who can see *when* they will be paid asks support one fewer
  question — but it was outside what this pass was asked to change.
- **The deposit confirmation is not a notification.** It appears on `/wallet`
  and `/wallet/deposit` when one of those is opened. Nothing pushes, emails or
  raises an in-app notification when a deposit is credited while the app is
  closed. That is the existing "real notification delivery beyond in-app" gap,
  now with an obvious trigger for it.

