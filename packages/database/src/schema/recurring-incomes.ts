import { sql } from "drizzle-orm";
import { bigint, boolean, check, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { users } from "./users";

export const recurringIncomes = pgTable(
    "recurring_incomes",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
        name: text("name").notNull(),
        amountInCents: bigint("amount_in_cents", { mode: "number" }).notNull(),
        expectedDayOfMonth: integer("expected_day_of_month").notNull(),
        isActive: boolean("is_active").notNull().default(true),
        createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
    },
    (table) => [
        index("recurring_incomes_user_id_idx").on(table.userId),
        check("recurring_incomes_amount_positive_check", sql`${table.amountInCents} > 0`),
        check("recurring_incomes_expected_day_check", sql`${table.expectedDayOfMonth} BETWEEN 1 AND 31`)
    ]
);