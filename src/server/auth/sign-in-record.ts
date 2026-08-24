import "server-only";

import { eq } from "drizzle-orm";
import { headers } from "next/headers";

import * as t from "@/db/schema";
import { mutate, newId, SYSTEM_ACTOR } from "@/server/write";

/**
 * What a successful sign-in leaves behind.
 *
 * The CRM has a "last login", a device list and a security feed, and until now
 * all three described seeded fiction. They describe real sign-ins from here on.
 *
 * WHAT IS RECORDED, AND WHAT IS NOT
 * ---------------------------------
 * The user agent and the forwarded client address, parsed into the coarse
 * device / browser / OS strings the existing screens render. No session token,
 * no access token, no refresh token — those live in Supabase and in the
 * browser's cookie jar, and a copy of one in an operations console is a copy of
 * somebody's account. `user_device_sessions` is a *description* of a session,
 * never a handle to it.
 *
 * Geolocation is not attempted. The column exists and is filled with the one
 * honest value available without an IP-geolocation service.
 */

const UNKNOWN_LOCATION = "Unknown";

export interface RequestFingerprint {
  device: string;
  browser: string;
  os: string;
  ipAddress: string;
}

/** Best-effort, and honest when it does not know. */
export async function readRequestFingerprint(): Promise<RequestFingerprint> {
  let userAgent = "";
  let ipAddress = "0.0.0.0";

  try {
    const store = await headers();
    userAgent = store.get("user-agent") ?? "";
    // `x-forwarded-for` is a client-supplied header that a proxy overwrites.
    // Behind Vercel it is trustworthy; run directly, it is not — which is why
    // it is only ever displayed, never used to decide anything.
    const forwarded = store.get("x-forwarded-for");
    ipAddress =
      forwarded?.split(",")[0]?.trim() || store.get("x-real-ip")?.trim() || "0.0.0.0";
  } catch {
    // Outside a request scope. Nothing to read, and nothing that depends on it.
  }

  return { ...describeUserAgent(userAgent), ipAddress };
}

function describeUserAgent(userAgent: string): Omit<RequestFingerprint, "ipAddress"> {
  const ua = userAgent.toLowerCase();
  if (!ua) return { device: "Unknown device", browser: "Unknown", os: "Unknown" };

  const os = ua.includes("android")
    ? "Android"
    : /iphone|ipad|ipod/.test(ua)
      ? "iOS"
      : ua.includes("mac os")
        ? "macOS"
        : ua.includes("windows")
          ? "Windows"
          : ua.includes("linux")
            ? "Linux"
            : "Unknown";

  // Order matters: Edge and Chrome both claim "chrome", Chrome claims "safari".
  const browser = ua.includes("edg/")
    ? "Edge"
    : ua.includes("opr/") || ua.includes("opera")
      ? "Opera"
      : ua.includes("firefox")
        ? "Firefox"
        : ua.includes("chrome") || ua.includes("crios")
          ? "Chrome"
          : ua.includes("safari")
            ? "Safari"
            : "Unknown";

  const mobile = /mobile|iphone|ipod|android.*mobile/.test(ua);
  const tablet = /ipad|tablet/.test(ua) || (ua.includes("android") && !mobile);
  const device = tablet ? "Tablet" : mobile ? "Mobile" : "Desktop";

  return { device: `${device} · ${os}`, browser, os };
}

/**
 * Stamps the account's last activity and records the session and the event.
 *
 * Deliberately not fatal. A sign-in that succeeded must not be reported as
 * failed because a bookkeeping row would not write — the person is already
 * authenticated, and telling them otherwise sends them round the loop again.
 */
export async function recordSignIn(userId: string): Promise<void> {
  const fingerprint = await readRequestFingerprint();

  try {
    await mutate(SYSTEM_ACTOR, async ({ tx, now }) => {
      await tx
        .update(t.users)
        .set({ lastActiveAt: now, updatedAt: now })
        .where(eq(t.users.id, userId));

      // One row per sign-in. `isCurrent` is not maintained across devices —
      // there is no server-side session registry to reconcile it against, and
      // a flag that is wrong is worse than a flag that is absent.
      await tx.insert(t.userDeviceSessions).values({
        id: newId("dev", now),
        userId,
        device: fingerprint.device,
        browser: fingerprint.browser,
        os: fingerprint.os,
        ipAddress: fingerprint.ipAddress,
        location: UNKNOWN_LOCATION,
        loggedInAt: now,
        lastActiveAt: now,
        status: "active",
        isCurrent: false,
      });

      await tx.insert(t.userSecurityEvents).values({
        id: newId("sec", now),
        userId,
        type: "login",
        description: "Signed in",
        device: fingerprint.device,
        ipAddress: fingerprint.ipAddress,
        location: UNKNOWN_LOCATION,
        createdAt: now,
        outcome: "success",
      });
    });
  } catch {
    // See above: the sign-in stands.
  }
}

/** Records a security event against an account. Never throws. */
export async function recordSecurityEvent(input: {
  userId: string;
  type: (typeof t.securityEventTypeEnum.enumValues)[number];
  description: string;
  outcome?: "success" | "blocked";
}): Promise<void> {
  const fingerprint = await readRequestFingerprint();

  try {
    await mutate(SYSTEM_ACTOR, async ({ tx, now }) => {
      await tx.insert(t.userSecurityEvents).values({
        id: newId("sec", now),
        userId: input.userId,
        type: input.type,
        description: input.description,
        device: fingerprint.device,
        ipAddress: fingerprint.ipAddress,
        location: UNKNOWN_LOCATION,
        createdAt: now,
        outcome: input.outcome ?? "success",
      });
    });
  } catch {
    // The action it describes has already happened.
  }
}
