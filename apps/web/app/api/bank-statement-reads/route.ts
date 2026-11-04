import { createHash } from "node:crypto";

import {
  getImportDuplicateReviews,
  importPostingBlockers,
  validateBankStatementExtraction,
} from "@centwise/core";
import { db, schema } from "@centwise/database";
import { and, desc, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  BankStatementProviderError,
  bankStatementExtractionTimeoutMs,
  extractBankStatementPdf,
  maxBankStatementPdfBytes,
} from "@/server/bank-statement-extraction";
import { getSessionUserId } from "@/server/auth";
import { loadImportDuplicateContext } from "@/server/import-duplicate-review";

export const dynamic = "force-dynamic";

const uuidSchema = z.string().uuid();
const maxConcurrentReadsPerServer = 2;
const staleProcessingWindowMs = bankStatementExtractionTimeoutMs + 30_000;
let activeReads = 0;

type ReadRow = typeof schema.bankStatementReads.$inferSelect;

function toPublicRead(read: ReadRow) {
  return {
    id: read.id,
    requestKey: read.requestKey,
    fileName: read.fileName,
    fileSizeBytes: read.fileSizeBytes,
    status: read.status,
    candidateCount: read.candidateCount,
    attemptCount: read.attemptCount,
    errorCode: read.errorCode,
    createdAt: read.createdAt,
    updatedAt: read.updatedAt,
    completedAt: read.completedAt,
  };
}

function decodeFileName(value: string | null): string | null {
  if (!value) {
    return null;
  }

  let decoded: string;

  try {
    decoded = decodeURIComponent(value);
  } catch {
    return null;
  }

  const fileName = decoded
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    ?.replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 255);

  return fileName?.toLowerCase().endsWith(".pdf") ? fileName : null;
}

async function readBoundedBody(
  request: NextRequest,
): Promise<Uint8Array | null> {
  if (!request.body) {
    return new Uint8Array();
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    totalBytes += value.byteLength;

    if (totalBytes > maxBankStatementPdfBytes) {
      await reader.cancel();
      return null;
    }

    chunks.push(value);
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;

  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return body;
}

type ReservationResult =
  | { status: "claimed"; read: ReadRow }
  | { status: "different_file" | "already_processing" | "already_completed" };

async function reserveRead(input: {
  userId: string;
  requestKey: string;
  fileName: string;
  fingerprint: string;
  fileSizeBytes: number;
}): Promise<ReservationResult> {
  return db.transaction(async (transaction) => {
    const [insertedRead] = await transaction
      .insert(schema.bankStatementReads)
      .values({
        ...input,
        status: "processing",
      })
      .onConflictDoNothing({
        target: [
          schema.bankStatementReads.userId,
          schema.bankStatementReads.requestKey,
        ],
      })
      .returning();

    if (insertedRead) {
      return { status: "claimed", read: insertedRead };
    }

    const [existingRead] = await transaction
      .select()
      .from(schema.bankStatementReads)
      .where(
        and(
          eq(schema.bankStatementReads.userId, input.userId),
          eq(schema.bankStatementReads.requestKey, input.requestKey),
        ),
      )
      .for("update");

    if (!existingRead) {
      throw new Error("The bank statement read could not be resolved.");
    }

    if (existingRead.fingerprint !== input.fingerprint) {
      return { status: "different_file" };
    }

    if (
      existingRead.status === "processing" &&
      Date.now() - existingRead.updatedAt.getTime() < staleProcessingWindowMs
    ) {
      return { status: "already_processing" };
    }

    if (existingRead.status === "completed") {
      return { status: "already_completed" };
    }

    const [retriedRead] = await transaction
      .update(schema.bankStatementReads)
      .set({
        status: "processing",
        attemptCount: existingRead.attemptCount + 1,
        errorCode: null,
        completedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.bankStatementReads.id, existingRead.id))
      .returning();

    if (!retriedRead) {
      throw new Error("The failed bank statement read could not be retried.");
    }

    return { status: "claimed", read: retriedRead };
  });
}

async function markReadFailed(
  readId: string,
  errorCode:
    | "provider_unavailable"
    | "provider_rejected"
    | "invalid_extraction"
    | "unsupported_document",
): Promise<ReadRow> {
  const [failedRead] = await db
    .update(schema.bankStatementReads)
    .set({
      status: "failed",
      errorCode,
      updatedAt: new Date(),
      completedAt: new Date(),
    })
    .where(eq(schema.bankStatementReads.id, readId))
    .returning();

  if (!failedRead) {
    throw new Error("The failed bank statement read could not be updated.");
  }

  return failedRead;
}

export async function GET(): Promise<NextResponse> {
  const userId = await getSessionUserId();

  if (!userId) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 },
    );
  }

  const reads = await db
    .select()
    .from(schema.bankStatementReads)
    .where(eq(schema.bankStatementReads.userId, userId))
    .orderBy(desc(schema.bankStatementReads.createdAt));

  return NextResponse.json({ reads: reads.map(toPublicRead) });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const userId = await getSessionUserId();

  if (!userId) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 },
    );
  }

  if (activeReads >= maxConcurrentReadsPerServer) {
    return NextResponse.json(
      { error: "PDF processing is busy. Retry this file shortly." },
      { status: 429, headers: { "Retry-After": "10" } },
    );
  }

  activeReads += 1;

  try {
    return await processBankStatementRead(request, userId);
  } finally {
    activeReads -= 1;
  }
}

async function processBankStatementRead(
  request: NextRequest,
  userId: string,
): Promise<NextResponse> {
  if (
    request.headers.get("content-type")?.split(";")[0] !== "application/pdf"
  ) {
    return NextResponse.json(
      { error: "Upload one PDF file per request." },
      { status: 415 },
    );
  }

  const requestKey = uuidSchema.safeParse(request.headers.get("x-request-key"));
  const accountId = uuidSchema.safeParse(request.headers.get("x-account-id"));
  const fileName = decodeFileName(request.headers.get("x-file-name"));

  if (!requestKey.success || !accountId.success || !fileName) {
    return NextResponse.json(
      { error: "A request key, PDF filename, and account are required." },
      { status: 400 },
    );
  }

  const account = await db.query.accounts.findFirst({
    where: (accounts, { and: whereAnd, eq: whereEq }) =>
      whereAnd(
        whereEq(accounts.id, accountId.data),
        whereEq(accounts.userId, userId),
        whereEq(accounts.isActive, true),
      ),
  });

  if (!account) {
    return NextResponse.json(
      { error: "Active account not found." },
      { status: 404 },
    );
  }

  const contentLength = request.headers.get("content-length");

  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength)) {
      return NextResponse.json(
        { error: "Invalid content length." },
        { status: 400 },
      );
    }

    if (Number(contentLength) > maxBankStatementPdfBytes) {
      return NextResponse.json(
        { error: "The PDF exceeds the 20 MiB technical upload limit." },
        { status: 413 },
      );
    }
  }

  const pdfBytes = await readBoundedBody(request);

  if (!pdfBytes) {
    return NextResponse.json(
      { error: "The PDF exceeds the 20 MiB technical upload limit." },
      { status: 413 },
    );
  }

  if (
    pdfBytes.byteLength < 5 ||
    Buffer.from(pdfBytes.subarray(0, 5)).toString("ascii") !== "%PDF-"
  ) {
    return NextResponse.json(
      { error: "The uploaded file is not a valid PDF." },
      { status: 400 },
    );
  }

  const fingerprint = createHash("sha256")
    .update(account.id)
    .update("\0")
    .update(fileName)
    .update("\0")
    .update(pdfBytes)
    .digest("hex");
  const reservation = await reserveRead({
    userId,
    requestKey: requestKey.data,
    fileName,
    fingerprint,
    fileSizeBytes: pdfBytes.byteLength,
  });

  if (reservation.status !== "claimed") {
    const message = {
      different_file: "This request key was already used for a different PDF.",
      already_processing: "This PDF read is already in progress.",
      already_completed:
        "This PDF was already read; upload again to create a new preview.",
    }[reservation.status];

    return NextResponse.json({ error: message }, { status: 409 });
  }

  let extraction: Awaited<ReturnType<typeof extractBankStatementPdf>>;

  try {
    extraction = await extractBankStatementPdf(pdfBytes, fileName);
  } catch (error) {
    if (!(error instanceof BankStatementProviderError)) {
      await markReadFailed(reservation.read.id, "provider_rejected");
      throw error;
    }

    const failedRead = await markReadFailed(reservation.read.id, error.code);

    return NextResponse.json(
      { error: error.message, read: toPublicRead(failedRead) },
      { status: error.status },
    );
  }

  if (extraction.documentType !== "bank_statement") {
    const failedRead = await markReadFailed(
      reservation.read.id,
      "unsupported_document",
    );

    return NextResponse.json(
      {
        error: "Only bank account statements can be previewed in this flow.",
        read: toPublicRead(failedRead),
      },
      { status: 422 },
    );
  }

  const validated = validateBankStatementExtraction(
    { transactions: extraction.transactions },
    account.id,
  );

  if (!validated.success) {
    const failedRead = await markReadFailed(
      reservation.read.id,
      "invalid_extraction",
    );

    return NextResponse.json(
      {
        error: "The extraction result could not be validated.",
        validationIssues: validated.validationIssues,
        read: toPublicRead(failedRead),
      },
      { status: 502 },
    );
  }

  const { references } = await loadImportDuplicateContext(userId);
  const duplicateReviews = getImportDuplicateReviews(
    validated.items.map((item) => ({
      ...("candidate" in item
        ? item.candidate
        : {
            accountId: null,
            amountInCents: null,
            currency: null,
            type: null,
            occurredAt: null,
            description: null,
          }),
      id: null,
      sourceId: null,
      userId,
    })),
    references,
  );

  const [completedRead] = await db
    .update(schema.bankStatementReads)
    .set({
      status: "completed",
      candidateCount: validated.items.length,
      errorCode: null,
      updatedAt: new Date(),
      completedAt: new Date(),
    })
    .where(eq(schema.bankStatementReads.id, reservation.read.id))
    .returning();

  if (!completedRead) {
    throw new Error("The completed bank statement read could not be updated.");
  }

  return NextResponse.json({
    read: toPublicRead(completedRead),
    items: validated.items.map((item, index) => ({
      ...item,
      duplicateReview: duplicateReviews[index],
    })),
    postingBlocked: true,
    postingBlockers: importPostingBlockers,
  });
}
