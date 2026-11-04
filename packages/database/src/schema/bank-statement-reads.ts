import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "./users";

export const bankStatementReads = pgTable(
  "bank_statement_reads",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    requestKey: uuid("request_key").notNull(),
    fileName: text("file_name").notNull(),
    fingerprint: text("fingerprint").notNull(),
    fileSizeBytes: integer("file_size_bytes").notNull(),
    status: text("status", {
      enum: ["processing", "completed", "failed"],
    }).notNull(),
    candidateCount: integer("candidate_count").notNull().default(0),
    attemptCount: integer("attempt_count").notNull().default(1),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("bank_statement_reads_user_request_key_unique").on(
      table.userId,
      table.requestKey,
    ),
    index("bank_statement_reads_user_created_idx").on(
      table.userId,
      table.createdAt,
    ),
    check(
      "bank_statement_reads_file_name_length_check",
      sql`length(${table.fileName}) BETWEEN 1 AND 255`,
    ),
    check(
      "bank_statement_reads_file_size_positive_check",
      sql`${table.fileSizeBytes} > 0`,
    ),
    check(
      "bank_statement_reads_status_check",
      sql`${table.status} IN ('processing', 'completed', 'failed')`,
    ),
    check(
      "bank_statement_reads_candidate_count_check",
      sql`${table.candidateCount} >= 0`,
    ),
    check(
      "bank_statement_reads_attempt_count_check",
      sql`${table.attemptCount} > 0`,
    ),
    check(
      "bank_statement_reads_error_code_check",
      sql`${table.errorCode} IS NULL OR ${table.errorCode} IN ('invalid_pdf', 'provider_unavailable', 'provider_rejected', 'invalid_extraction', 'unsupported_document')`,
    ),
  ],
);
