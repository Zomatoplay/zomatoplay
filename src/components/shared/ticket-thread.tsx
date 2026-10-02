import { cn } from "@/lib/utils";
import type { TicketMessage } from "@/types";
import { formatDateTime } from "@/utils/format";

/**
 * A ticket's conversation, oldest first. Used by the customer's ticket page
 * (`viewer="customer"`) and the console (`viewer="support"`); the viewer's own
 * messages sit on the right. Text is rendered as text — whitespace preserved,
 * never as HTML.
 */
export function TicketThread({
  messages,
  viewer,
}: {
  messages: TicketMessage[];
  viewer: "customer" | "support";
}) {
  if (messages.length === 0) {
    return (
      <p className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
        No messages are recorded on this ticket.
      </p>
    );
  }
  return (
    <ol className="space-y-3" aria-label="Conversation">
      {messages.map((message) => {
        const own = message.author === viewer;
        const who =
          message.author === "customer"
            ? viewer === "customer"
              ? "You"
              : "Customer"
            : message.authorName || "Zomato Play Support";
        return (
          <li key={message.id} className={cn("flex", own ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[88%] min-w-0 rounded-2xl border px-4 py-3",
                own ? "border-brand/25 bg-brand-soft" : "border-border bg-card",
              )}
            >
              <p className="text-xs font-semibold text-foreground">{who}</p>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
                {message.body}
              </p>
              <p className="tabular mt-1.5 text-[11px] text-muted-foreground">
                {formatDateTime(message.createdAt)}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
