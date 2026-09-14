# CLAUDE.md — Nanotron

**Read this file before making any change to this project.**

This is the permanent instruction and knowledge file for the codebase. It
describes what the application is, how it is built, and the rules to follow.
It is not a changelog — factual history of changes belongs in `CHANGELOG.md`.

---

## 0. Two applications, one codebase

This repository contains **two separate frontends** that share a design system,
a currency layer and a set of domain types:

| | User application | Master CRM |
|---|---|---|
| Routes | `/`, `/plans`, `/wallet`, `/referral`, `/settings` | `/admin/*` |
| Source | `src/app/(app)/`, `src/components/{home,plans,wallet,referral,settings}/` | `src/app/admin/`, `src/components/admin/` |
| Shell | `AppShell` — bottom nav, mobile-first | `AdminShell` — sidebar, desktop-first |
| State | `src/lib/prototype-store.tsx` | `src/lib/admin-store.tsx` |
| Data | `src/data/` | `src/data/admin/` |
| Priority | **Mobile-first** (§7) | **Desktop-first**, usable on tablet/phone |

They are deliberately isolated: neither imports the other's shell, navigation or
store. What they *do* share is `components/ui`, `components/shared`,
`lib/currency`, `lib/utils`, `utils/format` and `src/types`. Sections §1–§14
below describe the user application unless stated otherwise; §15 covers the
Master CRM.

---

## 1. What this application is

Nanotron is a **mobile-first crypto investment platform** delivered as a web
application. A user funds an account in USDT, allocates into managed investment
plans, tracks profits and rewards, refers other users for commission, and
withdraws to an Indian bank account in INR.

It should feel like a modern consumer **finance app** — calm, spacious, legible
— accessed through a browser.

### What it is NOT

It is **not a cryptocurrency exchange**. Do not build, and do not let scope
creep introduce:

- Buy/sell trading or swap interfaces
- Trading pairs, order books, depth charts
- Futures, margin, leverage
- A trading terminal or candlestick/exchange-style charts
- A USDT trading interface

If a request seems to imply any of the above, stop and clarify.

---

## 2. Current project scope

**Authentication is Supabase Auth** — email and password, with a one-time code
as an alternative. Sign-up, email confirmation, sign-in and password reset all
work. There is no demo account and no automatic sign-in: an unauthenticated
visitor gets the sign-in page and nothing else (§19).

**Operators authenticate too** (§20). `/admin` is closed without an operator
session, resolved from `admin_agents.auth_user_id`. This was the build's most
significant gap and it is closed.

**Reads and writes both go to PostgreSQL, in both applications.** Neither the
user application nor the CRM holds business state in browser memory any more.
The two client stores are read caches of what the server sent; every mutation is
a server action → service → one transaction → audit entry → revalidation.

**Persistent state lives in the database, not in a store.** A KYC submission, an
operator decision, a detected deposit, an allocation, a withdrawal request, a
notification preference and a second-factor toggle are all rows.

**Deposits are detected on TRON** — mainnet or a testnet, whichever
`TRON_NETWORK` names — by a server-side scanner (§18). A transfer to an address
assigned to a user is attributed and credited automatically; a transfer to the
shared legacy address is attributed by an operator, because one platform address
cannot tell you whose money arrived (§18.4).

**Every mutation is traceable.** `pipeline_events` records what the machinery
did, with timings and a correlation id per request, and `/admin/system-logs`
reads it (§22).

**The application still runs with no database at all.** With `DATABASE_URL`
unset, catalogue and platform reads return the seed modules in `@/data`. User-
scoped reads and every write refuse instead, which is deliberate — see §16.3.

### Intentionally NOT implemented

- **Outbound** blockchain: no signing, no key material, no sending. Deposits are
  read from the chain; nothing is ever written to it (§18).
- TRON mainnet **outbound**. Mainnet *reads* are enabled (§18.1) and the
  scanner credits real TRC-20 USDT transfers; nothing is ever signed or sent in
  either direction.
- Real withdrawals or a payment gateway. Withdrawal records exist and hold a
  balance; nothing pays anyone (§17.4).
- **Server-side session revocation.** The CRM marks a device session revoked;
  it cannot invalidate the Supabase refresh token behind it, because that needs
  the service-role key this project deliberately does not hold (§19.6). The UI
  and the audit line both say so rather than implying otherwise.
- **True per-user, HD-derived deposit addresses.** A small *pool* of
  operator-provided addresses exists and makes attribution automatic for
  whichever user each one is assigned to (§18.8) — but the pool is not
  minted per signup, and no address in it is derived from a private key this
  application has ever touched. That is a deliberate key-custody decision,
  not an oversight: see §18.8 for exactly what is missing and why it was not
  guessed at.
- A real KYC provider, **and no document storage**. The flow now opens the real
  file picker and the real camera, but nothing is transmitted: only the document
  type, the real filename, its size and the last four characters of the document
  number are recorded. `liveness_check_passed` is therefore always `false` and
  carries a `liveness_not_verified` risk flag — see §23.
- Real notification delivery beyond in-app.
- Phone/SMS one-time codes. Email only; the `phone` field is preserved on the
  profile so it can be added without a migration.

The architecture exists so these can be integrated **without rebuilding the
UI**. Search the codebase for `INTEGRATION POINT` — each marks a seam where a
real service replaces mock behaviour.

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
| Animation | `motion` — use only where it genuinely helps |
| Fonts | `next/font` (Geist Sans + Geist Mono) |
| QR codes | `qrcode`, **server-side only** |
| Database | PostgreSQL 17 (Supabase, session pooler) |
| ORM | Drizzle ORM, with `postgres` (postgres.js) as the driver |
| Migrations | `drizzle-kit` — generated SQL, checked in under `drizzle/` |
| Scripts | `tsx` + `dotenv`, for migrate / seed / check |
| Tests | `node:test` via `tsx --test` — no test framework dependency |

Import alias: `@/*` → `src/*`. Use it everywhere; no deep relative paths.

**Do not add dependencies without a clear need.** Prefer composing what is
already here.

---

## 4. Project architecture

### 4.1 The server/client split — the most important rule

Pages are **Server Components** by default. Client components exist only where
interaction or mutable account state requires them.

The split is:

- **Server** — page shells, headers, static catalogue content (plans, VIP
  levels, FAQs, legal copy, referral explainers), and anything derived purely
  from `@/data`.
- **Client** — components that read or mutate the prototype store, and
  components with local UI state (filters, tabs, sheets, multi-step flows).

Container components that bind the store to presentational components are
suffixed `…Live` or live in a `*-sections.tsx` / flow file. Presentational
components (`BalanceCard`, `StatTile`, `InvestmentCard`, `TransactionItem`,
`PlanCard`, …) carry **no** `"use client"` directive so they can be used from
either side.

### 4.2 Client state — read caches, not sources of truth

`src/lib/prototype-store.tsx` (user app) and `src/lib/admin-store.tsx` (CRM) are
**caches**. Neither holds an action that changes business state, and neither has
a reducer any more.

- **Seeded by the server.** The route-group layout reads the account, or the
  console layout reads the shell, and passes it in as a prop.
- **Every mutation is a server action.** The component calls it, reports the
  server's own message, and calls `router.refresh()`. There is no optimistic
  update on anything financial: a moment of latency costs far less than a
  confident screen that disagrees with the database. `useOptimistic` appears in
  exactly two places — a notification toggle and a 2FA preference — where being
  briefly wrong costs nothing.
- **They re-sync when the server sends new data.** `useReducer` ignores a
  changed initial state, which is why a write used to land and leave the screen
  stale.

**The CRM's store is deliberately split in two.** `AdminStoreProvider` sits in
the console layout and holds the operator session and the shell;
`AdminDataProvider` sits in each *page* and holds that page's slice. Next.js
re-renders only changed route segments on a client navigation, so a layout does
not run again — anything read there is frozen at the moment the console was
opened. A page segment does re-render. Putting the reads in the layout is what
made a KYC case submitted after the console opened invisible until a hard
reload, and it is the single most important thing to preserve here.

**The shell is one row — platform settings — and nothing else.** It carried the
operator directory too, which meant two extra statements on *every* admin page
to serve the two screens that read it. Both now read it themselves. If you find
yourself adding a slice to `AdminShellData`, that is the fourteen-slice mistake
starting again: put it on the page.

### 4.3 Data layer

Two layers, and the distinction matters:

- `src/data/` — the **seed data**. Still shaped like the payload a real API
  would return. It is now the input to the database seed (§16) and the fallback
  the services return when no database is configured. It is no longer read
  directly by pages or stores.
- `src/server/` — the **service layer**, described in §16. This is what
  application code calls.

Components may still import from `@/data` for **presentation vocabulary** —
`rewardFrequencyLabels`, `riskDescriptions`, `depositStatusLabels`,
`auditActionLabels`, FAQ and legal copy. Those are wording, not records. If it
is a record, it comes from a service.

### 4.4 Currency — single source of truth

**Never perform currency conversion or formatting inside a component.**

- `src/constants/app.ts` holds the mock rates as plain constants.
- `src/lib/currency.ts` owns `getUsdtInrRate()`, conversion and all formatting.
- `src/components/shared/currency-display.tsx` (`CurrencyDisplay`) is the
  component every screen uses to render an amount.

To integrate a live rates API, change **only** `getUsdtInrRate()`.

---

## 5. Folder structure

```
src/
  app/
    layout.tsx              Root document only — fonts, skip link, Toaster.
                            Carries NO shell: each area brings its own.
    not-found.tsx           Global 404 (wraps itself in AppShell)
    globals.css
    (app)/                  ── USER APPLICATION (route group, adds no URL segment)
      layout.tsx            PrototypeStoreProvider + AppShell
      page.tsx              Home
      plans/                Plans + [slug] detail
      wallet/               Wallet, deposit, withdraw, transactions
      referral/             Referral
      settings/             Settings + subpages (kyc, security, wallet,
                            investments, notifications, language, support,
                            legal/[document])
      error.tsx
    admin/                  ── MASTER CRM (see §15)
  components/
    ui/                     shadcn/ui primitives (button, card, sheet, tabs,
                            dropdown-menu, …) — shared by both applications
    navigation/             AppShell, BottomNavigation, DesktopSidebar, TopBar
    shared/                 Cross-section components (CurrencyDisplay,
                            StatTile, InfoRow, SectionHeader, StatusBadge,
                            EmptyState, TransactionItem, ListRow, CopyField,
                            QrCode, EarningsChart, PageHeader, notices)
    home/  plans/  wallet/  referral/  settings/
                            Section-specific components
    admin/                  Master CRM components (see §15)
  constants/                app.ts (config, rates), navigation.ts (the 5 tabs),
                            admin.ts (CRM nav + permission catalogue)
  data/                     user, plans, investments, transactions, referrals,
                            notifications, support
    admin/                  CRM mock data (see §15)
  hooks/                    use-copy-to-clipboard, use-mounted
  lib/                      utils (cn), currency, qr (server-only),
                            prototype-store, admin-store, admin-permissions
  types/                    index.ts (user domain), admin.ts (CRM domain)
  utils/                    Pure formatters with no app knowledge (dates, etc.)

  db/                       ── DATABASE (framework-agnostic, no Next imports)
    schema/                 Tables, enums, relations, shared column builders
    seed/                   Development seed + its test
    scripts/                migrate, seed, check — run via npm scripts
    client.ts               Lazy Drizzle client (postgres.js)
    env.ts                  DATABASE_URL reading; `isDatabaseConfigured()`

  server/                   ── SERVER LAYER (every module is `server-only`)
    repositories/           Queries + row→domain mapping. Tables only.
    services/               What the application calls. Owns the fallback.
    database.ts             `fromDatabase()` — the database/seed-data seam
    current-user.ts         The fixed demo account, until auth exists

drizzle/                    Generated SQL migrations + snapshots (checked in)
drizzle.config.ts           drizzle-kit configuration
.env.example                Environment template — the only tracked .env file
```

**Why the `(app)` route group exists.** A Next.js layout cannot be *removed* by
a descendant, so as long as `AppShell` lived in the root layout, `/admin` would
inherit the mobile bottom navigation. Moving the user routes into a route group
gives each area its own layout without changing a single URL.

**Placement rule:** if a component is used by two or more sections it belongs in
`shared/`; otherwise it belongs in its section folder. `ui/` is reserved for
unopinionated primitives.

---

## 6. Navigation

The app has exactly **five** primary sections: Home, Plans, Wallet, Referral,
Settings.

`src/constants/navigation.ts` is the single source of truth. It drives both the
mobile bottom bar and the desktop sidebar — adding an entry there adds it to
both. Do not hard-code nav items anywhere else.

- **Mobile** — fixed bottom bar, 4.5rem tall plus the safe-area inset.
- **Desktop (`lg` and up)** — the bottom bar is hidden and a 16rem sidebar
  appears.
- Secondary screens use `PageHeader` with an explicit `backHref` (a real link,
  so a shared URL or cold load still works — never `router.back()` alone).

---

## 7. Mobile-first requirement

**This is the highest UI priority.** Design for the phone first; desktop is a
wider frame around the same app, never a separate dashboard.

Target widths: **360, 375, 390, 412, 430**. Check every important screen at
360px before considering work done.

Hard requirements:

- No horizontal page scrolling, ever. Horizontal chip/card rows must scroll
  inside their own `overflow-x-auto` container (see `.edge-scroll`,
  `.no-scrollbar`).
- The bottom navigation must never cover content. Scroll containers reserve
  space with the `.pb-nav` utility. A screen with its own fixed action bar must
  add a spacer for that bar's height *on top of* `.pb-nav`.
- Touch targets ≥ 44px. Button sizes `default`/`lg`/`icon` already satisfy this;
  `xs` is only for chips inside a larger tap area.
- Text never below 11px.
- Form inputs use a 16px base font size, so iOS Safari does not zoom on focus.
- Safe areas respected via `.pt-safe` / `.pb-safe` / `.pb-nav` and
  `viewportFit: "cover"`.
- No labels that truncate at 360px — let them wrap.

Content scrolling *under* the translucent bottom bar is expected and fine;
`.pb-nav` guarantees everything is reachable at full scroll.

---

## 8. UI/UX principles

Visual direction: clean light neutral background, deep-charcoal type, muted
gray secondary text, rounded cards (`rounded-2xl`), hairline borders, large
readable tabular numbers, generous spacing, minimal visual noise.

The accent is a **restrained muted teal** (`--brand`). Use it only for:

- positive values and rewards
- active navigation and selected states
- important status indicators
- the primary call to action

**Avoid:** neon green, heavy gradients, blue/purple "crypto" styling, glow
effects, heavy shadows, glassmorphism everywhere, over-animation, flashy
trading aesthetics.

Other rules:

- Numeric readouts use the `.tabular` utility so digits do not jitter.
- Status vocabulary is centralised in `StatusBadge` — never invent new status
  labels or colours inline.
- Meaning is never carried by colour alone (risk uses filled steps + a label;
  statuses pair an icon with text).
- One inverted (charcoal) surface per screen at most — reserved for the hero
  balance.

---

## 9. Currency conventions

Both currencies appear throughout.

- **USDT is primary** — the platform and deposit/settlement currency. It is the
  larger, prominent figure.
- **INR is secondary** — an *approximate* local equivalent, shown smaller and
  prefixed with `≈`.

```
Available Balance
1,250.00 USDT
≈ ₹1,04,000 INR
```

Rules:

- INR uses the `en-IN` locale (lakh/crore grouping). This is intentional.
- Wherever INR is prominent, render `<RateNote />`. The conversion must never
  read as a live market quote.
- Deposits are **USDT only**.
- Withdrawals pay out in **INR** and must show: amount, quoted payout rate,
  every fee, and the exact net INR the user receives. The payout rate is
  deliberately distinct from the indicative display rate.

---

## 10. Important business concepts

- **Plan** — an investment product with a min/max, a term, a projected return
  *range*, a reward frequency and a risk level.
- **Investment** — a user's allocation into a plan; accrues profit, has a term
  progress and a next reward date.
- **Reward** — profit credited to the available balance on the plan's schedule.
- **KYC** — required before investing or withdrawing. Both flows gate on it.
- **Referral / VIP** — three levels (VIP 1–3) with two commission tiers.
  Percentages and thresholds live in `src/data/referrals.ts` as data (and in
  `vip_levels` once seeded) so a config service can drive them later. Never
  hard-code them in components — and never restate a rate in a service either:
  `referrals-write.service` reads it from `vip_levels`, joined on the
  *beneficiary's* level, so the CRM and the user app can never quote different
  numbers.

  **What an allocation does.** `createInvestment` calls
  `accrueReferralCommission` inside its own transaction: a `commission_entries`
  row for the direct referrer at their tier-1 rate, one for that person's
  referrer at their tier-2 rate, the direct `referrals` row moved
  `registered → active` with its invested and earned totals, and both
  beneficiaries' `referral_accounts` aggregates advanced. Two tiers, never a
  walk up a chain. `activeReferrals` is counted on the *transition* only, under
  a `for update` on the edge, so two allocations arriving together cannot both
  count it.

  **Accrual credits nobody.** Entries are written `pending` with a `release_at`
  and land in `commission_pending_usdt`. Nothing is credited in the allocation's
  own transaction — an accrual is mechanical, a payment to a third party is not,
  and every one of those in this codebase goes through its own explicit,
  audited, idempotent step. There is a test asserting that accrual reaches no
  wallet and writes no ledger row; do not make it pass by deleting it.

  **A `release_at` of null is never due.** Entries accrued before that column
  existed carry no schedule, and the job will not invent a date on which
  somebody's money becomes payable. They stay in the operator's queue.

  **Release is scheduled, and an operator can still do it by hand.** Each entry
  carries a `release_at` stamped at accrual from
  `platform_settings.referrals.payoutDelayDays`, snapped to midnight on the
  business calendar (§10d). `releaseDueCommissions()` — driven nightly by
  `/api/cron/release-commissions` — pays everything whose time has come; the
  *Release* button in `/admin/referrals`, gated on `manage` over `referrals`,
  calls the **same** `releaseCommission()`. One transaction containing the
  ledger row, the balance, the aggregate move and the audit entry, with the
  status transition asserted in the `UPDATE`'s own `WHERE` — so the job running
  twice, two passes overlapping, and the job racing an operator all pay exactly
  once.

  **The programme's switches are read, not decorative.**
  `platform_settings.referrals.programmeEnabled` and `maxTiers` are honoured by
  `accrueReferralCommission`; they were editable in the CRM and ignored for as
  long as they existed. `maxTiers` is clamped to 2 because the VIP table defines
  exactly two commission columns.

  **VIP level advances on its own, and only upward.** The highest level whose
  `required_active_referrals` *and* `required_team_volume_usdt` are both met,
  applied after the commission so an allocation pays at the rate held when it
  was made. There is deliberately no demotion: a level is a rate somebody has
  been earning at, nothing defines when it should be taken away, and doing it as
  a side effect of somebody else's allocation would be the wrong way to find
  out.
- **Deposit lifecycle** — select network → show address → await transfer →
  detected → confirmations accumulate → credited.

### 10a The allocation lifecycle

    deposit → available → allocation (principal locked)
            → scheduled earnings credited → maturity → principal returned

`createInvestment` debits `available`, raises `total_invested` and
`locked_in_investments`, writes the ledger entry, and computes and stores the
allocation's **total scheduled profit** as `projected_profit` — the plan's
`estimated_return_percent` applied to the amount, at the rate in effect the
moment the allocation is made (via `applyPercent()` in `@/db/money`, exact
integer arithmetic, never a JavaScript float on a money value). That figure is
a snapshot: it is computed once, stored on the row, and never recomputed from
the plan again, which is what makes a later edit to the plan's rate reach only
allocations made after it (§10b).

`/api/cron/settle-investments` — hourly, `CRON_SECRET`, same shape as the
deposit scan — does three things, in order, via `settleInvestments()` in
`investment-settlement.service.ts`:

1. **Credits every due earning period** (`creditDueEarnings`). Each fixed-term
   allocation's own schedule (`investment-schedule.ts`'s `earningPeriodsFor`)
   says exactly which periods exist, when each is due, and how much it is
   for — the plan's configured `reward_frequency` (`daily` / `weekly` /
   `monthly` / `on_maturity`) decides the period length, and the engine reads
   it rather than assuming one. `recordInvestmentEarning()` credits each due,
   not-yet-credited period, guarded by a unique index on
   `(investment_id, period_key)` so a replay or an overlapping run cannot pay
   it twice, and by `investments.earnings_credited_periods` — a cursor the
   same credit advances — so a caught-up allocation is not re-attempted every
   tick once there is nothing left to do.
2. **Matures what is due** — recomputes `elapsed_days` and hands everything
   past its `matures_at` to `matureInvestment()`, which returns the principal
   through the ledger. Earnings are credited *before* maturity is checked: an
   allocation's final period is due exactly at `matures_at`, so crediting it
   has to happen while the row is still `active`.
3. **Refreshes the display schedule** — `next_reward_at` and
   `next_reward_amount` for everything still running, recomputed from
   `started_at` and the credited-period cursor rather than incremented, so a
   missed run cannot drift.

All three steps were implemented before the scheduler existed and **had no
caller**: an allocation took the money and then froze, sitting `active` past
its own maturity with the principal still locked and nothing ever credited.

**Non-compounding, exactly.** Every period's amount is a fixed share of the
*original* `projected_profit`, split by `splitEvenly()` (`@/db/money`) using
integer arithmetic on the schema's smallest unit — so the shares always sum to
exactly the total sold, with the last period absorbing whatever the others'
truncation leaves, and a credited period never enlarges the base the next one
is computed from.

**`duration_days: 0` means open-ended, not "already matured" — and not
scheduled for earnings either.** Flexible Reserve is sold as "no fixed term —
funds stay allocated until you withdraw them", and `matures_at` is computed as
`started_at + 0 days`. Any arithmetic that trusts that column alone concludes
such a row matured the instant it was created, and a settler without the
`duration_days > 0` filter would force the principal back out of a product
whose entire point is that the customer chooses when. The same filter excludes
it from `creditDueEarnings`: an open-ended allocation has no term for
`projected_profit` to be a total *over*, so there is no schedule to credit it
against. There are tests named for both; do not remove either filter.

**An open-ended allocation is ended by the customer, and only by them.**
`endOpenEndedInvestment()` → `endAllocationAction` → the *Return funds* control
on the allocation detail screen. It verifies ownership against the row, refuses
anything with a fixed term, honours `platform_settings.investments.allowEarlyExit`,
and then delegates to `matureInvestment()` rather than reimplementing the money —
so the principal comes back through the same guarded, audited transaction the
settler uses, and two clicks return it once.

The product defines this unambiguously and in four places (tagline "Withdraw any
time"; `howItWorks`, `conditions` and `earlyExit` all say funds return at any
time), with **no fee and no forfeiture** — unlike the fixed-term plans, which
name theirs. So the rule applied is the one the copy promises: the whole
principal, immediately.

**The fixed-term plans' early exit is still not implemented**, and refusing it
is deliberate. Starter says "after day 7 with forfeiture of accrued rewards",
Balanced says "after day 30 with a 2% exit fee on principal". Both are rules,
neither is built, and returning the principal in full would be inventing terms
more generous than the ones sold.

### 10b Changing a plan's rate

`updatePlanAction` writes a `plan_rate_history` row whenever an edit changes
`estimated_return_percent` — previous rate, new rate, an `effective_at`
timestamp (always "now"), and the operator who made the change. It is an
append-only audit trail, read by `getPlanRateHistory()`; nothing updates or
deletes a row in it, the same rule `audit_logs` follows.

**It changes nothing about a running allocation.** `investments.projected_profit`
is a snapshot taken at `createInvestment` (§10a) — the plan's terms are copied
onto the allocation, not joined at read time, the same rule that already
applied to a plan's name and duration before this table existed. So:

- a period already credited keeps the amount it was credited at, because
  nothing ever rewrites a settled `investment_earnings` row;
- an allocation's periods **not yet credited** are still paid from its own
  `projected_profit`, computed at the rate it was sold at — a rate change never
  reaches a period the engine has not credited yet, any more than it reaches
  one already credited;
- only an allocation created **after** the edit reads the new rate, because
  `createInvestment` reads `plans` at the moment it runs.

Recomputing a *running* allocation's remaining periods against a new rate was
considered and rejected: nothing in the product's terms tells a customer their
return can change mid-term, and doing so would be inventing a rule on the one
table where inventing rules pays real money. "All accounts enrolled in a plan
are governed by the same rate from that point forward" is therefore true of new
enrollments, not a retroactive repricing of a contract already sold.

### 10c Plan rate tiers — the amount band an allocation is sold at

`plan_rate_tiers` holds one row per amount band per plan: a **half-open**
`[min_amount_usdt, max_amount_usdt)` range, a `rate_percent`, and an `active`
flag. The top band's upper bound is null, meaning open-ended. Three `CHECK`
constraints are in the schema (lower bound ≥ 0, upper bound above lower, rate
above zero); overlap, gap and duplicate-boundary checking is a property of the
whole ladder and lives in `validateTierLadder`.

**A band's percentage means exactly what `plans.estimated_return_percent`
means: projected TOTAL return over the plan's whole term.** It is not a daily
or weekly rate. The reward *cadence* is `plans.reward_frequency` and decides
only how the total is split into periods (§10a). **There is no conversion
between a periodic rate and a total anywhere in this codebase, and none should
be invented** — `createInvestment` applies the resolved rate once via
`applyPercent()`, and `creditDueEarnings` divides that one figure across the
periods. Introducing a per-period meaning for this column would silently
reprice every plan.

**Boundaries are `[min, max)` — lower inclusive, upper exclusive.** 49.99 is in
`10–50`; 50.00 is in `50–100`; 100.00 is in `100+`. Every comparison goes
through `compare()` from `@/db/money`, never a float. There is a test file of
nothing but boundaries; do not make it pass by loosening one.

**Resolution has exactly three outcomes** (`resolveRateForAmount`):

| | |
|---|---|
| no active bands | the plan's own `estimated_return_percent` — which is what every plan did before this table existed |
| a band covers the amount | that band's rate |
| bands exist, none covers the amount | **a refusal** |

The third is the one to preserve. Falling back to the headline rate would hide
a configuration gap behind a number nobody chose, on the table that decides
what somebody's money is sold at.

**The ladder is saved whole, in one transaction** (`savePlanRateTiers`).
Band-at-a-time editing was considered and rejected: contiguity is a property of
the *set*, so widening one band overlaps its neighbour until the neighbour
moves too — an API editing one at a time must either forbid every intermediate
state or let an invalid ladder exist between calls, and an allocation arriving
in that window is priced against a half-written table. Existing rows are
updated **by id**, never deleted and re-inserted, so a band keeps the id an
allocation recorded against it.

**The client never supplies a rate.** `createInvestment` takes a plan id and an
amount; there is no third parameter to forge. The invest sheet resolves a band
for *display* using the same rule, and the receipt shows the rate the server
returned rather than the one the sheet computed. The CRM's preview calls
`previewPlanRate` → `resolveRateForAmount` — the same function — rather than
recomputing in the form: a preview whose only value is showing what the real
rule does must not be a second implementation of it.

**What a tier change does to a running allocation: nothing.** Exactly §10b,
extended. `investments` copies the band onto the row at creation —
`applied_tier_id`, `applied_tier_min_usdt`, `applied_tier_max_usdt`,
`applied_rate_percent` — and `projected_profit` is computed from that copy.
`applied_tier_id` is deliberately **not** a foreign key: a deleted band must
not take the evidence with it, or block its own deletion. So editing,
deactivating or deleting a band reaches only allocations made afterwards, and a
dispute is reconstructable from the allocation row alone.

**Seeding.** `@/data/plans` derives each plan's starting ladder from what the
plan already publishes — round-number boundaries inside its own range, middle
band at the headline rate, outer bands at the ends of the disclosed projected
range. `npm run db:backfill-tiers` applies that to a database that has
migrated without reseeding, and **never touches a plan that already has a
band**.

### 10d The business calendar

`src/lib/business-time.ts` — `Asia/Kolkata`, UTC+05:30, **no daylight saving**.
The one place this application says what a business day is, and the only thing
that needs one: the referral release schedule, because "release at midnight" is
a statement about a calendar and a calendar needs a place.

The place is India because the business already runs on that calendar wherever
money leaves the platform: withdrawals pay out in INR to Indian bank accounts
at an INR payout rate (§9), every INR figure in both applications is formatted
`en-IN`, and `/settings/language` lists Indian locales.

The offset is a constant rather than an `Intl` lookup because India has
observed one offset since 1945 and there is nothing for a DST rule to do. **If
this is ever pointed at a jurisdiction that observes DST, the timezone
database is the fix — not a different number.**

**§11's UTC-pinning rule for displayed dates is unchanged and this does not
weaken it.** Every stored timestamp is still UTC. What changed is that a
release time is rendered with `formatBusinessDateTime`, which writes "IST" out
— the same lesson the system log learned when an operator read a UTC clock as
their own.

Vercel Cron schedules in UTC, so `30 18 * * *` is 00:00 IST. The two halves of
that are exported from the same module and echoed in the route's response, so a
schedule drifting from the calendar it tracks is visible in the output rather
than only in a cron expression nobody re-reads.

**Eligibility is `release_at <= now`, never "became due during this run."** A
pass that does not happen at midnight is *late*, not lossy: the next successful
one finds everything still owed. That is the property that makes the daily
schedule safe, and it is the same reasoning as the deposit scanner's cursor
(§18.5) — polling designs fail by delay, and only if you let them.

### Language discipline (important)

Returns are **never** presented as guaranteed. Always use *estimated*,
*projected*, or *potential*, always show the projected range, and keep risk
disclosure adjacent (`RiskNote`). Screens that look like they move money carry a
`PrototypeNote` making the demo status explicit. Do not remove these.

This is a straightforward compliance-shaped implementation detail, not a
judgement about the product: investment UIs that imply guaranteed returns create
real regulatory exposure, so the wording is deliberate — keep it.

---

## 11. Coding conventions

- TypeScript everywhere; no `any`. Domain types live in `src/types`.
- Function components, named exports (except route files, which default-export).
- `cn()` from `@/lib/utils` for conditional classes.
- Props typed with `React.ComponentProps<…>` where extending a DOM element.
- Comments explain **why**, not what. Do not narrate obvious code.
- Semantic HTML: real `<button>` for actions, `<a>`/`<Link>` for navigation,
  `<ul>/<li>` for lists, proper heading order.
- Accessibility is not optional: labelled controls, `aria-current` on active
  nav, visible focus rings, accessible dialogs (Radix), screen-reader
  equivalents for charts.
- Dates are formatted UTC-pinned in `@/utils/format` to avoid hydration
  mismatches. Never call `new Date()` during render for displayed values.
  **Where a timestamp is read forensically — the system log, the audit trail —
  use `formatDateTimeUtc()`, which appends "UTC".** The pinning is correct and
  must stay, but it silently shows a clock that is not the reader's: an operator
  in India testing at 23:00 IST read 17:30 in the system log and reported the
  log as wrong. Nothing was wrong except that the zone was not written down.
  Product screens keep `formatDateTime` — a bare date is what a person wants
  there and the suffix is noise.

### Component rules

- Never build one enormous page component. Compose small, named pieces.
- Do not duplicate UI — reach for `shared/` first, and add to it when a pattern
  appears twice.
- Keep `"use client"` as low in the tree as possible.

---

## 12. Verification expectations

Before considering any change complete:

```bash
npm run typecheck    # must be clean
npm run lint         # must be clean
npm test             # must pass — node:test via tsx
npm run build        # must succeed
```

**Measuring performance.** Time routes against a *production* build with a real
session, never the dev server: a first dev hit includes route compilation
(2.8–5.2s) that production does not have. And put an idle gap between requests —
back-to-back requests keep the connection pool warm and hide the cost that
actually reaches users (§16.1a). Kill the previous server by PID and confirm the
port is free first; a stale process silently serving the old build produced two
rounds of "no improvement" measurements during this work.

If the change touches the database layer, also run it **both ways**: once with
`DATABASE_URL` unset and once with it set. The fallback (§16.3) means a broken
query can pass unnoticed if you only ever exercise one path — and the test suite
skips its integration tests when there is no database, so a green run proves
less than it looks. `npm run db:check` reports which mode you are in.

Then run the app and actually look at it — at 360px and at desktop. Check for
horizontal overflow, clipped content, elements under the bottom bar, and
console errors. Do not report that something "should work".

---

## 13. Future integration plans

Ordered roughly by dependency.

**Done:** the database itself — schema, migrations, seed and the read path
(§16). Both applications read from PostgreSQL when one is configured.

1. **Auth** — sessions, sign-in/up routes, route protection. `AccountActions`
   in `settings/logout-button.tsx` becomes a real sign-out, and
   `getCurrentUserId()` in `@/server/current-user` becomes a session read.
2. **Writes** — this is what auth unblocks. Add `*.repository` mutations and
   server actions, replace the store reducers with them plus `router.refresh()`,
   and keep consumers unchanged. Money movements must be one transaction with
   the ledger row they produce — and, in the CRM, with their audit entry
   (§15.4).
3. **KYC provider** — documents are now captured, uploaded to a private bucket
   and reviewed by an operator (§16.1c). What remains is *automated* checking:
   swap the manual review for the provider SDK and drive `kycStatus` from their
   webhook. `liveness_check_passed` stays `false` until something can actually
   set it (§23).
4. **Deposit service** — the chain watcher is done and runs against **mainnet**
   (§18). What remains is a deposit-address pool big enough for real usage
   (§18.8 — today it holds one address, so the first account to open the
   deposit screen claims it and the next gets `PoolExhaustedError`), a
   scheduler tighter than one pass a day (§18.5), and removal of the demo
   simulation control.
5. **Withdrawal / payout rails** — real INR payouts and status transitions.
6. **Rates API** — replace `getUsdtInrRate()`.
7. **Investment engine — done.** `/api/cron/settle-investments` credits every
   due earning period, returns principal at term end, and keeps
   `elapsed_days` / `next_reward_at` / `next_reward_amount` current (§10a). The
   configured plan rate is what it actually pays, non-compounding, exact to the
   last decimal place. What remains is the product decision in item 8 below,
   not plumbing.
8. **Referral payouts — done.** Accrual, scheduling and release are all
   implemented: an entry is stamped with a `release_at` at accrual and
   `/api/cron/release-commissions` pays everything due at 00:00 IST (§10,
   §10d). Manual release is preserved and shares the same guarded function.
9. **Reporting** — the CRM dashboard's aggregates and chart series, still on
   seed data for the reason given in §16.5.
10. **Localisation** — `settings/language` lists the intended locales.

---

## 14. Instructions for future Claude Code sessions

1. Read this file first.
2. Read `CHANGELOG.md` for what has actually happened.
3. Inspect before editing. Match the surrounding style.
4. Respect the server/client split in §4.1, the currency rule in §4.4 and the
   data-access rule in §16.2 — application code calls services, never
   repositories, the Drizzle client or `@/data` records.
5. Mobile-first for the user app, always — verify at 360px. The Master CRM is
   desktop-first but must still work at 360px.
6. Never add guaranteed-return language; never remove risk or prototype
   notices. This applies to the CRM too — an operator reads the same figures.
7. Do not introduce dependencies casually.
7a. Never put a connection string, password or key in source. `.env.local` is
   git-ignored; `.env.example` is the tracked template and holds no values.
8. Do not turn this into an exchange or a desktop SaaS dashboard.
9. Keep the two applications isolated (§0, §15.1).
10. Run the checks in §12 and verify in a browser before reporting completion.
11. Update `CHANGELOG.md` with what changed. Keep this file as durable
    knowledge only.

---

## 15. The Master CRM (`/admin`)

The administrative control panel for the platform: users, KYC, deposits,
withdrawals, investments, plans, referrals, agents, notifications, audit logs
and settings.

It is an **operations tool**, not a second consumer product. Dense tables,
sidebar navigation, one filter row per screen, confirmation before anything
consequential. Same visual language as the user app — light neutral surfaces,
charcoal type, restrained muted teal accent, `rounded-2xl` cards — but laid out
for a desk.

**It is not, and must never become, an exchange back office.** The same
prohibition in §1 applies: no trading, order books, pairs, leverage or
candlestick charts.

### 15.1 Isolation rules

- Nothing under `src/app/admin/` or `src/components/admin/` may import
  `AppShell`, `BottomNavigation`, `DesktopSidebar`, `TopBar`, `PageContainer`
  or `prototype-store`.
- Nothing in the user application may import from `components/admin`,
  `data/admin`, `lib/admin-store` or `lib/admin-permissions`.
- Shared ground is `components/ui`, `components/shared`, `lib/currency`,
  `lib/utils`, `utils/format`, `src/types` and `data/referrals` (the VIP
  configuration both sides read).
- `src/app/admin/[...unmatched]/page.tsx` exists so unknown `/admin/*` URLs
  resolve to the admin 404 rather than dropping an operator into the user app's
  shell. Do not delete it.

### 15.2 Routes

| Route | Contents |
|---|---|
| `/admin/login` | Operator sign-in. Outside the console's gate, by necessity. |
| `/admin` | Queue counts, platform totals, four charts, six recent-activity panels |
| `/admin/users` | Searchable/filterable directory, 13 columns, row actions |
| `/admin/users/[id]` | Full profile across 10 tabs (SSG, one page per seed user) |
| `/admin/kyc` | Review queue → case detail with documents, notes and decisions |
| `/admin/deposits` | Deposit ledger; credit / mark-failed |
| `/admin/withdrawals` | Payout queue with full fee arithmetic; approve / reject / mark paid |
| `/admin/investments` | Every allocation, filterable by plan and status |
| `/admin/plans` | Plan catalogue cards; create / edit / disable |
| `/admin/referrals` | Referral accounts + commission ledger, VIP configuration |
| `/admin/agents` | Operator directory, permission matrix, activity |
| `/admin/notifications` | Composer (template → audience → channels) + send history |
| `/admin/audit-logs` | Filterable append-only audit trail |
| `/admin/system-logs` | Pipeline and integration observability (§22) |
| `/admin/settings` | Platform, currency, fee, investment, referral, security config |

Plus `error.tsx`, `not-found.tsx` and the catch-all above.

### 15.3 Roles and the permission model

Two conceptual roles, defined in `src/types/admin.ts`:

- **Master admin** — holds `manage` on everything implicitly. The role *is* the
  grant; their permission map is never consulted.
- **Agent** — holds exactly what has been assigned.

Permissions are **graded, not boolean**: `none` / `view` / `manage`. Real
operations teams need a read-only tier (support staff who look but cannot
approve) distinct from an operator tier.

The 13 governable areas are in `ADMIN_PERMISSIONS` (`src/constants/admin.ts`):
`users`, `user_details`, `kyc`, `deposits`, `withdrawals`, `investments`,
`plans`, `referrals`, `notifications`, `audit_logs`, `settings`, `security`,
`agents`. That list is the contract a backend authorization layer must
implement — do not add a permission to a component without adding it there.

How it is enforced in the UI:

- `AdminNavList` omits destinations the operator cannot `view`.
- `PermissionGate` replaces a whole screen with an access notice.
- `canManage()` disables individual actions rather than hiding them, so the
  operator can see the feature exists and who to ask.

> **`src/lib/admin-permissions.ts` is a usability affordance, never a security
> boundary.** All data is in the client bundle. The same permission ids must be
> enforced server-side on every route handler and query at integration time.

Agent creation starts from a preset (`AGENT_PRESETS`: support, compliance,
finance, operations, custom) rather than 13 empty toggles; the matrix stays
fully editable underneath.

### 15.4 Operator state and operator identity

`src/lib/admin-store.tsx` is a read cache plus the server-resolved operator
session. It used to be a 1,247-line reducer with twenty-two mutating cases;
every one of them rewrote a JavaScript object, appended a convincing entry to an
in-memory audit log, and reached no database.

**The operator comes from a Supabase session.** `admin_agents.auth_user_id` →
`getCurrentOperator()` in `server/admin/session.ts`. The header's demo session
switcher is gone: whatever it was set to travelled with every mutation as the
claimed identity, so a caller could name themselves master admin and approve a
verification case.

**Every operator mutation is a server action** in `src/app/admin/actions.ts`,
and every one begins with `requirePermission(area)`, which resolves the session
and asserts the grant stored in the database in one step — there is no
arrangement of calls that authenticates without authorizing.

Two properties carried over from the reducer and are now enforced by Postgres:

1. **The write and its audit entry are one transaction**, through `mutate()`.
2. **A reason collected by a dialog reaches the audit entry.** Confirmation
   dialogs promise the operator that it is recorded, and several *require* one.
   `withReason()` joins it on. If you add an action that collects a reason,
   thread it through — do not let the dialog lie.

Three actions say less than their names suggest, and the comments explain why in
place: session revocation cannot invalidate a Supabase token, withdrawal
approval pays nobody, and a campaign delivers in-app only.

**Actions live in `src/app/admin/actions.ts`, not under the route.** `(console)`
is a route group, so a page's filesystem path carries a segment its URL does
not; actions imported by client components would otherwise have import paths
like `@/app/admin/(console)/kyc/actions`, which break whenever the grouping
changes.

### 15.5 Components

`src/components/admin/`:

- `layout/` — `AdminShell`, `AdminPage`, `AdminSection`, `AdminSidebar`
  (+ `AdminNavList`, `AdminBrand`), `AdminHeader` (+ operator switcher and the
  mobile nav drawer).
- `shared/` — `AdminStatCard`/`AdminStatGrid`, `DataTable` (+ `DataCard`,
  `DataCardRow`, `PrimaryCell`), `FilterBar`/`SearchField`/`FilterChips`/
  `FilterSelect`, `AdminStatusBadge` (+ `UserStatusBadge`, `KycStatusBadge`,
  `DepositStatusBadge`, `WithdrawalStatusBadge`), `ConfirmActionDialog`,
  `ActivityTimeline`, `AuditLogTable`, `PermissionMatrix`/`PermissionSummary`,
  `PermissionGate`, `UserActionMenu`, `DetailCard`/`DetailList`/`DetailRow`/
  `MonoValue`, `admin-charts`.
- One folder per section: `dashboard/`, `users/`, `kyc/`, `money/`, `plans/`,
  `referrals/`, `agents/`, `notifications/`, `audit/`, `settings/`.

**`DataTable` is the table primitive for every list screen.** It renders the
same rows two ways from one column definition: a real `<table>` from `md` up
inside its own horizontal scroll container, and a card list below it. A
thirteen-column table crammed into 360px is not a readable table, it is a
broken one — so never drop the `renderCard` prop.

Two non-obvious layout constraints, both found by testing and both commented in
place:

- The table's scroll container needs `relative`. The visually-hidden caption
  and `sr-only` column headers are `position: absolute`; without a positioned
  ancestor their containing block is the viewport, so they sit at the table's
  x-offset and make the whole document scroll sideways.
- Chart frames and dashboard panels need `min-w-0`. As grid children the
  default `min-width: auto` lets a 12-point axis widen the track past the
  viewport.

### 15.6 Charts

`admin/shared/admin-charts.tsx`: `PlatformFlowChart` (deposits above a zero
baseline, withdrawals below), `SeriesBarChart`, `TrendChart`,
`StatusBreakdownBar`. Rules followed:

- A single series carries no legend — the heading names it.
- The flow chart encodes direction by **position**, so the reading never
  depends on hue. Two series therefore also get a legend.
- Hues are `--chart-1` (brand teal) and `--chart-5` (amber), validated as a
  pair against the card surface in both modes: CVD ΔE 10.1 light / 9.7 dark and
  normal-vision ΔE 17.9 / 18.0, each above 3:1 contrast. The brand teal sits
  under the usual chroma floor *by design* (§8 mandates a restrained accent),
  which is exactly why position, legend and table view all carry the meaning
  too.
- Every chart ships a screen-reader table. No value is reachable only by hover.

### 15.7 Currency in the CRM

Identical rule to §4.4 — **no component converts or formats currency itself**.
Use `CurrencyDisplay`, `formatUsdt`, `formatUsdtAsInr`, `formatInr`. Withdrawals
show the payout rate stored on the record (quoted at request time), which is
deliberately distinct from the indicative display rate.

### 15.8 Future backend integration

In addition to §13, for the CRM:

1. **Admin auth** — replace the operator switcher with a real session; delete
   the demo control, keep the avatar and role badge.
2. **Server-side authorization** — enforce the §15.3 permission ids on every
   handler. The client checks stay as affordances.
3. **Admin writes** — the reads are done (`@/server/services/admin.service`).
   What remains is turning each reducer case into a mutation plus
   `router.refresh()`, which needs admin auth first: an audit entry naming an
   operator the system cannot authenticate is worth nothing.
4. **Audit log** — becomes backend-written and read-only here. It must never
   become editable or deletable from the UI.
5. **KYC provider** — the case list, documents and decisions become provider
   calls; `reviewedBy` comes from the session.
6. **Chain watcher / payout rails** — drive deposit and withdrawal status
   transitions instead of the reducer.
7. **Configuration service** — `/admin/settings` becomes its write side, and
   `getUsdtInrRate()` reads from it. Until then, editing settings in the CRM
   does **not** move the user application, which still reads
   `@/constants/app`.

---

## 16. The database layer

PostgreSQL, through Drizzle ORM. Reads only — see §2 for why.

### 16.1 Getting a database

```bash
cp .env.example .env.local     # then set DATABASE_URL
npm run db:migrate             # apply drizzle/*.sql
npm run db:seed                # load the development data
npm run db:check               # connected? migrated? seeded?
```

Any PostgreSQL 14+ will do. The development database is a **Supabase** project
(AWS ap-northeast-2, PostgreSQL 17).

**Never put a connection string in source.** `.env.local` is git-ignored;
`.env.example` is the tracked template and contains no values.

Other scripts: `npm run db:generate` after changing the schema,
`npm run db:studio` for Drizzle's table browser, and
`npm run db:backfill-tiers` to give a seeded plan the rate ladder from
`@/data/plans` when a database has migrated without being reseeded (§10c) —
idempotent, and it never touches a plan that already has one.

#### Two connections

| Variable | Used by | Endpoint | Shape |
|---|---|---|---|
| `DATABASE_URL` | every render | session pooler, `:5432` | pooled, `max` **3** per instance |
| `DIRECT_DATABASE_URL` | `db:migrate`, `db:seed`, `db:studio` | session pooler, `:5432` | one connection, opened and closed |

`DIRECT_DATABASE_URL` is optional and falls back to `DATABASE_URL`. It exists
because a migration takes an advisory lock and issues DDL, which wants a session
to itself and has no business sharing the pool the application renders from.

#### Which Supabase endpoint — and why not the one everyone recommends

Supabase offers three. Both variables use the **session pooler**
(`…pooler.supabase.com:5432`), which is not the obvious answer for serverless
and is not free. It is the only one this driver stack can actually run.

- **Direct** (`db.<ref>.supabase.co:5432`) — publishes **AAAA records only**.
  Vercel's serverless runtime has no IPv6 egress, so it cannot reach it at all.
- **Transaction pooler** (`…pooler.supabase.com:6543`) — the standard serverless
  recommendation, and what this was built on first. **It cannot be used with
  postgres.js + Drizzle here.** Re-tested in full; see below.
- **Session pooler** (`…pooler.supabase.com:5432`) — IPv4, and it handles
  everything this application does. Its price is the connection ceiling below.

**Why the transaction pooler is out, measured rather than remembered.**
postgres.js *pipelines*: it writes a query and, without waiting for the reply,
writes the next onto the same socket, up to `max_pipeline` (default 100).
Supavisor in transaction mode cannot demultiplex that — it stops answering, with
no error and no timeout. `prepare: false` does not help, and neither does
trimming the pipeline. On `:6543` with `prepare: false`, 40 concurrent
parameterless queries:

| `max_pipeline` | result |
|---|---|
| 100 (the driver default) | **never settles** |
| 1 | **never settles** |
| 0 | 3.5s, all 40 rows |

So `max_pipeline: 0` fixes the reads — **and breaks every write.** postgres.js
decides whether a connection may accept more work with a single `&&` chain in
`Connection.execute`, and `sent.length < max_pipeline` sits *before*
`q.options.onexecute(connection)` in it. At 0 that test is false, so the
callback never runs — and that callback is what marks a connection reserved for
`sql.begin`. Every transaction then dies on postgres.js's own guard,
`UNSAFE_TRANSACTION: Only use sql.begin, sql.reserved or max: 1`.

That is fatal **for this repository specifically**: every write goes through
`mutate()` → `db.transaction()` → `client.begin()`, because a money movement and
its ledger row and its audit entry must be one transaction (§17.1). The suite
run this way failed 16 tests, all in the write layer.

**RE-TESTED 2026-09-02. THE CONCLUSION HOLDS, THE STATED REASON WAS WRONG.**
Do not repeat this from memory; it has now cost two sessions. With
`prepare: false` and the driver's *default* `max_pipeline` — not 0 — on
postgres.js 3.4.9, against the live project:

| what | result |
|---|---|
| single parameterised query | works |
| 40 concurrent **parameterised** queries | works, 5.3s |
| `db.transaction()`, multi-statement | **works** |
| 10 concurrent transactions | **works** |
| 10 transactions + 20 queries together | **works** |
| 20 concurrent **parameterless** queries | **stalls, and wedges the pool permanently** |

So the "transactions are impossible" half of the old note is **wrong**. That was
an artefact of `max_pipeline: 0`, which breaks `sql.begin` for an unrelated
reason, not a property of transaction mode. Every financial write works on
:6543.

**The real blocker is the simple query protocol, and this repository cannot
avoid it.** Drizzle issues everything through `client.unsafe(sql, params)`, and
postgres.js sets `simple: params.length === 0`. A Drizzle query with no WHERE
clause and no bound values therefore has **zero parameters** and takes the
simple protocol — which Supavisor in transaction mode cannot demultiplex when
pipelined. Measured against the real code, `catalogue.repository` emits four of
its five queries that way (`plans`, `deposit_networks`, `vip_levels`), and those
are read by `/plans`, `/referral`, `/wallet/deposit` and the admin console —
exactly the routes that wedged. Once it jams, the pool never recovers: in the
probe, every subsequent query on that pool failed too.

Making :6543 safe would mean giving every unfiltered SELECT a dummy bind
parameter and keeping it that way forever, enforced by nothing. That is not a
trade worth making.

`usesTransactionPooler()` in `db/env.ts` stays and correctly forces
`prepare: false`, so pointing `DATABASE_URL` at `:6543` is never *silently*
wrong — but nothing should point it there. Getting off session mode still means
changing driver (`node-postgres` does not pipeline, so the simple protocol is
harmless there), not changing port.

**A warning about how to test this.** A hand-written ``sql`select ${x}` `` probe
passes on `:6543` even with the settings that hang the application, because it
carries a bind parameter and so uses the extended query protocol. Drizzle issues
everything through `client.unsafe(sql, params)`, and postgres.js's `unsafe()`
sets `simple: params.length === 0` — so a query with **no** parameters takes the
*simple* protocol, and that is the shape that jams. Probe with `select 1`, not
with a parameterised query, or you will measure the wrong thing. This cost one
wrong conclusion during the work that established the above.

**The way off session mode is a different driver, not a different port.**
`node-postgres` does not pipeline, and `drizzle-orm/node-postgres` speaks to it.
That is a real migration — `db.execute()` returns a `QueryResult` there rather
than a row array, so every caller changes — and it is the correct next step if
this deployment ever needs to scale past a handful of instances.

#### If connections take ~5 seconds each

Some machines' resolvers stall on AAAA lookups before falling back to IPv4.
`getaddrinfo` pays that on every new connection, so a page opening eight of them
times out. Set `DATABASE_FORCE_IPV4=true` in `.env.local`; the Supabase pooler
publishes no AAAA record, so nothing is lost. It is off by default because the
stall is a property of the machine, not of the application.

### 16.1b `npm run db:secure` — RLS and the document bucket

Two pieces of Supabase configuration that a Drizzle migration cannot express.
**Run it after `db:migrate`, and after any migration that adds a table.**

**Row level security was off on every table, and that was a live data leak.**
Supabase publishes the `public` schema over PostgREST at `/rest/v1/...` and
grants `anon` SELECT on it. Drizzle creates tables with RLS disabled, because
RLS is not part of a table definition. Verified against the live project:
`GET /rest/v1/users` with the **anon key — which is public by design and inlined
into the browser bundle** — returned full names, emails, phone numbers, KYC
status and wallet addresses. `wallet_balances`, `transactions`, `deposits`,
`kyc_submissions` and `admin_agents` were equally open. No application code was
involved; the API is a property of the database.

The script enables RLS on every table with **no policies**, which closes
PostgREST completely. The application is unaffected because it does not go
through PostgREST — it connects as `postgres`, which has `rolbypassrls`
(verified, not assumed). `ENABLE`, never `FORCE`: `FORCE` applies RLS to the
table owner too and would lock the application out of its own data.

> A new table is exposed until this runs. That is the one operational rule to
> remember: **migrate, then secure.** There is a regression test
> (`kyc-storage.integration.test.ts`) that reads every table as `anon` and as a
> signed-in customer and requires both to come back empty.

It also provisions the private `kyc-documents` bucket and its policies — see
§16.1c. Neither half needs a service-role key: Supabase keeps buckets and
storage policies in Postgres, so the credential that runs migrations can
provision them, and §19.6's refusal of the service-role key stands.

### 16.1c KYC document storage

A **private** Supabase Storage bucket, `kyc-documents`, with
`file_size_limit` 10 MB and an `allowed_mime_types` allow-list. Object keys are
`{auth_user_id}/{kind}-{timestamp}-{random}.{ext}`; the leading folder is what
every policy keys on. The bytes are never in Postgres —
`kyc_documents.storage_path` holds the key, and `content_type` / `byte_size`
hold what Storage recorded rather than what the browser claimed.

**The browser uploads straight to Storage.** Not a shortcut: a Vercel
serverless function has a ~4.5 MB request body limit and the flow accepts 10 MB,
so routing a passport scan through a server action would work in development
and fail in production. That makes the *storage service* the enforcement point,
which is stronger than application validation rather than weaker — a client
that lies about a file's type or size, or aims at another person's folder, is
refused by Postgres and Storage before an object exists.

Four policies, and the shape of each matters:

| | |
|---|---|
| INSERT | only into `auth.uid()`'s own folder |
| SELECT (owner) | only their own folder |
| SELECT (operator) | the whole bucket, while `public.is_kyc_operator()` |
| DELETE | own folder **and** `public.is_unsubmitted_kyc_object(name)` |

There is deliberately **no UPDATE policy**, so an object is never overwritten
and a resubmission writes a new key. DELETE stops at the submission boundary:
an abandoned upload can be withdrawn, and a document already attached to a
`kyc_documents` row cannot be deleted by the person it describes — it is
evidence a reviewer may act on.

Both helper functions are `SECURITY DEFINER` with a pinned `search_path`,
because §16.1b turned RLS on for the tables they read; a policy body evaluating
as `authenticated` would see nothing and deny every operator.

Reviewers open a document through `signKycDocumentAction`, which checks
`requirePermission("kyc", "view")`, looks the key up from the row id (the caller
never names a path), and mints a **120-second signed URL** using the operator's
own session. The storage policy then asks the same question again in Postgres.
No service-role key anywhere.

### 16.1a Latency — the number that governs every design choice here

Measured against the configured Supabase project (session pooler,
ap-northeast-2, from India). Re-measure before trusting these elsewhere; the
*shape* is what generalises, not the milliseconds.

| | |
|---|---|
| DNS resolution | **1 ms** |
| TCP connect | **~200 ms** (one round trip) |
| **Opening a pooled connection** | **~1,930–2,042 ms** |
| Query on an open connection | **~199–206 ms** |
| Supabase Auth `getUser()` | **~345 ms** |

Opening a connection costs *ten times* a query, because the Postgres startup
handshake — SSLRequest, TLS, SCRAM, ready-for-query — is roughly ten round
trips. Everything below follows from that.

**Consequences, in order of how much they cost:**

1. **A connection must never be thrown away — but it must be given back.**
   `idle_timeout` was 20 seconds, which is how long a person spends reading a
   page before clicking. Measured: query, idle 30s, query again → **2,187 ms**;
   with the connection kept → **278 ms**. So it was set to `0`.

   **`0` was the cause of `EMAXCONNSESSION`, and it is now 30.** On the *session*
   pooler a client connection reserves a Postgres backend for as long as it is
   held, and Supavisor refuses a sixteenth for the whole project. `0` therefore
   did not mean "keep a connection warm" — it meant every process that ever ran
   a query **permanently claimed up to `max` of a fifteen-slot budget**: a
   `next start` on a laptop, every Vercel instance, a test run. They came back
   only at `max_lifetime` (30 min) or when the process died.

   Observed directly: fifteen session backends held, fourteen idle for nine
   minutes, with one idle dev server the only thing running. That is why the
   error appeared on localhost *and* Vercel, and why it appeared at **zero
   traffic** — which is what made it look like misconfiguration rather than
   load. Reproduced: four instances holding five each, `idle_timeout: 0` →
   three of four served and one `EMAXCONNSESSION`; the same shape with a
   non-zero timeout → four of four.

   Thirty seconds is longer than a click-to-click interval, so ordinary
   navigation still finds a warm connection, and short enough that an abandoned
   instance is not holding a third of the budget a minute later.
   `DATABASE_IDLE_TIMEOUT=0` restores the old behaviour and is only correct for
   a deployment that really is one long-running server with the pool to itself.

2. **A round trip is the unit of cost, not a query.** Two sequential queries
   cost ~400 ms whatever they select. Narrowing columns saves almost nothing;
   removing a round trip saves ~200 ms. This is why `getCurrentOperator()` reads
   the agent and its grants in one left join rather than two statements.

3. **A duplicated read is a duplicated round trip.** The layout fetched the
   account seed and the page then fetched parts of it again — same row, ~400 ms,
   twice. Request-scoped `cache()` on the reads and on the auth resolution is
   what removes that; see §16.2a.

4. **Parallel is only free up to `max`, and `max` has a ceiling above it.**
   Nine concurrent reads against a five-connection pool is two waves, and the
   second wave costs a full round trip for nothing but a free connection.

   **The pool is 5 and the warm-up 3** (`DATABASE_POOL_MAX`,
   `DATABASE_WARM_CONNECTIONS`), and the two must always move together. The
   history is worth keeping, because both wrong answers were reached honestly:

   - **8 / 7.** Genuinely fastest on one long-running server, and measured that
     way (Home 1.10–1.49s → 0.75–0.83s warm). Wrong shape for a platform that
     answers load by adding instances: one instance holds over half the
     project's budget before serving a request, a second cannot warm fully, and
     a third is refused outright. That refusal is `EMAXCONNSESSION`.
   - **3 / 2.** The overcorrection. Safe for many instances and badly
     contended for one. Measured 2026-09-01 against a production build with a
     real session, eighteen concurrent authenticated requests, same build, same
     machine, alternating runs:

     | | wall | p50 |
     |---|---|---|
     | `max 3`, warm 2 | 14.0s, 21.9s | 8.3s, 16.5s |
     | `max 5`, warm 3 | 8.2s, 8.4s, 8.8s | 5.3–5.5s |

     Serially five is no worse and mostly better: Home 1,834 → 1,192ms median,
     Plans 1,171 → 754ms. At three, individual requests reached 14.3s against
     the 15s read deadline — one round trip from failing rather than queuing.

   **The ceiling is fifteen, it belongs to the project, and it is what
   `EMAXCONNSESSION` was.** Supavisor answers a sixteenth session-mode client
   with `max clients reached in session mode - max clients are limited to
   pool_size: 15`, shared by every instance, `npm run db:*`, the scanner and the
   test suite. Five per instance leaves room for two instances plus the scripts,
   which is the shape this deployment has.

   **Do not raise it per instance to buy speed.** The honest ways to buy more
   are, in order: raise the project's pool size in the Supabase dashboard, or
   make the driver migration in §16.1. `DATABASE_POOL_MAX` and
   `DATABASE_WARM_CONNECTIONS` exist for a deployment that really is one
   long-running server, and nothing else.

5. **A connection that is never opened costs nothing.** Cold five-query burst:
   2,008ms. Warm: 203ms. `warmConnectionPool()` opens `DATABASE_WARM_CONNECTIONS`
   in the background when the pool is created, so only the very first request
   pays.

6. **A read that starts late is as expensive as a slow one.** Two round trips is
   the floor for an authenticated page: one to resolve the session's account,
   one for everything that account needs. Anything that turns that into three is
   a waterfall, and the two easy ways to build one are (a) awaiting two reads in
   a repository that only ever needed the same `userId`, and (b) reading in an
   async server component the page *returns* — `TopBar` did both, and cost every
   primary section two extra round trips. A component in the returned tree
   cannot start until the page has finished; hoist its slices into the page's
   own wave and let the request-scoped memoisation serve it.

   The console layout was a third variant: `getCurrentOperator()` awaited, then
   `getAdminShell()` awaited, though the shell takes no argument from the
   operator. Two waves for an ordering nothing needed. They now start together,
   after the (free, local) principal check — see `admin/(console)/layout.tsx`
   for why running the shell read alongside an unresolved operator is safe.

7. **An abandoned navigation is not a cancelled one.** Measured: abort the
   client's fetch after 60ms and the server still issues every query the render
   asked for. Next does not stop rendering when the browser stops listening, and
   nothing in this stack threads an abort signal into postgres.js. So *N* rapid
   clicks are *N* complete renders competing for the same pool, and the only
   lever available is making each render cheaper rather than stopping it. That
   is what the admin work below did; do not go looking for a cancellation hook,
   there isn't one.

8. **Instrumentation was holding connections during the render it measured.**
   The console layout had no `traceRender`, so every event it recorded found no
   trace and took the immediate path in `recordPipelineEvent` — which coalesces
   on a 100ms timer. Its two events land ~360ms apart, so that was **two
   `INSERT`s per admin page load, issued while the page was still rendering**,
   from the same five-connection pool. §22.1a says recording must never be
   measurable; it was. Wrapping the layout in `traceRender` buffers them into one
   insert behind `after()`.

Do not "optimise" by adding indexes or trimming columns before checking the
round-trip count. On this deployment the query plan is almost never the problem.

### 16.2a Request-scoped memoisation

`cache()` from React, applied to the reads that more than one part of a render
asks for:

- `getAuthPrincipal()` / `getAuthenticatedAccount()` — the session was verified
  once per *caller*. A page reading three services verified the same cookie
  three times.
- `getCurrentOperator()` — likewise for the CRM.
- every read in `account.service`, and the earnings rollup.

Two things about it are easy to get wrong:

- **It is keyed on arguments.** `getUserProfile()` and `getUserProfile(id)` are
  different entries and share nothing — which is exactly how the duplicates
  arose. Each read therefore resolves the session *first* and delegates to a
  cached function taking the concrete id.
- **It is request-scoped, not a cache.** A later request re-verifies and
  re-reads. No security property changes: the token is still verified against
  Supabase on every request that needs it, once instead of five times. An
  account blocked between two requests is blocked on the second.

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
`getDb()`, not `@/data` records. That is one rule, and it is what makes the
fallback below possible.

- Every module under `src/server/` imports `server-only`, so a stray import
  from a client component fails the build instead of shipping a connection
  string to a browser.
- Nothing under `src/db/` imports `server-only` or Next.js. The migration and
  seed scripts run those modules as plain Node.
- Repositories know about tables and return **domain types** from `@/types`.
  The row→domain mapping lives in one file, `repositories/mappers.ts`, so no
  component ever learns what a row looks like.
- Services own the fallback and nothing else touches it.

### 16.3 The fallback — `fromDatabase()`

`src/server/database.ts` is the seam:

```ts
fromDatabase(
  (db) => listPublicPlans(db),   // when DATABASE_URL is set
  () => seedPlans,               // when it is not
);
```

Three properties of this are load-bearing:

1. **The fallback is chosen by configuration, never by failure.** If
   `DATABASE_URL` is set and the query throws, the error propagates. Serving
   seed data over a broken connection would hide exactly the problem you need
   to see.
2. **It only marks a render dynamic on the database path.** `unstable_noStore()`
   is called inside the `if`, so with no database the build still prerenders
   every page it always did, and with one, pages read fresh data per request.
3. **A read has a deadline** (`DATABASE_QUERY_TIMEOUT_MS`, default 15s). Without
   one, a database that refuses connections does not fail — it *hangs*.
   postgres.js retries a refused connection indefinitely, so the query never
   settles and the request sits open until something upstream gives up. On a
   serverless platform that is a billed, silent stall. Measured: before the
   deadline a page against a dead database never responded; after it, 500.

All three are pinned by tests in `src/server/database.test.ts`, which run
without a database.

### 16.4 Schema notes

- **Money is `numeric`, never a float.** USDT carries eight decimal places
  on-chain and binary floating point cannot represent it exactly. The column
  helpers in `db/schema/columns.ts` (`usdt`, `inr`, `percent`, `rate`) map back
  to `number` so the domain types are unchanged — the precision guarantee is in
  the storage, which is where it matters.
- **Primary keys are `text`, carrying the seed's meaningful ids** (`usr_8c41a2`,
  `plan_starter`). Existing links like `/admin/users/usr_8c41a2` stay valid.
- **Enums are Postgres enums**, mirroring the unions in `@/types`. Each list
  must stay identical to its TypeScript counterpart.
- **One vocabulary, two words.** `investment_status` stores `matured`; the CRM
  says "matured" and the user app says "completed". The mapper translates.
  `plan_status` has `disabled`, which only the CRM knows about — the public
  catalogue filters those rows out rather than renaming them.
- **Both applications read the same rows.** Plans, VIP levels and wallets are
  one table each. The CRM must never be able to show a commission rate the user
  was not promised.
- **Only masked account numbers and document numbers are stored.** There is no
  payout rail and no document store; a prototype should not accumulate the data
  it cannot yet protect. No password column exists either — auth brings its own.

### 16.5 What is deliberately *not* database-backed

Two reads still come from `@/data`, and both are marked in place:

- **`earnings.service.ts`** — the earnings curve is a daily accrual model, while
  the ledger records rewards as they settle (weekly, monthly, or at maturity).
  Deriving one from the other is not a query, and inventing an accrual model
  here would put numbers on the home screen that no service computed.
- **The CRM dashboard's metrics and chart series** (`@/data/admin/metrics`) —
  these describe the whole platform, not the sample slice in the tables, which
  is a decision the CRM made before the database existed and is still the right
  one. Summing a page of rows into a headline figure is a reporting service's
  job.

Both are §13 items, not oversights. Do not quietly replace them with sums over
the seeded rows.

### 16.6 Seeding and migrations

- **Migrations are generated, never hand-written.** Change `db/schema/`, run
  `npm run db:generate`, review the SQL, commit it. Files under `drizzle/` are
  applied in order and are checked in.
- **The seed reads `@/data`**, so seeding produces the application everyone
  already knows — a difference after switching the database on is a bug, not a
  data change. It is destructive (it clears every table first) and refuses to
  run against `NODE_ENV=production`.
- The two mock datasets overlap in three places (investments, security events,
  commissions). How each is reconciled, and why, is documented at the top of
  `db/seed/index.ts`.
- `db/seed/seed.test.ts` runs the seed against a recorder — no database needed —
  and checks the properties Postgres would otherwise have to reject: every
  foreign key resolves, keys are unique, every schema table is seeded, and the
  demo account's wallet still reconciles against its allocations.

### 16.7 Tests

`npm test` runs `node:test` through `tsx`, with `--conditions=react-server` so
`server-only` modules resolve the way Next resolves them. Tests that need a
database skip themselves when `DATABASE_URL` is unset, so the suite stays green
on a fresh clone. **194 tests with a database configured** as of 2026-09-13;
**189 pass and 5 do not** — see the known failure below.

**Known red: `money-lifecycle` picks its plan by physical row order.** Its
`before()` does `plans.find((plan) => plan.durationDays > 0)` over a `select`
with **no `ORDER BY`**, so which fixed-term plan the whole file tests is
whatever Postgres returns first. Every allocation anywhere updates the plan row
(`investments-write.service.ts` bumps the plan's totals), and an `UPDATE` can
move a row in the heap — so after enough earlier files have run, `find` returns
Balanced Growth (minimum 250 USDT) instead of Starter Plan (minimum 50), and
the five tests that allocate 200 fail with *"Balanced Growth has a minimum of
250 USDT."* The file passes 14/14 on its own, which is what makes this look
like flakiness rather than the fixture bug it is. The fix is an explicit
`orderBy`, or picking the plan by its minimum rather than by position. It is
the same family as the two rules below and the shared-database note at the end
of this section: **assert on, and select by, the property the test owns — never
a fact about the physical table.**

**Do not assert exact row counts against the live database.** Four assertions
did, and all four broke the first time a real person registered and submitted
verification — a successful sign-up read as a regression. Assert the property
the test exists to protect: that the join produced a label, that no document
appears twice, that there are *at least* `SEED_USER_COUNT` accounts.

| File | Needs a database | Covers |
|---|---|---|
| `db/env.test.ts` | no | the configuration switch |
| `db/resilience.test.ts` | no | what is retried, what is not, and the bounds |
| `server/auth/session.test.ts` | no | outage vs. "not signed in" |
| `db/seed/seed.test.ts` | no | the seed, against a recorder |
| `server/database.test.ts` | no | fallback, no-silent-fallback, the deadline |
| `db/connection.integration.test.ts` | yes | both connections, parallel load |
| `db/schema.integration.test.ts` | yes | live schema vs declared schema |
| `server/data-access.integration.test.ts` | yes | repositories and services |
| `server/auth-and-kyc.integration.test.ts` | yes | auth boundary, operator gate, KYC lifecycle |
| `server/writes.integration.test.ts` | yes | ledger, idempotency, overdrafts, audit |
| `server/money-lifecycle.integration.test.ts` | yes | allocation → maturity end to end, the investment earnings engine (daily/weekly/monthly, exact rounding, missed-cron catch-up, Flexible Reserve exclusion, rate-change isolation) |
| `server/deposit-address.integration.test.ts` | yes | pool allocation (claim, reuse, no cross-user leakage, no auto-release), automatic attribution and crediting, idempotency under concurrency |
| `server/tron/tron.test.ts` | no | TRON config validation and transfer parsing/filtering, against fixtures |
| `server/referrals.integration.test.ts` | yes | commission accrual, tiers, and that it credits nobody |
| `server/plan-tiers.test.ts` | no | the rate ladder's boundaries and validation, exhaustively |
| `server/plan-tiers.integration.test.ts` | yes | tier resolution at allocation time, the snapshot, and that a tier edit never reprices an allocation already made |
| `server/deposit-confirmation.integration.test.ts` | yes | which deposits are announced as new, and that acknowledgement is owner-scoped, one-way and idempotent |
| `server/commission-release.integration.test.ts` | partly | the release schedule with no database; eligibility, missed-midnight recovery and pay-once-under-race with one |
| `server/pipeline.integration.test.ts` | partly | redaction and correlation with no database; recording with one |

Two are worth knowing about:

- **`connection.integration.test.ts` fires twenty and then forty queries at
  once.** That is not a benchmark — it is the regression test for the
  transaction-pooler stall in §16.1, which every individual query passed and
  which showed up in the application only as a page that never loaded.
- **`schema.integration.test.ts` compares the live database to the schema in
  both directions**: declared-but-missing *and* present-but-undeclared, plus
  every enum's labels in order, every foreign key's target, and that no money
  column has become a float.
- **`settleInvestments()` is global, and integration test files share one
  live database.** A test in `money-lifecycle.integration.test.ts` now runs
  real allocations through real settlement for tens of seconds at a time
  (crediting a real backlog of periods, one transaction each), and
  `settleInvestments()` processes *every* active fixed-term allocation in the
  database when it runs — including scratch rows a different file's test has
  open at that exact moment. Two tests found this the hard way: an exact
  `investments` row count in `data-access.integration.test.ts`, and a blanket
  `summary.errors.length === 0` in `money-lifecycle.integration.test.ts`
  itself, both failed for allocations that had nothing to do with the test
  that asserted on them. The fix in both places is the same shape as the
  seeded-row-count rule two sections up: assert the property this specific
  test owns (an allocation's own id is not in the error list; there are *at
  least* the seeded rows), not a fact about the whole shared table. See
  `assertNoErrorsFor()` in `money-lifecycle.integration.test.ts`.

---

### 16.8 Connection resilience — retry, deadline, warm-up

Three mechanisms, and they are sized against each other. Changing one in
isolation breaks the arithmetic.

| | where | value |
|---|---|---|
| `connect_timeout` | `db/client.ts` | 6s |
| retry budget | `db/resilience.ts` | 12s, 2 retries |
| read deadline | `server/database.ts` | 15s |

**The retry exists because one pooler endpoint is intermittently broken.** The
host resolves to three A records and one of them accepts the TCP connection then
never completes the Postgres handshake. **Which one is broken changes over
time** — the address that failed 3/3 on 2026-08-24 answered 4/4 when re-probed
hours later. That is why this is a retry and not a pinned IP: pinning would
hard-code today's healthy endpoint and become tomorrow's outage. postgres.js
re-resolves per attempt, so a retry lands on a different endpoint.

Rules, all load-bearing:

- **Only connection-establishment failures are retried.** `CONNECT_TIMEOUT`,
  `ECONNRESET`, SQLSTATE class `08`, `57P01`/`57P03`. A constraint violation or
  syntax error is re-thrown on the first attempt. Retrying a permanent error
  hides a bug behind a delay.
- **Reads only. Never `mutate()`.** A write that failed after its statements
  reached the server may have committed; replaying it would double it. Nothing
  in `@/server/write` goes through `resilientRead`, and nothing should.
- **The deadline is outside the retry**, so three attempts cannot cost three
  deadlines.
- `connect_timeout` was *lowered* from 10s, not raised. It is how long a doomed
  attempt burns before a retry can pick a different endpoint. Healthy handshakes
  are 2.3–4.6s; 6s clears them and makes the worst case exactly two attempts
  (~12s). **Raising it fixes nothing — the broken endpoint does not complete in
  20s either — and it would push the second attempt outside the budget so no
  retry happens at all.**
- A retry is recorded as `database.connectRetry` with `willRetry: true`. A
  recovered fault is invisible in every other signal, so without that row the
  pooler could be failing a third of its connections silently.

**The warm-up lives on `getDb()`, not in `instrumentation.ts`.** Next compiles
that hook for the Edge runtime too and webpack resolves the graph statically, so
even a dynamic `import()` behind a `NEXT_RUNTIME` guard drags `postgres` →
`node:net` into the edge bundle and fails the build with `UnhandledSchemeError`.
This has now been hit twice; do not try it a third time.

### 16.9 What may be cached across requests, and what may not

| | scope | why |
|---|---|---|
| Plans, VIP levels, deposit networks | **cross-request** (`unstable_cache`, tag `catalogue`, 300s) | identical for everyone, belongs to nobody |
| Everything user-scoped | **per request only** (`cache()`) | it is one person's money |

Caching a balance, an allocation, a KYC state or a security setting across
requests would mean serving one person's data to another, and would break the
guarantee that an operator blocking an account takes effect on that account's
next request. **Do not extend the catalogue cache to anything user-scoped.**

The catalogue cache is invalidated **by tag**, so a `revalidatePath("/plans")`
does not clear it. Every CRM plan mutation must also call
`revalidateCatalogue()`, or an operator's edit sits invisible behind the TTL.

### 16.10 Loading and error boundaries

Every user and console route has a `loading.tsx`. They are not decoration: a
page awaits a database read before emitting any HTML, so without one a slow read
renders as a **blank page**. They also make link prefetching cheap — Next
prefetches a dynamic route only as far as its nearest loading boundary, so it no
longer speculatively renders authenticated pages.

`app/error.tsx` and `app/global-error.tsx` exist because **an error boundary
covers the segments below it, never the layout beside it**. `(app)/error.tsx`
never covered `(app)/layout.tsx` — which is exactly where the gate and the two
riskiest calls live — so those failures had nowhere to land and took out the
whole document. Do not delete either file.

`/login` and `/admin/login` must keep rendering when the database is down. They
resolve an account only to offer a convenience redirect and fall back to showing
the form; `redirect()` is called **outside** the `try`, because it works by
throwing a signal a broad `catch` would swallow.

## 17. The write layer

Reads have a fallback to the seed data; writes have none. A read that falls back
is merely stale, and the prototype still runs on a machine with no database. A
write that "succeeds" against `@/data` has told the caller something false, so
`mutate()` refuses when `DATABASE_URL` is unset.

### 17.1 `mutate()` — the unit of work

Everything that changes data goes through `mutate()` in `@/server/write`. It
makes three properties structural rather than remembered:

1. **Atomicity.** The callback runs in one transaction. Crediting a deposit
   writes a ledger row, a balance update and a status change; all three land or
   none do.
2. **Auditability.** Audit entries are buffered on the context and written
   *inside the same transaction*. This is the guarantee the CRM's in-memory
   store already made — the write and its audit record are one transaction —
   now enforced by Postgres rather than by a reducer.
3. **A named actor.** Nothing writes anonymously. `SYSTEM_ACTOR` covers the
   scanner and schedulers; operator actions carry the operator.

One `now` is stamped across the whole unit, so the rows it writes agree about
when they happened.

### 17.2 Money is never added in JavaScript

**This is the rule that matters most, and it is easy to break by accident.**

The money columns are `numeric` — exact — but they are read back as JavaScript
`number` so the domain types in `@/types` keep working. That is fine for
display and wrong for arithmetic: `0.1 + 0.2 !== 0.3`, and a balance
incremented in JavaScript drifts.

So:

- Amounts travel as `Decimal` — a branded exact decimal string, from
  `@/db/money`. The brand means a raw string cannot be passed as an amount
  without going through a validating constructor.
- Amounts reach a query through `numericValue()`, which binds the exact digits
  and casts to `numeric`. Passing a bare `Decimal` where a column expects
  `number` is a **type error**, which is how this stays enforced.
- Balances move with `UPDATE … SET available = available + $1::numeric`.
  Postgres does the arithmetic. Never read-modify-write: besides the float
  problem, that races another transaction doing the same thing.
- Chain amounts are integers in the token's smallest unit and are converted with
  `BigInt`, never `Number()` — TRC-20 values can exceed `MAX_SAFE_INTEGER`.
- Comparisons that decide anything (does this withdrawal fit?) use
  `readBalance()`, which casts the columns to `text` in SQL so no float is
  involved.

### 17.3 The ledger

`applyLedgerEntry()` in `wallet.repository.ts` is **the only place a balance
changes**, and it always writes the `transactions` row that explains the change
in the same call. There is no code path that produces a balance without its
entry, which is why the ledger sums to the balance and a discrepancy is a bug
rather than a mystery. There is a test for exactly that.

Overdrafts are refused by a `WHERE available + delta >= 0` clause, not by a
prior read — two concurrent withdrawals would both pass a read-then-check.

### 17.4 Withdrawals move no money

`withdrawals-write.service.ts` writes records. There is no payout rail, no bank
integration and no on-chain send. `approved`, `processing` and `paid` record
operator decisions; `payoutReference` is whatever the operator types.

The one real effect: requesting a withdrawal debits the wallet immediately, so
a balance cannot back two requests. Rejecting returns it, as a ledger entry, so
the history shows the hold and its reversal.

### 17.5 Idempotency

Financial operations that can be retried are protected by database constraints,
not by prior `SELECT`s — a check-then-insert can be raced by a concurrent copy
of itself.

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
  accepts `mainnet`, `shasta` and `nile`; **unset means `shasta`**. Mainnet used
  to throw here on the reasoning that crediting real money should be a reviewed
  code change rather than a variable someone flips. That review happened; the
  refusal is gone and two guarantees replaced it, because the failure mode is
  still not recoverable:
  - reaching real money requires *naming* the network, and
  - **mainnet may not skip finality.** `TRON_CONFIRMATION_REQUIRED=false` /
    `TRON_CONFIRMATIONS=0` is a local-testing escape hatch (§18.3); on mainnet
    `getTronConfig` refuses it outright, because crediting before
    solidification credits money a re-org can take back. That is the one
    setting that turns this integration into a loss rather than a delay. There
    is a test for it; do not make it pass by deleting it.

  Nothing else in the pipeline is network-aware. Address validation is
  base58check and prefix-identical across TRON's networks, the contract is
  configuration everywhere, and the scanner scopes its cursor
  (`chain_scan_state`) and its address pool (`deposit_addresses`) by `network` —
  so mainnet rows and testnet rows never mix, and switching networks starts a
  fresh cursor rather than inheriting a stale one.
- **Nothing is ever signed or sent.** No private key, no seed phrase, no
  broadcasting. `tronweb` is deliberately not a dependency: base58check
  validation is forty lines, and a library that *can* sign is one that can be
  made to.
- **The TronGrid API key is server-only.** Read in a `server-only` module, sent
  as a request header, never `NEXT_PUBLIC_`, never logged. What reaches the
  browser is `PublicDepositTarget`, a hand-written projection with no field to
  put a key in.
- **Failures are failures.** Every error path throws. An empty list is
  indistinguishable from "no deposits arrived", and a scanner that read a
  rate-limit response as "nothing new" would advance its cursor past transfers
  it never saw.

### 18.2 The pipeline

```
TronGrid  →  parse/filter  →  confirmation check  →  deposits row
                                                          │
                                        recipient in deposit_addresses?
                                          │                     │
                                         yes                    no
                                          │                     │
                              credited automatically      unassigned, in
                              (ledger + balance + audit)  the operator queue
```

The right-hand branch (§18.4, unchanged from before this pool existed) is
still how a transfer to the legacy shared address, or to a pool address that
was never assigned, gets attributed — by an operator, in `/admin/deposits`,
never by guessing.

Three filters decide what counts, and all three are enforced locally even
where TronGrid was asked to do it:

- **Contract** — anyone can deploy a token, call it USDT and send a million of
  it to the deposit address. Only `TRON_USDT_CONTRACT` counts.
- **Recipient** — `only_to=true` is the server's promise, not ours to keep.
- **Direction** — self-transfers and outgoing transfers are not deposits.

Token decimals are read from the response, never assumed: TRC-20 USDT is six
decimals on TRON and eighteen elsewhere, and guessing scales every amount by a
million. (Verified against Shasta and against mainnet Tether
`TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`: both report `decimals: 6`. The value is
still read per transfer rather than pinned — it is the token's property, not
the network's.)

### 18.3 Confirmation

A transfer is recorded as creditable only once its block is **solidified** —
at or below the height from `/walletsolidity/getnowblock`, which is TRON's
irreversibility marker. Unconfirmed transfers are counted and left for the next
pass; the poll window overlaps by a minute so nothing falls between passes.

`TRON_CONFIRMATION_REQUIRED=false` skips this. It exists for local testing and
should not be used anywhere real: crediting before finality means crediting
money a re-org can take back.

### 18.4 Deposit attribution

**A blockchain transaction does not identify which user paid — unless the
recipient address itself already does.**

Until this pool existed there was one platform receiving address, and this
whole section described why that could never be attributed automatically. It
still cannot be, *for that one address* — a TRC-20 transfer carries a sender
and nothing else, no memo, no invoice id, and two users paying from the same
exchange withdrawal are indistinguishable on-chain. But `deposit_addresses`
(§18.8) now lets the *recipient* carry the identity instead: a transfer to an
address this application handed to a specific user is that user's money,
structurally, not by inference.

So, today:

- A transfer to an **assigned pool address** resolves to its owner and is
  credited automatically, in the same transaction that records it — see
  `recordObservedDeposit` in `@/server/services/deposits.service`.
- A transfer to the **legacy shared address**, or to a pool address that was
  never assigned, still cannot say who paid. `deposits.user_id` stays
  **nullable** for exactly this case, and an operator attributes it by hand in
  `/admin/deposits` — the CRM still offers no "best match" suggestion, on
  purpose, for the same reason as before: a plausible guess is the thing most
  likely to be accepted without checking, and crediting the wrong account is a
  loss, not a display bug.

**A tx-hash claim flow is the obvious shortcut and it is not safe on its own.**
The idea — the user pastes their transaction hash, the server verifies it
on-chain and credits them — reads like the answer and has a front-running
attack at its centre: the chain is public, so anyone can watch the deposit
address, see a stranger's transfer land, and submit that hash first. The server
has no way to tell the two claimants apart, because on a shared address the
transfer carries nothing that identifies the payer. Verifying the hash proves
the *transfer* happened; it proves nothing about *who is asking*.

Two things make a claim safe, and this codebase now has the first one for
whoever holds a pool address:

- **Per-user addresses** (§18.8, now implemented for the pool). Attribution
  stops being a claim at all — the recipient address *is* the identity, and
  nothing the browser says about who sent what changes anything.
- **Binding the sender address to the account first**, for the shared/legacy
  address specifically. A claim is accepted only when the transfer's `from`
  matches an address the account proved it controls (a signed message, or a
  small verification transfer). An attacker cannot forge `from`, so the race
  disappears — at the cost of a whole address ownership flow, and of refusing
  anybody who paid from an exchange, which is most people. Not implemented;
  the legacy address does not need it once the pool covers real usage.

A transfer to the shared address, or to a released pool address nobody
currently holds, still has none of that — attribution there stays an operator
decision in `/admin/deposits`. That is slow and it is correct; crediting the
wrong account is a loss, not a display bug.

### 18.4a Telling the customer their deposit arrived

`deposits.acknowledged_at`. A deposit is "new" to an account when
`status = 'credited' and acknowledged_at is null`, and that is the whole rule —
a **database fact**, never `localStorage`.

Both halves are load-bearing. **Credited**, because the card says "25.00 USDT
has been added to your wallet" and a transfer that has merely been detected has
added nothing; an in-flight transfer shows its status in `DepositWatcher` and
nothing more. **Not acknowledged**, because the defect this closes is a
historical deposit reading as a fresh arrival on every visit — and a browser-
side marker would have fixed that for one browser and broken it again on the
next device, in a private window, and after a cache clear.

`acknowledgeDeposit` puts ownership, `status = 'credited'` and
`acknowledged_at is null` in the `UPDATE`'s own `WHERE` clause, so a forged id
matches no row, the call can never credit or advance anything, and a double-tap
is a no-op. It writes no ledger entry and no audit entry on purpose: it records
that a person closed a card, not that anything moved.

The confirmation renders on `/wallet/deposit` (from the watcher's existing 5 s
poll — no second timer) and on `/wallet` (server-rendered, because a deposit
credited by the cron while nobody was on the deposit screen is found by
whichever screen is opened next). It is dismissed explicitly rather than on
render: acknowledging on render would mark a background-tab arrival seen by
nobody, and would lose the confirmation for anybody who refreshed mid-read.

**A migration that adds this column to an existing deployment must backfill
credited deposits as acknowledged**, or the first load after deploy announces
every deposit the account has ever made.

### 18.5 The scanner

Polling, not events: restartable, nothing to lose, and its failure mode is
delay rather than loss. The cursor in `chain_scan_state` is an **optimisation** —
losing or resetting it is harmless, because the unique index on
`deposits(chain, tx_hash)` is what prevents double-crediting. A failed pass does
not advance the cursor and is recorded, so "no deposits" and "no successful scan
since Tuesday" look different.

**Something has to run it, and for a long time nothing did.** The scanner was
complete and correct; the only trigger was `npm run tron:scan`, a command a
person types. On the development project the last successful pass was
2026-08-23 and nothing ran for the following week — which is what "the
application is not detecting my transfer" turned out to mean. The transfer was
detected the day it arrived (`dep_mt2nnxzu1jdf0`, 1,000 USDT, `confirmed`,
unassigned); the silence afterwards was the gap.

`GET /api/cron/scan-deposits` is that trigger. Authorised by `CRON_SECRET` —
the header Vercel Cron sends — and **refusing everybody when it is unset**,
because the route spends TronGrid quota and database connections. `vercel.json`
holds the schedule. A `setInterval` in the server process is the wrong shape
here: serverless instances are frozen between requests, so the timer either
never fires or fires once per instance, which with several instances is several
concurrent scanners.

> Vercel's Hobby plan allows one cron invocation per day and rejects a finer
> schedule at deploy time. `*/5 * * * *` assumes Pro. Lower it, or drive the
> same URL from any external scheduler — nothing about the route is
> Vercel-specific.
>
> `vercel.json` now schedules **three** jobs — the deposit scan (03:00 UTC),
> investment settlement (04:00 UTC) and the referral release (18:30 UTC, which
> is 00:00 IST, §10d). Hobby caps the *number* of cron jobs as well as their
> frequency; if a deploy is rejected, move them to an external scheduler rather
> than dropping one. All three are `CRON_SECRET`-authorised plain URLs.

**The deposit screen triggers a pass too, and it is not the scheduler.** While
`/wallet/deposit` is open with a real address on it, `DepositWatcher` calls
`checkForDepositsAction` **every five seconds**; that action asks
`triggerDepositScan()` (`@/server/tron/scan-trigger.ts`) for a pass and then
reads the caller's own deposits back. It exists because a daily cron makes
watching a transfer arrive impossible — it is a **temporary,
user-active-page mechanism**, and a transfer arriving after the tab closes is
still found by the cron pass and by nothing else. Two in-process limits keep it
from being a second scanner in disguise: single-flight, so concurrent callers
join the pass already running, and a **4-second** floor between passes, so a
crowd of open screens is not a crowd of scans. **The floor and the client
cadence move together** — a floor at or above the cadence means most ticks
return `throttled` and the screen updates no faster than the floor allows,
which is how a "5-second" watcher silently becomes a 20-second one. In-process
means per instance, which
is safe for the same reason two hand-run scans always were — recording is
idempotent on `(chain, tx_hash)` and the cursor only moves forward. Do not grow
this into the scheduler; the paragraph above says why a timer in the server
process is the wrong shape.

**A deposit older than the first-ever scan is invisible until you widen the
window.** With no cursor, a pass looks back `TRON_LOOKBACK_MS` (default 24h).
The cursor is only advanced when transfers were actually seen, so nothing is
lost permanently — but a deployment whose first scan runs after a test transfer
will report nothing until `TRON_LOOKBACK_MS` covers it.

### 18.6 Environment

| Variable | Meaning |
|---|---|
| `TRON_NETWORK` | `mainnet`, `shasta` or `nile`. **Unset means `shasta`.** |
| `TRON_GRID_URL` | Must be https. Also spelled `TRONGRID_API_URL` / `TRON_GRID_API_URL`. Defaults per network (`https://api.trongrid.io` for mainnet). |
| `TRON_GRID_API_KEY` | Optional; without it, a much lower rate limit. Get one for mainnet. Server-only. |
| `TRON_USDT_CONTRACT` | The only contract that counts as a deposit. Mainnet USDT is `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`. |
| `TRON_PLATFORM_DEPOSIT_ADDRESS` | The legacy single receiving address — always pool member zero (§18.8). |
| `TRON_DEPOSIT_POOL_ADDRESSES` | Optional. Comma-separated additional pool addresses. |
| `TRON_CONFIRMATION_REQUIRED` | Wait for solidification. Default on. **Refused on mainnet when off** (§18.1). |
| `TRON_POLL_INTERVAL_MS` | Scanner interval. Default 30000. |
| `TRON_LOOKBACK_MS` | First-run window. Default 24h. |

Leaving the contract and address unset disables the integration; nothing else in
the application is affected.

### 18.7 End-to-end workflow

The steps below are written against a testnet, because that is where you should
rehearse them. **They are identical on mainnet** — same commands, same screens —
except that the funds are real and the faucet in step 1 is your own wallet.

```bash
npm run tron:inspect          # read the chain, last 24h (TRON_PLATFORM_DEPOSIT_ADDRESS only)
npm run tron:inspect -- 336   # …looking back two weeks
npm run tron:scan             # one pass, scans the whole pool (§18.8)
npm run tron:scan -- --watch  # poll continuously
npm run tron:scan -- --dry    # read and report, write nothing
```

End-to-end, against the legacy shared address (still the manual-attribution
path — §18.4):

1. Get Shasta TRX from a faucet, and test USDT for the configured contract.
2. Send test USDT to `TRON_PLATFORM_DEPOSIT_ADDRESS`.
3. `npm run tron:inspect` — the transfer should appear, with whether it is
   solidified and what the scanner would do with it.
4. `npm run tron:scan` — it becomes a `confirmed`, **unassigned** deposit.
5. Open `/admin/deposits`, use **Assign**, pick the account.
6. The wallet balance rises, a ledger entry cites the transaction hash, and the
   audit log records who assigned it.

End-to-end, through a real user's own pool address, credits automatically at
step 3 with no operator step at all: sign in, open **Add funds → USDT
(TRC-20)**, send USDT to the address shown, and watch it arrive — the deposit
screen runs a pass itself every five seconds while it is open (§18.5), so
`npm run tron:scan` is not needed for this path.

**Check the lookback before concluding anything.** `tron:inspect` defaults to
24 hours and passes it to TronGrid as `min_timestamp`, so an older transfer is
simply not in the response and the output reads exactly like "nothing arrived".
A real test transfer was chased on the strength of that: eleven days old,
present on-chain, and already in the `deposits` table.

`tron:inspect` records no deposit — it never imports the deposits service and
never opens a transaction. It is not silent, though: every TronGrid call is
instrumented, so it writes `pipeline_events` and therefore opens the runtime
pool. It closes it explicitly on exit; before that it held session-mode
connections out of the project's fifteen and never terminated.

### 18.8 The deposit-address pool

`deposit_addresses` (`@/db/schema/chain.ts`) maps one blockchain address to at
most one user at a time. It is what makes §18.4's automatic branch possible:
the scanner resolves a transfer's recipient through this table instead of
leaving every deposit for an operator to attribute.

**It is a pool, not one address per signup.** `getOrCreateDepositAddress`
(`@/server/services/deposit-address.service.ts`) hands a user their existing
assignment if they have one, or claims one `available` row and assigns it —
never the other way around. Sized by how many addresses
`TRON_DEPOSIT_POOL_ADDRESSES` lists (§18.6); `TRON_PLATFORM_DEPOSIT_ADDRESS`
is always pool member zero, so this works today with the one address every
deployment already has, and grows by adding more addresses to the env var, not
by writing code.

**An address is never reassigned automatically.** No code path reclaims one
because a page closed, a session ended, or time passed — the only way an
address returns to the pool is `releaseDepositAddress`, an explicit operator
action (`/admin/actions.ts`'s `releaseDepositAddressAction`) that refuses when
any deposit against that address is not yet `credited`, `failed` or `ignored`.
A transfer that arrives after the browser tab is long gone must still find its
owner.

**Concurrency.** Two requests for the same user's first-ever address are
serialised by a transaction-scoped `pg_advisory_xact_lock`, keyed to that user
and target — the one race a database constraint alone does not close, because
both requests correctly observe "no assignment exists yet" and would otherwise
both claim a slot. Claiming *which* row, when several are available, is
`SELECT … FOR UPDATE SKIP LOCKED` — the standard "take a ticket" pattern, so
two different users' requests never contend on each other.

**Why there is no real address derivation here — a key-custody decision, not
an oversight.** The task that built this pool asked for BIP-44 TRON address
derivation from an operator-held seed, with only the derived *addresses* ever
reaching this application — never the mnemonic, seed, xprv or any private key,
which the same task explicitly forbids exposing to the browser, the database,
logs, API responses, **or the coding assistant building this feature**. That
last constraint is the one that matters: generating a real seed to derive
addresses would mean that seed passing through this session to get written
down anywhere, which is precisely what must never happen. The standard safe
pattern — generate a mnemonic offline, derive an account-level extended
*public* key (an xpub), and derive addresses from the xpub alone, since BIP-44's
last two path levels use non-hardened derivation — needs that xpub to exist
first, generated by the operator using their own trusted, offline tooling. It
does not exist in this project. Fabricating one inside a coding session would
not be safer than not having it; it would be exactly the insecure-key-material
problem the constraint exists to prevent, wearing a testnet disguise.

So today, every pool address is **configured**, the same way
`TRON_PLATFORM_DEPOSIT_ADDRESS` always has been: the operator generates it with
their own wallet tooling, and only the address string — never anything that
could sign with it — ever reaches this codebase. `derivation_index` exists as
a column on `deposit_addresses` for exactly the day an xpub does; it is `null`
on every row today because nothing here derives anything.

**What sweeping would still need, when that day comes** (also not implemented,
and out of scope for the same reason): a signing key — never this
application's — with narrow, auditable authority to move funds off pool
addresses to a treasury address; a policy for TRX/energy/bandwidth funding,
since every sweep is itself a transaction that costs network resources; a
minimum-sweep threshold, so a $2 deposit does not spend $3 of network fees
consolidating itself; and a decision on whether a provider handles this or the
operator does it by hand at this volume. None of that is guessed at here.

### 18.9 Managing the pool from the CRM

`/admin/deposits/addresses`. `deposits` permission, `manage` for every
mutation, every one through the existing service and audited inside its own
transaction.

- **Add** — `addDepositAddressAction` → `addDepositAddress`. Validates the
  base58 **checksum** server-side before a row exists: a mistyped address still
  looks like an address, and one in this table is somewhere a customer sends
  real USDT. The network is not a parameter — it is whatever `TRON_NETWORK`
  this deployment scans, because an address on any other network is one nothing
  will ever detect. A duplicate is reported as already present, not as an
  error.
- **Release / retire** — unchanged, including the refusal when any deposit
  against the address is `pending`, `confirming` or unassigned `confirmed`. The
  screen shows that count so an operator sees *why* a control is unavailable.
- **Scanner coverage is automatic**: `listWatchedAddresses` selects every row
  for the chain and network regardless of status, so an added address is
  watched from the next pass and a retired one stays watched.

**Two things this screen must never become.** It is not an environment editor —
`TRON_NETWORK`, the grid URL, the API key and `CRON_SECRET` are deployment
configuration and no screen in this application reads or writes them. And it
never *generates* an address: nothing here holds a private key, seed or xpub
(§18.8), so a generated address would be one nobody could ever sweep. The
operator generates it with their own tooling and pastes the string.

---

## 19. Authentication

Supabase Auth, email one-time code. No passwords anywhere.

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

**Nothing in `public` stores a credential.** No password, no hash, no OTP, no
token. Supabase is the sole authority, and there is a test asserting no column
in the schema is named like one — a second authority would start with somebody
adding a column, and that fails the suite.

`auth_user_id` is nullable because the thirty seeded accounts have no
credential. They exist to populate the CRM; giving them auth users would create
thirty sign-in-able accounts nobody owns.

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

The browser never generates, stores or checks a code. `signInWithOtp` and
`verifyOtp` are Supabase's; the application's part starts once a session exists.

`shouldCreateUser: true`, so sign-in and sign-up are one path — there is no
separate registration flow to keep in step.

**Linking by email.** If a `public.users` row already carries the verified email
and has no `auth_user_id`, it is adopted rather than duplicated. That is safe
only because Supabase has just proved control of the mailbox; the ordering —
verify first, link second — is what stops it being an account-takeover
primitive.

### 19.3 Email delivery — what still needs configuring

Sending is configured in the **Supabase dashboard**, never here. Keeping SMTP
credentials in Supabase means this application never holds them and cannot leak
them.

| Where | What |
|---|---|
| Authentication → Providers → Email | Enable email; enable **Email OTP** |
| Authentication → Emails → SMTP | Production SMTP host, port, user, password, sender |
| Authentication → Emails → Templates | The **Magic Link** template must contain `{{ .Token }}` — Supabase's default sends a link, and the app expects a code |
| Authentication → URL Configuration | Site URL and redirect allow-list |

Supabase's built-in sender is rate-limited (a handful of emails per hour) and is
for development only.

### 19.4 Identity, server-side

`getCurrentUserId()` resolves the session and nothing else. It used to return a
fixed demo account, which meant every visitor saw one person's wallet.

- `getAuthPrincipal()` **verifies** the token rather than decoding it. It uses
  `supabase.auth.getClaims()`, which checks the JWT's signature against the
  project's published JWKS — this project signs with **ES256**, so that happens
  in-process (measured: 370ms for the first call, which caches the key set, then
  1–3ms). It replaced `getUser()`, a network round trip measured at **385ms on
  every authenticated request** and averaging 1,024ms under load.

  **This is not `getSession()`, and the difference is the whole point.**
  `getSession()` decodes an attacker-controlled cookie and believes it;
  `getClaims()` checks a signature that cannot be forged without the project's
  private key, and rejects anything expired. If the project ever reverts to a
  legacy symmetric (HS256) secret, the SDK cannot verify locally and falls back
  to a network `getUser()` call on its own, so this stays correct either way.
  What it gives up is server-side revocation taking effect before the token
  expires — which costs nothing here, because this deployment holds no
  service-role key and cannot revoke server-side at all (§19.6, §20.3).

- **An outage is not a sign-out.** `getAuthPrincipal()` returns null only when a
  token is genuinely absent, expired or rejected. When the provider cannot be
  *reached* it throws `AuthProviderUnavailableError`, and `(app)/layout.tsx`
  renders the shell with a recoverable notice. It used to return null for both,
  which signed valid users out during a blip and produced the reported
  `NotAuthenticatedError`. Do not collapse those two cases back together.
- Server actions take no `userId`. The account comes from the session, so there
  is no parameter to tamper with.
- The middleware refreshes the session cookie and **decides nothing**. The gate
  is in `(app)/layout.tsx` and in every action. Middleware as the boundary is
  how an app ends up protected only where somebody remembered a matcher.

### 19.5 Unauthenticated behaviour

Every route under `(app)` redirects to `/login` — verified by request, not by
inspection. No wallet, no allocations, no verification status, no referral data,
and no demo account is substituted when Supabase is unconfigured: the sign-in
page says sign-in is unavailable.

`(app)` is `force-dynamic`. Those pages render one account's data and must never
be prerendered into a static file.

### 19.6 Environment

```
NEXT_PUBLIC_SUPABASE_URL         # public, identifies the project
NEXT_PUBLIC_SUPABASE_ANON_KEY    # public by design, RLS-scoped
```

The **service-role key is not used anywhere** and must not be added. It bypasses
row-level security, so a copy in the browser is a copy of the database.
Privileged work runs server-side over `DATABASE_URL`, a separate credential.

---

## 20. Operator authentication

Operators sign in through Supabase Auth, exactly as customers do.

```
   auth.users            (Supabase — credentials, sessions)
        |
        +-- auth_user_id --> public.users        a customer
        |
        +-- auth_user_id --> admin_agents        an operator
```

**The two lookups are independent, and that is the design.** A principal can be
a customer, an operator, both or neither. Signing in at `/login` grants nothing
in the CRM; `completeOperatorSignIn` checks `admin_agents` server-side and ends
the session if it finds nothing. There is deliberately no `role` column on
`public.users` — that would put every customer row one `UPDATE` away from being
an administrator.

`admin_agents.auth_user_id` is nullable. A seeded operator is a fixture with
nobody behind it: the row exists so the permission matrix, the directory and
historical audit entries have something to point at, and it cannot sign in.
Creating an operator in the CRM writes an `invited` row with no credential —
provisioning an account and issuing a credential are two decisions, and a form
should not make the second one by implication.

### 20.1 The route group

```
app/admin/layout.tsx          no shell, no store, no gate
app/admin/login/              reachable without a session
app/admin/(console)/          everything else, behind the gate
```

A Next.js layout cannot be removed by a descendant, so a gate at `/admin` would
gate the sign-in page too and loop. The route group adds no path segment: every
`/admin/*` URL is unchanged. **Do not collapse it.**

### 20.2 What changed, and why it had to

The permission *model* was already enforced server-side. The *identity* was not:
the agent id arrived from the browser — a demo "view as" dropdown in the header
— so a caller could name themselves the master admin and approve a verification
case, credit a deposit or unblock an account.

That was tolerable only while operator actions wrote to an in-memory store.
Connecting twenty-two mutations to PostgreSQL without closing it would have been
a serious regression, so the two changes belong together and landed together.

`server/admin/guard.ts` was deleted rather than adapted. Its
`requirePermission(claim, …)` took the agent id as an argument, which was the
whole problem.

### 20.3 Still missing

- **Server-side session revocation.** Invalidating a Supabase refresh token
  needs the service-role key, which this project does not hold (§19.6). The CRM
  marks a device session revoked and says plainly that the credential is not
  invalidated. Do not change that message without changing the behaviour.
- **Operator credential provisioning from the CRM.** A master admin invites an
  operator; linking a Supabase credential is a separate step
  (`npm run db:dev-accounts` in development).
- Phone/SMS codes, and username sign-in.

---

## 21. Development accounts

`npm run db:dev-accounts` links development credentials to a seeded operator and
to an application account:

```
DEV_ADMIN_EMAIL / DEV_ADMIN_PASSWORD    → the seeded master admin
DEV_TEST_EMAIL  / DEV_TEST_PASSWORD     → a customer account
```

Environment variables only. **No credential appears in source, in the database,
or in this file**, and the script prints email addresses and never a password.
It refuses under `NODE_ENV=production`.

It creates the Supabase user through the ordinary public `signUp` endpoint —
deliberately *not* the admin API, which needs the service-role key. The cost of
that choice is that email confirmation applies: with `mailer_autoconfirm` off
(the default, and what production should use), the address must be confirmed
once before the account can sign in. The script says so rather than pretending
otherwise.

The customer account is deliberately **not** linked to a seeded user. A test
account should start empty, which is the state a real registration produces and
the one most worth being able to test.

> Supabase's built-in email sender is rate-limited to a handful of messages an
> hour and is for development only. Hitting that limit is the expected failure
> mode of this script, not a bug in it.

---

## 22. Observability

Two tables, two questions. Keep them separate.

| | `audit_logs` | `pipeline_events` |
|---|---|---|
| Answers | Who decided what | What the system did |
| Written | Inside the caller's transaction | Outside it |
| On rollback | Disappears with the decision | **Survives** — that is the point |
| Lifetime | Evidence; kept | Diagnostics; prunable |
| A failed write | Fails the operation | Is swallowed |

An audit entry records authority and somebody may have to answer for it. A
pipeline event records an attempt — most of them describe operations nobody
decided, and a rolled-back attempt is the interesting kind, which is why it is
written outside the transaction that rolled back.

### 22.1 Correlation ids

One per request, stamped by the **middleware** onto the forwarded request
headers, and propagated through `AsyncLocalStorage` so nested services inherit
it without a `correlationId` parameter on every signature in the codebase. The
layout, the page and every service in one render therefore share an id — before
that each opened its own trace and a single page load appeared as three
unrelated fragments.

**Joining the browser to the server.** A client-side navigation is an RSC fetch
Next issues itself: no hook to add a header, no way to read one back. A
short-lived cookie is the one channel that rides along automatically, so
`NavigationTracer` writes the id it generated on click and the middleware adopts
it. That is what puts `navigation.start` (browser) and `render.complete`
(server) under one id.

A client-supplied id is a **diagnostic label**: validated for shape, never for
authority. It selects nothing and grants nothing; the worst a forged one
achieves is mislabelling its own rows.

```ts
return withCorrelation(async (correlationId) => {
  await trackPipeline({ pipeline: "kyc", operation: "kyc.submit", … }, () => …);
});
```

`trackPipeline()` times the work, records the outcome, and **re-throws on
failure**. It observes; it does not handle. Swallowing there would turn every
instrumented call into one that silently succeeds.

### 22.1a Recording must never be measurable

A round trip to this database costs ~200ms warm and ~2,000ms cold (§16.1a), so
a dozen synchronous inserts would make a request several times slower than the
problem they were added to diagnose. Instrumentation that changes what it
measures is worthless.

So:

- `recordPipelineEvent()` is **synchronous** and issues no query. It appends to
  a buffer on the request's async context.
- The buffer is written **once**, as a single multi-row insert, and handed to
  Next's `after()` so it runs *after the response*. The user waits for none of
  it.
- Work with no response to come after — the scanner, a script — flushes when its
  trace closes.
- The browser batches its own events and posts them with `sendBeacon`, once, on
  navigation complete.
- **`/api/trace` does all of its work in `after()` and nothing before the 204.**
  It used to resolve the account and write the rows first — 720–1,270ms per
  beacon, and a beacon rides every navigation, so it held connections while the
  person's next page was reading from the same pool. `sendBeacon` never waits
  for the answer, so that time was never useful to anyone.
- Every write is wrapped in try/catch and swallowed. A logging failure must
  never fail a KYC submission, a deposit, a withdrawal, an investment, a login
  or a navigation.

**`AsyncLocalStorage` does not cross from a layout into the page beneath it**,
which is the trap here and cost five to eight extra round trips per page view
before it was found. `traceRender` in `(app)/layout.tsx` covers the layout body
only; every event a *page* records finds no trace. That path therefore coalesces
into one insert on a short timer instead of writing a row at a time — see
`enqueueUntraced` in `observability.ts`. If you add a trace wrapper somewhere
new, check what it actually covers rather than what it appears to.

### 22.2 What must never be recorded

Passwords, access or refresh tokens, session cookies, the Supabase service-role
key, the TronGrid API key, private keys, whole bank account numbers, identity
document numbers.

`metadata` is free-form `jsonb`, which makes it the easiest place in the schema
to leak something by accident. Two things guard it, and the first is the one
doing the real work:

1. The helper takes **named scalars only**. Nothing writes a request body.
2. `redact()` strips connection strings, `apikey`/`token`/`password` pairs and
   JWTs from error text before storage — driver and HTTP errors quote what they
   were given, and a table an operator browses is not the place for a
   connection string.

---

## 23. What is deliberately still missing

Stated plainly, because the code compiles either way. §2 lists these too; this
is the detail.

- **Server-side session revocation.** The CRM marks a device session revoked and
  cannot invalidate the Supabase refresh token behind it — that needs the
  service-role key, which is deliberately absent (§19.6, §20.3).
- **Real withdrawals.** Requests hold a balance and create a record an operator
  works. Nothing pays out; `payoutReference` is whatever the operator types
  (§17.4).
- **Outbound blockchain.** No signing, no key custody, no sending (§18.1).
- **An automated KYC provider.** Documents themselves are now real: captured,
  uploaded to a private bucket, and opened by a reviewer through a signed URL
  (§16.1c). What is missing is a service that *checks* them.

  What is real: the document step opens the OS file picker or the camera and
  validates type and size; the selfie step opens the device camera through
  `getUserMedia`, with an `<input capture>` fallback because `mediaDevices` does
  not exist on an insecure origin — which is every phone testing a LAN address.
  The person chooses their document type and types their document number, and
  **only its last four characters leave the browser**; the server composes the
  mask.

  What is not: nothing *verifies* the document. A human compares the selfie with
  the ID; no provider reads either.

  `liveness_check_passed` is **not a value the client can send**. It used to be,
  and the flow sent `true` whenever a button had been pressed — a claim an
  operator reads as a check that ran and passed, about a check that did not
  exist. `submitKyc` writes `false` and a `liveness_not_verified` risk flag, and
  the CRM renders that as *"Not checked — compare by hand"* rather than as a
  failure. **Do not reintroduce a path that lets a click set it.**
- **A product rule tying commission release to an allocation's
  *performance*.** Release is now automatic, on a date: `payoutDelayDays` after
  accrual, at midnight IST (§10, §10d). What that rule deliberately does *not*
  do is wait for the allocation to have earned anything — nothing in the
  product's terms defines when an allocation is "settled" for the purpose of
  paying a third party, and a delay measured from accrual is the one schedule
  that uses configuration which already exists rather than a definition nobody
  has written. If the business wants release gated on the first credited
  earning period, or on maturity, that is a product decision and a change to
  where `release_at` is computed — not a change to the release job, which only
  ever asks whether the stamped date has passed. See FUTURE_TASKS.md.
- **A deposit-address pool with more than one address in it.** The mechanism is
  built and works (§18.8): a transfer to an address assigned to a user is
  attributed and credited automatically, no operator involved. What is missing
  is *addresses* — `TRON_DEPOSIT_POOL_ADDRESSES` is unset, so the pool holds
  only `TRON_PLATFORM_DEPOSIT_ADDRESS`. The first account to open the deposit
  screen claims it; the next gets `PoolExhaustedError` and sees "could not get
  your deposit address". Growing the pool is configuration, not code — the
  operator generates addresses with their own wallet tooling and lists them —
  and deriving them from an xpub instead is the key-custody decision §18.8
  explains.
- **Operator credential provisioning from the CRM** (§20.3).
- **Phone/SMS codes; username sign-in.**
- **The CRM dashboard's headline metrics and chart series**, still on
  `@/data/admin/metrics` for the reason in §16.5. Its recent-activity panels and
  every list screen read the database.

---

## 24. The development dataset

Thirty accounts. `SEED_USER_COUNT` in `db/seed/index.ts` is the single place
that number lives.

Enough for the CRM's tables, filters and pagination to be exercised honestly;
few enough to read end to end when something looks wrong. Every dependent
record — wallets, KYC cases, investments, deposits, withdrawals, referrals,
commissions, device sessions, security events, audit entries — is filtered
against those thirty ids, so nothing is orphaned and nothing in the CRM links to
an account that does not exist.

It is a **baseline, not a limit**. Registrations through the real sign-in flow
push the count past thirty, which is expected and correct.

`npm run db:seed` is destructive: it clears every table and reloads. It does not
touch `chain_scan_state`, `investment_earnings` or `pipeline_events`, which are
written by processes rather than fixtures — so a reseed does not rewind the
deposit scanner, does not invent accruals, and does not fabricate a system log.
Re-running the scanner re-detects any chain deposits the wipe removed.

A reseed also clears `users`, so it **unlinks every `auth_user_id`**. Real
Supabase credentials survive (they live in `auth.users`, which the seed does not
touch) but their application accounts do not; the next sign-in creates a fresh,
empty one, and `npm run db:dev-accounts` re-links the development operator.
