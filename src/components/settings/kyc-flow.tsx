"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  BadgeCheck,
  Camera,
  Check,
  Clock,
  FileCheck2,
  IdCard,
  ShieldCheck,
  TriangleAlert,
  User,
} from "lucide-react";
import { toast } from "sonner";

import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePrototypeStore } from "@/lib/prototype-store";
import {
  startKycAction,
  submitKycAction,
} from "@/app/(app)/settings/kyc/actions";
import { cn } from "@/lib/utils";
import type { KycUploadMode } from "@/types";

import {
  FilePhotoButton,
  SelfieCapture,
  uploadKycFile,
  UploadError,
  type CapturedImage,
} from "./kyc-capture";

/**
 * Identity verification: personal details → document → selfie → review.
 *
 * WHAT CHANGED, AND WHY IT HAD TO
 * -------------------------------
 * The document and selfie steps used to be two buttons that set a boolean.
 * Nothing opened a file picker, nothing opened a camera, the document type was
 * hard-coded to `national_id`, the "document number" was
 * `Math.random()`, and the filename was the string `identity-document.jpg` for
 * every submission ever made. Then it sent `livenessCheckPassed: true`, which
 * an operator reads in the CRM as a check that passed.
 *
 * The two real submissions in the development database both carry that
 * fabricated filename and a `liveness_check_passed` of `true`. That is the
 * defect: not that the flow was incomplete, but that it asserted something
 * false about a person's identity into a table somebody makes decisions from.
 *
 * WHAT IS TRUE NOW
 * ----------------
 * - The document step opens the real file picker or the real camera, checks
 *   the type and the size, and reports the actual filename and byte count.
 * - The selfie step opens the real camera (`getUserMedia`) with a live preview,
 *   and falls back to the OS camera app where that API is unavailable — which
 *   includes every insecure origin. See `kyc-capture`.
 * - The document number is typed by the person, and **only its last four
 *   characters ever leave the browser**. The server composes the mask.
 * - `livenessCheckPassed` is not a value this component can send. Nothing in
 *   this deployment performs an automated liveness check, so nothing here may
 *   claim one passed.
 *
 * WHAT IS STILL MISSING, STATED TO THE USER RATHER THAN HIDDEN
 * -----------------------------------------------------------
 * **No file is transmitted.** There is no document store and no verification
 * provider, so the captured images stay in the browser and only their metadata
 * is recorded. The notice at the bottom of the flow says exactly that. Wiring a
 * provider — or a storage bucket with the access rules identity documents
 * require — is the remaining integration, and it is a deployment decision
 * rather than a component change.
 */

const DOCUMENT_TYPES = [
  { id: "aadhaar", label: "Aadhaar" },
  { id: "pan", label: "PAN card" },
  { id: "passport", label: "Passport" },
  { id: "driving_licence", label: "Driving licence" },
  { id: "national_id", label: "Other national ID" },
] as const;

type DocumentType = (typeof DOCUMENT_TYPES)[number]["id"];

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
    title: "Selfie",
    description:
      "A photo of your face, so a reviewer can compare it with your document.",
    icon: Camera,
  },
] as const;

/**
 * What each step says when the photograph on it is not required.
 *
 * Written out rather than appending "(optional)" to the existing sentence,
 * because the useful information is not that it may be skipped — it is *why*,
 * and that skipping costs the person nothing now and may be asked for later.
 */
const OPTIONAL_STEP_NOTE: Partial<Record<(typeof STEPS)[number]["id"], string>> = {
  document:
    "Attaching a photo is optional for now — your document type and number are what we need at this stage.",
  selfie:
    "A selfie is optional for now. You can submit without one, and we will ask for it if a reviewer needs it.",
};

/**
 * Whether the photographs are mandatory in this build.
 *
 * Mirrors the server's `KYC_REQUIRE_DOCUMENTS` policy
 * (`@/server/services/kyc-policy`). A client constant cannot be the boundary —
 * the server validates independently — but it has to agree, or the form either
 * blocks a submission the server would accept or offers one it would refuse.
 *
 * `NEXT_PUBLIC_` because this is the only way a client component can read a
 * deployment setting, and there is nothing sensitive about "are documents
 * required": the answer is visible from using the form for ten seconds.
 */
const DOCUMENTS_REQUIRED =
  process.env.NEXT_PUBLIC_KYC_REQUIRE_DOCUMENTS === "true";

/** Everything after the last four characters is dropped before anything is sent. */
function lastFour(documentNumber: string): string {
  return documentNumber.replace(/[^A-Za-z0-9]/g, "").slice(-4).toUpperCase();
}

export function KycFlow({
  /**
   * What the reviewer said, when they rejected the last submission or asked for
   * it again.
   *
   * `rejectKyc()` requires a reason and its own comment calls it "what the user
   * is shown"; a test is named after that promise. Nothing showed it. Somebody
   * rejected saw a red badge and had no way to learn what to fix, which is the
   * single thing a rejection has to communicate. Read server-side from the
   * account's own latest case — see `getOwnKycCase`.
   */
  reviewerNote = null,
  /**
   * Where attached files go, decided server-side (`kycUploadModeFor`).
   * `unavailable` hides the attach controls rather than offering a button
   * that cannot work — declared details still submit.
   */
  uploadMode = "unavailable",
}: {
  reviewerNote?: string | null;
  uploadMode?: KycUploadMode;
} = {}) {
  const canAttach = uploadMode !== "unavailable";
  // Status only. The store is a cache of what the database said at render
  // time; it cannot change a verification state, and nothing here asks it to.
  const { kycStatus } = usePrototypeStore();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [step, setStep] = useState(0);
  const [fullName, setFullName] = useState("");
  const [dob, setDob] = useState("");
  const [documentType, setDocumentType] = useState<DocumentType>("aadhaar");
  const [documentNumber, setDocumentNumber] = useState("");
  const [document, setDocument] = useState<CapturedImage | null>(null);
  const [selfie, setSelfie] = useState<CapturedImage | null>(null);
  /** Distinguishes "sending your files" from "recording your submission". */
  const [uploading, setUploading] = useState(false);

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
            We have received your details. Checks usually complete within 24
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
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /* Interactive steps                                                 */
  /* ---------------------------------------------------------------- */
  /*
   * WHAT IS ACTUALLY REQUIRED TO SUBMIT, AND WHAT IS NOT.
   *
   * The identity details are: a name, a date of birth, a document type and the
   * last four characters of the document number. Those are what make a case
   * reviewable at all, and none of them has been relaxed.
   *
   * The photographs are not, on this deployment. `DOCUMENTS_REQUIRED` mirrors
   * the server's `KYC_REQUIRE_DOCUMENTS` policy so the button and the
   * validation agree; the server is still the boundary, and turning the policy
   * on without changing this would produce a refusal rather than a bad
   * submission.
   */
  const canContinue =
    step === 0
      ? fullName.trim().length > 2 && dob.trim() !== ""
      : step === 1
        ? lastFour(documentNumber).length === 4 &&
          (!DOCUMENTS_REQUIRED || document !== null)
        : !DOCUMENTS_REQUIRED || selfie !== null;

  function next() {
    if (step < STEPS.length - 1) {
      if (step === 0 && kycStatus === "not_started") {
        // Fire-and-forget: it only moves not_started → in_progress, and the
        // page does not depend on the result to advance.
        void startKycAction();
      }
      setStep(step + 1);
      return;
    }

    if (DOCUMENTS_REQUIRED && (!document || !selfie)) return;

    startTransition(async () => {
      /*
       * Whatever the person actually attached goes up first, and the
       * submission only happens if it landed.
       *
       * Uploading straight to Storage rather than through a server action is
       * what keeps a 10 MB scan working in production — see `uploadKycFile`.
       * Ordering matters: a submission written before the upload succeeded
       * would be a `pending_review` case pointing at nothing, which a reviewer
       * cannot progress and the person cannot understand.
       *
       * Nothing attached means nothing uploaded — not a placeholder, not an
       * empty object. The absence is carried all the way through to the
       * database as an absence.
       */
      let documentPath: string | undefined;
      let selfiePath: string | undefined;
      if (document || selfie) {
        try {
          setUploading(true);
          [documentPath, selfiePath] = await Promise.all([
            document
              ? uploadKycFile(document, "document", uploadMode)
              : Promise.resolve(undefined),
            selfie ? uploadKycFile(selfie, "selfie", uploadMode) : Promise.resolve(undefined),
          ]);
        } catch (error) {
          toast.error(
            error instanceof UploadError
              ? error.message
              : "Your documents could not be uploaded. Check your connection and try again.",
          );
          return;
        } finally {
          setUploading(false);
        }
      }

      const result = await submitKycAction({
        legalName: fullName.trim(),
        dateOfBirth: dob,
        documentType,
        // The full number never leaves this component. The server builds the
        // mask, so there is no complete identity number in a request body, in a
        // server log, or in the database.
        documentNumberLast4: lastFour(documentNumber),
        documentFileName: document?.fileName,
        documentByteSize: document?.sizeBytes,
        documentMimeType: document?.mimeType,
        documentPath,
        selfieFileName: selfie?.fileName,
        selfiePath,
      });

      if (!result.ok) {
        toast.error(result.message);
        return;
      }

      toast.success("Submitted for review", {
        description: "We will let you know once the checks are complete.",
      });
      // The status now lives in the database; re-read rather than assume.
      router.refresh();
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

      {/*
        Shown above the form, not below it.

        Somebody arriving here after a rejection is being asked to do the whole
        thing again; what the reviewer objected to is the first thing they need,
        not a footnote under the submit button.
      */}
      {reviewerNote ? (
        <div className="flex items-start gap-2.5 rounded-xl border border-destructive/30 bg-destructive/5 p-3.5">
          <TriangleAlert
            className="mt-0.5 size-4 shrink-0 text-destructive"
            aria-hidden
          />
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium text-foreground">
              {kycStatus === "rejected"
                ? "Your last submission was not accepted"
                : "We need your documents again"}
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {reviewerNote}
            </p>
          </div>
        </div>
      ) : null}

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
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <h2 className="text-base font-semibold">{STEPS[step].title}</h2>
              {!DOCUMENTS_REQUIRED && OPTIONAL_STEP_NOTE[STEPS[step].id] ? (
                <span className="rounded-full border border-border bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  Optional
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              {STEPS[step].description}
            </p>
            {!DOCUMENTS_REQUIRED && OPTIONAL_STEP_NOTE[STEPS[step].id] ? (
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                {OPTIONAL_STEP_NOTE[STEPS[step].id]}
              </p>
            ) : null}
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
          <DocumentStep
            documentType={documentType}
            onDocumentType={setDocumentType}
            documentNumber={documentNumber}
            onDocumentNumber={setDocumentNumber}
            document={document}
            onDocument={setDocument}
            canAttach={canAttach}
          />
        ) : !canAttach ? (
          <p className="rounded-xl border border-border bg-secondary/60 p-3 text-xs leading-relaxed text-muted-foreground">
            Photo upload is not available right now. You can submit your details
            without a selfie, and we will ask for one if a reviewer needs it.
          </p>
        ) : (
          <div className="space-y-3">
            <SelfieCapture
              value={selfie}
              onCapture={setSelfie}
              onClear={() => setSelfie(null)}
            />
            {/*
              Said here, at the moment the claim would otherwise be implied.

              A person who has just taken a selfie for a finance app reasonably
              assumes something checked it. Nothing did, and the difference
              matters to them: their account is waiting on a human, not on a
              few seconds of processing.
            */}
            <p className="rounded-xl border border-border bg-secondary/60 p-3 text-xs leading-relaxed text-muted-foreground">
              This photo is <strong className="font-medium text-foreground">not</strong>{" "}
              checked automatically. Automated liveness verification is not
              connected on this deployment, so a reviewer compares your selfie
              with your document by hand.
            </p>
          </div>
        )}
      </Card>

      <div className="flex items-start gap-2.5 rounded-xl border border-border bg-secondary/60 p-3.5">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
        <p className="text-xs leading-relaxed text-muted-foreground">
          Your documents are used only to verify your identity and are handled
          under our privacy policy.
        </p>
      </div>

      {/*
        Replaces the old `PrototypeNote`, which said the same thing less
        precisely. This is the state of the integration, and it is what makes
        the difference between an honest flow and a convincing one.
      */}
      <p className="rounded-xl border border-border bg-secondary/60 p-3.5 text-xs leading-relaxed text-muted-foreground">
        <strong className="font-medium text-foreground">
          {DOCUMENTS_REQUIRED
            ? "Your documents are uploaded to private storage."
            : "Photographs are optional at this stage."}
        </strong>{" "}
        {DOCUMENTS_REQUIRED
          ? "Only you and our verification team can open them — they have no public address and are reached through a short-lived link that expires."
          : "Anything you do attach is uploaded to private storage, where only you and our verification team can open it through a short-lived link. Nothing is recorded as attached unless it really was."}{" "}
        Your full document number is never sent; only its last four characters
        are.
      </p>

      <div className="space-y-2">
        <Button
          variant="brand"
          size="lg"
          block
          disabled={!canContinue || pending || uploading}
          onClick={next}
        >
          {step === STEPS.length - 1
            ? uploading
              ? "Uploading your documents…"
              : pending
                ? "Submitting…"
                : "Submit for review"
            : !DOCUMENTS_REQUIRED &&
                OPTIONAL_STEP_NOTE[STEPS[step].id] &&
                ((step === 1 && document === null) ||
                  (step === 2 && selfie === null))
              ? "Skip and continue"
              : "Continue"}
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

/* -------------------------------------------------------------------------- */

function DocumentStep({
  documentType,
  onDocumentType,
  documentNumber,
  onDocumentNumber,
  document,
  onDocument,
  canAttach,
}: {
  canAttach: boolean;
  documentType: DocumentType;
  onDocumentType: (value: DocumentType) => void;
  documentNumber: string;
  onDocumentNumber: (value: string) => void;
  document: CapturedImage | null;
  onDocument: (value: CapturedImage | null) => void;
}) {
  const [problem, setProblem] = useState<string | null>(null);
  const masked = lastFour(documentNumber);

  return (
    <div className="space-y-4">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-foreground">Document type</legend>
        {/* Radios rather than a select: a few options, and a native select on
            Android renders a modal that hides the rest of the step. */}
        <div className="space-y-2">
          {DOCUMENT_TYPES.map((option) => (
            <label
              key={option.id}
              className={cn(
                "flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-sm transition-colors",
                documentType === option.id
                  ? "border-brand bg-brand-soft text-foreground"
                  : "border-border hover:bg-secondary/50",
              )}
            >
              <input
                type="radio"
                name="kyc-document-type"
                value={option.id}
                checked={documentType === option.id}
                onChange={() => onDocumentType(option.id)}
                className="size-4 accent-[var(--brand)]"
              />
              <span className="min-w-0">{option.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="space-y-1.5">
        <Label htmlFor="kyc-document-number">Document number</Label>
        <Input
          id="kyc-document-number"
          inputMode="text"
          autoComplete="off"
          spellCheck={false}
          placeholder="As printed on the document"
          value={documentNumber}
          onChange={(event) => onDocumentNumber(event.target.value)}
          aria-describedby="kyc-document-number-help"
        />
        <p id="kyc-document-number-help" className="text-xs leading-relaxed text-muted-foreground">
          {masked.length === 4
            ? `Only the last four characters are sent: •••• ${masked}`
            : "Only the last four characters are sent — the rest stays on this device."}
        </p>
      </div>

      {!canAttach ? (
        <p className="rounded-xl border border-border bg-secondary/60 p-3 text-xs leading-relaxed text-muted-foreground">
          Photo upload is not available right now. Your document type and number
          are enough to submit.
        </p>
      ) : document ? (
        <div className="space-y-3">
          <div className="flex items-start gap-3 rounded-xl border border-brand bg-brand-soft p-4">
            <FileCheck2 className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden />
            <div className="min-w-0">
              {/* `break-all`: a camera filename can be long and unbroken, and a
                  layout that overflows at 360px is a broken layout. */}
              <p className="break-all text-sm font-medium text-foreground">
                {document.fileName}
              </p>
              <p className="tabular mt-0.5 text-xs text-muted-foreground">
                {(document.sizeBytes / 1024).toFixed(0)} KB ·{" "}
                {document.mimeType || "unknown type"}
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="lg"
            block
            onClick={() => {
              URL.revokeObjectURL(document.previewUrl);
              onDocument(null);
            }}
          >
            Choose a different file
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <FilePhotoButton
            label="Photograph the document"
            capture="environment"
            onFile={(image) => {
              setProblem(null);
              onDocument(image);
            }}
            onProblem={setProblem}
          />
          <FilePhotoButton
            label="Choose from this device"
            accept="image/*,application/pdf"
            onFile={(image) => {
              setProblem(null);
              onDocument(image);
            }}
            onProblem={setProblem}
          />
          <p className="text-center text-xs text-muted-foreground">
            JPG, PNG, HEIC or PDF, up to 10 MB.
          </p>
        </div>
      )}

      {problem ? (
        <p className="text-xs leading-relaxed text-destructive" role="alert">
          {problem}
        </p>
      ) : null}
    </div>
  );
}
