import type { ImportCandidateReviewFields } from "./import-candidate";

export interface ImportDuplicateSubject extends ImportCandidateReviewFields {
  id: string | null;
  userId: string;
  sourceId: string | null;
  description: string | null;
}

export interface ImportDuplicateReference extends ImportDuplicateSubject {
  id: string;
  targetType: "import_candidate" | "manual_transaction";
  sourceType: string | null;
}

export interface ImportDuplicateMatch {
  targetId: string;
  targetType: ImportDuplicateReference["targetType"];
  sourceType: string | null;
  description: string | null;
  occurredAt: string;
  amountInCents: number;
  reason: "same_fields" | "same_fields_and_description";
}

type Comparable = ImportDuplicateSubject & {
  accountId: string;
  amountInCents: number;
  occurredAt: Date;
};

function isComparable(item: ImportDuplicateSubject): item is Comparable {
  if (
    !item.accountId ||
    item.currency !== "EUR" ||
    (item.type !== "income" && item.type !== "expense") ||
    item.amountInCents === null ||
    !Number.isSafeInteger(item.amountInCents) ||
    item.amountInCents <= 0 ||
    !item.occurredAt ||
    !Number.isFinite(item.occurredAt.getTime())
  ) {
    return false;
  }

  return true;
}

function comparisonKey(item: Comparable): string {
  return JSON.stringify([
    item.userId,
    item.accountId,
    item.type,
    item.amountInCents,
    item.occurredAt.toISOString().slice(0, 10),
  ]);
}

function normalizedDescription(value: string | null): string {
  return (
    value?.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase() ?? ""
  );
}

export function getImportDuplicateReviews(
  subjects: ImportDuplicateSubject[],
  references: ImportDuplicateReference[],
): ImportDuplicateMatch[][] {
  const buckets = new Map<string, (ImportDuplicateReference & Comparable)[]>();

  for (const reference of references) {
    if (!isComparable(reference)) continue;
    const key = comparisonKey(reference);
    const bucket = buckets.get(key) ?? [];
    bucket.push(reference);
    buckets.set(key, bucket);
  }

  return subjects.map((subject) => {
    if (!isComparable(subject)) return [];
    const key = comparisonKey(subject);
    const description = normalizedDescription(subject.description);

    return (buckets.get(key) ?? [])
      .filter(
        (reference) =>
          !(
            reference.targetType === "import_candidate" &&
            (reference.id === subject.id ||
              (subject.sourceId !== null &&
                reference.sourceId === subject.sourceId))
          ),
      )
      .map((reference) => ({
        targetId: reference.id,
        targetType: reference.targetType,
        sourceType: reference.sourceType,
        description: reference.description,
        occurredAt: reference.occurredAt.toISOString(),
        amountInCents: reference.amountInCents,
        reason:
          description &&
          description === normalizedDescription(reference.description)
            ? "same_fields_and_description"
            : "same_fields",
      }));
  });
}
