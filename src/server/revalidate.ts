import "server-only";

import { revalidatePath } from "next/cache";

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
