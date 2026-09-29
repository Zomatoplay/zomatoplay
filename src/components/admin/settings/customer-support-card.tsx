"use client";

import { useState } from "react";
import { ExternalLink, Save, Send } from "lucide-react";

import { DetailCard } from "@/components/admin/shared/detail-list";
import { useAdminAction } from "@/components/admin/shared/use-admin-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { canManage } from "@/lib/admin-permissions";
import { useAdminStore } from "@/lib/admin-store";
import { parseTelegramUsername } from "@/lib/support";

import { updateSupportTelegramAction } from "@/app/admin/actions";

/**
 * Customer support → Telegram.
 *
 * Its own card with its own save, rather than a field in the general settings
 * draft: the value is validated server-side as a Telegram username and stored
 * under a key the general form never writes (`updateSupportTelegramAction`).
 * The check here only shapes the message; the server decides.
 */
export function CustomerSupportCard({ currentUrl }: { currentUrl: string | null }) {
  const store = useAdminStore();
  const { run, pending } = useAdminAction();
  const allowed = canManage(store.session, "settings");
  const current = currentUrl ? parseTelegramUsername(currentUrl) : null;
  const [value, setValue] = useState(current ? `https://t.me/${current}` : "");

  const trimmed = value.trim();
  const parsed = trimmed ? parseTelegramUsername(trimmed) : null;
  const invalid = trimmed !== "" && !parsed;
  const unchanged = (parsed ?? null) === current && (trimmed === "") === !current;

  return (
    <DetailCard
      title="Customer support"
      description="Where the Contact Support button in the customer app opens."
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!allowed || invalid || unchanged) return;
          run(() => updateSupportTelegramAction({ telegram: trimmed }));
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="support-telegram">Customer Support Telegram URL</Label>
          <Input
            id="support-telegram"
            inputMode="url"
            autoComplete="off"
            placeholder="https://t.me/your_support_account"
            value={value}
            disabled={!allowed || pending}
            aria-invalid={invalid || undefined}
            aria-describedby="support-telegram-hint"
            onChange={(event) => setValue(event.target.value)}
          />
          <p
            id="support-telegram-hint"
            className={invalid ? "text-xs leading-relaxed text-destructive" : "text-xs leading-relaxed text-muted-foreground"}
          >
            {invalid
              ? "Only a Telegram username or its https://t.me/ link is accepted."
              : "A t.me link or @username. Leave empty to show customers that Telegram support is unavailable."}
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {current ? (
              <a
                href={`https://t.me/${current}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
              >
                <Send className="size-3.5" aria-hidden />
                Live: @{current}
                <ExternalLink className="size-3" aria-hidden />
                <span className="sr-only"> (opens Telegram)</span>
              </a>
            ) : (
              "Not configured — customers see “unavailable”."
            )}
          </p>
          <Button
            type="submit"
            variant="brand"
            size="sm"
            disabled={!allowed || pending || invalid || unchanged}
          >
            <Save className="size-4" aria-hidden />
            {trimmed === "" && current ? "Clear" : "Save"}
          </Button>
        </div>
      </form>
    </DetailCard>
  );
}
