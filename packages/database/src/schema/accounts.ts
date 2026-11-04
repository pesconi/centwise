import { sql } from "drizzle-orm";
import { bigint, boolean, check, date, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { users } from "./users";

export const accounts = pgTable(
    "accounts",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
        name: text("name").notNull(),
        openingBalanceCents: bigint("opening_balance_cents", { mode: "number" }).notNull(),
        openingBalanceDate: date("opening_balance_date", { mode: "string" }),
        currency: text("currency").notNull(),
        isActive: boolean("is_active").notNull().default(true),
        createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
    },
    (table) => [
        index("accounts_user_id_idx").on(table.userId),
        check("accounts_currency_eur_check", sql`${table.currency} = 'EUR'`)
    ]
);