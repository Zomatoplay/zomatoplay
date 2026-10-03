import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  kycFileRefusal,
  MAX_KYC_FILE_BYTES,
  kycFileReferencesRefusal,
} from "./kyc-policy";

const both = {
  documentPath: "kyc/usr_1/document/a",
  documentFileName: "aadhaar.jpg",
  selfiePath: "kyc/usr_1/selfie/b",
  selfieFileName: "selfie.jpg",
};

describe("KYC uploads are optional, but a referenced file must be real", () => {
  test("both, either, or neither file is accepted", () => {
    assert.equal(kycFileReferencesRefusal(both), null);
    assert.equal(kycFileReferencesRefusal({}), null);
    assert.equal(kycFileReferencesRefusal({ documentPath: both.documentPath, documentFileName: "a.jpg" }), null);
    assert.equal(kycFileReferencesRefusal({ selfiePath: both.selfiePath, selfieFileName: "s.jpg" }), null);
  });

  test("half a reference is a file that never uploaded, and is refused", () => {
    // A filename with no key is a file the screen showed and nothing uploaded.
    assert.match(kycFileReferencesRefusal({ ...both, documentPath: "  " }) ?? "", /identity document/i);
    assert.match(kycFileReferencesRefusal({ ...both, documentFileName: "" }) ?? "", /identity document/i);
    assert.match(kycFileReferencesRefusal({ ...both, selfiePath: null }) ?? "", /live photo/i);
    assert.match(kycFileReferencesRefusal({ ...both, selfieFileName: undefined }) ?? "", /live photo/i);
  });

  test("one object cannot stand in for both", () => {
    assert.match(
      kycFileReferencesRefusal({ ...both, selfiePath: both.documentPath }) ?? "",
      /separate photo/i,
    );
  });
});

describe("KYC file type and size", () => {
  test("a document may be a photo or a PDF", () => {
    for (const contentType of ["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"]) {
      assert.equal(kycFileRefusal("document", { contentType, byteSize: 1000 }), null, contentType);
    }
  });

  test("a live photo must be an image", () => {
    assert.equal(kycFileRefusal("selfie", { contentType: "image/jpeg", byteSize: 1000 }), null);
    assert.match(
      kycFileRefusal("selfie", { contentType: "application/pdf", byteSize: 1000 }) ?? "",
      /must be a photo/i,
    );
  });

  test("unknown types are refused", () => {
    for (const contentType of ["", "text/html", "image/svg+xml", "application/octet-stream"]) {
      assert.notEqual(kycFileRefusal("document", { contentType, byteSize: 1000 }), null, contentType);
    }
  });

  test("empty, non-numeric and oversized files are refused; the limit itself is allowed", () => {
    assert.match(kycFileRefusal("document", { contentType: "image/jpeg", byteSize: 0 }) ?? "", /empty/i);
    assert.match(kycFileRefusal("document", { contentType: "image/jpeg", byteSize: Number.NaN }) ?? "", /empty/i);
    assert.equal(
      kycFileRefusal("document", { contentType: "image/jpeg", byteSize: MAX_KYC_FILE_BYTES }),
      null,
    );
    assert.match(
      kycFileRefusal("selfie", { contentType: "image/jpeg", byteSize: MAX_KYC_FILE_BYTES + 1 }) ?? "",
      /larger than 10 MB/i,
    );
  });
});
