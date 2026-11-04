export interface ImportCandidateReviewFields {
  accountId: string | null;
  amountInCents: number | null;
  currency: string | null;
  type: string | null;
  occurredAt: Date | null;
}

export function getImportCandidateValidationIssues(
  candidate: ImportCandidateReviewFields,
): string[] {
  const issues: string[] = [];

  if (candidate.amountInCents === null) issues.push("amount");
  if (candidate.currency === null) issues.push("currency");
  if (candidate.type === null) issues.push("direction");
  if (candidate.occurredAt === null) issues.push("date");
  if (candidate.accountId === null) issues.push("account");

  return issues;
}
