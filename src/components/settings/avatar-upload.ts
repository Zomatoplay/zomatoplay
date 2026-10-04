"use client";

import { requestAvatarUploadAction } from "@/app/(auth)/complete-profile/actions";
import { prepareKycImage } from "@/lib/image-compress";

export const AVATAR_ACCEPT = "image/jpeg,image/png,image/webp";

/**
 * Resizes a chosen photo on the device, asks the server for a 5-minute
 * upload slot in the account's own `avatars/` prefix, and PUTs it to private
 * S3. Resolves with the key and a local preview, or a message to show — the
 * caller then hands the key to the server, which checks what landed.
 * Shared by onboarding and Edit profile.
 */
export async function uploadAvatarFile(
  file: File,
): Promise<{ ok: true; key: string; previewUrl: string } | { ok: false; message: string }> {
  try {
    const prepared = await prepareKycImage(file, file.name, "selfie");
    const target = await requestAvatarUploadAction({
      contentType: prepared.contentType,
      byteSize: prepared.blob.size,
    });
    if (!target.ok) return { ok: false, message: target.message };
    const response = await fetch(target.url, {
      method: "PUT",
      headers: target.headers,
      body: prepared.blob,
    });
    if (!response.ok) return { ok: false, message: "The photo could not be uploaded. Try again." };
    return { ok: true, key: target.key, previewUrl: URL.createObjectURL(prepared.blob) };
  } catch {
    return { ok: false, message: "The photo could not be uploaded. Try again." };
  }
}
