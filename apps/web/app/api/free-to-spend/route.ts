import { calculateFreeToSpend, defaultFinancialSettings } from "@centwise/core";
import { db } from "@centwise/database";
import { NextResponse } from "next/server";

import { getSessionUserId } from "@/server/auth";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
    const userId = await getSessionUserId();

    if (!userId) {
        return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const [accounts, transactions, recurringIncomes, recurringBills, settings] = await Promise.all([
        db.query.accounts.findMany({
            where: (accounts, { eq }) => eq(accounts.userId, userId)
        }),
        db.query.transactions.findMany({
            where: (transactions, { eq }) => eq(transactions.userId, userId)
        }),
        db.query.recurringIncomes.findMany({
            where: (recurringIncomes, { eq }) => eq(recurringIncomes.userId, userId)
        }),
        db.query.recurringBills.findMany({
            where: (recurringBills, { eq }) => eq(recurringBills.userId, userId)
        }),
        db.query.financialSettings.findFirst({
            where: (financialSettings, { eq }) => eq(financialSettings.userId, userId)
        })
    ]);
    const financialSettings = settings ?? defaultFinancialSettings;
    const calculation = calculateFreeToSpend({
        asOf: new Date(),
        accounts,
        transactions,
        recurringIncomes,
        recurringBills,
        monthlyInvestmentCents: financialSettings.monthlyInvestmentCents,
        safetyReserveCents: financialSettings.safetyReserveCents
    });

    return NextResponse.json({ calculation });
}