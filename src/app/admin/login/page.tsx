import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AdminSignInForm } from "@/components/admin/layout/admin-sign-in-form";
import { isAuthConfigured } from "@/lib/supabase/env";
import { getCurrentOperator } from "@/server/admin/session";

export const metadata: Metadata = {
  title: "Operator sign-in",
  robots: { index: false, follow: false },
};

/** Never prerendered: what it renders depends on the request's session. */
export const dynamic = "force-dynamic";

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;

  let refusal = reason;
  try {
    const operator = await getCurrentOperator();
    if (operator) redirect("/admin");
  } catch (error) {
    // A disabled operator account. Say so here rather than looping.
    if (error instanceof Error && error.name === "AdminAuthorizationError") {
      refusal = error.message;
    } else {
      throw error;
    }
  }

  return <AdminSignInForm configured={isAuthConfigured()} reason={refusal} />;
}
