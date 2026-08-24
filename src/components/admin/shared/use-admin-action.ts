"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import type { AdminActionResult } from "@/app/admin/actions";

/**
 * Running an operator decision.
 *
 * Every mutating control in the CRM goes through this, so all of them behave
 * the same way: the action runs on the server, its result is reported honestly,
 * and a success ends with `router.refresh()` so the screen re-reads the
 * database rather than trusting an optimistic guess about what the write did.
 *
 * NO OPTIMISTIC UPDATES HERE, DELIBERATELY
 * ----------------------------------------
 * The store this replaced applied every change locally and immediately, which
 * is why the console felt fast and why it was wrong: an operator saw "approved"
 * whether or not anything had been recorded. For decisions about somebody's
 * money or account status, a moment of latency is a much smaller cost than a
 * confident screen that disagrees with the database.
 */
export function useAdminAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function run(
    action: () => Promise<AdminActionResult>,
    options?: { onSuccess?: () => void },
  ) {
    startTransition(async () => {
      let result: AdminActionResult;
      try {
        result = await action();
      } catch (error) {
        // A thrown action means the request itself failed — a network drop, a
        // redeploy mid-flight. Reported as a failure, because the caller
        // genuinely does not know whether the write landed.
        toast.error(
          error instanceof Error
            ? error.message
            : "The request did not reach the server.",
        );
        return;
      }

      if (!result.ok) {
        toast.error(result.message);
        return;
      }

      toast.success(result.message);
      options?.onSuccess?.();
      router.refresh();
    });
  }

  return { run, pending };
}
