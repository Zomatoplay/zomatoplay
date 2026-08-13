import { cn } from "@/lib/utils";

/**
 * Definition-list primitives for the CRM's detail panels.
 *
 * A record's field/value pairs are a definition list, so they are marked up as
 * one (`dl`/`dt`/`dd`) rather than as divs. Screen readers announce the pairing;
 * an operator scanning a KYC case gets the same structure visually.
 */

export function DetailList({
  children,
  className,
  /** Two columns from `sm` upward. Off for narrow side panels. */
  columns = true,
}: {
  children: React.ReactNode;
  className?: string;
  columns?: boolean;
}) {
  return (
    <dl
      className={cn(
        "divide-y divide-border",
        columns && "sm:grid sm:grid-cols-2 sm:gap-x-6 sm:divide-y-0",
        className,
      )}
    >
      {children}
    </dl>
  );
}

export function DetailRow({
  label,
  children,
  /** Span both columns — for long values such as an address. */
  wide = false,
  className,
}: {
  label: string;
  children: React.ReactNode;
  wide?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-4 py-2.5 sm:flex-col sm:justify-start sm:gap-1 sm:border-b sm:border-border",
        wide && "sm:col-span-2",
        className,
      )}
    >
      <dt className="shrink-0 text-xs text-muted-foreground sm:text-[11px] sm:font-medium sm:uppercase sm:tracking-wide">
        {label}
      </dt>
      <dd className="min-w-0 break-words text-right text-sm font-medium text-foreground sm:text-left">
        {children}
      </dd>
    </div>
  );
}

/** Card wrapper used around detail panels, so they all sit at the same radius. */
export function DetailCard({
  title,
  description,
  actions,
  children,
  className,
}: {
  title?: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn("rounded-2xl border border-border bg-card", className)}
    >
      {title || actions ? (
        <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-border px-4 py-3">
          <div className="min-w-0">
            {title ? (
              <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
            ) : null}
            {description ? (
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
          {actions ? (
            <div className="flex shrink-0 items-center gap-2">{actions}</div>
          ) : null}
        </header>
      ) : null}
      <div className="p-4">{children}</div>
    </section>
  );
}

/** Monospaced value for hashes, addresses and references. */
export function MonoValue({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("break-all font-mono text-xs", className)}>
      {children}
    </span>
  );
}
