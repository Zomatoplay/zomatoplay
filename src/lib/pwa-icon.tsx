import { ImageResponse } from "next/og";

/**
 * The app icon, drawn from the same mark the sidebar uses — a white "N" on
 * the brand teal — so the home-screen icon and the product agree.
 *
 * Generated rather than committed as binaries: one definition, every size, and
 * no PNG that silently drifts from the brand token. The hex values are the
 * sRGB conversions of `--brand` and `--brand-foreground` (light) in
 * `globals.css`; ImageResponse cannot read CSS variables.
 *
 * `maskable` keeps the letter inside the central 80% safe zone and bleeds the
 * colour to the edge, because Android crops maskable icons to its own shape.
 */
const BRAND = "#46887a";
const ON_BRAND = "#fbfcfd";

export function renderAppIcon(size: number, options: { maskable?: boolean; rounded?: boolean } = {}) {
  const radius = options.maskable ? 0 : options.rounded ? Math.round(size * 0.22) : 0;
  const glyph = Math.round(size * (options.maskable ? 0.42 : 0.56));

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: BRAND,
          borderRadius: radius,
          color: ON_BRAND,
          fontSize: glyph,
          fontWeight: 700,
          letterSpacing: -glyph * 0.04,
        }}
      >
        N
      </div>
    ),
    { width: size, height: size },
  );
}
