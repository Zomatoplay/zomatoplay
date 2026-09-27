/**
 * When — and how — to offer "Install Nanotron".
 *
 * Pure functions, so the policy is tested rather than eyeballed
 * (`pwa-install.test.ts`); the component only reads the browser and renders.
 *
 * THE POLICY
 * ----------
 * - Never when already installed (running standalone), or after `appinstalled`.
 * - Never on a first visit: somebody who has not used the app yet has no reason
 *   to install it. Offered from the third separate session onward.
 * - "Not now" is respected for 14 days, then asked once more; three dismissals
 *   and it is never offered again. No loop, no nagging on every sign-in.
 * - Only where installing is real: Chromium's `beforeinstallprompt` (Android,
 *   desktop Chrome/Edge), or iOS/iPadOS with Add to Home Screen instructions.
 *   Anywhere else nothing is shown — no button that does nothing.
 */

export const MIN_SESSIONS_BEFORE_OFFER = 3;
export const DISMISS_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;
export const MAX_DISMISSALS = 3;

export interface InstallState {
  sessions: number;
  dismissals: number;
  lastDismissedAt: number | null;
  installed: boolean;
}

export const EMPTY_INSTALL_STATE: InstallState = {
  sessions: 0,
  dismissals: 0,
  lastDismissedAt: null,
  installed: false,
};

export function shouldOfferInstall(state: InstallState, now: number): boolean {
  if (state.installed) return false;
  if (state.sessions < MIN_SESSIONS_BEFORE_OFFER) return false;
  if (state.dismissals >= MAX_DISMISSALS) return false;
  if (state.lastDismissedAt !== null && now - state.lastDismissedAt < DISMISS_COOLDOWN_MS) {
    return false;
  }
  return true;
}

export function recordDismissal(state: InstallState, now: number): InstallState {
  return { ...state, dismissals: state.dismissals + 1, lastDismissedAt: now };
}

/**
 * iPhone, iPod, or iPad — including iPadOS 13+, which reports itself as a Mac
 * and is told apart by having a touch screen.
 */
export function isAppleMobileDevice(input: {
  userAgent: string;
  maxTouchPoints: number;
}): boolean {
  if (/iPhone|iPad|iPod/i.test(input.userAgent)) return true;
  return /Macintosh/i.test(input.userAgent) && input.maxTouchPoints > 1;
}

/** Parses a stored value defensively: storage is user-editable and may be junk. */
export function parseInstallState(raw: string | null): InstallState {
  if (!raw) return EMPTY_INSTALL_STATE;
  try {
    const value = JSON.parse(raw) as Partial<InstallState>;
    return {
      sessions: Number.isFinite(value.sessions) ? Number(value.sessions) : 0,
      dismissals: Number.isFinite(value.dismissals) ? Number(value.dismissals) : 0,
      lastDismissedAt: Number.isFinite(value.lastDismissedAt)
        ? Number(value.lastDismissedAt)
        : null,
      installed: value.installed === true,
    };
  } catch {
    return EMPTY_INSTALL_STATE;
  }
}
