import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { ts, usdt } from "./columns";
import {
  depositNetworkEnum,
  deviceSessionStatusEnum,
  kycStatusEnum,
  kycStepStatusEnum,
  outcomeEnum,
  securityEventTypeEnum,
  ticketAuthorEnum,
  ticketCategoryEnum,
  ticketStatusEnum,
  userStatusEnum,
  vipLevelEnum,
} from "./enums";

/**
 * The account record. One row per platform user, read from both applications:
 * the user app sees its own row, the CRM sees all of them.
 *
 * Primary keys are `text` rather than generated uuids because the seed data
 * carries meaningful, already-referenced ids (`usr_8c41a2`, `plan_starter`,
 * `tx_2041`). Keeping them means existing links such as
 * `/admin/users/usr_8c41a2` stay valid, and a record is recognisable in a log
 * line without a join.
 */
export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),

    /**
     * The Supabase Auth principal this account belongs to.
     *
     * `auth.users.id`. This is the *only* link between a credential and an
     * application account, and it is the one the server resolves an identity
     * through — never a `user_id` sent by the browser.
     *
     * Nullable because the seeded development accounts have no credential: they
     * exist to populate the CRM, and inventing auth users for them would mean
     * thirty sign-in-able accounts nobody owns. A real registration always sets
     * it. Unique, so one credential cannot claim two application accounts.
     *
     * No password, hash, OTP or token is stored here or anywhere else in
     * `public`. Supabase Auth owns credentials entirely — see CLAUDE.md §19.
     */
    authUserId: uuid("auth_user_id"),

    /**
     * The Firebase Authentication uid this account signs in with — the
     * customer credential since phone sign-in replaced email (CLAUDE.md §19).
     *
     * Same contract as `auth_user_id`: the only link from a Firebase principal
     * to an application account, resolved server-side from a verified session
     * cookie, never from anything the browser sends. Unique, so one Firebase
     * user cannot reach two accounts; nullable, because every account that
     * predates phone sign-in has none until its owner links a number.
     *
     * Never assumed equal to `id`. A Firebase uid is Firebase's identifier;
     * making it the account key would hand account identity to a third party
     * and make a Firebase project migration a data migration.
     */
    firebaseUid: text("firebase_uid"),

    /** Public-facing member id — the one support asks for on a call. */
    displayId: text("display_id").notNull(),
    fullName: text("full_name").notNull(),
    /**
     * Nullable since phone sign-in: an account created by mobile OTP has no
     * email, and inventing a placeholder address would be a record that lies.
     * Postgres treats NULLs as distinct, so the unique index still holds for
     * every account that has one.
     */
    email: text("email"),
    /**
     * The number as the customer typed it on the profile form. Display only,
     * and NEVER an identity: it was never verified, so it is never used to
     * link or find an account. `phone_e164` is the verified one.
     */
    phone: text("phone").notNull(),
    /**
     * The mobile number Firebase verified by OTP, normalised to E.164
     * (`+91XXXXXXXXXX`) by `@/lib/phone`. Set only from a verified token's
     * `phone_number` claim. Unique — one verified number, one account.
     */
    phoneE164: text("phone_e164"),
    phoneVerifiedAt: ts("phone_verified_at"),
    /**
     * Customer sessions carry the value this had when they were issued, and
     * the account read that resolves every request compares the two. Sign-out
     * increments it, which ends every phone session for the account on every
     * device — server-side revocation at no extra round trip. Not a credential:
     * a counter is worthless without the signing secret.
     */
    sessionEpoch: integer("session_epoch").notNull().default(0),
    country: text("country").notNull().default("India"),
    avatarUrl: text("avatar_url"),
    /**
     * Private S3 key of the customer's own profile photo
     * (`avatars/{userId}/{uuid}`), set by first-time onboarding. Never a public
     * URL: the photo is shown through a short-lived presigned GET. Null when
     * the customer skipped it — the photo is optional.
     */
    avatarStorageKey: text("avatar_storage_key"),
    /** `male`, `female` or `not_sure`, as the customer chose at onboarding. */
    gender: text("gender"),
    /**
     * When first-time onboarding (name, gender, email) was completed. Null
     * means the app asks for whatever is still missing before anything else.
     */
    profileCompletedAt: ts("profile_completed_at"),
    registeredAt: ts("registered_at").notNull(),
    lastActiveAt: ts("last_active_at").notNull(),
    status: userStatusEnum("status").notNull().default("active"),
    kycStatus: kycStatusEnum("kyc_status").notNull().default("not_started"),
    vipLevel: vipLevelEnum("vip_level").notNull().default("vip1"),
    referralCode: text("referral_code").notNull(),
    /** Referral code of the user who introduced this one, if any. */
    referredByCode: text("referred_by_code"),
    /**
     * Denormalised count of introduced accounts. Maintained by the referral
     * service rather than derived on read: the directory lists it on every row,
     * and a per-row subquery there is the wrong trade.
     */
    referralCount: integer("referral_count").notNull().default(0),
    /** Primary deposit wallet address on file — searchable in the CRM. */
    walletAddress: text("wallet_address").notNull(),
    twoFactorEnabled: boolean("two_factor_enabled").notNull().default(false),
    googleAuthEnabled: boolean("google_auth_enabled").notNull().default(false),
    /** Independently togglable holds, so support can freeze one rail at a time. */
    accountFrozen: boolean("account_frozen").notNull().default(false),
    withdrawalsFrozen: boolean("withdrawals_frozen").notNull().default(false),
    investmentsFrozen: boolean("investments_frozen").notNull().default(false),
    /** Internal-only note. Never shown to the user. */
    internalNote: text("internal_note"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("users_auth_user_id_key").on(table.authUserId),
    check(
      "users_gender_known",
      sql`${table.gender} is null or ${table.gender} in ('male', 'female', 'not_sure')`,
    ),
    uniqueIndex("users_firebase_uid_key").on(table.firebaseUid),
    uniqueIndex("users_phone_e164_key").on(table.phoneE164),
    uniqueIndex("users_email_key").on(table.email),
    uniqueIndex("users_display_id_key").on(table.displayId),
    uniqueIndex("users_referral_code_key").on(table.referralCode),
    index("users_referred_by_code_idx").on(table.referredByCode),
    index("users_status_idx").on(table.status),
    index("users_kyc_status_idx").on(table.kycStatus),
    index("users_wallet_address_idx").on(table.walletAddress),
  ],
);

/**
 * The wallet, one row per user.
 *
 * Held apart from `users` because it is the hot, frequently-rewritten record:
 * a deposit, a reward and an allocation each touch it, while the profile row
 * changes rarely. It also gives the future ledger a single row to lock.
 */
export const walletBalances = pgTable("wallet_balances", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  available: usdt("available").notNull().default(0),
  totalDeposited: usdt("total_deposited").notNull().default(0),
  totalInvested: usdt("total_invested").notNull().default(0),
  totalWithdrawn: usdt("total_withdrawn").notNull().default(0),
  totalProfit: usdt("total_profit").notNull().default(0),
  /** Currently locked inside active investments. */
  lockedInInvestments: usdt("locked_in_investments").notNull().default(0),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** Registered INR payout destinations. Withdrawals settle to one of these. */
export const bankAccounts = pgTable(
  "bank_accounts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    bankName: text("bank_name").notNull(),
    /**
     * Only the masked form is stored. The prototype has no payout rail, and
     * whole account numbers are exactly the field that should not accumulate
     * in a database before one exists.
     */
    accountNumberMasked: text("account_number_masked").notNull(),
    ifsc: text("ifsc").notNull(),
    holderName: text("holder_name").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (table) => [index("bank_accounts_user_idx").on(table.userId)],
);

/** Saved USDT addresses the user has labelled. */
export const walletAddresses = pgTable(
  "wallet_addresses",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    network: depositNetworkEnum("network").notNull(),
    address: text("address").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (table) => [index("wallet_addresses_user_idx").on(table.userId)],
);

/**
 * The user's position in the verification flow, one row per step.
 *
 * Stored rather than derived from `users.kyc_status` because a provider drives
 * the steps independently — a submission can be back at the document step while
 * the account status is still `in_progress`.
 */
export const userKycSteps = pgTable(
  "user_kyc_steps",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    stepId: text("step_id").notNull(),
    position: integer("position").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    status: kycStepStatusEnum("status").notNull().default("upcoming"),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.stepId] }),
    index("user_kyc_steps_user_idx").on(table.userId),
  ],
);

/** Signed-in devices, listed in the CRM and revocable from it. */
export const userDeviceSessions = pgTable(
  "user_device_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    device: text("device").notNull(),
    browser: text("browser").notNull(),
    os: text("os").notNull(),
    ipAddress: text("ip_address").notNull(),
    location: text("location").notNull(),
    loggedInAt: ts("logged_in_at").notNull(),
    lastActiveAt: ts("last_active_at").notNull(),
    status: deviceSessionStatusEnum("status").notNull().default("active"),
    /** The session the user is currently browsing from. */
    isCurrent: boolean("is_current").notNull().default(false),
  },
  (table) => [index("user_device_sessions_user_idx").on(table.userId)],
);

/**
 * Security history. The user application renders a plain-language projection of
 * these rows; the CRM shows the full record.
 */
export const userSecurityEvents = pgTable(
  "user_security_events",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: securityEventTypeEnum("type").notNull(),
    description: text("description").notNull(),
    device: text("device").notNull(),
    ipAddress: text("ip_address").notNull(),
    location: text("location").notNull(),
    createdAt: ts("created_at").notNull(),
    outcome: outcomeEnum("outcome").notNull().default("success"),
  },
  (table) => [
    index("user_security_events_user_idx").on(table.userId),
    index("user_security_events_created_idx").on(table.createdAt),
  ],
);

/**
 * Support conversations. One row per ticket; the conversation itself is
 * `ticket_messages`. `user_id` is always the signed-in customer's own account
 * (taken from the session, never from the request), which is what every
 * customer-side read filters on.
 */
export const supportTickets = pgTable(
  "support_tickets",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    subject: text("subject").notNull(),
    category: ticketCategoryEnum("category").notNull().default("other"),
    status: ticketStatusEnum("status").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull(),
    messageCount: integer("message_count").notNull().default(0),
  },
  (table) => [
    index("support_tickets_user_idx").on(table.userId),
    index("support_tickets_status_updated_idx").on(table.status, table.updatedAt),
  ],
);

/**
 * The messages of a ticket, oldest first. Append-only: nothing edits or deletes
 * a message, so what a customer was told is what the record says. `author` is
 * the side that wrote it; for `support`, `author_name` is the operator's name.
 */
export const ticketMessages = pgTable(
  "ticket_messages",
  {
    id: text("id").primaryKey(),
    ticketId: text("ticket_id")
      .notNull()
      .references(() => supportTickets.id, { onDelete: "cascade" }),
    author: ticketAuthorEnum("author").notNull(),
    authorName: text("author_name"),
    body: text("body").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (table) => [index("ticket_messages_ticket_idx").on(table.ticketId, table.createdAt)],
);

/**
 * A customer's withdrawal password — a second secret, separate from sign-in,
 * required to request a withdrawal.
 *
 * THE ONE CREDENTIAL IN `public`, AND WHY
 * ---------------------------------------
 * Sign-in credentials belong to Firebase and Supabase and nothing in this
 * schema may hold one (§19.1; a test enforces it). A withdrawal password is a
 * different thing — a spending authorisation the product itself defines — and
 * no identity provider holds it, so it lives here. That test allows exactly
 * this column and nothing else.
 *
 * - `password_hash` is scrypt with a per-password random salt
 *   (`@/server/auth/password-hash`); the plaintext is never stored, logged or
 *   returned.
 * - Created only after a fresh SMS code proves control of the account's
 *   verified number. Never changed by the customer afterwards: a forgotten
 *   password is cleared by an operator (`security: manage`, audited), and the
 *   customer then creates a new one through the same OTP step.
 * - `failed_attempts` / `locked_until`: five wrong passwords lock withdrawals
 *   for 30 minutes, so the password cannot be guessed through the form.
 */
export const withdrawalPasswords = pgTable("withdrawal_passwords", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  passwordHash: text("password_hash").notNull(),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  lockedUntil: ts("locked_until"),
  createdAt: ts("created_at").notNull(),
  updatedAt: ts("updated_at").notNull(),
});
