import { redirect } from "next/navigation";

/** The Help centre lives under Settings; this keeps `/support` a working address. */
export default function SupportRedirect(): never {
  redirect("/settings/support");
}
