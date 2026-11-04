import { describe, expect, it } from "vitest";

import { getRecurringOccurrenceDate, getUtcDateString, getUtcMonthStartDate } from "./recurring-occurrence";

describe("recurring occurrence dates", () => {
    it.each([
        [2026, 1, 29, "2026-02-28"],
        [2028, 1, 29, "2028-02-29"],
        [2026, 3, 31, "2026-04-30"],
        [2026, 0, 31, "2026-01-31"]
    ])("clamps day %i for month %i of %i", (year, month, day, expected) => {
        expect(getRecurringOccurrenceDate(year, month, day)).toBe(expected);
    });

    it("uses UTC for activation and month boundaries", () => {
        const date = new Date("2026-11-04T00:30:00+02:00");

        expect(getUtcDateString(date)).toBe("2026-11-03");
        expect(getUtcMonthStartDate(date)).toBe("2026-11-01");
    });
});
