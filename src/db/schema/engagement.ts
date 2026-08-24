import {
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
} from "drizzle-orm/pg-core";

import { ts } from "./columns";
import {
  campaignStatusEnum,
  notificationAudienceEnum,
  notificationCategoryEnum,
  notificationChannelEnum,
  notificationTemplateEnum,
} from "./enums";
import { users } from "./users";

/**
 * The catalogue of notification categories: the label and explanation the
 * settings screen renders for each toggle.
 *
 * Split from the per-user toggle below so the copy lives in one row instead of
 * once per user, which is what the mock module effectively had to do.
 */
export const notificationCategories = pgTable("notification_categories", {
  id: notificationCategoryEnum("id").primaryKey(),
  label: text("label").notNull(),
  description: text("description").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  /** Applied to a new account before it has expressed a preference. */
  defaultEnabled: boolean("default_enabled").notNull().default(true),
});

/** A user's opt-in state per category. Absent rows fall back to the default. */
export const userNotificationPreferences = pgTable(
  "user_notification_preferences",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    category: notificationCategoryEnum("category").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.category] }),
    index("user_notification_preferences_user_idx").on(table.userId),
  ],
);

/**
 * Delivered in-app notifications.
 *
 * INTEGRATION POINT: no delivery exists. A notifications service would write
 * these and fan out to email/push per the preferences above.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    category: notificationCategoryEnum("category").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    createdAt: ts("created_at").notNull(),
    read: boolean("read").notNull().default(false),
  },
  (table) => [
    index("notifications_user_idx").on(table.userId),
    index("notifications_created_idx").on(table.createdAt),
    index("notifications_unread_idx").on(table.userId, table.read),
  ],
);

/**
 * Broadcasts composed in the CRM.
 *
 * `channels` is a Postgres array of the channel enum rather than a child table:
 * it is a small set chosen at send time and always read whole with its
 * campaign, and the enum still constrains what can go in it.
 */
export const notificationCampaigns = pgTable(
  "notification_campaigns",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    audience: notificationAudienceEnum("audience").notNull(),
    /** Present only when the audience is a single user. */
    targetUserLabel: text("target_user_label"),
    channels: notificationChannelEnum("channels").array().notNull().default([]),
    templateId: notificationTemplateEnum("template_id").notNull(),
    sentAt: ts("sent_at").notNull(),
    /** Operator who sent it. */
    sentBy: text("sent_by").notNull(),
    recipientCount: integer("recipient_count").notNull().default(0),
    status: campaignStatusEnum("status").notNull().default("sent"),
  },
  (table) => [index("notification_campaigns_sent_idx").on(table.sentAt)],
);
