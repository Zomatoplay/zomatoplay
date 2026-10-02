import { redirect } from "next/navigation";

/** Tickets are listed in the Help centre; this keeps `/tickets` a working address. */
export default function TicketsRedirect(): never {
  redirect("/settings/support#tickets");
}
