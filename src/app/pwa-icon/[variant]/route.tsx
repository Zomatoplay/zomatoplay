import { renderAppIcon } from "@/lib/pwa-icon";

/**
 * `/pwa-icon/192`, `/pwa-icon/512`, `/pwa-icon/maskable-512` — the manifest's
 * icons. Prerendered at build (`generateStaticParams`), so no request ever
 * renders one, and served as immutable static files.
 */
const VARIANTS = {
  "192": { size: 192, maskable: false },
  "512": { size: 512, maskable: false },
  "maskable-512": { size: 512, maskable: true },
} as const;

export const dynamic = "force-static";

export function generateStaticParams() {
  return Object.keys(VARIANTS).map((variant) => ({ variant }));
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ variant: string }> },
) {
  const { variant } = await params;
  const spec = VARIANTS[variant as keyof typeof VARIANTS];
  if (!spec) return new Response("Not found", { status: 404 });
  return renderAppIcon(spec.size, { maskable: spec.maskable, rounded: false });
}
