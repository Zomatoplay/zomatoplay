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

**Deposits are detected on TRON Shasta** by a server-side scanner (§18). They
are recorded automatically and attributed to an account manually — one platform
address cannot tell you whose money arrived (§18.4).

**Every mutation is traceable.** `pipeline_events` records what the machinery
did, with timings and a correlation id per request, and `/admin/system-logs`
reads it (§22).

**The application still runs with no database at all.** With `DATABASE_URL`
unset, catalogue and platform reads return the seed modules in `@/data`. User-
scoped reads and every write refuse instead, which is deliberate — see §16.3.

### Intentionally NOT implemented

- **Outbound** blockchain: no signing, no key material, no sending. Deposits are
  read from the chain; nothing is ever written to it (§18).
- TRON **mainnet** — refused in code, not merely unconfigured (§18.1).
- Real withdrawals or a payment gateway. Withdrawal records exist and hold a
  balance; nothing pays anyone (§17.4).
- **Server-side session revocation.** The CRM marks a device session revoked;
  it cannot invalidate the Supabase refresh token behind it, because that needs
  the service-role key this project deliberately does not hold (§19.6). The UI
  and the audit line both say so rather than implying otherwise.
- Per-user deposit addresses, which is what would make attribution automatic.
- A real KYC provider, and no document storage. Only masked document numbers
  and filename metadata are kept.
- A real investment engine. Accrual exists as `recordInvestmentEarning()` with
  its idempotency key; no scheduler calls it (§16.5).
- Referral payout automation, and real notification delivery beyond in-app.
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
  Percentages and thresholds live in `src/data/referrals.ts` as data so a config
  service can drive them later. Never hard-code them in components.
- **Deposit lifecycle** — select network → show address → await transfer →
  detected → confirmations accumulate → credited.

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
3. **KYC provider** — swap the mock step machine for the provider SDK; drive
   `kycStatus` from their webhook.
4. **Deposit service** — per-user addresses, a real chain watcher feeding the
   `DepositFlowStage` states, removal of the demo simulation control.
5. **Withdrawal / payout rails** — real INR payouts and status transitions.
6. **Rates API** — replace `getUsdtInrRate()`.
7. **Investment engine** — real accrual, maturity and reward scheduling. This
   is also what replaces `earnings.service.ts`, the one read still served from
   seed data (§16.5).
8. **Referral payouts** — real commission calculation and crediting.
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

Other scripts: `npm run db:generate` after changing the schema, and
`npm run db:studio` for Drizzle's table browser.

#### Two connections

| Variable | Used by | Shape |
|---|---|---|
| `DATABASE_URL` | every render | pooled, `max` 5 per instance |
| `DIRECT_DATABASE_URL` | `db:migrate`, `db:seed`, `db:studio` | one connection, opened and closed |

`DIRECT_DATABASE_URL` is optional and falls back to `DATABASE_URL`. It exists
because a migration takes an advisory lock and issues DDL, which wants a session
to itself and has no business sharing the pool the application renders from.

#### Which Supabase endpoint — and why not the obvious ones

Supabase offers three, and the two that look right are both wrong here. This is
written down because both failures are invisible until they are not, and
rediscovering them costs an afternoon.

- **Direct** (`db.<ref>.supabase.co:5432`) — publishes **AAAA records only**.
  Vercel's serverless runtime has no IPv6 egress, so it cannot reach it at all.
  Unusable in production regardless of what it does locally.
- **Transaction pooler** (`…pooler.supabase.com:6543`) — the usual
  recommendation for serverless, and what this was built on first. It had to be
  abandoned. postgres.js pipelines queries onto a connection, and past roughly
  two queued queries the transaction pooler simply stops answering: no error, no
  timeout, the promise never settles. Reproduced with the stock driver, no local
  patches, at every pool size from 1 to 10, and *not* fixed by `prepare: false`.
  A page that issues six queries in parallel hangs.
- **Session pooler** (`…pooler.supabase.com:5432`) — **what both variables use.**
  IPv4, so Vercel can reach it; pooled by Supavisor, so a burst of serverless
  invocations does not exhaust Postgres; and it handled twenty queued queries on
  a single connection without complaint.

Transaction-mode support stays in the client (`usesTransactionPooler()` turns
prepared statements off) so switching back is one environment change if that
interaction is ever fixed.

#### If connections take ~5 seconds each

Some machines' resolvers stall on AAAA lookups before falling back to IPv4.
`getaddrinfo` pays that on every new connection, so a page opening eight of them
times out. Set `DATABASE_FORCE_IPV4=true` in `.env.local`; the Supabase pooler
publishes no AAAA record, so nothing is lost. It is off by default because the
stall is a property of the machine, not of the application.

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

1. **A connection must never be thrown away.** `idle_timeout` was 20 seconds,
   which is how long a person spends reading a page before clicking. Measured:
   query, idle 30s, query again → **2,187 ms**. With the connection kept →
   **278 ms**. It is now `0` (never close for being idle), overridable with
   `DATABASE_IDLE_TIMEOUT`.

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

   The pool is **8** and the warm-up **7** (`DATABASE_POOL_MAX`,
   `DATABASE_WARM_CONNECTIONS`), and the two must move together. An earlier note
   here rejected a bigger pool after measuring `max: 12` as *worse* cold; that
   measurement was correct and its conclusion was not, because the warm-up was
   left at four, so the extra eight connections were opened in front of a user.
   Raised together (2026-08-25, production build, three alternating runs) both
   directions improve: Home 1.10–1.49s → 0.75–0.83s warm, 4.6–5.0s → 3.0–3.7s
   cold.

   **The ceiling is fifteen, and it belongs to the project, not to this app.**
   Supavisor answers a sixteenth session-mode client with `(EMAXCONNSESSION) max
   clients reached in session mode - max clients are limited to pool_size: 15`,
   shared by every instance, `npm run db:*`, the scanner and the test suite — a
   server holding ten stalled the integration suite until it was stopped. So
   `DATABASE_POOL_MAX` is a per-instance number against a fixed global one: a
   multi-instance deployment lowers it. Making a larger number safe means
   raising the project's pool size in the Supabase dashboard first.

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
on a fresh clone. **127 tests with a database configured.**

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

Read-only, Shasta only. `@/server/tron/`.

### 18.1 Rules

- **Testnet only.** `TRON_NETWORK=mainnet` throws. Enabling mainnet should be a
  reviewed code change, not an environment variable someone flips.
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
TronGrid  →  parse/filter  →  confirmation check  →  deposits row (unassigned)
                                                          ↓  operator assigns
                                             ledger entry + balance + audit
```

Three filters decide what counts, and all three are enforced locally even
where TronGrid was asked to do it:

- **Contract** — anyone can deploy a token, call it USDT and send a million of
  it to the deposit address. Only `TRON_USDT_CONTRACT` counts.
- **Recipient** — `only_to=true` is the server's promise, not ours to keep.
- **Direction** — self-transfers and outgoing transfers are not deposits.

Token decimals are read from the response, never assumed: TRC-20 USDT is six
decimals on TRON and eighteen elsewhere, and guessing scales every amount by a
million. (Verified against Shasta: the contract reports `decimals: 6`.)

### 18.3 Confirmation

A transfer is recorded as creditable only once its block is **solidified** —
at or below the height from `/walletsolidity/getnowblock`, which is TRON's
irreversibility marker. Unconfirmed transfers are counted and left for the next
pass; the poll window overlaps by a minute so nothing falls between passes.

`TRON_CONFIRMATION_REQUIRED=false` skips this. It exists for local testing and
should not be used anywhere real: crediting before finality means crediting
money a re-org can take back.

### 18.4 Deposit attribution — the limitation

**A blockchain transaction does not identify which user paid.**

There is one platform receiving address. A TRC-20 transfer carries a sender
address and nothing else — no memo, no invoice id. Two users withdrawing from
the same exchange are indistinguishable on-chain, and a user can pay from an
address they have never mentioned.

So:

- `deposits.user_id` is **nullable**, and the scanner never sets it.
- An operator attributes each deposit in `/admin/deposits`. That action credits
  the wallet and is audited.
- The CRM offers no "best match" suggestion, on purpose. A plausible suggestion
  is the thing most likely to be accepted without checking, and crediting the
  wrong account is a loss, not a display bug.

**The way out is per-user deposit addresses.** Nothing here blocks it: add a
`deposit_addresses` table, resolve `to_address` through it at detection, and
`user_id` becomes derivable. Every other column stays as it is.

### 18.5 The scanner

Polling, not events: restartable, nothing to lose, and its failure mode is
delay rather than loss. The cursor in `chain_scan_state` is an **optimisation** —
losing or resetting it is harmless, because the unique index on
`deposits(chain, tx_hash)` is what prevents double-crediting. A failed pass does
not advance the cursor and is recorded, so "no deposits" and "no successful scan
since Tuesday" look different.

### 18.6 Environment

| Variable | Meaning |
|---|---|
| `TRON_NETWORK` | `shasta` or `nile`. `mainnet` throws. |
| `TRON_GRID_URL` | Must be https. |
| `TRON_GRID_API_KEY` | Optional; without it, a much lower rate limit. Server-only. |
| `TRON_USDT_CONTRACT` | The only contract that counts as a deposit. |
| `TRON_PLATFORM_DEPOSIT_ADDRESS` | The single receiving address. |
| `TRON_CONFIRMATION_REQUIRED` | Wait for solidification. Default on. |
| `TRON_POLL_INTERVAL_MS` | Scanner interval. Default 30000. |
| `TRON_LOOKBACK_MS` | First-run window. Default 24h. |

Leaving the contract and address unset disables the integration; nothing else in
the application is affected.

### 18.7 Shasta workflow

```bash
npm run tron:inspect          # read the chain, change nothing
npm run tron:inspect -- 72    # …looking back 72 hours
npm run tron:scan             # one pass, records unassigned deposits
npm run tron:scan -- --watch  # poll continuously
npm run tron:scan -- --dry    # read and report, write nothing
```

End-to-end:

1. Get Shasta TRX from a faucet, and test USDT for the configured contract.
2. Send test USDT to `TRON_PLATFORM_DEPOSIT_ADDRESS`.
3. `npm run tron:inspect` — the transfer should appear, with whether it is
   solidified and what the scanner would do with it.
4. `npm run tron:scan` — it becomes a `confirmed`, **unassigned** deposit.
5. Open `/admin/deposits`, use **Assign**, pick the account.
6. The wallet balance rises, a ledger entry cites the transaction hash, and the
   audit log records who assigned it.

`tron:inspect` is read-only by construction, not by promise: it never imports
the deposits service and never opens a transaction.

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
- **A KYC provider.** Submissions carry masked document numbers and filename
  metadata; no file is uploaded anywhere, because there is nowhere to put it.
- **Investment automation.** `recordInvestmentEarning()` exists with its
  `(investment_id, period_key)` idempotency key; nothing schedules it, so
  earnings report what has settled and there is no settling process yet (§16.5).
- **Per-user deposit addresses**, which is what would make attribution automatic
  (§18.4).
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
