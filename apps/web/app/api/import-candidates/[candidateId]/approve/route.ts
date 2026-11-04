import { importPostingBlockers } from "@centwise/core";
import { db, schema } from "@centwise/database";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getSessionUserId } from "@/server/auth";

interface RouteContext {
  params: Promise<{ candidateId: string }>;
}

const candidateIdSchema = z.string().uuid();

export async function POST(
  _request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const userId = await getSessionUserId();
  const { candidateId } = await context.params;
  const parsedCandidateId = candidateIdSchema.safeParse(candidateId);

  if (!userId) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 },
    );
  }

  if (!parsedCandidateId.success) {
    return NextResponse.json(
      { error: "Invalid import candidate ID." },
      { status: 400 },
    );
  }

  const candidate = await db.query.importCandidates.findFirst({
    where: and(
      eq(schema.importCandidates.id, parsedCandidateId.data),
      eq(schema.importCandidates.userId, userId),
    ),
  });

  if (!candidate) {
    return NextResponse.json(
      { error: "Import candidate not found." },
      { status: 404 },
    );
  }

  return NextResponse.json(
    {
      error: "Import posting is blocked.",
      postingBlocked: true,
      blockers: importPostingBlockers,
    },
    { status: 409 },
  );
}
