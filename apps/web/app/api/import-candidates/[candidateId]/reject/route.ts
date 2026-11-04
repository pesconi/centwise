import { db, schema } from "@centwise/database";
import { and, eq, inArray } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getSessionUserId } from "@/server/auth";

interface RouteContext {
  params: Promise<{ candidateId: string }>;
}

const candidateIdSchema = z.string().uuid();
const rejectionSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});
const rejectableStatuses: (
  "pending_review" | "needs_information" | "duplicate" | "failed"
)[] = ["pending_review", "needs_information", "duplicate", "failed"];

export async function POST(
  request: NextRequest,
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

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "The request body must contain valid JSON." },
      { status: 400 },
    );
  }

  const parsedRejection = rejectionSchema.safeParse(body);

  if (!parsedRejection.success) {
    return NextResponse.json(
      {
        error: "Invalid rejection data.",
        details: parsedRejection.error.flatten(),
      },
      { status: 400 },
    );
  }

  const [candidate] = await db
    .update(schema.importCandidates)
    .set({
      status: "rejected",
      rejectionReason: parsedRejection.data.reason ?? null,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.importCandidates.id, parsedCandidateId.data),
        eq(schema.importCandidates.userId, userId),
        inArray(schema.importCandidates.status, rejectableStatuses),
      ),
    )
    .returning();

  if (candidate) {
    return NextResponse.json({ candidate });
  }

  const currentCandidate = await db.query.importCandidates.findFirst({
    where: and(
      eq(schema.importCandidates.id, parsedCandidateId.data),
      eq(schema.importCandidates.userId, userId),
    ),
  });

  if (!currentCandidate) {
    return NextResponse.json(
      { error: "Import candidate not found." },
      { status: 404 },
    );
  }

  if (currentCandidate.status === "rejected") {
    return NextResponse.json({ candidate: currentCandidate });
  }

  return NextResponse.json(
    { error: "This import candidate cannot be rejected in its current state." },
    { status: 409 },
  );
}
