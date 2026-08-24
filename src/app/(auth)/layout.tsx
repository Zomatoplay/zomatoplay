import type { Metadata } from "next";

/**
 * The unauthenticated frame.
 *
 * Its own route group, with no `AppShell` and no store: a visitor with no
 * session has no wallet, no allocations and no verification status, so there
 * is no bottom navigation to render and nothing to seed a store with.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <div className="pt-safe" />
      <main
        id="main-content"
        className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-8"
      >
        {children}
      </main>
      <div className="pb-safe" />
    </div>
  );
}
