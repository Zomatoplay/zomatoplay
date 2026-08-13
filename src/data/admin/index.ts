/**
 * Barrel for the Master CRM's mock data.
 *
 * Every module here is shaped like the payload a real admin API would return.
 * Import from the specific module when you only need one dataset; this barrel
 * exists for the store, which seeds from all of them.
 *
 * INTEGRATION POINT: each module carries its own note describing the endpoint
 * that replaces it.
 */

export * from "./agents";
export * from "./audit-logs";
export * from "./deposits";
export * from "./investments";
export * from "./kyc";
export * from "./metrics";
export * from "./notifications";
export * from "./plans";
export * from "./referrals";
export * from "./security";
export * from "./settings";
export * from "./users";
export * from "./withdrawals";
