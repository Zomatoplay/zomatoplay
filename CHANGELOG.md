# Changelog

Factual record of development on Nanotron. Newest first.

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
