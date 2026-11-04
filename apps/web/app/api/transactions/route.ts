import { transactionSchema, transactionUpdateSchema } from "@centwise/core";
import { db, schema } from "@centwise/database";
import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getSessionUserId } from "@/server/auth";

const transactionIdSchema = z.string().uuid();

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

    const account = await db.query.accounts.findFirst({
        where: (accounts, { and, eq }) => and(
            eq(accounts.id, parsedTransaction.data.accountId),
            eq(accounts.userId, userId),
            eq(accounts.isActive, true)
        )
    });

    if (!account) {
        return NextResponse.json({ error: "Active account not found." }, { status: 404 });
    }

    const [transaction] = await db
        .insert(schema.transactions)
        .values({ ...parsedTransaction.data, userId })
        .returning();

    return NextResponse.json({ transaction }, { status: 201 });
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

    const accountId = parsedTransaction.data.accountId;

    if (accountId) {
        const account = await db.query.accounts.findFirst({
            where: (accounts, { and, eq }) => and(
                eq(accounts.id, accountId),
                eq(accounts.userId, userId),
                eq(accounts.isActive, true)
            )
        });

        if (!account) {
            return NextResponse.json({ error: "Active account not found." }, { status: 404 });
        }
    }

    const [transaction] = await db
        .update(schema.transactions)
        .set({ ...parsedTransaction.data, updatedAt: new Date() })
        .where(
            and(
                eq(schema.transactions.id, parsedTransactionId.data),
                eq(schema.transactions.userId, userId)
            )
        )
        .returning();

    if (!transaction) {
        return NextResponse.json({ error: "Transaction not found." }, { status: 404 });
    }

    return NextResponse.json({ transaction });
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

    const [transaction] = await db
        .delete(schema.transactions)
        .where(
            and(
                eq(schema.transactions.id, parsedTransactionId.data),
                eq(schema.transactions.userId, userId)
            )
        )
        .returning();

    if (!transaction) {
        return NextResponse.json({ error: "Transaction not found." }, { status: 404 });
    }

    return NextResponse.json({ transaction });
}