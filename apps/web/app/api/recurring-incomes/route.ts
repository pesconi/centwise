import { recurringIncomeSchema } from "@centwise/core";
import { db, schema } from "@centwise/database";
import { NextRequest, NextResponse } from "next/server";

import { getSessionUserId } from "@/server/auth";

export async function GET(): Promise<NextResponse> {
    const userId = await getSessionUserId();

    if (!userId) {
        return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const incomes = await db.query.recurringIncomes.findMany({
        where: (recurringIncomes, { eq }) => eq(recurringIncomes.userId, userId),
        orderBy: (recurringIncomes, { asc }) => [asc(recurringIncomes.expectedDayOfMonth)]
    });

    return NextResponse.json({ incomes });
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

    const parsedIncome = recurringIncomeSchema.safeParse(body);

    if (!parsedIncome.success) {
        return NextResponse.json(
            { error: "Invalid recurring income data.", details: parsedIncome.error.flatten() },
            { status: 400 }
        );
    }

    const [income] = await db
        .insert(schema.recurringIncomes)
        .values({ userId, ...parsedIncome.data })
        .returning();

    return NextResponse.json({ income }, { status: 201 });
}