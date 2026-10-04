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
  FolderOpen,
  ShieldCheck,
  TriangleAlert,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePrototypeStore } from "@/lib/prototype-store";
import {
  dateOfBirthRefusal,
  documentNumberRefusal,
  KYC_DOCUMENT_TYPES,
  latestAdultBirthDate,
  type KycDocumentType,
} from "@/lib/kyc-identity";
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
 * Identity verification: details → document photo (optional) → live photo
 * (optional) → review.
 *
 * WHAT IS TRUE HERE
 * -----------------
 * - Name, date of birth (18+), document type and number are required and
 *   checked on this screen and again by the server with the same rules
 *   (`@/lib/kyc-identity`). Only the masked number is stored.
 * - Mobile, gender and email are NOT asked again: they are the profile's, set
 *   at onboarding. A verified mobile number is still required, and the screen
 *   says so only when it is missing.
 * - The two photos are optional. A file that IS chosen is uploaded to private
 *   storage before Submit, and the screen never treats a selected file as an
 *   uploaded one. With no document store configured the photo steps are not
 *   shown at all, rather than shown as unavailable.
 * - `livenessCheckPassed` is not a value this component can send. Nothing in
 *   this deployment performs an automated liveness check.
 * - Submitting never verifies anybody. Only a reviewer's approval does.
 *
 * Every failure ends in a message; an unexpected one carries the reference
 * that finds the real error in the CRM's system log.
 */

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
  const [documentType, setDocumentType] = useState<KycDocumentType>("aadhaar");
  const [documentNumber, setDocumentNumber] = useState("");
  const [document, setDocument] = useState<CapturedImage | null>(null);
  const [selfie, setSelfie] = useState<CapturedImage | null>(null);
  /** Errors show after a Continue attempt, or once a field has been left. */
  const [touched, setTouched] = useState(false);
  const [dobTouched, setDobTouched] = useState(false);
  const [numberTouched, setNumberTouched] = useState(false);
  // The picker's upper bound only; the server applies the same rule.
  const [maxBirthDate] = useState(() => latestAdultBirthDate());
  const documentSpec =
    KYC_DOCUMENT_TYPES.find((option) => option.id === documentType) ?? KYC_DOCUMENT_TYPES[0];
  /** Upload progress, 0–1 per file, while the photos are being sent. */
  const [progress, setProgress] = useState<{ document: number; selfie: number } | null>(null);
  const uploading = progress !== null;

  /* ---------------------------------------------------------------- */
  /* Terminal states                                                   */
  /* ---------------------------------------------------------------- */
  if (kycStatus === "verified") {
    return (
      <div className="space-y-5">
        <Card className="p-5 text-center">
          <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-brand-soft text-brand">
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
        <Card className="p-5 text-center">
          <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-info/10 text-info">
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
  const steps = canAttach
    ? (["details", "document", "selfie"] as const)
    : (["details"] as const);
  const current = steps[step] ?? "details";
  const isLast = step === steps.length - 1;

  const dobRefusal = dateOfBirthRefusal(dob);
  const numberRefusal = documentNumberRefusal(documentType, documentNumber);
  const showNumberError =
    numberRefusal !== null && (touched || (numberTouched && documentNumber.length > 0));
  const detailsOk =
    profile.phoneVerified &&
    fullName.trim().length >= 2 &&
    dobRefusal === null &&
    numberRefusal === null;

  function next() {
    if (current === "details") {
      setTouched(true);
      if (!detailsOk) return;
      if (kycStatus === "not_started") {
        // Fire-and-forget: it only moves not_started → in_progress.
        void startKycAction().catch(() => {});
      }
    }
    if (!isLast) {
      setStep(step + 1);
      return;
    }
    submit();
  }

  function submit() {
    if (!detailsOk || pending || uploading) return;

    startTransition(async () => {
      /*
       * Chosen photos go up first; the submission happens only once storage
       * has accepted them. A failed upload stops here with its own message —
       * the details are not lost, and removing the photo lets them submit.
       */
      let documentPath: string | undefined;
      let selfiePath: string | undefined;
      const send = async (image: CapturedImage, kind: "document" | "selfie") => {
        const done = uploaded.current.get(image.previewUrl);
        if (done) {
          setProgress((value) => (value ? { ...value, [kind]: 1 } : value));
          return done;
        }
        const key = await uploadKycFile(image, kind, uploadMode, (fraction) =>
          setProgress((value) => (value ? { ...value, [kind]: fraction } : value)),
        );
        uploaded.current.set(image.previewUrl, key);
        return key;
      };
      try {
        setProgress({ document: document ? 0 : 1, selfie: selfie ? 0 : 1 });
        [documentPath, selfiePath] = await Promise.all([
          document && canAttach ? send(document, "document") : undefined,
          selfie && canAttach ? send(selfie, "selfie") : undefined,
        ]);
      } catch (error) {
        toast.error(
          error instanceof UploadError
            ? error.message
            : "Your photo couldn't be uploaded. Try again, or remove it and submit without it.",
        );
        return;
      } finally {
        setProgress(null);
      }

      try {
        const result = await submitKycAction({
          legalName: fullName.trim(),
          dateOfBirth: dob,
          documentType,
          documentNumber,
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
          toast.error(
            result.reference ? `${result.message} Reference: ${result.reference}` : result.message,
          );
          return;
        }
      } catch {
        // The request itself failed — offline, or a page older than the
        // current release. Nothing was written.
        toast.error(
          "Unable to submit your verification right now. Refresh the page and try again.",
        );
        return;
      }

      toast.success("Submitted for review");
      // The status now lives in the database; re-read rather than assume.
      router.refresh();
    });
  }

  const optionalEmpty =
    (current === "document" && !document) || (current === "selfie" && !selfie);
  const primaryLabel = isLast
    ? progress
      ? `Uploading… ${Math.round(((progress.document + progress.selfie) / 2) * 100)}%`
      : pending
        ? "Submitting…"
        : current === "details"
          ? "Submit for review"
          : optionalEmpty
            ? "Skip and submit"
            : "Submit for review"
    : optionalEmpty
      ? "Skip"
      : "Continue";

  const titles = {
    details: "Personal details",
    document: "Document photo",
    selfie: "Live photo",
  } as const;

  return (
    <div className="space-y-4">
      {reviewerNote ? (
        <div className="flex items-start gap-2.5 rounded-xl border border-destructive/30 bg-destructive/5 p-3">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
          <div className="min-w-0 space-y-0.5">
            <p className="text-sm font-medium text-foreground">
              {kycStatus === "rejected"
                ? "Your last submission was not accepted"
                : "We need your details again"}
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">{reviewerNote}</p>
          </div>
        </div>
      ) : null}

      <Card className="space-y-4 p-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold">
              {titles[current]}
              {current === "details" ? null : (
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">Optional</span>
              )}
            </h2>
            {steps.length > 1 ? (
              <span className="tabular text-xs text-muted-foreground">
                {step + 1} / {steps.length}
              </span>
            ) : (
              <StatusBadge kind="kyc" status={kycStatus} />
            )}
          </div>
          {steps.length > 1 ? (
            <ol className="flex gap-1.5" aria-label={`Step ${step + 1} of ${steps.length}`}>
              {steps.map((id, index) => (
                <li
                  key={id}
                  className={cn("h-1 flex-1 rounded-full", index <= step ? "bg-brand" : "bg-secondary")}
                />
              ))}
            </ol>
          ) : null}
        </div>

        {current === "details" ? (
          <div className="space-y-3">
            {!profile.phoneVerified ? (
              <p className="rounded-xl border border-warning/40 bg-warning/8 p-3 text-xs leading-relaxed text-foreground" role="status">
                Sign in with your mobile number to verify it, then come back here.
              </p>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="kyc-name">Full legal name</Label>
              <Input
                id="kyc-name"
                autoComplete="name"
                placeholder="As shown on your ID"
                maxLength={120}
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                aria-invalid={touched && fullName.trim().length < 2 ? true : undefined}
              />
              {touched && fullName.trim().length < 2 ? (
                <p className="text-xs text-destructive">Enter your full legal name.</p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="kyc-dob">Date of birth</Label>
              <Input
                id="kyc-dob"
                type="date"
                autoComplete="bday"
                min="1900-01-01"
                max={maxBirthDate}
                value={dob}
                onChange={(event) => setDob(event.target.value)}
                onBlur={() => setDobTouched(true)}
                aria-invalid={(touched || dobTouched) && dobRefusal ? true : undefined}
                aria-describedby="kyc-dob-error"
              />
              {(touched || dobTouched) && dobRefusal ? (
                <p id="kyc-dob-error" className="text-xs text-destructive">
                  {dobRefusal}
                </p>
              ) : null}
            </div>
            <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="kyc-document-type">Document</Label>
                <select
                  id="kyc-document-type"
                  value={documentType}
                  onChange={(event) => {
                    setDocumentType(event.target.value as KycDocumentType);
                    setNumberTouched(false);
                  }}
                  className="h-11 w-full rounded-xl border border-input bg-background px-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:text-sm"
                >
                  {KYC_DOCUMENT_TYPES.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="kyc-document-number">Number</Label>
                <Input
                  id="kyc-document-number"
                  inputMode={documentSpec.inputMode}
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  maxLength={documentSpec.maxLength}
                  placeholder={documentSpec.placeholder}
                  value={documentNumber}
                  onChange={(event) => setDocumentNumber(event.target.value)}
                  onBlur={() => setNumberTouched(true)}
                  aria-invalid={showNumberError ? true : undefined}
                  aria-describedby="kyc-document-number-error"
                />
              </div>
            </div>
            {showNumberError ? (
              <p id="kyc-document-number-error" className="-mt-1 text-xs text-destructive">
                {numberRefusal}
              </p>
            ) : null}
          </div>
        ) : current === "document" ? (
          <DocumentStep document={document} onDocument={setDocument} />
        ) : (
          <div className="space-y-3">
            <p className="text-sm leading-relaxed text-muted-foreground">
              A clear photo of your face, taken now, in good light.
            </p>
            <SelfieCapture
              value={selfie}
              onCapture={setSelfie}
              onClear={() => setSelfie(null)}
            />
          </div>
        )}
      </Card>

      <div className="space-y-2">
        <Button
          variant="brand"
          size="lg"
          block
          disabled={pending || uploading || (current === "details" && !profile.phoneVerified)}
          onClick={next}
        >
          {primaryLabel}
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

      <p className="flex items-start gap-2 px-1 text-xs leading-relaxed text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-brand" aria-hidden />
        Your documents are used only to verify your identity and are handled under our privacy
        policy.
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function DocumentStep({
  document,
  onDocument,
}: {
  document: CapturedImage | null;
  onDocument: (value: CapturedImage | null) => void;
}) {
  const [problem, setProblem] = useState<string | null>(null);
  const choose = (image: CapturedImage) => {
    setProblem(null);
    onDocument(image);
  };

  return (
    <div className="space-y-3">
      <p className="text-sm leading-relaxed text-muted-foreground">
        A photo or scan of the document you entered, with every detail readable.
      </p>
      {document ? (
        <div className="flex items-center gap-3 rounded-xl border border-brand bg-brand-soft p-3">
          <FileCheck2 className="size-5 shrink-0 text-brand" aria-hidden />
          <p className="min-w-0 flex-1 break-all text-sm font-medium text-foreground">
            {document.fileName}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => {
              URL.revokeObjectURL(document.previewUrl);
              onDocument(null);
            }}
            aria-label="Remove this file"
          >
            <X className="size-4" aria-hidden />
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <FilePhotoButton
            label="Choose from this device"
            icon={FolderOpen}
            kind="document"
            accept="image/*,application/pdf"
            onFile={choose}
            onProblem={setProblem}
          />
          <FilePhotoButton
            label="Camera"
            icon={Camera}
            kind="document"
            capture="environment"
            onFile={choose}
            onProblem={setProblem}
          />
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
    <ul className="space-y-2.5 rounded-2xl border border-border bg-card p-4">
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
