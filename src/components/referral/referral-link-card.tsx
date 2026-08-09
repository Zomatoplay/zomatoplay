"use client";

import { useState } from "react";
import { QrCode as QrCodeIcon, Share2 } from "lucide-react";
import { toast } from "sonner";

import { CopyField } from "@/components/shared/copy-field";
import { QrCode } from "@/components/shared/qr-code";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { APP_NAME } from "@/constants/app";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";

/**
 * Referral link with copy, native share and QR.
 *
 * The QR SVG is generated on the server and passed in, so the QR library stays
 * out of the client bundle.
 */
export function ReferralLinkCard({
  link,
  code,
  qrSvg,
}: {
  link: string;
  code: string;
  qrSvg: string;
}) {
  const [qrOpen, setQrOpen] = useState(false);
  const { copy } = useCopyToClipboard();

  async function handleShare() {
    const payload = {
      title: `Join me on ${APP_NAME}`,
      text: `Use my invite code ${code} to join ${APP_NAME}.`,
      url: link,
    };

    // `navigator.share` only exists on supported browsers (and requires a
    // secure context), so fall back to copying the link.
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share(payload);
        return;
      } catch (error) {
        // A user-cancelled share is not an error worth surfacing.
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }

    const ok = await copy(link);
    toast[ok ? "success" : "error"](
      ok ? "Invite link copied" : "Could not share the link",
    );
  }

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="text-base font-semibold tracking-tight">
          Your invite link
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          Share this link. Anyone who joins through it is linked to your account.
        </p>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-xl bg-secondary/60 px-4 py-3">
        <span className="text-xs font-medium text-muted-foreground">
          Invite code
        </span>
        <span className="tabular font-mono text-sm font-semibold tracking-wide text-foreground">
          {code}
        </span>
      </div>

      <CopyField
        label="Invite link"
        value={link}
        successMessage="Invite link copied"
      />

      <div className="grid grid-cols-2 gap-2">
        <Button variant="brand" onClick={handleShare}>
          <Share2 className="size-4" />
          Share
        </Button>
        <Button variant="outline" onClick={() => setQrOpen(true)}>
          <QrCodeIcon className="size-4" />
          QR code
        </Button>
      </div>

      <Sheet open={qrOpen} onOpenChange={setQrOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Your invite QR</SheetTitle>
            <SheetDescription>
              Let someone scan this to open your invite link.
            </SheetDescription>
          </SheetHeader>
          <SheetBody className="space-y-4 py-4">
            <QrCode svg={qrSvg} label="QR code for your invite link" />
            <p className="break-all text-center font-mono text-xs text-muted-foreground">
              {link}
            </p>
          </SheetBody>
        </SheetContent>
      </Sheet>
    </Card>
  );
}
