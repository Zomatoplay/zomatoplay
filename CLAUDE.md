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

**Frontend only.** This build is a functional prototype with realistic mock
data and local state. This applies to the Master CRM as much as the user app.

### Intentionally NOT implemented

- Real authentication / sessions (for users *or* administrators)
- Authorization enforcement — the CRM's permission model is UI-only (§15.3)
- Database or persistence of any kind
- Backend API or server actions that mutate real data
- Blockchain connectivity, wallet integration, real deposit verification
- Real withdrawals or payment gateway
- Real KYC provider integration, and no real document storage
- Real investment engine or referral payout system
- Real notification delivery

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

### 4.2 Prototype state

`src/lib/prototype-store.tsx` is a React context + reducer holding the slice of
state a backend would own: KYC status, wallet balances, investments,
transactions, notification preferences, security toggles.

- Seeded from `@/data`.
- **Deliberately in-memory** — it resets on a full page reload. Do not add
  persistence; it would have to be unwound at integration time.
- Every action maps 1:1 to a future API call. At integration, replace reducer
  cases with mutations + `router.refresh()`; consumers stay unchanged.

Because state lives in the client, flows must be exercised via **client-side
navigation**. A hard reload returns to the seed data.

### 4.3 Data layer

All mock data lives in `src/data/` and is never inlined into components. Each
module is shaped like the payload a real API would return, so swapping in
`fetch` is mechanical.

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
npx tsc --noEmit     # must be clean
npx eslint .         # must be clean
npx next build       # must succeed
```

Then run the app and actually look at it — at 360px and at desktop. Check for
horizontal overflow, clipped content, elements under the bottom bar, and
console errors. Do not report that something "should work".

---

## 13. Future integration plans

Ordered roughly by dependency:

1. **Auth** — sessions, sign-in/up routes, route protection. `AccountActions`
   in `settings/logout-button.tsx` becomes a real sign-out.
2. **Backend + database** — replace `@/data` reads with API calls; replace the
   prototype store reducer with mutations + revalidation.
3. **KYC provider** — swap the mock step machine for the provider SDK; drive
   `kycStatus` from their webhook.
4. **Deposit service** — per-user addresses, a real chain watcher feeding the
   `DepositFlowStage` states, removal of the demo simulation control.
5. **Withdrawal / payout rails** — real INR payouts and status transitions.
6. **Rates API** — replace `getUsdtInrRate()`.
7. **Investment engine** — real accrual, maturity and reward scheduling.
8. **Referral payouts** — real commission calculation and crediting.
9. **Localisation** — `settings/language` lists the intended locales.

---

## 14. Instructions for future Claude Code sessions

1. Read this file first.
2. Read `CHANGELOG.md` for what has actually happened.
3. Inspect before editing. Match the surrounding style.
4. Respect the server/client split in §4.1 and the currency rule in §4.4.
5. Mobile-first for the user app, always — verify at 360px. The Master CRM is
   desktop-first but must still work at 360px.
6. Never add guaranteed-return language; never remove risk or prototype
   notices. This applies to the CRM too — an operator reads the same figures.
7. Do not introduce dependencies casually.
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

### 15.4 Mock state

`src/lib/admin-store.tsx` — context + reducer, seeded from `src/data/admin/`.
Same contract as the user app's store: **in-memory, resets on a full reload**,
one action per future API call.

Two things about it are load-bearing:

1. **Every mutating action writes its audit entry in the same reducer case**,
   through `withAudit()`. The write and its audit record are one transaction —
   never two call sites that can drift apart. This is why the audit log shows
   real consequences of what the operator just did.
2. **Reasons collected by a dialog reach the audit entry.** Confirmation
   dialogs tell the operator "This is recorded in the audit log", and several
   *require* a reason. `withNote()` joins it onto the detail line so that
   promise actually holds. If you add an action that collects a reason, thread
   it through — do not let the dialog lie.

Because state is client-side, the session switcher and permission gating are
only exercised through **client-side navigation**; a hard reload restores the
master-admin session and the seed data.

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
3. **Admin API** — replace `@/data/admin` reads with fetches and the reducer
   cases with mutations + `router.refresh()`.
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
