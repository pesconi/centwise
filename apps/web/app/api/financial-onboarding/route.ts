import { financialOnboardingSchema } from "@centwise/core";
import { db, schema } from "@centwise/database";
import { NextRequest, NextResponse } from "next/server";

import { getSessionUserId } from "@/server/auth";

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

    const parsedOnboarding = financialOnboardingSchema.safeParse(body);

    if (!parsedOnboarding.success) {
        return NextResponse.json(
            { error: "Invalid financial setup.", details: parsedOnboarding.error.flatten() },
            { status: 400 }
        );
    }

    const existingAccount = await db.query.accounts.findFirst({
        where: (accounts, { and, eq }) => and(
            eq(accounts.userId, userId),
            eq(accounts.isActive, true)
        )
    });

    if (!parsedOnboarding.data.account && !existingAccount) {
        return NextResponse.json({ error: "An initial account is required." }, { status: 400 });
    }

    const existingSettings = await db.query.financialSettings.findFirst({
        where: (settings, { eq }) => eq(settings.userId, userId)
    });

    if (existingSettings) {
        return NextResponse.json({ error: "Financial setup has already been completed." }, { status: 409 });
    }

    const { account, recurringIncomes, recurringBills, safetyReserveCents, monthlyInvestmentCents } = parsedOnboarding.data;

    await db.transaction(async (transaction) => {
        if (account) {
            await transaction.insert(schema.accounts).values({ userId, ...account });
        }

        if (recurringIncomes.length > 0) {
            await transaction.insert(schema.recurringIncomes).values(
                recurringIncomes.map((income) => ({ userId, ...income }))
            );
        }

        if (recurringBills.length > 0) {
            await transaction.insert(schema.recurringBills).values(
                recurringBills.map((bill) => ({ userId, ...bill }))
            );
        }

        await transaction.insert(schema.financialSettings).values({
            userId,
            currency: "EUR",
            safetyReserveCents,
            monthlyInvestmentCents
        });
    });

    return NextResponse.json({ success: true }, { status: 201 });
}