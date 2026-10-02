"use client";

import { setFxRates } from "@/lib/currency";

/**
 * Hands the administrator's rates, resolved on the server, to the browser's
 * copy of `@/lib/currency` before any child formats an INR figure — during
 * render, so server-rendered HTML and hydration agree. The values are
 * platform-wide and identical for every visitor, which is what makes a
 * module-level setting correct here. Renders only its children.
 */
export function FxRatesProvider({
  depositRate,
  withdrawalRate,
  label,
  children,
}: {
  depositRate: number;
  withdrawalRate: number;
  label: string;
  children: React.ReactNode;
}) {
  setFxRates({ depositRate, withdrawalRate, label });
  return <>{children}</>;
}
