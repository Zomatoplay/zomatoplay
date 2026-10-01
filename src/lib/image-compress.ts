/**
 * Shrinking a KYC photo in the browser before it is uploaded.
 *
 * WHY HERE, AND WHY THESE NUMBERS
 * -------------------------------
 * A phone camera produces 3–8 MB at 12–50 megapixels. Sending that over a
 * mobile connection is slow, and a reviewer gains nothing from it: an ID card
 * is readable at 2400 px on its long edge, and a face at 1600 px. So the image
 * is decoded, scaled down (never up) and re-encoded as JPEG at quality 0.85,
 * which keeps printed text crisp while typically landing between 300 KB and
 * 1 MB. This runs on the device — no image service, no new dependency — using
 * the browser's own decoder and a canvas.
 *
 * WHAT IS NEVER TOUCHED
 * ---------------------
 * - PDFs: a scanned document is uploaded as the person chose it.
 * - Anything the browser cannot decode (HEIC outside Safari, say): the
 *   original is kept, and the server still checks its type and size.
 * - A result that would be *larger* than the original at the same size: the
 *   original wins. Re-encoding a small, already-compressed photo can grow it.
 *
 * The decision of *what* size and type is acceptable is not made here — it is
 * the server's (`@/server/services/kyc-policy`), applied to what storage
 * recorded. This module only makes the upload cheaper.
 */

export type KycImageKind = "document" | "selfie";

export const KYC_IMAGE_TARGETS: Record<KycImageKind, { maxEdge: number; quality: number }> = {
  document: { maxEdge: 2400, quality: 0.85 },
  selfie: { maxEdge: 1600, quality: 0.85 },
};

/** Types the browser may be able to decode and re-encode. */
const COMPRESSIBLE = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

/**
 * The dimensions an image should be scaled to so its longer edge is at most
 * `maxEdge`, preserving the aspect ratio and never enlarging it. Pure.
 */
export function fitWithin(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number; scaled: boolean } {
  if (!(width > 0 && height > 0 && maxEdge > 0)) {
    return { width: Math.max(0, Math.round(width)), height: Math.max(0, Math.round(height)), scaled: false };
  }
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height, scaled: false };
  const ratio = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
    scaled: true,
  };
}

/** A file name that matches the bytes: `aadhaar.HEIC` re-encoded is a `.jpg`. */
export function jpegFileName(original: string): string {
  const base = original.replace(/\.[A-Za-z0-9]{1,5}$/, "") || "photo";
  return `${base}.jpg`;
}

export interface PreparedImage {
  blob: Blob;
  contentType: string;
  fileName: string;
  /** False when the original was kept as it was. */
  compressed: boolean;
}

/**
 * The image to upload for `kind`: compressed when that helps, the original
 * otherwise. Never throws for an undecodable image — it returns the original.
 */
export async function prepareKycImage(
  source: Blob,
  fileName: string,
  kind: KycImageKind,
): Promise<PreparedImage> {
  const original: PreparedImage = {
    blob: source,
    contentType: source.type,
    fileName,
    compressed: false,
  };
  if (!COMPRESSIBLE.has(source.type) || typeof document === "undefined") return original;

  const target = KYC_IMAGE_TARGETS[kind];
  let bitmap: ImageBitmap | HTMLImageElement;
  try {
    bitmap = await decode(source);
  } catch {
    return original;
  }

  try {
    const size = fitWithin(bitmap.width, bitmap.height, target.maxEdge);
    // Already small and already a JPEG: re-encoding can only lose detail.
    if (!size.scaled && source.type === "image/jpeg") return original;

    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) return original;
    // White under a transparent PNG, or JPEG renders its transparency black.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, size.width, size.height);
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, size.width, size.height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", target.quality),
    );
    canvas.width = 0;
    canvas.height = 0;
    if (!blob || blob.size === 0) return original;
    if (!size.scaled && blob.size >= source.size) return original;

    return {
      blob,
      contentType: "image/jpeg",
      fileName: jpegFileName(fileName),
      compressed: true,
    };
  } finally {
    if ("close" in bitmap) bitmap.close();
  }
}

/**
 * Decodes with EXIF orientation applied, so a portrait phone photo stays
 * upright after it is redrawn. `createImageBitmap` first; an `<img>` where it
 * is missing or refuses the options (older Safari).
 */
async function decode(source: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(source, { imageOrientation: "from-image" });
    } catch {
      // Fall through to the element decoder.
    }
  }
  const url = URL.createObjectURL(source);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}
