import { z } from "zod";

export const transactionSchema = z.object({
    amountInCents: z.number().int().positive(),
    currency: z.string().length(3).toUpperCase(),
    type: z.enum(["income", "expense"]),
    occurredAt: z.coerce.date(),
    description: z.string().trim().max(500).nullable().optional()
});

export type CreateTransactionInput = z.infer<typeof transactionSchema>;