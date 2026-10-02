# Zomato Play — server interface

Every way the browser can reach the server, and what each one is allowed to do.

There is no REST API. Zomato Play is a Next.js App Router application: reads happen
in Server Components through the service layer, and writes happen through Server
Actions. This document is the contract for both.

Companion documents: `CLAUDE.md` (architecture and rules), `CHANGELOG.md`
(what actually happened, newest first).

---

## 1. The two chains

Nothing bypasses these. A mutation that skips a step is a bug, not a shortcut.

**User action**

```
UI (client component)
  → server action                     "use server"
  → getAuthenticatedAccount()         verified Supabase session → public.users
  → service                           business rules, re-checked server-side
  → mutate()                          one transaction + its audit entry
  → revalidate()                      the user's pages AND the CRM's
  → router.refresh()                  the client re-reads; no optimistic state
```

**Operator action**

```
CRM (client component)
  → server action                     "use server"
  → requirePermission(area)           session → admin_agents → stored grant
  → service
  → mutate()                          one transaction + its audit entry
  → revalidate()                      the CRM's pages AND the user's
  → router.refresh()
```

Two rules follow from the shape, and they are the ones worth remembering:

- **No action takes an identity.** Not a `userId`, not an `agentId`, not a role.
  Every one of them resolves the caller from the session. There is nothing to
  forge because there is no parameter to forge.
- **No action takes a decided amount.** A withdrawal request sends an amount and
  a destination; the fee, the payout rate and the net INR are computed
  server-side from `@/constants/app`. A request body carrying `totalFeeUsdt: 0`
  would otherwise be honoured.

---

## 2. Authentication

Supabase Auth owns credentials entirely. `public` stores no password, hash,
one-time code or token, and a test asserts no column is named like one.

```
auth.users.id  ──unique──▶  public.users.auth_user_id      customers
               ──unique──▶  admin_agents.auth_user_id      operators
```

The two lookups are independent. A principal can be a customer, an operator,
both or neither; signing in at `/login` grants nothing in the CRM, and an
operator account is not automatically a customer account. There is deliberately
no `role` column on `public.users` — that would put every customer row one
`UPDATE` away from being an administrator.

### Routes

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/login` | page | none | Password sign-in; one-time code as an alternative |
| `/signup` | page | none | Name, email, password, confirmation |
| `/forgot-password` | page | none | Requests a Supabase recovery email |
| `/reset-password` | page | recovery session | Sets a new password |
| `/auth/callback` | GET | none | **Exchanges every emailed credential for a session** |
| `/complete-profile` | page | session | Name and phone, once |
| `/admin/login` | page | none | Operator sign-in |

`/auth/callback` is the one that did not exist and had to. Sign-up
confirmations, magic links and recovery links all carry a single-use credential
in the URL and all need somewhere to spend it. Without the route, Supabase's
redirect landed on `/`, the app found no session, bounced to `/login`, and the
credential expired unused — the "access denied / OTP expired" loop. It handles
both link shapes Supabase emits (`?code=` for PKCE, `?token_hash=&type=` from
the verify endpoint), because which one arrives depends on an email template
this application does not control.

`type=recovery` is routed to `/reset-password` rather than treated as a sign-in:
that session exists to set a password, and dropping somebody into the app
mid-recovery would leave them thinking their password had changed.

### Server actions

| Action | Module | Takes | Returns |
|---|---|---|---|
| `completeSignIn` | `(auth)/login/actions` | `{ next? }` | `{ ok, message, redirectTo }` |
| `saveProfile` | `(auth)/complete-profile/actions` | `{ fullName, phone, country? }` | `{ ok, message }` |
| `signOutAction` | `(app)/settings/actions` | — | redirects |
| `completeOperatorSignIn` | `admin/login/actions` | — | `{ ok, message }` |
| `signOutOperator` | `admin/login/actions` | — | redirects |

`completeSignIn` runs *after* Supabase has written a session cookie. It resolves
or creates the `public.users` row, refuses a blocked/suspended/deactivated
account (ending the session rather than hiding it behind a redirect), records
the sign-in, and returns where to go.

**Linking by email.** A `public.users` row carrying the verified email with no
`auth_user_id` is adopted rather than duplicated. Safe *only* because Supabase
has just proved control of that mailbox — verify first, link second. The reverse
order would be an account-takeover primitive.

---

## 3. Authorization

### Customers

A signed-in user can reach exactly their own rows. Every service resolves the
account from the session and scopes its query by it; no route or action accepts
an id from the browser. Changing a value in a URL reaches somebody else's data
in exactly one place — `/admin/users/[id]` — which is behind the operator gate.

`(app)/layout.tsx` is the gate: no session → `/login`; a blocked, suspended or
deactivated account → `/login`; a session with no name or phone yet →
`/complete-profile`. Re-checked on every request, and `force-dynamic` so no
account's data is ever prerendered into a static file.

The middleware refreshes the session cookie and **decides nothing**. Middleware
as the security boundary is how an application ends up protected only where
somebody remembered to add a matcher.

### Operators

Graded permissions — `none` / `view` / `manage` — over 13 areas, stored in
`admin_agent_permissions` and enforced by `requirePermission()` on the server.
A master admin holds `manage` implicitly; the role is the grant.

```ts
const operator = await requirePermission("withdrawals");   // throws otherwise
await rejectWithdrawal({ withdrawalId, reason }, operator.actor);
```

`canManage()` in the client disables buttons. That is an affordance so an honest
operator can see what they may do. **It is not the boundary**, and every action
re-checks server-side regardless of what the UI allowed.

---

## 4. User-facing server actions

All resolve the account from the session. All return `{ ok, message }` plus
whatever the caller needs.

### Verification

| Action | Module | Effect |
|---|---|---|
| `startKycAction` | `(app)/settings/kyc/actions` | `not_started` → `in_progress` |
| `submitKycAction` | same | Writes the submission, documents and `pending_review` |

`submitKycAction` performs the **only** transition a user may cause. `verified`
is unreachable from it at any input. It returns a `correlationId` that ties the
click to its rows in the CRM's system log.

### Money

| Action | Module | Effect |
|---|---|---|
| `createInvestmentAction` | `(app)/plans/actions` | Allocation + ledger entry + balance + plan aggregate + referral accrual, one transaction |
| `endAllocationAction` | same | Returns an open-ended allocation's principal |
| `requestWithdrawalAction` | `(app)/wallet/withdraw/actions` | Withdrawal record + immediate balance hold |
| `requestTestDeposit` | `(app)/wallet/deposit/actions` | **Development only.** A `pending`/`unverified` row. No ledger entry. |
| `acknowledgeDepositAction` | same | Marks one **credited** deposit seen. Moves no money. |

`createInvestmentAction` takes a plan id and an amount and **no rate**. The
applicable band is resolved server-side from `plan_rate_tiers` inside the
allocation's own transaction, and the resolved rate comes back on the result so
the receipt shows what was charged rather than what the form computed. A client
cannot submit `amount=50, rate=99` because there is no parameter to put 99 in.

`acknowledgeDepositAction` puts ownership, `status = 'credited'` and
`acknowledged_at is null` in the `UPDATE`'s `WHERE`, so a forged deposit id
matches no row, it can never credit or advance anything, and calling it twice
is a no-op.

`requestTestDeposit` refuses outside development and is deliberately incapable
of becoming money: `assignDepositToUser` accepts only `confirmed`, which only
the scanner sets.

### Account

| Action | Module | Effect |
|---|---|---|
| `updateProfileAction` | `(app)/settings/account-actions` | Name and phone. **Not email.** |
| `setSecondFactorAction` | same | Persists a 2FA *preference* |
| `recordPasswordChangeAction` | same | Records the event; the change itself is Supabase's |
| `setNotificationPreferenceAction` | same | Upserts one category |
| `addBankAccountAction` | same | Masks the account number server-side |
| `addWalletAddressAction` | same | Saves a labelled USDT address |

Email is read-only throughout. It is the Supabase sign-in identifier and the
address a verification link proved control of; letting a profile form rewrite it
would leave the two authorities disagreeing and could re-point an account at an
unverified mailbox.

The password is changed by the browser calling Supabase directly, after
re-authenticating with the current password — `updateUser` alone does not
require the old one, so requiring it is the screen's job. The password never
passes through this application.

---

## 5. Operator server actions

All in `src/app/admin/actions.ts` — one module, outside the `(console)` route
group so its import path is stable. Every one begins with `requirePermission`.

| Action | Permission | Effect |
|---|---|---|
| `approveKycAction` | `kyc` | `approved` + `users.kyc_status = verified` |
| `rejectKycAction` | `kyc` | `rejected` + reason (**required** — the user is shown it) |
| `requestKycResubmissionAction` | `kyc` | Back to `in_progress` with a reason |
| `addKycNoteAction` | `kyc` | Internal note |
| `assignDepositAction` | `deposits` | Attributes **and** credits: ledger + balance |
| `creditDepositAction` | `deposits` | Credits an already-attributed confirmed deposit |
| `failDepositAction` | `deposits` | Closes as failed; reason shown to the account |
| `ignoreDepositAction` | `deposits` | "Not ours" — internal, reversible |
| `reopenDepositAction` | `deposits` | Returns an ignored deposit to the queue |
| `approveWithdrawalAction` | `withdrawals` | Records a decision. **Pays nobody.** |
| `rejectWithdrawalAction` | `withdrawals` | Returns the held balance as a ledger entry |
| `markWithdrawalPaidAction` | `withdrawals` | Records that money was sent by other means |
| `setUserStatusAction` | `users` | active / blocked / suspended / deactivated |
| `setUserRestrictionAction` | `users` | Freeze account / withdrawals / investments |
| `updateUserAction` | `user_details` | Name, phone, country, internal note. **Not email.** |
| `revokeUserSessionAction` | `security` | Marks device sessions revoked (see below) |
| `sendUserPasswordResetAction` | `security` | Supabase emails a reset link |
| `resetUserTwoFactorAction` | `security` | Clears 2FA preferences |
| `createPlanAction` / `updatePlanAction` / `setPlanDisabledAction` | `plans` | The catalogue the public app reads |
| `savePlanTiersAction` | `plans` | Replaces a plan's whole rate ladder, validated server-side, in one transaction |
| `previewPlanTierAction` | `plans` (`view`) | Prices a test amount through the same function a real allocation uses. Writes nothing. |
| `addDepositAddressAction` | `deposits` | Adds an operator-provided address to the pool. Base58 checksum verified server-side. |
| `createAgentAction` / `updateAgentAction` / `setAgentDisabledAction` | `agents` | Operator directory and grants |
| `sendAgentPasswordResetAction` | `agents` | Supabase emails a reset link |
| `sendNotificationAction` | `notifications` | Campaign row + one `notifications` row per matched account |
| `updateSettingsAction` | `settings` | Platform configuration |

Three of these say less than their names suggest, on purpose:

- **`revokeUserSessionAction`** marks a *description* of a session revoked. It
  does not invalidate a Supabase refresh token — that needs the service-role
  key, which this application deliberately does not hold. The browser holding
  that session keeps working until its token expires. The action's own message
  says so. Faking the other way would let an operator believe an account had
  been secured when it had not.
- **`approveWithdrawalAction` / `markWithdrawalPaidAction`** move a status. There
  is no payout rail; `payoutReference` is whatever the operator types.
- **`sendNotificationAction`** delivers in-app only. There is no email or push
  transport, and the returned message says how many accounts were written to
  rather than claiming a send.

---

## 6. Reads

Application code calls **services**. Never repositories, never `getDb()`, never
`@/data` records.

```
page / layout (Server Component)
  → src/server/services/*.service.ts
  → src/server/repositories/*.repository.ts     tables → domain types
  → src/db/schema → PostgreSQL
```

### The fallback, and where it stops

`fromDatabase()` returns seed data when `DATABASE_URL` is unset — chosen by
configuration, never by failure. If the URL is set and the query throws, the
error propagates.

It applies to **catalogue and platform reads only**: plans, deposit networks,
VIP levels, and the CRM's platform-wide lists. That data belongs to nobody, so
serving the sample dataset shows no one anybody else's figures.

It does **not** apply to any user-scoped read. `account.service`,
`referrals.service` and `earnings.service` refuse rather than fall back, because
the seed data describes one specific person and serving it to whoever is asking
is showing them someone else's balance. A database outage fails visibly, which
is the point.

`getPipelineEvents()` has no fallback either, for a different reason: it reports
what the system did, so an empty list is the truthful answer and a fixture would
make the one screen that exists to diagnose problems the one screen guaranteed
to be fiction.

### Per-page reads in the CRM

The console layout reads only the shell (platform settings, operator
directory). **Each page reads its own slice.** This is not only a performance
decision: Next.js re-renders only the changed route segments on a client
navigation, so a layout does not run again — data read there is frozen at the
moment the console was opened, which is why a verification case submitted a
minute later did not appear until a hard reload.

---

## 7. Lifecycles

### KYC

```
not_started → in_progress → pending_review → verified
                                           → rejected              (reason required)
                                           → in_progress           (resubmission)
```

User causes only the transition into `pending_review`. Everything past it is an
operator decision, written server-side and audited. The CRM and the user
application read the same `kyc_submissions` row and the same
`users.kyc_status`.

### Deposit

```
TRON Shasta transfer
  → TronGrid                      contract, recipient and direction filtered locally
  → solidified?                   /walletsolidity/getnowblock
  → deposits row, status=confirmed
       ↓
  recipient resolves in deposit_addresses (assigned + owned)?
       │                                    │
      yes                                   no
       │                                    │
  ledger entry + wallet balance +   user_id stays NULL — operator
  status=credited, automatically    assigns in /admin/deposits, then
  (one transaction)                 the same ledger-entry step
```

**Getting an address.** `getOrCreateDepositAddress(userId, network, actor)` —
called only from a server action that resolves `userId` from the session,
never from a client-supplied value — returns the caller's existing pool
assignment if one exists, or atomically claims one `available` row from
`deposit_addresses` and assigns it. Same user, same address, every time it is
asked; nothing ever reassigns one automatically (not a page close, not a
session end, not time passing) — only an explicit, guarded operator action
(`releaseDepositAddressAction`) does, and it refuses while any deposit against
that address is still unresolved.

**Attribution.** A transfer's recipient address is looked up in
`deposit_addresses`. Resolved to an `assigned` row with an owner: credited
immediately, through the same `ensureWallet` + ledger-entry path an operator's
manual assignment uses — there is one financial mutation path, not two.
Unresolved (the legacy shared address, or a pool address nobody currently
holds): recorded exactly as before, `user_id` stays `NULL`, and an operator
attributes it by hand. The scanner and the attribution step never guess; a
recipient not in the pool is not credited to anyone.

Idempotency is a unique index on `(chain, tx_hash)`, not a prior `SELECT`. The
scanner's cursor (one per watched address) is an optimisation; losing it is
harmless. No mnemonic, seed, extended private key or any signing material is
generated, derived, stored or logged anywhere in this pipeline — every pool
address is configured by the operator, from their own wallet tooling; see
CLAUDE.md §18.8 for the key-custody reasoning and what real address derivation
would still require.

### Investment

```
pending → active → matured
                 → cancelled
```

Creating one is a single transaction: the investment row, a negative ledger
entry, the balance move (`available` down, `totalInvested` and
`lockedInInvestments` up), the plan's aggregate and the referral accrual.
Guards — verified account, allocations not frozen, plan open, within min/max,
sufficient balance, and a rate band covering the amount — are all re-checked
server-side against the rows, not against what the browser believed.

**The rate is resolved, never supplied.** If the plan has a ladder
(`plan_rate_tiers`), the band whose half-open `[min, max)` range contains the
amount decides the rate; if it has none, the plan's own
`estimatedReturnPercent` does; if it has a ladder and no band covers the
amount, the allocation is **refused** rather than quietly sold at the headline
rate. The band's id, bounds and rate are then copied onto the investment row
(`applied_tier_*`, `applied_rate_percent`), so a later edit to the ladder never
reprices an allocation already made — and a band that is deleted takes no
evidence with it, because those columns are a copy and not a foreign key.

### Referral commission

```
accrued (pending, release_at stamped) → credited
                                      → reversed
```

Accrual happens inside `createInvestment`'s own transaction — two tiers, at the
beneficiary's VIP rate — and credits nobody. Each entry carries a `release_at`
computed there from `platform_settings.referrals.payoutDelayDays`, snapped to
midnight on the business calendar (`Asia/Kolkata`, UTC+05:30).

`GET/POST /api/cron/release-commissions`, scheduled `30 18 * * *` UTC (00:00
IST), pays every `pending` entry whose `release_at` has passed. Eligibility is
`release_at <= now` and **not** "became due since the last run", so a missed
midnight is late rather than lossy. A null `release_at` — an entry accrued
before the schedule existed — is never due; an operator releases those by hand.

Manual release (`releaseCommissionAction`, `referrals` permission) calls the
same `releaseCommission()` the job does. The status transition is asserted in
the `UPDATE`'s own `WHERE`, so the job running twice, two passes overlapping,
and the job racing an operator all pay exactly once.

### Withdrawal

```
pending → approved → processing → paid
        → rejected                          (reason required; balance returned)
```

Requesting debits the wallet immediately, so one balance cannot back two
requests. Rejecting returns it **as its own ledger entry**, so the history shows
the hold and its reversal rather than a balance that silently came back.

### Earnings

Read from the ledger: settled `reward` and `referral` credits, bucketed by the
day and month they were credited.

- **Rate and basis** — a plan's `estimatedReturnPercent` is the rate the
  platform actually pays. `createInvestment` computes the total scheduled
  profit once, from the plan's rate at the moment the allocation is made, and
  stores it as `investments.projectedProfit` — a snapshot, not a live formula,
  so a later edit to the plan's rate never reaches an allocation already sold.
  Non-compounding: every period's share is a fixed fraction of that original
  total, never of a principal a previous period enlarged.
- **Period** — the plan's own `rewardFrequency` (`daily` / `weekly` / `monthly`
  / `on_maturity`), read by the engine rather than assumed. The number of
  periods is `ceil(durationDays ÷ periodDays)` — a whole number, so the term's
  last few days are still a real, paid period rather than a remainder nobody
  covers — and the final period is always due exactly at `maturesAt`.
- **Rounding** — `splitEvenly()` (`@/db/money`) divides the total into exact
  shares using integer arithmetic on the schema's smallest unit (BigInt, no
  floating point anywhere in the computation); the last period absorbs
  whatever the others' truncation leaves, so every period sums back to exactly
  the total sold, to the last decimal place.
- **Compounding** — none. Rewards credit `available`; they are not re-invested,
  and the schedule is computed once, from the original principal.
- **Maturity** — returns the principal from `lockedInInvestments` to
  `available`, as a ledger entry, after crediting the term's final earning
  period.

**Rendering a page never creates an earning.** These are reads. Crediting is
`GET/POST /api/cron/settle-investments`, authorised by `CRON_SECRET` on the
same schedule as the deposit scanner. Per pass, in order: every fixed-term
allocation's due-but-uncredited periods are credited via
`recordInvestmentEarning()` (unique on `(investment_id, period_key)`, so a
replayed or overlapping run cannot pay twice), then allocations past
`maturesAt` are matured, then the display schedule (`nextRewardAt` /
`nextRewardAmount`) is refreshed for everything still running. A missed run is
safe: each period is selected on its own due date, not on a run having
happened, so a long gap is caught up in the next pass rather than losing what
was missed. **Flexible Reserve (`durationDays: 0`) is excluded from this
engine entirely** — an open-ended allocation has no total profit *over* a
term, so there is no schedule to credit it against; it remains withdrawable in
full, on request, exactly as before.

**Plan rate changes are recorded, not silent.** `plan_rate_history` gets a row
— previous rate, new rate, effective timestamp, the operator who changed it —
every time `/admin/plans` saves a different `estimatedReturnPercent`. It is an
audit trail, not an input to the engine: a running allocation reads its own
`projectedProfit`, never the plan's current rate, so the change reaches only
allocations created after it.

---

## 8. Observability

Two tables, two questions.

| | `audit_logs` | `pipeline_events` |
|---|---|---|
| Answers | Who decided what | What the system did |
| Written | Inside the caller's transaction | Outside it |
| On rollback | Disappears with the decision | **Survives** — the failure is the point |
| Lifetime | Evidence; kept | Diagnostics; prunable |
| Failure to write | Fails the operation | Swallowed |

`pipeline_events` carries a **correlation id** generated once per action (via
`AsyncLocalStorage`, so nested services inherit it without a parameter on every
signature) and a measured duration. "What happened when I clicked Submit KYC"
is one filter in `/admin/system-logs`.

Instrumented today: `auth.sign_in`, `kyc.submit`, `kyc.approve`, `kyc.reject`,
`deposit.assign`, `chain.scan`, `investment.create`, `withdrawal.request`,
`withdrawal.approve`, `withdrawal.reject`, `email.password_recovery`.

**Never recorded:** passwords, access or refresh tokens, session cookies, the
Supabase service-role key, the TronGrid API key, private keys, whole account
numbers, document numbers. `metadata` takes named scalars only, and error text
passes through `redact()` — driver errors quote the connection string they were
given, and a log an operator browses is not the place for one.

---

## 9. Error handling

Errors are explicit. Nothing falls back to mock data, credits a balance,
approves a verification or reports success it did not achieve.

| Condition | Result |
|---|---|
| Not signed in | `{ ok: false, message: "Not signed in." }` |
| No operator session | `{ ok: false }` — never "assume master admin" |
| Insufficient permission | `{ ok: false }` naming the area and level |
| Invalid state transition | Refused by a `WHERE` clause, reported |
| Insufficient balance | Refused by `WHERE available + delta >= 0` |
| Duplicate chain transaction | Refused by `unique (chain, tx_hash)` |
| Database unavailable | The error propagates; a user-scoped read never substitutes seed data |
| TronGrid failure | Scanner records the failure and does **not** advance its cursor |
| KYC write fails | The user is told the submission failed |

An empty TronGrid list and a rate-limited response must never look alike: every
failure path in `@/server/tron` throws, because a scanner that read a
rate-limit as "nothing new" would advance past transfers it never saw.

---

## 10. Environment

Full annotated list in `.env.example`. Classification:

**Browser-safe** (`NEXT_PUBLIC_*`, inlined into the client bundle)

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or the older `..._ANON_KEY`)

**Server-only** — never `NEXT_PUBLIC_`, never logged

- `DATABASE_URL`, `DIRECT_DATABASE_URL`
- `TRON_GRID_API_KEY` / `TRONGRID_API_KEY`
- `TRON_USDT_CONTRACT`, `TRON_PLATFORM_DEPOSIT_ADDRESS`, `TRON_NETWORK`

**Local development only**

- `DEV_ADMIN_EMAIL` / `DEV_ADMIN_PASSWORD`, `DEV_TEST_EMAIL` /
  `DEV_TEST_PASSWORD` — read by `npm run db:dev-accounts`, never at runtime
- `DATABASE_FORCE_IPV4`, `DATABASE_POOL_MAX`, `DATABASE_QUERY_TIMEOUT_MS`

**Not used, and must not be added**

- The Supabase **service-role key**. It bypasses row-level security, so a copy
  in the browser is a copy of the database. Nothing here needs it; privileged
  work runs server-side over `DATABASE_URL`, a separate credential. Its absence
  is why session revocation is honest about what it cannot do.

**Configured in the Supabase dashboard, not here**

SMTP host, port, user, password and sender (Authentication → Emails → SMTP).
Keeping them in Supabase means this application never holds them and cannot leak
them. The built-in sender is rate-limited to a handful of messages per hour and
is for development only. SMTP is email; mobile one-time codes would need an SMS
provider, which is a different integration entirely.
