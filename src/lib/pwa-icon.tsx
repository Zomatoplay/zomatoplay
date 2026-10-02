import { readFileSync } from "node:fs";
import path from "node:path";

import { ImageResponse } from "next/og";

/**
 * The app icon: the real product logo (`public/logo.jpeg`), resized to every
 * size the Apple home-screen icon and the PWA manifest need.
 *
 * ONE SOURCE IMAGE, EVERY SIZE
 * -----------------------------
 * Read once at module load and embedded as a data URI, rather than read per
 * request — these routes are prerendered at build (`generateStaticParams` /
 * `force-static`), so the file is read exactly once no matter how many
 * variants are generated from it.
 *
 * The artwork is already a complete, square app-icon design — a circular
 * frame with the mark centred inside a dark background that fills the
 * corners — so it is used exactly as supplied: scaled to each target size,
 * never cropped, stretched or recoloured. That is also why no extra inset is
 * added for the `maskable` variant: Android's own circular/squircle crop
 * trims the already-dark corners, which is what the artwork's circular
 * framing was drawn for.
 *
 * THIS REPLACED A GENERATED PLACEHOLDER
 * --------------------------------------
 * Every call here used to render a single white letter on a flat colour —
 * a stand-in from before the real logo existed. It was still live on the
 * install prompt, the iOS home-screen icon and every PWA manifest icon after
 * the real logo had already replaced it everywhere else (the browser tab,
 * the sign-in screens), so a device that installed the app showed one mark
 * on screen and a different one on its own home screen.
 */
const LOGO_PATH = path.join(process.cwd(), "public", "logo.jpeg");

const LOGO_DATA_URL = `data:image/jpeg;base64,${readFileSync(LOGO_PATH).toString("base64")}`;

export function renderAppIcon(
  size: number,
  // `maskable`/`rounded` are accepted for call-site compatibility; the
  // source artwork needs neither extra inset nor extra rounding (see above).
  options: { maskable?: boolean; rounded?: boolean } = {},
) {
  void options;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- Satori (next/og) renders its own <img>, not next/image. */}
        <img
          src={LOGO_DATA_URL}
          width={size}
          height={size}
          alt=""
          style={{ objectFit: "cover" }}
        />
      </div>
    ),
    { width: size, height: size },
  );
}
