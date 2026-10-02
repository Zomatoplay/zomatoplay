import { FxRatesProvider } from "@/components/shared/fx-rates-provider";
import { DEFAULT_PLATFORM_FINANCE, type PlatformFinance } from "@/lib/platform-finance";
import { applyPlatformRates } from "@/server/services/catalogue.service";

/** Longest the rates may hold the content back before the initial ones are used. */
const RATES_DEADLINE_MS = 2000;

/**
 * Resolves the administrator's rates before anything below formats an INR
 * figure, on the server (module setting) and in the browser (provider). Render
 * it inside a `Suspense` so the shell paints first; the read is cached across
 * requests, so this is normally instant.
 *
 * A slow or failed read never breaks a page: after `RATES_DEADLINE_MS` or on an
 * error the initial rates apply. The failure is not cached, so the next request
 * retries.
 */
export async function RatesBoundary({ children }: { children: React.ReactNode }) {
  let finance: PlatformFinance = DEFAULT_PLATFORM_FINANCE;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    finance = await Promise.race([
      applyPlatformRates(),
      new Promise<PlatformFinance>((resolve) => {
        timer = setTimeout(() => resolve(DEFAULT_PLATFORM_FINANCE), RATES_DEADLINE_MS);
      }),
    ]);
  } catch {
    // Initial rates stand; the infrastructure fault is recorded where it happens.
  } finally {
    clearTimeout(timer);
  }
  return (
    <FxRatesProvider
      depositRate={finance.depositRate}
      withdrawalRate={finance.withdrawalRate}
      label={finance.rateLabel}
    >
      {children}
    </FxRatesProvider>
  );
}
