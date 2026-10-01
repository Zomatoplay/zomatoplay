"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { usePathname } from "next/navigation";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ChevronRight,
  ImageIcon,
  Loader2,
  Pencil,
  Plus,
  ShieldCheck,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { CopyField } from "@/components/shared/copy-field";
import { InfoRow } from "@/components/shared/info-row";
import { QrCode } from "@/components/shared/qr-code";
import { StatusBadge } from "@/components/shared/status-badge";
import { TelegramSupportButton } from "@/components/shared/telegram-support";
import { DepositConfirmation } from "@/components/wallet/deposit-confirmation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatDateTime } from "@/utils/format";
import type { DepositRequestView } from "@/server/services/deposit-requests.service";
import {
  cancelDepositRequestAction,
  checkDepositRequestAction,
  createDepositRequestAction,
  getDepositRequestAction,
  submitDepositHashAction,
  type HashSubmissionActionResult,
  type NewDepositView,
} from "@/app/(app)/wallet/deposit/actions";
import { APP_NAME } from "@/constants/app";

/**
 * Deposit USDT: request → exact amount → pay → transaction hash → verified.
 *
 * TWO IDENTIFIERS, NEVER CONFUSED
 * -------------------------------
 *   Deposit Request ID  `DEP-XXXXXXXX` — Nanotron's, generated for you.
 *   Transaction hash    64 hex characters — the blockchain's, from your wallet.
 * The screen labels them separately and only ever asks for the second.
 *
 * NOTHING HERE SAYS "PAID" BEFORE THE SERVER DOES
 * ------------------------------------------------
 * Every status comes from the server's record of the request; this component
 * renders it and nothing more. "Credited" appears only after the transfer was
 * found on-chain, finalised and matched server-side.
 *
 * CHANGING THE AMOUNT, AND LEAVING
 * --------------------------------
 * While a request is waiting for payment with nothing submitted, "Change
 * amount" asks the server for a new request, which cancels this one in the
 * same transaction. Following an in-app link away asks first and, on
 * confirmation, cancels the request (`cancelDepositRequestAction`). Neither
 * can touch a request with a submitted hash or a matched transfer — the
 * server refuses — and a transfer of the cancelled amount inside its window
 * is still credited to this person (`MATCHABLE_REQUEST_STATUSES`).
 * A reload or closing the tab does NOT cancel: reopening the screen lands on
 * the same request, which is what somebody mid-payment needs.
 *
 * THE SCREENSHOT FIELD STORES NOTHING
 * -----------------------------------
 * It is optional, previewed on this device only, and never sent to the
 * server — there is no store for it yet (CLAUDE.md §23). It is labelled that
 * way on screen. Verification depends on the transaction hash alone.
 */

const TOKEN_LABEL = "USDT (TRC-20)";
const POLL_INTERVAL_MS = 5_000;
/** TRON solidifies ~57 s behind; a faster chain check cannot answer sooner (§18.5). */
const SCAN_INTERVAL_MS = 60_000;

const OPEN: DepositRequestView["status"][] = ["awaiting_payment", "verifying"];

export function DepositFlow({
  chainLabel,
  isTestnet,
  minimumDeposit,
  initialRequest,
  initialQrSvg,
  supportTelegramUrl,
}: {
  chainLabel: string;
  isTestnet: boolean;
  minimumDeposit: number;
  /** The operator-configured support link, validated server-side; null when unset. */
  supportTelegramUrl: string | null;
  /** The caller's most recent request that is still worth showing, if any. */
  initialRequest: DepositRequestView | null;
  initialQrSvg: string | null;
}) {
  const [request, setRequest] = useState<DepositRequestView | null>(initialRequest);
  const [qrSvg, setQrSvg] = useState<string | null>(initialQrSvg);

  if (!request) {
    return (
      <AmountStep
        chainLabel={chainLabel}
        isTestnet={isTestnet}
        minimumDeposit={minimumDeposit}
        onCreated={(created, svg) => {
          setRequest(created);
          setQrSvg(svg);
        }}
      />
    );
  }

  return (
    <RequestStep
      key={request.id}
      request={request}
      qrSvg={qrSvg}
      chainLabel={chainLabel}
      isTestnet={isTestnet}
      minimumDeposit={minimumDeposit}
      supportTelegramUrl={supportTelegramUrl}
      // Only updates about the request on screen: a poll still in flight for
      // a request that was just replaced must not bring it back.
      onChange={(next) =>
        setRequest((current) => (current && current.id === next.id ? next : current))
      }
      onReplace={(created, svg) => {
        setRequest(created);
        setQrSvg(svg);
      }}
      onNew={() => {
        setRequest(null);
        setQrSvg(null);
      }}
    />
  );
}

/* -------------------------------------------------------------------------- */

function AmountStep({
  chainLabel,
  isTestnet,
  minimumDeposit,
  onCreated,
}: {
  chainLabel: string;
  isTestnet: boolean;
  minimumDeposit: number;
  onCreated: (request: DepositRequestView, qrSvg: string | null) => void;
}) {
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const valid = isValidAmount(amount, minimumDeposit);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!valid || pending) return;
    setError(null);
    startTransition(async () => {
      const result = await createDepositRequestAction({ amount: amount.trim() });
      if (!result.ok || !result.request) {
        setError(result.message ?? "Could not start a deposit. Try again.");
        return;
      }
      onCreated(result.request, result.qrSvg ?? null);
    });
  }

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <div>
        <h2 className="text-base font-semibold tracking-tight">Deposit USDT</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          Deposits are accepted in USDT on the TRON network (TRC-20) only.
        </p>
      </div>

      <div className="divide-y divide-border rounded-2xl border border-border bg-card px-4">
        <InfoRow label="Network" value={chainLabel} />
        <InfoRow label="Asset" value={TOKEN_LABEL} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="deposit-amount">Amount to deposit (USDT)</Label>
        <Input
          id="deposit-amount"
          inputMode="decimal"
          autoComplete="off"
          placeholder={`Minimum ${minimumDeposit}`}
          className="h-11 text-base tabular"
          value={amount}
          onChange={(event) => setAmount(event.target.value.replace(/[^\d.]/g, ""))}
          aria-describedby="deposit-amount-help"
          aria-invalid={error ? true : undefined}
        />
        <p id="deposit-amount-help" className="text-xs leading-relaxed text-muted-foreground">
          Next, you will be given an exact amount to send — a few cents above this — so your
          transfer can be matched to your account. All of it is credited to your balance.
        </p>
      </div>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <NetworkWarnings isTestnet={isTestnet} />

      <Button type="submit" variant="brand" size="lg" block disabled={!valid || pending}>
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        {pending ? "Creating request…" : "Continue"}
        {pending ? null : <ChevronRight className="size-4" aria-hidden />}
      </Button>
    </form>
  );
}

/* -------------------------------------------------------------------------- */

/** A display-side check only; the server validates the amount again. */
function isValidAmount(amount: string, minimumDeposit: number): boolean {
  return /^\d+(\.\d{1,2})?$/.test(amount.trim()) && Number(amount) >= minimumDeposit;
}

/** Outcomes a person may need a human for. */
const SUPPORT_OUTCOMES: NonNullable<HashSubmissionActionResult["outcome"]>[] = [
  "not_found",
  "needs_review",
  "not_yours",
  "already_used",
];

function RequestStep({
  request,
  qrSvg: initialQr,
  chainLabel,
  isTestnet,
  minimumDeposit,
  supportTelegramUrl,
  onChange,
  onReplace,
  onNew,
}: {
  request: DepositRequestView;
  qrSvg: string | null;
  chainLabel: string;
  isTestnet: boolean;
  minimumDeposit: number;
  supportTelegramUrl: string | null;
  onChange: (request: DepositRequestView) => void;
  onReplace: (request: DepositRequestView, qrSvg: string | null) => void;
  onNew: () => void;
}) {
  const router = useRouter();
  const [qrSvg, setQrSvg] = useState(initialQr);
  const [txHash, setTxHash] = useState(request.submittedTxHash ?? "");
  const [message, setMessage] = useState<{
    tone: "ok" | "error";
    text: string;
    offerSupport: boolean;
  } | null>(null);
  const [verifying, startVerify] = useTransition();
  const [newDeposits, setNewDeposits] = useState<NewDepositView[]>([]);
  const [availableUsdt, setAvailableUsdt] = useState<number | null>(null);

  const busy = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const lastScanAt = useRef(0);
  const lastStatus = useRef(request.status);
  const open = OPEN.includes(request.status);

  // A screen reopened on an existing request has no QR yet.
  useEffect(() => {
    if (qrSvg) return;
    void getDepositRequestAction({ requestId: request.id }).then((result) => {
      if (result.ok && result.qrSvg) setQrSvg(result.qrSvg);
    });
  }, [qrSvg, request.id]);

  const check = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    const now = Date.now();
    const requestScan = now - lastScanAt.current >= SCAN_INTERVAL_MS;
    if (requestScan) lastScanAt.current = now;
    try {
      const result = await checkDepositRequestAction({ requestId: request.id, requestScan });
      if (!result.ok || !mounted.current) return;
      if (result.request) {
        onChange(result.request);
        if (result.request.status !== lastStatus.current) {
          lastStatus.current = result.request.status;
          // Money may have moved; balances elsewhere are stale.
          router.refresh();
        }
      }
      setNewDeposits(result.newDeposits);
      setAvailableUsdt(result.availableUsdt);
    } catch {
      // A failed poll is a delay. The next tick tries again.
    } finally {
      busy.current = false;
    }
  }, [onChange, request.id, router]);

  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => {
      if (!document.hidden) void check();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [check, open]);

  function verify(event: React.FormEvent) {
    event.preventDefault();
    if (verifying || txHash.trim().length === 0) return;
    setMessage(null);
    startVerify(async () => {
      const result = await submitDepositHashAction({ requestId: request.id, txHash: txHash.trim() });
      if (result.request) {
        onChange(result.request);
        lastStatus.current = result.request.status;
      }
      setMessage({
        tone: result.ok && result.outcome !== "needs_review" ? "ok" : "error",
        text: result.message ?? "",
        offerSupport: result.outcome !== undefined && SUPPORT_OUTCOMES.includes(result.outcome),
      });
      if (result.outcome === "credited") {
        toast.success("Payment verified and credited");
        router.refresh();
      }
    });
  }

  const canSubmitHash =
    request.status === "awaiting_payment" ||
    request.status === "verifying" ||
    request.status === "expired";
  // Only a request nobody has paid against yet may be replaced or abandoned;
  // the server enforces the same rule.
  const replaceable = request.status === "awaiting_payment" && !request.submittedTxHash;

  return (
    <div className="space-y-5">
      <LeaveGuard active={replaceable} requestId={request.id} />
      <DepositConfirmation deposits={newDeposits} availableUsdt={availableUsdt} />

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight">Deposit USDT</h2>
          <p className="text-xs text-muted-foreground">{chainLabel}</p>
        </div>
        <StatusBadge kind="depositRequest" status={request.status} />
      </div>

      <Card className="space-y-4 p-5">
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Send exactly</p>
          <p className="tabular text-2xl font-semibold tracking-tight">
            {request.expectedAmountUsdt} <span className="text-base font-medium">USDT</span>
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            The exact amount is how your transfer is matched to your account. If your wallet or
            exchange deducts a fee from it, the amount received will differ and the deposit will
            need a manual review.
          </p>
        </div>
        <CopyField
          label="Exact amount"
          value={request.expectedAmountUsdt}
          successMessage="Amount copied"
        />
        {replaceable ? (
          <ChangeAmount
            currentRequestId={request.id}
            currentAmount={request.requestedAmountUsdt}
            minimumDeposit={minimumDeposit}
            onReplaced={onReplace}
          />
        ) : null}
      </Card>

      <Card className="space-y-4 p-5">
        {qrSvg ? (
          <QrCode svg={qrSvg} label={`QR code for the ${APP_NAME} ${TOKEN_LABEL} deposit address`} />
        ) : (
          <div className="mx-auto size-44 animate-pulse rounded-2xl bg-secondary" aria-hidden />
        )}
        <CopyField
          label="Deposit address"
          value={request.receivingAddress}
          successMessage="Deposit address copied"
        />
      </Card>

      <div className="divide-y divide-border rounded-2xl border border-border bg-card px-4">
        <InfoRow label="Network" value={chainLabel} />
        <InfoRow label="Asset" value={TOKEN_LABEL} />
        <InfoRow label="Deposit Request ID" value={<span className="font-mono">{request.id}</span>} />
        <InfoRow label="Valid until" value={formatDateTime(request.expiresAt)} />
      </div>

      <NetworkWarnings isTestnet={isTestnet} />

      <StatusExplanation request={request} />

      {canSubmitHash ? (
        <form onSubmit={verify} className="space-y-3" noValidate>
          <p className="text-sm leading-relaxed text-muted-foreground">
            After completing your payment, enter the blockchain transaction hash below.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="tx-hash">Transaction hash</Label>
            <Input
              id="tx-hash"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              placeholder="64-character hash from your wallet"
              className="h-11 font-mono text-base"
              value={txHash}
              onChange={(event) => setTxHash(event.target.value.trim())}
              aria-describedby="tx-hash-help"
            />
            <p id="tx-hash-help" className="text-xs leading-relaxed text-muted-foreground">
              Also called the TxID. It is not your Deposit Request ID.
            </p>
          </div>
          <ScreenshotField />
          {message ? (
            <p
              className={
                message.tone === "ok"
                  ? "rounded-xl border border-border bg-secondary/60 p-3 text-sm leading-relaxed"
                  : "rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm leading-relaxed text-destructive"
              }
              role={message.tone === "error" ? "alert" : "status"}
            >
              {message.text}
            </p>
          ) : null}
          <Button
            type="submit"
            variant="brand"
            size="lg"
            block
            disabled={verifying || txHash.trim().length === 0}
          >
            {verifying ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <ShieldCheck className="size-4" aria-hidden />
            )}
            {verifying ? "Verifying on the blockchain…" : "Verify Payment"}
          </Button>
        </form>
      ) : null}

      {message?.offerSupport || request.status === "needs_review" ? (
        <div className="space-y-2">
          <p className="text-xs leading-relaxed text-muted-foreground">
            Need help with this payment? Send us your Deposit Request ID{" "}
            <span className="font-mono text-foreground">{request.id}</span> and the transaction
            hash.
          </p>
          <TelegramSupportButton url={supportTelegramUrl} />
        </div>
      ) : null}

      {replaceable ? null : (
        <Button variant="outline" size="lg" block onClick={onNew}>
          <Plus className="size-4" aria-hidden />
          New deposit
        </Button>
      )}
    </div>
  );
}

/**
 * "Change amount": a new request with a new exact amount. The server cancels
 * this one in the same transaction (`createDepositRequest`), so the two are
 * never both waiting for payment.
 */
function ChangeAmount({
  currentRequestId,
  currentAmount,
  minimumDeposit,
  onReplaced,
}: {
  currentRequestId: string;
  currentAmount: number;
  minimumDeposit: number;
  onReplaced: (request: DepositRequestView, qrSvg: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const valid = isValidAmount(amount, minimumDeposit);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!valid || pending) return;
    setError(null);
    startTransition(async () => {
      const result = await createDepositRequestAction({ amount: amount.trim() });
      if (!result.ok || !result.request) {
        setError(result.message ?? "Could not change the amount. Try again.");
        return;
      }
      setOpen(false);
      setAmount("");
      // The same amount hands back the request they already have.
      if (result.request.id === currentRequestId) {
        toast.message("That is already the amount of this request.");
        return;
      }
      onReplaced(result.request, result.qrSvg ?? null);
      toast.success("Amount changed", {
        description: `New request ${result.request.id}. Send exactly ${result.request.expectedAmountUsdt} USDT.`,
      });
    });
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <Pencil className="size-3.5" aria-hidden />
        Change amount
      </Button>
      <Sheet open={open} onOpenChange={(next) => !pending && setOpen(next)}>
        <SheetContent>
          <form onSubmit={submit} noValidate>
            <SheetHeader>
              <SheetTitle>Change amount</SheetTitle>
              <SheetDescription>
                You will get a new Deposit Request ID and a new exact amount to send. Your current
                request ({currentAmount} USDT) is cancelled. Do not send the old amount.
              </SheetDescription>
            </SheetHeader>
            <SheetBody className="space-y-1.5">
              <Label htmlFor="deposit-new-amount">New amount (USDT)</Label>
              <Input
                id="deposit-new-amount"
                inputMode="decimal"
                autoComplete="off"
                placeholder={`Minimum ${minimumDeposit}`}
                className="h-11 text-base tabular"
                value={amount}
                onChange={(event) => setAmount(event.target.value.replace(/[^\d.]/g, ""))}
                aria-invalid={error ? true : undefined}
              />
              {error ? (
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              ) : null}
            </SheetBody>
            <SheetFooter>
              <Button type="submit" variant="brand" size="lg" block disabled={!valid || pending}>
                {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                {pending ? "Creating new request…" : "Use this amount"}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}

/**
 * Asks before an in-app link takes somebody away from a request they have not
 * paid against yet, and cancels it if they go.
 *
 * Next's App Router has no navigation-blocking API, so this listens for link
 * clicks in the capture phase — before `<Link>` handles them — and only for
 * same-origin, same-tab navigations to a different page. The browser's own
 * back button and closing the tab are not intercepted, deliberately: they
 * leave the request to expire on its own, and reopening the screen resumes it.
 */
function LeaveGuard({ active, requestId }: { active: boolean; requestId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [target, setTarget] = useState<string | null>(null);
  const [leaving, startLeaving] = useTransition();

  useEffect(() => {
    if (!active) return;
    function onClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname === pathname) return;
      event.preventDefault();
      event.stopPropagation();
      setTarget(url.pathname + url.search + url.hash);
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [active, pathname]);

  function leave() {
    if (!target) return;
    const destination = target;
    startLeaving(async () => {
      const result = await cancelDepositRequestAction({ requestId }).catch(() => null);
      if (result && !result.ok && result.message) toast.message(result.message);
      setTarget(null);
      router.push(destination);
    });
  }

  return (
    <Sheet open={target !== null} onOpenChange={(open) => !open && !leaving && setTarget(null)}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Leave this deposit?</SheetTitle>
          <SheetDescription>
            Your deposit request <span className="font-mono">{requestId}</span> will be cancelled.
            If you have already sent the payment, it will still be detected and credited to you.
          </SheetDescription>
        </SheetHeader>
        <SheetFooter className="flex-col gap-2 sm:flex-col">
          <Button variant="brand" size="lg" block onClick={() => setTarget(null)} disabled={leaving}>
            Stay on this page
          </Button>
          <Button variant="outline" size="lg" block onClick={leave} disabled={leaving}>
            {leaving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {leaving ? "Cancelling…" : "Leave and cancel request"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/**
 * Optional payment screenshot — previewed here, NEVER uploaded or stored.
 * The object URL lives only in this tab and is revoked when replaced or when
 * the screen closes.
 */
function ScreenshotField() {
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview.url);
    };
  }, [preview]);

  function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setError(null);
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Choose an image file.");
      event.target.value = "";
      return;
    }
    setPreview({ url: URL.createObjectURL(file), name: file.name });
  }

  function clear() {
    setPreview(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor="payment-screenshot">
        Payment screenshot <span className="font-normal text-muted-foreground">(optional)</span>
      </Label>
      {preview ? (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-2.5">
          {/* A local blob: URL — next/image cannot and need not optimise it. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={preview.url}
            alt="Your payment screenshot"
            className="size-14 shrink-0 rounded-lg object-cover"
          />
          <p className="min-w-0 flex-1 break-all text-xs text-muted-foreground">{preview.name}</p>
          <Button type="button" variant="ghost" size="icon" onClick={clear} aria-label="Remove screenshot">
            <X className="size-4" aria-hidden />
          </Button>
        </div>
      ) : (
        <label
          htmlFor="payment-screenshot"
          className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-dashed border-border px-3.5 py-2.5 text-sm text-muted-foreground hover:bg-secondary/60 focus-within:outline-2 focus-within:outline-ring"
        >
          <ImageIcon className="size-4 shrink-0" aria-hidden />
          Add a screenshot for your reference
        </label>
      )}
      <input
        ref={inputRef}
        id="payment-screenshot"
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={onFile}
        aria-describedby="payment-screenshot-help"
      />
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <p id="payment-screenshot-help" className="text-xs leading-relaxed text-muted-foreground">
        Stays on this device only — it is not uploaded or stored, and it is not needed. Your
        payment is verified from the transaction hash.
      </p>
    </div>
  );
}

function StatusExplanation({ request }: { request: DepositRequestView }) {
  const text: Record<DepositRequestView["status"], string> = {
    awaiting_payment:
      "Waiting for your payment. A transfer of the exact amount is detected automatically; entering the transaction hash makes it faster.",
    verifying:
      "Your transaction was found and is waiting for final confirmation on the TRON network, usually about a minute. This screen checks every few seconds.",
    credited: `Verified on the blockchain and credited${
      request.verifiedAmountUsdt !== null ? `: ${request.verifiedAmountUsdt} USDT` : ""
    }.`,
    needs_review:
      request.reviewReason ??
      "Your transfer could not be matched automatically. Our team will review it — no action is needed.",
    expired:
      "This request has expired. If you already sent the payment, enter its transaction hash below and it will be reviewed. Otherwise, start a new deposit.",
    rejected: request.reviewReason ?? "This request was closed without a credit.",
    cancelled:
      "This request was cancelled. If you already sent the payment, it will still be detected and credited. Otherwise, start a new deposit.",
  };
  return (
    <p className="rounded-xl border border-border bg-secondary/60 p-3.5 text-xs leading-relaxed text-muted-foreground" aria-live="polite">
      <strong className="font-medium text-foreground">Status: </strong>
      {text[request.status]}
    </p>
  );
}

function NetworkWarnings({ isTestnet }: { isTestnet: boolean }) {
  return (
    <>
      {isTestnet ? (
        <p className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/8 p-3 text-xs leading-relaxed text-muted-foreground">
          <AlertTriangle className="mt-px size-3.5 shrink-0 text-warning" aria-hidden />
          <span>
            This is a <strong className="font-medium text-foreground">test network</strong>. Send
            test USDT only — real USDT sent here is permanently lost.
          </span>
        </p>
      ) : (
        <p className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/8 p-3 text-xs leading-relaxed text-muted-foreground">
          <AlertTriangle className="mt-px size-3.5 shrink-0 text-warning" aria-hidden />
          <span>
            This is the <strong className="font-medium text-foreground">TRON main network</strong>.
            Funds sent here are real, and a blockchain transfer cannot be reversed — check the
            address before you send.
          </span>
        </p>
      )}
      <p className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs leading-relaxed">
        <AlertTriangle className="mt-px size-3.5 shrink-0 text-destructive" aria-hidden />
        <span className="text-muted-foreground">
          <strong className="font-medium text-foreground">Send USDT (TRC-20) only.</strong> Do{" "}
          <strong className="font-medium text-foreground">not</strong> send TRX or USDT on another
          network (BEP20, ERC20, Polygon) — it cannot be detected or credited.
        </span>
      </p>
    </>
  );
}
