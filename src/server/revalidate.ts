import "server-only";

import { revalidatePath, revalidateTag } from "next/cache";

import { CATALOGUE_TAG } from "./services/catalogue.service";

/**
 * Invalidates cached routes after a mutation, without letting that failure
 * masquerade as the mutation failing.
 *
 * By the time an action revalidates, its transaction has committed. If
 * `revalidatePath` then throws — it requires Next's request-scoped store, and
 * has no store when an action is invoked outside a request — reporting the
 * action as failed tells the caller something untrue and invites them to retry
 * work that already happened. For an approval or a credit, retrying is the
 * expensive kind of wrong.
 *
 * So the outcome of the write is reported by the write, and stale cache is
 * treated as what it is: a display problem that the next navigation fixes.
 */
export function revalidate(...paths: string[]): void {
  for (const path of paths) {
    try {
      revalidatePath(path);
    } catch {
      // No request scope. The data changed regardless.
    }
  }
}

/**
 * Drops the cross-request catalogue cache.
 *
 * Plans, VIP levels and deposit networks are cached between requests because
 * they are public and identical for everyone (see `catalogue.service`). That
 * cache is keyed by tag rather than by path, so `revalidatePath("/plans")`
 * alone does **not** clear it — an operator's plan edit would sit invisible
 * behind a five-minute TTL, which is exactly the "the CRM says one thing and
 * the app shows another" failure the service layer exists to prevent.
 *
 * Swallowed for the same reason as above: by the time this runs the write has
 * committed, and a stale cache is a display problem, not a failed mutation.
 */
export function revalidateCatalogue(): void {
  try {
    revalidateTag(CATALOGUE_TAG);
  } catch {
    // No request scope. The TTL is the backstop.
  }
}
