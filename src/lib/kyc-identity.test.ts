import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  dateOfBirthRefusal,
  documentNumberRefusal,
  latestAdultBirthDate,
  maskDocumentNumber,
  verhoeffValid,
} from "./kyc-identity";

/** Appends the Verhoeff check digit, so the test does not hard-code a real person's number. */
function withCheckDigit(body: string): string {
  for (let digit = 0; digit <= 9; digit += 1) {
    if (verhoeffValid(body + digit)) return body + digit;
  }
  throw new Error("unreachable");
}

const NOW = new Date("2026-10-04T06:00:00Z"); // 11:30 IST

describe("date of birth", () => {
  test("adults pass; the day someone turns 18 passes", () => {
    assert.equal(dateOfBirthRefusal("1990-05-17", NOW), null);
    assert.equal(dateOfBirthRefusal("2008-10-04", NOW), null);
  });
  test("under 18, the future and impossible dates are refused", () => {
    assert.match(dateOfBirthRefusal("2008-10-05", NOW)!, /at least 18/);
    assert.match(dateOfBirthRefusal("2027-01-01", NOW)!, /future/);
    assert.match(dateOfBirthRefusal("2026-10-05", NOW)!, /future/);
    assert.match(dateOfBirthRefusal("1999-02-30", NOW)!, /doesn't exist/);
    assert.match(dateOfBirthRefusal("17-05-1990", NOW)!, /date of birth/);
    assert.match(dateOfBirthRefusal("", NOW)!, /date of birth/);
    assert.match(dateOfBirthRefusal("1890-01-01", NOW)!, /year/);
  });
  test("the IST calendar decides 'today', not UTC", () => {
    // 20:00 UTC on 3 Oct is 01:30 IST on 4 Oct.
    const lateUtc = new Date("2026-10-03T20:00:00Z");
    assert.equal(latestAdultBirthDate(lateUtc), "2008-10-04");
  });
  test("29 February rolls back to 28 February in a non-leap year", () => {
    assert.equal(latestAdultBirthDate(new Date("2028-02-29T06:00:00Z")), "2010-02-28");
  });
});

describe("document numbers", () => {
  const aadhaar = withCheckDigit("23456789012");

  test("Aadhaar: 12 digits, valid check digit, spaces allowed", () => {
    assert.equal(documentNumberRefusal("aadhaar", aadhaar), null);
    assert.equal(
      documentNumberRefusal("aadhaar", `${aadhaar.slice(0, 4)} ${aadhaar.slice(4, 8)} ${aadhaar.slice(8)}`),
      null,
    );
    const wrong = aadhaar.slice(0, 11) + ((Number(aadhaar[11]) + 1) % 10);
    assert.match(documentNumberRefusal("aadhaar", wrong)!, /isn't valid/);
    assert.match(documentNumberRefusal("aadhaar", "12345678901")!, /12 digits/);
    assert.match(documentNumberRefusal("aadhaar", withCheckDigit("13456789012"))!, /isn't valid/);
  });

  test("PAN", () => {
    assert.equal(documentNumberRefusal("pan", "abcpe1234f"), null);
    assert.match(documentNumberRefusal("pan", "ABCDE1234F")!, /PAN/, "D is not a holder type");
    assert.match(documentNumberRefusal("pan", "ABCP1234F")!, /PAN/);
  });

  test("passport", () => {
    assert.equal(documentNumberRefusal("passport", "K1234567"), null);
    assert.match(documentNumberRefusal("passport", "K0234567")!, /passport/);
    assert.match(documentNumberRefusal("passport", "12345678")!, /passport/);
  });

  test("driving licence: the common Indian layouts pass, free text does not", () => {
    for (const valid of ["MH12 20110012345", "DL-0420110149646", "KA0119960012345", "TN-22-2015-0001234"]) {
      assert.equal(documentNumberRefusal("driving_licence", valid), null, valid);
    }
    assert.ok(documentNumberRefusal("driving_licence", "my licence"));
    assert.ok(documentNumberRefusal("driving_licence", "ABCDEFGHIJKL"));
    assert.ok(documentNumberRefusal("driving_licence", "12345678901"));
  });

  test("other national ID is flexible but bounded", () => {
    assert.equal(documentNumberRefusal("national_id", "X12345"), null);
    assert.ok(documentNumberRefusal("national_id", "AB1"));
    assert.ok(documentNumberRefusal("national_id", "A".repeat(21)));
    assert.ok(documentNumberRefusal("national_id", "AB<script>"));
  });

  test("only the last four characters are kept", () => {
    assert.equal(maskDocumentNumber("abcpe1234f"), "•••• •••• 234F");
    assert.ok(!maskDocumentNumber(aadhaar).includes(aadhaar.slice(0, 8)));
  });
});
