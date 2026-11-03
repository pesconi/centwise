import { defaultFinancialSettings, financialSettingsSchema } from "@centwise/core";
import { db, schema } from "@centwise/database";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { getSessionUserId } from "@/server/auth";

export async function GET(): Promise<NextResponse> {
    const userId = await getSessionUserId();

    if (!userId) {
        return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const settings = await db.query.financialSettings.findFirst({
        where: (financialSettings, { eq }) => eq(financialSettings.userId, userId)
    });

    return NextResponse.json({ settings: settings ?? defaultFinancialSettings });
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
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

    const parsedSettings = financialSettingsSchema.safeParse(body);

    if (!parsedSettings.success) {
        return NextResponse.json(
            { error: "Invalid financial settings.", details: parsedSettings.error.flatten() },
            { status: 400 }
        );
    }

    const [settings] = await db
        .insert(schema.financialSettings)
        .values({ userId, ...parsedSettings.data })
        .onConflictDoUpdate({
            target: schema.financialSettings.userId,
            set: { ...parsedSettings.data, updatedAt: new Date() }
        })
        .returning();

    return NextResponse.json({ settings });
}