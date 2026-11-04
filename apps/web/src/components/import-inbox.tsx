"use client";

import { importPostingBlockers } from "@centwise/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useState } from "react";

import { BankStatementUpload } from "@/components/bank-statement-upload";

interface ImportSource {
  sourceType: string;
  sourceEventKey: string;
  capturedAt: string;
  parserVersion: string | null;
  evidence: Record<string, string>;
}

interface ImportCandidate {
  id: string;
  accountId: string | null;
  amountInCents: number | null;
  currency: "EUR" | null;
  type: "income" | "expense" | null;
  occurredAt: string | null;
  description: string | null;
  status:
    | "pending_review"
    | "needs_information"
    | "duplicate"
    | "approved"
    | "rejected"
    | "failed";
  postingStatus: "blocked";
  validationIssues: string[];
  rejectionReason: string | null;
  source: ImportSource;
}

interface Account {
  id: string;
  name: string;
  isActive: boolean;
}

interface CandidateResponse {
  candidates: ImportCandidate[];
  postingBlocked: boolean;
  postingBlockers: string[];
}

async function requestJson<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(input, init);
  const payload: unknown = await response.json();

  if (!response.ok) {
    const error = payload as { error?: string };
    throw new Error(error.error ?? "The request could not be completed.");
  }

  return payload as T;
}

function formatCurrency(amountInCents: number | null): string {
  if (amountInCents === null) {
    return "Amount needed";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "EUR",
  }).format(amountInCents / 100);
}

function toLocalDateTime(value: string | null): string {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

function getStatusLabel(status: ImportCandidate["status"]): string {
  return {
    pending_review: "Pending review",
    needs_information: "Needs information",
    duplicate: "Possible duplicate",
    approved: "Approved",
    rejected: "Rejected",
    failed: "Import failed",
  }[status];
}

function getSourceLabel(sourceType: string): string {
  return (
    {
      bank_sms: "Bank SMS",
      bank_notification: "Bank notification",
      bank_statement_pdf: "Bank statement PDF",
      card_statement_pdf: "Card statement PDF",
      bill_pdf: "Bill PDF",
    }[sourceType] ?? "Import source"
  );
}

export function ImportInbox() {
  const queryClient = useQueryClient();
  const [correctionErrors, setCorrectionErrors] = useState<
    Record<string, string>
  >({});
  const sessionQuery = useQuery({
    queryKey: ["import-session"],
    queryFn: async () => {
      const response = await fetch("/api/auth/session");

      if (response.status === 401) {
        return false;
      }

      if (!response.ok) {
        throw new Error("Could not load your session.");
      }

      return true;
    },
  });
  const isAuthenticated = sessionQuery.data === true;
  const candidatesQuery = useQuery({
    queryKey: ["import-candidates"],
    queryFn: () => requestJson<CandidateResponse>("/api/import-candidates"),
    enabled: isAuthenticated,
  });
  const accountsQuery = useQuery({
    queryKey: ["accounts"],
    queryFn: () => requestJson<{ accounts: Account[] }>("/api/accounts"),
    enabled: isAuthenticated,
  });
  const correctionMutation = useMutation({
    mutationFn: ({
      candidateId,
      correction,
    }: {
      candidateId: string;
      correction: {
        accountId: string | null;
        amountInCents: number;
        currency: "EUR";
        type: "income" | "expense";
        occurredAt: string;
        description: string | null;
      };
    }) =>
      requestJson<{ candidate: ImportCandidate }>(
        `/api/import-candidates/${candidateId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(correction),
        },
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["import-candidates"] });
    },
  });
  const rejectMutation = useMutation({
    mutationFn: ({
      candidateId,
      reason,
    }: {
      candidateId: string;
      reason?: string;
    }) =>
      requestJson<{ candidate: ImportCandidate }>(
        `/api/import-candidates/${candidateId}/reject`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: reason || undefined }),
        },
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["import-candidates"] });
    },
  });

  function handleCorrection(
    event: FormEvent<HTMLFormElement>,
    candidate: ImportCandidate,
  ) {
    event.preventDefault();
    correctionMutation.reset();

    const formData = new FormData(event.currentTarget);
    const amountInCents = Math.round(Number(formData.get("amount")) * 100);
    const occurredAtInput = String(formData.get("occurredAt") ?? "");
    const occurredAt = new Date(occurredAtInput);
    const type = String(formData.get("type"));
    const accountIdValue = String(formData.get("accountId") ?? "");

    if (
      !Number.isSafeInteger(amountInCents) ||
      amountInCents <= 0 ||
      !occurredAtInput ||
      Number.isNaN(occurredAt.getTime()) ||
      (type !== "income" && type !== "expense")
    ) {
      setCorrectionErrors((errors) => ({
        ...errors,
        [candidate.id]: "Enter a positive amount, direction, and valid date.",
      }));
      return;
    }

    setCorrectionErrors((errors) => ({ ...errors, [candidate.id]: "" }));
    correctionMutation.mutate({
      candidateId: candidate.id,
      correction: {
        accountId: accountIdValue || null,
        amountInCents,
        currency: "EUR",
        type,
        occurredAt: occurredAt.toISOString(),
        description: String(formData.get("description") ?? "").trim() || null,
      },
    });
  }

  function handleReject(form: HTMLFormElement, candidateId: string) {
    const reason = String(
      new FormData(form).get("rejectionReason") ?? "",
    ).trim();

    rejectMutation.mutate({ candidateId, reason: reason || undefined });
  }

  return (
    <main className="min-h-screen bg-[linear-gradient(125deg,#f7f7f2_0%,#edf4ee_52%,#f7f7f2_100%)] px-5 py-8 sm:px-8 lg:px-12">
      <div className="mx-auto max-w-5xl">
        <header className="mb-8 flex flex-col gap-4 border-b border-ink/10 pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="mb-2 text-sm font-semibold uppercase tracking-[0.16em] text-spruce">
              Centwise
            </p>
            <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
              Import inbox
            </h1>
          </div>
          <a
            className="text-sm font-semibold text-spruce underline underline-offset-4"
            href="/"
          >
            Back to dashboard
          </a>
        </header>

        {sessionQuery.isLoading ? (
          <p className="py-12 text-center text-ink/60">
            Checking your session...
          </p>
        ) : null}
        {sessionQuery.isError ? (
          <p className="py-12 text-center text-red-700">
            {sessionQuery.error.message}
          </p>
        ) : null}
        {sessionQuery.data === false ? (
          <section className="bg-white p-6 shadow-[0_20px_50px_-32px_rgba(23,33,29,0.45)]">
            <h2 className="text-xl font-semibold">Sign in to review imports</h2>
            <p className="mt-2 text-ink/65">
              Your import inbox is private to your account.
            </p>
          </section>
        ) : null}

        {isAuthenticated ? (
          <>
            <section className="mb-8 border-l-4 border-clay bg-white p-5 shadow-[0_20px_50px_-32px_rgba(23,33,29,0.45)]">
              <h2 className="font-semibold">Posting is disabled</h2>
              <p className="mt-1 text-sm text-ink/70">
                Balance-date and settlement policies are decided. Imported
                candidates still cannot create transactions until reconciliation
                and atomic approval are implemented.
              </p>
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-ink/70">
                {(
                  candidatesQuery.data?.postingBlockers ?? importPostingBlockers
                ).map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
            </section>

            {accountsQuery.isSuccess ? (
              <BankStatementUpload accounts={accountsQuery.data.accounts} />
            ) : null}

            {candidatesQuery.isLoading || accountsQuery.isLoading ? (
              <p className="py-12 text-center text-ink/60">
                Loading your import inbox...
              </p>
            ) : null}
            {candidatesQuery.isError || accountsQuery.isError ? (
              <p className="py-12 text-center text-red-700">
                {candidatesQuery.error?.message ?? accountsQuery.error?.message}
              </p>
            ) : null}
            {candidatesQuery.isSuccess &&
            accountsQuery.isSuccess &&
            candidatesQuery.data.candidates.length === 0 ? (
              <section className="bg-white/70 p-8 text-center">
                <h2 className="text-xl font-semibold">
                  No import candidates yet
                </h2>
                <p className="mt-2 text-sm text-ink/60">
                  No persistent inbox candidates are available. PDF extraction
                  above returns an in-memory preview only.
                </p>
              </section>
            ) : null}

            <div className="grid gap-5">
              {candidatesQuery.data?.candidates.map((candidate) => {
                const isEditable =
                  candidate.status === "pending_review" ||
                  candidate.status === "needs_information";
                const activeAccounts =
                  accountsQuery.data?.accounts.filter(
                    (account) => account.isActive,
                  ) ?? [];

                return (
                  <article
                    className="bg-white p-5 shadow-[0_20px_50px_-32px_rgba(23,33,29,0.45)] sm:p-7"
                    key={candidate.id}
                  >
                    <div className="mb-5 flex flex-wrap items-start justify-between gap-3 border-b border-ink/10 pb-4">
                      <div>
                        <p className="text-sm font-semibold uppercase tracking-[0.12em] text-spruce">
                          {getSourceLabel(candidate.source.sourceType)}
                        </p>
                        <h2 className="mt-1 text-xl font-semibold">
                          {candidate.description || "Unlabeled transaction"}
                        </h2>
                        <p className="mt-1 text-sm text-ink/60">
                          Captured{" "}
                          {new Date(
                            candidate.source.capturedAt,
                          ).toLocaleString()}
                          {candidate.source.parserVersion
                            ? ` · Parser ${candidate.source.parserVersion}`
                            : ""}
                        </p>
                      </div>
                      <span className="bg-canvas px-3 py-1 text-sm font-semibold">
                        {getStatusLabel(candidate.status)}
                      </span>
                    </div>

                    {candidate.source.evidence &&
                    Object.keys(candidate.source.evidence).length > 0 ? (
                      <dl className="mb-5 grid gap-2 border-l-2 border-spruce/30 pl-4 text-sm sm:grid-cols-2">
                        {Object.entries(candidate.source.evidence).map(
                          ([label, value]) => (
                            <div key={label}>
                              <dt className="text-ink/55">{label}</dt>
                              <dd className="font-medium">{value}</dd>
                            </div>
                          ),
                        )}
                      </dl>
                    ) : null}

                    {isEditable ? (
                      <form
                        className="grid gap-4"
                        onSubmit={(event) => handleCorrection(event, candidate)}
                      >
                        {activeAccounts.length === 0 ? (
                          <p className="text-sm text-clay">
                            Create an active account on the dashboard before
                            assigning this candidate.
                          </p>
                        ) : null}
                        <div className="grid gap-4 sm:grid-cols-2">
                          <label className="grid gap-1 text-sm font-semibold">
                            Amount (EUR)
                            <input
                              className="h-11 border border-ink/20 bg-canvas px-3 outline-none ring-spruce focus:ring-2"
                              defaultValue={
                                candidate.amountInCents === null
                                  ? ""
                                  : (candidate.amountInCents / 100).toFixed(2)
                              }
                              min="0.01"
                              name="amount"
                              required
                              step="0.01"
                              type="number"
                            />
                          </label>
                          <label className="grid gap-1 text-sm font-semibold">
                            Direction
                            <select
                              className="h-11 border border-ink/20 bg-canvas px-3 outline-none ring-spruce focus:ring-2"
                              defaultValue={candidate.type ?? ""}
                              name="type"
                              required
                            >
                              <option disabled value="">
                                Choose direction
                              </option>
                              <option value="expense">Expense</option>
                              <option value="income">Income</option>
                            </select>
                          </label>
                          <label className="grid gap-1 text-sm font-semibold">
                            Date and time
                            <input
                              className="h-11 border border-ink/20 bg-canvas px-3 outline-none ring-spruce focus:ring-2"
                              defaultValue={toLocalDateTime(
                                candidate.occurredAt,
                              )}
                              name="occurredAt"
                              required
                              type="datetime-local"
                            />
                          </label>
                          <label className="grid gap-1 text-sm font-semibold">
                            Account
                            <select
                              className="h-11 border border-ink/20 bg-canvas px-3 outline-none ring-spruce focus:ring-2"
                              defaultValue={candidate.accountId ?? ""}
                              name="accountId"
                              required
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
                            Description
                            <input
                              className="h-11 border border-ink/20 bg-canvas px-3 outline-none ring-spruce focus:ring-2"
                              defaultValue={candidate.description ?? ""}
                              maxLength={500}
                              name="description"
                            />
                          </label>
                          <div className="grid content-center gap-1 text-sm">
                            <span className="font-semibold">Currency</span>
                            <span className="text-ink/70">
                              EUR only. No conversion is performed.
                            </span>
                          </div>
                        </div>
                        {candidate.validationIssues.length > 0 ? (
                          <p className="text-sm text-clay">
                            Needs review:{" "}
                            {candidate.validationIssues.join(", ")}
                          </p>
                        ) : null}
                        {correctionErrors[candidate.id] ? (
                          <p className="text-sm text-red-700">
                            {correctionErrors[candidate.id]}
                          </p>
                        ) : null}
                        <label className="grid gap-1 text-sm font-semibold">
                          Rejection reason (optional)
                          <input
                            className="h-10 border border-ink/20 bg-canvas px-3 outline-none ring-spruce focus:ring-2"
                            maxLength={500}
                            name="rejectionReason"
                          />
                        </label>
                        <div className="flex flex-wrap gap-3">
                          <button
                            className="h-10 bg-spruce px-4 font-semibold text-white transition hover:bg-ink disabled:cursor-not-allowed disabled:opacity-60"
                            disabled={
                              correctionMutation.isPending ||
                              activeAccounts.length === 0
                            }
                            type="submit"
                          >
                            {correctionMutation.isPending
                              ? "Saving..."
                              : "Save corrections"}
                          </button>
                          <button
                            className="h-10 border border-clay px-4 font-semibold text-clay transition hover:bg-clay hover:text-white disabled:opacity-60"
                            disabled={rejectMutation.isPending}
                            onClick={(event) => {
                              const form = event.currentTarget.form;
                              if (form) handleReject(form, candidate.id);
                            }}
                            type="button"
                          >
                            Reject
                          </button>
                          <button
                            className="h-10 border border-ink/20 px-4 font-semibold text-ink/45"
                            disabled
                            type="button"
                          >
                            Posting disabled
                          </button>
                        </div>
                        {correctionMutation.isError ? (
                          <p className="text-sm text-red-700">
                            {correctionMutation.error.message}
                          </p>
                        ) : null}
                        {rejectMutation.isError ? (
                          <p className="text-sm text-red-700">
                            {rejectMutation.error.message}
                          </p>
                        ) : null}
                      </form>
                    ) : (
                      <div className="grid gap-2 text-sm text-ink/70">
                        <p>
                          {formatCurrency(candidate.amountInCents)} ·{" "}
                          {candidate.type ?? "Direction needed"} ·{" "}
                          {candidate.occurredAt
                            ? new Date(candidate.occurredAt).toLocaleString()
                            : "Date needed"}
                        </p>
                        {candidate.rejectionReason ? (
                          <p>Reason: {candidate.rejectionReason}</p>
                        ) : null}
                        <p>Source event: {candidate.source.sourceEventKey}</p>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </>
        ) : null}
      </div>
    </main>
  );
}
