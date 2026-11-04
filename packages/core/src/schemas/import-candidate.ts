import { z } from "zod";

const sourceTypes = [
  "bank_sms",
  "bank_notification",
  "bank_statement_pdf",
  "card_statement_pdf",
  "bill_pdf",
] as const;

const candidateFieldsSchema = z.object({
  accountId: z.string().uuid().nullable().optional(),
  amountInCents: z.number().int().positive().nullable().optional(),
  currency: z.literal("EUR").nullable().optional(),
  type: z.enum(["income", "expense"]).nullable().optional(),
  occurredAt: z.string().datetime({ offset: true }).nullable().optional(),
  description: z.string().trim().max(500).nullable().optional(),
});

export const importCandidateCreateSchema = z.object({
  sourceType: z.enum(sourceTypes),
  sourceEventKey: z.string().trim().min(1).max(256),
  capturedAt: z.string().datetime({ offset: true }),
  parserVersion: z.string().trim().max(100).nullable().optional(),
  evidence: z
    .record(z.string(), z.string().max(2_000))
    .refine((value) => Object.keys(value).length <= 20)
    .optional(),
  candidate: candidateFieldsSchema,
});

export const importCandidateUpdateSchema = candidateFieldsSchema
  .partial()
  .refine(
    (value) => Object.keys(value).length > 0,
    "At least one candidate field is required.",
  );

export type ImportCandidateCreateInput = z.infer<
  typeof importCandidateCreateSchema
>;
export type ImportCandidateUpdateInput = z.infer<
  typeof importCandidateUpdateSchema
>;
