import type { Metadata } from "next";

import { ADMIN_APP_SUBTITLE } from "@/constants/admin";

/**
 * The `/admin` root.
 *
 * Deliberately carries no shell, no store and no gate. Two things live below
 * it and they need opposite treatment:
 *
 *   `(console)/`  the operations console — requires an operator session, and
 *                 renders the sidebar, header and store.
 *   `login/`      how you get one — must be reachable *without* a session, and
 *                 renders its own full-screen frame.
 *
 * A Next.js layout cannot be removed by a descendant, so a gate here would gate
 * the sign-in page too and loop. The route group is what lets one URL space
 * have two frames; it adds no path segment, so every `/admin/*` URL is
 * unchanged.
 */
export const metadata: Metadata = {
  title: {
    default: ADMIN_APP_SUBTITLE,
    template: `%s · ${ADMIN_APP_SUBTITLE}`,
  },
  description: "Administrative control panel for the Nanotron platform.",
  // An operations console has no business being indexed.
  robots: { index: false, follow: false },
};

export default function AdminRootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
