import { bigint, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { users } from "./users";

export const financialSettings = pgTable("financial_settings", {
    userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
    currency: text("currency").notNull().default("USD"),
    safetyReserveCents: bigint("safety_reserve_cents", { mode: "number" }).notNull().default(0),
    monthlyInvestmentCents: bigint("monthly_investment_cents", { mode: "number" }).notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
});