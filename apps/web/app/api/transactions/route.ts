import { getUtcDateString, transactionSchema, transactionUpdateSchema } from "@centwise/core";
import { db, schema } from "@centwise/database";
import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getSessionUserId } from "@/server/auth";

const transactionIdSchema = z.string().uuid();

function getUtcMonth(date: Date): string {
    return getUtcDateString(date).slice(0, 7);
}

function predatesOpeningBalance(occurredAt: Date, openingBalanceDate: string | null): boolean {
    return Boolean(openingBalanceDate && occurredAt < new Date(`${openingBalanceDate}T00:00:00.000Z`));
}

export async function GET(): Promise<NextResponse> {
    const userId = await getSessionUserId();

    if (!userId) {
        return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const transactions = await db.query.transactions.findMany({
        where: (transactions, { eq }) => eq(transactions.userId, userId),
        orderBy: (transactions, { desc }) => [desc(transactions.occurredAt)]
    });

    return NextResponse.json({ transactions });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
    const userId = await getSessionUserId();

    if (!userId) {
        return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    let body: unknown;

    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: "The request body must contain valid JSON." }, { status: 400 });
    }

    const parsedTransaction = transactionSchema.safeParse(body);

    if (!parsedTransaction.success) {
        return NextResponse.json(
            { error: "Invalid transaction data.", details: parsedTransaction.error.flatten() },
            { status: 400 }
        );
    }

    const response = await db.transaction(async (databaseTransaction) => {
        const account = await databaseTransaction.query.accounts.findFirst({
            where: (accounts, { and, eq }) => and(
                eq(accounts.id, parsedTransaction.data.accountId),
                eq(accounts.userId, userId),
                eq(accounts.isActive, true)
            )
        });

        if (!account) {
            return NextResponse.json({ error: "Active account not found." }, { status: 404 });
        }

        const occurrenceId = parsedTransaction.data.recurringOccurrenceId;

        if (occurrenceId) {
            if (predatesOpeningBalance(parsedTransaction.data.occurredAt, account.openingBalanceDate)) {
                return NextResponse.json(
                    { error: "A historical transaction cannot settle a post-balance occurrence." },
                    { status: 409 }
                );
            }

            const [occurrence] = await databaseTransaction
                .select()
                .from(schema.recurringOccurrences)
                .where(and(
                    eq(schema.recurringOccurrences.id, occurrenceId),
                    eq(schema.recurringOccurrences.userId, userId)
                ))
                .for("update");

            if (!occurrence) {
                return NextResponse.json({ error: "Recurring occurrence not found." }, { status: 404 });
            }

            const scheduledDate = occurrence.rescheduledDate ?? occurrence.scheduledDate;

            if (occurrence.isCancelled
                || occurrence.shortSettledAt
                || occurrence.type !== (parsedTransaction.data.type === "income" ? "income" : "bill")
                || getUtcMonth(parsedTransaction.data.occurredAt) !== scheduledDate.slice(0, 7)) {
                return NextResponse.json(
                    { error: "Transaction direction and month must match an open occurrence." },
                    { status: 409 }
                );
            }
        }

        const [transaction] = await databaseTransaction
            .insert(schema.transactions)
            .values({
                ...parsedTransaction.data,
                recurringOccurrenceId: occurrenceId ?? null,
                userId
            })
            .returning();

        return NextResponse.json({ transaction }, { status: 201 });
    });

    return response;
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
    const userId = await getSessionUserId();
    const parsedTransactionId = transactionIdSchema.safeParse(request.nextUrl.searchParams.get("transactionId"));

    if (!userId) {
        return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    if (!parsedTransactionId.success) {
        return NextResponse.json(
            { error: "A valid transactionId query parameter is required." },
            { status: 400 }
        );
    }

    let body: unknown;

    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: "The request body must contain valid JSON." }, { status: 400 });
    }

    const parsedTransaction = transactionUpdateSchema.safeParse(body);

    if (!parsedTransaction.success) {
        return NextResponse.json(
            { error: "Invalid transaction data.", details: parsedTransaction.error.flatten() },
            { status: 400 }
        );
    }

    return db.transaction(async (databaseTransaction) => {
        const [currentTransaction] = await databaseTransaction
            .select()
            .from(schema.transactions)
            .where(and(
                eq(schema.transactions.id, parsedTransactionId.data),
                eq(schema.transactions.userId, userId)
            ))
            .for("update");

        if (!currentTransaction) {
            return NextResponse.json({ error: "Transaction not found." }, { status: 404 });
        }

        const updates = parsedTransaction.data;
        const hasExplicitOccurrence = Object.prototype.hasOwnProperty.call(updates, "recurringOccurrenceId");
        const accountId = updates.accountId ?? currentTransaction.accountId;
        const type = updates.type ?? currentTransaction.type;
        const occurredAt = updates.occurredAt ?? currentTransaction.occurredAt;
        const targetOccurrenceId = hasExplicitOccurrence
            ? updates.recurringOccurrenceId ?? null
            : currentTransaction.recurringOccurrenceId;
        const dimensionsChanged = accountId !== currentTransaction.accountId
            || type !== currentTransaction.type
            || getUtcMonth(occurredAt) !== getUtcMonth(currentTransaction.occurredAt);

        if (currentTransaction.recurringOccurrenceId && dimensionsChanged && !hasExplicitOccurrence) {
            return NextResponse.json(
                { error: "Explicitly reconcile the occurrence when changing account, direction, or month." },
                { status: 409 }
            );
        }

        if (updates.accountId) {
            const updatedAccountId = updates.accountId;
            const account = await databaseTransaction.query.accounts.findFirst({
                where: (accounts, { and, eq }) => and(
                    eq(accounts.id, updatedAccountId),
                    eq(accounts.userId, userId),
                    eq(accounts.isActive, true)
                )
            });

            if (!account) {
                return NextResponse.json({ error: "Active account not found." }, { status: 404 });
            }
        }

        const occurrenceIds = [...new Set([
            currentTransaction.recurringOccurrenceId,
            targetOccurrenceId
        ].filter((id): id is string => Boolean(id)))].sort();
        const lockedOccurrences = new Map<string, typeof schema.recurringOccurrences.$inferSelect>();

        for (const occurrenceId of occurrenceIds) {
            const [occurrence] = await databaseTransaction
                .select()
                .from(schema.recurringOccurrences)
                .where(and(
                    eq(schema.recurringOccurrences.id, occurrenceId),
                    eq(schema.recurringOccurrences.userId, userId)
                ))
                .for("update");

            if (!occurrence) {
                return NextResponse.json({ error: "Recurring occurrence not found." }, { status: 404 });
            }

            lockedOccurrences.set(occurrenceId, occurrence);
        }

        if (targetOccurrenceId) {
            const occurrence = lockedOccurrences.get(targetOccurrenceId);

            if (!occurrence) {
                return NextResponse.json({ error: "Recurring occurrence not found." }, { status: 404 });
            }

            const scheduledDate = occurrence.rescheduledDate ?? occurrence.scheduledDate;
            const transactionAccount = await databaseTransaction.query.accounts.findFirst({
                where: (accounts, { and, eq }) => and(
                    eq(accounts.id, accountId),
                    eq(accounts.userId, userId)
                )
            });

            if (occurrence.isCancelled
                || (occurrence.shortSettledAt && targetOccurrenceId !== currentTransaction.recurringOccurrenceId)
                || occurrence.type !== (type === "income" ? "income" : "bill")
                || getUtcMonth(occurredAt) !== scheduledDate.slice(0, 7)
                || !transactionAccount
                || predatesOpeningBalance(occurredAt, transactionAccount.openingBalanceDate)) {
                return NextResponse.json(
                    { error: "Transaction direction and month must match the selected open occurrence." },
                    { status: 409 }
                );
            }
        }

        const financialFieldsChanged = dimensionsChanged
            || updates.amountInCents !== undefined
            || (updates.occurredAt !== undefined
                && updates.occurredAt.getTime() !== currentTransaction.occurredAt.getTime())
            || targetOccurrenceId !== currentTransaction.recurringOccurrenceId;
        const [transaction] = await databaseTransaction
            .update(schema.transactions)
            .set({ ...updates, updatedAt: new Date() })
            .where(and(
                eq(schema.transactions.id, parsedTransactionId.data),
                eq(schema.transactions.userId, userId)
            ))
            .returning();

        if (financialFieldsChanged) {
            for (const occurrenceId of occurrenceIds) {
                await databaseTransaction
                    .update(schema.recurringOccurrences)
                    .set({ shortSettledAt: null, updatedAt: new Date() })
                    .where(and(
                        eq(schema.recurringOccurrences.id, occurrenceId),
                        eq(schema.recurringOccurrences.userId, userId)
                    ));
            }
        }

        return NextResponse.json({ transaction });
    });
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
    const userId = await getSessionUserId();
    const parsedTransactionId = transactionIdSchema.safeParse(request.nextUrl.searchParams.get("transactionId"));

    if (!userId) {
        return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    if (!parsedTransactionId.success) {
        return NextResponse.json(
            { error: "A valid transactionId query parameter is required." },
            { status: 400 }
        );
    }

    return db.transaction(async (databaseTransaction) => {
        const [transaction] = await databaseTransaction
            .select()
            .from(schema.transactions)
            .where(and(
                eq(schema.transactions.id, parsedTransactionId.data),
                eq(schema.transactions.userId, userId)
            ))
            .for("update");

        if (!transaction) {
            return NextResponse.json({ error: "Transaction not found." }, { status: 404 });
        }

        if (transaction.recurringOccurrenceId) {
            await databaseTransaction
                .select()
                .from(schema.recurringOccurrences)
                .where(and(
                    eq(schema.recurringOccurrences.id, transaction.recurringOccurrenceId),
                    eq(schema.recurringOccurrences.userId, userId)
                ))
                .for("update");
            await databaseTransaction
                .update(schema.recurringOccurrences)
                .set({ shortSettledAt: null, updatedAt: new Date() })
                .where(and(
                    eq(schema.recurringOccurrences.id, transaction.recurringOccurrenceId),
                    eq(schema.recurringOccurrences.userId, userId)
                ));
        }

        const [deletedTransaction] = await databaseTransaction
            .delete(schema.transactions)
            .where(and(
                eq(schema.transactions.id, parsedTransactionId.data),
                eq(schema.transactions.userId, userId)
            ))
            .returning();

        return NextResponse.json({ transaction: deletedTransaction });
    });
}