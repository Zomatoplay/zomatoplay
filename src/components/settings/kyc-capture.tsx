"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, RotateCw, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { prepareKycImage, type KycImageKind } from "@/lib/image-compress";
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
  /** The exact bytes that will be uploaded — already compressed. */
  blob: Blob;
  fileName: string;
  sizeBytes: number;
  mimeType: string;
}

/**
 * Turns a chosen file or a camera frame into what will be uploaded: compressed
 * where that helps (`prepareKycImage`), then checked against the 10 MB limit
 * the server enforces. Returns a reason instead when the result is unusable.
 */
async function toCapturedImage(
  source: Blob,
  fileName: string,
  kind: KycImageKind,
): Promise<CapturedImage | string> {
  const prepared = await prepareKycImage(source, fileName, kind);
  if (prepared.blob.size > MAX_IMAGE_BYTES) {
    return `That file is ${(prepared.blob.size / 1024 / 1024).toFixed(1)} MB. The limit is 10 MB — try a smaller photo or scan.`;
  }
  return {
    previewUrl: URL.createObjectURL(prepared.blob),
    blob: prepared.blob,
    fileName: prepared.fileName,
    sizeBytes: prepared.blob.size,
    mimeType: prepared.contentType,
  };
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
        void toCapturedImage(blob, `selfie-${Date.now()}.jpg`, "selfie").then((result) => {
          if (typeof result === "string") setProblem(result);
          else onCapture(result);
        });
      },
      "image/jpeg",
      0.92,
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
        label="Take a photo with the camera app"
        kind="selfie"
        capture="user"
        onFile={onCapture}
        onProblem={setProblem}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/** 10 MB — what is uploaded, after compression. The server enforces the same. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/**
 * What a photo may weigh *before* compression. A modern phone's full-size
 * photo can exceed 10 MB and still compress to well under it, so refusing it
 * on the raw size would refuse a perfectly good document. A PDF is uploaded
 * as chosen, so it gets the final limit straight away.
 */
const MAX_RAW_IMAGE_BYTES = 40 * 1024 * 1024;

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
export function describeFileProblem(file: File, kind: KycImageKind): string | null {
  if (file.size === 0) return "That file is empty.";
  const isPdf = file.type === "application/pdf";
  if (kind === "selfie" && !ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    return "Take a photo (JPG, PNG or HEIC).";
  }
  if (!isPdf && !ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    return "Choose an image (JPG, PNG, WebP or HEIC) or a PDF.";
  }
  const limit = isPdf ? MAX_IMAGE_BYTES : MAX_RAW_IMAGE_BYTES;
  if (file.size > limit) {
    return `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ${limit / 1024 / 1024} MB.`;
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
  kind,
  capture,
  accept = "image/*",
  onFile,
  onProblem,
}: {
  label: string;
  kind: KycImageKind;
  capture?: "user" | "environment";
  accept?: string;
  onFile: (image: CapturedImage) => void;
  onProblem?: (message: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [preparing, setPreparing] = useState(false);

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

          const problem = describeFileProblem(file, kind);
          if (problem) {
            onProblem?.(problem);
            return;
          }
          setPreparing(true);
          void toCapturedImage(file, file.name, kind)
            .then((result) => {
              if (typeof result === "string") onProblem?.(result);
              else onFile(result);
            })
            .catch(() => onProblem?.("That photo could not be read. Try another one."))
            .finally(() => setPreparing(false));
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="lg"
        block
        disabled={preparing}
        onClick={() => inputRef.current?.click()}
      >
        {preparing ? "Preparing photo…" : label}
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
 * Uploads one captured file and returns its object key. Resolves only once the
 * storage service has accepted the bytes — nothing is "uploaded" before that.
 *
 * `onProgress` receives 0–1 as the bytes go up (S3 only; the legacy store has
 * no progress events and reports 1 when it finishes).
 *
 * STRAIGHT TO STORAGE, NOT THROUGH THE SERVER
 * -------------------------------------------
 * A serverless function has a ~4.5 MB request body limit, and a server action
 * carrying a 10 MB scan would also hold a Node process for the whole upload.
 * The browser talks to storage directly instead, and that moves validation
 * somewhere stronger rather than removing it: the S3 slot signs the exact type
 * and length (S3 refuses anything else), the legacy bucket's policies pin
 * every object under the uploader's own folder, and the server re-reads what
 * actually landed before any row claims it exists.
 */
export async function uploadKycFile(
  image: CapturedImage,
  kind: "document" | "selfie",
  mode: KycUploadMode,
  onProgress?: (fraction: number) => void,
): Promise<string> {
  if (mode === "s3") return uploadToS3(image, kind, onProgress);
  if (mode !== "supabase") {
    throw new UploadError("Document upload is not available right now.");
  }

  const supabase = getSupabaseBrowserClient();

  const { data: sessionData } = await supabase.auth.getSession();
  const authUserId = sessionData.session?.user?.id;
  if (!authUserId) {
    throw new UploadError("Your session has expired. Sign in and try again.");
  }

  // A fresh key every time, never a name derived from the file: two people's
  // `passport.jpg` must not collide, and a resubmission writes a new object
  // rather than replacing one a reviewer may already have opened.
  const key = `${authUserId}/${kind}-${Date.now()}-${randomSuffix()}.${extensionFor(image)}`;

  const { error } = await supabase.storage.from(KYC_BUCKET).upload(key, image.blob, {
    contentType: image.mimeType || image.blob.type || "application/octet-stream",
    upsert: false,
  });

  if (error) {
    throw new UploadError(
      /too large|exceeded/i.test(error.message)
        ? "That file is larger than the 10 MB limit."
        : /mime|content type/i.test(error.message)
          ? "That file type is not accepted."
          : "The upload failed. Check your connection and try again.",
    );
  }

  onProgress?.(1);
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
 *
 * XMLHttpRequest rather than `fetch` because it is the only browser API that
 * reports upload progress; on a slow mobile connection a silent spinner over
 * a 1 MB upload reads as a frozen page.
 */
async function uploadToS3(
  image: CapturedImage,
  kind: "document" | "selfie",
  onProgress?: (fraction: number) => void,
): Promise<string> {
  const contentType = image.mimeType || image.blob.type || "application/octet-stream";

  const target = await createKycUploadTargetAction({
    kind,
    contentType,
    byteSize: image.blob.size,
  });
  if (!target.ok || !target.url || !target.key) {
    throw new UploadError(target.message ?? "Could not prepare the upload. Try again.");
  }

  const status = await new Promise<number>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", target.url as string);
    for (const [name, value] of Object.entries(target.headers ?? {})) {
      request.setRequestHeader(name, value);
    }
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress?.(event.loaded / event.total);
    };
    request.onload = () => resolve(request.status);
    request.onerror = () => reject(new UploadError("The upload failed. Check your connection and try again."));
    request.ontimeout = () => reject(new UploadError("The upload timed out. Check your connection and try again."));
    request.timeout = 120_000;
    request.send(image.blob);
  });

  if (status < 200 || status >= 300) {
    throw new UploadError("The upload was refused. Try again, or choose a different file.");
  }
  onProgress?.(1);
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
