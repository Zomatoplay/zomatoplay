import "server-only";

/**
 * Whether a verification submission must carry documents.
 *
 * WHY THIS IS A SWITCH AND NOT A DELETED VALIDATION
 * -------------------------------------------------
 * Identity documents are going to be required. They are not required *yet* —
 * the upload path exists but is not in use on this deployment, and a flow that
 * refuses a submission for a missing file it never asked for is a flow nobody
 * can complete. The choice is therefore between deleting the requirement (and
 * having to rediscover and rewrite it later) and making it a policy the code
 * states in one place.
 *
 * One flag, read by the server action, the write service and the two screens
 * that describe what is needed. Turning it on is a one-line change and the
 * validation, the wording and the risk flag all move together.
 *
 * WHAT THIS DOES **NOT** RELAX, AT ANY SETTING
 * --------------------------------------------
 * - Authentication. The account still comes from the session.
 * - Identity fields. Legal name, date of birth, document type and the last four
 *   characters of the document number are required either way; they are what
 *   makes a case reviewable at all.
 * - Storage verification. A document that *is* supplied is still checked
 *   against the caller's own folder and re-read from Storage before any row
 *   claims it exists (`describeOwnUpload`). Optional means "may be absent",
 *   never "trusted when present".
 * - `liveness_check_passed`. Still false, still not a value the client can
 *   send (CLAUDE.md §23).
 *
 * WHAT AN ABSENT DOCUMENT LOOKS LIKE IN THE DATABASE
 * --------------------------------------------------
 * Nothing. No `kyc_documents` row is written, no placeholder filename, no
 * invented storage path. The reviewer sees a case with no documents attached
 * and a risk flag saying so, which is the truth. Fabricating a row would put a
 * claim in the table an operator approves from — the exact defect §23 records
 * for `liveness_check_passed`, and it is not worth repeating for a filename.
 */
export function areKycDocumentsRequired(): boolean {
  return process.env.KYC_REQUIRE_DOCUMENTS === "true";
}

/**
 * The risk flag a submission carries when it arrives with nothing to look at.
 *
 * `riskFlags` is described in the schema as "automated signals a provider would
 * return", and the CRM renders them and refuses to recommend approval while any
 * is present. "There are no documents on this case" is exactly such a signal,
 * and it belongs next to `liveness_not_verified` rather than being left for a
 * reviewer to notice from an empty list.
 */
export const DOCUMENTS_NOT_PROVIDED = "documents_not_provided";
