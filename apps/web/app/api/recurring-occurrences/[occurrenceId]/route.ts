import { getUtcDateString, isHistoricalTransaction } from "@centwise/core";
import { db, schema } from "@centwise/database";
import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getSessionUserId } from "@/server/auth";

const occurrenceIdSchema = z.string().uuid();
const occurrenceActionSchema = z.discriminatedUnion("action", [
    z.object({ action: z.literal("short-settle"), confirm: z.literal(true) }),
    z.object({ action: z.literal("cancel") }),
    z.object({ action: z.literal("reschedule"), scheduledDate: z.string().date() })
]);

interface RouteContext {
    params: Promise<{ occurrenceId: string }>;
}

export async function PATCH(request: NextRequest, context: RouteContext): Promise<NextResponse> {
    const userId = await getSessionUserId();
    const { occurrenceId } = await context.params;
    const parsedOccurrenceId = occurrenceIdSchema.safeParse(occurrenceId);

    if (!userId) {
        return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    if (!parsedOccurrenceId.success) {
        return NextResponse.json({ error: "Invalid recurring occurrence ID." }, { status: 400 });
    }

    let body: unknown;

    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: "The request body must contain valid JSON." }, { status: 400 });
    }

    const parsedAction = occurrenceActionSchema.safeParse(body);

    if (!parsedAction.success) {
        return NextResponse.json(
            { error: "Invalid recurring occurrence action.", details: parsedAction.error.flatten() },
            { status: 400 }
        );
    }

    return db.transaction(async (transaction) => {
        const [occurrence] = await transaction
            .select()
            .from(schema.recurringOccurrences)
            .where(and(
                eq(schema.recurringOccurrences.id, parsedOccurrenceId.data),
                eq(schema.recurringOccurrences.userId, userId)
            ))
            .for("update");

        if (!occurrence) {
            return NextResponse.json({ error: "Recurring occurrence not found." }, { status: 404 });
        }

        const action = parsedAction.data;

        if (action.action === "short-settle") {
            if (occurrence.isCancelled) {
                return NextResponse.json({ error: "A cancelled occurrence cannot be settled." }, { status: 409 });
            }

            const linkedTransactions = await transaction.query.transactions.findMany({
                where: (transactions, { and, eq }) => and(
                    eq(transactions.userId, userId),
                    eq(transactions.recurringOccurrenceId, occurrence.id)
                )
            });
            const accounts = await transaction.query.accounts.findMany({
                where: (accounts, { eq }) => eq(accounts.userId, userId)
            });
            const accountsById = new Map(accounts.map((account) => [account.id, account]));
            const now = new Date();
            const paidAmountInCents = linkedTransactions.reduce((total, item) => {
                const account = accountsById.get(item.accountId);

                return account
                    && item.occurredAt <= now
                    && !isHistoricalTransaction(item.occurredAt, account.openingBalanceDate)
                    ? total + item.amountInCents
                    : total;
            }, 0);

            if (paidAmountInCents <= 0 || paidAmountInCents >= occurrence.amountInCents) {
                return NextResponse.json(
                    { error: "An occurrence can be settled for less only after a partial payment." },
                    { status: 409 }
                );
            }

            const [updatedOccurrence] = await transaction
                .update(schema.recurringOccurrences)
                .set({ shortSettledAt: new Date(), updatedAt: new Date() })
                .where(eq(schema.recurringOccurrences.id, occurrence.id))
                .returning();

            return NextResponse.json({ occurrence: updatedOccurrence });
        }

        if (action.action === "cancel") {
            const [updatedOccurrence] = await transaction
                .update(schema.recurringOccurrences)
                .set({ isCancelled: true, shortSettledAt: null, updatedAt: new Date() })
                .where(eq(schema.recurringOccurrences.id, occurrence.id))
                .returning();

            return NextResponse.json({ occurrence: updatedOccurrence });
        }

        const effectiveDate = occurrence.rescheduledDate ?? occurrence.scheduledDate;
        const today = getUtcDateString(new Date());

        if (occurrence.type !== "income"
            || action.scheduledDate <= today) {
            return NextResponse.json(
                { error: "Only income occurrences can be rescheduled to a future UTC date." },
                { status: 409 }
            );
        }

        if (effectiveDate.slice(0, 7) !== action.scheduledDate.slice(0, 7)) {
            const linkedTransaction = await transaction.query.transactions.findFirst({
                where: (transactions, { and, eq }) => and(
                    eq(transactions.userId, userId),
                    eq(transactions.recurringOccurrenceId, occurrence.id)
                )
            });

            if (linkedTransaction) {
                return NextResponse.json(
                    { error: "Unlink or reconcile linked transactions before rescheduling into another month." },
                    { status: 409 }
                );
            }
        }

        const [updatedOccurrence] = await transaction
            .update(schema.recurringOccurrences)
            .set({ rescheduledDate: action.scheduledDate, updatedAt: new Date() })
            .where(eq(schema.recurringOccurrences.id, occurrence.id))
            .returning();

        return NextResponse.json({ occurrence: updatedOccurrence });
    });
}
