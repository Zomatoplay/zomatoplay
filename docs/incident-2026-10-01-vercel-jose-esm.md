# Incident 2026-10-01 — Vercel 500: `jwks-rsa` → `require('jose')` (ESM)

Classification: **PASS**, **FAIL**, **BLOCKED**, **NOT TESTED**.

## 1. Root cause

```
Error: require() of ES Module /var/task/node_modules/jose/dist/webapi/index.js
from /var/task/node_modules/jwks-rsa/src/utils.js not supported.
```

`firebase-admin@14.5.0` depends on `jwks-rsa@^4.0.1` → `4.1.0`, which is
CommonJS and does `const jose = require('jose')` at the top of `src/utils.js`.
It declares `jose@^6.1.3`, and jose 6 is **ESM-only** (`"type": "module"`, no
`require` export condition). That only works on a Node runtime with
`require(esm)` support (unflagged from 20.19 / 22.12 — exactly jwks-rsa 4's
`engines` field). The Vercel function runtime evaluated it without that
support, so the require threw at module load.

Why every customer route, and why in ~17 ms:

```
src/app/(app)/layout.tsx
  → src/server/auth/phone-sign-in.ts          (isPhoneSignInLive)
    → src/server/auth/firebase-admin.ts       (static import)
      → firebase-admin/auth → lib/utils/jwt.js → require("jwks-rsa")
        → jwks-rsa/src/utils.js → require("jose")   ✗
```

The import is top-level, so it fails while the route module is being loaded —
before any request logic, database or network call.

Why `npm run build` passed: Next 15 **externalizes** `firebase-admin` (it is on
Next's built-in server-external list). The built `(app)/page.js` contains
`import("firebase-admin/auth")`; the `require('jose')` happens only at runtime,
inside the function. Local `next start` on Node 22.23 has `require(esm)`, so it
also passed locally.

## 2. Versions before

| Package | Version | Introduced by |
|---|---|---|
| firebase-admin | 14.5.0 | direct dependency (`^14.5.0`) |
| jwks-rsa | 4.1.0 (latest published) | firebase-admin (`^4.0.1`) |
| jose | 6.2.12 | jwks-rsa (`^6.1.3`) |

One copy of each; nothing else in the tree depends on jose or jwks-rsa.
Next.js 15.5.23, local Node 22.23.2, no `engines`, no `type` in package.json,
no `serverExternalPackages`, no route `runtime` overrides.

## 3. Versions after

| Package | Version |
|---|---|
| firebase-admin | 14.5.0 (unchanged) |
| jwks-rsa | 4.1.0 (unchanged) |
| jose | **5.10.0**, nested at `node_modules/jwks-rsa/node_modules/jose` |

Lockfile diff: that one package entry, nothing else.

## 4. Fix selected

```json
"overrides": { "jwks-rsa": { "jose": "5.10.0" } }
```

Scoped to jwks-rsa, exact version. jose 5 ships a real CommonJS build
(`require` export condition), so the require succeeds on **any** Node version.

## 5. Why this fix

- **Does not depend on an unverifiable runtime detail.** Pinning
  `engines.node` would only help if Vercel's runtime then has `require(esm)`;
  that cannot be confirmed from here (no Vercel CLI / project link).
- **No code change, no bundling change.** Forcing webpack to bundle
  `firebase-admin` (removing it from externals) would pull a large server SDK
  through the bundler — a bigger change during an outage.
- **No newer upstream fix exists**: jwks-rsa 4.1.0 is the latest release and
  firebase-admin 14.5.0 is the latest release.
- **API-compatible.** jwks-rsa uses `importJWK`, `exportSPKI`, `decodeJwt`,
  `decodeProtectedHeader`; all exist in jose 5 with the same signatures.
  Verified: jwks-rsa's `retrieveSigningKeys` on jose 5 converts an RSA JWK to
  the byte-identical SPKI PEM Node produces.

**Maintenance caveat.** jose 5.10.0 (2025-02-17) is the final 5.x release; the
jose author actively maintains only v6. `npm audit` lists no advisory against
it (15 findings before the change, the same 15 after, none in jose). Remove the
override once jwks-rsa ships a CJS-safe release or the runtime is confirmed to
support `require(esm)` (§10).

## 6. Security impact

**None on Firebase ID-token verification — jose/jwks-rsa are not on that
path.** In firebase-admin 14.5.0, `createIdTokenVerifier` uses
`CLIENT_CERT_URL` (Google's x509 certificates for
`securetoken@system.gserviceaccount.com`) via `UrlKeyFetcher`. `JwksFetcher`
(jwks-rsa) is used only by App Check token verification, which this
application never calls. jwks-rsa is loaded only because `utils/jwt.js`
requires it unconditionally.

Unchanged: signature check against Google's certs, `kid` lookup, issuer
`https://securetoken.google.com/<project>`, audience = project id, `exp`/`iat`,
`sub`, and Nanotron's own checks (`sign_in_provider === "phone"`,
`phone_number` present, `auth_time` within 5 minutes). No auth code was
modified.

## 7. Local verification

| Check | Result |
|---|---|
| Reproduce: `node --no-experimental-require-module -e 'require("firebase-admin/auth")'` with jose 6 | **PASS** — the exact production `ERR_REQUIRE_ESM` |
| Same with the fix | **PASS** — loads |
| `npm run typecheck` | **PASS** |
| `npm run lint` | **PASS** |
| `npm test` (`DATABASE_URL` unset) | **PASS** — 205/205 |
| `npm test` with `DATABASE_URL` set | **NOT TESTED**, deliberately — the integration suite writes users, ledger rows and deposits and `settleInvestments()` is global; the configured database may be the one production uses. No database code changed. |
| `npm audit` | No new findings (15 → 15, none in jose). Pre-existing, out of scope: a critical advisory against `next` 15.5.23. |

## 8. Production build verification

Both passes: `npm run build` (pass 2 from an empty `.next`), then
`NODE_OPTIONS=--no-experimental-require-module next start` — the runtime
condition Vercel hit.

| Route | Before fix (control, same build) | After fix (pass 1 and pass 2) |
|---|---|---|
| `/` | **500** | 307 → `/login` |
| `/login` | **500** | 200, mobile-number form |
| `/plans` `/wallet` `/settings` | **500** | 307 → `/login` |
| `/wallet/deposit` `/referral` | — | 307 → `/login` |
| `/admin` | — | 307 → `/admin/login` |
| `/admin/login`, `/manifest.webmanifest` | — | 200 |
| Server log: `ERR_REQUIRE_ESM` / `MODULE_NOT_FOUND` / `Invalid URL` | present | **0** |

## 9. Firebase verification path (fixed build, `require(esm)` off)

`verifyPhoneIdToken` against Google's live certificates:

| Token | Result |
|---|---|
| garbage | rejected — `FirebaseCredentialError` |
| `alg: none` | rejected |
| self-signed RS256, forged `kid` | rejected |
| self-signed RS256, no `kid` | rejected |
| wrong audience | rejected |
| expired | rejected |

All rejected as *verdicts* (not `FirebaseUnavailableError`), i.e. the
certificate fetch succeeded and signature verification ran.

Accepting a **genuine** Firebase phone ID token: **NOT TESTED** — requires a
real SMS OTP.

## 10. Vercel verification

**BLOCKED.** No Vercel CLI and no `.vercel` project link on this machine, and
the change is committed but **not pushed** (per instruction). Vercel is not
fixed until a deployment is made and checked.

To finish:
1. Push `main`; wait for the deployment.
2. `curl -sI https://<domain>/` → expect `307` to `/login`, not `500`; same for
   `/login` (200), `/plans`, `/wallet`, `/settings` (307 when signed out).
3. Vercel → Logs: no `ERR_REQUIRE_ESM`.
4. Worth checking: Project Settings → Node.js Version. `firebase-admin` 14
   declares `node >= 22`; if the project is on 20.x, set 22.x. That is
   independent of this fix, which works on either.

## 11. Authentication regression

| | |
|---|---|
| Customer phone OTP → ID token → server verification → signed session | Code unchanged; verifier loads and rejects forged tokens (**PASS**); full sign-in with a real OTP **NOT TESTED** |
| Unauthenticated customer routes redirect to `/login` | **PASS** |
| Operator console gated (`/admin` → `/admin/login`) | **PASS** |
| Local test sign-in development-only | Unit tests (`dev-test-auth.test.ts`) **PASS**; code unchanged |
| Authenticated customer page render on the production build | **NOT TESTED** — the local test sign-in is disabled in production builds by design, and a real sign-in needs SMS |

## 12. Remaining warnings

- jose 5.x is end-of-line upstream (§5); the override is a stopgap to revisit.
- Pre-existing `npm audit` advisories, including one critical against `next`.
- RDS and financial data: not touched.
