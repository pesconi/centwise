import { sql } from "drizzle-orm";
import {
    bigint,
    boolean,
    check,
    date,
    foreignKey,
    index,
    pgTable,
    text,
    timestamp,
    uniqueIndex,
    uuid
} from "drizzle-orm/pg-core";

import { recurringBills } from "./recurring-bills";
import { recurringIncomes } from "./recurring-incomes";
import { users } from "./users";

export const recurringOccurrences = pgTable(
    "recurring_occurrences",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
        recurringBillId: uuid("recurring_bill_id").references(() => recurringBills.id, { onDelete: "restrict" }),
        recurringIncomeId: uuid("recurring_income_id").references(() => recurringIncomes.id, { onDelete: "restrict" }),
        type: text("type", { enum: ["income", "bill"] }).notNull(),
        name: text("name").notNull(),
        amountInCents: bigint("amount_in_cents", { mode: "number" }).notNull(),
        occurrenceMonth: date("occurrence_month").notNull(),
        scheduledDate: date("scheduled_date").notNull(),
        rescheduledDate: date("rescheduled_date"),
        isCancelled: boolean("is_cancelled").notNull().default(false),
        shortSettledAt: timestamp("short_settled_at", { withTimezone: true }),
        createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
    },
    (table) => [
        uniqueIndex("recurring_occurrences_bill_month_unique")
            .on(table.recurringBillId, table.occurrenceMonth)
            .where(sql`${table.recurringBillId} IS NOT NULL`),
        uniqueIndex("recurring_occurrences_income_month_unique")
            .on(table.recurringIncomeId, table.occurrenceMonth)
            .where(sql`${table.recurringIncomeId} IS NOT NULL`),
        uniqueIndex("recurring_occurrences_user_id_id_unique").on(table.userId, table.id),
        index("recurring_occurrences_user_date_idx").on(table.userId, table.scheduledDate),
        check("recurring_occurrences_amount_positive_check", sql`${table.amountInCents} > 0`),
        check(
            "recurring_occurrences_source_check",
            sql`(${table.type} = 'bill' AND ${table.recurringBillId} IS NOT NULL AND ${table.recurringIncomeId} IS NULL)
                OR (${table.type} = 'income' AND ${table.recurringIncomeId} IS NOT NULL AND ${table.recurringBillId} IS NULL)`
        ),
        check(
            "recurring_occurrences_month_start_check",
            sql`${table.occurrenceMonth} = date_trunc('month', ${table.occurrenceMonth}::timestamp)::date`
        )
    ]
);
