/**
 * Presentation vocabulary for deposit matching — what an operator reads in the
 * unmatched queue. Words, not records (CLAUDE.md §4.3), so both the matcher
 * and the CRM's row mapper can use them without one importing the other.
 */

export type UnmatchedDepositReason =
  | "no_block_time"
  | "ambiguous_match"
  | "outside_request_window"
  | "legacy_address"
  | "no_matching_request";

export const unmatchedDepositReasonLabels: Record<UnmatchedDepositReason, string> = {
  no_block_time: "The chain reported no block time, so no request window can be checked.",
  ambiguous_match: "More than one deposit request matches this amount and time.",
  outside_request_window:
    "The amount matches a request, but the transfer arrived outside that request's time window.",
  legacy_address:
    "Sent to an address that is not the current deposit address (a retired or per-user pool address).",
  no_matching_request: "No deposit request quoted this exact amount at this address.",
};
