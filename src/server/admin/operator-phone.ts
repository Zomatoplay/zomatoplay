/**
 * Which operator a verified phone sign-in may become — the rule, pure.
 *
 * The inputs are facts already established: the uid and number Firebase
 * verified, and the rows that match either. The phone on an operator row was
 * written by a master admin (or the bootstrap script) — an authorization that
 * "this number may become this operator" — which is why matching it is safe
 * here when matching a customer's self-typed number never is (§19.7).
 *
 *   uid already bound to an operator      → that operator, if its number is
 *                                            still the one being verified
 *   number provisioned, no uid bound yet  → bind this uid (first sign-in)
 *   number provisioned, a different uid   → refuse; never re-bind silently
 *   neither                               → not an operator
 *
 * Status is checked separately: a disabled operator is refused whatever the
 * phone says, and an invited one becomes active on its first verified sign-in.
 */

export interface OperatorPhoneRow {
  id: string;
  firebaseUid: string | null;
  phoneE164: string | null;
}

export type OperatorPhoneDecision =
  | { action: "use"; agentId: string }
  | { action: "bind"; agentId: string }
  | { action: "refuse"; reason: "not_operator" | "number_changed" | "bound_elsewhere" };

export function decideOperatorPhoneSignIn(input: {
  uid: string;
  phoneE164: string;
  byUid: OperatorPhoneRow | null;
  byPhone: OperatorPhoneRow | null;
}): OperatorPhoneDecision {
  if (input.byUid) {
    // The provisioned number was changed after this uid was bound: the change
    // also clears the binding, so reaching here means a stale race — refuse.
    if (input.byUid.phoneE164 !== input.phoneE164) {
      return { action: "refuse", reason: "number_changed" };
    }
    return { action: "use", agentId: input.byUid.id };
  }
  if (!input.byPhone) return { action: "refuse", reason: "not_operator" };
  if (input.byPhone.firebaseUid && input.byPhone.firebaseUid !== input.uid) {
    return { action: "refuse", reason: "bound_elsewhere" };
  }
  return { action: "bind", agentId: input.byPhone.id };
}

export const OPERATOR_REFUSAL_MESSAGES: Record<
  Extract<OperatorPhoneDecision, { action: "refuse" }>["reason"],
  string
> = {
  not_operator:
    "This mobile number is not registered for operator access. Ask a master admin to add it.",
  number_changed:
    "Your registered mobile number was changed. Sign in with the new number, or ask a master admin.",
  bound_elsewhere:
    "This mobile number is linked to a different sign-in. Ask a master admin to reset it.",
};
