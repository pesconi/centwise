import { createHash } from "node:crypto";

import { importCandidateCreateSchema } from "@centwise/core";
import type { ImportCandidateCreateInput } from "@centwise/core";
import {
  getImportCandidateValidationIssues,
  getImportDuplicateReviews,
  importPostingBlockers,
} from "@centwise/core";
import { db, schema } from "@centwise/database";
import { NextRequest, NextResponse } from "next/server";

import { getSessionUserId } from "@/server/auth";
import { loadImportDuplicateContext } from "@/server/import-duplicate-review";

export const dynamic = "force-dynamic";

class ActiveAccountNotFoundError extends Error {}

type CreateCandidateResult =
  | { conflict: true }
  | {
      candidate: typeof schema.importCandidates.$inferSelect;
      created: boolean;
      conflict: false;
    };

function getFingerprint(input: ImportCandidateCreateInput): string {
  const candidate = {
    accountId: input.candidate.accountId ?? null,
    amountInCents: input.candidate.amountInCents ?? null,
    currency: input.candidate.currency ?? null,
    type: input.candidate.type ?? null,
    occurredAt: input.candidate.occurredAt
      ? new Date(input.candidate.occurredAt).toISOString()
      : null,
    description: input.candidate.description ?? null,
  };
  const payload = JSON.stringify({
    sourceType: input.sourceType,
    sourceEventKey: input.sourceEventKey,
    capturedAt: new Date(input.capturedAt).toISOString(),
    parserVersion: input.parserVersion ?? null,
    evidence: Object.fromEntries(
      Object.entries(input.evidence ?? {}).sort(([first], [second]) =>
        first.localeCompare(second),
      ),
    ),
    candidate,
  });

  return createHash("sha256").update(payload).digest("hex");
}

export async function GET(): Promise<NextResponse> {
  const userId = await getSessionUserId();

  if (!userId) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 },
    );
  }

  const { rows, references } = await loadImportDuplicateContext(userId);
  const duplicateReviews = getImportDuplicateReviews(
    rows.map(({ candidate, account }) => ({
      ...candidate,
      accountId:
        account &&
        ["pending_review", "needs_information", "duplicate"].includes(candidate.status)
          ? account.id
          : null,
    })),
    references,
  );

  return NextResponse.json({
    candidates: rows.map(({ candidate, source, account }, index) => ({
      ...candidate,
      source: {
        sourceType: source.sourceType,
        sourceEventKey: source.sourceEventKey,
        capturedAt: source.capturedAt,
        parserVersion: source.parserVersion,
        evidence: source.evidence,
      },
      account,
      duplicateReview: duplicateReviews[index],
    })),
    postingBlocked: true,
    postingBlockers: importPostingBlockers,
  });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const userId = await getSessionUserId();

  if (!userId) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 },
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

  const parsedInput = importCandidateCreateSchema.safeParse(body);

  if (!parsedInput.success) {
    return NextResponse.json(
      {
        error: "Invalid import candidate data.",
        details: parsedInput.error.flatten(),
      },
      { status: 400 },
    );
  }

  const input = parsedInput.data;
  const fingerprint = getFingerprint(input);
  const candidateValues = {
    accountId: input.candidate.accountId ?? null,
    amountInCents: input.candidate.amountInCents ?? null,
    currency: input.candidate.currency ?? null,
    type: input.candidate.type ?? null,
    occurredAt: input.candidate.occurredAt
      ? new Date(input.candidate.occurredAt)
      : null,
    description: input.candidate.description ?? null,
  };
  const validationIssues = getImportCandidateValidationIssues(candidateValues);

  let result: CreateCandidateResult;

  try {
    result = await db.transaction(async (transaction) => {
      const [newSource] = await transaction
        .insert(schema.importSources)
        .values({
          userId,
          sourceType: input.sourceType,
          sourceEventKey: input.sourceEventKey,
          capturedAt: new Date(input.capturedAt),
          parserVersion: input.parserVersion ?? null,
          fingerprint,
          evidence: input.evidence ?? {},
        })
        .onConflictDoNothing({
          target: [
            schema.importSources.userId,
            schema.importSources.sourceType,
            schema.importSources.sourceEventKey,
          ],
        })
        .returning();

      const source =
        newSource ??
        (await transaction.query.importSources.findFirst({
          where: (sources, { and: whereAnd, eq: whereEq }) =>
            whereAnd(
              whereEq(sources.userId, userId),
              whereEq(sources.sourceType, input.sourceType),
              whereEq(sources.sourceEventKey, input.sourceEventKey),
            ),
        }));

      if (!source) {
        throw new Error(
          "The import source could not be resolved after insertion.",
        );
      }

      if (source.fingerprint !== fingerprint) {
        return { conflict: true as const };
      }

      const existingCandidate =
        await transaction.query.importCandidates.findFirst({
          where: (candidates, { eq: whereEq }) =>
            whereEq(candidates.sourceId, source.id),
        });

      if (existingCandidate) {
        return {
          candidate: existingCandidate,
          created: false,
          conflict: false as const,
        };
      }

      const candidateAccountId = candidateValues.accountId;

      if (candidateAccountId) {
        const account = await transaction.query.accounts.findFirst({
          where: (accounts, { and: whereAnd, eq: whereEq }) =>
            whereAnd(
              whereEq(accounts.id, candidateAccountId),
              whereEq(accounts.userId, userId),
              whereEq(accounts.isActive, true),
            ),
        });

        if (!account) {
          throw new ActiveAccountNotFoundError();
        }
      }

      const [newCandidate] = await transaction
        .insert(schema.importCandidates)
        .values({
          userId,
          sourceId: source.id,
          ...candidateValues,
          status: validationIssues.length
            ? "needs_information"
            : "pending_review",
          postingStatus: "blocked",
          validationIssues,
        })
        .onConflictDoNothing({ target: schema.importCandidates.sourceId })
        .returning();
      const candidate =
        newCandidate ??
        (await transaction.query.importCandidates.findFirst({
          where: (candidates, { eq: whereEq }) =>
            whereEq(candidates.sourceId, source.id),
        }));

      if (!candidate) {
        throw new Error(
          "The import candidate could not be resolved after insertion.",
        );
      }

      return {
        candidate,
        created: Boolean(newSource),
        conflict: false as const,
      };
    });
  } catch (error) {
    if (error instanceof ActiveAccountNotFoundError) {
      return NextResponse.json(
        { error: "Active account not found." },
        { status: 404 },
      );
    }

    throw error;
  }

  if ("conflict" in result && result.conflict) {
    return NextResponse.json(
      { error: "This source event key was already used with different data." },
      { status: 409 },
    );
  }

  if (!("candidate" in result)) {
    throw new Error(
      "The import candidate transaction completed without a result.",
    );
  }

  return NextResponse.json(
    { candidate: result.candidate, postingBlocked: true, postingBlockers: importPostingBlockers },
    { status: result.created ? 201 : 200 },
  );
}
