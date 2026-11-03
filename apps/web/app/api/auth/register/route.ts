import { credentialsSchema } from "@centwise/core";
import { db, schema } from "@centwise/database";
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
        return NextResponse.json(
            { error: "Invalid registration data.", details: parsedCredentials.error.flatten() },
            { status: 400 }
        );
    }

    const existingUser = await db.query.users.findFirst({
        columns: { id: true },
        where: (users, { eq }) => eq(users.email, parsedCredentials.data.email)
    });

    if (existingUser) {
        return NextResponse.json({ error: "An account with this email already exists." }, { status: 409 });
    }

    const passwordHash = await bcrypt.hash(parsedCredentials.data.password, 12);
    const [user] = await db
        .insert(schema.users)
        .values({ email: parsedCredentials.data.email, passwordHash })
        .returning({ id: schema.users.id, email: schema.users.email });

    if (!user) {
        return NextResponse.json({ error: "Could not create the account." }, { status: 500 });
    }

    await createSession(user.id);

    return NextResponse.json({ user }, { status: 201 });
}