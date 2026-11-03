import { credentialsSchema } from "@centwise/core";
import { db } from "@centwise/database";
import bcrypt from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";

import { createSession } from "@/server/auth";

export async function POST(request: NextRequest): Promise<NextResponse> {
    let body: unknown;

    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: "The request body must contain valid JSON." }, { status: 400 });
    }

    const parsedCredentials = credentialsSchema.safeParse(body);

    if (!parsedCredentials.success) {
        return NextResponse.json({ error: "Invalid email or password." }, { status: 400 });
    }

    const user = await db.query.users.findFirst({
        columns: { id: true, email: true, passwordHash: true },
        where: (users, { eq }) => eq(users.email, parsedCredentials.data.email)
    });

    if (!user || !(await bcrypt.compare(parsedCredentials.data.password, user.passwordHash))) {
        return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
    }

    await createSession(user.id);

    return NextResponse.json({ user: { id: user.id, email: user.email } });
}