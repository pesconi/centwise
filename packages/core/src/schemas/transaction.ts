import { z } from "zod";

export const transactionSchema = z.object({
    accountId: z.string().uuid(),
    amountInCents: z.number().int().positive(),
    currency: z.literal("EUR"),
    type: z.enum(["income", "expense"]),
    occurredAt: z.coerce.date(),
    recurringOccurrenceId: z.string().uuid().nullable().optional(),
    description: z.string().trim().max(500).nullable().optional()
});

export const transactionUpdateSchema = transactionSchema.partial()
    .refine((value) => Object.keys(value).length > 0, "At least one transaction field is required.");

export type CreateTransactionInput = z.infer<typeof transactionSchema>;
export type TransactionUpdateInput = z.infer<typeof transactionUpdateSchema>;