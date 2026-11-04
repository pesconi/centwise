import type { ImportDuplicateReference } from "@centwise/core";
import { db, schema } from "@centwise/database";
import { and, desc, eq } from "drizzle-orm";

export async function loadImportDuplicateContext(userId: string) {
  const [rows, manualRows] = await Promise.all([
    db
      .select({
        candidate: schema.importCandidates,
        source: schema.importSources,
        account: { id: schema.accounts.id, name: schema.accounts.name },
      })
      .from(schema.importCandidates)
      .innerJoin(
        schema.importSources,
        and(
          eq(schema.importCandidates.sourceId, schema.importSources.id),
          eq(schema.importSources.userId, userId),
        ),
      )
      .leftJoin(
        schema.accounts,
        and(
          eq(schema.importCandidates.accountId, schema.accounts.id),
          eq(schema.accounts.userId, userId),
        ),
      )
      .where(eq(schema.importCandidates.userId, userId))
      .orderBy(desc(schema.importCandidates.createdAt)),
    db
      .select({ transaction: schema.transactions })
      .from(schema.transactions)
      .innerJoin(
        schema.accounts,
        and(
          eq(schema.transactions.accountId, schema.accounts.id),
          eq(schema.accounts.userId, userId),
        ),
      )
      .where(eq(schema.transactions.userId, userId))
      .orderBy(desc(schema.transactions.occurredAt)),
  ]);

  const references: ImportDuplicateReference[] = [
    ...rows
      .filter(
        ({ candidate, account }) =>
          account !== null &&
          ["pending_review", "needs_information", "duplicate"].includes(
            candidate.status,
          ),
      )
      .map(({ candidate, source }) => ({
        ...candidate,
        targetType: "import_candidate" as const,
        sourceType: source.sourceType,
      })),
    ...manualRows.map(({ transaction }) => ({
      ...transaction,
      sourceId: null,
      targetType: "manual_transaction" as const,
      sourceType: null,
    })),
  ];

  return { rows, references };
}
