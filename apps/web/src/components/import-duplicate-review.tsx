import type { ImportDuplicateMatch } from "@centwise/core";

export function ImportDuplicateReview({
  matches,
}: {
  matches: ImportDuplicateMatch[];
}) {
  if (matches.length === 0) return null;

  return (
    <aside className="my-4 border-l-4 border-clay bg-canvas p-4 text-sm">
      <h3 className="font-semibold">Possible duplicates — review only</h3>
      <p className="mt-1 text-ink/70">
        Same account, EUR amount, direction and UTC day. These may be separate
        purchases. Nothing is merged, removed, linked or approved.
      </p>
      <ul className="mt-3 space-y-3">
        {matches.map((match) => (
          <li key={`${match.targetType}:${match.targetId}`}>
            <p className="font-medium">
              {match.targetType === "manual_transaction"
                ? "Manual transaction"
                : `Import: ${match.sourceType?.replaceAll("_", " ")}`}
              {" · "}
              {match.description || "Unlabeled transaction"}
            </p>
            <p className="text-ink/70">
              {new Intl.NumberFormat("en-US", {
                style: "currency",
                currency: "EUR",
              }).format(match.amountInCents / 100)}
              {" · "}
              {match.occurredAt.slice(0, 10)} (UTC)
              {" · "}
              {match.reason === "same_fields_and_description"
                ? "Description also matches; verify the source evidence."
                : "Field coincidence only; not proof of a duplicate."}
            </p>
            {match.targetType === "import_candidate" ? (
              <a
                className="text-spruce underline"
                href={`#import-${match.targetId}`}
              >
                Compare source evidence
              </a>
            ) : (
              <p className="break-all text-xs text-ink/55">
                Transaction ID: {match.targetId}
              </p>
            )}
          </li>
        ))}
      </ul>
    </aside>
  );
}
