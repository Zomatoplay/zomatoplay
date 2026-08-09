"use client";

import { useState } from "react";
import Link from "next/link";
import {
  BadgeCheck,
  Camera,
  Check,
  Clock,
  FileCheck2,
  IdCard,
  ShieldCheck,
  Upload,
  User,
} from "lucide-react";
import { toast } from "sonner";

import { PrototypeNote } from "@/components/shared/notices";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePrototypeStore } from "@/lib/prototype-store";
import { cn } from "@/lib/utils";

/**
 * Mock KYC flow: personal details → document → liveness → review.
 *
 * The step machine and its states mirror what a real provider integration
 * (Onfido/Sumsub-style) will need. INTEGRATION POINT: replace `submit` with the
 * provider SDK handoff and drive `kycStatus` from their webhook.
 */

const STEPS = [
  {
    id: "personal",
    title: "Personal details",
    description: "Your legal name and date of birth, as they appear on your ID.",
    icon: User,
  },
  {
    id: "document",
    title: "Identity document",
    description: "A government-issued photo ID — passport, Aadhaar or driving licence.",
    icon: IdCard,
  },
  {
    id: "selfie",
    title: "Liveness check",
    description: "A short selfie so we can confirm the document belongs to you.",
    icon: Camera,
  },
] as const;

export function KycFlow() {
  const { kycStatus, startKyc, submitKyc, approveKyc } = usePrototypeStore();
  const [step, setStep] = useState(0);
  const [fullName, setFullName] = useState("");
  const [dob, setDob] = useState("");
  const [documentUploaded, setDocumentUploaded] = useState(false);
  const [selfieCaptured, setSelfieCaptured] = useState(false);

  /* ---------------------------------------------------------------- */
  /* Terminal states                                                   */
  /* ---------------------------------------------------------------- */
  if (kycStatus === "verified") {
    return (
      <div className="space-y-5">
        <Card className="p-6 text-center">
          <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-brand-soft text-brand">
            <BadgeCheck className="size-7" aria-hidden />
          </span>
          <h2 className="mt-4 text-lg font-semibold">You are verified</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            Your identity has been confirmed. Investing and withdrawals are fully
            available on your account.
          </p>
        </Card>
        <div className="space-y-2">
          <Button asChild variant="brand" size="lg" block>
            <Link href="/plans">Explore plans</Link>
          </Button>
          <Button asChild variant="ghost" size="lg" block>
            <Link href="/settings">Back to settings</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (kycStatus === "pending_review") {
    return (
      <div className="space-y-5">
        <Card className="p-6 text-center">
          <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-info/10 text-info">
            <Clock className="size-7" aria-hidden />
          </span>
          <h2 className="mt-4 text-lg font-semibold">Verification in review</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            We have received your documents. Checks usually complete within 24
            hours, and we will notify you as soon as they do.
          </p>
        </Card>

        <div className="space-y-3 rounded-2xl border border-border bg-card p-5">
          {STEPS.map((item) => (
            <div key={item.id} className="flex items-center gap-3">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand text-brand-foreground">
                <Check className="size-3.5" aria-hidden />
              </span>
              <span className="text-sm text-foreground">{item.title}</span>
            </div>
          ))}
          <div className="flex items-center gap-3">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-info/15 text-info">
              <Clock className="size-3.5" aria-hidden />
            </span>
            <span className="text-sm text-muted-foreground">Under review</span>
          </div>
        </div>

        {/* Demo control standing in for the provider's approval webhook. */}
        <Card className="space-y-3 border-dashed p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Demo control
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            No verification provider is connected in this build. Approve the
            submission to see the verified state.
          </p>
          <Button
            variant="outline"
            size="sm"
            block
            onClick={() => {
              approveKyc();
              toast.success("Verification approved");
            }}
          >
            Simulate approval
          </Button>
        </Card>
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /* Interactive steps                                                 */
  /* ---------------------------------------------------------------- */
  const canContinue =
    step === 0
      ? fullName.trim().length > 2 && dob.trim() !== ""
      : step === 1
        ? documentUploaded
        : selfieCaptured;

  function next() {
    if (kycStatus === "not_started") startKyc();
    if (step < STEPS.length - 1) {
      setStep(step + 1);
      return;
    }
    submitKyc();
    toast.success("Verification submitted", {
      description: "We will let you know once the checks are complete.",
    });
  }

  const ActiveIcon = STEPS[step].icon;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <StatusBadge kind="kyc" status={kycStatus} />
        <span className="tabular text-xs text-muted-foreground">
          Step {step + 1} of {STEPS.length}
        </span>
      </div>

      {/* Step indicator — position is conveyed by number and label, not colour
          alone. */}
      <ol className="flex items-center gap-2">
        {STEPS.map((item, index) => (
          <li key={item.id} className="flex flex-1 items-center gap-2">
            <span
              className={cn(
                "h-1 flex-1 rounded-full",
                index <= step ? "bg-brand" : "bg-secondary",
              )}
            />
          </li>
        ))}
      </ol>

      <Card className="space-y-4 p-5">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand">
            <ActiveIcon className="size-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold">{STEPS[step].title}</h2>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              {STEPS[step].description}
            </p>
          </div>
        </div>

        {step === 0 ? (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="kyc-name">Full legal name</Label>
              <Input
                id="kyc-name"
                autoComplete="name"
                placeholder="As shown on your ID"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="kyc-dob">Date of birth</Label>
              <Input
                id="kyc-dob"
                type="date"
                autoComplete="bday"
                value={dob}
                onChange={(event) => setDob(event.target.value)}
              />
            </div>
          </div>
        ) : step === 1 ? (
          <button
            type="button"
            onClick={() => {
              setDocumentUploaded(true);
              toast.success("Document attached");
            }}
            className={cn(
              "flex w-full flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-8 transition-colors",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              documentUploaded
                ? "border-brand bg-brand-soft"
                : "border-border hover:bg-secondary/50",
            )}
          >
            <span
              className={cn(
                "flex size-10 items-center justify-center rounded-full",
                documentUploaded
                  ? "bg-brand text-brand-foreground"
                  : "bg-secondary text-muted-foreground",
              )}
            >
              {documentUploaded ? (
                <FileCheck2 className="size-5" aria-hidden />
              ) : (
                <Upload className="size-5" aria-hidden />
              )}
            </span>
            <span className="text-sm font-medium">
              {documentUploaded ? "Document attached" : "Upload your document"}
            </span>
            <span className="text-xs text-muted-foreground">
              {documentUploaded
                ? "id-document.jpg · tap to replace"
                : "JPG or PNG, up to 10 MB"}
            </span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              setSelfieCaptured(true);
              toast.success("Liveness check captured");
            }}
            className={cn(
              "flex w-full flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-8 transition-colors",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              selfieCaptured
                ? "border-brand bg-brand-soft"
                : "border-border hover:bg-secondary/50",
            )}
          >
            <span
              className={cn(
                "flex size-10 items-center justify-center rounded-full",
                selfieCaptured
                  ? "bg-brand text-brand-foreground"
                  : "bg-secondary text-muted-foreground",
              )}
            >
              {selfieCaptured ? (
                <Check className="size-5" aria-hidden />
              ) : (
                <Camera className="size-5" aria-hidden />
              )}
            </span>
            <span className="text-sm font-medium">
              {selfieCaptured ? "Liveness check complete" : "Start liveness check"}
            </span>
            <span className="text-xs text-muted-foreground">
              {selfieCaptured
                ? "Tap to retake"
                : "Takes about 10 seconds"}
            </span>
          </button>
        )}
      </Card>

      <div className="flex items-start gap-2.5 rounded-xl border border-border bg-secondary/60 p-3.5">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
        <p className="text-xs leading-relaxed text-muted-foreground">
          Your documents are used only to verify your identity and are handled
          under our privacy policy.
        </p>
      </div>

      <PrototypeNote>
        Demo build — no documents are uploaded, stored or sent to a verification
        provider. Anything you type here stays in your browser.
      </PrototypeNote>

      <div className="space-y-2">
        <Button variant="brand" size="lg" block disabled={!canContinue} onClick={next}>
          {step === STEPS.length - 1 ? "Submit for review" : "Continue"}
        </Button>
        {step > 0 ? (
          <Button variant="ghost" size="lg" block onClick={() => setStep(step - 1)}>
            Back
          </Button>
        ) : null}
      </div>
    </div>
  );
}
