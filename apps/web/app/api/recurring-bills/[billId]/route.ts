import { recurringBillUpdateSchema } from "@centwise/core";
import { db, schema } from "@centwise/database";
import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getSessionUserId } from "@/server/auth";

const billIdSchema = z.string().uuid();

interface RouteContext {
    params: Promise<{ billId: string }>;
}

export async function PUT(request: NextRequest, context: RouteContext): Promise<NextResponse> {
    const userId = await getSessionUserId();
    const { billId } = await context.params;
    const parsedBillId = billIdSchema.safeParse(billId);

    if (!userId) {
        return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    if (!parsedBillId.success) {
        return NextResponse.json({ error: "Invalid recurring bill ID." }, { status: 400 });
    }

    let body: unknown;

    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: "The request body must contain valid JSON." }, { status: 400 });
    }

    const parsedBill = recurringBillUpdateSchema.safeParse(body);

    if (!parsedBill.success) {
        return NextResponse.json(
            { error: "Invalid recurring bill data.", details: parsedBill.error.flatten() },
            { status: 400 }
        );
    }

    const [bill] = await db
        .update(schema.recurringBills)
        .set({ ...parsedBill.data, updatedAt: new Date() })
        .where(and(eq(schema.recurringBills.id, parsedBillId.data), eq(schema.recurringBills.userId, userId)))
        .returning();

    if (!bill) {
        return NextResponse.json({ error: "Recurring bill not found." }, { status: 404 });
    }

    return NextResponse.json({ bill });
}

export async function DELETE(_request: NextRequest, context: RouteContext): Promise<NextResponse> {
    const userId = await getSessionUserId();
    const { billId } = await context.params;
    const parsedBillId = billIdSchema.safeParse(billId);

    if (!userId) {
        return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    if (!parsedBillId.success) {
        return NextResponse.json({ error: "Invalid recurring bill ID." }, { status: 400 });
    }

    const [bill] = await db
        .update(schema.recurringBills)
        .set({ isActive: false, updatedAt: new Date() })
        .where(and(eq(schema.recurringBills.id, parsedBillId.data), eq(schema.recurringBills.userId, userId)))
        .returning();

    if (!bill) {
        return NextResponse.json({ error: "Recurring bill not found." }, { status: 404 });
    }

    return NextResponse.json({ bill });
}