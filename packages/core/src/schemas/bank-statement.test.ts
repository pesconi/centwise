import { describe, expect, it } from "vitest";

import { transactionSchema, validateBankStatementExtraction } from "./index";

const selectedAccountId = "9a7b6c5d-4e3f-4210-9876-123456789abc";

function statementRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    transaction: {
      amountInCents: 2_450,
      currency: "EUR",
      type: "expense",
      occurredAt: "2026-02-28T10:15:00+01:00",
      description: "Groceries",
    },
    categorySuggestion: "Food",
    recurrenceSuggestion: "ordinary_spend",
    evidence: {
      pageNumber: 1,
      excerpt: "28.02.2026 GROCERIES -24,50 EUR",
    },
    ...overrides,
  };
}

describe("validateBankStatementExtraction", () => {
  it("maps a complete synthetic row to the transaction endpoint contract", () => {
    const result = validateBankStatementExtraction(
      { transactions: [statementRow()] },
      selectedAccountId,
    );

    expect(result.success).toBe(true);

    if (!result.success) {
      return;
    }

    expect(result.items[0]?.status).toBe("ready_for_review");

    if (result.items[0]?.status === "ready_for_review") {
      expect(
        transactionSchema.safeParse(result.items[0].candidate).success,
      ).toBe(true);
      expect(result.items[0].candidate.amountInCents).toBe(2_450);
      expect(result.items[0].confidenceSignals).toEqual([
        "required_transaction_fields_present",
        "eur_currency",
        "category_suggestion_unconfirmed",
        "recurrence_suggestion_unconfirmed",
      ]);
      expect(result.items[0].categorySuggestion).toBe("Food");
    }
  });

  it("keeps incomplete or uncertain fields reviewable", () => {
    const result = validateBankStatementExtraction({
      transactions: [
        statementRow({
          transaction: {
            amountInCents: null,
            currency: null,
            type: null,
            occurredAt: null,
            description: null,
          },
          categorySuggestion: null,
          recurrenceSuggestion: "uncertain",
        }),
      ],
    });

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.items[0]).toMatchObject({
        status: "needs_review",
        validationIssues: [
          "amount",
          "currency",
          "direction",
          "date",
          "account",
          "description",
          "category",
        ],
        recurrenceSuggestion: "uncertain",
      });
    }
  });

  it("rejects malformed rows and currencies other than EUR without conversion", () => {
    const result = validateBankStatementExtraction(
      {
        transactions: [
          statementRow({
            transaction: {
              amountInCents: -100,
              currency: "EUR",
              type: "expense",
              occurredAt: "2026-02-28T10:15:00+01:00",
              description: "Invalid amount",
            },
          }),
          statementRow({
            transaction: {
              amountInCents: 2_450,
              currency: "USD",
              type: "expense",
              occurredAt: "2026-02-28T10:15:00+01:00",
              description: "Foreign currency",
            },
          }),
        ],
      },
      selectedAccountId,
    );

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.items[0]).toMatchObject({ status: "invalid" });
      expect(result.items[1]).toMatchObject({
        status: "invalid",
        validationIssues: ["currency:not_eur"],
      });
    }
  });

  it("does not allow extracted data to assign accounts or recurring occurrences", () => {
    const row = statementRow();
    const transaction = row.transaction as Record<string, unknown>;
    transaction.accountId = selectedAccountId;
    transaction.recurringOccurrenceId = selectedAccountId;

    const result = validateBankStatementExtraction({ transactions: [row] });

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.items[0]).toMatchObject({ status: "invalid" });
    }
  });

  it("preserves equal-value rows independently instead of deduplicating by date or amount", () => {
    const result = validateBankStatementExtraction(
      { transactions: [statementRow(), statementRow()] },
      selectedAccountId,
    );

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.items).toHaveLength(2);
      expect(result.items[0]?.index).toBe(0);
      expect(result.items[1]?.index).toBe(1);
      expect(result.items[0]?.reviewFlags).toContain(
        "possible_duplicate_in_statement",
      );
      expect(result.items[1]?.reviewFlags).toContain(
        "possible_duplicate_in_statement",
      );
    }
  });

  it("flags possible internal transfers without changing candidate direction", () => {
    const result = validateBankStatementExtraction({
      transactions: [
        statementRow({
          transaction: {
            amountInCents: 2_450,
            currency: "EUR",
            type: "expense",
            occurredAt: "2026-02-28T10:15:00+01:00",
            description: "Transfer to own account",
          },
        }),
      ],
    });

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.items[0]).toMatchObject({
        status: "needs_review",
        reviewFlags: ["possible_internal_transfer"],
      });
    }
  });

  it("rejects invalid selected account IDs and malformed envelopes explicitly", () => {
    expect(
      validateBankStatementExtraction({ transactions: [] }, "not-an-id"),
    ).toEqual({
      success: false,
      validationIssues: ["accountId:invalid"],
    });
    expect(validateBankStatementExtraction({ rows: [] })).toMatchObject({
      success: false,
    });
  });
});
