import { recurringIncomeUpdateSchema } from "@centwise/core";
import { db, schema } from "@centwise/database";
import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getSessionUserId } from "@/server/auth";

const incomeIdSchema = z.string().uuid();

interface RouteContext {
    params: Promise<{ incomeId: string }>;
}

export async function PUT(request: NextRequest, context: RouteContext): Promise<NextResponse> {
    const userId = await getSessionUserId();
    const { incomeId } = await context.params;
    const parsedIncomeId = incomeIdSchema.safeParse(incomeId);

    if (!userId) {
        return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    if (!parsedIncomeId.success) {
        return NextResponse.json({ error: "Invalid recurring income ID." }, { status: 400 });
    }

    let body: unknown;

    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: "The request body must contain valid JSON." }, { status: 400 });
    }

    const parsedIncome = recurringIncomeUpdateSchema.safeParse(body);

    if (!parsedIncome.success) {
        return NextResponse.json(
            { error: "Invalid recurring income data.", details: parsedIncome.error.flatten() },
            { status: 400 }
        );
    }

    const [income] = await db
        .update(schema.recurringIncomes)
        .set({ ...parsedIncome.data, updatedAt: new Date() })
        .where(and(eq(schema.recurringIncomes.id, parsedIncomeId.data), eq(schema.recurringIncomes.userId, userId)))
        .returning();

    if (!income) {
        return NextResponse.json({ error: "Recurring income not found." }, { status: 404 });
    }

    return NextResponse.json({ income });
}

export async function DELETE(_request: NextRequest, context: RouteContext): Promise<NextResponse> {
    const userId = await getSessionUserId();
    const { incomeId } = await context.params;
    const parsedIncomeId = incomeIdSchema.safeParse(incomeId);

    if (!userId) {
        return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    if (!parsedIncomeId.success) {
        return NextResponse.json({ error: "Invalid recurring income ID." }, { status: 400 });
    }

    const [income] = await db
        .update(schema.recurringIncomes)
        .set({ isActive: false, updatedAt: new Date() })
        .where(and(eq(schema.recurringIncomes.id, parsedIncomeId.data), eq(schema.recurringIncomes.userId, userId)))
        .returning();

    if (!income) {
        return NextResponse.json({ error: "Recurring income not found." }, { status: 404 });
    }

    return NextResponse.json({ income });
}