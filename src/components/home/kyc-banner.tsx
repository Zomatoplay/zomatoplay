import Link from "next/link";
import { ArrowRight, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { KycStatus } from "@/types";

const copy: Record<
  Exclude<KycStatus, "verified">,
  { title: string; body: string; cta: string }
> = {
  not_started: {
    title: "Complete your KYC",
    body: "Verify your identity to access all platform features, including investing and withdrawals.",
    cta: "Complete KYC",
  },
  in_progress: {
    title: "Finish your verification",
    body: "You have started verifying your identity. Pick up where you left off — it takes about 3 minutes.",
    cta: "Continue KYC",
  },
  pending_review: {
    title: "Verification under review",
    body: "We are checking your documents. This usually completes within 24 hours.",
    cta: "View status",
  },
  rejected: {
    title: "Verification needs attention",
    body: "We could not verify your documents. Review the details and resubmit.",
    cta: "Review and resubmit",
  },
};

/**
 * The KYC reminder shown at the top of Home, above balances and investments.
 * Renders nothing once the user is verified.
 */
export function KycBanner({
  status,
  className,
}: {
  status: KycStatus;
  className?: string;
}) {
  if (status === "verified") return null;
  const { title, body, cta } = copy[status];

  return (
    <section
      aria-labelledby="kyc-banner-title"
      className={cn(
        "rounded-2xl border border-brand/25 bg-brand-soft p-4",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand/15 text-brand">
          <ShieldCheck className="size-4.5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2
            id="kyc-banner-title"
            className="text-sm font-semibold text-foreground"
          >
            {title}
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {body}
          </p>
          <Button asChild size="sm" variant="brand" className="mt-3">
            <Link href="/settings/kyc">
              {cta}
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
