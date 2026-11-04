import {
    calculateFreeToSpend,
    defaultFinancialSettings,
    getRecurringOccurrenceDate,
    getUtcDateString,
    getUtcMonthStartDate,
    isHistoricalTransaction
} from "@centwise/core";
import { db, schema } from "@centwise/database";
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
    const now = new Date();
    const today = getUtcDateString(now);
    const occurrenceMonth = getUtcMonthStartDate(now);
    await Promise.all([
        ...recurringIncomes
            .filter((income) => income.isActive)
            .map((income) => {
                const scheduledDate = getRecurringOccurrenceDate(
                    now.getUTCFullYear(),
                    now.getUTCMonth(),
                    income.expectedDayOfMonth
                );

                return scheduledDate < today
                    ? Promise.resolve()
                    : db.insert(schema.recurringOccurrences).values({
                        userId,
                        recurringIncomeId: income.id,
                        type: "income",
                        name: income.name,
                        amountInCents: income.amountInCents,
                        occurrenceMonth,
                        scheduledDate
                    }).onConflictDoNothing();
            }),
        ...recurringBills
            .filter((bill) => bill.isActive)
            .map((bill) => {
                const scheduledDate = getRecurringOccurrenceDate(
                    now.getUTCFullYear(),
                    now.getUTCMonth(),
                    bill.dueDayOfMonth
                );

                return scheduledDate < today
                    ? Promise.resolve()
                    : db.insert(schema.recurringOccurrences).values({
                        userId,
                        recurringBillId: bill.id,
                        type: "bill",
                        name: bill.name,
                        amountInCents: bill.amountInCents,
                        occurrenceMonth,
                        scheduledDate
                    }).onConflictDoNothing();
            })
    ]);
    const recurringOccurrences = await db.query.recurringOccurrences.findMany({
        where: (occurrences, { eq }) => eq(occurrences.userId, userId),
        orderBy: (occurrences, { asc }) => [asc(occurrences.scheduledDate)]
    });
    const settledByOccurrence = new Map<string, number>();
    const accountsById = new Map(accounts.map((account) => [account.id, account]));

    for (const transaction of transactions) {
        const account = accountsById.get(transaction.accountId);

        if (transaction.recurringOccurrenceId && account
            && transaction.occurredAt <= now
            && !isHistoricalTransaction(transaction.occurredAt, account.openingBalanceDate)) {
            settledByOccurrence.set(
                transaction.recurringOccurrenceId,
                (settledByOccurrence.get(transaction.recurringOccurrenceId) ?? 0) + transaction.amountInCents
            );
        }
    }

    const financialSettings = settings ?? defaultFinancialSettings;
    const asOf = now;
    const calculation = calculateFreeToSpend({
        asOf,
        accounts,
        transactions,
        recurringIncomes: [],
        recurringBills: [],
        recurringOccurrences: recurringOccurrences.map((occurrence) => ({
            type: occurrence.type,
            amountInCents: occurrence.amountInCents,
            settledAmountInCents: settledByOccurrence.get(occurrence.id) ?? 0,
            scheduledDate: occurrence.rescheduledDate ?? occurrence.scheduledDate,
            isCancelled: occurrence.isCancelled,
            isShortSettled: occurrence.shortSettledAt !== null
        })),
        monthlyInvestmentCents: financialSettings.monthlyInvestmentCents,
        safetyReserveCents: financialSettings.safetyReserveCents
    });
    const lastDayOfMonth = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() + 1, 0)).getUTCDate();
    const scheduledItems = recurringOccurrences
        .map((occurrence) => {
            const settledAmountInCents = settledByOccurrence.get(occurrence.id) ?? 0;
            const outstandingAmountInCents = occurrence.isCancelled || occurrence.shortSettledAt
                ? 0
                : Math.max(occurrence.amountInCents - settledAmountInCents, 0);

            return {
                id: occurrence.id,
                ruleId: occurrence.recurringBillId ?? occurrence.recurringIncomeId,
                name: occurrence.name,
                type: occurrence.type,
                amountInCents: occurrence.amountInCents,
                settledAmountInCents,
                outstandingAmountInCents,
                date: occurrence.rescheduledDate ?? occurrence.scheduledDate,
                isOverdue: (occurrence.rescheduledDate ?? occurrence.scheduledDate) < today,
                ruleName: occurrence.type === "bill"
                    ? recurringBills.find((bill) => bill.id === occurrence.recurringBillId)?.name ?? occurrence.name
                    : recurringIncomes.find((income) => income.id === occurrence.recurringIncomeId)?.name ?? occurrence.name,
                ruleAmountInCents: occurrence.type === "bill"
                    ? recurringBills.find((bill) => bill.id === occurrence.recurringBillId)?.amountInCents ?? occurrence.amountInCents
                    : recurringIncomes.find((income) => income.id === occurrence.recurringIncomeId)?.amountInCents ?? occurrence.amountInCents,
                ruleDayOfMonth: occurrence.type === "bill"
                    ? recurringBills.find((bill) => bill.id === occurrence.recurringBillId)?.dueDayOfMonth ?? Number(occurrence.scheduledDate.slice(-2))
                    : recurringIncomes.find((income) => income.id === occurrence.recurringIncomeId)?.expectedDayOfMonth ?? Number(occurrence.scheduledDate.slice(-2))
            };
        })
        .filter((occurrence) => occurrence.outstandingAmountInCents > 0)
        .sort((first, second) => first.date.localeCompare(second.date));
    const periodEndDate = getRecurringOccurrenceDate(asOf.getUTCFullYear(), asOf.getUTCMonth(), lastDayOfMonth);

    return NextResponse.json({ calculation, periodEndDate, scheduledItems });
}