import { calculateFreeToSpend, defaultFinancialSettings } from "@centwise/core";
import { db } from "@centwise/database";
import { NextResponse } from "next/server";

import { getSessionUserId } from "@/server/auth";

export const dynamic = "force-dynamic";

function getOccurrenceDate(asOf: Date, dayOfMonth: number, lastDayOfMonth: number): string {
    const year = asOf.getUTCFullYear();
    const month = String(asOf.getUTCMonth() + 1).padStart(2, "0");
    const day = String(Math.min(dayOfMonth, lastDayOfMonth)).padStart(2, "0");

    return `${year}-${month}-${day}`;
}

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
    const asOf = new Date();
    const calculation = calculateFreeToSpend({
        asOf,
        accounts,
        transactions,
        recurringIncomes,
        recurringBills,
        monthlyInvestmentCents: financialSettings.monthlyInvestmentCents,
        safetyReserveCents: financialSettings.safetyReserveCents
    });
    const lastDayOfMonth = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() + 1, 0)).getUTCDate();
    const currentDay = asOf.getUTCDate();
    const scheduledItems = [
        ...recurringIncomes
            .filter((income) => income.isActive && Math.min(income.expectedDayOfMonth, lastDayOfMonth) > currentDay)
            .map((income) => ({
                id: income.id,
                name: income.name,
                type: "income" as const,
                amountInCents: income.amountInCents,
                date: getOccurrenceDate(asOf, income.expectedDayOfMonth, lastDayOfMonth)
            })),
        ...recurringBills
            .filter((bill) => bill.isActive && Math.min(bill.dueDayOfMonth, lastDayOfMonth) >= currentDay)
            .map((bill) => ({
                id: bill.id,
                name: bill.name,
                type: "bill" as const,
                amountInCents: bill.amountInCents,
                date: getOccurrenceDate(asOf, bill.dueDayOfMonth, lastDayOfMonth)
            }))
    ].sort((first, second) => first.date.localeCompare(second.date));
    const periodEndDate = getOccurrenceDate(asOf, lastDayOfMonth, lastDayOfMonth);

    return NextResponse.json({ calculation, periodEndDate, scheduledItems });
}