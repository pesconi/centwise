"use client";

import type { ImportDuplicateMatch } from "@centwise/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { ImportDuplicateReview } from "@/components/import-duplicate-review";

interface Account {
  id: string;
  name: string;
  isActive: boolean;
}

interface BankStatementRead {
  id: string;
  requestKey: string;
  fileName: string;
  fileSizeBytes: number;
  status: "processing" | "completed" | "failed";
  candidateCount: number;
  attemptCount: number;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

interface PreviewCandidate {
  accountId: string | null;
  amountInCents: number | null;
  currency: "EUR" | null;
  type: "income" | "expense" | null;
  occurredAt: string | null;
  description: string | null;
}

interface PreviewItem {
  duplicateReview: ImportDuplicateMatch[];
  index: number;
  status: "invalid" | "needs_review" | "ready_for_review";
  candidate?: PreviewCandidate;
  categorySuggestion?: string | null;
  recurrenceSuggestion?: "possible_recurring" | "ordinary_spend" | "uncertain";
  evidence?: { pageNumber: number; excerpt: string };
  validationIssues: string[];
  reviewFlags: string[];
}

interface ReadListResponse {
  reads: BankStatementRead[];
}

interface UploadResponse {
  read: BankStatementRead;
  items: PreviewItem[];
  postingBlocked: true;
  postingBlockers: string[];
}

interface FileTask {
  file: File;
  requestKey: string;
  status: "queued" | "processing" | "completed" | "failed";
  error?: string;
}

async function requestJson<T>(input: RequestInfo | URL): Promise<T> {
  const response = await fetch(input);
  const payload: unknown = await response.json();

  if (!response.ok) {
    const error = payload as { error?: string };
    throw new Error(error.error ?? "The request could not be completed.");
  }

  return payload as T;
}

function formatCurrency(amountInCents: number | null): string {
  if (amountInCents === null) {
    return "Amount uncertain";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "EUR",
  }).format(amountInCents / 100);
}

function getReadStatusLabel(status: BankStatementRead["status"]): string {
  return {
    processing: "Processing",
    completed: "Read",
    failed: "Failed",
  }[status];
}

export function BankStatementUpload({ accounts }: { accounts: Account[] }) {
  const queryClient = useQueryClient();
  const activeAccounts = accounts.filter((account) => account.isActive);
  const [accountId, setAccountId] = useState(activeAccounts[0]?.id ?? "");
  const [fileTasks, setFileTasks] = useState<FileTask[]>([]);
  const [previews, setPreviews] = useState<UploadResponse[]>([]);
  const [uploading, setUploading] = useState(false);
  const readsQuery = useQuery({
    queryKey: ["bank-statement-reads"],
    queryFn: () => requestJson<ReadListResponse>("/api/bank-statement-reads"),
  });

  async function processFileTask(task: FileTask) {
    setFileTasks((current) =>
      current.map((item) =>
        item.requestKey === task.requestKey
          ? { ...item, status: "processing", error: undefined }
          : item,
      ),
    );

    try {
      const response = await fetch("/api/bank-statement-reads", {
        method: "POST",
        headers: {
          "Content-Type": "application/pdf",
          "X-Account-Id": accountId,
          "X-File-Name": encodeURIComponent(task.file.name),
          "X-Request-Key": task.requestKey,
        },
        body: task.file,
      });
      const payload: unknown = await response.json();

      if (!response.ok) {
        const errorPayload = payload as {
          error?: string;
          read?: BankStatementRead;
        };

        if (errorPayload.read) {
          queryClient.setQueryData<ReadListResponse>(
            ["bank-statement-reads"],
            (current) => ({
              reads: [
                errorPayload.read!,
                ...(current?.reads.filter(
                  (read) => read.id !== errorPayload.read!.id,
                ) ?? []),
              ],
            }),
          );
        }

        throw new Error(errorPayload.error ?? "The PDF could not be read.");
      }

      const result = payload as UploadResponse;

      queryClient.setQueryData<ReadListResponse>(
        ["bank-statement-reads"],
        (current) => ({
          reads: [
            result.read,
            ...(current?.reads.filter((read) => read.id !== result.read.id) ??
              []),
          ],
        }),
      );
      setPreviews((current) => [
        { ...result, read: { ...result.read, fileName: task.file.name } },
        ...current,
      ]);
      setFileTasks((current) =>
        current.map((item) =>
          item.requestKey === task.requestKey
            ? { ...item, status: "completed" }
            : item,
        ),
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "The PDF could not be read.";

      setFileTasks((current) =>
        current.map((item) =>
          item.requestKey === task.requestKey
            ? { ...item, status: "failed", error: message }
            : item,
        ),
      );
    } finally {
      await queryClient.invalidateQueries({
        queryKey: ["bank-statement-reads"],
      });
    }
  }

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!accountId || uploading) {
      return;
    }

    setUploading(true);

    for (const task of fileTasks) {
      if (task.status === "queued") {
        await processFileTask(task);
      }
    }

    setUploading(false);
  }

  function retryFailedTask(task: FileTask) {
    if (uploading || !accountId) {
      return;
    }

    setUploading(true);
    void processFileTask(task).finally(() => setUploading(false));
  }

  return (
    <section className="mb-8 grid gap-6 bg-white p-5 shadow-[0_20px_50px_-32px_rgba(23,33,29,0.45)] sm:p-7">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.12em] text-spruce">
          PDF preview
        </p>
        <h2 className="mt-1 text-xl font-semibold">Read a bank statement</h2>
        <p className="mt-2 text-sm text-ink/70">
          PDFs are sent to OpenAI for extraction. Originals and extracted
          transactions are not saved; only read status and file metadata are
          retained. Previews disappear when you leave this page.
        </p>
        <p className="mt-2 text-sm text-ink/70">
          OpenAI provider retention terms still apply. Use synthetic PDFs only
          during development; confirm production data handling before using real
          statements.
        </p>
        <p className="mt-2 text-sm text-ink/70">
          Files are processed sequentially. There is no file-count or page-count
          cap; a 20 MiB per-file technical cap and a 90-second processing
          timeout protect server resources. At most two files are processed at
          once per server process; provider output is capped at 12,000 tokens.
        </p>
      </div>

      <form className="grid gap-4" onSubmit={handleUpload}>
        <label className="grid gap-1 text-sm font-semibold">
          Account
          <select
            className="h-11 border border-ink/20 bg-canvas px-3 outline-none ring-spruce focus:ring-2"
            onChange={(event) => setAccountId(event.currentTarget.value)}
            required
            value={accountId}
          >
            <option disabled value="">
              Choose account
            </option>
            {activeAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          PDF files
          <input
            accept="application/pdf,.pdf"
            className="block w-full text-sm file:mr-4 file:border-0 file:bg-spruce file:px-4 file:py-2 file:font-semibold file:text-white"
            multiple
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files ?? []);
              setFileTasks(
                files.map((file) => ({
                  file,
                  requestKey: crypto.randomUUID(),
                  status: "queued",
                })),
              );
              setPreviews([]);
            }}
            type="file"
          />
        </label>

        {fileTasks.length > 0 ? (
          <ul className="grid gap-2 text-sm">
            {fileTasks.map((task) => (
              <li
                className="flex flex-wrap items-center justify-between gap-2 border-l-2 border-spruce/30 pl-3"
                key={task.requestKey}
              >
                <span>
                  {task.file.name} ·{" "}
                  {new Intl.NumberFormat("en-US").format(task.file.size)} bytes
                  · {task.status}
                  {task.error ? ` · ${task.error}` : ""}
                </span>
                {task.status === "failed" ? (
                  <button
                    className="font-semibold text-spruce underline underline-offset-4 disabled:opacity-60"
                    disabled={uploading}
                    onClick={() => retryFailedTask(task)}
                    type="button"
                  >
                    Retry
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        <button
          className="h-11 w-fit bg-spruce px-5 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
          disabled={
            uploading ||
            fileTasks.length === 0 ||
            activeAccounts.length === 0 ||
            fileTasks.every((task) => task.status !== "queued")
          }
          type="submit"
        >
          {uploading ? "Reading PDFs..." : "Read selected PDFs"}
        </button>
      </form>

      <div>
        <h3 className="text-lg font-semibold">Files read</h3>
        {readsQuery.isLoading ? (
          <p className="mt-2 text-sm text-ink/60">Loading file history...</p>
        ) : null}
        {readsQuery.isError ? (
          <p className="mt-2 text-sm text-red-700">
            {readsQuery.error.message}
          </p>
        ) : null}
        {readsQuery.isSuccess && readsQuery.data.reads.length === 0 ? (
          <p className="mt-2 text-sm text-ink/60">No PDFs have been read.</p>
        ) : null}
        {readsQuery.data?.reads.length ? (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-ink/15 text-ink/60">
                  <th className="py-2 pr-4 font-medium">File</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium">Candidates</th>
                  <th className="py-2 pr-4 font-medium">Attempts</th>
                  <th className="py-2 font-medium">Last update</th>
                </tr>
              </thead>
              <tbody>
                {readsQuery.data.reads.map((read) => (
                  <tr className="border-b border-ink/10" key={read.id}>
                    <td className="py-2 pr-4">{read.fileName}</td>
                    <td className="py-2 pr-4">
                      {getReadStatusLabel(read.status)}
                      {read.errorCode ? ` · ${read.errorCode}` : ""}
                    </td>
                    <td className="py-2 pr-4">{read.candidateCount}</td>
                    <td className="py-2 pr-4">{read.attemptCount}</td>
                    <td className="py-2">
                      {new Date(read.updatedAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      {previews.map((preview) => (
        <section
          className="border-t border-ink/10 pt-5"
          key={preview.read.requestKey}
        >
          <h3 className="text-lg font-semibold">
            Preview: {preview.read.fileName}
          </h3>
          <p className="mt-1 text-sm text-clay">
            Preview only — no transactions, inbox approvals, or recurring rules
            are created. Posting remains blocked.
          </p>
          <ul className="mt-3 divide-y divide-ink/10">
            {preview.items.length === 0 ? (
              <li className="py-4 text-sm text-ink/60">
                No transaction rows were detected in this statement.
              </li>
            ) : null}
            {preview.items.map((item) => (
              <li className="py-4" key={item.index}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h4 className="font-semibold">
                    {item.candidate?.description ?? "Uncertain transaction"}
                  </h4>
                  <span className="text-sm font-semibold">
                    {formatCurrency(item.candidate?.amountInCents ?? null)}
                    {item.candidate?.type ? ` · ${item.candidate.type}` : ""}
                  </span>
                </div>
                <p className="mt-1 text-sm text-ink/60">
                  {item.status.replaceAll("_", " ")}
                  {item.candidate?.occurredAt
                    ? ` · ${new Date(item.candidate.occurredAt).toLocaleDateString()}`
                    : ""}
                  {item.evidence
                    ? ` · Page ${item.evidence.pageNumber}: ${item.evidence.excerpt}`
                    : ""}
                </p>
                {item.validationIssues.length > 0 ? (
                  <p className="mt-1 text-sm text-clay">
                    Needs review: {item.validationIssues.join(", ")}
                  </p>
                ) : null}
                {item.reviewFlags.map((flag) => (
                  <p className="mt-1 text-sm text-clay" key={flag}>
                    {flag === "possible_duplicate_in_statement"
                      ? "Possible duplicate row; both rows are retained for review."
                      : "Possible internal transfer; verify before any future posting."}
                  </p>
                ))}
                <ImportDuplicateReview matches={item.duplicateReview} />
                <p className="mt-1 text-sm text-ink/60">
                  Category: {item.categorySuggestion ?? "uncertain"} ·
                  Recurrence: {item.recurrenceSuggestion ?? "uncertain"}{" "}
                  (suggestions only)
                </p>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </section>
  );
}
