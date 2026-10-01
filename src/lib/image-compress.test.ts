import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { fitWithin, jpegFileName, KYC_IMAGE_TARGETS, prepareKycImage } from "./image-compress";

describe("fitWithin", () => {
  test("scales the longer edge down to the limit and keeps the ratio", () => {
    assert.deepEqual(fitWithin(4000, 3000, 2400), { width: 2400, height: 1800, scaled: true });
    assert.deepEqual(fitWithin(3000, 4000, 2400), { width: 1800, height: 2400, scaled: true });
  });

  test("never enlarges a small image", () => {
    assert.deepEqual(fitWithin(1200, 800, 2400), { width: 1200, height: 800, scaled: false });
    assert.deepEqual(fitWithin(2400, 1000, 2400), { width: 2400, height: 1000, scaled: false });
  });

  test("an extreme ratio keeps at least one pixel", () => {
    const size = fitWithin(10000, 2, 1000);
    assert.equal(size.width, 1000);
    assert.equal(size.height, 1);
  });

  test("nonsense dimensions are not scaled", () => {
    assert.equal(fitWithin(0, 100, 2400).scaled, false);
    assert.equal(fitWithin(Number.NaN, 100, 2400).scaled, false);
  });

  test("documents keep more resolution than selfies, for readable text", () => {
    assert.ok(KYC_IMAGE_TARGETS.document.maxEdge >= 2000);
    assert.ok(KYC_IMAGE_TARGETS.selfie.maxEdge >= 1200);
  });
});

describe("prepareKycImage", () => {
  test("a PDF is uploaded exactly as chosen", async () => {
    const pdf = new Blob(["%PDF-1.7"], { type: "application/pdf" });
    const prepared = await prepareKycImage(pdf, "scan.pdf", "document");
    assert.equal(prepared.blob, pdf);
    assert.equal(prepared.compressed, false);
    assert.equal(prepared.fileName, "scan.pdf");
  });

  test("outside a browser the original is kept rather than failing", async () => {
    const photo = new Blob([new Uint8Array(32)], { type: "image/png" });
    const prepared = await prepareKycImage(photo, "id.png", "document");
    assert.equal(prepared.blob, photo);
    assert.equal(prepared.contentType, "image/png");
  });
});

test("a re-encoded file is named for what it now is", () => {
  assert.equal(jpegFileName("IMG_2041.HEIC"), "IMG_2041.jpg");
  assert.equal(jpegFileName("aadhaar front.png"), "aadhaar front.jpg");
  assert.equal(jpegFileName(".png"), "photo.jpg");
});
