import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "./users";

export const importSources = pgTable(
  "import_sources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sourceType: text("source_type", {
      enum: [
        "bank_sms",
        "bank_notification",
        "bank_statement_pdf",
        "card_statement_pdf",
        "bill_pdf",
      ],
    }).notNull(),
    sourceEventKey: text("source_event_key").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    parserVersion: text("parser_version"),
    fingerprint: text("fingerprint").notNull(),
    evidence: jsonb("evidence")
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
  },
  (table) => [
    uniqueIndex("import_sources_user_type_event_key_unique").on(
      table.userId,
      table.sourceType,
      table.sourceEventKey,
    ),
    index("import_sources_user_id_idx").on(table.userId),
    check(
      "import_sources_event_key_length_check",
      sql`length(${table.sourceEventKey}) BETWEEN 1 AND 256`,
    ),
    check(
      "import_sources_type_check",
      sql`${table.sourceType} IN ('bank_sms', 'bank_notification', 'bank_statement_pdf', 'card_statement_pdf', 'bill_pdf')`,
    ),
  ],
);
