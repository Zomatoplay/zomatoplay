"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, RotateCw, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { createKycUploadTargetAction } from "@/app/(app)/settings/kyc/actions";
import type { KycUploadMode } from "@/types";

/**
 * The device camera, opened for real.
 *
 * WHAT THIS REPLACED
 * ------------------
 * A `<button>` that set `selfieCaptured = true` and toasted "Liveness check
 * captured". Nothing opened, nothing was captured, and the submission recorded
 * `liveness_check_passed = true` — a claim in the database, read by an
 * operator, that no check had made. That is the specific thing this flow must
 * never do, so the boolean is gone from the client's control entirely; see
 * `kyc-flow`.
 *
 * WHY `getUserMedia` AND A FILE INPUT, NOT ONE OR THE OTHER
 * ---------------------------------------------------------
 * `navigator.mediaDevices` **does not exist on an insecure origin**. Browsers
 * expose it only over HTTPS and on `localhost`, so a phone visiting
 * `http://192.168.1.5:3000` — which is exactly how this app gets tested on a
 * real device — has no camera API at all and the live preview cannot work.
 * That is not a bug to fix in JavaScript; it is the platform's rule.
 *
 * `<input type="file" accept="image/*" capture="user">` has no such
 * restriction: it hands the request to the OS camera app, works on plain HTTP,
 * and is the only path on iOS in-app browsers that block `getUserMedia`
 * outright. So the live preview is the preferred path and the input is the
 * fallback, chosen by feature detection rather than by user agent.
 *
 * The stream is stopped on every exit path. A `MediaStreamTrack` left running
 * keeps the camera indicator lit after the sheet closes, which reads to a
 * person as an app still watching them.
 */

export interface CapturedImage {
  /** For preview only. Revoked when replaced or unmounted. */
  previewUrl: string;
  fileName: string;
  sizeBytes: number;
  mimeType: string;
}

type Phase = "idle" | "starting" | "live" | "denied" | "unsupported";

/** What a browser tells us, translated into what the person should do. */
function describeCameraError(error: unknown): {
  phase: Extract<Phase, "denied" | "unsupported">;
  message: string;
} {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return {
      phase: "denied",
      message:
        "Camera access was blocked. Allow it for this site in your browser settings, or use the photo option below.",
    };
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return {
      phase: "unsupported",
      message: "No front camera was found on this device.",
    };
  }
  if (name === "NotReadableError") {
    return {
      phase: "unsupported",
      message: "The camera is already in use by another app.",
    };
  }
  return {
    phase: "unsupported",
    message: "The camera could not be opened on this device.",
  };
}

export function SelfieCapture({
  value,
  onCapture,
  onClear,
}: {
  value: CapturedImage | null;
  onCapture: (image: CapturedImage) => void;
  onClear: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [problem, setProblem] = useState<string | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  // Stopped on unmount as well as on every deliberate exit: navigating away
  // mid-capture must not leave the camera running.
  useEffect(() => stop, [stop]);

  async function start() {
    setProblem(null);

    // Feature detection, not user-agent sniffing. `mediaDevices` is absent on
    // an insecure origin, which is the common case on a phone testing a LAN
    // address — see the note at the top of this file.
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setPhase("unsupported");
      setProblem(
        window.isSecureContext === false
          ? "Live camera preview needs a secure (https) connection. Use the photo option below."
          : "This browser does not support the live camera preview. Use the photo option below.",
      );
      return;
    }

    setPhase("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      setPhase("live");
      // Assigned after the state flip so the <video> element exists.
      queueMicrotask(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play().catch(() => {});
        }
      });
    } catch (error) {
      const described = describeCameraError(error);
      setPhase(described.phase);
      setProblem(described.message);
    }
  }

  function capture() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        stop();
        setPhase("idle");
        onCapture({
          previewUrl: URL.createObjectURL(blob),
          fileName: `selfie-${Date.now()}.jpg`,
          sizeBytes: blob.size,
          mimeType: blob.type || "image/jpeg",
        });
      },
      "image/jpeg",
      0.9,
    );
  }

  if (value) {
    return (
      <div className="space-y-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- an object URL
            for a blob the browser just created; there is nothing for the image
            optimiser to fetch or cache. */}
        <img
          src={value.previewUrl}
          alt="The selfie you captured"
          className="mx-auto max-h-64 w-full rounded-xl border border-border object-cover"
        />
        <Button
          type="button"
          variant="outline"
          size="lg"
          block
          onClick={() => {
            URL.revokeObjectURL(value.previewUrl);
            onClear();
          }}
        >
          <RotateCw className="size-4" aria-hidden />
          Retake
        </Button>
      </div>
    );
  }

  if (phase === "live") {
    return (
      <div className="space-y-3">
        <video
          ref={videoRef}
          // `playsInline` is not optional: without it iOS Safari takes the
          // video full-screen the moment it plays, which destroys the layout
          // and hides the capture button.
          playsInline
          muted
          autoPlay
          className="mx-auto max-h-72 w-full scale-x-[-1] rounded-xl border border-border bg-black object-cover"
        />
        <p className="text-center text-xs text-muted-foreground">
          Look straight at the camera in good light, then capture.
        </p>
        <div className="flex gap-2">
          <Button type="button" variant="brand" size="lg" className="flex-1" onClick={capture}>
            <Camera className="size-4" aria-hidden />
            Capture
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="lg"
            onClick={() => {
              stop();
              setPhase("idle");
            }}
            aria-label="Close the camera"
          >
            <X className="size-4" aria-hidden />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Button
        type="button"
        variant="brand"
        size="lg"
        block
        disabled={phase === "starting"}
        onClick={start}
      >
        <Camera className="size-4" aria-hidden />
        {phase === "starting" ? "Opening camera…" : "Open camera"}
      </Button>

      {problem ? (
        <p className="text-xs leading-relaxed text-muted-foreground" role="status">
          {problem}
        </p>
      ) : null}

      {/*
        Always offered, not only after a failure.

        On an in-app browser (Instagram, some Android WebViews) `getUserMedia`
        can be present and still never resolve, so a fallback reachable only
        from the error path is a fallback nobody reaches.
      */}
      <FilePhotoButton
        label="Take or choose a photo instead"
        capture="user"
        onFile={onCapture}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/** 10 MB, matching what the upload copy has always promised. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

/**
 * Whether a file is one this flow will accept, and why not when it is not.
 *
 * Checked on the type the browser reports rather than the extension: a `.jpg`
 * that is really a PDF is the shape of the problem, and a reviewer opening it
 * is the person who finds out.
 *
 * HEIC is accepted because it is what an iPhone produces by default. Nothing
 * here renders it — Safari can, other browsers cannot — so the preview may be
 * blank while the file is still perfectly valid, which is why the filename and
 * size are always shown as well.
 */
export function describeFileProblem(file: File): string | null {
  if (file.size > MAX_IMAGE_BYTES) {
    return `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 10 MB.`;
  }
  if (file.size === 0) return "That file is empty.";
  if (!file.type.startsWith("image/") && file.type !== "application/pdf") {
    return "Choose an image (JPG, PNG or HEIC) or a PDF.";
  }
  return null;
}

/**
 * A file input dressed as a button.
 *
 * `capture` is a *hint*, not a mode: with it, a phone opens the camera
 * directly; without it, and on a desktop, the same control opens the file
 * picker. One element covers "photograph it now" and "choose the scan I
 * already have", which is what the two options in the brief actually are.
 */
export function FilePhotoButton({
  label,
  capture,
  accept = "image/*",
  onFile,
  onProblem,
}: {
  label: string;
  capture?: "user" | "environment";
  accept?: string;
  onFile: (image: CapturedImage) => void;
  onProblem?: (message: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        capture={capture}
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Cleared immediately so choosing the *same* file twice still fires
          // a change event — otherwise a retake after a rejected file does
          // nothing at all.
          event.target.value = "";
          if (!file) return;

          const problem = describeFileProblem(file);
          if (problem) {
            onProblem?.(problem);
            return;
          }
          onFile({
            previewUrl: URL.createObjectURL(file),
            fileName: file.name,
            sizeBytes: file.size,
            mimeType: file.type,
          });
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="lg"
        block
        onClick={() => inputRef.current?.click()}
      >
        {label}
      </Button>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Uploading                                                                   */
/* -------------------------------------------------------------------------- */

/** The private bucket. Nothing in it is reachable without a signed URL. */
const KYC_BUCKET = "kyc-documents";

export class UploadError extends Error {}

/**
 * Sends one captured file to Supabase Storage and returns its object key.
 *
 * STRAIGHT TO STORAGE, NOT THROUGH THE SERVER
 * -------------------------------------------
 * A Vercel serverless function has a ~4.5 MB request body limit, and the flow
 * accepts documents up to 10 MB. Posting the file to a server action would work
 * on a laptop and fail in production on exactly the large scans that matter, so
 * the browser talks to Storage directly with its own session.
 *
 * That does not make the upload unvalidated — it moves the validation somewhere
 * stronger. The bucket carries `file_size_limit` and `allowed_mime_types`, and
 * the INSERT policy pins every object under a folder named for the uploader's
 * own `auth.uid()`. Both are enforced by Postgres and Storage before the object
 * exists, so a client that lies about a file, or aims at somebody else's
 * folder, is refused by the service rather than by code that trusted it. The
 * server then re-reads what actually landed before any row claims it exists.
 *
 * The **path is derived from the session**, not chosen freely: `auth.uid()` is
 * read from the browser's own session, and the policy would reject any other
 * first segment anyway.
 */
export async function uploadKycFile(
  image: CapturedImage,
  kind: "document" | "selfie",
  mode: KycUploadMode,
): Promise<string> {
  if (mode === "s3") return uploadToS3(image, kind);
  if (mode !== "supabase") {
    throw new UploadError("Document upload is not available right now.");
  }

  const supabase = getSupabaseBrowserClient();

  const { data: sessionData } = await supabase.auth.getSession();
  const authUserId = sessionData.session?.user?.id;
  if (!authUserId) {
    throw new UploadError("Your session has expired. Sign in and try again.");
  }

  const blob = await fetch(image.previewUrl).then((response) => response.blob());

  /*
   * A fresh key every time, never a name derived from the file.
   *
   * Two people uploading `passport.jpg` must not collide, and a resubmission
   * must write a *new* object rather than replacing one a reviewer may already
   * have opened — there is no UPDATE policy on the bucket, so an overwrite
   * would simply fail.
   */
  const key = `${authUserId}/${kind}-${Date.now()}-${randomSuffix()}.${extensionFor(image)}`;

  const { error } = await supabase.storage.from(KYC_BUCKET).upload(key, blob, {
    contentType: image.mimeType || blob.type || "application/octet-stream",
    upsert: false,
  });

  if (error) {
    /*
     * Reported as a failure, never swallowed.
     *
     * The common causes are the bucket's own limits — a file too large, or a
     * type outside `allowed_mime_types` — and the person can act on both. A
     * silent failure here would produce a submission with no document, which a
     * reviewer cannot progress and the person cannot understand.
     */
    throw new UploadError(
      /too large|exceeded/i.test(error.message)
        ? "That file is larger than the 10 MB limit."
        : /mime|content type/i.test(error.message)
          ? "That file type is not accepted."
          : `The upload failed: ${error.message}`,
    );
  }

  return key;
}

/**
 * The S3 path: ask the server for a one-file upload slot, then PUT the bytes
 * straight to the private bucket.
 *
 * The server generates the key (`kyc/{userId}/{kind}/{uuid}`) from the
 * session and signs the exact content type and length into the URL, so this
 * function cannot choose where the file goes or smuggle a different file in —
 * S3 refuses a body that does not match. The returned key is then verified
 * again, server-side, when the submission claims it.
 */
async function uploadToS3(
  image: CapturedImage,
  kind: "document" | "selfie",
): Promise<string> {
  const blob = await fetch(image.previewUrl).then((response) => response.blob());
  const contentType = image.mimeType || blob.type || "application/octet-stream";

  const target = await createKycUploadTargetAction({
    kind,
    contentType,
    byteSize: blob.size,
  });
  if (!target.ok || !target.url || !target.key) {
    throw new UploadError(target.message ?? "Could not prepare the upload. Try again.");
  }

  let response: Response;
  try {
    response = await fetch(target.url, {
      method: "PUT",
      headers: target.headers,
      body: blob,
    });
  } catch {
    throw new UploadError("The upload failed. Check your connection and try again.");
  }
  if (!response.ok) {
    throw new UploadError("The upload was refused. Try again, or choose a different file.");
  }
  return target.key;
}

function extensionFor(image: CapturedImage): string {
  const fromName = /\.([A-Za-z0-9]{1,5})$/.exec(image.fileName)?.[1];
  if (fromName) return fromName.toLowerCase();
  const fromType = image.mimeType.split("/")[1];
  return (fromType || "bin").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function randomSuffix(): string {
  // `crypto.randomUUID` needs a secure context, which an insecure LAN origin is
  // not — the same constraint the camera runs into. A shorter random tail is
  // enough here: the key already carries a timestamp and the folder is unique.
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().slice(0, 8);
  }
  return Math.random().toString(36).slice(2, 10);
}
