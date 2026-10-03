# CLAUDE.md — Zomato Play

**Read this file before making any change to this project.**

Durable rules and constraints. History belongs in `CHANGELOG.md`; deferred work
in `FUTURE_TASKS.md`. **Section numbers are referenced from source comments — do
not renumber them.**

---

## 0. Two applications, one codebase

| | User application | Master CRM |
|---|---|---|
| Routes | `/`, `/plans`, `/wallet`, `/referral`, `/settings` | `/admin/*` |
| Source | `src/app/(app)/`, `src/components/{home,plans,wallet,referral,settings}/` | `src/app/admin/`, `src/components/admin/` |
| Shell | `AppShell` — bottom nav, mobile-first | `AdminShell` — sidebar, desktop-first |
| State | `src/lib/prototype-store.tsx` | `src/lib/admin-store.tsx` |
| Data | `src/data/` | `src/data/admin/` |
| Priority | **Mobile-first** (§7) | **Desktop-first**, usable at 360px |

Neither imports the other's shell, navigation or store. Shared ground:
`components/ui`, `components/shared`, `lib/currency`, `lib/utils`,
`utils/format`, `src/types`, `data/referrals`. §1–§14 describe the user
application unless stated; §15 covers the CRM.

---

## 1. What this application is

A **mobile-first crypto investment platform**. A user funds an account in USDT,
allocates into managed plans, tracks profits and rewards, refers others for
commission, and withdraws to an Indian bank account in INR. It should feel like
a modern consumer **finance app** — calm, spacious, legible.

**It is NOT a cryptocurrency exchange.** Do not build, and do not let scope creep
introduce: buy/sell trading or swaps, trading pairs, order books, depth charts,
futures, margin, leverage, a trading terminal, candlestick/exchange-style charts,
or a USDT trading interface. If a request implies any of these, stop and clarify.

---

## 2. Current project scope

- **Customers sign in with Firebase phone OTP** (§19.7); the old Supabase email
  sign-in is switched off unless `LEGACY_EMAIL_SIGN_IN=true` (a migration window
  for linking a verified number). No demo account, no automatic sign-in (§19).
  **Operators sign in with a mobile number and an SMS code (Firebase), to a
  number a master admin provisioned** (§20); `/admin` is closed without an
  operator session. Email sign-in no longer reaches the console.
- **Reads and writes both go to PostgreSQL, in both applications.** The client
  stores are read caches. Every mutation is a server action → service → one
  transaction → audit entry → revalidation.
- **Deposits go to ONE configured address and are bound by deposit requests**
  (§18.4): a transfer matching exactly one request's exact amount and time window
  is credited automatically, by the scanner or by a customer's submitted
  transaction hash; everything else waits for an operator.
- **Every mutation is traceable** via `pipeline_events` (§22).
- **Customer support on Telegram is configured in the CRM**, not the
  environment: Admin → Settings → Customer support →
  `updateSupportTelegramAction` (`settings` / `manage`, audited), stored as a
  bare username in `platform_settings.platform.supportTelegram`, read by
  `getSupportTelegramUrl()` (catalogue cache; the save drops the tag).
  Validated on write and again on read by `@/lib/support`, so the button can
  only ever open `t.me`. The general settings form never sees or writes that
  key (the mapper strips it; the save carries the stored value over in SQL).
- **The application still runs with no database.** With `DATABASE_URL` unset,
  catalogue and platform reads return the seed modules in `@/data`. User-scoped
  reads and every write refuse instead — deliberate (§16.3).

**Intentionally not implemented:** outbound blockchain of any kind (§18.1); real
withdrawals or a payment gateway (§17.4); server-side session revocation for
operators (§19.6); per-user deposit addresses (removed, §18.8); an automated KYC
provider (§23); notification delivery beyond in-app.

Search for `INTEGRATION POINT` — each marks a seam where a real service replaces
mock behaviour.

---

## 3. Technology stack

| Concern | Choice |
|---|---|
| Framework | Next.js 15 (App Router) |
| UI runtime | React 19 |
| Language | TypeScript (strict) |
| Styling | Tailwind CSS v4 (CSS-first config, no `tailwind.config`) |
| Components | shadcn/ui primitives, hand-maintained in `src/components/ui/` |
| Icons | lucide-react |
| Toasts | sonner |
| Animation | `motion` — only where it genuinely helps |
| Fonts | `next/font` (Geist Sans + Geist Mono) |
| QR codes | `qrcode`, **server-side only** |
| Customer auth | `firebase` (browser, phone OTP only) + `firebase-admin` (server, ID-token verification only — no key) |
| KYC storage | `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`, **server-side only** |
| Database | PostgreSQL 17 (Supabase, session pooler) |
| ORM | Drizzle ORM, driver `postgres` (postgres.js) |
| Migrations | `drizzle-kit` — generated SQL, checked in under `drizzle/` |
| Scripts | `tsx` + `dotenv` |
| Tests | `node:test` via `tsx --test` |

Import alias `@/*` → `src/*`; no deep relative paths. **Do not add dependencies
without a clear need.**

---

## 4. Project architecture

### 4.1 The server/client split — the most important rule

Pages are **Server Components** by default. Client components exist only where
interaction or mutable account state requires them.

- **Server** — page shells, headers, static catalogue content, anything derived
  purely from `@/data`.
- **Client** — components reading or mutating a store, and components with local
  UI state (filters, tabs, sheets, multi-step flows).

Containers binding a store to presentational components are suffixed `…Live` or
live in a `*-sections.tsx` / flow file. Presentational components (`BalanceCard`,
`StatTile`, `InvestmentCard`, `TransactionItem`, `PlanCard`, …) carry **no**
`"use client"`, so either side can use them.

### 4.2 Client state — read caches, not sources of truth

`prototype-store.tsx` and `admin-store.tsx` are **caches**. Neither holds a
business-state action; neither has a reducer.

- Seeded by the server and passed in as a prop.
- **Every mutation is a server action**, reporting the server's own message, then
  `router.refresh()`. **No optimistic update on anything financial** — latency
  costs less than a confident screen that disagrees with the database.
  `useOptimistic` appears in exactly two places (a notification toggle, a 2FA
  preference) where being briefly wrong costs nothing.
- They re-sync when the server sends new data. `useReducer` ignores a changed
  initial state, which is why a write used to leave the screen stale.

**The CRM's store is deliberately split in two.** `AdminStoreProvider` sits in
the console layout (operator session + shell); `AdminDataProvider` sits in each
*page* (that page's slice). Next re-renders only changed route segments on a
client navigation, so a layout does not run again and anything read there is
frozen at the moment the console opened — which is what made a newly submitted
KYC case invisible until a hard reload. **This is the single most important thing
to preserve here.**

**`AdminShellData` is one row — platform settings — and nothing else.** If you
find yourself adding a slice to it, put it on the page instead.

### 4.3 Data layer

- `src/data/` — **seed data**, shaped like a real API payload. Input to the
  database seed (§16) and the fallback when no database is configured. Not read
  directly by pages or stores.
- `src/server/` — the **service layer** (§16). What application code calls.

Components may import from `@/data` for **presentation vocabulary** only —
`rewardFrequencyLabels`, `riskDescriptions`, `depositStatusLabels`,
`auditActionLabels`, FAQ and legal copy. **If it is a record, it comes from a
service.**

### 4.4 Currency — single source of truth

**Never convert or format currency inside a component.**
`src/constants/app.ts` holds the mock rates; `src/lib/currency.ts` owns
`getUsdtInrRate()`, conversion and all formatting;
`components/shared/currency-display.tsx` (`CurrencyDisplay`) is what every screen
renders an amount with. The rates are **administrator-configured** (§29): the
constants are only the initial values, and `getUsdtInrRate()` returns whatever a
layout last passed to `setFxRates()`. To integrate a live rates API, change
**only** where those values come from (`getPlatformFinance`).

---

## 5. Folder structure

```
src/
  app/
    layout.tsx              Root document only — fonts, skip link, Toaster.
                            Carries NO shell: each area brings its own.
    not-found.tsx           Global 404 (wraps itself in AppShell)
    globals.css
    (app)/                  ── USER APPLICATION (route group, no URL segment)
      layout.tsx            PrototypeStoreProvider + AppShell
      page.tsx              Home
      plans/                Plans + [slug] detail
      wallet/               Wallet, deposit, withdraw, transactions
      referral/             Referral
      settings/             Settings + subpages (kyc, security, wallet,
                            investments, notifications, language, support,
                            legal/[document])
      error.tsx
    admin/                  ── MASTER CRM (§15)
  components/
    ui/                     shadcn/ui primitives — shared by both applications
    navigation/             AppShell, BottomNavigation, DesktopSidebar, TopBar
    shared/                 CurrencyDisplay, StatTile, InfoRow, SectionHeader,
                            StatusBadge, EmptyState, TransactionItem, ListRow,
                            CopyField, QrCode, EarningsChart, PageHeader, notices
    home/  plans/  wallet/  referral/  settings/     Section-specific
    admin/                  Master CRM components (§15)
  constants/                app.ts, navigation.ts (the 5 tabs), admin.ts
  data/                     user, plans, investments, transactions, referrals,
                            notifications, support;  admin/ for CRM mock data
  hooks/                    use-copy-to-clipboard, use-mounted
  lib/                      utils (cn), currency, qr (server-only),
                            prototype-store, admin-store, admin-permissions,
                            business-time, admin-list-query
  types/                    index.ts (user domain), admin.ts (CRM domain)
  utils/                    Pure formatters with no app knowledge

  db/                       ── DATABASE (framework-agnostic, no Next imports)
    schema/                 Tables, enums, relations, shared column builders
    seed/                   Development seed + its test
    scripts/                migrate, seed, check
    client.ts               Lazy Drizzle client (postgres.js)
    env.ts                  DATABASE_URL reading; isDatabaseConfigured()

  server/                   ── SERVER LAYER (every module is `server-only`)
    repositories/           Queries + row→domain mapping. Tables only.
    services/               What the application calls. Owns the fallback.
    database.ts             fromDatabase() — the database/seed-data seam
    current-user.ts         Session → account id

drizzle/                    Generated SQL migrations + snapshots (checked in)
.env.example                Environment template — the only tracked .env file
```

**Why the `(app)` route group exists.** A Next.js layout cannot be *removed* by a
descendant, so with `AppShell` in the root layout `/admin` would inherit the
mobile bottom navigation. The group changes no URL.

**Placement rule:** used by two or more sections → `shared/`; otherwise its
section folder. `ui/` is reserved for unopinionated primitives.

---

## 6. Navigation

Exactly **five** primary sections: Home, Plans, Wallet, Referral, Settings.
`src/constants/navigation.ts` is the single source of truth for both the mobile
bottom bar and the desktop sidebar — **do not hard-code nav items anywhere
else.**

- **Mobile** — fixed bottom bar, 4.5rem plus safe-area inset.
- **Desktop (`lg`+)** — bottom bar hidden, 16rem sidebar.
- Secondary screens use `PageHeader` with an explicit `backHref` — a real link,
  so a shared URL or cold load works. **Never `router.back()` alone.**

---

## 7. Mobile-first requirement

**Highest UI priority.** Desktop is a wider frame around the same app, never a
separate dashboard. Target widths **360, 375, 390, 412, 430**; check every
important screen at 360px before considering work done.

- **No horizontal page scrolling, ever.** Horizontal chip/card rows scroll inside
  their own `overflow-x-auto` container (`.edge-scroll`, `.no-scrollbar`).
- The bottom navigation must never cover content — scroll containers reserve
  space with `.pb-nav`, and a screen with its own fixed action bar adds a spacer
  for that bar *on top of* `.pb-nav`.
- Touch targets ≥ 44px (`default`/`lg`/`icon` satisfy this; `xs` only for chips
  inside a larger tap area). Text never below 11px.
- Form inputs use a 16px base font size, so iOS Safari does not zoom on focus.
- Safe areas via `.pt-safe` / `.pb-safe` / `.pb-nav` and `viewportFit: "cover"`.
- No labels that truncate at 360px — let them wrap.

Content scrolling *under* the translucent bottom bar is expected and fine.

---

## 8. UI/UX principles

Clean light neutral background, deep-charcoal type, muted gray secondary text,
`rounded-2xl` cards, hairline borders, large tabular numbers, generous spacing.

The accent is a **restrained muted teal** (`--brand`), used only for positive
values and rewards, active navigation and selected states, important status
indicators, and the primary call to action.

**Avoid:** neon green, heavy gradients, blue/purple "crypto" styling, glow
effects, heavy shadows, glassmorphism everywhere, over-animation, flashy trading
aesthetics.

- Numeric readouts use `.tabular` so digits do not jitter.
- Status vocabulary is centralised in `StatusBadge` — **never invent new status
  labels or colours inline.**
- **Meaning is never carried by colour alone** (risk uses filled steps + a label;
  statuses pair an icon with text).
- One inverted (charcoal) surface per screen at most — the hero balance.

---

## 9. Currency conventions

- **USDT is the only currency the customer app shows**, with one exception.
  The INR equivalent and the rate note were removed from Home, Plans,
  investments, the wallet, Referral and Settings (client decision, 2026-10):
  `CurrencyDisplay` and `StatTile` default `hideInr` to `true`, and
  `<RateNote />` is used only in the CRM.
- **The deposit screen is that exception**: it shows `1 USDT = ₹<deposit rate>`
  as a plain "Rate" row and nothing else about conversion.
- The withdrawal screen still shows the payout rate, every fee and the exact net
  INR, because that is a quote for INR the customer will be paid, not a display
  conversion (next point).
- INR uses the `en-IN` locale (lakh/crore grouping). Intentional.
- Deposits are **USDT only**. Withdrawals pay out in **INR** and must show:
  amount, quoted payout rate, every fee, and the exact net INR received. The
  payout rate is deliberately distinct from the indicative display rate.

---

## 10. Important business concepts

- **Plan** — a product with a min/max, a term, a projected return *range*, a
  reward frequency, a risk level.
- **Investment** — a user's allocation into a plan.
- **Reward** — profit credited to the available balance on the plan's schedule.
- **KYC** — required before investing or withdrawing. Both flows gate on it.
- **Referral / VIP** — three levels, two commission tiers. Rates live in
  `src/data/referrals.ts` and in `vip_levels`. **Never hard-code them in
  components, and never restate a rate in a service** — `referrals-write.service`
  reads it from `vip_levels` joined on the *beneficiary's* level, so the CRM and
  the user app can never quote different numbers.

  **What an allocation does.** `createInvestment` calls
  `accrueReferralCommission` inside its own transaction: a `commission_entries`
  row for the direct referrer at their tier-1 rate, one for that person's
  referrer at tier-2, the direct `referrals` row moved `registered → active`, and
  both beneficiaries' `referral_accounts` aggregates advanced. Two tiers, never a
  walk up a chain. `activeReferrals` is counted on the *transition* only, under a
  `for update` on the edge, so two concurrent allocations cannot both count it.

  **Accrual credits nobody.** Entries are written `pending` with a `release_at`
  and land in `commission_pending_usdt`. **There is a test asserting accrual
  reaches no wallet and writes no ledger row; do not make it pass by deleting
  it.**

  **A `release_at` of null is never due** — the job will not invent a date on
  which somebody's money becomes payable. Such entries stay in the operator
  queue.

  **Release is scheduled, and an operator can still do it by hand.**
  `release_at` is stamped at accrual from
  `platform_settings.referrals.payoutDelayDays`, snapped to midnight on the
  business calendar (§10d). `releaseDueCommissions()` (cron) and the *Release*
  button in `/admin/referrals` (gated on `manage` over `referrals`) call the
  **same** `releaseCommission()`. One transaction holds the ledger row, the
  balance, the aggregate move and the audit entry, with the status transition
  asserted in the `UPDATE`'s own `WHERE` — so the job running twice, two passes
  overlapping, and the job racing an operator all pay exactly once.

  **The programme's switches are read, not decorative.** `programmeEnabled` and
  `maxTiers` are honoured by `accrueReferralCommission`; `maxTiers` is clamped to
  2 because the VIP table defines exactly two commission columns.

  **VIP as the customer sees it is referral DEPTH** (2026-10): someone you
  referred is VIP 1 to you, their referrals VIP 2, and so on
  (`listReferralNetwork`, a recursive CTE over `users.referred_by_code`, capped
  at 10 levels). It never depends on counts or amounts. Commission is
  unchanged: two tiers, VIP 1 and VIP 2, at the rates below — depth 3+ earns
  none, and **no third rate may be invented**. The account-level `vip_level`
  below still decides those two rates and is shown to customers only as
  "Commission rate", never as their VIP.

  **The account-level commission level advances on its own, and only upward** — the highest level meeting
  both `required_active_referrals` and `required_team_volume_usdt`, applied after
  the commission so an allocation pays at the rate held when it was made. There
  is deliberately no demotion.
- **Deposit lifecycle** — select network → show address → await transfer →
  detected → confirmations accumulate → credited.

### 10a The allocation lifecycle

    deposit → available → allocation (principal locked)
            → scheduled earnings credited → maturity → principal returned

`createInvestment` debits `available`, raises `total_invested` and
`locked_in_investments`, writes the ledger entry, and stores the allocation's
total scheduled profit as `projected_profit` via `applyPercent()` (`@/db/money`,
exact integer arithmetic, never a float on a money value). **That figure is a
snapshot** — computed once, stored on the row, never recomputed — which is what
makes a later edit to the plan's rate reach only allocations made after it
(§10b).

`/api/cron/settle-investments` → `settleInvestments()`, three steps in order:

1. **Credits every due earning period** (`creditDueEarnings`). Each allocation's
   schedule (`investment-schedule.ts`'s `earningPeriodsFor`) says which periods
   exist, when each is due and for how much; the plan's `reward_frequency`
   (`daily`/`weekly`/`monthly`/`on_maturity`) decides the period length and the
   engine reads it rather than assuming. Guarded by a unique index on
   `(investment_id, period_key)` so a replay cannot pay twice, and by
   `investments.earnings_credited_periods` — a cursor the same credit advances —
   so a caught-up allocation is not re-attempted every tick.
2. **Matures what is due** — recomputes `elapsed_days`, hands everything past
   `matures_at` to `matureInvestment()`, which returns the principal through the
   ledger. **Earnings are credited before maturity is checked**: the final period
   is due exactly at `matures_at`, so crediting it must happen while the row is
   still `active`.
3. **Refreshes the display schedule** — `next_reward_at` and
   `next_reward_amount`, recomputed from `started_at` and the credited-period
   cursor rather than incremented, so a missed run cannot drift.

**Two schedule versions, stored on the row** (`investments.schedule_version`).
Version 1 — every allocation made before selectable durations — is the rule
below, unchanged. Version 2 (a duration the customer chose, §10e) pays weekly,
the last period shorter when the term is not whole weeks, split **pro rata by
days** with `splitByWeights` (15 days → 7/15, 7/15, 1/15, the last at maturity).
A version is never changed after creation, so a rule change cannot reprice an
allocation already sold. **There is a test of all five durations; do not
loosen it.**

**Non-compounding, exactly.** Every period is a fixed share of the *original*
`projected_profit`, split by `splitEvenly()` using integer arithmetic on the
schema's smallest unit — shares sum to exactly the total sold, the last period
absorbs the others' truncation, and a credited period never enlarges the base.

**`duration_days: 0` means open-ended, not "already matured" — and not scheduled
for earnings either.** `matures_at` is `started_at + 0 days`, so arithmetic
trusting that column alone concludes the row matured the instant it was created.
Both `creditDueEarnings` and the settler filter on `duration_days > 0`. **There
are tests named for both filters; do not remove either.**

**An open-ended allocation is ended by the customer, and only by them.**
`endOpenEndedInvestment()` → `endAllocationAction` → the *Return funds* control.
It verifies ownership against the row, refuses anything with a fixed term,
honours `platform_settings.investments.allowEarlyExit`, then delegates to
`matureInvestment()` rather than reimplementing the money. The product copy
promises no fee and no forfeiture in four places, so the whole principal returns
immediately.

**The fixed-term plans' early exit is still not implemented, and refusing it is
deliberate** — Starter and Balanced each name rules (day 7 with forfeiture; day
30 with a 2% exit fee) that are not built, and returning the principal in full
would invent terms more generous than the ones sold.

### 10b Changing a plan's rate

`updatePlanAction` writes an append-only `plan_rate_history` row on any change to
`estimated_return_percent` — previous rate, new rate, `effective_at`, operator.
Nothing updates or deletes a row in it, the same rule `audit_logs` follows.

**It changes nothing about a running allocation**, because `projected_profit` is
a snapshot (§10a): a credited period keeps its amount; **not-yet-credited**
periods are still paid from the allocation's own `projected_profit` at the rate
it was sold at; only an allocation created **after** the edit reads the new rate.
Retroactive repricing was considered and rejected — nothing in the product's
terms tells a customer their return can change mid-term.

### 10c Plan rate tiers — the amount band an allocation is sold at

`plan_rate_tiers`: one row per amount band per plan — a **half-open**
`[min_amount_usdt, max_amount_usdt)` range, a `rate_percent`, an `active` flag,
top band's upper bound null. Three `CHECK` constraints are in the schema; overlap,
gap and duplicate-boundary checking is a property of the whole ladder and lives
in `validateTierLadder`.

**A band's percentage means what `plans.estimated_return_percent` means:
projected TOTAL return over the plan's whole term.** Not a daily or weekly rate —
`reward_frequency` decides only how the total is split (§10a). **There is no
conversion between a periodic rate and a total anywhere in this codebase, and
none should be invented**; introducing a per-period meaning would silently
reprice every plan.

**Boundaries are `[min, max)`** — 49.99 is in `10–50`, 50.00 is in `50–100`.
Every comparison goes through `compare()` from `@/db/money`, never a float.
**There is a test file of nothing but boundaries; do not make it pass by
loosening one.**

**Resolution has exactly three outcomes** (`resolveRateForAmount`):

| | |
|---|---|
| no active bands | the plan's own `estimated_return_percent` |
| a band covers the amount | that band's rate |
| bands exist, none covers the amount | **a refusal** |

The third is the one to preserve — falling back to the headline rate would hide a
configuration gap behind a number nobody chose.

**The ladder is saved whole, in one transaction** (`savePlanRateTiers`).
Contiguity is a property of the *set*, so band-at-a-time editing would let an
invalid ladder exist between calls and price an allocation against a half-written
table. Existing rows are updated **by id**, never deleted and re-inserted.

**The client never supplies a rate.** `createInvestment` takes a plan id and an
amount; there is no third parameter to forge. The invest sheet resolves a band
for *display* and shows the rate the server returned. The CRM's preview calls
`previewPlanRate` → `resolveRateForAmount` — the same function.

**A tier change does nothing to a running allocation.** `investments` copies the
band onto the row (`applied_tier_id`, `applied_tier_min_usdt`,
`applied_tier_max_usdt`, `applied_rate_percent`) and computes `projected_profit`
from that copy. `applied_tier_id` is deliberately **not** a foreign key: a deleted
band must not take the evidence with it, or block its own deletion.

**Seeding.** `@/data/plans` derives each plan's starting ladder from what the plan
publishes. `npm run db:backfill-tiers` applies that to an already-migrated
database — idempotent, and it **never touches a plan that already has a band**.

### 10e Selectable durations — 7, 15, 30, 60, 90 days

`plan_duration_rates`: one operator-entered TOTAL return per (plan, term),
edited as a set in Admin → Plans → *Durations* (`savePlanDurationRates`,
`plans: manage`, audited, rows updated in place and deactivated rather than
deleted). **No rate is ever derived from another term's** — a blank term is not
offered and `createInvestment` refuses it.

- A plan with any active duration rate is sold ONLY on one of them: the term
  becomes `duration_days`, the rate `applied_rate_percent`
  (`applied_duration_rate_id` is the breadcrumb, not a FK), the frequency
  `weekly`, `schedule_version` 2. The amount-band ladder (§10c) does not price
  these allocations.
- A plan with none keeps the original single-term path, unchanged — which is
  what production does until an operator enters rates.
- The client never sends a rate: the action sends plan, amount and term.

### 10d The business calendar

`src/lib/business-time.ts` — `Asia/Kolkata`, UTC+05:30, **no daylight saving**.
The one place this application says what a business day is, and the only thing
needing one: the referral release schedule.

India, because the business already runs on that calendar wherever money leaves
the platform (INR payouts to Indian banks, `en-IN` formatting, Indian locales).
The offset is a constant rather than an `Intl` lookup because India has observed
one offset since 1945. **If this is ever pointed at a jurisdiction that observes
DST, the timezone database is the fix — not a different number.**

§11's UTC-pinning rule is unchanged; a release time renders with
`formatBusinessDateTime`, which writes "IST" out. Vercel Cron schedules in UTC,
so `30 18 * * *` is 00:00 IST; both halves are exported from the same module and
echoed in the route's response, so a drifting schedule is visible in the output.

**Eligibility is `release_at <= now`, never "became due during this run."** A pass
that does not happen at midnight is *late*, not lossy. Same reasoning as the
deposit scanner's cursor (§18.5): polling designs fail by delay, and only if you
let them.

### Language discipline (important)

Returns are **never** presented as guaranteed. Always *estimated*, *projected* or
*potential*; keep risk disclosure adjacent (`RiskNote`). **Each plan shows ONE
return figure per term — no projected range, no minimum/maximum** (client
decision, 2026-10); the stored `estimated_return_low/high` columns now mirror
the rate. The client has asked for "guaranteed return" wording; it has **not**
been adopted because the Terms, Risk Disclosure and FAQ in `@/data/support`
state that no return is promised. Change that only together with the signed
legal text, never by editing a UI string. Screens that look like they move money carry a `PrototypeNote`.
**Do not remove these** — investment UIs implying guaranteed returns create real
regulatory exposure.

---

## 11. Coding conventions

- TypeScript everywhere; **no `any`**. Domain types live in `src/types`.
- Function components, named exports (route files default-export).
- `cn()` from `@/lib/utils` for conditional classes; props typed with
  `React.ComponentProps<…>` where extending a DOM element.
- Comments explain **why**, not what.
- Semantic HTML: real `<button>` for actions, `<a>`/`<Link>` for navigation,
  `<ul>/<li>` for lists, proper heading order.
- **Accessibility is not optional**: labelled controls, `aria-current` on active
  nav, visible focus rings, accessible dialogs (Radix), screen-reader equivalents
  for charts.
- Dates are UTC-pinned in `@/utils/format` to avoid hydration mismatches.
  **Never call `new Date()` during render for displayed values.** Where a
  timestamp is read forensically — the system log, the audit trail — use
  `formatDateTimeUtc()`, which appends "UTC"; an operator in India read 17:30 at
  23:00 IST and reported the log as wrong. Product screens keep `formatDateTime`.

**Component rules:** never build one enormous page component; do not duplicate UI
(reach for `shared/` first, and add to it when a pattern appears twice); keep
`"use client"` as low in the tree as possible.

---

## 12. Verification expectations

```bash
npm run typecheck    # must be clean
npm run lint         # must be clean
npm test             # must pass
npm run build        # must succeed
```

**Measure performance against a production build with a real session**, never the
dev server (a first dev hit includes 2.8–5.2s of route compilation). Put an idle
gap between requests — back-to-back requests keep the pool warm and hide the cost
that reaches users (§16.1a). Kill the previous server by PID and confirm the port
is free first; a stale process serving the old build produced two rounds of false
"no improvement" measurements.

If the change touches the database layer, run it **both ways** — `DATABASE_URL`
unset and set. The suite skips its integration tests without a database, so a
green run proves less than it looks. `npm run db:check` reports the mode.

Then run the app and look at it, at 360px and at desktop: horizontal overflow,
clipped content, elements under the bottom bar, console errors. **Do not report
that something "should work".**

---

## 13. Remaining integration work

Done: the database (§16), auth (§19, §20), writes (§17), the investment engine
(§10a), referral accrual/scheduling/release (§10, §10d), KYC document capture and
storage (§16.1c).

0. **Manual console setup** for Firebase, S3 and EC2 cron —
   `docs/rollout-phone-s3-deposits-pwa.md`.
1. **KYC provider** — swap manual review for a provider SDK; drive `kycStatus`
   from their webhook. `liveness_check_passed` stays `false` until something can
   actually set it (§23).
2. **Deposit service** — install the EC2 scheduler (§18.5); decide whether the
   legacy pool tables can ever be archived (§18.8).
3. **Withdrawal / payout rails** — real INR payouts and status transitions.
4. **Rates API** — replace `getUsdtInrRate()`.
5. **Reporting** — the CRM dashboard's aggregates and chart series (§16.5).
6. **Localisation** — `settings/language` lists the intended locales.

---

## 14. Instructions for future Claude Code sessions

1. Read this file first, then `CHANGELOG.md`.
2. Inspect before editing. Match the surrounding style.
3. Respect the server/client split (§4.1), the currency rule (§4.4) and the
   data-access rule (§16.2) — **application code calls services, never
   repositories, the Drizzle client or `@/data` records.**
4. Mobile-first for the user app, always — verify at 360px. The CRM is
   desktop-first but must still work at 360px.
5. Never add guaranteed-return language; never remove risk or prototype notices.
   This applies to the CRM too.
6. Do not introduce dependencies casually.
7. **Never put a connection string, password or key in source.** `.env.local` is
   git-ignored; `.env.example` is the tracked template and holds no values.
8. Do not turn this into an exchange or a desktop SaaS dashboard.
9. Keep the two applications isolated (§0, §15.1).
10. Run the checks in §12 and verify in a browser before reporting completion.
11. Update `CHANGELOG.md`. Keep this file as durable knowledge only.

---

## 15. The Master CRM (`/admin`)

An **operations tool**, not a second consumer product: dense tables, sidebar
navigation, one filter row per screen, confirmation before anything
consequential. Same visual language as the user app, laid out for a desk. **§1's
exchange prohibition applies here too.**

### 15.1 Isolation rules

- Nothing under `src/app/admin/` or `src/components/admin/` may import
  `AppShell`, `BottomNavigation`, `DesktopSidebar`, `TopBar`, `PageContainer` or
  `prototype-store`.
- Nothing in the user application may import from `components/admin`,
  `data/admin`, `lib/admin-store` or `lib/admin-permissions`.
- `src/app/admin/[...unmatched]/page.tsx` exists so unknown `/admin/*` URLs
  resolve to the admin 404 rather than the user app's shell. **Do not delete
  it.**

### 15.2 Routes

| Route | Contents |
|---|---|
| `/admin/login` | Operator sign-in. Outside the console's gate, by necessity. |
| `/admin` | Queue counts, platform totals, four charts, six activity panels |
| `/admin/users` | Searchable directory, 13 columns, row actions |
| `/admin/users/[id]` | Full profile across 10 tabs |
| `/admin/kyc` | Review queue → case detail with documents, notes, decisions |
| `/admin/deposits` | Deposit ledger + the **Unmatched** queue; credit / mark-failed / assign |
| `/admin/deposits/configuration` | The single deposit address, its history (§18.9) |
| `/admin/withdrawals` | Payout queue with full fee arithmetic |
| `/admin/wallet-credits` | Manual USDT credit + recent credits (§26) |
| `/admin/investments` | Every allocation, filterable by plan and status |
| `/admin/plans` | Plan catalogue; create / edit / disable |
| `/admin/referrals` | Referral accounts + commission ledger, VIP configuration |
| `/admin/agents` | Operator directory, permission matrix, activity |
| `/admin/notifications` | Composer + send history |
| `/admin/audit-logs` | Filterable append-only audit trail |
| `/admin/system-logs` | Pipeline and integration observability (§22) |
| `/admin/settings` | Platform, currency, fee, investment, referral, security |

Plus `error.tsx`, `not-found.tsx` and the catch-all above.

### 15.3 Roles and the permission model

- **Master admin** — holds `manage` on everything implicitly. The role *is* the
  grant; their permission map is never consulted.
- **Agent** — holds exactly what has been assigned.

Permissions are **graded, not boolean**: `none` / `view` / `manage`. Real
operations teams need a read-only tier distinct from an operator tier.

The 14 governable areas are in `ADMIN_PERMISSIONS` (`src/constants/admin.ts`):
`users`, `user_details`, `kyc`, `deposits`, `withdrawals`, `investments`,
`plans`, `referrals`, `notifications`, `audit_logs`, `settings`, `security`,
`agents`, `wallet_credits`. **Do not add a permission to a component without
adding it there.** `wallet_credits` (manual USDT credits, §26) is never granted
`manage` by a preset — only by hand, or by the master admin role.

UI enforcement: `AdminNavList` omits destinations the operator cannot `view`;
`PermissionGate` replaces a whole screen with an access notice; `canManage()`
disables individual actions rather than hiding them, so the operator can see the
feature exists and who to ask.

> **`src/lib/admin-permissions.ts` is a usability affordance, never a security
> boundary.** All data is in the client bundle. The same permission ids are
> enforced server-side on every action.

Agent creation starts from a preset (`AGENT_PRESETS`) rather than 13 empty
toggles; the matrix stays fully editable underneath.

### 15.4 Operator state and operator identity

**The operator comes from a Supabase session** — `admin_agents.auth_user_id` →
`getCurrentOperator()` in `server/admin/session.ts`. The header's demo session
switcher is gone: whatever it was set to travelled with every mutation as the
claimed identity, so a caller could name themselves master admin and approve a
verification case.

**Every operator mutation is a server action** in `src/app/admin/actions.ts`, and
every one begins with `requirePermission(area)`, which resolves the session and
asserts the stored grant in one step — **there is no arrangement of calls that
authenticates without authorizing.**

Two properties enforced by Postgres:

1. **The write and its audit entry are one transaction**, through `mutate()`.
2. **A reason collected by a dialog reaches the audit entry**, via `withReason()`.
   If you add an action that collects a reason, thread it through — **do not let
   the dialog lie.**

Three actions say less than their names suggest, and the comments explain why in
place: session revocation cannot invalidate a Supabase token, withdrawal approval
pays nobody, and a campaign delivers in-app only.

**Actions live in `src/app/admin/actions.ts`, not under the route.** `(console)`
is a route group, so actions imported by client components would otherwise have
paths like `@/app/admin/(console)/kyc/actions`, which break whenever the grouping
changes.

### 15.5 Components

`src/components/admin/`: `layout/` (`AdminShell`, `AdminPage`, `AdminSection`,
`AdminSidebar` + `AdminNavList`/`AdminBrand`, `AdminHeader` + mobile drawer);
`shared/` (`AdminStatCard`/`AdminStatGrid`, `DataTable` + `DataCard`/
`DataCardRow`/`PrimaryCell`, `FilterBar`/`SearchField`/`FilterChips`/
`FilterSelect`, `AdminStatusBadge` + the four status badges,
`ConfirmActionDialog`, `ActivityTimeline`, `AuditLogTable`, `PermissionMatrix`/
`PermissionSummary`, `PermissionGate`, `UserActionMenu`, `DetailCard`/
`DetailList`/`DetailRow`/`MonoValue`, `admin-charts`); one folder per section.

**`DataTable` is the table primitive for every list screen.** It renders one
column definition two ways: a real `<table>` from `md` up inside its own
horizontal scroll container, and a card list below it. **Never drop the
`renderCard` prop** — a thirteen-column table crammed into 360px is a broken
table.

Two non-obvious layout constraints, both found by testing:

- The table's scroll container needs `relative`. The visually-hidden caption and
  `sr-only` headers are `position: absolute`; without a positioned ancestor their
  containing block is the viewport and the whole document scrolls sideways.
- Chart frames and dashboard panels need `min-w-0`. As grid children the default
  `min-width: auto` lets a 12-point axis widen the track past the viewport.

### 15.5a The list screens page in Postgres, and the URL is their state

Every CRM list screen reads **one page of ten rows**, filtered, searched and
sorted by the database. The rules, because the pattern is meant to be copied:

- **The URL is the state.** A server component reads its inputs from the URL and
  nowhere else, so filters cannot live in `useState`. `@/lib/admin-list-query`
  parses and builds that URL and is imported by **both** sides. The specs live in
  `ADMIN_LIST_SPECS` (`@/constants/admin`), written out rather than derived from
  the schema enums, because that file is in the browser bundle.
- **Everything from the URL is untrusted.** `page` is clamped positive *and*
  capped (`OFFSET` is a `bigint`; `?page=99999999999999999999` parses finite and
  overflows it — there is a check for exactly that). `status` and `sort` are
  matched against the screen's allowlist. **`pageSize` is not read from the URL
  at all** — a caller-chosen page size is an unbounded read wearing a parameter.
  Search is length-capped and its `LIKE` wildcards escaped by `likePattern`;
  without that, searching `%` returns the whole table.
- **One statement per page.** The pager's total rides along as `count(*) over()`
  on the same filtered scan (`@/server/repositories/paginate`) — a round trip is
  the unit of cost (§16.1a).
- **A page past the end returns page 1**, never an empty screen implying the
  queue is clear.
- **Chip counts are a second, parallel query**, because they must ignore the
  status filter while the page applies it.
- **Figures above a paginated table must be SQL aggregates.** Reducing over `rows`
  silently makes them "of the ten on screen" — not a smaller number, a false one.
- **`/admin/referrals` carries two independent lists**, so each owns a URL prefix
  (`a`, `c`) and the builder passes the sibling's parameters through untouched.
- **A picker is a server search, not a prop.** The deposit-assignment dialog calls
  a permission-gated action returning at most eight narrow rows, from two
  characters, discarding out-of-order responses.

Two things about how it feels — at this volume the paged read is marginally
slower than reading the table, and the win is that the cost stops growing. Each
page emits its header and permission gate **before** its Suspense boundary, so
the screen paints immediately and only rows stream; an in-page filter change goes
through one shared `useTransition` (`useAdminListNavigation`), so rows **dim
rather than blank**.

**Search is `ILIKE '%needle%'` and no btree can serve it.** Fine at these
volumes; the fix at scale is `pg_trgm`, in FUTURE_TASKS with a trigger rather
than done speculatively.

### 15.6 Charts

`admin/shared/admin-charts.tsx`: `PlatformFlowChart` (deposits above a zero
baseline, withdrawals below), `SeriesBarChart`, `TrendChart`,
`StatusBreakdownBar`.

- A single series carries no legend — the heading names it.
- The flow chart encodes direction by **position**, so the reading never depends
  on hue. Two series therefore also get a legend.
- Hues are `--chart-1` (brand teal) and `--chart-5` (amber), validated as a pair
  in both modes: CVD ΔE 10.1 light / 9.7 dark, normal-vision ΔE 17.9 / 18.0, each
  above 3:1 contrast. The brand teal sits under the usual chroma floor by design
  (§8), which is why position, legend and table view all carry the meaning too.
- **Every chart ships a screen-reader table.** No value is reachable only by
  hover.

### 15.7 Currency in the CRM

Identical rule to §4.4 — **no component converts or formats currency itself.**
Use `CurrencyDisplay`, `formatUsdt`, `formatUsdtAsInr`, `formatInr`. Withdrawals
show the payout rate stored on the record, quoted at request time.

### 15.8 Remaining CRM integration

1. **Audit log** — must never become editable or deletable from the UI.
2. **KYC provider** — case list, documents and decisions become provider calls;
   `reviewedBy` comes from the session.
3. **Payout rails** — drive withdrawal status transitions.
4. **Configuration service** — done for the USDT rates, the withdrawal fee, the
   minimum withdrawal and the support contacts (§29); the other settings on
   `/admin/settings` are still recorded without yet changing the user app.

---

## 16. The database layer

### 16.1 Getting a database

```bash
cp .env.example .env.local     # then set DATABASE_URL
npm run db:migrate             # apply drizzle/*.sql
npm run db:secure              # RLS + storage bucket — §16.1b
npm run db:seed                # load the development data
npm run db:check               # connected? migrated? seeded?
npm run db:verify              # READ-ONLY: which target, pending migrations,
                               # will they apply, aggregate counts (before/after)
```

Any PostgreSQL 14+ will do; development is a Supabase project (ap-northeast-2,
PG17). Also: `npm run db:generate` after changing the schema, `npm run db:studio`,
`npm run db:backfill-tiers` (§10c).

| Variable | Used by | Endpoint | Shape |
|---|---|---|---|
| `DATABASE_URL` | every render | session pooler, `:5432` | pooled, `max` 5 per instance |
| `DIRECT_DATABASE_URL` | `db:migrate`, `db:seed`, `db:studio` | session pooler, `:5432` | one connection, opened and closed |

`DIRECT_DATABASE_URL` is optional and falls back to `DATABASE_URL`. It exists
because a migration takes an advisory lock and issues DDL, which wants a session
to itself.

#### Which Supabase endpoint — and why not the one everyone recommends

Both variables use the **session pooler** (`…pooler.supabase.com:5432`).

- **Direct** (`db.<ref>.supabase.co:5432`) — publishes **AAAA records only**, and
  Vercel's serverless runtime has no IPv6 egress.
- **Transaction pooler** (`:6543`) — the standard serverless recommendation.
  **Cannot be used with postgres.js + Drizzle here.**
- **Session pooler** (`:5432`) — IPv4, handles everything this application does.
  Its price is the connection ceiling in §16.1a.

**Why `:6543` is out (re-tested 2026-09-02 — do not re-derive this from memory,
it has cost two sessions).** Transactions are **not** the problem; every financial
write works there. **The blocker is the simple query protocol.** Drizzle issues
everything through `client.unsafe(sql, params)`, and postgres.js sets
`simple: params.length === 0` — so a Drizzle query with no WHERE clause and no
bound values takes the simple protocol, which Supavisor in transaction mode
cannot demultiplex when pipelined. It stalls with no error and no timeout, and
**wedges the pool permanently.** `catalogue.repository` emits four of its five
queries that way (`plans`, `deposit_networks`, `vip_levels`), read by `/plans`,
`/referral`, `/wallet/deposit` and the admin console — exactly the routes that
wedged. Making it safe would mean a dummy bind parameter on every unfiltered
SELECT forever, enforced by nothing.

> **Probe with `select 1`, not with a parameterised query.** A hand-written
> ``sql`select ${x}` `` carries a bind parameter, uses the extended protocol, and
> passes on `:6543` even with the settings that hang the application.

`usesTransactionPooler()` in `db/env.ts` correctly forces `prepare: false`, so
pointing `DATABASE_URL` at `:6543` is never *silently* wrong — but nothing should
point it there. **The way off session mode is a different driver, not a different
port:** `node-postgres` does not pipeline, and `drizzle-orm/node-postgres` speaks
to it. A real migration (`db.execute()` returns a `QueryResult` there rather than
a row array, so every caller changes) and the correct next step if this
deployment needs to scale past a handful of instances.

**If connections take ~5 seconds each**, the machine's resolver is stalling on
AAAA lookups; set `DATABASE_FORCE_IPV4=true`. Off by default because the stall is
a property of the machine, not the application.

### 16.1a Latency — the number that governs every design choice here

Measured against the configured project from India. The *shape* generalises, not
the milliseconds.

| | |
|---|---|
| DNS resolution | 1 ms |
| TCP connect | ~200 ms (one round trip) |
| **Opening a pooled connection** | **~1,930–2,042 ms** |
| Query on an open connection | ~199–206 ms |
| Supabase Auth `getUser()` | ~345 ms |

**Opening a connection costs ten times a query** — the Postgres startup handshake
is roughly ten round trips. Everything below follows.

1. **A connection must never be thrown away — but it must be given back.**
   `idle_timeout` is **120s** (`DATABASE_IDLE_TIMEOUT` overrides).
   - **`0` caused `EMAXCONNSESSION`**: every process that ever ran a query
     permanently claims up to `max` of the project's fifteen slots until it dies,
     which is why the error appeared at *zero traffic*, on localhost and on
     Vercel. Only correct for a deployment that really is one long-running server
     with the pool to itself.
   - **30 was too short.** The governing interval is *reading*, not
     click-to-click: with a 35s pause, `/settings` took 8.35s at 30 vs 0.84s at
     120; `/wallet` 7.57s vs 1.42s.
   - 120 still hands slots back two minutes after the last query. **Lower it
     toward 30 if the deployment routinely runs three or more concurrent
     instances**, and read FUTURE_TASKS' "Scale ceiling" first.
2. **A round trip is the unit of cost, not a query.** Narrowing columns saves
   almost nothing; removing a round trip saves ~200 ms. Hence
   `getCurrentOperator()` reads the agent and its grants in one left join.
3. **A duplicated read is a duplicated round trip** — removed by request-scoped
   `cache()` (§16.2a).
4. **Parallel is only free up to `max`, and `max` has a ceiling above it.** **The
   pool is 5 and the warm-up 3** (`DATABASE_POOL_MAX`, `DATABASE_WARM_CONNECTIONS`)
   and **the two must always move together.** 8/7 was fastest on one server and
   the wrong shape for a platform that adds instances; 3/2 was the
   overcorrection — 18 concurrent authenticated requests took 14.0–21.9s wall vs
   8.2–8.8s at 5/3, with individual requests reaching 14.3s against the 15s read
   deadline. **The ceiling is fifteen and it belongs to the project**, shared by
   every instance, `npm run db:*`, the scanner and the test suite; Supavisor
   answers a sixteenth with `(EMAXCONNSESSION) max clients reached in session
   mode`. **Do not raise it per instance to buy speed** — raise the project's pool
   size in the Supabase dashboard, or make the driver migration in §16.1.
5. **A connection that is never opened costs nothing.** Cold five-query burst
   2,008 ms; warm 203 ms. `warmConnectionPool()` opens
   `DATABASE_WARM_CONNECTIONS` in the background when the pool is created.
6. **A read that starts late is as expensive as a slow one.** Two round trips is
   the floor for an authenticated page. The two easy ways to build a third: (a)
   awaiting two reads in a repository that only ever needed the same `userId`,
   (b) reading in an async server component the page *returns* — it cannot start
   until the page has finished. Hoist its slices into the page's own wave and let
   memoisation serve it. The console layout was a third variant — two awaits in
   sequence for an ordering nothing needed.
7. **An abandoned navigation is not a cancelled one.** Next does not stop
   rendering when the browser stops listening, and nothing threads an abort signal
   into postgres.js, so *N* rapid clicks are *N* complete renders competing for
   the pool. The only lever is making each render cheaper. **Do not go looking for
   a cancellation hook; there isn't one.**
8. **Instrumentation must not hold connections during the render it measures.** A
   layout with no `traceRender` makes every event an `INSERT` issued *while the
   page renders*, from the same pool. Wrap it so events buffer into one insert
   behind `after()` (§22.1a).

**Do not "optimise" by adding indexes or trimming columns before checking the
round-trip count.** The query plan is almost never the problem here.

### 16.1b `npm run db:secure` — RLS and the document bucket

Supabase configuration a Drizzle migration cannot express. **Run it after
`db:migrate`, and after any migration that adds a table.**

**RLS was off on every table, and that was a live data leak.** Supabase publishes
`public` over PostgREST and grants `anon` SELECT; Drizzle creates tables with RLS
disabled. Verified: `GET /rest/v1/users` with the **anon key — public by design
and inlined into the browser bundle** — returned full names, emails, phone
numbers, KYC status and wallet addresses. No application code was involved; the
API is a property of the database.

The script enables RLS on every table with **no policies**, closing PostgREST
completely. The application is unaffected because it connects as `postgres`,
which has `rolbypassrls` (verified, not assumed). `ENABLE`, **never `FORCE`** —
`FORCE` applies RLS to the table owner and would lock the application out.

> **A new table is exposed until this runs: migrate, then secure.**
> `kyc-storage.integration.test.ts` reads every table as `anon` and as a signed-in
> customer and requires both to come back empty. **Its table list is derived from
> `@/db/schema`, not written out** — a hand-written list of thirteen is one
> somebody forgets to add to, and `deposit_address_assignments` shipped with RLS
> off while the suite stayed green.

Neither half needs a service-role key: Supabase keeps buckets and storage policies
in Postgres.

### 16.1c KYC document storage

**Two stores, one decision point** — `kycUploadModeFor()` in
`server/storage/kyc-document-store.ts`, and every row says which it is in
(`kyc_documents.storage_backend`):

- **`s3` — private AWS S3, the target on EC2.** Off unless
  `KYC_STORAGE_DRIVER=s3` *and* `KYC_S3_BUCKET` and a region are set; **there is
  no default bucket**. Keys are `kyc/{userId}/{document|selfie}/{uuid}` — no
  filename, no document number. The browser PUTs straight to S3 with a
  **5-minute presigned URL that signs the exact content type and byte length**,
  so S3 refuses a different file; on submission the server refuses any key
  outside the caller's own prefix *before* asking S3 (`isOwnKycKey`), then
  `HeadObject`s it and stores what S3 recorded. Reviewers get a 120-second
  presigned GET after `requirePermission("kyc", "view")`, from the row id.
  Credentials come from the SDK's default chain — **the EC2 instance role**; no
  key is read by this code. No ACL is ever set: the bucket stays private under
  Block Public Access. Runbook: `docs/rollout-phone-s3-deposits-pwa.md` §2.
- **Profile photos** (`server/storage/avatar-store.ts`) use the same bucket and
  config under `avatars/{userId}/{uuid}`, with the same presigned-PUT, own-key
  and HeadObject rules, and a 15-minute presigned GET for display. Optional:
  onboarding hides the control when S3 is off.
- **`supabase` — the original bucket, legacy.** Described below. It authorises
  by the uploader's *Supabase* session, so only an email-signed-in customer can
  use it; a phone-signed-in customer with S3 unset sees no upload controls
  (`unavailable`) and submits declared details only (§23). Rows written before
  S3 stay `supabase` and remain openable while that project exists.

The original Supabase store: a **private** Supabase Storage bucket, `kyc-documents`, `file_size_limit` 10 MB,
with an `allowed_mime_types` allow-list. Keys are
`{auth_user_id}/{kind}-{timestamp}-{random}.{ext}`; the leading folder is what
every policy keys on. The bytes are never in Postgres —
`kyc_documents.storage_path` holds the key, and `content_type`/`byte_size` hold
what Storage recorded rather than what the browser claimed.

**The browser uploads straight to Storage.** Not a shortcut: a Vercel serverless
function has a ~4.5 MB body limit and the flow accepts 10 MB, so a server action
would work in development and fail in production. That makes the *storage
service* the enforcement point, which is stronger than application validation — a
client lying about type or size, or aiming at another person's folder, is refused
before an object exists.

| Policy | Scope |
|---|---|
| INSERT | only into `auth.uid()`'s own folder |
| SELECT (owner) | only their own folder |
| SELECT (operator) | the whole bucket, while `public.is_kyc_operator()` |
| DELETE | own folder **and** `public.is_unsubmitted_kyc_object(name)` |

**No UPDATE policy**, so an object is never overwritten and a resubmission writes
a new key. DELETE stops at the submission boundary: an abandoned upload can be
withdrawn; a document already attached to a `kyc_documents` row cannot be deleted
by the person it describes — it is evidence a reviewer may act on.

Both helper functions are `SECURITY DEFINER` with a pinned `search_path`, because
§16.1b turned RLS on for the tables they read.

Reviewers open a document through `signKycDocumentAction`, which checks
`requirePermission("kyc", "view")`, looks the key up from the row id (**the caller
never names a path**), and mints a **120-second signed URL** using the operator's
own session. No service-role key anywhere.

### 16.2 The layers, and who may call what

```
  page / layout / server component
        ↓  calls
  src/server/services/*.service.ts     ← the only thing app code imports
        ↓  composes
  src/server/repositories/*.repository.ts
        ↓  queries
  src/db/schema  →  PostgreSQL
```

**Application code calls services. Nothing else.** Not repositories, not
`getDb()`, not `@/data` records. That one rule is what makes the fallback
possible.

- Every module under `src/server/` imports `server-only`, so a stray import from
  a client component fails the build instead of shipping a connection string.
- Nothing under `src/db/` imports `server-only` or Next.js — migration and seed
  scripts run those modules as plain Node.
- Repositories know about tables and return **domain types**; the row→domain
  mapping lives in one file, `repositories/mappers.ts`.
- Services own the fallback and nothing else touches it.

### 16.2a Request-scoped memoisation

`cache()` on the reads more than one part of a render asks for:
`getAuthPrincipal()` / `getAuthenticatedAccount()`, `getCurrentOperator()`, every
read in `account.service`, and the earnings rollup.

- **It is keyed on arguments.** `getUserProfile()` and `getUserProfile(id)` are
  different entries and share nothing — which is how the duplicates arose. Each
  read resolves the session *first* and delegates to a cached function taking the
  concrete id.
- **It is request-scoped, not a cache.** No security property changes: the token
  is verified on every request that needs it, once instead of five times. An
  account blocked between two requests is blocked on the second.

### 16.3 The fallback — `fromDatabase()`

```ts
fromDatabase(
  (db) => listPublicPlans(db),   // when DATABASE_URL is set
  () => seedPlans,               // when it is not
);
```

Three load-bearing properties, all pinned by `src/server/database.test.ts`:

1. **The fallback is chosen by configuration, never by failure.** If
   `DATABASE_URL` is set and the query throws, the error propagates — serving seed
   data over a broken connection would hide the problem you need to see.
2. **It only marks a render dynamic on the database path** (`unstable_noStore()`
   inside the `if`).
3. **A read has a deadline** (`DATABASE_QUERY_TIMEOUT_MS`, default 15s). Without
   one a database that refuses connections does not fail, it *hangs* — postgres.js
   retries a refused connection indefinitely, and on serverless that is a billed,
   silent stall.

### 16.4 Schema notes

- **Money is `numeric`, never a float.** USDT carries eight decimals on-chain.
  The helpers in `db/schema/columns.ts` (`usdt`, `inr`, `percent`, `rate`) map
  back to `number` so domain types are unchanged; the precision guarantee is in
  the storage, which is where it matters.
- **Primary keys are `text`, carrying the seed's meaningful ids** (`usr_8c41a2`,
  `plan_starter`), so existing links stay valid.
- **Enums are Postgres enums** mirroring the unions in `@/types`. Each list must
  stay identical to its TypeScript counterpart.
- **One vocabulary, two words.** `investment_status` stores `matured`; the CRM
  says "matured", the user app "completed", and the mapper translates.
  `plan_status` has `disabled`, which only the CRM knows about — the public
  catalogue filters those rows out rather than renaming them.
- **Both applications read the same rows.** The CRM must never show a commission
  rate the user was not promised.
- **An ordered index must match its query's NULL placement, not just its
  direction.** Drizzle's `.desc()` on an *index* column emits `DESC NULLS LAST`;
  `orderBy(desc(...))` in a *query* emits a bare `DESC`, which SQL defines as
  NULLS **FIRST**. Postgres matches literally, so the planner silently refuses the
  index — even when the column is `not null`. That is how
  `transactions_user_recent_idx` shipped in `0017` and was never used; `0018`
  rebuilds it and the schema says `.nullsFirst()` explicitly. **When you add an
  ordered index, check the plan for a sort node rather than assuming**, on a table
  with realistic skew.
- **Only masked account and document numbers are stored.** No password column
  exists either — auth brings its own.

### 16.5 What is deliberately *not* database-backed

- **`earnings.service.ts`** — the earnings curve is a daily accrual model while
  the ledger records rewards as they settle. Deriving one from the other is not a
  query, and inventing an accrual model here would put numbers on the home screen
  that no service computed.
- **The CRM dashboard's metrics and chart series** (`@/data/admin/metrics`) —
  these describe the whole platform, not the sample slice in the tables. Summing a
  page of rows into a headline figure is a reporting service's job.

**Do not quietly replace either with sums over seeded rows.**

### 16.6 Seeding and migrations

- **Migrations are generated, never hand-written.** Change `db/schema/`, run
  `npm run db:generate`, review the SQL, commit it.
- **The seed reads `@/data`**, so a difference after switching the database on is
  a bug, not a data change. It is destructive and refuses `NODE_ENV=production`.
- The two mock datasets overlap in three places (investments, security events,
  commissions); the reconciliation is documented at the top of `db/seed/index.ts`.
- `db/seed/seed.test.ts` runs the seed against a recorder — no database needed —
  checking what Postgres would otherwise reject: every foreign key resolves, keys
  are unique, every schema table is seeded, and the demo account's wallet
  reconciles against its allocations.

### 16.7 Tests

`npm test` runs `node:test` through `tsx` with `--conditions=react-server`, so
`server-only` modules resolve the way Next resolves them. Tests needing a database
skip themselves when `DATABASE_URL` is unset.

**The one rule that explains most past failures: assert on, and select by, the
property the test owns — never a fact about the physical table.**

- **Do not assert exact row counts against the live database.** Four did, and all
  four broke the first time a real person registered — a successful sign-up read
  as a regression. Assert that the join produced a label, that no document appears
  twice, that there are *at least* `SEED_USER_COUNT` accounts.
- **Do not select a fixture by physical row order.** `money-lifecycle`'s
  `before()` does `plans.find((plan) => plan.durationDays > 0)` over a `select`
  with **no `ORDER BY`**, and an `UPDATE` can move a row in the heap — so after
  enough earlier files it returns Balanced Growth (minimum 250) instead of Starter
  (minimum 50) and the tests allocating 200 fail. The file passes 14/14 alone,
  which is what makes it look like flakiness. Fix: an explicit `orderBy`, or pick
  by minimum rather than position.
- **`settleInvestments()` is global, and integration files share one live
  database.** It processes *every* active fixed-term allocation, including scratch
  rows another file has open. An exact `investments` count and a blanket
  `summary.errors.length === 0` both failed for unrelated allocations. See
  `assertNoErrorsFor()` in `money-lifecycle.integration.test.ts`.

| File | DB | Covers |
|---|---|---|
| `db/env.test.ts` | no | the configuration switch |
| `db/resilience.test.ts` | no | what is retried, what is not, and the bounds |
| `server/auth/session.test.ts` | no | outage vs. "not signed in" |
| `db/seed/seed.test.ts` | no | the seed, against a recorder |
| `server/database.test.ts` | no | fallback, no-silent-fallback, the deadline |
| `server/tron/tron.test.ts` | no | TRON config validation, transfer parsing/filtering |
| `server/plan-tiers.test.ts` | no | the rate ladder's boundaries and validation |
| `lib/admin-list-query.test.ts` | no | the CRM list URL contract |
| `server/repositories/paginate.test.ts` | no | page-past-the-end, filtered total, `likePattern` |
| `server/auth/member-id.test.ts` | no | the member-id generator |
| `db/connection.integration.test.ts` | yes | both connections, parallel load |
| `db/schema.integration.test.ts` | yes | live schema vs declared schema |
| `server/data-access.integration.test.ts` | yes | repositories and services |
| `server/auth-and-kyc.integration.test.ts` | yes | auth boundary, operator gate, KYC lifecycle |
| `server/writes.integration.test.ts` | yes | ledger, idempotency, overdrafts, audit |
| `server/money-lifecycle.integration.test.ts` | yes | allocation → maturity, the earnings engine |
| `server/deposit-request.test.ts` | no | request ids, exact-amount selection, hash normalisation |
| `server/deposit-request.integration.test.ts` | yes | exact-match crediting, once under replay and race, front-running, unmatched review |
| `server/deposit-request-lifecycle.integration.test.ts` | yes | change amount, leave/cancel, paid-after-cancel, one waiting request, "already processed" |
| `server/phone-auth.integration.test.ts` | yes | new vs existing phone accounts, never merge, linking keeps the account, session epoch |
| `server/auth/customer-session-token.test.ts` | no | the signed session cookie: expiry, forgery, garbage |
| `lib/support.test.ts` | no | the Telegram support handle: only a `t.me` username ever becomes a link |
| `server/auth/dev-test-auth.test.ts` | no | the local test sign-in gates: production build, flag, host, look-alike hosts, code expiry |
| `server/auth/phone-identity.test.ts` | no | who a verified phone number may reach — never merge, never by unverified phone |
| `lib/phone.test.ts` | no | Indian mobile normalisation |
| `server/storage/s3-kyc-store.test.ts` | no | S3 off by default, opaque keys, forged keys refused, signed size/type |
| `lib/pwa-install.test.ts` | no | install-prompt policy, iPad-as-Mac detection |
| `server/referrals.integration.test.ts` | yes | commission accrual, tiers, and that it credits nobody |
| `server/plan-tiers.integration.test.ts` | yes | tier resolution, the snapshot, no retroactive repricing |
| `server/deposit-confirmation.integration.test.ts` | yes | deposit announcement; owner-scoped one-way acknowledgement |
| `server/kyc-storage.integration.test.ts` | yes | RLS closed on every table, derived from the schema |
| `server/commission-release.integration.test.ts` | partly | eligibility, missed-midnight recovery, pay-once-under-race |
| `server/pipeline.integration.test.ts` | partly | redaction, correlation, recording |
| `server/services/kyc-policy.test.ts` | no | both KYC files required; type and size rules |
| `lib/image-compress.test.ts` | no | resize maths, PDFs untouched, no-DOM fallback |
| `server/services/manual-credit.test.ts` | no | credit amount, customer id, key and note validation |
| `server/manual-credit.integration.test.ts` | yes | ledger + record + audit, once under replay and race, rollback, permission |
| `server/auth/password-hash.test.ts` | no | scrypt format, salts, tampered hashes refused |
| `lib/withdrawal-password-rules.test.ts` | no | withdrawal password rules |
| `server/withdrawal-password.integration.test.ts` | yes | hash only, counted failures, lock, support-only reset |
| `server/admin/operator-phone.test.ts` | no | which operator a verified phone may become |
| `server/admin/access-gate.test.ts` | no | the admin access gate: fails closed, code shape, per-admin codes, merged forms, ambiguity |
| `server/services/investment-schedule.test.ts` | no | version-2 schedule for 7/15/30/60/90 days: pro rata, exact sums, nothing after maturity; version 1 unchanged |
| `server/plan-durations.integration.test.ts` | yes | duration rates saved/validated/audited; duration required; 15 days paid 7/15, 7/15, 1/15 and matured once |
| `server/referral-depth.integration.test.ts` | yes | VIP = depth: A→B→C→D seen from each viewer; many directs stay VIP 1 |

**`connection.integration.test.ts` fires twenty then forty queries at once** — not
a benchmark, the regression test for the transaction-pooler stall in §16.1, which
every individual query passed and which showed up only as a page that never
loaded. **`schema.integration.test.ts` compares the live database to the schema in
both directions** — declared-but-missing *and* present-but-undeclared, plus every
enum's labels in order, every foreign key's target, and that no money column has
become a float.

### 16.8 Connection resilience — retry, deadline, warm-up

Three mechanisms sized against each other. **Changing one in isolation breaks the
arithmetic.**

| | where | value |
|---|---|---|
| `connect_timeout` | `db/client.ts` | 6s |
| retry budget | `db/resilience.ts` | 12s, 2 retries |
| read deadline | `server/database.ts` | 15s |

**The retry exists because one pooler endpoint is intermittently broken** — the
host resolves to three A records and one accepts TCP then never completes the
handshake. **Which one is broken changes over time**, which is why this is a retry
and not a pinned IP; postgres.js re-resolves per attempt.

- **Only connection-establishment failures are retried:** `CONNECT_TIMEOUT`,
  `ECONNRESET`, SQLSTATE class `08`, `57P01`/`57P03`, `53300`/`53400`, and the
  pooler's client-limit refusal. A constraint violation or syntax error is
  re-thrown on the first attempt.
- **A full pooler is retried, and it needs both the code and the message.**
  Supavisor answers a sixteenth client with `XX000` plus `(EMAXCONNSESSION) max
  clients reached in session mode`. `XX000` alone is far too broad to retry, so
  `isPoolExhaustionError` requires the message too — **there is a test asserting a
  plain `XX000` is not retried.** This was the cause of the intermittent sign-in
  failure: the code matched nothing in the transient set, so five consecutive
  failures over 78 seconds produced no `database.connectRetry` row at all. It gets
  a **different backoff** — 700ms, 1.4s, 2.8s, four extra attempts — because a
  full pooler frees up when somebody *else* releases a connection, not by landing
  a different A record. The 12s budget still bounds it.
- **Reads only. Never `mutate()`.** A write that failed after its statements
  reached the server may have committed; replaying it would double it.
- **The deadline is outside the retry**, so three attempts cannot cost three
  deadlines.
- `connect_timeout` was *lowered* from 10s: it is how long a doomed attempt burns
  before a retry can pick a different endpoint. Healthy handshakes are 2.3–4.6s,
  so 6s makes the worst case exactly two attempts. **Raising it fixes nothing**
  (the broken endpoint does not complete in 20s either) **and would push the
  second attempt outside the budget so no retry happens at all.**

**The warm-up lives on `getDb()`, not in `instrumentation.ts`.** Next compiles
that hook for the Edge runtime too and webpack resolves the graph statically, so
even a dynamic `import()` behind a `NEXT_RUNTIME` guard drags `postgres` →
`node:net` into the edge bundle and fails the build with `UnhandledSchemeError`.
**Hit twice; do not try it a third time.**

### 16.9 What may be cached across requests, and what may not

| | scope | why |
|---|---|---|
| Plans, VIP levels, deposit networks, the support Telegram link | **cross-request** (`unstable_cache`, tag `catalogue`, 300s) | identical for everyone, belongs to nobody |
| Everything user-scoped | **per request only** (`cache()`) | it is one person's money |

Caching a balance, allocation, KYC state or security setting across requests would
serve one person's data to another, and would break the guarantee that an operator
blocking an account takes effect on that account's next request. **Do not extend
the catalogue cache to anything user-scoped.**

The catalogue cache is invalidated **by tag**, so `revalidatePath("/plans")` does
not clear it. **Every CRM plan mutation must also call `revalidateCatalogue()`**,
or an operator's edit sits invisible behind the TTL.

### 16.10 Loading and error boundaries

Every user and console route has a `loading.tsx` — not decoration: a page awaits a
database read before emitting HTML, so without one a slow read renders as a
**blank page**. They also make prefetching cheap, since Next prefetches a dynamic
route only as far as its nearest loading boundary.

`app/error.tsx` and `app/global-error.tsx` exist because **an error boundary
covers the segments below it, never the layout beside it.** `(app)/error.tsx`
never covered `(app)/layout.tsx` — where the gate and the two riskiest calls live.
**Do not delete either file.**

`/login` and `/admin/login` must keep rendering when the database is down. They
resolve an account only to offer a convenience redirect and fall back to the form;
**`redirect()` is called outside the `try`**, because it works by throwing a signal
a broad `catch` would swallow.

**A gate that cannot reach an answer degrades; it does not crash and it does not
sign anybody out.** Both gates distinguish three outcomes:

| | |
|---|---|
| resolved, and it is somebody | render |
| resolved, and it is nobody | redirect to sign-in |
| **could not resolve** (`isInfrastructureFailure`) | render a shell with a retry |

The third grants nothing: no account or operator is resolved, so no page below the
layout renders — `(console)` shows `ConsoleUnavailable`, which contains no console
and no operator data.

**Nothing may report an infrastructure failure as an authorization verdict.**
`completeSignIn`, `completeOperatorSignIn` and the CRM's `failed()` helper all
caught everything and returned `error.message` verbatim — which is how Drizzle's
"Failed query: select …admin_agents… params: <uuid>" reached an operator's browser
as the reason their sign-in failed. `toSafeFailure()` in `@/server/errors` is the
one place that decides what a person may be shown: an allowlist of this
application's own error classes may speak, everything else is described from its
category, and the real text goes to `pipeline_events`. A `retryable` flag rides
along so a form can offer another go — and **`AdminSignInForm` must not call
`signOut()` on one**, which it used to do for every failure and which is the
mechanism behind "it took six tries".

---

## 17. The write layer

Reads have a fallback to seed data; **writes have none.** A read that falls back is
merely stale; a write that "succeeds" against `@/data` has told the caller
something false, so `mutate()` refuses when `DATABASE_URL` is unset.

### 17.1 `mutate()` — the unit of work

Everything that changes data goes through `mutate()` in `@/server/write`:

1. **Atomicity.** The callback runs in one transaction — crediting a deposit
   writes a ledger row, a balance update and a status change; all three land or
   none do.
2. **Auditability.** Audit entries are buffered on the context and written
   *inside the same transaction*.
3. **A named actor.** Nothing writes anonymously. `SYSTEM_ACTOR` covers the
   scanner and schedulers; operator actions carry the operator.

One `now` is stamped across the whole unit.

### 17.2 Money is never added in JavaScript

**The rule that matters most, and the easiest to break by accident.** The money
columns are `numeric` — exact — but read back as JavaScript `number` so domain
types keep working. Fine for display, wrong for arithmetic.

- Amounts travel as `Decimal`, a branded exact decimal string from `@/db/money` —
  the brand means a raw string cannot be passed as an amount without a validating
  constructor.
- Amounts reach a query through `numericValue()`, which binds the exact digits and
  casts to `numeric`. Passing a bare `Decimal` where a column expects `number` is
  a **type error**, which is how this stays enforced.
- Balances move with `UPDATE … SET available = available + $1::numeric`. **Never
  read-modify-write** — besides the float problem, that races another transaction
  doing the same thing.
- Chain amounts are integers in the token's smallest unit, converted with
  `BigInt`, **never `Number()`** — TRC-20 values can exceed `MAX_SAFE_INTEGER`.
- Comparisons that decide anything use `readBalance()`, which casts to `text` in
  SQL so no float is involved.

### 17.3 The ledger

`applyLedgerEntry()` in `wallet.repository.ts` is **the only place a balance
changes**, and it always writes the `transactions` row explaining the change in the
same call — which is why the ledger sums to the balance. There is a test for
exactly that.

Overdrafts are refused by a `WHERE available + delta >= 0` clause, not by a prior
read — two concurrent withdrawals would both pass a read-then-check.

### 17.4 Withdrawals move no money

`withdrawals-write.service.ts` writes records. No payout rail, no bank integration,
no on-chain send. `approved`, `processing` and `paid` record operator decisions;
`payoutReference` is whatever the operator types.

The one real effect: requesting a withdrawal debits the wallet immediately, so a
balance cannot back two requests. Rejecting returns it as a ledger entry, so the
history shows the hold and its reversal.

### 17.5 Idempotency

Protected by database constraints, not prior `SELECT`s — a check-then-insert can be
raced by a concurrent copy of itself.

| Operation | Key |
|---|---|
| Recording a chain deposit | unique `(chain, tx_hash)` |
| Crediting an investment earning | unique `(investment_id, period_key)` |
| Assigning a deposit | `WHERE status = 'confirmed'` on the update |
| Withdrawal transitions | `WHERE status IN (…)` on the update |

---

## 18. TRON integration

Read-only. Mainnet, Shasta and Nile. `@/server/tron/`.

### 18.1 Rules

- **Mainnet is enabled, and the default is still a testnet.** `TRON_NETWORK`
  accepts `mainnet`, `shasta`, `nile`; **unset means `shasta`**. Two guarantees:
  reaching real money requires *naming* the network, and **mainnet may not skip
  finality** — `TRON_CONFIRMATION_REQUIRED=false` / `TRON_CONFIRMATIONS=0` is a
  local-testing escape hatch that `getTronConfig` refuses outright on mainnet,
  because crediting before solidification credits money a re-org can take back.
  **There is a test for it; do not make it pass by deleting it.**

  Nothing else in the pipeline is network-aware. Address validation is base58check
  and prefix-identical across TRON's networks; the scanner scopes its cursor
  (`chain_scan_state`), its requests (`deposit_requests.chain_network`) and its
  configured address (`deposit_settings`) by `network`, so mainnet and testnet
  rows never mix.
- **Nothing is ever signed or sent.** No private key, no seed phrase, no
  broadcasting. `tronweb` is deliberately not a dependency: base58check validation
  is forty lines, and a library that *can* sign is one that can be made to.
- **The TronGrid API key is server-only** — read in a `server-only` module, sent as
  a header, never `NEXT_PUBLIC_`, never logged. What reaches the browser is
  `DepositRequestView` and `getPublicDepositNetwork()`, hand-written projections
  with no field to put a key in.
- **Failures are failures.** Every error path throws. An empty list is
  indistinguishable from "no deposits arrived", and a scanner reading a rate-limit
  response as "nothing new" would advance its cursor past transfers it never saw.

### 18.2 The pipeline

```
TronGrid  →  parse/filter  →  confirmation check  →  deposits row
(scanner, or a customer's hash)                           │
                              exactly one deposit request with this address,
                              exact amount and a window containing the block time?
                                          │                     │
                                         yes                    no
                                          │                     │
                              credited automatically      unattributed + reason,
                              (ledger + balance + audit)  the operator queue
```

Three filters decide what counts, **all enforced locally even where TronGrid was
asked to do it**: **contract** (anyone can deploy a token, call it USDT and send a
million of it — only `TRON_USDT_CONTRACT` counts), **recipient** (`only_to=true` is
the server's promise, not ours to keep), and **direction** (self-transfers and
outgoing transfers are not deposits).

Token decimals are read from the response, never assumed: TRC-20 USDT is six
decimals on TRON and eighteen elsewhere, and guessing scales every amount by a
million.

### 18.3 Confirmation

A transfer is creditable only once its block is **solidified** — at or below the
height from `/walletsolidity/getnowblock`, TRON's irreversibility marker.
Unconfirmed transfers are counted and left for the next pass; the poll window
overlaps by a minute so nothing falls between passes.

### 18.4 Deposit attribution — one address, deposit requests, exact amounts

**A blockchain transaction does not identify who paid, and a shared address
cannot either.** Every deposit goes to ONE configured address (§18.9). What binds
a transfer to a person is a **deposit request**:

- Starting a deposit creates `deposit_requests` row `DEP-XXXXXXXX` (Crockford
  base32 — unmistakable for a 64-hex hash) quoting an **exact amount to send**:
  the amount asked for plus a random 0.01–0.99 USDT, **unique among open
  requests at that address** (advisory lock + the partial unique index
  `deposit_requests_open_amount_key`), valid for `DEPOSIT_REQUEST_TTL_MINUTES`.
- `findMatchingRequest` (`services/deposit-matching.ts`) attributes a confirmed
  transfer only when recipient = the request's quoted address, amount = its exact
  expected amount, and block time ∈ [created − 60 s, expires] — and **exactly one**
  request satisfies that. Every input is a chain fact.
- The scanner and a customer's **Verify Payment** go through the same
  `recordObservedDeposit` → matcher, so a customer who never submits a hash is
  still credited. A submitted hash is a *search key*: `findTransferByHash` reads
  the scanner's own TronGrid listing and `parseTransfer`, and finality is §18.3.

**Why the tx-hash claim is safe here, when §18.4 used to say it was not.** The
chain is public, so anyone can submit a stranger's hash. **Who submits a hash is
not an input to attribution** — the transfer goes to the request its amount and
time match, and the claim is only recorded on the claimant's own request
(`applyClaim`: `credited` / `needs_review` / `not_yours`). There is a test named
for exactly this ("somebody else submitting your hash cannot take your
transfer"); **do not make it pass by deleting it.**

**One request waiting for payment per customer, and cancelling is a state.**
Changing the amount cancels the waiting request inside the transaction that
creates the new one (`deposit_requests_one_awaiting_per_user_key` is the
backstop); leaving the screen — an in-app link, the header's Back, or the
browser's Back (a sentinel history entry) — asks "Leave this payment?", then
`cancelDepositRequest`. Both refuse a request with a submitted hash or a
matched deposit. **`cancelled` stays in `MATCHABLE_REQUEST_STATUSES` and its
amount stays reserved until its window closes** — a customer who paid and
then left is still credited, and no later request can be quoted that figure.
Do not "free the amount early" to shorten the reserved set.

**Anything that is not one exact match is left unattributed with a named
`deposits.unmatched_reason`** (`no_matching_request`, `outside_request_window`,
`ambiguous_match`, `legacy_address`, `no_block_time`) and appears in
`/admin/deposits` → *Unmatched*, with every customer's claim on its hash shown as
evidence (never proof). An operator resolves it with the existing audited
`assignDepositToUser`, which also closes the customer's request. **The CRM still
offers no "best match" suggestion** — a plausible guess is the thing most likely
to be accepted without checking.

**Never loosen the exact-amount rule** (a tolerance, rounding, or "closest
request") to reduce the review queue: an exchange deducting a fee produces an
amount nobody quoted, and review is the correct outcome.

### 18.4a Telling the customer their deposit arrived

`deposits.acknowledged_at`. A deposit is "new" when
`status = 'credited' and acknowledged_at is null` — a **database fact, never
`localStorage`**. **Credited**, because the card says "25.00 USDT has been added to
your wallet" and a merely-detected transfer has added nothing. **Not
acknowledged**, because the defect this closes is a historical deposit reading as a
fresh arrival on every visit, and a browser-side marker would fix that for one
browser and break it on the next device.

`acknowledgeDeposit` puts ownership, `status = 'credited'` and
`acknowledged_at is null` in the `UPDATE`'s own `WHERE`, so a forged id matches no
row, the call can never credit anything, and a double-tap is a no-op. It writes no
ledger entry and no audit entry on purpose.

It renders on `/wallet/deposit` (from the watcher's existing 5s poll — no second
timer) and on `/wallet` (server-rendered, for a deposit credited while nobody was
on the deposit screen). **Dismissed explicitly rather than on render** —
acknowledging on render would mark a background-tab arrival seen by nobody.

**A migration adding this column to an existing deployment must backfill credited
deposits as acknowledged**, or the first load after deploy announces every deposit
the account has ever made.

### 18.5 The scanner

Polling, not events: restartable, failing by delay rather than loss. The cursor in
`chain_scan_state` is an **optimisation** — losing or resetting it is harmless,
because the unique index on `deposits(chain, tx_hash)` is what prevents
double-crediting. A failed pass does not advance the cursor and is recorded, so "no
deposits" and "no successful scan since Tuesday" look different.

**Something has to run it, and for a long time nothing did** — the only trigger was
`npm run tron:scan`, a command a person types. On the development project the last
successful pass was 2026-08-23 and nothing ran for a week, which is what "the
application is not detecting my transfer" turned out to mean.

`GET /api/cron/scan-deposits` is that trigger, authorised by `CRON_SECRET` and
**refusing everybody when it is unset**, because the route spends TronGrid quota
and database connections. **A `setInterval` in the server process is the wrong
shape**: serverless instances are frozen between requests, so the timer either
never fires or fires once per instance — which with several instances is several
concurrent scanners.

> **Vercel cron limits (verified 2026-09-19).** Hobby allows **100 cron jobs per
> project** — the same as Pro and Enterprise — so the *number* of jobs is not a
> constraint on any plan. What Hobby limits is **frequency and precision**: **once
> per day maximum**, and a scheduled time is honoured only to within the hour
> (`0 1 * * *` fires anywhere in 01:00–01:59). A finer expression such as
> `*/15 * * * *` is **rejected at deploy time** — it surfaces as a failed
> deployment, not as a job that silently does not run.
>
> `vercel.json` schedules **three** jobs, all `CRON_SECRET`-authorised plain URLs:
> the deposit scan, investment settlement and the referral release (18:30 UTC =
> 00:00 IST, §10d). The deposit-address release job is gone with the pool
> (§18.8). **On EC2 the scheduler is `deploy/ec2/nanotron.cron`** (scan every 5
> minutes, calling the app on 127.0.0.1); the Hobby limits below apply only if
> the app is still on Vercel. Nothing about them is
> Vercel-specific — point an external scheduler at the same URLs to restore higher
> frequencies. Because Hobby precision is ±59 minutes, **stagger the four rather
> than stacking them**: concurrent 60-second functions contend for a
> 5-connection pool against a 15-connection project ceiling (§16.1a).
>
> **`TRON_LOOKBACK_MS` defaults to exactly 24h, which equals a daily cadence.** For
> an address whose cursor has a null `lastTimestamp`, one failed or delayed pass
> can leave a transfer outside the window permanently. On a daily schedule, raise
> it — 72h is a reasonable floor.

**The deposit screen triggers a pass too, and it is not the scheduler.** While a
request is open, `DepositFlow` calls `checkDepositRequestAction` **every five
seconds** to re-read the request and any newly credited deposits (cheap,
indexed). About **once a minute** it also asks for chain work — floored
server-side at one per account per 20 s whatever the client sends: a request
with a submitted hash re-checks that one transaction; one without asks
`triggerDepositScan()` for a pass (single-flight, 15-second global floor). A
**temporary, user-active-page mechanism** — a transfer arriving after the tab
closes is found by the cron pass and by nothing else. **Do not grow this into
the scheduler.** The pass is started with `after()`, not awaited: Next runs one
client's server actions one at a time, and an awaited pass made a *Verify
Payment* press queue behind it (measured at over 40 s).

**A deposit older than the first-ever scan is invisible until you widen the
window.** With no cursor, a pass looks back `TRON_LOOKBACK_MS`. The cursor only
advances when transfers were actually seen, so nothing is lost permanently — but a
deployment whose first scan runs after a test transfer reports nothing until the
lookback covers it.

### 18.6 Environment

| Variable | Meaning |
|---|---|
| `TRON_NETWORK` | `mainnet`, `shasta` or `nile`. **Unset means `shasta`.** |
| `TRON_GRID_URL` | Must be https. Also `TRONGRID_API_URL` / `TRON_GRID_API_URL`. Defaults per network. |
| `TRON_GRID_API_KEY` | Optional; without it, a much lower rate limit. Server-only. |
| `TRON_USDT_CONTRACT` | The only contract counting as a deposit. Mainnet USDT is `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`. |
| `TRON_PLATFORM_DEPOSIT_ADDRESS` | The deployment's **default** receiving address, used until an operator saves one (§18.9). Also `TRON_DEPOSIT_ADDRESS`. |
| `DEPOSIT_REQUEST_TTL_MINUTES` | How long a request reserves its exact amount (15–1440). Default 60. |
| `TRON_CONFIRMATION_REQUIRED` | Wait for solidification. Default on. **Refused on mainnet when off** (§18.1). |
| `TRON_POLL_INTERVAL_MS` | Scanner interval. Default 30000. |
| `TRON_LOOKBACK_MS` | First-run window. Default 24h — see the cron note in §18.5. |
| `CRON_SECRET` | Authorises every `/api/cron/*` route. Unset means all refuse. |

Leaving `TRON_USDT_CONTRACT` unset disables the integration. With the contract
set but no address saved and none in the environment, customers are told
deposits are unavailable.

### 18.7 End-to-end workflow

Written against a testnet, because that is where you should rehearse. **Identical
on mainnet** except the funds are real.

```bash
npm run tron:inspect          # read the chain, last 24h (platform address only)
npm run tron:inspect -- 336   # …looking back two weeks
npm run tron:scan             # one pass over every watched address (§18.8)
npm run tron:scan -- --watch  # poll continuously
npm run tron:scan -- --dry    # read and report, write nothing
```

Against the legacy shared address (the manual-attribution path): send test USDT →
`npm run tron:inspect` shows it and whether it is solidified → `npm run tron:scan`
makes it a `confirmed`, **unassigned** deposit → `/admin/deposits` → **Assign** →
the balance rises, a ledger entry cites the tx hash, the audit log records who
assigned it.

Through a deposit request this credits automatically with no operator step: sign
in, **Add funds**, enter an amount, send **exactly** the quoted amount, then paste
the transaction hash (or just wait — the screen asks for a pass every minute
while open, and the cron finds it regardless).

**Check the lookback before concluding anything.** `tron:inspect` defaults to 24
hours and passes it as `min_timestamp`, so an older transfer is simply not in the
response and the output reads exactly like "nothing arrived". A real test transfer
was chased on the strength of that: eleven days old, on-chain, and already in the
`deposits` table.

`tron:inspect` records no deposit but is not silent — every TronGrid call is
instrumented, so it writes `pipeline_events` and opens the runtime pool. It closes
it explicitly on exit.

### 18.8 The retired per-user address pool (history only)

Nanotron used to hand each customer an address from a pool
(`deposit_addresses`, `deposit_address_assignments`, a sweep, a quarantine, a
release cron). **It was removed on 2026-09-27 in favour of one address + deposit
requests (§18.4).** No code allocates, assigns, releases or retires an address
any more.

**The two tables are kept, deliberately.** They are the record of which customer
was shown which address when, and historical deposits were attributed through
them — evidence, not configuration. Nothing writes them. **Do not drop them**
without first deciding how those attributions stay answerable.

Their addresses stay on the scanner's watch list (`listWatchedAddresses`: the
active address, the environment's, every address a request was quoted, every
address with a scan cursor, and every legacy pool row), because a stray transfer
to an address that stopped being advertised is still money. It is recorded
unattributed with reason `legacy_address` — never auto-credited to the former
holder.

**Why there is no address derivation — unchanged.** BIP-44 derivation needs an
xpub generated by the operator with offline tooling; the mnemonic, seed, xprv and
any private key must never reach this application, the browser, the database,
logs, API responses **or the coding assistant building the feature**. Every
address here is one an operator produced and pasted. Sweeping funds would still
need a signing key that is never this application's.

### 18.9 Deposit configuration in the CRM

`/admin/deposits/configuration`: network, asset, the **active address** and its
source — `deposit_settings` (saved here) or `TRON_PLATFORM_DEPOSIT_ADDRESS`
(the default until something is saved, which is why deploying this changed no
customer-facing address) — last updated/by, and the audit history.

- Changing it is `setDepositAddressAction` → `requirePermission("deposits")`
  (`manage`) → `setDepositAddress`, which **validates the base58 checksum
  server-side** and refuses the token contract, then upserts and writes a
  `deposit_address_configured` audit entry naming the old and new address in the
  same transaction. A reason is required.
- A request copies the address onto its own row at creation, so a change never
  redirects a request already quoted; the scanner keeps watching the old one.
- **The client never supplies the address.** The deposit screen reads it
  server-side (`getActiveDepositAddress`); it is not in any bundle.

**Two things this screen must never become.** Not an environment editor —
`TRON_NETWORK`, the grid URL, the API key and `CRON_SECRET` are deployment
configuration. And it never *generates* an address (§18.8).

---

## 19. Authentication

### 19.1 The shape

```
   auth.users            (Supabase — credentials, OTP issuance, sessions)
        |
        |  auth_user_id  (uuid, unique, nullable)
        v
   public.users          (application account)
        |
        v
   wallet / KYC / investments / deposits / referrals
```

**Nothing in `public` stores a sign-in credential.** No password, no hash, no
OTP, no token. **There is a test asserting no column in the schema is named like
one** — a second authority would start with somebody adding a column, and that
fails the suite. It allows exactly one exception: `withdrawal_passwords.password_hash`,
a scrypt hash of a spending authorisation the product itself defines (§27) — not
a way to sign in. Do not widen that allowance.

`auth_user_id` is nullable because the seeded accounts have no credential; they
exist to populate the CRM, and giving them auth users would create sign-in-able
accounts nobody owns.

### 19.2 The flow

```
 /login  →  email  →  Supabase sends a code  →  code  →  verifyOtp
                                                            |
                                          session cookie written by supabase-js
                                                            |
                                              completeSignIn (server action)
                                                            |
                              existing public.users? ── yes ──→  /
                                            |
                                            no
                                            |
                              create account  →  /complete-profile  →  /
```

The browser never generates, stores or checks a code. `shouldCreateUser: true`, so
sign-in and sign-up are one path.

**Linking by email.** If a `public.users` row already carries the verified email and
has no `auth_user_id`, it is adopted rather than duplicated. Safe **only** because
Supabase has just proved control of the mailbox — **the ordering, verify first and
link second, is what stops it being an account-takeover primitive.**

### 19.3 Email delivery — configured in the Supabase dashboard, never here

Keeping SMTP credentials in Supabase means this application never holds them.

| Where | What |
|---|---|
| Authentication → Providers → Email | Enable email; enable **Email OTP** |
| Authentication → Emails → SMTP | Production SMTP host, port, user, password, sender |
| Authentication → Emails → Templates | The **Magic Link** template must contain `{{ .Token }}` — Supabase's default sends a link, and the app expects a code |
| Authentication → URL Configuration | Site URL and redirect allow-list |

Supabase's built-in sender is rate-limited to a handful of emails per hour and is
for development only.

### 19.4 Identity, server-side

- `getAuthPrincipal()` **verifies** the token rather than decoding it, via
  `supabase.auth.getClaims()`, which checks the JWT signature against the project's
  published JWKS. This project signs with **ES256**, so it happens in-process
  (370ms for the first call, caching the key set, then 1–3ms). It replaced
  `getUser()`, a network round trip at 385ms on every authenticated request and
  averaging 1,024ms under load.

  **This is not `getSession()`, and the difference is the whole point.**
  `getSession()` decodes an attacker-controlled cookie and believes it;
  `getClaims()` checks a signature that cannot be forged and rejects anything
  expired. Under a legacy HS256 secret the SDK falls back to a network `getUser()`
  on its own. What it gives up is server-side revocation before expiry — which
  costs nothing here, because this deployment cannot revoke server-side at all
  (§19.6, §20.3).
- **An outage is not a sign-out.** `getAuthPrincipal()` returns null only when a
  token is genuinely absent, expired or rejected; when the provider cannot be
  *reached* it throws `AuthProviderUnavailableError` and `(app)/layout.tsx` renders
  the shell with a recoverable notice. **Do not collapse those two cases back
  together.**
- **A page-render read redirects; a server action throws. Never mix them in one
  `Promise.all`.** `resolveUserIdForPage()` / `requireCurrentUserIdForPage()`
  redirect to `/login`; `resolveUserId()` / `requireCurrentUserId()` throw
  `NotAuthenticatedError`. **A layout's gate does not stop the page beneath it** —
  Next renders the two in parallel — so a page's reads run for an unauthenticated
  visitor anyway and `Promise.all` rejects with whichever settles first. Measured:
  8 of 8 unauthenticated requests logged a bare `NotAuthenticatedError` while still
  answering 307. **The rule is about the call site, not the service:** reached only
  from a server component, use the redirecting resolver; an action keeps the
  throwing one. The exception is a read awaited inside a `SectionBoundary`, whose
  error boundary does not re-throw `NEXT_REDIRECT` and would swallow it.
- Server actions take no `userId` — the account comes from the session, so there is
  no parameter to tamper with.
- **The middleware refreshes the session cookie and decides nothing.** The gate is
  in `(app)/layout.tsx` and in every action. Middleware as the boundary is how an
  app ends up protected only where somebody remembered a matcher.

### 19.5 Unauthenticated behaviour

Every route under `(app)` redirects to `/login` — verified by request, not by
inspection. No wallet, no allocations, no verification status, no referral data,
and no demo account when Supabase is unconfigured. `(app)` is `force-dynamic`:
those pages render one account's data and must never be prerendered.

### 19.6 Environment

```
NEXT_PUBLIC_SUPABASE_URL         # public, identifies the project
NEXT_PUBLIC_SUPABASE_ANON_KEY    # public by design, RLS-scoped
```

**The service-role key is not used anywhere and must not be added.** It bypasses
row-level security, so a copy in the browser is a copy of the database. Privileged
work runs server-side over `DATABASE_URL`, a separate credential.

### 19.7 Customer phone sign-in (Firebase)

§19.1–19.6 describe the Supabase path, which is now **legacy email customers
only** (operators moved to SMS, §20). Customers sign in at `/login` with a mobile number and an SMS
code:

```
 browser: Firebase signInWithPhoneNumber (invisible reCAPTCHA) → confirm(code)
          → ID token (in memory only: inMemoryPersistence)
 server:  completePhoneSignInAction(idToken)
          verifyPhoneIdToken: signature, project (public id only — no key),
                              sign_in_provider = phone, auth_time < 5 min
          → normalise phone (+91 only) → ensureAccountForFirebasePrincipal
          → issueCustomerSession: HMAC-signed httpOnly `nanotron-session`
            {firebase uid, users.session_epoch, exp ≤ 14 days}
 browser: signOut() of the in-memory Firebase user; the cookie is the session
```

- **No Firebase service-account key exists in this deployment.** Verifying an
  ID token needs only the project id; minting Firebase session cookies would
  need a key that can impersonate any user, so the server issues its own
  session instead, signed with `CUSTOMER_SESSION_SECRET`
  (`customer-session-token.ts`, tested). **Do not reintroduce
  `createSessionCookie` / a service account to "simplify" this.**
- **`package.json` overrides `jwks-rsa`'s `jose` to 5.x, and removing it takes
  production down.** `firebase-admin` → `jwks-rsa` 4 does `require('jose')`;
  jose 6 is ESM-only, and a runtime without `require(esm)` (Vercel, 2026-10-01)
  fails every route that loads `firebase-admin/auth` — a passing build proves
  nothing, because Next externalizes the package. Test a change with
  `NODE_OPTIONS=--no-experimental-require-module next start`. ID-token
  verification never touches jose (x509 certs, not JWKS).
- **`getCustomerPrincipal()`** (`server/auth/customer-session.ts`) is the one
  customer identity question: a valid session cookie first (verified locally,
  no network), else the legacy Supabase session. `getAuthenticatedAccount()`
  resolves through `users.firebase_uid` or `users.auth_user_id` accordingly,
  and **refuses a phone session whose epoch is not the account's current
  `session_epoch`** — on the same read, so revocation costs no round trip.
- **The mapping rules are `server/auth/phone-identity.ts`, pure and tested.** A
  uid reaches only the account it was linked to; **nothing is ever linked by the
  unverified `users.phone`**; a verified number or uid already on another account
  is *refused*, never merged. `users.phone_e164` (unique) is written only from a
  verified token's `phone_number`; `users.firebase_uid` is unique; neither is the
  account key.
- **Existing customers** sign in once at `/login/email`; the app gate sends an
  email session whose account has no `firebase_uid` to `/link-phone` (only while
  phone sign-in is live), where `linkPhoneAction` attaches the verified number
  to *that* account. With phone sign-in live, email sign-in creates no accounts.
  **The email pages (`/login/email`, `/signup`, `/forgot-password`) and
  `completeSignIn` are off unless `LEGACY_EMAIL_SIGN_IN=true`**
  (`isLegacyEmailSignInEnabled`) — turn it on only for a migration window.
  `/update-password` stays open: operator password resets land there.
- **Local test sign-in** (`server/auth/dev-test-auth.ts`, tested): one fixed
  test number and code for a customer, one code for the dev operator, from
  `.env.local` (`DEV_TEST_*`). Four gates, all required: `NODE_ENV ===
  "development"` (inlined at build, so a production build contains a dead
  branch), `DEV_TEST_AUTH=true`, a localhost `Host`/`X-Forwarded-Host`, and the
  values configured. It replaces only the code delivery: the customer path runs
  `ensureAccountForFirebasePrincipal` → `issueCustomerSession` under a
  `dev-local:` uid; the operator path signs in to Supabase as `DEV_ADMIN_EMAIL`
  and then the ordinary `completeOperatorSignIn` decides. **Firebase "test phone
  numbers" are deliberately not used**: they are per Firebase project, and one
  project serves every environment, so they would work in production too.
- **`isPhoneSignInLive()`** needs the web config, the project id and
  `CUSTOMER_SESSION_SECRET`.
  Without them `/login` says so and email sign-in keeps working — no half-flow.
- Abuse: Firebase's per-number limits and reCAPTCHA; the Firebase console's SMS
  region policy (India only); a per-address window on the two actions
  (`server/rate-limit.ts`, process-local — FUTURE_TASKS for multi-instance);
  a client resend cooldown and five-wrong-codes cap (courtesies). Messages are
  fixed sentences ("Invalid or expired OTP.") — no Firebase error text, and no
  difference between a new and an existing number before the code is verified.
- **Sign-out** advances `users.session_epoch` and clears the cookie: every
  phone session for the account ends on every device on its next request. The
  CRM's *log out all devices* does the same (and says a legacy email session
  is not invalidated). Rotating the secret signs every customer out.
- Operators: §20 (mobile number + SMS code). Setup: `docs/rollout-phone-s3-deposits-pwa.md` §1.

---

## 20. Operator authentication

```
   Firebase phone auth   (SMS code → ID token, verified server-side, no key)
        |
        |  firebase_uid, bound on the first verified sign-in to
        |  the phone_e164 a master admin provisioned
        v
   admin_agents  →  nanotron-operator-session cookie (HMAC, audience "operator",
                    session_epoch, 12 h)  →  requirePermission on every action
```

**How an operator proves who they are: mobile number → SMS code.** The browser
gets a Firebase ID token (`usePhoneOtp`) and sends it once to
`completeOperatorPhoneSignIn`, which verifies it (`verifyPhoneProof`: signature,
project, `sign_in_provider = phone`, `auth_time` < 5 min), then
`signInOperatorByPhone` decides with `decideOperatorPhoneSignIn` (pure, tested):

- a uid already bound to an operator → that operator, if the number still matches;
- a number a master admin provisioned with no uid bound → bind this uid (first
  sign-in; an `invited` operator becomes `active`);
- a number bound to a different uid → refused, never silently re-bound;
- otherwise → not an operator.

**The access-code gate comes first** (`server/admin/access-gate.ts`, tested).
The number must be configured in `ADMIN_LOGIN_ACCOUNTS` (`mobile:code,…`, each
administrator with their OWN 10-character code) or in the original
`ADMIN_LOGIN_MOBILE` + shared `ADMIN_LOGIN_ACCESS_CODE`; the forms merge, a
number with two different codes is dropped, and the typed code is compared
against THAT number's code only. Server-only env values, read per call (a
restart picks up a change), never stored, logged or returned. A correct code sets a 15-minute
signed httpOnly pass bound to that number, and `completeOperatorPhoneSignIn`
refuses a verified SMS without it, because Firebase sends the SMS from the
browser and the server cannot stop that call itself. Both refusals say the same
thing, and both are rate-limited per address and per number. With either value
unset, operator sign-in is refused (fails closed). **Every operator, agents
included, needs their number in the gate AND an operator row** (Admin → Agents);
a gate-authorised number with no row is told so after the SMS code.

**First master-admin sign-in.** The seeded `agt_master` has no `phone_e164`, so
no verified number could ever match it. That was the production failure. When
the verified number is in `ADMIN_LOGIN_MOBILE` and no operator row has that
uid or number, sign-in adopts the **one** `master_admin` row with neither a
number nor a uid. It writes the number and the real Firebase uid, and audits
it. Two such rows count as ambiguity and are refused. No row is ever created.
`npm run db:operator-phone` remains the explicit alternative.

**Matching on the number is safe here and never for customers** because an
operator's `phone_e164` is an authorization written by a master admin (Admin →
Agents) or by `npm run db:operator-phone` (the bootstrap for the first master
admin, allowed in production for that reason) — not something the person typed
about themselves. Changing it clears `firebase_uid` and increments
`session_epoch`.

**Supabase email sessions are not accepted at all** (`getCurrentOperator` reads
only the operator cookie). A fallback would leave a working password path into
the console. Consequences: operator password resets are gone (replaced by *End
sessions*), and legacy KYC documents in the Supabase bucket can no longer be
opened from the CRM — that path signs with the operator's own Supabase session.

**The operator cookie can never be a customer cookie.** Same construction as
§19.7, with the audience inside the HMAC (`customer-session-token.ts`, tested);
signed with `OPERATOR_SESSION_SECRET` or, absent that, `CUSTOMER_SESSION_SECRET`.
Sign-out and *End sessions* increment `session_epoch`: every device, next request.

**"Could not verify operator access. Try again."** is the *retryable*
infrastructure outcome — never a verdict. On 2026-09-30 its cause was
`.env.local`: an unquoted `#` in the RDS password truncated `DATABASE_URL`
(write `%23`), and RDS is in a private VPC subnet unreachable from a laptop.
`npm run db:verify` identifies a target and its migration state read-only.

**The two lookups are independent, and that is the design.** A person can be a
customer, an operator, both or neither. **There is deliberately no `role` column
on `public.users`** — that would put every customer row one `UPDATE` away from
being an administrator.

### 20.1 The route group

```
app/admin/layout.tsx          no shell, no store, no gate
app/admin/login/              reachable without a session
app/admin/(console)/          everything else, behind the gate
```

A layout cannot be removed by a descendant, so a gate at `/admin` would gate the
sign-in page too and loop. The group adds no path segment. **Do not collapse it.**

### 20.2 What changed, and why it had to

The permission *model* was already enforced server-side; the *identity* was not.
The agent id arrived from the browser via a demo "view as" dropdown, so a caller
could name themselves master admin and approve a verification case, credit a
deposit or unblock an account. `server/admin/guard.ts` was deleted rather than
adapted — its `requirePermission(claim, …)` took the agent id as an argument, which
was the whole problem.

### 20.3 Still missing

- **Server-side session revocation** — needs the service-role key (§19.6). The CRM
  marks a device session revoked and says plainly that the credential is not
  invalidated. **Do not change that message without changing the behaviour.**
- **Operator credential provisioning from the CRM** — linking a Supabase credential
  is a separate step (`npm run db:dev-accounts` in development).
- Username sign-in. (Customers now sign in by phone — §19.7.)

---

## 21. Development accounts

`npm run db:dev-accounts` links development credentials to a seeded operator and to
an application account:

```
DEV_ADMIN_EMAIL / DEV_ADMIN_PASSWORD    → the seeded master admin
DEV_TEST_EMAIL  / DEV_TEST_PASSWORD     → a customer account
```

Environment variables only. **No credential appears in source, in the database, or
in this file**; the script prints email addresses and never a password, and refuses
under `NODE_ENV=production`.

It creates the Supabase user through the ordinary public `signUp` endpoint —
deliberately *not* the admin API, which needs the service-role key. The cost is
that email confirmation applies: with `mailer_autoconfirm` off (the default, and
what production should use), the address must be confirmed once. The script says so
rather than pretending otherwise.

The customer account is deliberately **not** linked to a seeded user — a test
account should start empty, which is the state a real registration produces.

> Supabase's built-in sender is rate-limited. Hitting that limit is the expected
> failure mode of this script, not a bug in it.

---

## 22. Observability

Two tables, two questions. **Keep them separate.**

| | `audit_logs` | `pipeline_events` |
|---|---|---|
| Answers | Who decided what | What the system did |
| Written | Inside the caller's transaction | Outside it |
| On rollback | Disappears with the decision | **Survives** — that is the point |
| Lifetime | Evidence; kept | Diagnostics; prunable |
| A failed write | Fails the operation | Is swallowed |

An audit entry records authority somebody may have to answer for. A pipeline event
records an attempt — most describe operations nobody decided, and a rolled-back
attempt is the interesting kind.

### 22.1 Correlation ids

One per request, stamped by the **middleware** onto the forwarded request headers
and propagated through `AsyncLocalStorage`, so nested services inherit it without a
`correlationId` parameter on every signature. The layout, the page and every service
in one render share an id — before that a single page load appeared as three
unrelated fragments.

**Joining the browser to the server.** A client-side navigation is an RSC fetch Next
issues itself: no hook to add a header. A short-lived cookie is the one channel that
rides along automatically, so `NavigationTracer` writes the id it generated on click
and the middleware adopts it.

A client-supplied id is a **diagnostic label**: validated for shape, never for
authority. It selects nothing and grants nothing; the worst a forged one achieves is
mislabelling its own rows.

```ts
return withCorrelation(async (correlationId) => {
  await trackPipeline({ pipeline: "kyc", operation: "kyc.submit", … }, () => …);
});
```

`trackPipeline()` times the work, records the outcome, and **re-throws on failure**.
It observes; it does not handle. Swallowing there would turn every instrumented call
into one that silently succeeds.

### 22.1a Recording must never be measurable

A round trip costs ~200ms warm and ~2,000ms cold (§16.1a), so a dozen synchronous
inserts would make a request several times slower than the problem they diagnose.

- `recordPipelineEvent()` is **synchronous** and issues no query — it appends to a
  buffer on the request's async context.
- The buffer is written **once**, as a single multi-row insert, handed to `after()`
  so it runs *after the response*.
- Work with no response to come after — the scanner, a script — flushes when its
  trace closes. The browser batches its events and posts them with `sendBeacon`,
  once, on navigation complete.
- **`/api/trace` does all of its work in `after()` and nothing before the 204.** It
  used to resolve the account and write rows first — 720–1,270ms per beacon, holding
  connections while the person's next page read from the same pool, and `sendBeacon`
  never waits for the answer.
- **Every write is wrapped in try/catch and swallowed.** A logging failure must never
  fail a KYC submission, deposit, withdrawal, investment, login or navigation.

**`pipeline_events` cannot record a failure to *acquire a connection*, and must not
be trusted to.** Every row is written over the runtime pool, so when the pool is what
failed the insert fails for the same reason and is swallowed — the incident erases
its own evidence. Verified: after a real `EMAXCONNSESSION` the table held **zero**
`database.connectRetry` rows for the surrounding week, although `resilientRead`
classifies and records that error correctly. `reportInfrastructureFault()` is the
answer — one structured, redacted, rate-limited JSON line on **stderr**, the only
channel that survives an unreachable database. **It is wired to pool exhaustion
only; extending it to anything that recovers on its own would be the noisy logging
this codebase deliberately does not have.**

**`AsyncLocalStorage` does not cross from a layout into the page beneath it.**
`traceRender` in `(app)/layout.tsx` covers the layout body only; every event a *page*
records finds no trace, which is why that path coalesces into one insert on a short
timer (`enqueueUntraced`). **If you add a trace wrapper somewhere new, check what it
actually covers rather than what it appears to.**

### 22.2 What must never be recorded

Passwords, access or refresh tokens, session cookies, the Supabase service-role key,
the TronGrid API key, private keys, whole bank account numbers, identity document
numbers.

`metadata` is free-form `jsonb`, the easiest place in the schema to leak something by
accident. Two guards: the helper takes **named scalars only** (nothing writes a
request body), and `redact()` strips connection strings, `apikey`/`token`/`password`
pairs and JWTs from error text before storage.

**Errors are recorded with their whole cause chain.** `describeError()` walks up to
four levels and `errorDiagnostics()` puts `errorCode`, `errorName` and
`errorSeverity` in `metadata`. Not decoration: it used to record
`${error.name}: ${error.message}`, one level deep, and Drizzle wraps every driver
failure in a `DrizzleQueryError` whose message is the SQL text and whose `cause`
carries the SQLSTATE — so **every database failure in the system log recorded the
query and threw away the reason**, which is why a connection fault went undiagnosed
for weeks. Every level goes through `redact()`.

---

## 23. What is deliberately still missing

- **Server-side session revocation for operators and legacy email sessions** (§19.6, §20.3). Phone sessions are revocable (§19.7).
- **Real withdrawals** — requests hold a balance and create a record an operator
  works; nothing pays out (§17.4).
- **Outbound blockchain** — no signing, no key custody, no sending (§18.1).
- **An automated KYC provider.** Documents are real — captured, uploaded to a
  private bucket, opened by a reviewer through a signed URL (§16.1c). What is
  missing is a service that *checks* them; today a human compares the selfie with
  the ID.

  The document step opens the OS file picker or the camera and validates type and
  size; the selfie step opens the device camera through `getUserMedia`, with an
  `<input capture>` fallback because `mediaDevices` does not exist on an insecure
  origin — which is every phone testing a LAN address. The person types their
  document number and **only its last four characters leave the browser**; the
  server composes the mask.

  **Uploads are OPTIONAL (client decision, 2026-10)** — a submission needs a
  verified mobile number, the onboarding profile, date of birth and the
  document type + last four characters; the document photo/PDF and the live
  photo are each optional (`kycFileReferencesRefusal`, pure and tested). A file
  that IS referenced must be a whole, verified upload: each storage key is
  bound to its kind, a selfie must be an image, and sizes and types are taken
  from storage after upload. A case without files carries `no_document_uploaded`
  / `no_live_photo` flags, the customer sees "Document: not provided", and
  **only a reviewer's approval verifies anybody** — never the submission. Photos are
  resized on the device before upload (`@/lib/image-compress`: 2400 px documents,
  1600 px selfies, JPEG 0.85; PDFs and undecodable images kept as chosen). With
  no document store configured the flow says verification is unavailable. Older
  cases submitted without documents still exist and the CRM says so.

  **`liveness_check_passed` is not a value the client can send.** It used to be, and
  the flow sent `true` whenever a button had been pressed — a claim an operator reads
  as a check that ran and passed, about a check that did not exist. `submitKyc`
  writes `false` and a `liveness_not_verified` risk flag, and the CRM renders that as
  *"Not checked — compare by hand"* rather than as a failure. **Do not reintroduce a
  path that lets a click set it.**
- **A product rule tying commission release to an allocation's *performance*.**
  Release is automatic on a date: `payoutDelayDays` after accrual, at midnight IST
  (§10, §10d). It deliberately does *not* wait for the allocation to have earned
  anything — nothing in the product's terms defines when an allocation is "settled"
  for the purpose of paying a third party. Gating release on the first credited
  earning period, or on maturity, is a product decision and a change to where
  `release_at` is computed — not a change to the release job, which only ever asks
  whether the stamped date has passed.
- **Deposit screenshot storage.** The deposit screen has an optional
  screenshot field that previews on the device and is **never uploaded or
  stored** — it says so on screen. The transaction hash is the proof; storing
  evidence would reuse the S3 adapter (§16.1c) with its own prefix.
- **Migrating Supabase-stored KYC objects to S3** (§16.1c) — the rows say where
  each lives, so old documents stay openable meanwhile.
- **Operator credential provisioning from the CRM** (§20.3).
- **Username sign-in.**
- **The CRM dashboard's headline metrics and chart series**, still on
  `@/data/admin/metrics` (§16.5). Its recent-activity panels and every list screen
  read the database.

---

## 24. The development dataset

Thirty accounts. `SEED_USER_COUNT` in `db/seed/index.ts` is the single place that
number lives. Enough for the CRM's tables, filters and pagination to be exercised
honestly; few enough to read end to end. Every dependent record is filtered against
those thirty ids, so nothing is orphaned and nothing in the CRM links to an account
that does not exist.

It is a **baseline, not a limit** — registrations through the real sign-in flow push
the count past thirty, which is expected and correct.

`npm run db:seed` is destructive: it clears every table and reloads. It does **not**
touch `chain_scan_state`, `investment_earnings` or `pipeline_events`, which are
written by processes rather than fixtures — so a reseed does not rewind the deposit
scanner, invent accruals, or fabricate a system log. Re-running the scanner
re-detects any chain deposits the wipe removed.

A reseed also clears `users`, so it **unlinks every `auth_user_id`**. Real Supabase
credentials survive (they live in `auth.users`, untouched) but their application
accounts do not; the next sign-in creates a fresh, empty one, and
`npm run db:dev-accounts` re-links the development operator.

---

## 25. The installable app (PWA)

The customer app installs to a home screen; the CRM is not offered for install.

- `app/manifest.ts` — standalone, start `/`, icons generated by
  `lib/pwa-icon.tsx` from the sidebar's brand mark (`/pwa-icon/*`,
  `app/apple-icon.tsx`). No binary icons are committed.
- **`public/sw.js` caches hashed static assets and `/offline.html`, and nothing
  else.** Navigations are network-only with the static offline page on a
  network *failure*; server actions, RSC payloads, `/api/*`, the CRM, auth and
  third parties are not intercepted at all. **Never add a page, an RSC payload or
  an API response to it** — a cached page is a cached balance shown as current.
  Registered in production builds only (`ServiceWorkerRegistration`); `/sw.js`
  is served `no-cache` (`next.config.ts`) and excluded from the middleware.
- `InstallPrompt` (in `AppShell`) — the policy is `lib/pwa-install.ts`, tested:
  third session onward, 20 s in, never when standalone, "Not now" for 14 days,
  three dismissals and never again. Chromium gets the native prompt; iPhone/iPad
  get Share → Add to Home Screen → Add; other browsers get nothing. State is
  per-device `localStorage`, every access guarded.
- The session is an httpOnly cookie, so sign-in survives closing and reopening
  the installed app. iOS gives a home-screen app its own cookie jar — signing in
  once inside it is expected, not a bug.

---

## 26. Manual Funds (credit and debit)

`/admin/wallet-credits` ("Manual Funds"), gated on `wallet_credits` (§15.3).
An operator chooses **Manual Credit** or **Manual Debit**, enters a member id
(or account id), an amount and a reason (required for a debit); the review step
shows who that id is, as the server resolved it; confirming applies it once.
A debit is the same path with the sign flipped and is refused by the ledger's
own `available + delta >= 0` when it would overdraw. Each row records
`direction` and `balance_after_usdt`; the audit action is
`wallet_manual_credit` / `wallet_manual_debit`.

- **Money moves only through `applyLedgerEntry`**: one `transactions` row of type
  `adjustment` ("Account credit" to the customer), in one transaction with the
  append-only `manual_credits` decision record and a `wallet_manual_credit`
  audit entry (`creditWalletManually`). Never a direct balance update.
- **Once per confirmation.** The review issues a UUID idempotency key; a
  transaction-scoped advisory lock on it serialises duplicates, and the unique
  index on `manual_credits.idempotency_key` is the backstop. A key reused for a
  different amount or customer is refused. There are tests for sequential and
  concurrent replays and for rollback; do not make them pass by deleting them.
- Credits only: positive, at most 6 decimals, at most 100,000 USDT per credit
  (`MAX_MANUAL_CREDIT_USDT`, a typo guard). A customer can never be the actor.

---

## 27. Withdrawal password

A second secret, separate from sign-in, required by `requestWithdrawalAction`
before `requestWithdrawal` runs.

- **Created once, after a fresh SMS code to the account's own verified number**
  (`createWithdrawalPasswordAction`: the proof's uid and number must equal the
  account's). Rules in `@/lib/withdrawal-password-rules` (shared with the form).
  Stored as scrypt (`@/server/auth/password-hash`); never logged, echoed or put in
  a pipeline event.
- **Checked in its own committed transaction**, so wrong attempts count even
  though the withdrawal is refused: five lock withdrawals for 30 minutes.
- **No self-service reset, deliberately.** "Forgot withdrawal password?" tells the
  customer to contact support. An operator with `security: manage` clears it
  (`resetWithdrawalPasswordAction`, reason required, `withdrawal_password_reset`
  audit entry); the customer then creates a new one through the SMS step. Do not
  add "OTP → new password": whoever holds an unlocked phone could then withdraw.


---

## 28. Support tickets

`support_tickets` (one row per ticket: `user_id`, `subject`, `category`,
`status`, counters) + `ticket_messages` (append-only thread; `author` is
`customer` or `support`). Customer UI: Help centre → *Your support tickets*
(`/settings/support`, `/new`, `/tickets/[id]`; `/support` and `/tickets` redirect
there). Console: `/admin/tickets` (+ `[id]`), gated on `users` — `view` to read,
`manage` to reply or change status, checked on the server in the page and in
`requirePermission` on the action.

- **Ownership is in the SQL.** Every customer read/write names `user_id` from the
  session in its own `WHERE`; a ticket id that is not yours is "not found". The
  client never sends a customer id. **There is an integration test for exactly
  that; do not delete it.**
- **Status says who moves next:** `open` = support's turn (new, or the customer
  replied — which also reopens `resolved`), `awaiting_reply` = the customer's,
  `resolved` = closed. Counters and status change in the message's transaction.
- Limits: 5 unresolved tickets per customer (advisory-locked, so a burst cannot
  pass it), 200 messages per ticket, bounded subject/body (`@/lib/ticket-rules`).
- Operator replies and status changes are audited (`ticket_replied`,
  `ticket_status_changed`, target `ticket`). Customer messages are not.
- Not built: attachments, and an in-app notification when support replies — the
  ticket's status badge in the Help centre is the signal.

## 29. Platform finance settings

USDT deposit rate, USDT withdrawal rate, withdrawal fee (flat + optional
percentage) and the minimum withdrawal live in `platform_settings.currency` /
`.withdrawals` and are edited in Admin → Settings (validated server-side by
`financeSettingsRefusal`). Launch values: ₹100.40 / ₹100.40 / 1.55 USDT / 0 %
(migration `0024`).

- **`resolvePlatformFinance` (`@/lib/platform-finance`) is the one reader.** Any
  missing or unusable stored value becomes the initial value — never a zero rate
  or a negative fee. The constants in `@/constants/app` are those initial values
  and nothing customer-facing reads them directly.
- Display: `getPlatformFinance()` (catalogue cache, cleared by
  `revalidateCatalogue()` on save) → `RatesBoundary` / the console layout →
  `setFxRates()` on the server **and** `FxRatesProvider` in the browser, before
  any child formats an INR figure.
- **A withdrawal is priced from `getPlatformFinanceFresh()` (uncached) inside the
  action.** The browser sends the figures it *displayed* only so the server can
  notice they changed and refuse (`quoteChanged`) — they are never used to price.
  The rate and fees are stored on the withdrawal row, so changing a setting
  never touches a past record.
- Support email: `platform.supportEmail` (validated on write by
  `updateSettingsAction` and on read by `parseSupportEmail`), falling back to
  `NEXT_PUBLIC_SUPPORT_EMAIL`. Telegram: §2.

## 30. A restricted account is refused everywhere, not only on pages

Blocking, suspending or deactivating a customer in the console takes effect on
their next request by **any** route. Pages: the `(app)` layout and
`requireCurrentUserIdForPage` redirect to `/login`, which says the account is
blocked. **Server actions: every customer action resolves its account through
`getUsableAccount()` (`@/server/auth/account`), which returns null for a locked
account** — a server action is a direct POST and never renders a page, so the
layout's check alone left a still-valid cookie able to withdraw or invest.
`signOutAction` deliberately uses `getAuthenticatedAccount()` so a restricted
customer can still end their session. Data and ledger history are untouched, and
setting the status back to `active` restores access.
