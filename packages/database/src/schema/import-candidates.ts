import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { accounts } from "./accounts";
import { importSources } from "./import-sources";
import { users } from "./users";

export const importCandidates = pgTable(
  "import_candidates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id").notNull(),
    accountId: uuid("account_id").references(() => accounts.id, {
      onDelete: "restrict",
    }),
    amountInCents: bigint("amount_in_cents", { mode: "number" }),
    currency: text("currency"),
    type: text("type", { enum: ["income", "expense"] }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }),
    description: text("description"),
    status: text("status", {
      enum: [
        "pending_review",
        "needs_information",
        "duplicate",
        "approved",
        "rejected",
        "failed",
      ],
    }).notNull(),
    postingStatus: text("posting_status", { enum: ["blocked"] })
      .notNull()
      .default("blocked"),
    validationIssues: jsonb("validation_issues")
      .$type<string[]>()
      .notNull()
      .default([]),
    rejectionReason: text("rejection_reason"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.sourceId],
      foreignColumns: [importSources.id],
      name: "import_candidates_source_id_import_sources_id_fk",
    }).onDelete("cascade"),
    uniqueIndex("import_candidates_source_id_unique").on(table.sourceId),
    index("import_candidates_user_status_created_idx").on(
      table.userId,
      table.status,
      table.createdAt,
    ),
    check(
      "import_candidates_amount_positive_check",
      sql`${table.amountInCents} IS NULL OR ${table.amountInCents} > 0`,
    ),
    check(
      "import_candidates_currency_eur_check",
      sql`${table.currency} IS NULL OR ${table.currency} = 'EUR'`,
    ),
    check(
      "import_candidates_type_check",
      sql`${table.type} IS NULL OR ${table.type} IN ('income', 'expense')`,
    ),
    check(
      "import_candidates_status_check",
      sql`${table.status} IN ('pending_review', 'needs_information', 'duplicate', 'approved', 'rejected', 'failed')`,
    ),
    check(
      "import_candidates_posting_blocked_check",
      sql`${table.postingStatus} = 'blocked'`,
    ),
  ],
);
