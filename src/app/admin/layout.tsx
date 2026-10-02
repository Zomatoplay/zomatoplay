import type { Metadata } from "next";

import { APP_NAME } from "@/constants/app";

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
    default: `${APP_NAME} Admin`,
    template: `%s · ${APP_NAME} Admin`,
  },
  description: `Administrative control panel for the ${APP_NAME} platform.`,
  // An operations console has no business being indexed.
  robots: { index: false, follow: false },
};

export default function AdminRootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
