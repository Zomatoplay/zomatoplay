/**
 * What the browser tells a person when a request it made did not work.
 *
 * A server action that *throws* reaches the browser as an `Error` whose text is
 * either a network failure from `fetch` ("Failed to fetch", "Load failed") or,
 * in production, a generic framework sentence. Neither is something to show.
 * This maps both to a sentence a person can act on; a message that came from
 * the server as a returned result is already safe and is not routed through
 * here.
 */
export const CONNECTION_INTERRUPTED =
  "Connection interrupted. Please check your internet connection and try again.";
export const COULD_NOT_LOAD = "We couldn't load the latest information right now. Please try again.";
export const SESSION_EXPIRED = "Your session has expired. Please sign in again.";

export function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/** True for the errors `fetch` throws when the request never completed. */
export function isNetworkError(error: unknown): boolean {
  if (isOffline()) return true;
  if (!(error instanceof Error)) return false;
  return (
    error.name === "TypeError" &&
    /failed to fetch|load failed|networkerror|network request failed|fetch failed/i.test(error.message)
  );
}

/** A safe sentence for a thrown error: the connection one, else `fallback`. */
export function friendlyClientError(error: unknown, fallback: string): string {
  return isNetworkError(error) ? CONNECTION_INTERRUPTED : fallback;
}
