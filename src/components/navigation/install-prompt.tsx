"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Share, SquarePlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  EMPTY_INSTALL_STATE,
  isAppleMobileDevice,
  parseInstallState,
  recordDismissal,
  shouldOfferInstall,
  type InstallState,
} from "@/lib/pwa-install";
import { APP_NAME } from "@/constants/app";

/**
 * "Install Zomato Play" — a compact, optional strip shown after real use, only
 * where installing is real.
 *
 * Chromium (Android, desktop Chrome/Edge): the browser's own install prompt,
 * captured from `beforeinstallprompt` and triggered by the Install button.
 * iPhone/iPad: Safari has no install API, so the card shows the three taps
 * for Add to Home Screen in one line. Any other browser: nothing — a button
 * that cannot install would be a lie.
 *
 * The policy (when, how often) is `@/lib/pwa-install`. What is remembered is a
 * visit count and dismissal time in `localStorage` — per-device convenience
 * state, never anything about the account — and every access is guarded,
 * because private windows and locked-down browsers throw on storage.
 */

const STORAGE_KEY = "zomatoplay-install";
const SESSION_KEY = "zomatoplay-install-session";
/** A short beat, so the strip does not appear mid-tap as the page settles. */
const SHOW_DELAY_MS = 4_000;

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function readState(): InstallState {
  try {
    return parseInstallState(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return EMPTY_INSTALL_STATE;
  }
}

function writeState(state: InstallState) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage unavailable: the card simply follows its default policy.
  }
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS Safari's own flag for a home-screen launch.
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function InstallPrompt() {
  const [mode, setMode] = useState<"chromium" | "ios" | null>(null);
  const deferred = useRef<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (isStandalone()) {
      writeState({ ...readState(), installed: true });
      return;
    }

    // One session = one tab lifetime, counted once.
    let state = readState();
    try {
      if (!window.sessionStorage.getItem(SESSION_KEY)) {
        window.sessionStorage.setItem(SESSION_KEY, "1");
        state = { ...state, sessions: state.sessions + 1 };
        writeState(state);
      }
    } catch {
      // Without session storage every page load would count; skip counting.
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    const offer = (next: "chromium" | "ios") => {
      if (!shouldOfferInstall(readState(), Date.now())) return;
      timer = setTimeout(() => setMode(next), SHOW_DELAY_MS);
    };

    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      deferred.current = event as BeforeInstallPromptEvent;
      offer("chromium");
    };
    const onInstalled = () => {
      writeState({ ...readState(), installed: true });
      deferred.current = null;
      setMode(null);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);

    if (isAppleMobileDevice({ userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints })) {
      offer("ios");
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
      if (timer) clearTimeout(timer);
    };
  }, []);

  function dismiss() {
    writeState(recordDismissal(readState(), Date.now()));
    setMode(null);
  }

  async function install() {
    const event = deferred.current;
    if (!event) return;
    deferred.current = null;
    await event.prompt();
    const choice = await event.userChoice.catch(() => ({ outcome: "dismissed" as const }));
    if (choice.outcome === "accepted") writeState({ ...readState(), installed: true });
    else writeState(recordDismissal(readState(), Date.now()));
    setMode(null);
  }

  if (!mode) return null;

  /*
   * A slim strip at the top of the page content — in the flow, not floating
   * over it, so it never covers a control and scrolls away with the page.
   * Optional by construction: "Later" defers the offer (`recordDismissal`,
   * 14-day cool-down, never after three), and nothing here blocks the app.
   */
  return (
    <aside
      aria-label={`Install ${APP_NAME}`}
      className="border-b border-border bg-secondary/60"
    >
      <div className="mx-auto flex min-h-11 w-full max-w-2xl items-center gap-2 px-4 py-1.5 lg:max-w-none">
        <Download className="size-4 shrink-0 text-brand" aria-hidden />
        {mode === "chromium" ? (
          <p className="min-w-0 flex-1 text-xs leading-snug text-foreground">
            Install {APP_NAME} for quicker access.
          </p>
        ) : (
          <p className="min-w-0 flex-1 text-xs leading-snug text-foreground">
            Add {APP_NAME} to your home screen: tap{" "}
            <Share className="inline size-3.5 align-text-bottom" aria-label="Share" />, then{" "}
            <span className="font-medium">Add to Home Screen</span>{" "}
            <SquarePlus className="inline size-3.5 align-text-bottom" aria-hidden />.
          </p>
        )}
        {mode === "chromium" ? (
          <Button size="sm" variant="brand" onClick={() => void install()}>
            Install
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" onClick={dismiss}>
          Later
        </Button>
      </div>
    </aside>
  );
}
