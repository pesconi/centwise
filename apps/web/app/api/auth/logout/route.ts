import { NextResponse } from "next/server";

import { clearSession } from "@/server/auth";

export async function POST(): Promise<NextResponse> {
    await clearSession();

    return NextResponse.json({ success: true });
}