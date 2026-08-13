"use client";

import { useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  FileText,
  MessageSquarePlus,
  RotateCcw,
  ScanFace,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { AdminStatusBadge } from "@/components/admin/shared/admin-status-badge";
import { ConfirmActionDialog } from "@/components/admin/shared/confirm-action-dialog";
import {
  DetailCard,
  DetailList,
  DetailRow,
} from "@/components/admin/shared/detail-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { kycRejectionReasons } from "@/data/admin/kyc";
import { canManage } from "@/lib/admin-permissions";
import { useAdminStore } from "@/lib/admin-store";
import { cn } from "@/lib/utils";
import type { KycDocumentType, KycSubmission } from "@/types/admin";
import { formatDate, formatDateTime } from "@/utils/format";

/**
 * A single KYC case: declared details, documents, automated flags, reviewer
 * notes and the decision controls.
 *
 * Used by both the review queue and the user detail page, so a decision taken
 * from either place goes through exactly the same confirmation and writes the
 * same audit entry.
 */

const DOCUMENT_TYPE_LABELS: Record<KycDocumentType, string> = {
  passport: "Passport",
  national_id: "National ID",
  driving_licence: "Driving licence",
};

type PendingDecision = "approve" | "reject" | "resubmit" | "note";

export function KycCasePanel({
  submission,
  /** Show a link through to the user's profile. Off when already on it. */
  showUserLink = true,
  className,
}: {
  submission: KycSubmission;
  showUserLink?: boolean;
  className?: string;
}) {
  const store = useAdminStore();
  const [pending, setPending] = useState<PendingDecision | null>(null);
  const allowed = canManage(store.session, "kyc");

  const decided =
    submission.status === "approved" || submission.status === "rejected";

  return (
    <div className={cn("space-y-3", className)}>
      <DetailCard
        title="Verification details"
        description={`Submitted ${formatDateTime(submission.submittedAt)}`}
        actions={<AdminStatusBadge kind="kyc" status={submission.status} />}
      >
        <DetailList>
          <DetailRow label="Case ID">
            <span className="tabular">{submission.id}</span>
          </DetailRow>
          <DetailRow label="User">
            {showUserLink ? (
              <Link
                href={`/admin/users/${submission.userId}`}
                className="rounded text-brand transition-colors hover:text-brand/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {submission.userName} · {submission.userDisplayId}
              </Link>
            ) : (
              <>
                {submission.userName} · {submission.userDisplayId}
              </>
            )}
          </DetailRow>
          <DetailRow label="Legal name">{submission.details.legalName}</DetailRow>
          <DetailRow label="Date of birth">
            <span className="tabular">{submission.details.dateOfBirth}</span>
          </DetailRow>
          <DetailRow label="Nationality">
            {submission.details.nationality}
          </DetailRow>
          <DetailRow label="Document type">
            {DOCUMENT_TYPE_LABELS[submission.details.documentType]}
          </DetailRow>
          <DetailRow label="Document number">
            <span className="tabular">
              {submission.details.documentNumberMasked}
            </span>
          </DetailRow>
          <DetailRow label="Liveness check">
            <span
              className={cn(
                "inline-flex items-center gap-1.5",
                submission.livenessCheckPassed
                  ? "text-positive"
                  : "text-destructive",
              )}
            >
              <ScanFace className="size-3.5" aria-hidden />
              {submission.livenessCheckPassed ? "Passed" : "Not passed"}
            </span>
          </DetailRow>
          <DetailRow label="Residential address" wide>
            {submission.details.address}
          </DetailRow>
          <DetailRow label="Reviewer">
            {submission.reviewedBy ?? (
              <span className="font-normal text-muted-foreground">
                Not yet assigned
              </span>
            )}
          </DetailRow>
          <DetailRow label="Reviewed">
            {submission.reviewedAt ? (
              <span className="tabular">{formatDate(submission.reviewedAt)}</span>
            ) : (
              <span className="font-normal text-muted-foreground">—</span>
            )}
          </DetailRow>
          {submission.rejectionReason ? (
            <DetailRow label="Rejection reason" wide>
              <span className="font-normal text-destructive">
                {submission.rejectionReason}
              </span>
            </DetailRow>
          ) : null}
        </DetailList>

        {submission.riskFlags.length > 0 ? (
          <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-warning/30 bg-warning/8 p-3">
            <TriangleAlert
              className="size-4 shrink-0 text-warning"
              aria-hidden
            />
            <span className="text-xs font-medium text-foreground">
              Automated checks flagged:
            </span>
            {submission.riskFlags.map((flag) => (
              <Badge key={flag} variant="warning">
                {flag}
              </Badge>
            ))}
          </div>
        ) : null}
      </DetailCard>

      <DetailCard
        title="Documents"
        description="Prototype build — document files are references only and cannot be opened."
      >
        <ul className="grid gap-2 sm:grid-cols-2">
          {submission.documents.map((document) => (
            <li
              key={document.id}
              className="flex items-start gap-3 rounded-xl border border-border p-3"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
                <FileText className="size-4" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">
                  {document.label}
                </span>
                <span className="block truncate font-mono text-xs text-muted-foreground">
                  {document.fileName}
                </span>
                <span className="tabular mt-0.5 block text-xs text-muted-foreground">
                  {document.pages} {document.pages === 1 ? "page" : "pages"} ·{" "}
                  {formatDate(document.uploadedAt)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </DetailCard>

      <DetailCard
        title="Internal notes"
        description="Visible to administrators only. Never shown to the user."
        actions={
          <Button
            variant="outline"
            size="sm"
            disabled={!allowed}
            onClick={() => setPending("note")}
          >
            <MessageSquarePlus className="size-4" />
            Add note
          </Button>
        }
      >
        {submission.notes.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">
            No notes on this case.
          </p>
        ) : (
          <ul className="space-y-3">
            {submission.notes.map((note) => (
              <li key={note.id} className="rounded-xl border border-border p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <span className="text-sm font-medium">{note.author}</span>
                  <time
                    dateTime={note.createdAt}
                    className="tabular text-xs text-muted-foreground"
                  >
                    {formatDateTime(note.createdAt)}
                  </time>
                </div>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  {note.body}
                </p>
              </li>
            ))}
          </ul>
        )}
      </DetailCard>

      <DetailCard title="Decision">
        {!allowed ? (
          <p className="text-sm text-muted-foreground">
            Your role has view-only access to KYC. Approving, rejecting and
            requesting resubmission are unavailable.
          </p>
        ) : (
          <>
            {decided ? (
              <p className="mb-3 text-sm text-muted-foreground">
                This case has already been decided. Recording a new decision
                overwrites the previous one and is written to the audit log.
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button variant="brand" onClick={() => setPending("approve")}>
                <CheckCircle2 className="size-4" />
                Approve
              </Button>
              <Button variant="outline" onClick={() => setPending("resubmit")}>
                <RotateCcw className="size-4" />
                Request resubmission
              </Button>
              <Button variant="destructive" onClick={() => setPending("reject")}>
                <XCircle className="size-4" />
                Reject
              </Button>
            </div>
          </>
        )}
      </DetailCard>

      <ConfirmActionDialog
        open={pending === "approve"}
        onOpenChange={(open) => !open && setPending(null)}
        title="Approve this verification?"
        description={
          <>
            <strong className="font-medium text-foreground">
              {submission.userName}
            </strong>{" "}
            ({submission.userDisplayId}) will be marked verified and can invest
            and withdraw immediately.
          </>
        }
        confirmLabel="Approve verification"
        reason={{ label: "Note", placeholder: "Anything worth recording?" }}
        onConfirm={(note) => {
          store.approveKyc(submission.id, note);
          toast.success(`${submission.userName} is now verified`);
        }}
      >
        {!submission.livenessCheckPassed || submission.riskFlags.length > 0 ? (
          <div className="flex items-start gap-2.5 rounded-xl border border-warning/30 bg-warning/8 p-3">
            <TriangleAlert
              className="mt-0.5 size-4 shrink-0 text-warning"
              aria-hidden
            />
            <p className="text-xs leading-relaxed text-muted-foreground">
              This case has unresolved automated flags
              {submission.livenessCheckPassed
                ? ""
                : ", and the liveness check did not pass"}
              . Approving it overrides those checks.
            </p>
          </div>
        ) : null}
      </ConfirmActionDialog>

      <ConfirmActionDialog
        open={pending === "reject"}
        onOpenChange={(open) => !open && setPending(null)}
        title="Reject this verification?"
        description={
          <>
            <strong className="font-medium text-foreground">
              {submission.userName}
            </strong>{" "}
            will be told their verification was unsuccessful, and will not be
            able to invest or withdraw. The reason you give is shown to them.
          </>
        }
        confirmLabel="Reject verification"
        destructive
        reason={{
          label: "Reason for rejection",
          required: true,
          placeholder: "Explain what was wrong with the submission…",
          presets: kycRejectionReasons,
        }}
        onConfirm={(reason) => {
          store.rejectKyc(submission.id, reason);
          toast.success("Verification rejected");
        }}
      />

      <ConfirmActionDialog
        open={pending === "resubmit"}
        onOpenChange={(open) => !open && setPending(null)}
        title="Request a resubmission?"
        description={
          <>
            <strong className="font-medium text-foreground">
              {submission.userName}
            </strong>{" "}
            will be asked to submit their documents again. Their account returns
            to in-progress rather than being rejected.
          </>
        }
        confirmLabel="Request resubmission"
        reason={{
          label: "What does the user need to fix?",
          required: true,
          presets: [
            "Upload both sides of the document.",
            "Complete the liveness check.",
            "Provide a clearer photograph of the document.",
            "Provide a document that has not expired.",
          ],
        }}
        onConfirm={(reason) => {
          store.requestKycResubmission(submission.id, reason);
          toast.success("Resubmission requested");
        }}
      />

      <ConfirmActionDialog
        open={pending === "note"}
        onOpenChange={(open) => !open && setPending(null)}
        title="Add an internal note"
        description="Notes are visible to administrators only and are recorded against this case."
        confirmLabel="Add note"
        reason={{
          label: "Note",
          required: true,
          placeholder: "What should the next reviewer know?",
        }}
        onConfirm={(body) => {
          store.addKycNote(submission.id, body);
          toast.success("Note added");
        }}
      />
    </div>
  );
}
