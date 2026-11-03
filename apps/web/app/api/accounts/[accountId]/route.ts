import { accountUpdateSchema } from "@centwise/core";
import { db, schema } from "@centwise/database";
import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getSessionUserId } from "@/server/auth";

const accountIdSchema = z.string().uuid();

interface RouteContext {
    params: Promise<{ accountId: string }>;
}

export async function PUT(request: NextRequest, context: RouteContext): Promise<NextResponse> {
    const userId = await getSessionUserId();
    const { accountId } = await context.params;
    const parsedAccountId = accountIdSchema.safeParse(accountId);

    if (!userId) {
        return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    if (!parsedAccountId.success) {
        return NextResponse.json({ error: "Invalid account ID." }, { status: 400 });
    }

    let body: unknown;

    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: "The request body must contain valid JSON." }, { status: 400 });
    }

    const parsedAccount = accountUpdateSchema.safeParse(body);

    if (!parsedAccount.success) {
        return NextResponse.json(
            { error: "Invalid account data.", details: parsedAccount.error.flatten() },
            { status: 400 }
        );
    }

    const [account] = await db
        .update(schema.accounts)
        .set({ ...parsedAccount.data, updatedAt: new Date() })
        .where(and(eq(schema.accounts.id, parsedAccountId.data), eq(schema.accounts.userId, userId)))
        .returning();

    if (!account) {
        return NextResponse.json({ error: "Account not found." }, { status: 404 });
    }

    return NextResponse.json({ account });
}

export async function DELETE(_request: NextRequest, context: RouteContext): Promise<NextResponse> {
    const userId = await getSessionUserId();
    const { accountId } = await context.params;
    const parsedAccountId = accountIdSchema.safeParse(accountId);

    if (!userId) {
        return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    if (!parsedAccountId.success) {
        return NextResponse.json({ error: "Invalid account ID." }, { status: 400 });
    }

    const [account] = await db
        .update(schema.accounts)
        .set({ isActive: false, updatedAt: new Date() })
        .where(and(eq(schema.accounts.id, parsedAccountId.data), eq(schema.accounts.userId, userId)))
        .returning();

    if (!account) {
        return NextResponse.json({ error: "Account not found." }, { status: 404 });
    }

    return NextResponse.json({ account });
}