import "server-only";

import QRCode from "qrcode";

/**
 * Renders a QR code to an inline SVG string on the server.
 *
 * Doing this server-side keeps the QR library out of the client bundle: pages
 * generate the markup at build/request time and pass the string down to
 * presentational components.
 */
export async function generateQrSvg(value: string): Promise<string> {
  return QRCode.toString(value, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 0,
    width: 256,
    color: {
      dark: "#111111",
      light: "#00000000",
    },
  });
}

/** Generate several QR codes at once, keyed by an id. */
export async function generateQrSvgMap<K extends string>(
  entries: Array<{ key: K; value: string }>,
): Promise<Record<K, string>> {
  const svgs = await Promise.all(
    entries.map(async ({ key, value }) => [key, await generateQrSvg(value)] as const),
  );
  return Object.fromEntries(svgs) as Record<K, string>;
}
