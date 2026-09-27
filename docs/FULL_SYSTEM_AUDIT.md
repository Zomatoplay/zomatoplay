# Nanotron — Full System Audit

Date: 2026-09-28. Branch: `main`. Scope: the phone-OTP / S3 / single-address
deposit / PWA work (2026-09-27) and this hardening pass, plus a review of the
rest of the application.

Every finding carries one status:

| Status | Meaning |
|---|---|
| **PASS** | Checked and correct, with the evidence named |
| **WARNING** | Works, but has a known weakness or a condition to watch |
| **FAIL** | Wrong, and not fixed in this pass |
| **NOT TESTED** | Implemented, but could not be exercised here |
| **NEEDS HUMAN REVIEW** | A decision or an action only a person can take |

Nothing below was marked PASS on inspection alone where a test or a run was
possible.

---

## 1. Executive summary

- **Phone OTP sign-in is complete in code and needs one server secret to go
  live.** The server no longer needs a Firebase service-account key at all
  (it verifies the ID token with the public project id and signs its own
  session). What is missing in the runtime is `CUSTOMER_SESSION_SECRET`; with
  it unset `/login` says phone sign-in is unavailable. A real SMS round trip
  was **not** tested (no device, no Firebase test number available here).
- **Deposits**: one configured address, `DEP-XXXXXXXX` requests with a unique
  exact amount, server-side hash verification, credit-once enforced by the
  database. This pass added amount change, leave/cancel, "already processed"
  messages, Telegram support and a non-stored screenshot field. Covered by 18
  integration tests against a real database and a headless-browser run.
- **RDS**: the RDS connection string was **not available** to this runtime
  (`DATABASE_URL` and `DIRECT_DATABASE_URL` both point at the Supabase
  development project). Migrations `0019`–`0021` were applied to that
  database only. **RDS still needs `npm run db:migrate`** (§6).
- **Two real bugs were found by running the product, and fixed** (§20): a
  deposit poll in flight could put a replaced request back on screen, and a
  *Verify Payment* press could wait 40 s+ behind a chain scan.
- No balance, ledger row, deposit, investment, KYC record or referral was
  changed. Before/after counts are identical (§6).

---

## 2. What was implemented (this pass)

| Area | Change |
|---|---|
| Sessions | App-signed customer session (`customer-session-token.ts`), `users.session_epoch` revocation, no Firebase private key anywhere |
| Sign-out | Ends every phone session on every device; CRM "log out all devices" does the same |
| Deposit amount | *Change amount* creates a new request and cancels the old one in one transaction |
| Leave / cancel | In-app navigation away asks, then cancels; evidence-bearing requests refuse |
| Idempotency UX | "This deposit has already been processed" / "Transaction already processed" |
| Support | `lib/support.ts` + `TelegramSupportButton`; Settings → Support → Contact support |
| Screenshot | Optional, local preview only, never uploaded |
| Auth UI | Security page shows the verified number instead of "Change password" for phone users; profile locks a verified number (server-enforced) and hides an empty email |
| Fixes | Stale-poll overwrite; scan-blocks-verify; removed orphaned `requestTestDeposit` |
| Migrations | `0020_deposit_request_cancellation`, `0021_customer_session_epoch` |
| Tests | +4 files: lifecycle (11), phone auth (6), session token (6), support config (3) |

---

## 3. Firebase authentication status

| Item | Status | Evidence |
|---|---|---|
| Web config present in `.env.local` | **PASS** | all six `NEXT_PUBLIC_FIREBASE_*` set; values not printed |
| Config is one coherent project | **PASS** | Identity Toolkit `projects` lookup with the public key: the returned project number equals the messaging sender id; the auth domain starts with the project id |
| Phone provider enabled | **PASS (indirect)** | a probe with an invalid reCAPTCHA token to a fictional US number (+1 555-555-0100) returned `OPERATION_NOT_ALLOWED: SMS unable to be sent until this region enabled` — a region-policy refusal, which the phone provider only gives when it is on. No SMS was sent. |
| SMS region policy | **PASS (partial)** | a region policy is active and refuses +1. **Whether India is allowed could not be checked without sending a real SMS.** |
| Authorized domains | **WARNING** | `localhost`, the two Firebase defaults, and one IP address. **The production domain is not in the list** — add it before go-live, or reCAPTCHA fails there. |
| Server verification without a service account | **PASS** | `firebase-admin` `verifyIdToken` initialised with only a project id: a malformed token is rejected with a verdict (`auth/argument-error`), not a credential error |
| `CUSTOMER_SESSION_SECRET` in runtime | **NEEDS HUMAN REVIEW** | not set in `.env.local`; generate with `openssl rand -base64 48` on the server. Tests used a throwaway in-memory value. |
| Firebase test phone numbers | **NOT TESTED** | none known; cannot be listed without admin credentials |

## 4. Phone OTP status

| Flow | Status | Evidence |
|---|---|---|
| Send OTP / resend (60 s cooldown) / 5-wrong-codes cap | **NOT TESTED** live | client code reviewed; needs a real or test number |
| Invalid / expired OTP | **PASS (server side)** | any rejected token becomes "Invalid or expired OTP."; `auth_time` > 5 min refused |
| New customer | **PASS** | `phone-auth.integration`: one account per verified number, second sign-in reaches the same one, no invented email, uid ≠ account id |
| Duplicate phone | **PASS** | a number on another account is refused, no account created |
| Session restoration | **PASS** | production server + signed cookie: `/wallet` 200, `/login` → `/` |
| Protected routes | **PASS** | no cookie → 307 `/login`; forged cookie (one byte changed) → 307 `/login` |
| Logout / revocation | **PASS** | after the epoch moved, the old cookie's response contained no name, member id, balance or "USDT" and redirected to `/login`; a newly issued cookie worked |
| Rate limiting | **WARNING** | 20 attempts / 10 min per IP, **process-local** — exact on one process, weaker with several (FUTURE_TASKS) |
| E.164 normalisation | **PASS** | `lib/phone.test.ts`; +91 only |

## 5. Existing-user migration behaviour

| Rule | Status | Evidence |
|---|---|---|
| Never linked by the unverified `users.phone` | **PASS** | test: a legacy account whose typed phone equals the verified number is **not** adopted |
| Existing email customer keeps account id and balance when linking | **PASS** | test: balance 1234.56789 unchanged, same `user_id`, email kept |
| Ambiguity refused, never merged | **PASS** | re-linking to a second number refused; number on another account refused |
| No new empty account for an existing customer | **WARNING** | guaranteed only if the customer takes the email → `/link-phone` path. **A customer who goes straight to `/login` with a phone number that was never verified gets a new, empty account.** That is the documented rule (unverified phones are never trusted) but support will see it; the `/login` page links "Signed up with email?" to reduce it. **NEEDS HUMAN REVIEW** — decide whether to announce the one-time link step to existing customers before switching phone sign-in on. |
| Email data preserved | **PASS** | `users.email` nullable, never cleared |

## 6. RDS schema / migration status

| Item | Status |
|---|---|
| RDS URL available to this runtime | **BLOCKED BY ENVIRONMENT** — not in `.env.local` or the process environment. I did not go looking for it elsewhere. |
| Migrations applied to RDS | **NOT TESTED / NEEDS HUMAN REVIEW** |
| Migrations applied to the configured (Supabase dev) database | **PASS** — `0020`, `0021` via `npm run db:migrate`; journal 22 entries |
| Data preserved | **PASS** — identical before and after: 89 users, Σ available 95347.81732188, 38 deposits, 594 transactions, 48 investments, 30 KYC documents, 22 referrals |
| Schema agrees with code | **PASS** — `schema.integration.test` compares live ↔ declared both ways |
| Destructive statements | **PASS** — none. `0019` drops `NOT NULL` on `users.email`; everything else adds. |

**To apply on RDS** (in order): snapshot the instance → set `DIRECT_DATABASE_URL`
to RDS → `npm run db:migrate` → `npm run db:check` → compare the seven counts
above before and after. **Skip `db:secure` on RDS** (Supabase-only).

Identifiers the code keeps distinct, all verified in tests or schema:
internal user id (`users.id`, `usr_…`), Firebase uid (`users.firebase_uid`,
unique), phone (`users.phone_e164`, unique), deposit request id
(`DEP-` + 8 Crockford base32), chain transaction hash (64 hex,
`deposits (chain, tx_hash)` unique), ledger transaction id (`transactions.id`).

## 7. Deposit architecture status

| Item | Status |
|---|---|
| One configured address, env fallback, CRM screen with audit | **PASS** (previous pass; unchanged) |
| Ownership decided by recipient + exact amount + window, exactly one match | **PASS** — `deposit-request.integration` |
| Client never supplies user, amount credited, address, network, status | **PASS** — action signatures take only an amount *request*, a request id, a hash |
| Per-user pool removed from active code; tables kept as history | **PASS** |

## 8. Deposit idempotency status

The brief's 20 cases:

| # | Case | Result | Evidence |
|---|---|---|---|
| 1 | Valid hash | credited once | integration test |
| 2 | Invalid / nonexistent | "could not find…" + support | browser run, 4 s |
| 3 | Wrong network | not found (only the configured network is queried) | code |
| 4 | Wrong token | not found (contract filtered locally) | `tron.test` |
| 5 | Wrong recipient | not found (recipient listing) | code |
| 6–8 | Wrong / under / over amount | unattributed, `needs_review`, credits nobody | integration test |
| 9 | Not final | `verifying`, nothing recorded | code (§18.3) |
| 10 | Outside window | `outside_request_window`, no credit | integration test |
| 11 | Expired request | still matchable inside its window | integration test |
| 12–14 | Hash submitted again / processed / repeatedly | "already processed", no second credit | lifecycle test |
| 15 | Same amount repeatedly | same request returned; unique amount among open | lifecycle test |
| 16 | Someone else's hash | "Transaction already processed" / `not_yours`; victim credited | integration tests |
| 17 | Ambiguous | refused, `ambiguous_match` | integration test |
| 18 | Race | 5 concurrent recordings → one credit | integration test |
| 19 | Scanner replay | `unchanged` | integration test |
| 20 | Refresh / reopen | resumes the same request | browser run |

Database guards: `deposits_chain_tx_hash_key`, `deposit_requests_deposit_key`,
`deposit_requests_open_amount_key`, `deposit_requests_one_awaiting_per_user_key`,
status re-asserted in every crediting `UPDATE`. **PASS.**

## 9. Deposit cancellation / leave behaviour

| Item | Status | Evidence |
|---|---|---|
| Change amount → new id + amount, old cancelled | **PASS** | lifecycle test; browser run (25.88 → 55.28) |
| Leave dialog on in-app navigation; confirm cancels and navigates | **PASS** | browser run at 360 and 1280 |
| Request with a submitted hash cannot be cancelled | **PASS** | lifecycle test |
| Another customer cannot cancel | **PASS** | lifecycle test |
| Paid then left → still credited | **PASS** | lifecycle test |
| Cancelled amount not re-quoted while its window is open | **PASS** | deterministic test (98 of 99 offsets occupied) |
| Browser back button / tab close | **WARNING** | not intercepted, by design: the request expires on its own and reopening resumes it. The App Router has no navigation-blocking API. |
| Auditable | **PASS** | audit entry per cancellation; `cancelled_at`, `cancellation_reason` on the row |

"Release the amount for future use" is deliberately **delayed until the
window closes**: releasing it earlier is exactly how a later request could be
credited with someone else's payment.

## 10. Telegram support status

**PASS (mechanism) / NEEDS HUMAN REVIEW (value).** One source
(`NEXT_PUBLIC_SUPPORT_TELEGRAM`); only a valid Telegram username becomes a
`https://t.me/…` link (tested, including `javascript:` and foreign URLs). Unset
today, so the deposit screen shows *Contact support* → Help centre and Settings
says "Telegram support is not available yet. Email …" — both seen in the
browser run. **No handle was invented.** Set it, then rebuild (it is inlined
at build time).

## 11. Screenshot handling

**PASS.** Optional field, object-URL preview only, revoked on change/unmount,
never sent to the server, labelled "Stays on this device only — it is not
uploaded or stored". Verification does not read it.

## 12. S3 KYC status

| Item | Status |
|---|---|
| Off by default, no default bucket | **PASS** — `s3-kyc-store.test` |
| Opaque keys, own-prefix check before any S3 call, signed size/type | **PASS** — unit tests |
| Credentials from the instance role, none in code | **PASS** — code review; no key in tracked files (secret scan) |
| Private bucket, Block Public Access, IAM, CORS | **NOT TESTED** — no bucket; policies are in the runbook §2 |
| Old Supabase-stored documents still openable | **PASS** — rows carry `storage_backend`; reviewer signing picks the store |
| Migrating old objects to S3 | **NEEDS HUMAN REVIEW** — deferred; nothing deleted |

## 13. PWA status

| Item | Status |
|---|---|
| Manifest, icons | **PASS** — build output, previous headless check |
| Service worker caches only `/_next/static`, `/pwa-icon`, `/offline.html` | **PASS** — code re-read; navigations network-only; non-GET and cross-origin ignored |
| No financial data cached | **PASS** — no page, RSC payload, API or action response is ever put in a cache |
| Update behaviour | **WARNING** — `skipWaiting` + `clients.claim` activate a new worker at once (safe: it caches only immutable assets). `/pwa-icon/*` is cache-first and not content-hashed: a changed icon needs `CACHE_VERSION` bumped. |
| Installation on real devices | **NOT TESTED** |

## 14. Settings / support status

**PASS** — Support → *Contact support* row added in the existing `ListRow`
style (external rows open in a new tab); Security shows the sign-in method;
settings, security and deposit screens have no horizontal overflow at 360 px
and 1280 px, and no console errors (headless Chrome).

## 15. Security findings

| Finding | Status |
|---|---|
| No Firebase private key, no AWS key, no connection string in tracked files | **PASS** — pattern scan of tracked files: only placeholders and redaction-test fixtures |
| Session cookie: httpOnly, Secure in production, SameSite=Lax, HMAC-SHA256, constant-time compare, 14-day cap | **PASS** — tested for forgery, expiry, garbage, future `iat` |
| Session revocation | **PASS** for phone sessions; **WARNING** — legacy email sessions and operators still cannot be revoked server-side (needs the Supabase service-role key, deliberately not held) |
| Cron routes | **PASS** — all three use `cron-auth.ts` (constant-time, refuse when `CRON_SECRET` unset) |
| Operator auth separate | **PASS** — Supabase `admin_agents` gate unchanged |
| Rate limits process-local | **WARNING** — see §4 |
| A revoked or blocked session gets HTTP 200 + a streamed redirect, not a 307 | **WARNING** — the layout streams the shell before the account read; verified that no account data is in the response. Same pre-existing behaviour as an operator-blocked account. |

## 16. Authentication findings

- **PASS** — one identity question (`getCustomerPrincipal`), phone first, legacy
  Supabase second; precedence cannot move anyone into an account they did not
  already own.
- **PASS** — email sign-in creates no accounts once phone sign-in is live.
- **WARNING** — the legacy email routes (`/login/email`, `/forgot-password`,
  `/update-password`, `/reset-password`, `/auth/callback`, `/signup` when phone
  is off) **are still needed**: an existing customer must reach their account
  by email once to link a phone, and may need a password reset to do it. They
  were kept deliberately. Remove only after every account with a balance has a
  `firebase_uid` (query in §21).

## 17. Authorization findings

- **PASS** — every customer action resolves the account from the session;
  deposit actions scope by owner in the `WHERE`.
- **PASS** — CRM actions start with `requirePermission`; the new "all devices"
  sign-out is under `security`.
- **PASS** — profile update ignores a phone change for an account with a
  verified number (server-side, not only hidden).

### Verification commands and results

| Check | Result |
|---|---|
| `npm run typecheck` | **PASS** — 0 errors |
| `npm run lint` | **PASS** — 0 problems |
| `npm test`, database unset | **PASS** — 193 / 193 |
| `npm test`, development database | **WARNING** — 356 / 360. Two failures predate this work and fail identically in the earlier `.perf/test-rerun.log`: "holds exactly the seeded number of accounts" and "the historical backfill left no seeded deposit unannounced" (both assert facts about the shared live dataset — see CLAUDE.md §16.7). Two (`writes`: fixture user insert) were connection failures during the parallel run; `writes.integration.test.ts` alone: **13 / 13**. |
| New integration files alone | **PASS** — lifecycle 11/11, deposit-request 8/8 (18 with lifecycle's first run), phone-auth 6/6 |
| `npm run build` | **PASS** |
| Production server + headless Chrome, 360 px and 1280 px | **PASS** — amount → request → change amount → invalid and unknown hash → support → leave dialog → cancel; Settings; Security |

## 18. Database findings

- **PASS** — money stays `numeric`; new columns hold no money.
- **PASS** — every new uniqueness rule is an index, not a prior `SELECT`.
- **WARNING** — `drizzle-kit` names migrations randomly; `0020`/`0021` were
  renamed descriptively and the journal updated to match. Use the same care
  with future migrations.
- **WARNING** — the integration suite writes to whatever `DATABASE_URL` names.
  A run killed mid-way leaves its fixtures behind: this pass found two
  "Release Test" users from a run I had interrupted, and deleted them (the
  counts in §6 are after that). **Never point the suite at production.**

## 19. Performance findings

- **PASS (fixed)** — a *Verify Payment* press waited behind an awaited chain
  scan (Next serialises one client's server actions). The poll now starts the
  scan with `after()`; the same press answers in ~4 s.
- **WARNING** — against the development database from here, a deposit
  request create takes 2–5 s (several round trips at ~200 ms, §16.1a). On
  EC2 next to RDS this should fall sharply; **measure there**.
- **PASS** — the session check adds no round trip (epoch read on the existing
  account query).

## 20. Broken or questionable areas

| Item | Status |
|---|---|
| Replaced deposit request reappeared (stale poll) | **FIXED** — updates for any other request id are ignored, and results after unmount dropped |
| Verify blocked behind scan | **FIXED** (§19) |
| `CLAUDE.md` §3 lists `motion` as a dependency; it is not installed | **WARNING** — doc drift, left for a human |
| `CLAUDE.md` §18.5 described the deleted `DepositWatcher` and a 4 s floor (actual 15 s) | **FIXED** |
| The Settings footer says "demo build · Sample data only. No real funds…" | **NEEDS HUMAN REVIEW** — on a production deployment with real deposits this is false. Not changed: it is product/legal copy. |
| `SupportCenter` "Send message" says "Demo build — no ticket was actually created" | **WARNING** — honest, but a production support form that does nothing; the Telegram row is the real channel now |

## 21. Potential cleanup (requires human review)

| Item | Why not removed |
|---|---|
| Legacy email auth routes/components | still the only path for existing customers to link (§16). Remove when `select count(*) from users u join wallet_balances w on w.user_id = u.id where u.firebase_uid is null and (w.available > 0 or w.locked_in_investments > 0)` is 0. |
| `deposit_addresses`, `deposit_address_assignments` | history of past attributions (CLAUDE.md §18.8) |
| `src/components/ui/separator.tsx` (+ `@radix-ui/react-separator`) | unused shadcn primitive; harmless |
| `src/hooks/use-mounted.ts` | unused; listed in CLAUDE.md's folder map |
| `recordDepositIntent` | only tests use it now |
| `measure-tmp.ts`, `q*-tmp.ts` (repo root) | pre-existing, untracked, not mine; left in place and **not** committed |
| `.perf/test-rerun.log` | pre-existing modified file; not committed |

Removed in this pass, with reason: `requestTestDeposit` (development-only
action, refused in production, no caller after the old deposit screen was
replaced); the Firebase service-account code paths (replaced, not needed).

## 22. Items deliberately NOT changed

Production DNS; the production deposit address (still the env default until an
operator saves one); any balance, ledger row, deposit, investment, KYC record or
referral; the Supabase database; historical deposit records; operator
authentication; the exact-amount matching rule; the email column.

## 23. Items requiring human review

1. Generate and set `CUSTOMER_SESSION_SECRET` on EC2.
2. Add the production domain to Firebase authorized domains; confirm the SMS
   region policy allows India.
3. Run the migrations on RDS (§6) after a snapshot.
4. Set `NEXT_PUBLIC_SUPPORT_TELEGRAM` to the real handle and rebuild.
5. Decide how existing customers are told about the one-time email → phone
   link (§5).
6. The "demo build / no real funds" copy (§20).
7. S3 bucket, IAM role and CORS (runbook §2).

## 24. Blocked by missing credentials / external services

| Item | Needs |
|---|---|
| Real OTP send/verify, resend, wrong/expired code UX | a real device or a Firebase test number |
| RDS migration and verification | the RDS URL in the runtime |
| S3 upload/download | the bucket and instance role |
| PWA install on iOS/Android | real devices |
| A real deposit credited by a submitted hash | a testnet transfer to a configured address |

## 25. Recommended next steps

1. Items 1–4 of §23, then a staged test on EC2: sign in with a Firebase test
   number, link a legacy account, sign out on one device and confirm the other
   is signed out.
2. Send a Nile/Shasta testnet transfer to a test deployment and verify it by
   hash end to end.
3. Move the rate limiter to a shared store before running more than one
   process.
4. Measure deposit request latency on EC2 + RDS.
5. After most customers have linked a phone, retire the legacy email routes
   (§21 query).
