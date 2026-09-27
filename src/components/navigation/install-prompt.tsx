"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Share, SquarePlus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  EMPTY_INSTALL_STATE,
  isAppleMobileDevice,
  parseInstallState,
  recordDismissal,
  shouldOfferInstall,
  type InstallState,
} from "@/lib/pwa-install";

/**
 * "Install Nanotron" — shown after real use, only where installing is real.
 *
 * Chromium (Android, desktop Chrome/Edge): the browser's own install prompt,
 * captured from `beforeinstallprompt` and triggered by the Install button.
 * iPhone/iPad: Safari has no install API, so the card shows the three taps
 * for Add to Home Screen instead. Any other browser: nothing — a button that
 * cannot install would be a lie.
 *
 * The policy (when, how often) is `@/lib/pwa-install`. What is remembered is a
 * visit count and dismissal time in `localStorage` — per-device convenience
 * state, never anything about the account — and every access is guarded,
 * because private windows and locked-down browsers throw on storage.
 */

const STORAGE_KEY = "nanotron-install";
const SESSION_KEY = "nanotron-install-session";
/** Not the moment the screen opens: let the person start doing what they came for. */
const SHOW_DELAY_MS = 20_000;

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

  return (
    <section
      role="dialog"
      aria-modal="false"
      aria-labelledby="install-title"
      className="fixed inset-x-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom)+0.75rem)] z-30 mx-auto max-w-md rounded-2xl border border-border bg-card p-4 shadow-lg lg:inset-x-auto lg:bottom-6 lg:right-6 lg:w-96"
    >
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand text-sm font-bold text-brand-foreground" aria-hidden>
          N
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="install-title" className="text-sm font-semibold">
            Install Nanotron
          </h2>
          {mode === "chromium" ? (
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              Install Nanotron on your device for faster access.
            </p>
          ) : (
            <ol className="mt-1 space-y-1 text-xs leading-relaxed text-muted-foreground">
              <li className="flex items-center gap-1.5">
                1. Tap <Share className="size-3.5 text-foreground" aria-label="Share" /> Share
              </li>
              <li className="flex items-center gap-1.5">
                2. Tap <SquarePlus className="size-3.5 text-foreground" aria-hidden /> Add to Home
                Screen
              </li>
              <li>3. Tap Add</li>
            </ol>
          )}
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="-m-2 flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary focus-visible:outline-2 focus-visible:outline-ring"
          aria-label="Dismiss"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
      {mode === "chromium" ? (
        <div className="mt-3 flex gap-2">
          <Button variant="brand" className="flex-1" onClick={() => void install()}>
            <Download className="size-4" aria-hidden />
            Install
          </Button>
          <Button variant="outline" className="flex-1" onClick={dismiss}>
            Not now
          </Button>
        </div>
      ) : (
        <Button variant="outline" block className="mt-3" onClick={dismiss}>
          Not now
        </Button>
      )}
    </section>
  );
}
