import { describe, expect, it } from "vitest";

import {
  importCandidateCreateSchema,
  importCandidateUpdateSchema,
} from "./import-candidate";
import { getImportCandidateValidationIssues } from "../utils/import-candidate";

const validEvent = {
  sourceType: "bank_notification",
  sourceEventKey: "notice-123",
  capturedAt: "2026-11-04T05:00:00.000Z",
  candidate: {
    amountInCents: 1250,
    currency: "EUR",
    type: "expense",
    occurredAt: "2026-11-04T04:55:00.000Z",
    description: "Coffee",
  },
};

describe("import candidate schemas", () => {
  it("accepts a source event with a complete candidate", () => {
    expect(importCandidateCreateSchema.safeParse(validEvent).success).toBe(
      true,
    );
  });

  it("allows incomplete candidates to remain reviewable", () => {
    const result = importCandidateCreateSchema.safeParse({
      ...validEvent,
      candidate: {
        amountInCents: null,
        currency: null,
        type: null,
        occurredAt: null,
      },
    });

    expect(result.success).toBe(true);
  });

  it("rejects non-EUR currency rather than converting it", () => {
    const result = importCandidateCreateSchema.safeParse({
      ...validEvent,
      candidate: { ...validEvent.candidate, currency: "USD" },
    });

    expect(result.success).toBe(false);
  });

  it("rejects an empty correction", () => {
    expect(importCandidateUpdateSchema.safeParse({}).success).toBe(false);
  });

  it("does not use purchase amount as a source identity", () => {
    const first = importCandidateCreateSchema.parse(validEvent);
    const second = importCandidateCreateSchema.parse({
      ...validEvent,
      sourceEventKey: "notice-456",
    });

    expect(first.candidate.amountInCents).toBe(second.candidate.amountInCents);
    expect(first.sourceEventKey).not.toBe(second.sourceEventKey);
  });

  it("keeps incomplete candidate fields explicit for review", () => {
    expect(
      getImportCandidateValidationIssues({
        accountId: null,
        amountInCents: null,
        currency: null,
        type: null,
        occurredAt: null,
      }),
    ).toEqual(["amount", "currency", "direction", "date", "account"]);
  });
});
