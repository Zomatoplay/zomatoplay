# Changelog

Factual record of development on Nanotron. Newest first.

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
