import "server-only";

import { and, asc, desc, eq, sql } from "drizzle-orm";

import { schema, type Database } from "@/db";
import type { AppNotification, NotificationPreference } from "@/types";
import type { AdminNotificationCampaign } from "@/types/admin";

import { toAdminNotificationCampaign, toAppNotification } from "./mappers";

/** In-app notifications, preferences and CRM broadcasts. */

export async function listNotificationsForUser(
  db: Database,
  userId: string,
  options: { limit?: number } = {},
): Promise<AppNotification[]> {
  const query = db
    .select()
    .from(schema.notifications)
    .where(eq(schema.notifications.userId, userId))
    .orderBy(desc(schema.notifications.createdAt));
  const rows = options.limit ? await query.limit(options.limit) : await query;
  return rows.map(toAppNotification);
}

/**
 * How many notifications this account has not read.
 *
 * WHY A COUNT AND NOT A LIST
 * --------------------------
 * `TopBar` renders a small badge with this number, and it renders on Home,
 * Wallet, Referral, Plans and Settings — every primary section. To produce it
 * the page fetched **every notification the account had ever received**,
 * shipped all of them into the RSC payload, and called
 * `.filter(n => !n.read).length` in the browser. The list itself was rendered
 * by exactly one screen, `/settings/notifications`.
 *
 * So this is a `count(*)` that had been written as a full table read. It is
 * served by the existing `notifications_unread_idx` on `(user_id, read)` —
 * the index was already there; nothing was using it for this.
 */
export async function countUnreadNotifications(
  db: Database,
  userId: string,
): Promise<number> {
  const [row] = await db
    .select({ unread: sql<number>`count(*)::int` })
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.userId, userId),
        eq(schema.notifications.read, false),
      ),
    );
  return row?.unread ?? 0;
}

/**
 * The notification settings screen: every category, with this user's choice.
 *
 * A left join, so a category the user has never touched still appears — with
 * its catalogue default rather than silently missing from the screen.
 */
export async function listNotificationPreferences(
  db: Database,
  userId: string,
): Promise<NotificationPreference[]> {
  const categories = await db
    .select()
    .from(schema.notificationCategories)
    .orderBy(asc(schema.notificationCategories.sortOrder));

  const chosen = await db
    .select()
    .from(schema.userNotificationPreferences)
    .where(eq(schema.userNotificationPreferences.userId, userId));

  const byCategory = new Map(chosen.map((row) => [row.category, row.enabled]));

  return categories.map((category) => ({
    id: category.id,
    label: category.label,
    description: category.description,
    enabled: byCategory.get(category.id) ?? category.defaultEnabled,
  }));
}

export async function listNotificationCampaigns(
  db: Database,
): Promise<AdminNotificationCampaign[]> {
  const rows = await db
    .select()
    .from(schema.notificationCampaigns)
    .orderBy(desc(schema.notificationCampaigns.sentAt));
  return rows.map(toAdminNotificationCampaign);
}
