"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * The browser's half of the trace.
 *
 * The server can time everything it does; it cannot see the click that started
 * a navigation or the render that ended it. Those two moments are the
 * difference between "the server took 400ms" and "the user waited 900ms", and
 * only the browser knows them.
 *
 * HOW THE CLIENT AND SERVER END UP WITH ONE CORRELATION ID
 * --------------------------------------------------------
 * This is the part worth understanding before changing anything here.
 *
 * A client-side navigation is an RSC fetch that Next issues itself. There is no
 * hook to add a header to it, and no way to read a header off it — so the
 * obvious approaches (send the id up, or read the server's id back) are both
 * unavailable.
 *
 * A **cookie** is the one channel that rides along automatically. On click, the
 * id is written to a short-lived cookie; the middleware reads it and adopts it
 * as that request's correlation id. Client and server then agree, and one
 * filter in `/admin/system-logs` shows the whole chain.
 *
 * The cookie lives ten seconds and is overwritten by the next click. It is a
 * diagnostic label: it grants nothing, selects nothing, and the middleware
 * validates its shape so it cannot carry text into the log.
 *
 * WHY A CAPTURE-PHASE CLICK LISTENER
 * ----------------------------------
 * The App Router has no navigation-start event. The click is the only reliable
 * "the user asked for something" signal, and capture phase means it is seen
 * before any handler can stop propagation.
 *
 * Nothing here blocks or delays the navigation: the listener is passive, and
 * the events are posted after the fact with `sendBeacon`.
 */

interface ClientEvent {
  operation: string;
  status: "started" | "ok" | "failed";
  durationMs?: number;
  route?: string;
  label?: string;
  correlationId?: string;
}

const TRACE_COOKIE = "nanotron-trace";

let pendingCorrelationId: string | null = null;
let navigationStartedAt: number | null = null;
let buffer: ClientEvent[] = [];

function newCorrelationId(): string {
  const raw =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "")
      : Math.random().toString(36).slice(2).padEnd(20, "0");
  return `req_${raw.slice(0, 20)}`;
}

/**
 * Sends what has been buffered, without the page waiting for it.
 *
 * `sendBeacon` is queued by the browser and survives the page changing, which
 * a `fetch` from an unmounting tree does not. The `fetch` fallback is for
 * browsers without it and is explicitly `keepalive`.
 */
function flush() {
  if (buffer.length === 0) return;
  const body = JSON.stringify({ events: buffer });
  buffer = [];

  try {
    if (typeof navigator !== "undefined" && "sendBeacon" in navigator) {
      navigator.sendBeacon(
        "/api/trace",
        new Blob([body], { type: "application/json" }),
      );
      return;
    }
    void fetch("/api/trace", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Diagnostics must never surface as an application error.
  }
}

function record(event: ClientEvent) {
  buffer.push(event);
  // A hard cap, so a page that somehow loops cannot grow this without bound.
  if (buffer.length >= 20) flush();
}

/** Exposed so a button can label its own action with the same id. */
export function traceClientAction(
  label: string,
  phase: "start" | "complete" | "failed",
  durationMs?: number,
) {
  record({
    operation: `action.${phase === "start" ? "start" : phase}`,
    status: phase === "start" ? "started" : phase === "failed" ? "failed" : "ok",
    durationMs,
    label,
    route: typeof window !== "undefined" ? window.location.pathname : undefined,
    correlationId: pendingCorrelationId ?? undefined,
  });
  if (phase !== "start") flush();
}

export function NavigationTracer() {
  const pathname = usePathname();

  // Click: the user asked for something.
  useEffect(() => {
    function onClick(event: MouseEvent) {
      // Modified clicks open a new tab; the current document does not navigate.
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const anchor = (event.target as HTMLElement | null)?.closest?.("a");
      if (!anchor) return;

      const href = anchor.getAttribute("href");
      if (!href || !href.startsWith("/") || anchor.getAttribute("target")) return;
      // Same page: no navigation to time.
      if (href === window.location.pathname) return;

      const correlationId = newCorrelationId();
      pendingCorrelationId = correlationId;
      navigationStartedAt = performance.now();

      // The channel the middleware reads. Short-lived and overwritten by the
      // next click; `SameSite=Lax` so it rides a top-level navigation.
      document.cookie = `${TRACE_COOKIE}=${correlationId}; path=/; max-age=10; SameSite=Lax`;

      record({
        operation: "navigation.start",
        status: "started",
        route: href,
        label: href,
        correlationId,
      });
    }

    document.addEventListener("click", onClick, { capture: true, passive: true });
    return () =>
      document.removeEventListener("click", onClick, { capture: true });
  }, []);

  // Pathname changed: the navigation Next was doing has rendered.
  useEffect(() => {
    if (!pendingCorrelationId || navigationStartedAt === null) return;

    record({
      operation: "navigation.complete",
      status: "ok",
      durationMs: performance.now() - navigationStartedAt,
      route: pathname,
      label: pathname,
      correlationId: pendingCorrelationId,
    });

    pendingCorrelationId = null;
    navigationStartedAt = null;
    flush();
  }, [pathname]);

  // Anything still buffered when the tab goes away.
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => document.removeEventListener("visibilitychange", onHidden);
  }, []);

  return null;
}
