# Nanotron — future tasks

Everything the project should eventually address that was **not** required to
complete the current work. Written after a full architecture audit on
2026-08-24.

Companions: `CLAUDE.md` (durable architecture and rules), `CHANGELOG.md` (what
actually happened), `API_DOCUMENTATION.md` (the server interface).

A note on honesty, because it governs how this file should be read: items are
here because they are *known*, not because they are hypothetical. Where a claim
is measured, the measurement is quoted. Where something is suspected but
unproven, it says so.

---

# P0 — must fix before real users

Security, financial correctness, data integrity, authorization, production
blockers.

### C1 — Referral commission is recorded but never paid *(resolved for accrual; release is still manual, deliberately)*

> **Update 2026-09-06.** Accrual and its trigger are done, and have been since
> before this note: `createInvestment` calls `accrueReferralCommission` in the
> same transaction as the allocation, at the beneficiary's current VIP rate,
> writing a `pending` `commission_entries` row and moving `referral_accounts`'
> aggregates and level. It credits nobody's wallet — that is deliberate, not
> the gap this item originally described (see `referrals-write.service.ts`).
> An operator releases a pending entry into the wallet from
> `/admin/referrals`, one transaction, guarded so two clicks pay once. What
> remains is *automatic* release, and it is now blocked on a product decision
> rather than a missing engine — see the new C1a below.

### C1a — No product rule for when referral commission is automatically payable

- **Problem.** Investment settlement (C2, resolved below) now runs, so
  `platform_settings.referrals.payoutDelayDays` could in principle be read
  against something — but nothing in the product's rules says *what* "the
  allocation settles" means for the purpose of releasing a referrer's
  commission: at the source allocation's first credited earning, at its
  maturity, immediately on accrual, or something else.
- **Why it matters.** Guessing this on the one table that pays a third
  party's money is worse than leaving it manual — a wrong guess pays the
  wrong amount at the wrong time and there is no clean way to reverse a
  released commission a user has already seen.
- **Current state.** `releaseCommission()` is complete, audited, idempotent,
  and callable from anywhere once the trigger exists; only `/admin/referrals`
  calls it today.
- **Recommended solution.** A product decision, then a one-line change: call
  `releaseCommission()` from whichever settlement event is chosen, most
  likely from `creditDueEarnings` or `matureInvestment` in
  `investment-settlement.service.ts`.
- **Dependencies.** None technical — a business decision only.
- **Complexity.** Small, once decided.
- **Production safety.** Yes — it moves money.
- **Before launch.** No — manual release via the CRM is a complete, safe,
  audited substitute for as long as this stays undecided.

### C2 — No investment earnings engine *(resolved 2026-09-06)*

> **Update 2026-09-06.** Implemented. `/api/cron/settle-investments` now
> credits every due earning period before it matures anything, via
> `creditDueEarnings()` in `investment-settlement.service.ts`:
> `recordInvestmentEarning()` — already transactional, already guarded by the
> unique `(investment_id, period_key)` index described below — is finally
> called, once per due period, for every active fixed-term allocation.
> The plan's configured `estimated_return_percent` is the rate actually paid
> (a deliberate product decision — see `API_DOCUMENTATION.md` "Earnings" and
> `CLAUDE.md` §10a), non-compounding, split across periods with exact
> integer arithmetic (`splitEvenly()` in `@/db/money`) so the periods always
> sum to exactly the total sold. Flexible Reserve is excluded, the same way
> it was already excluded from maturity. A plan's rate change is recorded in
> a new `plan_rate_history` table and reaches only allocations created after
> it — see `CLAUDE.md` §10b. Tested end to end in
> `server/money-lifecycle.integration.test.ts` (daily/weekly/monthly/
> on-maturity rounding, missed-cron catch-up, concurrent settlement, final
> period at maturity, Flexible Reserve exclusion, rate-change isolation) and
> `server/writes.integration.test.ts` (concurrent crediting of one period).

### C3 — Withdrawals pay nobody

- **Problem.** The withdrawal lifecycle is fully persisted and audited, and the
  balance is genuinely held on request and returned on rejection. There is no
  payout rail: `approved` / `processing` / `paid` are operator bookkeeping and
  `payoutReference` is free text an operator types.
- **Why it matters.** A user can be shown "paid" when no money has moved.
- **Current state.** Documented in `CLAUDE.md` §17.4 and in
  `withdrawals-write.service.ts`. Deliberate, not accidental.
- **Recommended solution.** Integrate an INR payout provider; drive status from
  provider webhooks rather than operator clicks; keep the operator decision and
  the rail event as distinct states.
- **Dependencies.** A payment provider, and the compliance work that comes with
  one.
- **Complexity.** Large.
- **Production safety.** Yes.
- **Before launch.** Yes.

### C4 — Operator session revocation cannot revoke anything

- **Problem.** "Log out all devices" marks `user_device_sessions` rows revoked.
  It cannot invalidate the Supabase refresh token behind them, because that needs
  the service-role key, which this project deliberately does not hold.
- **Why it matters.** An operator responding to a compromised account believes
  they have cut off access. They have not; the browser keeps working until its
  token expires.
- **Current state.** Honest — the action's message and the audit line both say
  the credential is not invalidated. That is mitigation, not a fix.
- **Recommended solution.** A small privileged service holding the service-role
  key, exposing only `signOut(userId, scope)`, called from the CRM. The key never
  enters this application.
- **Dependencies.** A second deployable, or a Supabase Edge Function.
- **Complexity.** Medium.
- **Production safety.** Yes.
- **Before launch.** Yes.

### C5 — A Supabase Auth outage silently signs everyone out *(partially addressed)*

> **Update 2026-08-24.** Errors are now classified server-side
> (`@/server/errors`), so an auth-provider outage is recorded as
> `AUTH_PROVIDER_UNAVAILABLE` rather than being indistinguishable from a logout
> in the log. The *user-facing* behaviour is unchanged — they are still
> redirected to sign in — because `getAuthPrincipal()` still returns `null` on a
> transport failure. Making the UI say "authentication is temporarily
> unavailable" remains outstanding, and is now a small change on top of the
> taxonomy.

- **Problem.** `getAuthPrincipal()` catches every failure and returns `null`,
  which every caller reads as "not signed in" and redirects to `/login`.
  Observed live during this audit: a network blip produced
  `ConnectTimeoutError … supabase.co:443` and users were redirected instead of
  shown an error. Recorded in `pipeline_events` as `render.redirected` averaging
  10,500ms (the connect timeout).
- **Why it matters.** An infrastructure fault is indistinguishable from a
  logout. Users re-enter credentials that also fail, and the logs say "not
  signed in" rather than "the identity provider is unreachable".
- **Current state.** The try/catch is deliberate (it covers "no request scope"),
  but it does not distinguish that from a network failure.
- **Recommended solution.** Separate the two: return `null` only for a genuinely
  absent session; throw a distinct `AuthProviderUnavailableError` for transport
  failures, and render an "authentication is temporarily unavailable" state.
- **Dependencies.** None.
- **Complexity.** Small.
- **Production safety.** Yes.
- **Before launch.** Yes.

### C6 — Deposit attribution is manual and unverified against an intent *(resolved for pool addresses, 2026-09-06)*

- **Problem.** One shared receiving address. A TRC-20 transfer carries a sender
  and nothing else, so an operator decides who it belongs to. There is no
  expected-amount or intent to check the transfer against.
- **Why it matters.** Crediting the wrong account is a loss, not a display bug.
  The current control is operator care.
- **Current state.** `deposit_addresses` (CLAUDE.md §18.8) now exists: a small,
  operator-configured pool of addresses, allocated one-per-user on demand
  (`getOrCreateDepositAddress`), never reassigned automatically, and resolved
  by the scanner at detection time so a transfer to an assigned pool address
  credits its owner in the same transaction — no operator step. The Add Funds
  screen now shows the user their own real pool address for Shasta. The
  legacy shared address, and any pool address nobody currently holds, still
  cannot say who paid and still route through the manual queue at
  `/admin/deposits`, exactly as before.
- **What is not done, and why — a key-custody decision, not an oversight.**
  The pool's addresses are **configured**, not derived: an operator generates
  each one with their own trusted wallet tooling, and only the address string
  reaches this codebase. True BIP-44 derivation from an account xpub (so the
  pool could grow itself, without an operator hand-adding each address) needs
  that xpub to exist first, generated offline by the operator — it does not
  exist in this project, and building a real one inside this pass would have
  meant that seed or xpub passing through a coding session, which is exactly
  what must never happen. See CLAUDE.md §18.8 for the full reasoning. Address
  the moment an operator supplies an xpub; nothing in the pool schema
  (`derivation_index` is already a column, unused today) blocks it.
- **Also not done: sweeping.** Pool addresses accumulate balances; nothing
  consolidates them to a treasury address. That needs a signing key this
  application does not hold, a TRX/energy funding policy, and a minimum-sweep
  threshold — see CLAUDE.md §18.8's closing note. Out of scope for the same
  custody reason.
- **Complexity.** Was Large; the address-pool half shipped 2026-09-06. Real
  derivation and sweeping remain Large, and depend on an operator-provided
  xpub and a signing-key strategy respectively.
- **Production safety.** Yes.
- **Before launch.** The pool covers real Shasta usage today. Real funds
  additionally need mainnet enablement (still refused in code) and a sweeping
  strategy — neither of which this resolves.

---

# P1 — important

Performance, reliability, blockchain robustness, admin workflows, observability.

### H1 — Wrong-asset transfers are invisible

- **Problem.** Native TRX sent to the deposit address succeeds on-chain and
  appears nowhere in the application. The TRC-20 transfer endpoint does not
  return it, so the scanner cannot see it and no record exists.
- **Why it matters.** This is not hypothetical. During this audit the deposit
  address was found to hold **4,461 TRX from six native transfers**, three of
  them made while testing "deposits that are not being detected". The scanner
  was correct; the asset was wrong. Nobody could tell, because nothing recorded
  it.
- **Current state.** The deposit screen warns prominently against sending TRX.
  Nothing detects it if a user does anyway — and as of 2026-09-06 there are
  more addresses this applies to: every address in the deposit-address pool
  (CLAUDE.md §18.8), not just the one legacy address, each of which can
  independently receive a stray native-TRX transfer invisibly. Considered and
  deliberately deferred in that pass rather than rushed alongside the pool
  itself — it touches every watched address, not one, and the pool's own
  correctness was the priority.
- **Recommended solution.** Scan the native-transaction endpoint for every
  address in `deposit_addresses`, not just the legacy one, and record
  wrong-asset arrivals as deposits with `status = 'ignored'` and a
  `failureReason`, so an operator can see them and arrange a refund. Do **not**
  credit them.
- **Dependencies.** None — same TronGrid client.
- **Complexity.** Small, now scanning N addresses instead of one — still small
  per address.
- **Production safety.** No (it only adds visibility).
- **Before launch.** Yes — otherwise user funds arrive and vanish from view.

### H2 — Warm navigation is ~1.6–2.7s, dominated by round-trip latency

- **Problem.** Warm, production-build, authenticated navigation measures
  1.6–2.7s for user pages and ~1.3s for admin pages. The target of 500–800ms is
  not met.
- **Why it matters.** It is the top user-visible complaint.
- **Current state, measured.** Against the configured Supabase project
  (ap-northeast-2, client in India):
  - one Postgres round trip ≈ **200ms**
  - Supabase Auth `getUser()` ≈ **233–345ms** (network, unavoidable while the
    token is verified remotely)
  - opening a *new* connection ≈ **2,000ms** (mitigated: `idle_timeout: 0`)
  A page performing auth + 2–3 dependent queries therefore has a floor around
  800ms–1s before any application work.
- **Recommended solution, in order of expected effect.**
  1. **Move the database to a region near the users.** ~200ms → ~20ms would cut
     every page roughly 5×. This is the single highest-impact change and it is
     infrastructure, not code. It is recommended *because* the measurements
     show application work is no longer the dominant cost — not to hide
     inefficiency.
  2. Verify the JWT locally using the project's JWT secret instead of calling
     `getUser()` on every request, removing ~300ms. Requires holding that
     secret; weigh against the "one authority" principle in `CLAUDE.md` §19.
  3. Collapse the remaining per-page query chains where a join can replace two
     round trips.
- **Dependencies.** (1) is a Supabase project migration with a data move.
- **Complexity.** Small (1) / Medium (2) / Medium (3).
- **Production safety.** No.
- **Before launch.** (1) yes if the audience is not near ap-northeast-2.

### H-1 — One Supabase pooler endpoint is broken *(root cause identified)*

> **Update 2026-08-24.** Diagnosed precisely.
> `aws-0-ap-northeast-2.pooler.supabase.com` resolves to three A records; one of
> them (`15.164.120.176`) accepts TCP and then never completes the Postgres
> startup handshake — CONNECT_TIMEOUT 3/3 at 12s, while the other two succeed
> 3/3 in ~1.9s. DNS round-robins, so roughly one connection in three hangs.
>
> This explains every intermittent symptom across the project: the Vercel build
> failure, non-deterministic test failures with zero assertion failures, and
> occasional 500s. **Report it to Supabase**; consider a connection retry that
> re-resolves DNS, which is legitimate resilience against a partially degraded
> endpoint set rather than hiding an error. Do not raise `connect_timeout` — a
> healthy handshake takes ~2s, so a longer timeout only lengthens the hang.

### H-1a — Original entry: the link appeared simply unreliable

- **Problem.** Connections to both the database and the Auth API intermittently
  time out. Observed repeatedly on 2026-08-24: `write CONNECT_TIMEOUT` failing a
  production build, `ConnectTimeoutError … supabase.co:443` in the request path,
  and 5–7 test failures per run that are **entirely** timeouts — zero assertion
  failures across two full runs.
- **Why it matters.** It makes every other measurement noisy and, more
  seriously, it is what the reported `CONNECT_TIMEOUT` actually is. The
  application's connection management is not at fault: one `globalThis`
  singleton pool, no per-request creation, `DIRECT_DATABASE_URL` confined to
  scripts. The link itself is the problem.
- **Current state.** Cold connect measured at 2,664ms with warm queries at
  ~204ms in the same session; earlier the same day, connects exceeded the 10s
  `connect_timeout` entirely. `max_lifetime` is now pinned to 30 minutes so a
  socket is replaced on a schedule rather than discovered dead mid-request.
- **Recommended solution.** Establish whether this is the local network, the
  route to ap-northeast-2, or the Supabase project's own availability — the
  three have different fixes. Moving the database closer (H2) would shrink the
  window in which a connect can time out. Whatever the cause, **do not raise
  `connect_timeout` to hide it**: a 10s wait already exceeds any reasonable page
  budget, and a longer one converts a failure into a hang.
- **Dependencies.** None to diagnose.
- **Complexity.** Small to diagnose, unknown to fix.
- **Production safety.** Yes — it fails builds and requests.
- **Before launch.** Yes.

### H0 — Concurrency collapses past the connection pool

- **Problem.** Concurrent authenticated requests degrade linearly once the
  five-connection pool is saturated. Measured on the production build, all
  requests succeeding (no errors, no `CONNECT_TIMEOUT`):

  | concurrent `/wallet` requests | total | slowest |
  |---|---|---|
  | 1 | 2,390ms | 2,390ms |
  | 4 | 6,389ms | 6,387ms |
  | 8 | 11,816ms | 11,810ms |
  | 12 | 15,949ms | 15,946ms |

- **Why it matters.** Twelve simultaneous users — a trivial load — already means
  a sixteen-second page. This is the scalability ceiling, and it is reached long
  before anything else in the system strains.
- **Current state.** The connection architecture itself is correct: one
  `globalThis` singleton pool, no per-request creation, `DIRECT_DATABASE_URL`
  confined to scripts and tests. The limit is `max: 5`, chosen deliberately for
  a serverless deployment where many instances share one database.
- **Recommended solution.** This is the one place where raising the pool is a
  *fix* rather than a workaround, because connection management is already
  sound. Size it against the deployment model: a single long-running server can
  hold far more than five, while a serverless fleet cannot. Reducing per-request
  round trips (H2) lowers the pressure either way. Measure before and after —
  raising it blindly moves the bottleneck to Supavisor.
- **Dependencies.** A decision on the deployment model.
- **Complexity.** Small to change, Medium to validate.
- **Production safety.** No, but it is a availability risk under load.
- **Before launch.** Yes.

### H2a — Unexplained regression on `/wallet` and `/` after the layout split

- **Problem.** Moving data fetching out of the route-group layout into pages
  made `/settings/kyc` 21% faster (2,048 → 1,615ms) and left `/plans` about
  level, but `/wallet` (2,098 → 2,651ms) and `/` (2,420 → 2,671ms) measured
  *slower* — and the cause is not established.
- **Why it matters.** The change is architecturally correct and required, but a
  20% regression on the two most-visited screens should be understood rather
  than accepted.
- **Current state.** A control route untouched by the change (`/admin/users`)
  held steady across all four measurement rounds (1,228 / 1,275 / 1,262 /
  1,290ms), so the environment was stable and the difference is real. Both
  pages now issue *fewer* distinct queries than before, which makes the result
  counter-intuitive. Variance was high (p95 up to 5.4s), so part of it may be
  noise that 15 samples did not resolve.
- **Recommended solution.** Instrument per-slice timings with the existing
  tracer (`layer: "database"` events already carry durations) and read a single
  `/wallet` trace end to end. Two hypotheses worth testing first: React
  `cache()` not deduplicating across the layout/page boundary as assumed, and
  pool contention from five concurrent branches against `max: 5`.
- **Dependencies.** None — the tooling exists.
- **Complexity.** Small to diagnose.
- **Production safety.** No.
- **Before launch.** No, but before H2's infrastructure work, so the two are not
  confused.

### H3 — No loading UI; navigation appears frozen

- **Problem.** There are no `loading.tsx` boundaries. A 2s navigation shows the
  previous page until the new one is ready.
- **Why it matters.** Perceived performance. Some of the "it feels slow"
  complaint is the absence of feedback rather than the latency itself.
- **Current state.** None of the route segments define a loading boundary.
- **Recommended solution.** `loading.tsx` per route group with skeletons that
  match the real layout. Pair with `<Suspense>` around the slowest sections so
  the shell paints immediately. Do **not** use this to hide H2 — fix both.
- **Dependencies.** None.
- **Complexity.** Small.
- **Production safety.** No.
- **Before launch.** Yes.

### H4 — The scanner is not scheduled

- **Problem.** `npm run tron:scan` is run by hand. Nothing runs it periodically
  in a deployment.
- **Why it matters.** Deposits are detected only when somebody remembers.
- **Current state.** `--watch` exists for local use. The cursor
  (`chain_scan_state`) is durable and the unique `(chain, tx_hash)` index makes
  re-runs safe, so scheduling is genuinely just scheduling.
- **Recommended solution.** A cron/worker invoking one pass; alert on
  `consecutive_failures` and on `last_success_at` falling behind.
- **Dependencies.** A place to run it.
- **Complexity.** Small.
- **Production safety.** Yes (deposits depend on it).
- **Before launch.** Yes.

### H5 — `pipeline_events` grows without bound

- **Problem.** Every instrumented request writes rows. Nothing prunes them.
- **Why it matters.** The table already made `/admin/system-logs` the slowest
  page in the application (~3,000ms at a 500-row page size, since reduced to
  200). It will keep growing.
- **Current state.** Indexed on `occurred_at`, `correlation_id`, `layer`,
  `route`. Page size capped.
- **Recommended solution.** Retention (e.g. 30 days) via a scheduled delete or a
  partitioned table; consider keeping `failed` rows longer than `ok` rows.
- **Dependencies.** Scheduler (shared with H4).
- **Complexity.** Small.
- **Production safety.** No.
- **Before launch.** No, but soon after.

### H6 — Operator provisioning has no credential step

- **Problem.** Creating an operator in the CRM writes an `invited` row with no
  `auth_user_id`. Linking a Supabase credential is a manual script
  (`npm run db:link-admin`).
- **Why it matters.** An operator cannot actually be onboarded through the
  product.
- **Current state.** Deliberate — issuing a credential from a form is a decision
  that should not happen by implication.
- **Recommended solution.** An invitation flow: the CRM sends an invite, the
  operator sets a password via Supabase, and acceptance links `auth_user_id`.
- **Dependencies.** Email templates.
- **Complexity.** Medium.
- **Before launch.** Yes if more than one operator is expected.

---

# P2 — performance / reliability

UX, architecture cleanup, testing, maintainability.

### M1 — Unbounded per-user list reads

`listTransactionsForUser` and `listNotificationsForUser` have no `LIMIT`. Fine
for the development dataset; an account with years of history would transfer all
of it on every page that reads the slice. Add pagination at the repository and a
"load more" in the UI. Small. Not production-blocking today, but it becomes one
quietly.

### M2 — The CRM dashboard's headline metrics are seed data

`/admin` totals and chart series come from `@/data/admin/metrics`, not the
database. The recent-activity panels and every list screen are live. Documented
in `CLAUDE.md` §16.5 as a reporting-service job. Medium. An operator reading
those figures as real would be misled — label them or implement them.

### M3 — Test suite cannot exercise server actions

Actions resolve identity from a session, which a test process does not have, so
tests call the services underneath and assert separately that the actions refuse
without a session. That is a reasonable split, but it means the *action* layer —
validation, revalidation, error mapping — is untested. Introduce a request-scoped
test harness or Playwright end-to-end coverage. Medium.

### M4 — No end-to-end browser tests

Everything verified in this project has been verified by HTTP request and
database query. No test drives a real browser, so hydration errors, client-side
navigation and form interactions are unverified except by hand. Playwright over
the production build would close this. Medium.

### M5 — `useOptimistic` on two settings toggles

The notification and 2FA switches update optimistically and revert on failure.
Correct for preferences; the pattern must never spread to anything financial. Add
a lint rule or a comment convention. Small.

### M6 — Deposit-intent flow not implemented

A user cannot declare "I am about to send 50 USDT" and have the system match it.
The dev-only `recordDepositIntent` writes a `pending`/`unverified` row that
cannot become money. A real intent flow (expected amount, expiry, optional tx
hash submission, backend verification of contract/recipient/amount/finality, and
an unassigned fallback) is the natural companion to C6 and would make manual
attribution far safer. Medium. **Note:** it reduces mis-attribution risk but does
not eliminate it — two users can intend the same amount. Per-user addresses (C6)
is the real answer.

### M8 — No client-side caching of read-only data — **DONE (2026-08-24)**

> Implemented in the reliability pass; see "Reliability & Performance Audit"
> below. Catalogue reads are cached across requests and invalidated by tag on
> plan edits. User-scoped data remains per-request only.

### M8 (original note)

Static plan catalogue, VIP tiers and deposit networks are refetched on every
navigation even though they are identical for every user and change rarely.
`unstable_cache`/`revalidate` on the *catalogue* services would be safe — that
data belongs to nobody. It must never extend to a balance, an allocation, a KYC
state or anything else user-scoped: those are correct only because they are read
fresh, per request, under the session. Small.

### M9 — No route prefetching strategy — **largely resolved (2026-08-24)**

> Adding `loading.tsx` to every route changed this: Next prefetches a dynamic
> route only as far as its nearest loading boundary, so prefetch no longer
> speculatively renders authenticated pages. Per-link tuning was not done.

### M9 (original note)

Next prefetches `<Link>` targets in the viewport by default, which for
authenticated pages means speculative database traffic for pages the user may
never open. With five bottom-nav links always visible, that is up to five
extra authenticated renders per screen. Worth measuring, then setting
`prefetch={false}` on the expensive ones and keeping it for the cheap ones
(`/wallet/deposit` renders in ~616ms and reads no user data). Small.

### M7 — Referral status never advances — **resolved**

`accrueReferralCommission` (`referrals-write.service.ts`) moves a direct
referral from `registered` to `active` on that person's first allocation,
inside the same transaction as the commission it earns. Not touched in this
pass; noted here only because this file had not caught up to it.

---

# P3 — future enhancements

### L1 — `DATABASE_FORCE_IPV4` is probably unnecessary
Measured DNS resolution at 1ms with no AAAA stall on this machine; the flag
changed cold-connect time by <1%. It exists for machines whose resolver stalls.
Harmless, but worth re-checking before it is treated as required.

### L2 — Two words for one investment state
`investment_status` stores `matured`; the CRM says "matured", the user app says
"completed", and a mapper translates. Deliberate and documented, but it costs a
translation layer forever.

### L3 — Pool size left at 5
Measured 13–20% faster on the widest pages at 12. Left at 5 for the documented
serverless reason. Revisit if the deployment becomes a single long-running
server.

### L4 — Long operation labels in the system log
TronGrid operation names embed the account path
(`trongrid.v1/accounts/TE9h…/transactions/`). Public data, but unwieldy in a
table. Normalise to a stable endpoint name.

### L5 — `next.config.ts` is empty
Not a problem, but `serverExternalPackages: ["postgres"]` was tried and reverted
during the performance work; if the driver is ever bundled again, that is the
lever.

---

## Known Limitations

Things intentionally not solved.

- **No real money moves anywhere.** Deposits credit from observed testnet
  transfers; withdrawals are records. There is no payout rail and no outbound
  blockchain capability — no signing, no key custody, no sending. This is a
  deliberate boundary, not an oversight (`CLAUDE.md` §18.1).
- **TRON mainnet is refused in code**, not merely unconfigured. Enabling it
  should be a reviewed change.
- **Only masked account and document numbers are stored.** There is no document
  store and no KYC provider; a prototype should not accumulate the data it
  cannot yet protect.
- **The service-role key is not used and must not be added.** Its absence is why
  C4 exists, and that trade was made deliberately.
- **Seeded fixtures are not ledger-consistent.** The 30 development accounts have
  hand-authored balances alongside partial transaction lists. The
  ledger-reconciles-to-balance invariant applies to accounts built by
  `applyLedgerEntry`, and holds for those (verified: 0 discrepancies).
- **Admin identity is real, admin provisioning is not.** Operators authenticate
  through Supabase; onboarding one still needs a script (H6).
- **Earnings report what settled, not what accrued.** Deliberate: the ledger
  records rewards when they settle, and inventing a daily accrual curve would put
  numbers on screen that no service computed.

---

## Production Readiness Checklist

Status as measured or inspected on 2026-08-24, **except the rows marked
2026-09-06** where the investment earnings engine (C2), referral commission
accrual (C1) and the deposit-address pool (C6) landed. The rest of this table
has not been re-verified in this pass and should be read as of the earlier
date. "No" means not ready, not absent.

| Area | Ready | Notes |
|---|---|---|
| **Authentication** | Yes | Supabase Auth; password + optional email code; signup, confirmation callback, password reset all verified working. C5 (outage handling) outstanding. |
| **Database** | Yes | PostgreSQL 17 via session pooler. 34 tables, 43 enums, 28 FKs, 109 indexes verified against the declared schema as of 2026-09-06 (`npm run db:check`). Migrations generated and checked in; RLS re-provisioned via `npm run db:secure` after every migration. |
| **Authorization** | Yes | User data scoped to the session; no action accepts an identity. Operator permissions graded and enforced server-side. Verified: a customer session is refused by the CRM. |
| **KYC** | Yes | Full lifecycle persisted and audited; user and CRM read the same row. No provider integration (by design). |
| **Deposits** | Partial *(2026-09-06)* | Detection, verification, finality, idempotency and ledger crediting all work and are proven. A pool of operator-configured addresses now makes attribution and crediting automatic for whichever user each is assigned to (C6, resolved for the pool); the legacy shared address and unassigned pool addresses still route to the manual queue. Wrong-asset arrivals remain invisible, now across every pool address (H1). Scanner unscheduled (H4). |
| **Withdrawals** | **No** | Request/approval lifecycle correct and audited; balance genuinely held and returned. No payout rail (C3). |
| **Investments** | Yes *(2026-09-06)* | Creation, scheduled earnings (daily/weekly/monthly/on-maturity, non-compounding, exact rounding) and maturity are all transactional, idempotent and scheduled via `/api/cron/settle-investments`. Fixed-term early exit remains unimplemented, deliberately (§7 of this pass). |
| **Earnings** | Yes *(2026-09-06)* | Reads real ledger rows per account, and the settlement engine now writes them on the plan's configured schedule (C2, resolved). |
| **Referrals** | Partial *(2026-09-06)* | Attribution captured through signup, immutable, self-referral refused. Commission accrues automatically on allocation, at the correct historical VIP rate, and is released to the wallet by an operator (C1, resolved for accrual). Automatic release has no product rule yet (C1a). |
| **Admin** | Partial | Authenticated, permission-checked, all writes transactional and audited. Provisioning incomplete (H6); dashboard headline metrics are fixtures (M2). |
| **Blockchain** | Partial | Shasta only, read-only, idempotent, finality-gated. Verified end to end against a real transfer, including one traced live during this pass that had gone undetected for several days purely because nothing had run the scanner. Now watches a small address pool rather than one address (C6). Unscheduled (H4); wrong-asset blind spot (H1); no real key derivation or sweeping (C6). |
| **Logging** | Yes | Correlation-ID traces spanning client → server → database → external → blockchain, buffered and written after the response. Verified: no secrets in the table. Retention missing (H5). |
| **Security** | Partial | No plaintext credentials anywhere; no service-role key; ledger-only balance changes; idempotency by database constraint. C4 and C5 outstanding. |
| **Performance** | **No** | 1.6–2.7s warm navigation against a 500–800ms target. Dominated by ~200ms round-trip latency to a distant region (H2). No loading UI (H3). |
| **Backups / recovery** | **No** | Not configured or tested. Supabase provides automated backups on paid tiers; no restore has ever been rehearsed. Do not launch without a tested restore. |
| **Testing** | Partial | 183 automated tests pass *(2026-09-06)*, including live-database integration for the investment engine and the deposit-address pool. No browser end-to-end coverage (M4); server actions untested directly (M3). |
| **Monitoring** | **No** | `pipeline_events` supports diagnosis after the fact. No alerting, no uptime checks, no error aggregation, nothing watching `consecutive_failures`. |
| **Deployment** | **No** | Never deployed. No CI, no staging environment, no migration-on-deploy step, no rollback procedure. |

**Summary.** The application is coherent and internally consistent: identity,
authorization, transactional integrity, audit and observability are real and
verified. It is **not** production-ready, and the blockers are concentrated in
three places — money that cannot actually move (C3, withdrawals), the
remaining gaps around deposits (wrong-asset visibility — H1; real address
derivation and sweeping, both deliberate key-custody decisions — C6), and the
absence of any operational apparatus (backups, monitoring, deployment). The
investment earnings engine (C2) and the deposit-address pool's attribution
half (C6) were resolved 2026-09-06.

---

# Reliability & Performance Audit

Added 2026-08-24, after a focused reliability pass. No product features were
added or changed; deposits, referrals, investments, withdrawals, KYC rules and
admin business actions are untouched.

Every number below was measured on this machine against the configured Supabase
project (session pooler, ap-northeast-2, requests originating from India).
**Re-measure before trusting them elsewhere — the shape generalises, the
milliseconds do not.**

A note on method, because it changes how the timings should be read: network
conditions to this database moved by more than 2× *during* the work (a cold
five-connection burst measured 2,008ms early on and 4,769ms an hour later). A
sequential before/after would have measured the weather, not the change. The
timings below therefore come from an **interleaved A/B**: both revisions were
built, then served and measured alternately (before, after, before, after) so
drift lands on both arms.

---

## Root causes discovered

### R1 — One pooler endpoint fails the Postgres handshake, and *which* one moves

`aws-0-ap-northeast-2.pooler.supabase.com` resolves to three A records. Probed
with real handshakes, same credentials, same TLS, only the address pinned:

| endpoint | 2026-08-24 (earlier, from CHANGELOG) | re-probed during this pass |
|---|---|---|
| `15.164.120.176` | **CONNECT_TIMEOUT 3/3** | ok 4/4 (2.3–2.5s) |
| `15.165.245.138` | ok 3/3 | ok 4/4 (2.5–4.6s) |
| `13.124.111.232` | ok 3/3 | ok 4/4 (2.3–2.7s) |

The endpoint that was broken earlier answered fine later. **The fault rotates.**
That is the evidence for a bounded retry and against pinning an IP: pinning
would hard-code today's healthy endpoint and become tomorrow's outage.

### R2 — The hottest read path had no deadline at all

`fromDatabase()` had a 15s deadline. `account.service`'s `read()` and the
`users` lookup in `auth/account.ts` called `getDb()` directly and had **none** —
and those are the reads every authenticated page depends on.

From `pipeline_events` over one measurement session:

| operation | failures | average duration of a failure |
|---|---|---|
| `auth.resolveAccount` (SERVER_ERROR) | 40 | **55,349 ms** |
| `auth.resolveAccount` (DATABASE_TIMEOUT) | 33 | **71,212 ms** |

Observed request times during the same window: 33,088ms, 46,581ms, 49,406ms.
A page did not fail — it hung.

### R3 — A Supabase outage was reported as "not signed in" (the `NotAuthenticatedError`)

`getAuthPrincipal()` ended with:

```ts
const { data, error } = await supabase.auth.getUser();
if (error || !data.user) return null;   // ← an outage becomes "no session"
```

Null means exactly one thing to every caller: nobody is signed in. So a
transient failure to reach Supabase — measured at up to **30,915 ms** before it
gave up — signed a valid user out mid-navigation, redirected them to `/login`,
and produced `NotAuthenticatedError: Not signed in.` on any page that read
before the redirect landed.

This was a bug in an error path, not in the login system. Login itself was
working correctly throughout.

### R4 — No loading boundaries, and no root error boundary

There was no `loading.tsx` anywhere in `src/app`, so every page awaited its
database read before emitting any HTML — a slow read rendered as a **blank
page**. That is the "pages appear missing" symptom.

Worse, there was no `app/error.tsx` and no `app/global-error.tsx`. An error
boundary catches failures from the segments *below* it, never from the layout
beside it, so `(app)/error.tsx` did **not** cover `(app)/layout.tsx` — which is
where the gate lives and where R2 and R3 both fire. Those failures had nowhere
to land and took out the whole document. That is the "application crashes".

### R5 — `getUser()` was the largest single cost in every navigation

A network call to Supabase on every authenticated request:

| | measured |
|---|---|
| `getUser()` (network verification) | 327, 409, 230, 385, 411, 244 ms — **385 ms median** |
| `getClaims()` (local verification) | 370 ms first call (fetches JWKS), then **1–3 ms** |

`auth.resolvePrincipal` averaged **1,024 ms** in production telemetry, with a
maximum of 30,915 ms.

---

## Slowest routes (before)

Best of two interleaved rounds, median of three requests each.

| route | before | after | change |
|---|---:|---:|---:|
| `/` | 2,847 ms | 2,203 ms | **−23%** |
| `/wallet` | 2,567 ms | 2,185 ms | **−15%** |
| `/referral` | 2,235 ms | 1,774 ms | **−21%** |
| `/plans` | 1,985 ms | 1,828 ms | **−8%** |
| `/settings` | 1,982 ms | 1,777 ms | **−10%** |
| `/settings/kyc` | 1,595 ms | 1,342 ms | **−16%** |
| `/settings/profile` | 1,587 ms | 1,367 ms | **−14%** |
| `/settings/security` | 1,572 ms | 1,365 ms | **−13%** |
| `/wallet/withdraw` | 1,569 ms | 1,458 ms | **−7%** |
| `/settings/notifications` | 1,388 ms | 1,160 ms | **−16%** |
| `/settings/investments` | 1,181 ms | 950 ms | **−20%** |
| `/settings/wallet` | 1,162 ms | 911 ms | **−22%** |
| `/wallet/transactions` | 1,222 ms | 960 ms | **−21%** |
| `/wallet/deposit` | 752 ms | 566 ms | **−25%** |
| `/admin` | 1,585 ms | 1,134 ms | **−28%** |
| `/admin/users` | 1,241 ms | 880 ms | **−29%** |
| `/admin/deposits` | 1,142 ms | 961 ms | **−16%** |
| `/admin/kyc` | 1,112 ms | 1,028 ms | **−8%** |
| `/login` (no session) | 43 ms | 45 ms | — |
| **aggregate (excl. `/login`)** | **28,724 ms** | **23,849 ms** | **−17%** |

Every authenticated route improved. One caveat stated plainly: round 2 of the
"after" arm shows three consecutive outliers (`/` 3,850ms, `/plans` 4,067ms,
`/wallet` 5,373ms) while the settings routes measured moments later in the same
round were at their fastest. That is a transient network event, not a
regression — which is exactly why the table uses best-of-two.

Server-side, from `pipeline_events`:

| operation | before | after |
|---|---:|---:|
| `auth.resolvePrincipal` (avg) | 1,024 ms | **21 ms** |
| `auth.resolveAccount` (avg) | 713 ms | 456 ms |
| `auth.resolveAccount` failures | **56** | **0** |

---

## Slowest queries

**There are none worth optimising, and that is the finding.** `EXPLAIN ANALYZE`
on the hottest query in the application — the `users` lookup by `auth_user_id`
that gates every page:

```
Limit  (actual time=0.020..0.020 rows=1 loops=1)
  ->  Index Scan using users_auth_user_id_key on users
        Index Cond: (auth_user_id = '…'::uuid)
Execution Time: 0.050 ms
```

**0.05 ms of execution inside a 200–500 ms round trip.** The index already
exists and is used. Measured round trips on a warm connection: 173, 268, 216,
192, 172, 237 ms.

So **no index was added and no query was rewritten** — neither would move a
number that is 99.98% network. What matters here is the *count* of round trips
and whether a connection is already open, which is what the changes below
address. Adding indexes "for performance" against this deployment would be
cargo cult.

The one real query-shape issue remains open and is already filed as **M1**:
`listTransactionsForUser` and `listNotificationsForUser` have no `LIMIT`.

---

## Connection behaviour

| | cold pool | warm pool |
|---|---:|---:|
| five concurrent queries | **2,008 ms** | **203 ms** |

Ten to one, and none of it is the queries: the Postgres startup handshake is
roughly ten round trips against a query's one.

`DATABASE_POOL_MAX` was re-measured rather than assumed. Raising it to 12 made
the cold burst **worse** (3,270 ms vs 2,008 ms) with no warm improvement — more
connections simply means more simultaneous handshakes. **It stays at 5**, which
contradicts the older note in CLAUDE.md §16.1a suggesting 12; that note was
measured under different conditions and should be treated as superseded for
this deployment shape.

---

## Fixes implemented

### FIXED — Bounded retry for transient connection failures (`src/db/resilience.ts`)

- Retries **only** failures that mean "the connection never got established":
  `CONNECT_TIMEOUT`, `ECONNRESET`, `CONNECTION_CLOSED`, SQLSTATE class `08`,
  `57P01`/`57P03`, and the same codes found on a nested `cause`.
- A constraint violation, syntax error or permission error is re-thrown on the
  **first** attempt, untouched. Permanent errors are never hidden.
- Bounded by **both** a retry count (2 retries) and a **12 s wall-clock budget**,
  because a count alone is not a bound when each attempt can burn a timeout.
- Backoff is short with jitter, so several failing renders do not retry in
  lockstep.
- **Reads only.** No mutation is routed through it. `mutate()` is untouched, so
  a retry can never duplicate a write — a mutation that failed after its
  statements reached the server may have committed.
- Every retry is recorded to `pipeline_events` as `database.connectRetry` with
  `willRetry: true`, so a *recovered* fault is still visible. Without that, the
  pooler could be failing a third of its connections and nothing would say so.
- 13 unit tests in `src/db/resilience.test.ts`, no database required.

`connect_timeout` was **lowered** from 10 s to 6 s — deliberately, and against
the retry budget rather than in isolation. Healthy handshakes measure 2.3–4.6 s,
so 6 s clears the worst healthy case while making the worst failure case exactly
two attempts (~12 s), leaving room for the retry to reach a different endpoint.
Raising it would not help: the broken endpoint does not complete in 20 s either.
**The timeout was not increased, and no IP is hard-coded.**

### FIXED — A deadline on every read

`resilientRead()` in `@/server/database` now wraps the retry in the existing
deadline, with the deadline **outside** the retry so three attempts cannot cost
three deadlines. Applied to `account.service`, the `users` lookup in
`auth/account.ts` and the operator lookup in `admin/session.ts` — the three
paths that previously had none.

Verified against a blackholed database: reads now fail at the deadline instead
of hanging. `src/server/database.test.ts` pins this (12,207 ms for a fully dead
host, versus never before).

### FIXED — An outage is no longer a sign-out

`getAuthPrincipal()` now throws `AuthProviderUnavailableError` when it cannot
*reach* a verdict, and returns null only when the token is genuinely absent,
expired or rejected. `(app)/layout.tsx` catches it and renders the shell with a
recoverable "Unable to confirm your sign-in — you have not been signed out"
notice, so **navigation stays usable and a good session is not destroyed**.

The classification is pinned by 7 tests in `src/server/auth/session.test.ts`,
including the direction that matters most: an unknown failure is treated as an
outage, never as a rejection, because failing closed there is the bug.

### FIXED — `getUser()` → `getClaims()` (≈385 ms off every authenticated request)

This project signs JWTs with **ES256** (confirmed against
`/auth/v1/.well-known/jwks.json`), so `getClaims()` verifies the signature
in-process against the cached JWKS.

**This is not the `getSession()` mistake CLAUDE.md §19.4 forbids.**
`getSession()` decodes an attacker-controlled cookie and believes it;
`getClaims()` checks a signature that cannot be forged without the project's
private key, and rejects anything expired. Verified: a forged/garbage token
still redirects to `/login` on `/`, `/wallet` and `/admin`. If the project ever
reverts to a legacy HS256 secret, the SDK falls back to a network `getUser()`
call by itself, so this stays correct either way.

What is given up: a token revoked *server-side* stays valid until it expires.
That costs nothing here, because this deployment cannot revoke server-side at
all — it holds no service-role key (§19.6, §20.3).

### FIXED — Loading boundaries (32 files)

`loading.tsx` for every user route (14) and every console route (14), plus two
shared skeleton vocabularies (`page-skeleton.tsx`, `admin-skeleton.tsx`) shaped
like the screens they stand in for, so content lands where it was outlined.
Server-rendered, `aria-busy` + `sr-only` labelled, no client JS needed.

A side benefit worth knowing: Next prefetches a dynamic route only as far as its
nearest `loading.tsx`. Adding them made link prefetching both **cheaper** (it no
longer speculatively renders authenticated pages — the concern raised in **M9**)
and **useful** (the skeleton is ready before the click resolves).

### FIXED — Root error boundaries

`src/app/error.tsx` (covers layout failures — the gap that let R2/R3 crash the
document) and `src/app/global-error.tsx` (covers the root layout itself, with
inline styles and no imports, since it cannot depend on what it is catching).

Both show "Unable to load this information … Retry" and a digest reference.
Verified with the database blackholed: **no stack trace, no SQL, no connection
string reaches the browser** — checked by pattern-matching the response bodies.

### FIXED — The sign-in page survives a database outage

`/login` and `/admin/login` resolved the account/operator to offer a
convenience redirect, and re-threw on failure — so during an outage the one page
a stuck user is told to go to returned **500**. Both now fall back to showing
the form, and `/login` bounds that lookup at 2 s of its own.

Measured with the database blackholed: `/login` went **500 → 200**, and from
**8,612 ms → 2,089 ms**.

`redirect()` is called *outside* the `try` in both, because it works by throwing
a signal that a broad `catch` would otherwise swallow.

### FIXED — Connection pool pre-warming (`src/db/warmup.ts`)

Opens four connections in the background when the pool is created, turning a
cold five-query burst from 2,008 ms into 203 ms for everyone after the first
request. Fire-and-forget; every failure swallowed, because a cold pool is slow,
not broken.

It hangs off `getDb()` rather than `instrumentation.ts`, and that is not a
stylistic choice: Next compiles `instrumentation.ts` for the Edge runtime too
and webpack resolves the graph statically, so even a dynamic `import()` behind a
`NEXT_RUNTIME === "nodejs"` guard drags `postgres` → `node:net` into the edge
bundle and **fails the build** with `UnhandledSchemeError`. This was verified,
not assumed — it is the same wall the earlier attempt recorded in CLAUDE.md hit.
(`node:net` in `client.ts` was also made a lazy import while fixing this.)

`keep_alive` (60 s) was added so a socket dropped by a NAT or by Supavisor
surfaces as an error the retry can handle rather than as a stall.

### FIXED — M8: catalogue caching (`catalogue.service.ts`)

Plans, VIP levels and deposit networks are now cached across requests with
`unstable_cache`, tagged `catalogue`, TTL 300 s as a backstop only.

Safe precisely because that data **belongs to nobody** — identical for every
visitor, no balance, no identity, no verification state. The CRM's three plan
mutations call the new `revalidateCatalogue()`, so an operator's edit appears on
the next request rather than up to five minutes later (a path revalidation does
not clear a tag-keyed entry).

**No user-scoped data is cached across requests, and none must be.** Balances,
allocations, KYC state and security data remain memoised *per request* only and
re-read on the next one — which is what keeps "an operator blocks an account and
it takes effect on their next request" true.

It degrades to an uncached read when Next's incremental cache is absent (scripts,
the scanner, the test suite), matched narrowly on that one invariant so real
database errors still propagate.

---

## Duplicate queries removed

**None were found, and this was checked rather than assumed.** Grouping
`pipeline_events` by correlation id after the change:

| real account queries per render | renders |
|---|---|
| 0 (fully memoised) | 15 |
| 1 | 108 |
| 2 or more | **0** |

Exactly one `users` lookup per render. The request-scoped `cache()` work
recorded in CLAUDE.md §16.2a is holding; the earlier duplication is genuinely
gone and did not regress.

---

## Authentication problems discovered

- **R3 above** — the one that matters, now fixed.
- The middleware still uses `getSession()` and authorizes nothing, which stays
  correct. It is now cheaper *relative* to the render, since the render no
  longer makes a network call of its own.
- No change was made to the login flow, the OTP/password paths, the callback,
  cookie handling or the gate. Sign-in works as it did.

---

## Verified failure scenarios

| scenario | result |
|---|---|
| Unauthenticated on every user route | 307 → `/login`, no 500 |
| Unauthenticated on `/admin`, `/admin/users` | 307 → `/admin/login` |
| **Forged/garbage session cookie** | 307 → `/login` (local verification rejects it) |
| Database blackholed — `/login` | **200 in 2,089 ms** |
| Database blackholed — `/`, `/wallet`, `/settings`, `/admin` | 500 with "Unable to load this information / Retry", bounded ~8 s |
| Database blackholed — internals leaked? | **No** — no SQL, no connection string, no stack trace |
| Fully dead database, read deadline | fails at ~12.2 s (two attempts), never hangs |
| Transient connection failure | recovered by retry; recorded as `database.connectRetry` |
| Permanent database error (constraint, syntax) | surfaced immediately, never retried |

---

## Remaining bottlenecks

### NOT FIXED — REQUIRES INFRASTRUCTURE ACTION: the application is ~200 ms from its database

This is now the dominant cost and **cannot be fixed in application code.**

A warm round trip is 173–268 ms. Every authenticated page needs at least two
sequential waves — resolve the account, then read the page's slices — because
the second depends on the first. That is a **~400–500 ms floor** before Next
renders anything, and it is why routes sit at 900–2,200 ms rather than the
500 ms target.

The fix is co-location: run the application in the database's region
(`ap-northeast-2`), or move the database to the application's. Nothing else
available in code will close this gap — the query itself already executes in
0.05 ms.

### NOT FIXED — REQUIRES SUPABASE ACTION: the unhealthy pooler endpoint

The retry routes *around* the fault; it does not repair it. One of three
endpoints intermittently accepts TCP and never completes the handshake, which is
a Supabase-side problem worth raising with them. Watch
`operation = 'database.connectRetry'` in `/admin/system-logs` to see how often it
is actually happening — that telemetry did not exist before this pass.

### PARTIALLY FIXED — per-section streaming

`loading.tsx` gives page-first rendering: the shell and a shaped skeleton appear
immediately and the content area streams in. Inner `<Suspense>` boundaries per
section were **not** added, because each page's reads already run as a single
parallel wave (`Promise.all` in `getUserSlices`), so splitting them would let
sections arrive at the same moment in three pieces instead of one. It becomes
worth doing if any page ever gains a genuinely slow independent section.

### NOT FIXED — no browser-based verification

Everything here was verified by HTTP request, database query and the built
output. The Chrome extension was not connected during this pass, so **the
loading and error states were not visually confirmed in a browser, and nothing
was checked at 360 px**. The markup is present in the build (verified by
string-matching the compiled output) and the components follow the existing
mobile-first primitives, but CLAUDE.md §12's "actually look at it" step is
outstanding. **M4** (no end-to-end browser tests) remains the right fix.

### Still open, unchanged

**M1** (unbounded list reads) is the one query-shape problem worth fixing next
and becomes a real issue as history grows. **M9** is largely resolved as a side
effect of the loading boundaries but was not explicitly tuned per link.

---

## Recommended next steps, in order of expected benefit

1. **Co-locate the application and the database.** Worth more than every code
   change in this pass combined — it attacks the ~400 ms floor directly.
2. **Raise the pooler endpoint with Supabase**, with the `database.connectRetry`
   counts as evidence.
3. **M1 — paginate the unbounded list reads** before any account has real
   history.
4. **M4 — Playwright over the production build**, which would close the browser
   verification gap noted above.
5. Consider a short-TTL cache for the `auth_user_id → users.id` mapping *only*
   if step 1 is impossible. It would remove one of the two waves, but it trades
   away the "a block takes effect on the next request" guarantee, so it is a
   deliberate trade and not a free win.

---

## Status summary

| item | status |
|---|---|
| Transient connection failures retried, safely and boundedly | **FIXED** |
| Deadline on every read path | **FIXED** |
| Auth-provider outage no longer signs users out | **FIXED** |
| Loading boundaries on every route | **FIXED** |
| Root and global error boundaries | **FIXED** |
| Sign-in page survives a database outage | **FIXED** |
| Connection pool pre-warming | **FIXED** |
| Catalogue cached across requests (M8) | **FIXED** |
| Internal errors never shown to users | **FIXED** |
| Duplicate queries | **none found** (already fixed previously, verified) |
| Missing indexes | **none** — the hot query executes in 0.05 ms |
| Navigation well under 500 ms | **NOT FIXED** — blocked by the ~200 ms RTT floor |
| Per-section streaming | **PARTIALLY FIXED** — not warranted yet |
| Unhealthy pooler endpoint | **REQUIRES SUPABASE ACTION** |
| ~200 ms application↔database distance | **REQUIRES INFRASTRUCTURE ACTION** |
| Browser/360 px visual verification | **NOT DONE** — extension unavailable |
