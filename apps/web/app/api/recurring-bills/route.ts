import { recurringBillSchema } from "@centwise/core";
import { db, schema } from "@centwise/database";
import { NextRequest, NextResponse } from "next/server";

import { getSessionUserId } from "@/server/auth";

export async function GET(): Promise<NextResponse> {
    const userId = await getSessionUserId();

    if (!userId) {
        return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const bills = await db.query.recurringBills.findMany({
        where: (recurringBills, { eq }) => eq(recurringBills.userId, userId),
        orderBy: (recurringBills, { asc }) => [asc(recurringBills.dueDayOfMonth)]
    });

    return NextResponse.json({ bills });
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

    const parsedBill = recurringBillSchema.safeParse(body);

    if (!parsedBill.success) {
        return NextResponse.json(
            { error: "Invalid recurring bill data.", details: parsedBill.error.flatten() },
            { status: 400 }
        );
    }

    const [bill] = await db
        .insert(schema.recurringBills)
        .values({ userId, ...parsedBill.data })
        .returning();

    return NextResponse.json({ bill }, { status: 201 });
}