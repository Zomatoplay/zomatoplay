import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { Toaster } from "@/components/ui/sonner";
import { NavigationTracer } from "@/components/shared/navigation-tracer";
import { ServiceWorkerRegistration } from "@/components/shared/service-worker-registration";
import { APP_DESCRIPTION, APP_NAME, APP_TAGLINE } from "@/constants/app";

import "./globals.css";

/**
 * Root document shell only.
 *
 * The user application and the Master CRM are two separate frames living under
 * one Next.js app, so neither one's chrome can live here:
 *   - `(app)/layout.tsx`  — user app: prototype store + mobile/desktop AppShell
 *   - `admin/layout.tsx`  — Master CRM: admin store + AdminShell
 *
 * Only what is genuinely global belongs in this file: the document, fonts, the
 * skip link and the toaster.
 */

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

/**
 * The public origin, when the deployment names one (`NEXT_PUBLIC_SITE_URL`).
 * It anchors every relative metadata URL; left undefined rather than guessed,
 * so a preview deployment never advertises itself as the production site.
 */
const SITE_ORIGIN: URL | undefined = (() => {
  const value = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!value) return undefined;
  try {
    return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return undefined;
  }
})();

export const metadata: Metadata = {
  metadataBase: SITE_ORIGIN,
  openGraph: {
    type: "website",
    siteName: APP_NAME,
    title: `${APP_NAME} · ${APP_TAGLINE}`,
    description: APP_DESCRIPTION,
  },
  title: {
    default: `${APP_NAME} · ${APP_TAGLINE}`,
    template: `%s · ${APP_NAME}`,
  },
  description: APP_DESCRIPTION,
  applicationName: APP_NAME,
  appleWebApp: {
    capable: true,
    title: APP_NAME,
    statusBarStyle: "default",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Zoom is left enabled — disabling it is an accessibility regression.
  maximumScale: 5,
  // Lets the app paint into the notch / gesture-bar areas; the safe-area
  // utilities in globals.css keep content clear of them.
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fcfcfd" },
    { media: "(prefers-color-scheme: dark)", color: "#101113" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:text-primary-foreground"
        >
          Skip to content
        </a>
        {children}
        {/* Times the browser half of every navigation. Renders nothing. */}
        <NavigationTracer />
        {/* Static assets + an offline page only; never a page or data. */}
        <ServiceWorkerRegistration />
        <Toaster />
      </body>
    </html>
  );
}
