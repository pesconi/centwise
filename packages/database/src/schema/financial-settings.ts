import { sql } from "drizzle-orm";
import { bigint, check, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { users } from "./users";

export const financialSettings = pgTable(
    "financial_settings",
    {
        userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
        currency: text("currency").notNull().default("EUR"),
        safetyReserveCents: bigint("safety_reserve_cents", { mode: "number" }).notNull().default(0),
        monthlyInvestmentCents: bigint("monthly_investment_cents", { mode: "number" }).notNull().default(0),
        createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
    },
    (table) => [
        check("financial_settings_currency_eur_check", sql`${table.currency} = 'EUR'`),
        check("financial_settings_safety_reserve_nonnegative_check", sql`${table.safetyReserveCents} >= 0`),
        check("financial_settings_monthly_investment_nonnegative_check", sql`${table.monthlyInvestmentCents} >= 0`)
    ]
);