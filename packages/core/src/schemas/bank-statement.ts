import { z } from "zod";

import { transactionSchema } from "./transaction";
import { getImportCandidateValidationIssues } from "../utils/import-candidate";

const extractedTransactionSchema = z
  .object({
    amountInCents: z
      .number()
      .int()
      .positive()
      .refine(Number.isSafeInteger)
      .nullable(),
    currency: z.string().trim().length(3).nullable(),
    type: z.enum(["income", "expense"]).nullable(),
    occurredAt: z.string().datetime({ offset: true }).nullable(),
    description: z.string().trim().max(500).nullable(),
  })
  .strict();

const extractedRowSchema = z
  .object({
    transaction: extractedTransactionSchema,
    categorySuggestion: z.string().trim().min(1).max(64).nullable(),
    recurrenceSuggestion: z.enum([
      "possible_recurring",
      "ordinary_spend",
      "uncertain",
    ]),
    evidence: z
      .object({
        pageNumber: z.number().int().positive(),
        excerpt: z.string().trim().min(1).max(500),
      })
      .strict(),
  })
  .strict();

const extractionEnvelopeSchema = z
  .object({
    transactions: z.array(z.unknown()),
  })
  .strict();

const accountIdSchema = z.string().uuid().nullable();

export type BankStatementExtractionItem =
  | {
      index: number;
      status: "invalid";
      validationIssues: string[];
    }
  | {
      index: number;
      status: "needs_review" | "ready_for_review";
      candidate: {
        accountId: string | null;
        amountInCents: number | null;
        currency: "EUR" | null;
        type: "income" | "expense" | null;
        occurredAt: Date | null;
        description: string | null;
      };
      reportedCurrency: string | null;
      categorySuggestion: string | null;
      recurrenceSuggestion:
        | "possible_recurring"
        | "ordinary_spend"
        | "uncertain";
      evidence: {
        pageNumber: number;
        excerpt: string;
      };
      validationIssues: string[];
      confidenceSignals: string[];
    };

export type BankStatementExtractionResult =
  | { success: false; validationIssues: string[] }
  | { success: true; items: BankStatementExtractionItem[] };

function getSchemaIssues(error: z.ZodError): string[] {
  return [
    ...new Set(
      error.issues.map((issue) => {
        const field = issue.path[0];
        return `${typeof field === "string" ? field : "output"}:${issue.code}`;
      }),
    ),
  ];
}

export function validateBankStatementExtraction(
  value: unknown,
  selectedAccountId: string | null = null,
): BankStatementExtractionResult {
  const parsedAccountId = accountIdSchema.safeParse(selectedAccountId);

  if (!parsedAccountId.success) {
    return {
      success: false,
      validationIssues: ["accountId:invalid"],
    };
  }

  const envelope = extractionEnvelopeSchema.safeParse(value);

  if (!envelope.success) {
    return {
      success: false,
      validationIssues: getSchemaIssues(envelope.error),
    };
  }

  const items = envelope.data.transactions.map((rawItem, index) => {
    const parsedItem = extractedRowSchema.safeParse(rawItem);

    if (!parsedItem.success) {
      return {
        index,
        status: "invalid" as const,
        validationIssues: getSchemaIssues(parsedItem.error),
      };
    }

    const { transaction, categorySuggestion, recurrenceSuggestion, evidence } =
      parsedItem.data;

    if (transaction.currency && transaction.currency !== "EUR") {
      return {
        index,
        status: "invalid" as const,
        validationIssues: ["currency:not_eur"],
      };
    }

    const currency: "EUR" | null =
      transaction.currency === "EUR" ? "EUR" : null;
    const candidate = {
      accountId: parsedAccountId.data,
      amountInCents: transaction.amountInCents,
      currency,
      type: transaction.type,
      occurredAt: transaction.occurredAt
        ? new Date(transaction.occurredAt)
        : null,
      description: transaction.description || null,
    };
    const validationIssues = getImportCandidateValidationIssues(candidate);

    if (!candidate.description) {
      validationIssues.push("description");
    }

    if (!categorySuggestion) {
      validationIssues.push("category");
    }

    if (validationIssues.length === 0) {
      const contractResult = transactionSchema.safeParse(candidate);

      if (!contractResult.success) {
        return {
          index,
          status: "invalid" as const,
          validationIssues: getSchemaIssues(contractResult.error),
        };
      }
    }

    const status: "needs_review" | "ready_for_review" =
      validationIssues.length ? "needs_review" : "ready_for_review";

    return {
      index,
      status,
      candidate,
      reportedCurrency: transaction.currency,
      categorySuggestion,
      recurrenceSuggestion,
      evidence,
      validationIssues,
      confidenceSignals: validationIssues.length
        ? [
            ...validationIssues.map((issue) => `missing_or_uncertain:${issue}`),
            "category_suggestion_unconfirmed",
            "recurrence_suggestion_unconfirmed",
          ]
        : [
            "required_transaction_fields_present",
            "eur_currency",
            "category_suggestion_unconfirmed",
            "recurrence_suggestion_unconfirmed",
          ],
    };
  });

  return { success: true, items };
}
