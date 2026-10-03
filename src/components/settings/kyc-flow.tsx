"use client";

import { useRef, useState, useTransition } from "react";
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
import { genderLabel } from "@/lib/profile";
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
 * UPLOADS ARE OPTIONAL, AND THE SCREEN SAYS WHAT IS ON FILE
 * ---------------------------------------------------------
 * Required: the verified mobile number, the profile (name, gender, email —
 * shown from onboarding), date of birth, and the document type and last four
 * characters of its number. The document photo/PDF and the live photo are each
 * optional (`@/server/services/kyc-policy`). A file that IS chosen is
 * compressed on the device and uploaded to private storage before Submit, and
 * the screen never treats a selected file as an uploaded one. With no document
 * store configured the upload controls are hidden and the details still
 * submit. Submitting never verifies anybody: the status panel says "Phone
 * verified", "Profile complete" and the document's real state, and only a
 * reviewer's approval makes the account verified.
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
    description: "Your details and your identity document's type and number.",
    icon: User,
  },
  {
    id: "document",
    title: "Document photo (optional)",
    description: "A photo or PDF of your ID — Aadhaar, PAN, passport or driving licence. You can skip this.",
    icon: IdCard,
  },
  {
    id: "selfie",
    title: "Live photo (optional)",
    description:
      "A photo of your face, taken now, so a reviewer can compare it with your document. You can skip this.",
    icon: Camera,
  },
] as const;

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
  /** What the latest submission carried — shown, never implied. */
  submittedFiles = null,
  /**
   * Where attached files go, decided server-side (`kycUploadModeFor`).
   * `unavailable` hides the attach controls rather than offering a button
   * that cannot work — declared details still submit.
   */
  uploadMode = "unavailable",
}: {
  reviewerNote?: string | null;
  uploadMode?: KycUploadMode;
  submittedFiles?: { hasDocument: boolean; hasSelfie: boolean } | null;
} = {}) {
  const canAttach = uploadMode !== "unavailable";
  /**
   * Keys of files already accepted by storage, by preview URL. A submission
   * that fails after its uploads succeeded (a dropped connection, a server
   * refusal) is retried without sending the same photos again.
   */
  const uploaded = useRef(new Map<string, string>());
  // Status only. The store is a cache of what the database said at render
  // time; it cannot change a verification state, and nothing here asks it to.
  const { kycStatus, profile } = usePrototypeStore();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [step, setStep] = useState(0);
  const [fullName, setFullName] = useState(profile.fullName);
  const [dob, setDob] = useState("");
  const [documentType, setDocumentType] = useState<DocumentType>("aadhaar");
  const [documentNumber, setDocumentNumber] = useState("");
  const [document, setDocument] = useState<CapturedImage | null>(null);
  const [selfie, setSelfie] = useState<CapturedImage | null>(null);
  /** Upload progress, 0–1 per file, while the photos are being sent. */
  const [progress, setProgress] = useState<{ document: number; selfie: number } | null>(null);
  const uploading = progress !== null;

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
          <h2 className="mt-4 text-lg font-semibold">Verification approved</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            Our verification team approved your account. Investing and
            withdrawals are available.
          </p>
        </Card>
        <VerificationStatus
          phoneVerified={profile.phoneVerified}
          profileComplete
          document={submittedFiles?.hasDocument ? "verified" : "not_provided"}
        />
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
            We have received your details. Our team reviews each submission by
            hand, and the result appears here.
          </p>
        </Card>

        <VerificationStatus
          phoneVerified={profile.phoneVerified}
          profileComplete
          document={submittedFiles?.hasDocument ? "pending" : "not_provided"}
          livePhoto={submittedFiles ? (submittedFiles.hasSelfie ? "pending" : "not_provided") : undefined}
        />
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /* Interactive steps                                                 */
  /* ---------------------------------------------------------------- */
  /*
   * What each step needs before it can be left: the details (name, date of
   * birth, document type and number, and a verified mobile number) — the two
   * photo steps are optional. The server checks all of it again.
   */
  const detailsOk =
    profile.phoneVerified &&
    fullName.trim().length > 2 &&
    dob.trim() !== "" &&
    lastFour(documentNumber).length === 4;
  const canContinue = step === 0 ? detailsOk : true;

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

    if (!detailsOk || pending || uploading) return;

    startTransition(async () => {
      /*
       * Both photos go up first, and the submission happens only once storage
       * has accepted both. A submission written before its uploads landed
       * would be a case pointing at nothing, which a reviewer cannot progress.
       */
      let documentPath: string | undefined;
      let selfiePath: string | undefined;
      const send = async (image: CapturedImage, kind: "document" | "selfie") => {
        const done = uploaded.current.get(image.previewUrl);
        if (done) {
          setProgress((current) => (current ? { ...current, [kind]: 1 } : current));
          return done;
        }
        const key = await uploadKycFile(image, kind, uploadMode, (fraction) =>
          setProgress((current) => (current ? { ...current, [kind]: fraction } : current)),
        );
        uploaded.current.set(image.previewUrl, key);
        return key;
      };
      try {
        // Only what was chosen is uploaded; an absent file counts as done.
        setProgress({ document: document ? 0 : 1, selfie: selfie ? 0 : 1 });
        [documentPath, selfiePath] = await Promise.all([
          document && canAttach ? send(document, "document") : undefined,
          selfie && canAttach ? send(selfie, "selfie") : undefined,
        ]);
      } catch (error) {
        toast.error(
          error instanceof UploadError
            ? error.message
            : "Your photos could not be uploaded. Check your connection and try again.",
        );
        return;
      } finally {
        setProgress(null);
      }

      const result = await submitKycAction({
        legalName: fullName.trim(),
        dateOfBirth: dob,
        documentType,
        // The full number never leaves this component. The server builds the
        // mask, so there is no complete identity number in a request body, in a
        // server log, or in the database.
        documentNumberLast4: lastFour(documentNumber),
        ...(documentPath && document
          ? {
              documentFileName: document.fileName,
              documentByteSize: document.sizeBytes,
              documentMimeType: document.mimeType,
              documentPath,
            }
          : {}),
        ...(selfiePath && selfie ? { selfieFileName: selfie.fileName, selfiePath } : {}),
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
            <h2 className="text-base font-semibold">{STEPS[step].title}</h2>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              {STEPS[step].description}
            </p>
          </div>
        </div>

        {step === 0 ? (
          <div className="space-y-4">
            <dl className="divide-y divide-border rounded-xl border border-border px-4 text-sm">
              <div className="flex items-center justify-between gap-3 py-2.5">
                <dt className="text-muted-foreground">Mobile number</dt>
                <dd className="tabular text-right font-medium">
                  {profile.phoneVerified ? `${profile.phone} · verified` : "Not verified"}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3 py-2.5">
                <dt className="text-muted-foreground">Gender</dt>
                <dd className="text-right font-medium">{genderLabel(profile.gender) ?? "—"}</dd>
              </div>
              <div className="flex items-center justify-between gap-3 py-2.5">
                <dt className="shrink-0 text-muted-foreground">Email</dt>
                <dd className="min-w-0 break-all text-right font-medium">{profile.email || "—"}</dd>
              </div>
            </dl>
            {!profile.phoneVerified ? (
              <p className="rounded-xl border border-warning/40 bg-warning/8 p-3 text-xs leading-relaxed text-foreground" role="status">
                A verified mobile number is required. Sign in with your mobile
                number to verify it, then come back here.
              </p>
            ) : null}
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
            <DocumentDetails
              documentType={documentType}
              onDocumentType={setDocumentType}
              documentNumber={documentNumber}
              onDocumentNumber={setDocumentNumber}
            />
          </div>
        ) : !canAttach ? (
          <p
            className="rounded-xl border border-border bg-secondary/60 p-3.5 text-sm leading-relaxed text-muted-foreground"
            role="status"
          >
            Photo upload isn&rsquo;t available right now. This step is optional —
            continue without it and our team will review your details.
          </p>
        ) : step === 1 ? (
          <DocumentStep document={document} onDocument={setDocument} canAttach={canAttach} />
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
              A member of our verification team compares this photo with your
              document by hand. Take it in good light, facing the camera, with
              nothing covering your face.
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

      <p className="rounded-xl border border-border bg-secondary/60 p-3.5 text-xs leading-relaxed text-muted-foreground">
        <strong className="font-medium text-foreground">
          Your photos are uploaded to private storage.
        </strong>{" "}
        Only you and our verification team can open them — they have no public
        address and are reached through a short-lived link that expires. Your
        full document number is never sent; only its last four characters are.
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
            ? progress
              ? `Uploading… ${Math.round(((progress.document + progress.selfie) / 2) * 100)}%`
              : pending
                ? "Submitting…"
                : "Submit for review"
            : step > 0 && ((step === 1 && !document) || (step === 2 && !selfie))
              ? "Skip this step"
              : "Continue"}
        </Button>
        {step > 0 ? (
          <Button
            variant="ghost"
            size="lg"
            block
            disabled={pending || uploading}
            onClick={() => setStep(step - 1)}
          >
            Back
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function DocumentDetails({
  documentType,
  onDocumentType,
  documentNumber,
  onDocumentNumber,
}: {
  documentType: DocumentType;
  onDocumentType: (value: DocumentType) => void;
  documentNumber: string;
  onDocumentNumber: (value: string) => void;
}) {
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
    </div>
  );
}

function DocumentStep({
  document,
  onDocument,
  canAttach,
}: {
  canAttach: boolean;
  document: CapturedImage | null;
  onDocument: (value: CapturedImage | null) => void;
}) {
  const [problem, setProblem] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      {!canAttach ? null : document ? (
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
            kind="document"
            capture="environment"
            onFile={(image) => {
              setProblem(null);
              onDocument(image);
            }}
            onProblem={setProblem}
          />
          <FilePhotoButton
            label="Choose from this device"
            kind="document"
            accept="image/*,application/pdf"
            onFile={(image) => {
              setProblem(null);
              onDocument(image);
            }}
            onProblem={setProblem}
          />
          <p className="text-center text-xs text-muted-foreground">
            JPG, PNG, HEIC or PDF. Photos are resized on your device before
            upload; make sure all text is sharp and readable.
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

/* -------------------------------------------------------------------------- */

type FileState = "not_provided" | "pending" | "verified";

/**
 * What is actually established about this account — never more. "Phone
 * verified" is the OTP; "Profile complete" is onboarding; a document is
 * "pending" until a reviewer approves, and "not provided" when none was
 * uploaded. None of these alone makes the account verified.
 */
function VerificationStatus({
  phoneVerified,
  profileComplete,
  document,
  livePhoto,
}: {
  phoneVerified: boolean;
  profileComplete: boolean;
  document: FileState;
  livePhoto?: FileState;
}) {
  const label: Record<FileState, string> = {
    not_provided: "Not provided",
    pending: "Pending review",
    verified: "Verified",
  };
  const rows: { label: string; value: string; done: boolean }[] = [
    { label: "Phone", value: phoneVerified ? "Verified" : "Not verified", done: phoneVerified },
    { label: "Profile", value: profileComplete ? "Complete" : "Incomplete", done: profileComplete },
    { label: "Document", value: label[document], done: document === "verified" },
    ...(livePhoto ? [{ label: "Live photo", value: label[livePhoto], done: livePhoto === "verified" }] : []),
  ];
  return (
    <ul className="space-y-3 rounded-2xl border border-border bg-card p-5">
      {rows.map((row) => (
        <li key={row.label} className="flex items-center gap-3">
          <span
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-full",
              row.done ? "bg-brand text-brand-foreground" : "bg-secondary text-muted-foreground",
            )}
          >
            {row.done ? <Check className="size-3.5" aria-hidden /> : <Clock className="size-3.5" aria-hidden />}
          </span>
          <span className="flex-1 text-sm text-foreground">{row.label}</span>
          <span className="text-sm text-muted-foreground">{row.value}</span>
        </li>
      ))}
    </ul>
  );
}
