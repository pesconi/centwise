import { describe, expect, it } from "vitest";

import {
  getImportDuplicateReviews,
  type ImportDuplicateReference,
  type ImportDuplicateSubject,
} from "./import-duplicates";

const subject: ImportDuplicateSubject = {
  id: "candidate",
  userId: "owner",
  sourceId: "sms",
  accountId: "account",
  amountInCents: 1234,
  currency: "EUR",
  type: "expense",
  occurredAt: new Date("2026-11-04T00:00:00Z"),
  description: "Synthetic SHOP",
};
const reference: ImportDuplicateReference = {
  ...subject,
  id: "notification-candidate",
  sourceId: "notification",
  targetType: "import_candidate",
  sourceType: "bank_notification",
  description: "  synthetic   shop ",
};

describe("read-only import duplicate review", () => {
  it("explains likely cross-source and manual matches without changing any input", () => {
    const manual: ImportDuplicateReference = {
      ...reference,
      id: "manual",
      sourceId: null,
      sourceType: null,
      targetType: "manual_transaction",
    };
    const before = JSON.stringify([subject, reference, manual]);
    const [matches = []] = getImportDuplicateReviews(
      [subject],
      [reference, manual],
    );
    expect(matches).toHaveLength(2);
    expect(matches.map((match) => [match.targetId, match.reason])).toEqual([
      ["notification-candidate", "same_fields_and_description"],
      ["manual", "same_fields_and_description"],
    ]);
    expect(JSON.stringify([subject, reference, manual])).toBe(before);
  });

  it("labels independent equal purchases only as field coincidences and retains both", () => {
    const [matches = []] = getImportDuplicateReviews(
      [subject],
      [
        { ...reference, description: "Another synthetic shop" },
        { ...reference, id: "second", description: null },
      ],
    );
    expect(matches).toHaveLength(2);
    expect(matches.every((match) => match.reason === "same_fields")).toBe(true);
    expect(
      getImportDuplicateReviews(
        [{ ...subject, description: " " }],
        [{ ...reference, description: null }],
      )[0]?.[0]?.reason,
    ).toBe("same_fields");
  });

  it.each([
    { userId: "other-owner" },
    { accountId: "other-account" },
    { accountId: null },
    { amountInCents: 1235 },
    { amountInCents: 0 },
    { amountInCents: null },
    { amountInCents: 1.5 },
    { amountInCents: Number.MAX_SAFE_INTEGER + 1 },
    { currency: "USD" },
    { currency: null },
    { type: "income" },
    { type: null },
    { occurredAt: new Date("2026-11-03T23:59:59.999Z") },
    { occurredAt: new Date("invalid") },
    { occurredAt: null },
  ])("does not match incompatible or incomplete fields: %j", (changes) => {
    expect(
      getImportDuplicateReviews([subject], [{ ...reference, ...changes }]),
    ).toEqual([[]]);
    expect(
      getImportDuplicateReviews([{ ...subject, ...changes }], [reference]),
    ).toEqual([[]]);
  });

  it("uses UTC day rather than local date and preserves opening-boundary history", () => {
    expect(
      getImportDuplicateReviews(
        [subject],
        [{ ...reference, occurredAt: new Date("2026-11-03T23:30:00-01:00") }],
      )[0],
    ).toHaveLength(1);
    expect(
      getImportDuplicateReviews(
        [subject],
        [{ ...reference, occurredAt: new Date("2026-11-04T00:30:00+01:00") }],
      ),
    ).toEqual([[]]);
  });

  it("never suggests itself or another candidate with the same source link", () => {
    expect(
      getImportDuplicateReviews(
        [subject],
        [
          { ...reference, id: "candidate" },
          { ...reference, sourceId: subject.sourceId },
        ],
      ),
    ).toEqual([[]]);
  });

  it("compares ephemeral PDF rows without assigning a source or transaction link", () => {
    const [matches = []] = getImportDuplicateReviews(
      [{ ...subject, id: null, sourceId: null }],
      [reference],
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]).not.toHaveProperty("approved");
    expect(matches[0]).not.toHaveProperty("recurringOccurrenceId");
  });
});
