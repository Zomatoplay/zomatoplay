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

## H9 — `pipeline_events` has no retention and is already the largest table

**Was H5; now measured.** 28,464 rows, **10 MB** — larger than every business
table combined (`users` 256 kB, `transactions` 248 kB, `audit_logs` 192 kB).
1,529 rows written on 2026-09-13 alone, from one developer and a handful of
test runs. Nothing prunes it.

**Fix:** a scheduled delete by age (30–90 days), or partition by month. Note
`audit_logs` must **not** be pruned — it is evidence; `pipeline_events` is
diagnostics and the schema already says so.

**Complexity:** low. **Risk if ignored:** storage cost, then slow diagnostics
exactly when an incident needs them.

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

## H6 — Operator provisioning has no credential step

Unchanged. Creating an operator in the CRM writes an `invited` row with no
credential; linking a Supabase account still needs `npm run db:dev-accounts`.

---

# P2 — important

## M10 — `nextDisplayId()` is a wasted round trip and can collide

**NEW, 2026-09-13.** `src/server/auth/account.ts`:

```ts
const [row] = await tx.select({ max: t.users.displayId })
  .from(t.users).orderBy(t.users.displayId).limit(1);
void row;                                   // ← the query result is discarded
return `NT-${Date.now().toString().slice(-7)}`;
```

Three problems in six lines: the query runs on **every signup** and its result
is thrown away (a wasted round trip, ~200 ms); the doc comment claims it
"continues the seeded sequence" and it does not; and `display_id` carries a
**unique index** while the value is the last 7 digits of a millisecond clock,
which repeats every 10,000 s (~2.8 h). Two signups in the same millisecond, or
exactly 2.8 h apart to the millisecond, fail the whole registration with an
opaque constraint error.

**Fix:** either use the sequence the comment promises, or a random suffix wide
enough to make collision negligible — and delete the dead query either way.
**Complexity:** low.

## M1 — Unbounded per-user and per-platform list reads

Confirmed still open, and now specific:

- `listTransactionsForUser()` (`ledger.repository.ts:19`) has **no `LIMIT`** —
  it reads every transaction an account has ever had, on every wallet and
  transactions render.
- The CRM dashboard reads **all** users, **all** deposits, **all** withdrawals
  and **all** KYC rows (`admin/(console)/page.tsx`) and derives its counts in
  JavaScript.

Harmless at today's 36 users / 210 transactions. At 10,000 accounts the
dashboard loads the platform into memory on every view.

**Fix:** `LIMIT` + cursor pagination on the user list; `count(*)`/`sum()`
aggregates for the dashboard counters. **Complexity:** medium.

## M2 — CRM dashboard headline metrics and charts are fixtures

Still true, now precisely: the queue counts and the six recent-activity panels
read the database; the headline aggregates and the four chart series still come
from `@/data/admin/metrics` (`dashboard-view.tsx:45`). An operator reads real
queues beside invented totals with nothing marking the difference.

**Fix:** a reporting service with real aggregates — pairs naturally with M1.

## M3 — Test suite cannot exercise server actions

Unchanged. Services and repositories are covered; the `"use server"` layer —
where authorization lives — is only covered indirectly. `deposit-check.test.ts`
is the sole exception and shows the shape is possible.

## M4 — No end-to-end browser tests

Unchanged. Nothing exercises sign-in → deposit → allocate → settle in a browser.

## M12 — Instrumentation records bound query parameters in error text

**NEW, 2026-09-13, minor.** `redact()` strips connection strings, API keys and
JWTs from error messages, but driver errors quote the failing statement *and
its parameters*: `pipeline_events` now contains rows reading
`params: b0271b3e-…,1` — a user's `auth_user_id`.

Not a credential and not a secret, but it is account-identifying data in a
diagnostics table that an operator browses, and §22.2's rule is that
`metadata` carries named scalars rather than raw payloads. Extend `redact()` to
drop the `params:` tail of driver errors. **Complexity:** trivial.

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

1. **H4 + the three-cron problem** (a daily cron is a customer-visible defect
   on mainnet, and there are now three jobs on a plan that caps them)
2. **H9 + M12** (retention and redaction — cheap, and both get worse with time)
3. **Monitoring + backups** (the smallest work with the largest downside if skipped)
4. **H10**, then **M10**
5. **H1** (wrong-asset visibility)
6. **C3** (payout rail — the largest piece, and it depends on all of the above)

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

