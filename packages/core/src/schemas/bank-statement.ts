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
      reviewFlags: BankStatementReviewFlag[];
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
        "possible_recurring" | "ordinary_spend" | "uncertain";
      evidence: {
        pageNumber: number;
        excerpt: string;
      };
      validationIssues: string[];
      confidenceSignals: string[];
      reviewFlags: BankStatementReviewFlag[];
    };

export type BankStatementReviewFlag =
  "possible_duplicate_in_statement" | "possible_internal_transfer";

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

  const items: BankStatementExtractionItem[] = envelope.data.transactions.map(
    (rawItem, index) => {
      const parsedItem = extractedRowSchema.safeParse(rawItem);

      if (!parsedItem.success) {
        return {
          index,
          status: "invalid" as const,
          validationIssues: getSchemaIssues(parsedItem.error),
          reviewFlags: [],
        };
      }

      const {
        transaction,
        categorySuggestion,
        recurrenceSuggestion,
        evidence,
      } = parsedItem.data;

      if (transaction.currency && transaction.currency !== "EUR") {
        return {
          index,
          status: "invalid" as const,
          validationIssues: ["currency:not_eur"],
          reviewFlags: [],
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
            reviewFlags: [],
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
              ...validationIssues.map(
                (issue) => `missing_or_uncertain:${issue}`,
              ),
              "category_suggestion_unconfirmed",
              "recurrence_suggestion_unconfirmed",
            ]
          : [
              "required_transaction_fields_present",
              "eur_currency",
              "category_suggestion_unconfirmed",
              "recurrence_suggestion_unconfirmed",
            ],
        reviewFlags: [],
      };
    },
  );

  for (const [index, item] of items.entries()) {
    if (!("candidate" in item)) {
      continue;
    }

    const { candidate } = item;
    const occurredDate = candidate.occurredAt?.toISOString().slice(0, 10);
    const hasPossibleDuplicate = items.some((other, otherIndex) => {
      if (otherIndex === index || !("candidate" in other)) {
        return false;
      }

      const otherDate = other.candidate.occurredAt?.toISOString().slice(0, 10);

      return (
        candidate.amountInCents !== null &&
        candidate.amountInCents === other.candidate.amountInCents &&
        candidate.currency === other.candidate.currency &&
        candidate.type === other.candidate.type &&
        occurredDate !== undefined &&
        occurredDate === otherDate
      );
    });
    const searchableText = [candidate.description, item.evidence.excerpt]
      .filter(Boolean)
      .join(" ");

    if (hasPossibleDuplicate) {
      item.reviewFlags.push("possible_duplicate_in_statement");
    }

    if (
      /\b(?:transfer|transferencia|transferência|own account|between accounts|inter-account|sepa transfer)\b/i.test(
        searchableText,
      )
    ) {
      item.reviewFlags.push("possible_internal_transfer");
    }
  }

  return { success: true, items };
}
