import type { Metadata } from "next";

import { UserDataProvider } from "@/lib/prototype-store";
import { getOwnKycCase, getUserSlices } from "@/server/services/account.service";
import { getAuthenticatedAccount } from "@/server/auth/account";
import { kycUploadModeFor } from "@/server/storage/kyc-document-store";

import { PageContainer } from "@/components/navigation/app-shell";
import { PageHeader } from "@/components/shared/page-header";
import { KycFlow } from "@/components/settings/kyc-flow";

export const metadata: Metadata = {
  title: "Identity verification",
};

export default async function KycPage() {
  /*
   * One wave. `getOwnKycCase` is the reviewer's decision on this account's
   * latest submission — the reason a rejection gives, which was stored and
   * never shown to anybody.
   */
  const [slices, kycCase, account] = await Promise.all([
    getUserSlices(["profile"] as const),
    getOwnKycCase(),
    // Memoised per request; the layout's gate already resolved it.
    getAuthenticatedAccount(),
  ]);
  // Decided here, server-side: which store this account's files can go to.
  const uploadMode = account ? kycUploadModeFor(account) : "unavailable";

  return (
    <UserDataProvider data={slices}>
      <>
        <PageHeader title="Identity verification" backHref="/settings" />
        <PageContainer className="space-y-5">
          <KycFlow
            reviewerNote={kycCase?.rejectionReason ?? null}
            uploadMode={uploadMode}
            submittedFiles={
              kycCase ? { hasDocument: kycCase.hasDocument, hasSelfie: kycCase.hasSelfie } : null
            }
          />
        </PageContainer>
      </>
  </UserDataProvider>
  );
}
