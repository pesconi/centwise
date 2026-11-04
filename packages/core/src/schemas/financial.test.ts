import { describe, expect, it } from "vitest";

import { accountSchema, accountUpdateSchema, financialOnboardingSchema } from "./financial";

const account = {
    name: "Synthetic account",
    openingBalanceCents: 100_000,
    openingBalanceDate: "2026-11-04",
    currency: "EUR"
};

describe("opening balance effective date", () => {
    it("requires an explicit valid UTC calendar date for a new account", () => {
        expect(accountSchema.safeParse(account).success).toBe(true);
        for (const openingBalanceDate of [undefined, null, "", "2026-02-29", "2026-11-31", "2026-11-04T00:00:00Z", "04/11/2026"]) {
            expect(accountSchema.safeParse({ ...account, openingBalanceDate }).success).toBe(false);
        }
        expect(accountSchema.safeParse({ ...account, openingBalanceDate: "2028-02-29", openingBalanceCents: -100 }).success).toBe(true);
    });

    it("requires the same date during onboarding", () => {
        const onboarding = { account, recurringIncomes: [], recurringBills: [], safetyReserveCents: 0, monthlyInvestmentCents: 0 };
        expect(financialOnboardingSchema.safeParse(onboarding).success).toBe(true);
        expect(financialOnboardingSchema.safeParse({ ...onboarding, account: { ...account, openingBalanceDate: undefined } }).success).toBe(false);
    });

    it("requires balance and date to be confirmed together on update", () => {
        expect(accountUpdateSchema.safeParse({ openingBalanceCents: 0 }).success).toBe(false);
        expect(accountUpdateSchema.safeParse({ openingBalanceDate: account.openingBalanceDate }).success).toBe(false);
        expect(accountUpdateSchema.safeParse({ openingBalanceCents: -100, openingBalanceDate: account.openingBalanceDate }).success).toBe(true);
        expect(accountUpdateSchema.safeParse({ openingBalanceCents: 100, openingBalanceDate: null }).success).toBe(false);
        expect(accountUpdateSchema.safeParse({ name: "Renamed legacy account" }).success).toBe(true);
        expect(accountUpdateSchema.safeParse({ isActive: false }).success).toBe(true);
        expect(accountUpdateSchema.safeParse({}).success).toBe(false);
    });
});
