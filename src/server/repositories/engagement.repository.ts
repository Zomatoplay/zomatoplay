import "server-only";

import { asc, desc, eq } from "drizzle-orm";

import { schema, type Database } from "@/db";
import type { AppNotification, NotificationPreference } from "@/types";
import type { AdminNotificationCampaign } from "@/types/admin";

import { toAdminNotificationCampaign, toAppNotification } from "./mappers";

/** In-app notifications, preferences and CRM broadcasts. */

export async function listNotificationsForUser(
  db: Database,
  userId: string,
): Promise<AppNotification[]> {
  const rows = await db
    .select()
    .from(schema.notifications)
    .where(eq(schema.notifications.userId, userId))
    .orderBy(desc(schema.notifications.createdAt));
  return rows.map(toAppNotification);
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
