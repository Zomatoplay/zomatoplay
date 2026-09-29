import "server-only";

import { headers } from "next/headers";

import { readCustomerSessionSecret } from "./customer-session";
import {
  devTestGateOpen,
  readDevTestCustomer,
  readDevTestOperator,
  type DevTestCustomer,
  type DevTestOperator,
} from "./dev-test-auth";

/**
 * The request side of the local test sign-in (`dev-test-auth.ts` holds the
 * policy and explains it). Every entry point — the pages that offer it and the
 * actions that perform it — asks here, per request.
 *
 * `process.env.NODE_ENV` is written out literally in each function so Next
 * inlines it: in a production build the first line is `if (true) return null`
 * and nothing after it survives.
 */

async function gateOpen(): Promise<boolean> {
  if (process.env.NODE_ENV !== "development") return false;
  // The challenge is signed with the session secret; without it nothing works.
  if (!readCustomerSessionSecret()) return false;
  const requestHeaders = await headers();
  return devTestGateOpen({
    nodeEnv: process.env.NODE_ENV,
    flag: process.env.DEV_TEST_AUTH,
    host: requestHeaders.get("host"),
    forwardedHost: requestHeaders.get("x-forwarded-host"),
  });
}

/** The local test customer for this request, or null — always null in production. */
export async function localTestCustomer(): Promise<DevTestCustomer | null> {
  if (process.env.NODE_ENV !== "development") return null;
  if (!(await gateOpen())) return null;
  return readDevTestCustomer(process.env);
}

/** The local test operator for this request, or null — always null in production. */
export async function localTestOperator(): Promise<DevTestOperator | null> {
  if (process.env.NODE_ENV !== "development") return null;
  if (!(await gateOpen())) return null;
  return readDevTestOperator(process.env);
}
