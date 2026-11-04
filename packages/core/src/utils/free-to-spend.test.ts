import { describe, expect, it } from "vitest";

import { calculateFreeToSpend, type FreeToSpendInput } from "./free-to-spend";

function createInput(overrides: Partial<FreeToSpendInput> = {}): FreeToSpendInput {
    return {
        asOf: new Date("2026-11-03T12:00:00.000Z"),
        accounts: [{ id: "account-1", openingBalanceCents: 100_000, isActive: true }],
        transactions: [],
        recurringIncomes: [],
        recurringBills: [],
        monthlyInvestmentCents: 0,
        safetyReserveCents: 0,
        ...overrides
    };
}

describe("calculateFreeToSpend", () => {
    it("combines the current liquid balance with future income and remaining obligations", () => {
        const result = calculateFreeToSpend(createInput({
            transactions: [
                { accountId: "account-1", amountInCents: 50_000, type: "income", occurredAt: new Date("2026-11-01T12:00:00.000Z") },
                { accountId: "account-1", amountInCents: 10_000, type: "expense", occurredAt: new Date("2026-11-02T12:00:00.000Z") },
                { accountId: "account-1", amountInCents: 99_999, type: "expense", occurredAt: new Date("2026-11-04T12:00:00.000Z") }
            ],
            recurringIncomes: [
                { amountInCents: 200_000, expectedDayOfMonth: 5, isActive: true },
                { amountInCents: 10_000, expectedDayOfMonth: 3, isActive: true }
            ],
            recurringBills: [
                { amountInCents: 70_000, dueDayOfMonth: 3, isActive: true },
                { amountInCents: 10_000, dueDayOfMonth: 4, isActive: true },
                { amountInCents: 5_000, dueDayOfMonth: 2, isActive: true }
            ],
            monthlyInvestmentCents: 30_000,
            safetyReserveCents: 20_000
        }));

        expect(result).toEqual({
            liquidBalanceCents: 140_000,
            remainingIncomeCents: 200_000,
            remainingBillsCents: 80_000,
            remainingInvestmentCents: 30_000,
            safetyReserveCents: 20_000,
            freeToSpendCents: 210_000,
            daysRemainingInMonth: 28,
            dailySafeSpendCents: 7_500
        });
    });

    it("clamps days 29 to 31 to the last day of a short month", () => {
        const result = calculateFreeToSpend(createInput({
            asOf: new Date("2026-02-28T12:00:00.000Z"),
            recurringIncomes: [{ amountInCents: 100_000, expectedDayOfMonth: 31, isActive: true }],
            recurringBills: [{ amountInCents: 20_000, dueDayOfMonth: 29, isActive: true }]
        }));

        expect(result.remainingIncomeCents).toBe(0);
        expect(result.remainingBillsCents).toBe(20_000);
        expect(result.daysRemainingInMonth).toBe(1);
        expect(result.dailySafeSpendCents).toBe(80_000);
    });

    it("uses February 29 in a leap year when resolving dates after day 28", () => {
        const result = calculateFreeToSpend(createInput({
            asOf: new Date("2028-02-28T12:00:00.000Z"),
            recurringIncomes: [{ amountInCents: 100_000, expectedDayOfMonth: 29, isActive: true }],
            recurringBills: [{ amountInCents: 20_000, dueDayOfMonth: 31, isActive: true }]
        }));

        expect(result.remainingIncomeCents).toBe(100_000);
        expect(result.remainingBillsCents).toBe(20_000);
        expect(result.daysRemainingInMonth).toBe(2);
    });

    it("allows a negative result while excluding inactive accounts and their transactions", () => {
        const result = calculateFreeToSpend(createInput({
            accounts: [
                { id: "active", openingBalanceCents: 1_000, isActive: true },
                { id: "inactive", openingBalanceCents: 90_000, isActive: false }
            ],
            transactions: [
                { accountId: "inactive", amountInCents: 20_000, type: "income", occurredAt: new Date("2026-11-01T12:00:00.000Z") }
            ],
            recurringBills: [{ amountInCents: 5_000, dueDayOfMonth: 3, isActive: true }],
            safetyReserveCents: 1_000
        }));

        expect(result.liquidBalanceCents).toBe(1_000);
        expect(result.freeToSpendCents).toBe(-5_000);
        expect(result.dailySafeSpendCents).toBe(0);
    });

    it("starts a new daily allowance period on the first day of a new month", () => {
        const result = calculateFreeToSpend(createInput({
            asOf: new Date("2026-03-01T00:00:00.000Z"),
            accounts: [{ id: "account-1", openingBalanceCents: 10_000, isActive: true }]
        }));

        expect(result.daysRemainingInMonth).toBe(31);
        expect(result.dailySafeSpendCents).toBe(322);
    });
});