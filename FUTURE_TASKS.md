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

# Critical

Security, financial correctness, data integrity, authorization, production
blockers.

### C1 — Referral commission is recorded but never paid

- **Problem.** Referral *relationships* are now captured and persisted
  (`referrals`, `users.referred_by_code`, `referral_accounts`). No commission is
  ever calculated or credited. The user-facing referral screen shows
  `earnedFromReferral` and a VIP commission percentage that no service computes.
- **Why it matters.** The product tells a user they earn a percentage. Nothing
  produces that money. That is a promise the system does not keep.
- **Current state.** Rates live in `src/data/referrals.ts` as data (VIP 1–3, two
  tiers). `creditCommission()` exists in `account-write.service.ts` and has no
  caller.
- **Recommended solution.** A commission service invoked on the events that earn
  it (a referred user's first deposit credit, and/or their allocation), writing a
  `commission_entries` row and a ledger entry in one transaction, with an
  idempotency key per (referral, triggering event) so a replay cannot pay twice.
- **Dependencies.** Investment/earnings engine (C2) for the "earns on profit"
  model; nothing for the "earns on deposit" model.
- **Complexity.** Medium.
- **Production safety.** Yes — it moves money.
- **Before launch.** Yes, or the referral programme must be removed from the UI.

### C2 — No investment earnings engine

- **Problem.** `recordInvestmentEarning()` exists, is transactional and has a
  unique `(investment_id, period_key)` guard. Nothing schedules it. Investments
  accrue nothing; the earnings screens report only what has settled, which is
  currently only seeded rows.
- **Why it matters.** The core product proposition — allocate, earn on a
  schedule — is not implemented. Users would see a static balance forever.
- **Current state.** Plans carry `rewardFrequency` (daily/weekly/monthly/on
  maturity) and an estimated return range. Maturity (`matureInvestment`) exists
  and is also unscheduled.
- **Recommended solution.** A scheduled job (cron/worker) that, per due period,
  computes the accrual, writes the earning + ledger entry + balance move in one
  transaction, keyed by `period_key`. It must be safe to run twice and safe to
  run late.
- **Dependencies.** A scheduler. Decide compounding vs non-compounding and
  document it (§ API_DOCUMENTATION "Earnings").
- **Complexity.** Large.
- **Production safety.** Yes.
- **Before launch.** Yes.

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

### C5 — A Supabase Auth outage silently signs everyone out

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

### C6 — Deposit attribution is manual and unverified against an intent

- **Problem.** One shared receiving address. A TRC-20 transfer carries a sender
  and nothing else, so an operator decides who it belongs to. There is no
  expected-amount or intent to check the transfer against.
- **Why it matters.** Crediting the wrong account is a loss, not a display bug.
  The current control is operator care.
- **Current state.** Deliberately safe: the scanner never sets `user_id`, the
  CRM offers no "best match", and the assignment is audited. See `CLAUDE.md`
  §18.4.
- **Recommended solution.** **Per-user deposit addresses** — the real fix, which
  makes attribution structural. A `deposit_addresses` table and resolving
  `to_address` through it at detection. Nothing in the schema blocks it. A
  deposit-intent system (expected amount + expiry) is a weaker intermediate step
  and is only safe combined with operator review.
- **Dependencies.** Address derivation/custody strategy — this is the hard part
  and it is a key-management decision, not a coding one.
- **Complexity.** Large.
- **Production safety.** Yes.
- **Before launch.** Yes for real funds; the current manual flow is acceptable
  only on testnet.

---

# High Priority

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
- **Current state.** The deposit screen now warns prominently against sending
  TRX (added in this pass). Nothing detects it if a user does anyway.
- **Recommended solution.** Scan the native-transaction endpoint as well and
  record wrong-asset arrivals as deposits with `status = 'ignored'` and a
  `failureReason`, so an operator can see them and arrange a refund. Do **not**
  credit them.
- **Dependencies.** None — same TronGrid client.
- **Complexity.** Small.
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

# Medium Priority

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

### M7 — Referral status never advances

New referrals are written with `status = 'registered'` and stay there.
`'active'` presumably means the referred user has funded or invested; nothing
sets it. Either drive it from a real event or remove the distinction. Small.

---

# Low Priority

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

Status as measured or inspected on 2026-08-24. "No" means not ready, not absent.

| Area | Ready | Notes |
|---|---|---|
| **Authentication** | Yes | Supabase Auth; password + optional email code; signup, confirmation callback, password reset all verified working. C5 (outage handling) outstanding. |
| **Database** | Yes | PostgreSQL 17 via session pooler. 32 tables, 41 enums, 26 FKs, 102 indexes verified against the declared schema. Migrations generated and checked in. |
| **Authorization** | Yes | User data scoped to the session; no action accepts an identity. Operator permissions graded and enforced server-side. Verified: a customer session is refused by the CRM. |
| **KYC** | Yes | Full lifecycle persisted and audited; user and CRM read the same row. No provider integration (by design). |
| **Deposits** | **No** | Detection, verification, finality, idempotency and ledger crediting all work and are proven. Attribution is manual (C6) and wrong-asset arrivals are invisible (H1). Scanner unscheduled (H4). |
| **Withdrawals** | **No** | Request/approval lifecycle correct and audited; balance genuinely held and returned. No payout rail (C3). |
| **Investments** | Partial | Creation is transactional and correct. No accrual or maturity engine (C2). |
| **Earnings** | **No** | Reads real ledger rows per account. Nothing generates them (C2). |
| **Referrals** | Partial | Attribution now captured through signup, immutable, self-referral refused. No commission (C1). |
| **Admin** | Partial | Authenticated, permission-checked, all writes transactional and audited. Provisioning incomplete (H6); dashboard headline metrics are fixtures (M2). |
| **Blockchain** | Partial | Shasta only, read-only, idempotent, finality-gated. Verified end to end against a real transfer. Unscheduled (H4); wrong-asset blind spot (H1). |
| **Logging** | Yes | Correlation-ID traces spanning client → server → database → external → blockchain, buffered and written after the response. Verified: no secrets in the table. Retention missing (H5). |
| **Security** | Partial | No plaintext credentials anywhere; no service-role key; ledger-only balance changes; idempotency by database constraint. C4 and C5 outstanding. |
| **Performance** | **No** | 1.6–2.7s warm navigation against a 500–800ms target. Dominated by ~200ms round-trip latency to a distant region (H2). No loading UI (H3). |
| **Backups / recovery** | **No** | Not configured or tested. Supabase provides automated backups on paid tiers; no restore has ever been rehearsed. Do not launch without a tested restore. |
| **Testing** | Partial | 107 automated tests pass, including live-database integration. No browser end-to-end coverage (M4); server actions untested directly (M3). |
| **Monitoring** | **No** | `pipeline_events` supports diagnosis after the fact. No alerting, no uptime checks, no error aggregation, nothing watching `consecutive_failures`. |
| **Deployment** | **No** | Never deployed. No CI, no staging environment, no migration-on-deploy step, no rollback procedure. |

**Summary.** The application is coherent and internally consistent: identity,
authorization, transactional integrity, audit and observability are real and
verified. It is **not** production-ready, and the blockers are concentrated in
three places — money that cannot actually move (C2, C3), deposit attribution
(C6, H1), and the absence of any operational apparatus (backups, monitoring,
deployment).
