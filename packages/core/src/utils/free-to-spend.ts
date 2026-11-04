export interface FreeToSpendAccount {
    id: string;
    openingBalanceCents: number;
    openingBalanceDate?: string | null;
    isActive: boolean;
}

export interface FreeToSpendTransaction {
    accountId: string;
    amountInCents: number;
    type: "income" | "expense";
    occurredAt: Date;
}

export interface FreeToSpendRecurringIncome {
    amountInCents: number;
    expectedDayOfMonth: number;
    isActive: boolean;
}

export interface FreeToSpendRecurringBill {
    amountInCents: number;
    dueDayOfMonth: number;
    isActive: boolean;
}

export interface FreeToSpendInput {
    asOf: Date;
    accounts: FreeToSpendAccount[];
    transactions: FreeToSpendTransaction[];
    recurringIncomes: FreeToSpendRecurringIncome[];
    recurringBills: FreeToSpendRecurringBill[];
    monthlyInvestmentCents: number;
    safetyReserveCents: number;
}

export interface FreeToSpendResult {
    liquidBalanceCents: number;
    remainingIncomeCents: number;
    remainingBillsCents: number;
    remainingInvestmentCents: number;
    safetyReserveCents: number;
    freeToSpendCents: number;
    daysRemainingInMonth: number;
    dailySafeSpendCents: number;
}

function getLastDayOfMonth(date: Date): number {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
}

function occursAfterToday(dayOfMonth: number, asOf: Date): boolean {
    return Math.min(dayOfMonth, getLastDayOfMonth(asOf)) > asOf.getUTCDate();
}

function isDueTodayOrLater(dayOfMonth: number, asOf: Date): boolean {
    return Math.min(dayOfMonth, getLastDayOfMonth(asOf)) >= asOf.getUTCDate();
}

export function isHistoricalTransaction(occurredAt: Date, openingBalanceDate: string | null | undefined): boolean {
    return Boolean(openingBalanceDate && occurredAt < new Date(`${openingBalanceDate}T00:00:00.000Z`));
}

export function calculateFreeToSpend(input: FreeToSpendInput): FreeToSpendResult {
    const activeAccounts = new Map(input.accounts
        .filter((account) => account.isActive && !isHistoricalTransaction(input.asOf, account.openingBalanceDate))
        .map((account) => [account.id, account]));
    const liquidBalanceCents = [...activeAccounts.values()]
        .reduce((total, account) => total + account.openingBalanceCents, 0) + input.transactions
            .filter((transaction) => {
                const account = activeAccounts.get(transaction.accountId);
                return account !== undefined && transaction.occurredAt <= input.asOf
                    && !isHistoricalTransaction(transaction.occurredAt, account.openingBalanceDate);
            })
            .reduce(
                (total, transaction) => total + (transaction.type === "income" ? transaction.amountInCents : -transaction.amountInCents),
                0
            );
    const remainingIncomeCents = input.recurringIncomes
        .filter((income) => income.isActive && occursAfterToday(income.expectedDayOfMonth, input.asOf))
        .reduce((total, income) => total + income.amountInCents, 0);
    const remainingBillsCents = input.recurringBills
        .filter((bill) => bill.isActive && isDueTodayOrLater(bill.dueDayOfMonth, input.asOf))
        .reduce((total, bill) => total + bill.amountInCents, 0);
    const freeToSpendCents = liquidBalanceCents
        + remainingIncomeCents
        - remainingBillsCents
        - input.monthlyInvestmentCents
        - input.safetyReserveCents;
    const daysRemainingInMonth = getLastDayOfMonth(input.asOf) - input.asOf.getUTCDate() + 1;
    const dailySafeSpendCents = freeToSpendCents > 0
        ? Math.floor(freeToSpendCents / daysRemainingInMonth)
        : 0;

    return {
        liquidBalanceCents,
        remainingIncomeCents,
        remainingBillsCents,
        remainingInvestmentCents: input.monthlyInvestmentCents,
        safetyReserveCents: input.safetyReserveCents,
        freeToSpendCents,
        daysRemainingInMonth,
        dailySafeSpendCents
    };
}