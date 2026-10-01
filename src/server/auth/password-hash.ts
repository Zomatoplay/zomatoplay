import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

/**
 * Hashing the one secret this application stores itself: a customer's
 * withdrawal password (`withdrawal_passwords`). Sign-in credentials are never
 * here — they belong to Firebase and Supabase.
 *
 * WHY SCRYPT
 * ----------
 * Memory-hard and built into Node, so no native dependency (bcrypt) and no new
 * package. N = 2^15, r = 8, p = 1 is the commonly recommended interactive
 * setting: ~32 MiB and tens of milliseconds per attempt, which makes an
 * offline guess against a stolen table expensive while a person waiting on
 * "Confirm withdrawal" never notices.
 *
 * THE STORED FORMAT CARRIES ITS OWN PARAMETERS
 * --------------------------------------------
 * `scrypt$N$r$p$salt$hash` (base64url). Raising the cost later only changes
 * new hashes; old ones still verify with the parameters they were made with.
 * Every hash has its own 16-byte random salt, so equal passwords never produce
 * equal rows.
 *
 * Pure apart from the CSPRNG; tested in `password-hash.test.ts`.
 */

const N = 2 ** 15;
const R = 8;
const P = 1;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
/** scrypt needs 128·N·r bytes; Node's default ceiling (32 MiB) is exactly that, so leave room. */
const MAX_MEMORY = 64 * 1024 * 1024;

function derive(password: string, salt: Buffer, options: ScryptOptions, length: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize("NFKC"), salt, length, options, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await derive(password, salt, { N, r: R, p: P, maxmem: MAX_MEMORY }, KEY_LENGTH);
  return ["scrypt", N, R, P, salt.toString("base64url"), key.toString("base64url")].join("$");
}

/**
 * Whether `password` matches `stored`. False — never a throw — for a malformed
 * or tampered hash, so a corrupt row refuses rather than crashes.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = typeof stored === "string" ? stored.split("$") : [];
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, nText, rText, pText, saltText, keyText] = parts;
  const n = Number(nText);
  const r = Number(rText);
  const p = Number(pText);
  // Bounded, so a tampered row cannot ask for gigabytes of memory.
  if (![n, r, p].every(Number.isInteger)) return false;
  if (n < 2 ** 10 || n > 2 ** 20 || (n & (n - 1)) !== 0 || r < 1 || r > 32 || p < 1 || p > 4) {
    return false;
  }
  const salt = Buffer.from(saltText, "base64url");
  const expected = Buffer.from(keyText, "base64url");
  if (salt.length < 8 || expected.length < 16 || expected.length > 64) return false;

  let actual: Buffer;
  try {
    actual = await derive(password, salt, { N: n, r, p, maxmem: Math.max(MAX_MEMORY, 256 * n * r) }, expected.length);
  } catch {
    return false;
  }
  return timingSafeEqual(actual, expected);
}
