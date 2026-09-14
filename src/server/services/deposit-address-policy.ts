import "server-only";

/**
 * When a deposit address may go back in the pool, and when it must not.
 *
 * WHY THIS IS ITS OWN MODULE
 * --------------------------
 * These are the numbers a release decision is made from, and every one of them
 * is a trade between two failures that both cost real money:
 *
 *   hold too long   →  the pool runs dry and the next customer cannot be given
 *                      an address at all (`PoolExhaustedError`, which is what
 *                      the mainnet pool was in on 2026-09-14: every address
 *                      retired, none available)
 *   release too soon →  a transfer from the previous holder lands after
 *                      somebody else has the address, and one person's deposit
 *                      is credited to another person's wallet
 *
 * The second is the unrecoverable one, so it is closed *structurally* rather
 * than by choosing a lucky number: attribution is by assignment interval
 * (`findOwnerOfAddressAt`), so a late transfer belongs to whoever held the
 * address at the transfer's own block time, and a transfer arriving while
 * nobody held it resolves to the operator queue instead of to a stranger.
 * These timings then sit on top of that as defence in depth rather than as the
 * only defence.
 *
 * Every value is overridable by environment, because a deployment with two
 * pool addresses and one with two hundred want different answers and neither
 * is a code change.
 */

function ms(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * How long an address with **no deposit activity at all** stays with the
 * account that was shown it.
 *
 * Ten minutes: long enough to open a wallet app, copy an address, and send —
 * which is the whole journey this window has to cover — and short enough that
 * a person who opened the screen out of curiosity is not holding a pool slot
 * for the rest of the week.
 *
 * It is measured from `assigned_at`, not from any browser activity. A timer in
 * a tab is not a source of truth: the tab closes, the laptop sleeps, and the
 * address would be held forever or released at random.
 */
export const IDLE_RELEASE_MS = ms("DEPOSIT_ADDRESS_IDLE_RELEASE_MS", 10 * 60_000);

/**
 * How long after the **last** deposit activity on an address it may be
 * released, once every deposit against it has reached a terminal state.
 *
 * Distinct from the idle window and necessarily longer. Somebody who has just
 * deposited is the most likely person in the system to deposit again in the
 * next few minutes — a second transfer, a top-up, the rest of an amount split
 * across two sends — and each of those would arrive at an address they were
 * shown. An hour covers that without holding the slot indefinitely.
 *
 * "Terminal" means `credited`, `failed` or `ignored`. A `pending`,
 * `confirming` or unattributed `confirmed` deposit blocks release outright, at
 * any age — see `assertNoUnresolvedDeposits`.
 */
export const SETTLED_RELEASE_MS = ms(
  "DEPOSIT_ADDRESS_SETTLED_RELEASE_MS",
  60 * 60_000,
);

/**
 * How long a released address is withheld from a **different** user.
 *
 * The previous holder may take it back immediately — that carries no
 * attribution risk whatsoever, and "I closed the tab and came back" is the
 * common case. Anybody else waits.
 *
 * Twenty-four hours, because that is the honest answer to "how late can a
 * transfer plausibly be": a person who copied an address, went to an exchange,
 * completed a withdrawal review and had it processed can easily be hours
 * behind. Inside the window, such a transfer matches no assignment interval
 * and surfaces in the operator queue, which is a slow correct answer rather
 * than a fast wrong one.
 *
 * **Lowering this trades safety for pool capacity.** The right way to buy
 * capacity is more addresses (`TRON_DEPOSIT_POOL_ADDRESSES`), which costs
 * nothing and risks nothing.
 */
export const REASSIGN_QUARANTINE_MS = ms(
  "DEPOSIT_ADDRESS_QUARANTINE_MS",
  24 * 60 * 60_000,
);

/** Why an assignment ended. Stored on the history row and in the audit entry. */
export type ReleaseReason =
  /** No deposit ever arrived and the idle window elapsed. */
  | "idle_timeout"
  /** Every deposit reached a terminal state and the settle window elapsed. */
  | "settled"
  /** An operator pressed Release. */
  | "operator"
  /** The address left rotation entirely. */
  | "retired";

export const RELEASE_REASON_LABELS: Record<ReleaseReason, string> = {
  idle_timeout: "no deposit arrived within the idle window",
  settled: "all deposits settled and the settle window elapsed",
  operator: "released by an operator",
  retired: "retired from rotation",
};
