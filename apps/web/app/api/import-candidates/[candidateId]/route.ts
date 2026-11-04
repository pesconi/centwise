import {
  getImportCandidateValidationIssues,
  importCandidateUpdateSchema,
} from "@centwise/core";
import { db, schema } from "@centwise/database";
import { and, eq, inArray } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getSessionUserId } from "@/server/auth";

interface RouteContext {
  params: Promise<{ candidateId: string }>;
}

const candidateIdSchema = z.string().uuid();
export async function PATCH(
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

  const parsedUpdates = importCandidateUpdateSchema.safeParse(body);

  if (!parsedUpdates.success) {
    return NextResponse.json(
      {
        error: "Invalid import candidate correction.",
        details: parsedUpdates.error.flatten(),
      },
      { status: 400 },
    );
  }

  const existing = await db.query.importCandidates.findFirst({
    where: and(
      eq(schema.importCandidates.id, parsedCandidateId.data),
      eq(schema.importCandidates.userId, userId),
    ),
  });

  if (!existing) {
    return NextResponse.json(
      { error: "Import candidate not found." },
      { status: 404 },
    );
  }

  if (
    existing.status !== "pending_review" &&
    existing.status !== "needs_information"
  ) {
    return NextResponse.json(
      { error: "This import candidate can no longer be edited." },
      { status: 409 },
    );
  }

  const accountId =
    parsedUpdates.data.accountId === undefined
      ? existing.accountId
      : parsedUpdates.data.accountId;

  if (accountId) {
    const account = await db.query.accounts.findFirst({
      where: and(
        eq(schema.accounts.id, accountId),
        eq(schema.accounts.userId, userId),
        eq(schema.accounts.isActive, true),
      ),
    });

    if (!account) {
      return NextResponse.json(
        { error: "Active account not found." },
        { status: 404 },
      );
    }
  }

  const candidateFields = {
    accountId,
    amountInCents:
      parsedUpdates.data.amountInCents === undefined
        ? existing.amountInCents
        : parsedUpdates.data.amountInCents,
    currency:
      parsedUpdates.data.currency === undefined
        ? existing.currency
        : parsedUpdates.data.currency,
    type:
      parsedUpdates.data.type === undefined
        ? existing.type
        : parsedUpdates.data.type,
    occurredAt:
      parsedUpdates.data.occurredAt === undefined
        ? existing.occurredAt
        : parsedUpdates.data.occurredAt === null
          ? null
          : new Date(parsedUpdates.data.occurredAt),
    description:
      parsedUpdates.data.description === undefined
        ? existing.description
        : parsedUpdates.data.description,
  };
  const validationIssues = getImportCandidateValidationIssues(candidateFields);

  const [candidate] = await db
    .update(schema.importCandidates)
    .set({
      ...candidateFields,
      validationIssues,
      status: validationIssues.length ? "needs_information" : "pending_review",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.importCandidates.id, existing.id),
        eq(schema.importCandidates.userId, userId),
        inArray(schema.importCandidates.status, [
          "pending_review",
          "needs_information",
        ]),
      ),
    )
    .returning();

  if (!candidate) {
    return NextResponse.json(
      { error: "This import candidate changed state; reload and try again." },
      { status: 409 },
    );
  }

  return NextResponse.json({ candidate, postingBlocked: true });
}
