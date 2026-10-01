import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  kycFileRefusal,
  MAX_KYC_FILE_BYTES,
  missingKycFilesRefusal,
} from "./kyc-policy";

const both = {
  documentPath: "kyc/usr_1/document/a",
  documentFileName: "aadhaar.jpg",
  selfiePath: "kyc/usr_1/selfie/b",
  selfieFileName: "selfie.jpg",
};

describe("KYC submission requires both files", () => {
  test("both present is accepted", () => {
    assert.equal(missingKycFilesRefusal(both), null);
  });

  test("a missing identity document is refused", () => {
    assert.match(
      missingKycFilesRefusal({ ...both, documentPath: undefined }) ?? "",
      /identity document/i,
    );
    // A filename with no key is a file the screen showed and nothing uploaded.
    assert.match(missingKycFilesRefusal({ ...both, documentPath: "  " }) ?? "", /identity document/i);
    assert.match(missingKycFilesRefusal({ ...both, documentFileName: "" }) ?? "", /identity document/i);
  });

  test("a missing live photo is refused", () => {
    assert.match(missingKycFilesRefusal({ ...both, selfiePath: null }) ?? "", /live photo/i);
    assert.match(missingKycFilesRefusal({ ...both, selfieFileName: undefined }) ?? "", /live photo/i);
  });

  test("one object cannot stand in for both", () => {
    assert.match(
      missingKycFilesRefusal({ ...both, selfiePath: both.documentPath }) ?? "",
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
