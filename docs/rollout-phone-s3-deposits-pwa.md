# Rollout runbook — phone sign-in, S3 KYC storage, single-address deposits, PWA

Operational steps for the four changes in CHANGELOG 2026-09-27. Durable rules
live in `CLAUDE.md` (§16.1c, §18.4, §18.8, §19.7, §25); this file is the
checklist for turning them on. **Every step marked ☐ MANUAL happens in a
console, not in this repository.**

---

## 0. Order of operations (production)

1. ☐ MANUAL — snapshot the production database (RDS snapshot, or a Supabase
   backup if still on Supabase). The migration is additive, but a snapshot is
   the rollback plan.
2. Deploy the code. Customer email sign-in is **off** unless
   `LEGACY_EMAIL_SIGN_IN=true` (§1.3 — decide first whether this database holds
   customers who still need to link a number). KYC upload follows the existing
   store, and the deposit address is still `TRON_PLATFORM_DEPOSIT_ADDRESS`.
   **Never set `DEV_TEST_*` on the server** (they do nothing in a production
   build, but they do not belong there).
3. **On the EC2 host** (RDS is in a private subnet; it is not reachable from a
   laptop): `npm run db:verify` — READ-ONLY. It names the target (e.g. "AWS RDS
   (ap-south-1), database nanotron"), lists the pending migrations, checks that
   migration 0020's unique index can build, and prints aggregate counts. Save
   the output. It exits 1 if something must be fixed first.
   **`DATABASE_URL`: a `#`, `@` or `/` in the password must be percent-encoded**
   (`#` → `%23`). Unencoded, dotenv cuts the value at `#` and every query fails
   with "Could not verify operator access".
4. `npm run db:migrate` (migrations `0019_firebase_s3_deposit_requests`,
   `0020_deposit_request_cancellation`, `0021_customer_session_epoch`).
   On **Supabase** also run `npm run db:secure` (closes PostgREST on the two new
   tables). On **RDS** skip `db:secure` — it configures Supabase-only features
   (PostgREST RLS, Storage buckets) that RDS does not have.
5. `npm run db:verify` again: 0 pending, and every count identical to step 3.
6. Configure Firebase (§1), then S3 (§2). Each switches on independently.
   Set the Telegram support link in **Admin → Settings → Customer support**.
7. Install the EC2 crontab (§5). Remove the Vercel project's crons if the app no
   longer runs there.

The migrations change no balance, no ledger row, no deposit, no user. They add
`deposit_requests`, `deposit_settings`, three nullable `users` columns and one
defaulted one (`session_epoch`, 0), one nullable `deposits` column, one
defaulted `kyc_documents` column, two nullable `deposit_requests` columns, two
unique indexes, and enum values; and drop `NOT NULL` on `users.email`.

**Verify afterwards** — `npm run db:verify` before and after (steps 3 and 5)
prints users, Σ available, deposits, transactions, investments, KYC,
referrals, operators and more. They must be identical. `npm run db:check` must
report every table present.

---

## 1. Firebase phone OTP

### 1.1 Console (☐ MANUAL)

1. Create a Firebase project (or use the existing Google Cloud project).
   Phone auth sends SMS, which requires the **Blaze (pay-as-you-go)** plan.
   Set a **budget alert** in Google Cloud billing.
2. **Authentication → Sign-in method → Phone** → enable.
3. **Authentication → Settings → Authorized domains** → add the production
   domain (e.g. `app.example.com`). `localhost` is there by default. Without
   the domain, reCAPTCHA fails and no code is sent.
4. **Authentication → Settings → SMS region policy** → *Allow* only **India
   (IN)**. This is the main defence against SMS toll fraud; the app also
   refuses non-+91 numbers server-side.
5. Optional but recommended: **App Check** with reCAPTCHA Enterprise.
6. For development: **Authentication → Sign-in method → Phone → Phone numbers
   for testing** — add a fictional number and fixed code; no SMS is sent.
7. **Project settings → General → Your apps → Add app → Web** — copy the config
   into the `NEXT_PUBLIC_FIREBASE_*` variables.
8. **No service account is needed.** Do not generate a private key for this
   application: the server verifies ID tokens with the public project id and
   signs its own session with `CUSTOMER_SESSION_SECRET`.
9. On the server, generate the session secret once and put it in the
   environment file (never in Git): `openssl rand -base64 48`.

### 1.2 Environment

| Variable | Class | Purpose |
|---|---|---|
| `NEXT_PUBLIC_FIREBASE_API_KEY` | public | web config |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | public | web config |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | public | web config |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | public | web config |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | public, optional | passed through |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | public, optional | passed through |
| `FIREBASE_PROJECT_ID` | server, optional | pins the verifier; defaults to the public id |
| `CUSTOMER_SESSION_SECRET` | **server secret** | signs session cookies; ≥ 32 chars |
| `CUSTOMER_SESSION_DAYS` | server, optional | 1–14, default 14 |
| `LEGACY_EMAIL_SIGN_IN` | server, optional | `true` only during a link-your-number migration window (§1.3) |

`NEXT_PUBLIC_*` values are inlined at **build** time: rebuild after changing them.

### 1.3 What happens to existing customers

Existing accounts' phone numbers were typed on a form and never verified, so
**no account is ever linked by its stored phone number** — a typo would hand
one person's balance to the owner of the mistyped number.

- **Only while `LEGACY_EMAIL_SIGN_IN=true`.** Off by default: customer-facing
  email sign-in is removed. Before turning it off for good, check that nobody
  still needs it: `select count(*) from users where auth_user_id is not null
  and firebase_uid is null and status = 'active'` should be 0.
- A customer who signed up by email signs in once at **/login/email**. The app
  then sends them to **/link-phone**, where they verify their mobile number by
  OTP. That number is attached to *the account their email session already
  owns* — never to any other — and from then on they sign in by phone.
- If that number is already verified on a different account, or their Firebase
  user already owns an account (they signed up fresh by phone first), linking
  is **refused** with "contact support". Accounts are never merged
  automatically. An operator resolves it.
- A new number that matches no account creates a **new, empty** account.
- Once phone sign-in is live, email sign-in no longer creates accounts.
- Operators sign in at `/admin/login` with their work email and an emailed
  one-time code (Supabase Auth; the password form remains as a secondary
  option). **☐ MANUAL: confirm Supabase → Authentication → Emails → SMTP is a
  production sender and the Magic Link template contains `{{ .Token }}`**, or
  codes will not arrive (the built-in sender allows a few emails an hour).

---

## 2. AWS S3 for KYC documents

### 2.1 Bucket (☐ MANUAL)

1. Create a bucket in the application's region (e.g. `ap-south-1`).
2. **Block all public access: ON** (all four settings).
3. **Object Ownership: Bucket owner enforced** (ACLs disabled).
4. **Default encryption:** SSE-S3, or SSE-KMS with a customer key (then set
   `KYC_S3_KMS_KEY_ID`).
5. Optional: versioning on; Object Lock if your compliance regime needs
   immutable evidence.
6. **Bucket policy** — refuse anything not over TLS:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DenyInsecureTransport",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:*",
      "Resource": ["arn:aws:s3:::YOUR-BUCKET", "arn:aws:s3:::YOUR-BUCKET/*"],
      "Condition": { "Bool": { "aws:SecureTransport": "false" } }
    }
  ]
}
```

7. **CORS** — the browser PUTs straight to S3 with a presigned URL:

```json
[
  {
    "AllowedOrigins": ["https://YOUR-DOMAIN"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": [
      "content-type",
      "x-amz-server-side-encryption",
      "x-amz-server-side-encryption-aws-kms-key-id"
    ],
    "MaxAgeSeconds": 3000
  }
]
```

### 2.2 IAM (☐ MANUAL) — prefer the EC2 instance role

Attach to the **EC2 instance profile's role** (no access keys exist to leak;
the AWS SDK reads the role through IMDSv2 — require IMDSv2 on the instance):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "KycObjectsAndProfilePhotos",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject"],
      "Resource": [
        "arn:aws:s3:::YOUR-BUCKET/kyc/*",
        "arn:aws:s3:::YOUR-BUCKET/avatars/*"
      ]
    }
  ]
}
```

`s3:GetObject` covers `HeadObject`. No `ListBucket`, no `DeleteObject`, no
`PutObjectAcl`. With SSE-KMS add `kms:GenerateDataKey` and `kms:Decrypt` on the
key.

### 2.3 Environment

| Variable | Class | Purpose |
|---|---|---|
| `KYC_STORAGE_DRIVER` | server | `s3` to enable; `disabled` to turn uploads off |
| `KYC_S3_BUCKET` | server | bucket name — **no default** |
| `KYC_S3_REGION` | server | or `AWS_REGION` |
| `KYC_S3_PREFIX` | server, optional | default `kyc` |
| `KYC_S3_KMS_KEY_ID` | server, optional | SSE-KMS key |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | **server secret**, avoid | only if no instance role |

### 2.4 How it behaves

- Keys are `kyc/{userId}/{document|selfie}/{uuid}` — no filename, no document
  number.
- The browser asks the server for a 5-minute presigned PUT that signs the exact
  content type and byte length (≤ 10 MB, images/PDF). S3 refuses anything else.
- On submission the server refuses any key outside the caller's own prefix, then
  `HeadObject`s it and stores the size and type S3 recorded.
- Reviewers open a document with a **120-second** presigned GET, issued only
  after `requirePermission("kyc", "view")`, from the row id — the caller never
  names a key.
- Documents uploaded before this change stay in the Supabase bucket
  (`kyc_documents.storage_backend = 'supabase'`) and remain openable while the
  Supabase project exists. Migrating those objects is a separate, deliberate
  job — see FUTURE_TASKS.
- With S3 unset or incomplete, a phone-signed-in customer sees "Identity
  verification is temporarily unavailable…" and cannot submit, because the
  document and selfie are **required** (§23). The server logs one
  `kyc.storage.unavailable` JSON line on stderr naming the missing variables.
  On EC2, check with `journalctl -u <service> | grep kyc.storage`.

---

## 3. Deposits — one address, requests, transaction hashes

### 3.1 The flow

1. Customer opens **Add funds**, enters an amount, and gets a request
   **`DEP-XXXXXXXX`** with an **exact amount to send** (their amount + 0.01–0.99
   USDT, unique among open requests) valid for `DEPOSIT_REQUEST_TTL_MINUTES`
   (default 60).
2. They send exactly that to the configured address (shown with a QR), then
   optionally paste the **transaction hash** and press **Verify Payment**.
3. The server looks the hash up on TronGrid through the scanner's own parser
   (configured USDT contract only, recipient checked, decimals from the chain),
   waits for the block to **solidify**, and records it.
4. The matcher credits the transfer to the one request whose **recipient,
   exact amount and time window** it satisfies. The scanner runs the same
   matcher, so a customer who never submits a hash is still credited.

The **Deposit Request ID is Nanotron's; the transaction hash is the
blockchain's.** The screen asks only for the hash.

**Changing the amount** before paying creates a new request (new ID, new exact
amount) and cancels the old one in the same transaction; a database index
allows only one request per customer to be waiting for payment. **Following an
in-app link away** asks first, and cancels the request if the customer
confirms. Neither can touch a request with a submitted hash or a matched
transfer. A cancelled request's amount stays reserved until its window ends,
and a transfer of it inside that window is still credited to its owner — so a
customer who paid and then left loses nothing. A reload or closing the tab
does not cancel; reopening the screen resumes the request.

**Resubmitting** a hash that was already credited says *"This deposit has
already been processed"* (own request) or *"Transaction already processed"*
(anyone else) and credits nothing: `deposits (chain, tx_hash)` and
`deposit_requests.deposit_id` are unique in the database.

**Screenshot**: an optional field previews an image on the device only. It is
never uploaded or stored, and verification never depends on it.

**Support**: unresolved outcomes show *Contact Support on Telegram*, from the
link an operator saves in Admin → Settings → Customer support (the same one
Settings → Support and the Help centre use). Unset, a fallback to the Help
centre is shown instead of a broken link.

### 3.2 Why a submitted hash cannot steal someone's deposit

The chain is public. Anybody can copy a stranger's transaction hash and submit
it. It does not matter: who submits a hash is not an input to attribution. A
transfer is credited to the request its **amount and time** match; the claim
is only recorded on the claimant's own request. Tests:
`deposit-request.integration.test.ts` ("somebody else submitting your hash
cannot take your transfer").

### 3.3 Unmatched deposits

Anything that is not exactly one match stays **unattributed** with a reason —
different amount (for example, an exchange deducted its fee), outside the
window, ambiguous, or sent to a retired address. It appears under
**CRM → Deposits → Unmatched** with the reason and every customer who claimed
its hash (and what their request expected). An operator with `manage` on
`deposits` assigns it through the existing, audited Assign action, which also
closes the customer's request.

### 3.4 Admin deposit-address configuration

**CRM → Deposit configuration** shows network, asset, the active address, its
source (saved in the CRM, or the `TRON_PLATFORM_DEPOSIT_ADDRESS` default), who
changed it last, and its audit history. Changing it requires `manage` on
`deposits` and a reason; the address is checked for a valid TRON checksum and
must not be the token contract. Existing requests keep the address they were
quoted, and the scanner keeps watching every address that was ever active.

**Deploying this does not change the production deposit address.** Until an
operator saves one, the environment's address is used, exactly as before.

### 3.5 The old per-user address pool

Its tables (`deposit_addresses`, `deposit_address_assignments`) are **kept** —
they are the record of which customer was shown which address, and deposits
may have been attributed through them. Nothing writes them any more. Their
addresses stay on the scanner's watch list, and a late transfer to one lands in
the unmatched queue for an operator (reason: *legacy address*).

---

## 4. PWA

- **Manifest** `/manifest.webmanifest` — standalone, start URL `/`, icons
  generated from the brand mark (`/pwa-icon/*`, `apple-icon`).
- **Service worker** `/sw.js` (production builds only) — caches hashed static
  assets and a static offline page. **It never caches a page, an API response,
  a server action or an RSC payload**, so no balance, deposit, KYC state or CRM
  data can be shown stale, and it never sees the session cookie.
- **Install prompt** — customer app only, from the third session, 20 seconds in:
  - Android / desktop Chrome / Edge: the browser's native prompt behind an
    **Install** button.
  - **iPhone / iPad** (Safari has no install API): instructions — *Tap Share →
    Add to Home Screen → Add*.
  - Other browsers: nothing is shown.
  - "Not now" is honoured for 14 days; after three dismissals it stops asking.
    Never shown when already installed.
- **Sign-in inside the installed app** works because the session is an httpOnly
  cookie, not a token in storage. iOS gives a home-screen app its **own**
  cookie jar, so a customer signs in once inside the installed app even if
  already signed in in Safari. That is iOS behaviour, not a bug.

---

## 5. EC2 scheduling (☐ MANUAL)

`deploy/ec2/nanotron.cron` replaces Vercel Cron: scan every 5 minutes,
settlement hourly, commission release 00:00 IST. It calls the app on
`127.0.0.1` with `CRON_SECRET` from `/etc/nanotron/cron.env` (0600). The
deposit-address release job no longer exists. `deploy/ec2/nginx-nanotron.conf.example`
shows the headers the app relies on (`X-Real-IP`, and no caching of `/sw.js`).

---

## 6. What remains manual or deferred

- Firebase project, Blaze plan, authorised domains (add the production
  domain), SMS region policy, `CUSTOMER_SESSION_SECRET` (§1.1).
- The real Telegram support link, saved in Admin → Settings → Customer support
  (not invented here).
- Supabase SMTP for operator sign-in codes (§1.3).
- S3 bucket, policy, CORS, instance role (§2).
- EC2 crontab and Nginx (§5); DNS is untouched by this change.
- Moving existing Supabase-stored KYC objects to S3 (FUTURE_TASKS).
- A shared rate-limit store if the app runs on more than one instance.

---

## Release: support tickets, configurable USDT rates, platform identity

Migrations `0023`–`0025`. **All three are additive or narrowly scoped data
updates; nothing is dropped or rewritten.** Run on the EC2 host (the RDS
instance is only reachable from inside the VPC), from the new checkout:

1. `npm run db:verify` — read-only. Note the counts and that it names RDS.
2. `npm run db:migrate`
   - `0023_tense_juggernaut` — `ticket_messages` table; `support_tickets`
     gains `category` and `created_at` (defaults, so existing rows stay valid);
     new enum values for ticket audit actions and the `support` pipeline.
   - `0024_initial_usdt_rates_and_withdrawal_fee` — sets, on the single
     `platform_settings` row only, the USDT deposit rate ₹100.40, withdrawal
     rate ₹100.40 and withdrawal fee 1.55 USDT (percentage fee 0). Administrators
     change them afterwards in Admin → Settings.
   - `0025_zomato_play_platform_identity` — replaces the old stored name,
     tagline, rate note and `@nanotron.app` support address in that row, only
     where the exact old value is still there. **The support email is left
     empty**: set the real address in Admin → Settings → Platform (until then the
     app uses `NEXT_PUBLIC_SUPPORT_EMAIL` if set).
3. Skip `npm run db:secure` on RDS (Supabase-only).
4. `npm run db:verify` again: 0 pending, row counts unchanged (the new table
   starts empty).
5. Restart the service. Existing withdrawals keep the rate and fee they were
   quoted at; only new requests use the configured values.

## Release: admin access gate and first master-admin sign-in

No migrations. **Set these before restarting, or operator sign-in is refused:**

| Variable | Class | Value |
|---|---|---|
| `ADMIN_LOGIN_MOBILE` | **server secret** | the admin's mobile, e.g. `98XXXXXXXX` (comma-separate several; every operator who signs in needs to be listed) |
| `ADMIN_LOGIN_ACCESS_CODE` | **server secret** | exactly 10 letters/digits, e.g. from `openssl rand -base64 24 \| tr -dc 'A-Za-z0-9' \| head -c 10` |

Never prefix them with `NEXT_PUBLIC_`, and never put them in the repository.
Set them in the service's environment file on EC2.

Then sign in at `/admin/login`: number → access code → SMS code. The first
successful sign-in binds that number and the verified Firebase uid to the
existing `agt_master` row (audited). Check it with
`npm run db:operator-phone -- --list`, which shows `verified` beside the
master admin.

**KYC is still off until S3 is configured (§2).** On EC2, check that
`KYC_STORAGE_DRIVER=s3`, `KYC_S3_BUCKET` and `KYC_S3_REGION` are in the
service's environment, that the instance role has the §2.2 policy, and that the
bucket CORS allows `PUT` from `https://zomatoplay.com`.

## Release: selectable durations, multi-admin, onboarding, optional KYC uploads, Manual Funds

**Migrations 0026 and 0027 — both additive** (a new `plan_duration_rates` table;
nullable/defaulted columns on `users`, `investments` and `manual_credits`; one
new `audit_action` value). No existing row is rewritten: every existing
allocation gets `schedule_version = 1` and keeps its exact payout split. Apply
them on EC2 (RDS is VPC-only), then run `npm run db:secure` because 0026 adds
a table:

```bash
npm run db:verify        # read-only: target + pending migrations
npm run db:migrate
npm run db:secure
```

Rollback: the new table and columns can be dropped without touching any
pre-existing data, but rolling back the code after customers have chosen a
duration would leave those allocations paid by the old rule — roll forward.

### Administrators — several numbers, each with its own code

| Variable | Class | Value |
|---|---|---|
| `ADMIN_LOGIN_ACCOUNTS` | **server secret** | `mobile:code,mobile:code` — e.g. `98XXXXXXXX:XXXXXXXXXX,97XXXXXXXX:YYYYYYYYYY` |

`ADMIN_LOGIN_MOBILE` + `ADMIN_LOGIN_ACCESS_CODE` still work and merge with it.
A number listed twice with different codes is refused.

**The env gate is only the first check.** After the SMS code, the number must
belong to an operator row:

- the master admin: already bound by its first sign-in (or `npm run
  db:operator-phone`);
- anyone else: the master admin adds them in **Admin → Agents** with that
  mobile number and the permissions they need. Their first SMS sign-in binds
  their real Firebase uid. A number in the env file but not in Agents is told
  exactly that.

**The running process must receive the change.** Editing a shell's
environment changes nothing for the systemd service:

```bash
systemctl cat <service>                 # find EnvironmentFile=
sudoedit <that file>                    # add ADMIN_LOGIN_ACCOUNTS=...
sudo systemctl restart <service>
# confirm the running process has it, without printing the value:
sudo tr '\0' '\n' < /proc/$(systemctl show -p MainPID --value <service>)/environ \
  | grep -c '^ADMIN_LOGIN_ACCOUNTS='    # prints 1
```

### Plan durations

Every plan offers 7/15/30/60/90 days **once an operator sets the return for
each** in Admin → Plans → *Durations*. Nothing is filled in automatically: until
then a plan is sold on its own single term exactly as before. A term left blank
is not offered and is refused server-side.

### Profile photos and KYC

Profile photos use the KYC bucket under `avatars/` — add that prefix to the
instance role (the §2.2 policy above already lists it). KYC document and live
photo uploads are optional now; without S3 the customer can still submit
details for review. Both still need the S3 settings in §2 to upload anything.
