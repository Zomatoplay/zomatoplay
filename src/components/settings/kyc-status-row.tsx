"use client";

import { ShieldCheck } from "lucide-react";

import { ListRow } from "@/components/shared/list-row";
import { StatusBadge } from "@/components/shared/status-badge";
import { usePrototypeStore } from "@/lib/prototype-store";

/** Settings row whose trailing badge tracks the live KYC status. */
export function KycStatusRow() {
  const { kycStatus } = usePrototypeStore();
  return (
    <ListRow
      href="/settings/kyc"
      icon={ShieldCheck}
      title="Identity verification"
      description="Required before investing or withdrawing"
      meta={<StatusBadge kind="kyc" status={kycStatus} showIcon={false} />}
    />
  );
}
