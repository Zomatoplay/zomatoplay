# Perceived-render performance — measurement note

**2026-09-20.** How long an authenticated screen takes to become *visible*, as
opposed to how long its data takes to arrive. Numbers here are measured, not
estimated; the method is written down so they can be reproduced or disproved.

---

## 1. What was measured, and why not "page load time"

These pages stream. The useful question is therefore not "when did the response
finish" but **"when did each piece of markup reach the browser"**, so the probe
records the wall-clock offset at which each marker substring first appears in
the response byte stream:

| column | meaning |
|---|---|
| `ttfb` | first byte of the response |
| `shell` | `aria-label="Primary"` — the bottom navigation exists, so the app frame is on screen |
| `struct` | a **static** string belonging to the page (a section heading, a row label) — the real page structure, not a generic skeleton |
| `data` | a **user-specific** string (`≈ ₹`, the referral link, the account email) — real account data |
| `done` | stream closed |

`struct` is the number this work was about. `data` is deliberately allowed to
be later.

### Method

- Production build (`npm run build` + `npx next start`), never the dev server.
- A real password sign-in against the real Supabase project, with the genuine
  `@supabase/ssr` session cookie. No mocking and no auth bypass.
- Same machine, same database (Supabase session pooler, ap-northeast-2, from
  India), runs interleaved.
- **Before** numbers were taken by `git stash`-ing the change set and rebuilding,
  so both sides were measured with the identical probe and markers.
- Harness: `.perf/measure.mjs` (per-route) and `.perf/rapid.mjs` (navigation
  patterns). Untracked scratch tooling, not part of the app.

### What these numbers are not

Server-side streaming only. They do not include network transit to a real
device, client hydration, or paint. They are a lower bound on what a user
experiences, and the right measure of *this* change, because everything that
was fixed was server-side blocking.

---

## 2. Result

All figures milliseconds, warm (pool established), two passes each.

### Before → after

| route | `struct` before | `struct` after | shell after |
|---|---|---|---|
| `/` | 1564, 1628 | **50, 191** | 50, 190 |
| `/plans` | 1165, 1349 | **125, 155** | 125, 154 |
| `/wallet` | 1663, 1775 | **127, 138** | 127, 138 |
| `/referral` | 1719, 1769 | **121, 167** | 121, 167 |
| `/settings` | 1027, 1060 | **148, 153** | 148, 152 |
| `/wallet/transactions` | 582, 584 | **134, 135** | 134, 135 |
| `/settings/security` | 540, 572 | **121, 131** | 120, 131 |
| `/settings/investments` | ~1000 | **32** (header) | 32 |
| `/wallet/deposit` | — | **140, 154** | 140, 154 |

TTFB on the five primary routes went from **563–913ms** to **120–240ms**, and
`struct` now equals `shell` on every route: the page's own structure is in the
first flush rather than several hundred milliseconds behind it.

For reference, the floor on this machine for a route that reads nothing at all
(`/login`, `/settings/legal/terms`) is **20–45ms**. The authenticated routes are
now within ~100–200ms of that floor, and what remains is Next's dynamic-render
overhead rather than database work.

### Navigation patterns

Rapid tab-hopping with no think time, three laps of Home → Plans → Wallet →
Referral → Settings:

```
struct: 32–50ms across all 15 navigations
```

Five navigations issued concurrently (what abandoning a page mid-load produces,
since the server keeps rendering it — CLAUDE.md §16.1a item 7):

```
/           shell= 79   /plans  shell=141   /wallet shell=175
/referral   shell=187   /settings shell=203        wall 4059ms
```

Even with five renders competing for a five-connection pool, every shell is
inside the 200–600ms target. The `done` times degrade under that contention;
the visible UI does not.

### Cold

First request to a freshly started process, before the pool is warm:

- Every route 157–309ms **except** the very first database query of the
  process, which paid 9.9s on `/`. That is the connection handshake described
  in CLAUDE.md §16.1a (~2,000ms per connection, several concurrently), not
  render blocking, and it is infrastructure rather than application
  architecture. It affects the first request an instance serves and no other.

---

## 3. What data still arrives after the shell

Nothing on this list blocks the structure any more. Each has its own boundary
and its own skeleton.

| route | deferred |
|---|---|
| `/` | greeting name, KYC banner, balance + allocation summary, allocations list, earnings chart, recent activity |
| `/plans` | plan cards, available balance for the invest sheet |
| `/wallet` | deposit-arrived card, hero balance, earnings breakdown, transactions |
| `/referral` | stat tiles, referral link + QR, VIP table, referral/commission activity |
| `/settings` | profile card, verification badge |
| `/settings/investments` | the whole overview |
| all | `TopBar`'s avatar initials and unread badge |

Typical `data` arrival warm: **820–1,200ms**, occasionally to ~2,000ms under
contention. That is unchanged by this work — it is database latency (CLAUDE.md
§16.1a), and reducing it is an infrastructure and query-count question, not a
rendering one. See `FINDINGS.txt`.

---

## 4. The rule that constrained every skeleton

**No loading state may render a financial or account value.** Not a zero
balance, not a currency amount, not a count, not a verification badge, not an
avatar initial.

A placeholder balance of `0.00` is not a slower truth, it is a false one, and a
placeholder verification badge is the same class of lie as a client-supplied
`liveness_check_passed` (CLAUDE.md §23). So every fallback added here renders
shape only — a pulsing block of the right size — and the semantics are carried
by `aria-busy` / `aria-label` rather than by fake content.

`WalletOverview` in particular is still absent until the balance is real. The
existing product rule ("a wallet that quietly omits its balance misinforms")
is about never showing a wrong number; it never required withholding the
section headings and the transaction panel while that number loads, and it no
longer does.

---

## 5. Reproducing

```bash
node .perf/login.mjs          # real sign-in → .perf/cookies.txt
npm run build && npx next start -p 3000
node .perf/measure.mjs "label"
node .perf/rapid.mjs
```

The `.perf/` directory is scratch tooling and is not part of the application.
Re-measure before trusting any of the above elsewhere: the milliseconds are a
property of this machine's distance from ap-northeast-2. **The shape — static
structure in the first flush, account data after it — is what generalises.**
