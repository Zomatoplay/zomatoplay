"use client";

import { useEffect, useMemo, useState } from "react";
import { BellRing, Send, Users } from "lucide-react";

import { AdminHeader } from "@/components/admin/layout/admin-header";
import { AdminPage, AdminSection } from "@/components/admin/layout/admin-shell";
import {
  DataCard,
  DataCardRow,
  DataTable,
  PrimaryCell,
  type DataTableColumn,
} from "@/components/admin/shared/data-table";
import { DetailCard } from "@/components/admin/shared/detail-list";
import { FilterBar, SearchField } from "@/components/admin/shared/filter-bar";
import { PermissionGate } from "@/components/admin/shared/permission-gate";
import { EmptyState } from "@/components/shared/empty-state";
import { PrototypeNote } from "@/components/shared/notices";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ADMIN_PAGE_SIZE } from "@/constants/admin";
import {
  audienceLabel,
  audienceReach,
  notificationAudiences,
  notificationChannelLabels,
  notificationTemplates,
} from "@/data/admin/notifications";
import { canManage } from "@/lib/admin-permissions";
import { useAdminStore } from "@/lib/admin-store";
import { useAdminAction } from "@/components/admin/shared/use-admin-action";
import {
  searchUsersAction,
  sendNotificationAction,
} from "@/app/admin/actions";
import { cn } from "@/lib/utils";
import type {
  AdminUserOption,
  AdminNotificationAudience,
  AdminNotificationCampaign,
  AdminNotificationChannel,
  AdminNotificationTemplateId,
} from "@/types/admin";
import { formatDateTime } from "@/utils/format";

/**
 * Notification composer and send history.
 *
 * Nothing is delivered — "sending" records a campaign and an audit entry. The
 * composer still shows the resolved audience size before the send button,
 * because the number of people a message reaches is the single most important
 * thing to get right before pressing it.
 */

export function NotificationsView() {
  return (
    <>
      <AdminHeader
        title="Notifications"
        description="Send messages to a user, a segment or the whole platform."
      />
      <AdminPage>
        <PermissionGate permission="notifications">
          <NotificationsWorkspace />
        </PermissionGate>
      </AdminPage>
    </>
  );
}

const ALL_CHANNELS: AdminNotificationChannel[] = ["in_app", "email", "push"];

function NotificationsWorkspace() {
  const store = useAdminStore();
  const { run } = useAdminAction();
  const allowed = canManage(store.session, "notifications");

  const [templateId, setTemplateId] =
    useState<AdminNotificationTemplateId>("announcement");
  const [title, setTitle] = useState(notificationTemplates[0].title);
  const [body, setBody] = useState(notificationTemplates[0].body);
  const [audience, setAudience] =
    useState<AdminNotificationAudience>("all_users");
  const [targetUser, setTargetUser] = useState("");
  const [channels, setChannels] = useState<AdminNotificationChannel[]>([
    "in_app",
  ]);
  const [query, setQuery] = useState("");

  function applyTemplate(id: AdminNotificationTemplateId) {
    const template = notificationTemplates.find((entry) => entry.id === id);
    if (!template) return;
    setTemplateId(id);
    setTitle(template.title);
    setBody(template.body);
    setAudience(template.defaultAudience);
  }

  const reach =
    audience === "single_user" ? 1 : audienceReach(audience);

  /*
   * The single-user audience resolves against the server, not against a copy
   * of the directory.
   *
   * This screen used to be handed every account on the platform purely so this
   * one `find()` could run in the browser. It now asks `searchUsersAction`,
   * which is gated on `users: view` and returns at most eight narrow rows, and
   * takes the first match — the same "first thing that matches what you typed"
   * rule as before. Debounced, and a response that arrives after the query has
   * moved on is discarded: two keystrokes in flight can land out of order, and
   * showing the older answer is how a picker names an account the operator has
   * already typed past.
   */
  const [matchedUser, setMatchedUser] = useState<AdminUserOption | null>(null);

  useEffect(() => {
    const needle = targetUser.trim();
    if (needle.length < 2) {
      setMatchedUser(null);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      searchUsersAction(needle)
        .then((rows) => {
          if (!cancelled) setMatchedUser(rows[0] ?? null);
        })
        .catch(() => {
          if (!cancelled) setMatchedUser(null);
        });
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [targetUser]);

  const valid =
    title.trim() !== "" &&
    body.trim() !== "" &&
    channels.length > 0 &&
    (audience !== "single_user" || matchedUser !== null);

  const filteredCampaigns = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return store.campaigns;
    return store.campaigns.filter((campaign) =>
      [campaign.title, campaign.body, campaign.sentBy, campaign.id]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [store.campaigns, query]);

  const columns: DataTableColumn<AdminNotificationCampaign>[] = [
    {
      id: "title",
      header: "Message",
      cell: (campaign) => (
        <PrimaryCell title={campaign.title} subtitle={campaign.id} />
      ),
    },
    {
      id: "audience",
      header: "Audience",
      cell: (campaign) => (
        <span className="flex flex-col text-sm">
          <span>{audienceLabel(campaign.audience)}</span>
          {campaign.targetUserLabel ? (
            <span className="tabular text-xs text-muted-foreground">
              {campaign.targetUserLabel}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      id: "recipients",
      header: "Recipients",
      numeric: true,
      cell: (campaign) => campaign.recipientCount.toLocaleString("en-IN"),
    },
    {
      id: "channels",
      header: "Channels",
      hideBelow: "lg",
      cell: (campaign) => (
        <span className="flex flex-wrap gap-1">
          {campaign.channels.map((channel) => (
            <Badge key={channel} variant="outline">
              {notificationChannelLabels[channel]}
            </Badge>
          ))}
        </span>
      ),
    },
    {
      id: "sentBy",
      header: "Sent by",
      hideBelow: "xl",
      cell: (campaign) => (
        <span className="text-sm text-muted-foreground">{campaign.sentBy}</span>
      ),
    },
    {
      id: "sentAt",
      header: "Sent",
      numeric: true,
      hideBelow: "lg",
      cell: (campaign) => (
        <span className="text-xs text-muted-foreground">
          {formatDateTime(campaign.sentAt)}
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (campaign) => (
        <Badge
          variant={
            campaign.status === "sent"
              ? "positive"
              : campaign.status === "failed"
                ? "negative"
                : "info"
          }
        >
          {campaign.status === "sent"
            ? "Sent"
            : campaign.status === "failed"
              ? "Failed"
              : "Scheduled"}
        </Badge>
      ),
    },
  ];

  return (
    <AdminSection className="space-y-4">
      <PrototypeNote>
        No messaging service is connected. Sending records the message and an
        audit entry; nothing is delivered to anyone.
      </PrototypeNote>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <DetailCard title="Compose" description="Write the message users receive.">
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-sm font-medium">Template</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {notificationTemplates.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    onClick={() => applyTemplate(template.id)}
                    className={cn(
                      "rounded-xl border p-3 text-left transition-colors",
                      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                      templateId === template.id
                        ? "border-brand bg-brand-soft"
                        : "border-border hover:bg-secondary",
                    )}
                  >
                    <span
                      className={cn(
                        "block text-sm font-medium",
                        templateId === template.id
                          ? "text-brand"
                          : "text-foreground",
                      )}
                    >
                      {template.label}
                    </span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                      {template.description}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="notification-title">Title</Label>
              <Input
                id="notification-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="What the notification says at a glance"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="notification-body">Message</Label>
              <Textarea
                id="notification-body"
                value={body}
                onChange={(event) => setBody(event.target.value)}
                placeholder="The full message…"
                className="min-h-28 text-sm"
              />
              <p className="text-xs leading-relaxed text-muted-foreground">
                Never state or imply that returns are guaranteed. Describe
                projections as estimates.
              </p>
            </div>
          </div>
        </DetailCard>

        <div className="space-y-3">
          <DetailCard title="Audience">
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="notification-audience">Send to</Label>
                <select
                  id="notification-audience"
                  value={audience}
                  onChange={(event) =>
                    setAudience(event.target.value as AdminNotificationAudience)
                  }
                  className="h-12 w-full rounded-xl border border-input bg-card px-3 text-base text-foreground focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring/40"
                >
                  {notificationAudiences.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.label}
                    </option>
                  ))}
                </select>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {
                    notificationAudiences.find((entry) => entry.id === audience)
                      ?.description
                  }
                </p>
              </div>

              {audience === "single_user" ? (
                <div className="space-y-2">
                  <Label htmlFor="notification-user">Find the user</Label>
                  <Input
                    id="notification-user"
                    value={targetUser}
                    onChange={(event) => setTargetUser(event.target.value)}
                    placeholder="Name, email or member ID"
                  />
                  {targetUser.trim() ? (
                    matchedUser ? (
                      <p className="rounded-lg border border-brand/30 bg-brand-soft px-2.5 py-2 text-xs text-brand">
                        {matchedUser.fullName} · {matchedUser.displayId}
                      </p>
                    ) : (
                      <p className="text-xs text-destructive">
                        No user matches that search.
                      </p>
                    )
                  ) : null}
                </div>
              ) : null}

              <div className="flex items-center gap-2 rounded-xl border border-border bg-secondary/40 p-3">
                <Users className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <p className="text-sm">
                  <span className="tabular font-semibold">
                    {reach.toLocaleString("en-IN")}
                  </span>{" "}
                  <span className="text-muted-foreground">
                    {reach === 1 ? "recipient" : "recipients"}
                  </span>
                </p>
              </div>
            </div>
          </DetailCard>

          <DetailCard title="Channels">
            <ul className="space-y-1">
              {ALL_CHANNELS.map((channel) => {
                const checked = channels.includes(channel);
                return (
                  <li
                    key={channel}
                    className="flex items-center justify-between gap-3 py-2"
                  >
                    <Label htmlFor={`channel-${channel}`} className="font-normal">
                      {notificationChannelLabels[channel]}
                    </Label>
                    <Switch
                      id={`channel-${channel}`}
                      checked={checked}
                      onCheckedChange={(next) =>
                        setChannels((current) =>
                          next
                            ? [...current, channel]
                            : current.filter((entry) => entry !== channel),
                        )
                      }
                    />
                  </li>
                );
              })}
            </ul>
            {channels.length === 0 ? (
              <p className="mt-2 text-xs text-destructive">
                Select at least one delivery channel.
              </p>
            ) : null}
          </DetailCard>

          <Button
            variant="brand"
            block
            size="lg"
            disabled={!allowed || !valid}
            onClick={() => {
              run(
                () =>
                  sendNotificationAction({
                    title: title.trim(),
                    body: body.trim(),
                    audience,
                    targetUserLabel: matchedUser
                      ? `${matchedUser.fullName} · ${matchedUser.displayId}`
                      : null,
                    channels,
                    templateId,
                  }),
                {
                  onSuccess: () => {
                    setTitle("");
                    setBody("");
                  },
                },
              );
            }}
          >
            <Send className="size-4" />
            Send notification
          </Button>
          {!allowed ? (
            <p className="text-center text-xs text-muted-foreground">
              Your role has view-only access to notifications.
            </p>
          ) : null}
        </div>
      </div>

      <AdminSection title="Send history" headingLevel="h2" className="pt-2">
        <FilterBar>
          <SearchField
            value={query}
            onChange={setQuery}
            label="Search sent notifications"
            placeholder="Title, message text, sender or ID"
          />
        </FilterBar>

        <DataTable
          rows={filteredCampaigns}
          columns={columns}
          getRowKey={(campaign) => campaign.id}
          caption="Notifications sent from the CRM"
          pageSize={ADMIN_PAGE_SIZE}
          resetKey={query}
          empty={
            <EmptyState
              icon={BellRing}
              title="Nothing sent yet"
              description="Notifications sent from this screen appear here."
            />
          }
          renderCard={(campaign) => (
            <DataCard>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{campaign.title}</p>
                  <p className="tabular text-xs text-muted-foreground">
                    {campaign.id}
                  </p>
                </div>
                <Badge
                  variant={campaign.status === "sent" ? "positive" : "negative"}
                >
                  {campaign.status === "sent" ? "Sent" : "Failed"}
                </Badge>
              </div>
              <DataCardRow label="Audience">
                {audienceLabel(campaign.audience)}
              </DataCardRow>
              <DataCardRow label="Recipients">
                <span className="tabular">
                  {campaign.recipientCount.toLocaleString("en-IN")}
                </span>
              </DataCardRow>
              <DataCardRow label="Sent">
                <span className="tabular font-normal text-muted-foreground">
                  {formatDateTime(campaign.sentAt)}
                </span>
              </DataCardRow>
            </DataCard>
          )}
        />
      </AdminSection>
    </AdminSection>
  );
}
