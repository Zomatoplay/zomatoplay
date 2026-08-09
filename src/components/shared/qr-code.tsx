import { cn } from "@/lib/utils";

interface QrCodeProps {
  /** Pre-rendered SVG markup from `@/lib/qr` (generated on the server). */
  svg: string;
  /** Describes what the code encodes, for screen readers. */
  label: string;
  className?: string;
}

/**
 * Presentational QR frame. The SVG is generated server-side, so this component
 * ships no QR library to the browser.
 */
export function QrCode({ svg, label, className }: QrCodeProps) {
  return (
    <div
      className={cn(
        "mx-auto flex size-44 items-center justify-center rounded-2xl border border-border bg-white p-3",
        className,
      )}
      role="img"
      aria-label={label}
    >
      <div
        className="size-full [&>svg]:size-full"
        // The markup comes from our own server-side QR generator, not user input.
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </div>
  );
}
