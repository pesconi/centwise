import { z } from "zod";

const currencySchema = z.literal("EUR");
const nameSchema = z.string().trim().min(1).max(100);
const nonNegativeCentsSchema = z.number().int().nonnegative();
const dayOfMonthSchema = z.number().int().min(1).max(31);

export const defaultFinancialSettings = {
    currency: "EUR",
    safetyReserveCents: 0,
    monthlyInvestmentCents: 0
} as const;

export const financialSettingsSchema = z.object({
    currency: currencySchema,
    safetyReserveCents: nonNegativeCentsSchema,
    monthlyInvestmentCents: nonNegativeCentsSchema
});

export const accountSchema = z.object({
    name: nameSchema,
    openingBalanceCents: z.number().int(),
    currency: currencySchema
});

export const accountUpdateSchema = accountSchema.partial().extend({
    isActive: z.boolean().optional()
}).refine((value) => Object.keys(value).length > 0, "At least one account field is required.");

export const recurringIncomeSchema = z.object({
    name: nameSchema,
    amountInCents: z.number().int().positive(),
    expectedDayOfMonth: dayOfMonthSchema
});

export const recurringIncomeUpdateSchema = recurringIncomeSchema.partial().extend({
    isActive: z.boolean().optional()
}).refine((value) => Object.keys(value).length > 0, "At least one recurring income field is required.");

export const recurringBillSchema = z.object({
    name: nameSchema,
    amountInCents: z.number().int().positive(),
    dueDayOfMonth: dayOfMonthSchema
});

export const recurringBillUpdateSchema = recurringBillSchema.partial().extend({
    isActive: z.boolean().optional()
}).refine((value) => Object.keys(value).length > 0, "At least one recurring bill field is required.");

export type FinancialSettingsInput = z.infer<typeof financialSettingsSchema>;
export type AccountInput = z.infer<typeof accountSchema>;
export type AccountUpdateInput = z.infer<typeof accountUpdateSchema>;
export type RecurringIncomeInput = z.infer<typeof recurringIncomeSchema>;
export type RecurringBillInput = z.infer<typeof recurringBillSchema>;
export type RecurringIncomeUpdateInput = z.infer<typeof recurringIncomeUpdateSchema>;
export type RecurringBillUpdateInput = z.infer<typeof recurringBillUpdateSchema>;