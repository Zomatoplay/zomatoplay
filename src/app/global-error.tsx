"use client";

import { useEffect } from "react";

/**
 * The last resort: a failure in the **root layout itself**.
 *
 * This one replaces the entire document, so it has to bring its own `<html>`
 * and `<body>` — the root layout that would normally supply them is the thing
 * that failed.
 *
 * For the same reason it uses inline styles and no imports. A broken root
 * layout may mean fonts, the stylesheet or a provider never loaded, and a
 * fallback that depends on the thing it is catching for is not a fallback.
 * Plain CSS values here, no design tokens, on purpose.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "2rem 1rem",
          background: "#fafaf9",
          color: "#1c1917",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
        }}
      >
        <div style={{ maxWidth: "22rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.125rem", fontWeight: 600, margin: "0 0 0.5rem" }}>
            We couldn&rsquo;t load this right now
          </h1>
          <p
            style={{
              fontSize: "0.875rem",
              lineHeight: 1.6,
              color: "#57534e",
              margin: "0 0 1.25rem",
            }}
          >
            This is usually temporary. Nothing on your account was changed —
            please try again in a moment.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              minHeight: "44px",
              padding: "0.625rem 1.25rem",
              borderRadius: "0.75rem",
              border: "none",
              background: "#0f766e",
              color: "#ffffff",
              fontSize: "0.875rem",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Retry
          </button>
          {error.digest ? (
            <p
              style={{
                fontSize: "0.6875rem",
                color: "#78716c",
                marginTop: "1rem",
                fontFamily: "ui-monospace, monospace",
              }}
            >
              Reference {error.digest}
            </p>
          ) : null}
        </div>
      </body>
    </html>
  );
}
