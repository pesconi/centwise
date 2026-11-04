import { describe, expect, it } from "vitest";

import { transactionUpdateSchema } from "./transaction";

describe("transactionUpdateSchema", () => {
    it("accepts a partial amount correction", () => {
        expect(transactionUpdateSchema.safeParse({ amountInCents: 2_500 }).success).toBe(true);
    });

    it("rejects empty updates and non-positive amounts", () => {
        expect(transactionUpdateSchema.safeParse({}).success).toBe(false);
        expect(transactionUpdateSchema.safeParse({ amountInCents: 0 }).success).toBe(false);
    });

    it("coerces an updated date to a Date", () => {
        const result = transactionUpdateSchema.safeParse({ occurredAt: "2026-11-04T00:00:00.000Z" });

        expect(result.success).toBe(true);

        if (result.success) {
            expect(result.data.occurredAt).toEqual(new Date("2026-11-04T00:00:00.000Z"));
        }
    });

    it("accepts explicit occurrence reconciliation or unlinking", () => {
        expect(transactionUpdateSchema.safeParse({ recurringOccurrenceId: "2ce4a8cc-1b85-4be9-836b-efc7db1c1fa7" }).success).toBe(true);
        expect(transactionUpdateSchema.safeParse({ recurringOccurrenceId: null }).success).toBe(true);
    });
});
