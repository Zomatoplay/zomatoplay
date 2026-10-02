import type { Metadata } from "next";

import { PageContainer } from "@/components/navigation/app-shell";
import { NewTicketForm } from "@/components/settings/ticket-forms";
import { PageHeader } from "@/components/shared/page-header";

export const metadata: Metadata = { title: "New support ticket" };

export default function NewTicketPage() {
  return (
    <>
      <PageHeader title="New ticket" backHref="/settings/support#tickets" />
      <PageContainer>
        <div className="space-y-5">
          <p className="text-sm leading-relaxed text-muted-foreground">
            Tell us what you need help with and our team will reply on this ticket. You can follow the
            conversation under Help centre → Your support tickets.
          </p>
          <NewTicketForm />
        </div>
      </PageContainer>
    </>
  );
}
