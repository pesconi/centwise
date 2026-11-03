import { z } from "zod";

export const transactionSchema = z.object({
    accountId: z.string().uuid(),
    amountInCents: z.number().int().positive(),
    currency: z.literal("EUR"),
    type: z.enum(["income", "expense"]),
    occurredAt: z.coerce.date(),
    description: z.string().trim().max(500).nullable().optional()
});

export type CreateTransactionInput = z.infer<typeof transactionSchema>;