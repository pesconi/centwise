import { sql } from "drizzle-orm";
import { bigint, check, foreignKey, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { accounts } from "./accounts";
import { recurringOccurrences } from "./recurring-occurrences";
import { users } from "./users";

export const transactions = pgTable(
    "transactions",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
        accountId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "restrict" }),
        recurringOccurrenceId: uuid("recurring_occurrence_id"),
        amountInCents: bigint("amount_in_cents", { mode: "number" }).notNull(),
        currency: text("currency").notNull(),
        type: text("type", { enum: ["income", "expense"] }).notNull(),
        occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
        description: text("description"),
        createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
    },
    (table) => [
        foreignKey({
            columns: [table.userId, table.recurringOccurrenceId],
            foreignColumns: [recurringOccurrences.userId, recurringOccurrences.id],
            name: "transactions_user_occurrence_fk"
        }).onDelete("restrict"),
        index("transactions_user_id_idx").on(table.userId),
        index("transactions_account_id_idx").on(table.accountId),
        check("transactions_amount_positive_check", sql`${table.amountInCents} > 0`),
        check("transactions_currency_eur_check", sql`${table.currency} = 'EUR'`),
        check("transactions_type_check", sql`${table.type} IN ('income', 'expense')`)
    ]
);