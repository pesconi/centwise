import { db } from "@centwise/database";
import { NextResponse } from "next/server";

import { getSessionUserId } from "@/server/auth";

export async function GET(): Promise<NextResponse> {
    const userId = await getSessionUserId();

    if (!userId) {
        return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const user = await db.query.users.findFirst({
        columns: { id: true, email: true },
        where: (users, { eq }) => eq(users.id, userId)
    });

    if (!user) {
        return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    return NextResponse.json({ user });
}