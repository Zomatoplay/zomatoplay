import Link from "next/link";
import { LifeBuoy, Mail } from "lucide-react";

import { CopyField } from "@/components/shared/copy-field";
import { InfoRow } from "@/components/shared/info-row";
import { TelegramSupportButton } from "@/components/shared/telegram-support";
import { Button } from "@/components/ui/button";
import { formatUsdt } from "@/lib/currency";
import type { PlatformFinance } from "@/lib/platform-finance";

/**
 * What the platform currently charges and where to find us — read-only.
 *
 * Every value is set by an administrator and arrives as a prop from the
 * server; there is no control here that changes one. The same
 * `PlatformFinance` the deposit and withdrawal screens use, so the figures
 * cannot differ between screens.
 */
export function PlatformInfo({
  finance,
  depositAddress,
  network,
  supportEmail,
  telegramUrl,
}: {
  finance: PlatformFinance;
  depositAddress: string | null;
  network: string | null;
  supportEmail: string | null;
  telegramUrl: string | null;
}) {
  const feeText =
    finance.percentFee > 0
      ? `${formatUsdt(finance.flatFeeUsdt)} + ${finance.percentFee}%`
      : formatUsdt(finance.flatFeeUsdt);

  return (
    <div className="space-y-4">
      <div className="divide-y divide-border rounded-2xl border border-border bg-card px-4">
        <InfoRow label="Withdrawal fee" value={feeText} />
      </div>

      {depositAddress ? (
        <div className="space-y-2 rounded-2xl border border-border bg-card p-4">
          <CopyField
            label={`Deposit address${network ? ` · USDT (TRC-20) on ${network}` : " · USDT (TRC-20)"}`}
            value={depositAddress}
            successMessage="Deposit address copied"
          />
          <p className="text-xs leading-relaxed text-muted-foreground">
            To have a deposit credited automatically, start from{" "}
            <Link href="/wallet/deposit" className="font-medium text-brand underline-offset-2 hover:underline">
              Add funds
            </Link>{" "}
            and send the exact amount shown there.
          </p>
        </div>
      ) : null}

      <div className="space-y-2.5">
        {telegramUrl ? (
          <TelegramSupportButton url={telegramUrl} />
        ) : (
          <Button asChild variant="outline" size="lg" block>
            <Link href="/settings/support">
              <LifeBuoy className="size-4" aria-hidden />
              Help centre
            </Link>
          </Button>
        )}
        {supportEmail ? (
          <Button asChild variant="outline" size="lg" block>
            <a href={`mailto:${supportEmail}`}>
              <Mail className="size-4" aria-hidden />
              {supportEmail}
            </a>
          </Button>
        ) : null}
      </div>
    </div>
  );
}
