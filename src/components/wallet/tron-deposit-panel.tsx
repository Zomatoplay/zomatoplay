import { AlertTriangle } from "lucide-react";

import { CopyField } from "@/components/shared/copy-field";
import { InfoRow } from "@/components/shared/info-row";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { PublicDepositTarget } from "@/server/services/tron.service";

/**
 * The platform's TRC-20 deposit address.
 *
 * A server component: it receives an already-stripped projection of the TRON
 * configuration, so nothing here can reach the TronGrid API key even by
 * accident.
 *
 * The testnet banner is not decoration. A user who sends real USDT to a Shasta
 * address loses it, and this is the only place the app can say so before they
 * do.
 */
export function TronDepositPanel({ target }: { target: PublicDepositTarget }) {
  if (!target.configured || !target.address) {
    return (
      <Card className="p-5">
        <div className="flex items-start gap-2.5">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <div className="min-w-0 space-y-1">
            <h2 className="text-base font-semibold tracking-tight">
              Deposits are not open yet
            </h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              No deposit address is configured for this environment, so there is
              nowhere to send funds. Nothing you send now would be credited.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold tracking-tight">
          Deposit {target.token}
        </h2>
        <Badge variant="warning">{target.networkLabel}</Badge>
      </div>

      {target.isTestnet ? (
        <p className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/8 p-3 text-xs leading-relaxed text-muted-foreground">
          <AlertTriangle className="mt-px size-3.5 shrink-0 text-warning" aria-hidden />
          <span>
            This is a <strong className="font-medium text-foreground">test network</strong>.
            Send test {target.token} only. Real {target.token} sent to this
            address is permanently lost.
          </span>
        </p>
      ) : null}

      <div className="divide-y divide-border rounded-2xl border border-border">
        <div className="px-4">
          <InfoRow label="Network" value={`${target.chain} · ${target.networkLabel}`} />
        </div>
        <div className="px-4">
          <InfoRow label="Token" value={`${target.token} (${target.tokenStandard})`} />
        </div>
        <div className="px-4">
          <InfoRow
            label="Credited after"
            value={
              target.requiresConfirmation
                ? "Block finalisation"
                : "Detection"
            }
          />
        </div>
      </div>

      <CopyField label="Deposit address" value={target.address} />

      {/*
        The mistake this exists to prevent, stated first and plainly.

        Every TRC-20 address is also a perfectly valid address for the chain's
        native coin, and a wallet will happily send TRX to it. Those transfers
        succeed on-chain and are invisible to a TRC-20 transfer query — a
        different endpoint entirely — so nothing detects them and nothing can
        credit them.

        This is not hypothetical: during testing, three TRX transfers (200, 111
        and 100 TRX) landed on this address and were reported as "deposits the
        app is not detecting". The scanner was correct; the asset was wrong.
        A one-line footnote about contracts was not enough, so the warning is
        now the loudest thing on the card.
      */}
      <p className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs leading-relaxed">
        <AlertTriangle
          className="mt-px size-3.5 shrink-0 text-destructive"
          aria-hidden
        />
        <span className="text-muted-foreground">
          <strong className="font-medium text-foreground">
            Send {target.token} ({target.tokenStandard}) only.
          </strong>{" "}
          {target.chain === "TRON" ? (
            <>
              Do <strong className="font-medium text-foreground">not</strong>{" "}
              send TRX — it is the network&rsquo;s own coin, not{" "}
              {target.token}, and it cannot be detected or credited.{" "}
            </>
          ) : null}
          {target.contract ? (
            <>
              Only the contract ending{" "}
              <span className="font-mono">{target.contract.slice(-6)}</span> is
              recognised.
            </>
          ) : null}
        </span>
      </p>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Transfers are detected automatically, but this platform uses one shared
        receiving address — so a deposit is matched to your account by our team
        rather than instantly. Keep your transaction hash.
      </p>
    </Card>
  );
}
