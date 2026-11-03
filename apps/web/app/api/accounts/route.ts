import { accountSchema } from "@centwise/core";
import { db, schema } from "@centwise/database";
import { NextRequest, NextResponse } from "next/server";

import { getSessionUserId } from "@/server/auth";

export async function GET(): Promise<NextResponse> {
    const userId = await getSessionUserId();

    if (!userId) {
        return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const accounts = await db.query.accounts.findMany({
        where: (accounts, { eq }) => eq(accounts.userId, userId),
        orderBy: (accounts, { asc }) => [asc(accounts.createdAt)]
    });

    return NextResponse.json({ accounts });
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

    const parsedAccount = accountSchema.safeParse(body);

    if (!parsedAccount.success) {
        return NextResponse.json(
            { error: "Invalid account data.", details: parsedAccount.error.flatten() },
            { status: 400 }
        );
    }

    const [account] = await db
        .insert(schema.accounts)
        .values({ userId, ...parsedAccount.data })
        .returning();

    return NextResponse.json({ account }, { status: 201 });
}