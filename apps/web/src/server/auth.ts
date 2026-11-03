import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

const sessionCookieName = "centwise_session";
const sessionDurationInSeconds = 60 * 60 * 24 * 30;

function getSessionSecret(): Uint8Array {
    const secret = process.env.AUTH_SECRET;

    if (!secret || secret.length < 32 || secret.startsWith("replace-this")) {
        throw new Error("AUTH_SECRET must contain at least 32 characters.");
    }

    return new TextEncoder().encode(secret);
}

export async function createSession(userId: string): Promise<void> {
    const token = await new SignJWT({})
        .setProtectedHeader({ alg: "HS256" })
        .setSubject(userId)
        .setIssuedAt()
        .setExpirationTime(`${sessionDurationInSeconds}s`)
        .sign(getSessionSecret());

    const cookieStore = await cookies();

    cookieStore.set(sessionCookieName, token, {
        httpOnly: true,
        maxAge: sessionDurationInSeconds,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/"
    });
}

export async function getSessionUserId(): Promise<string | null> {
    const cookieStore = await cookies();
    const token = cookieStore.get(sessionCookieName)?.value;

    if (!token) {
        return null;
    }

    try {
        const { payload } = await jwtVerify(token, getSessionSecret());

        return typeof payload.sub === "string" ? payload.sub : null;
    } catch {
        return null;
    }
}

export async function clearSession(): Promise<void> {
    const cookieStore = await cookies();
    cookieStore.delete(sessionCookieName);
}