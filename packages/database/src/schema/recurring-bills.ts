import { sql } from "drizzle-orm";
import { bigint, boolean, check, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { users } from "./users";

export const recurringBills = pgTable(
    "recurring_bills",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
        name: text("name").notNull(),
        amountInCents: bigint("amount_in_cents", { mode: "number" }).notNull(),
        dueDayOfMonth: integer("due_day_of_month").notNull(),
        isActive: boolean("is_active").notNull().default(true),
        createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
    },
    (table) => [
        index("recurring_bills_user_id_idx").on(table.userId),
        check("recurring_bills_amount_positive_check", sql`${table.amountInCents} > 0`),
        check("recurring_bills_due_day_check", sql`${table.dueDayOfMonth} BETWEEN 1 AND 31`)
    ]
);