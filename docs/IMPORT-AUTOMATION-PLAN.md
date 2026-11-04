# Bank message and PDF import plan

Date: 2026-11-04
Status: reviewed-inbox foundation and authenticated, preview-only PDF reads implemented; mobile capture and posting remain planned.

## Confirmed scope

- Android first, installed directly as an APK.
- Capture both bank SMS messages and bank application notifications.
- Import bank statements, credit-card statements, and bills as PDFs.
- Require review before posting initially. Automatic posting of trusted patterns is a later, separately enabled feature.
- Preserve manual entry and editing as correction/fallback paths.
- Keep monetary values in integer cents and EUR. Do not silently convert other currencies.

## Current repository constraints

- The Expo mobile application is a placeholder, without authentication or native capture.
- Web authentication uses an HTTP-only session cookie; mobile needs a deliberately implemented authenticated session and device lifecycle.
- Existing transactions require an owned account. Recurring bills/income are forecasts, not payment records.
- The spending engine deducts remaining recurring bills independently of recorded transactions. Imported payments must not cause both a transaction deduction and the same forecast deduction.
- No document storage or background worker exists. Recurring occurrences and settlement links are implemented, but import approval still needs duplicate/reconciliation policy and atomic posting.
- New accounts have an explicit start-of-day UTC opening-balance boundary; legacy accounts retain a null
  date until balance/date confirmation. Pre-boundary movements are history only, never additional cash.
- The web inbox persists authenticated source events and review candidates with exact-event retry idempotency. A separate PDF flow now tracks read metadata and returns extraction previews without persisting PDFs or extracted candidates.

## Target flow

Android capture or PDF upload -> source event/document -> extraction -> validated candidate
-> duplicate/reconciliation checks -> review inbox -> atomic approval -> financial records.

Capture and extraction do not directly write transactions. Each candidate retains provenance and a visible status:
pending review, needs information, duplicate, approved, rejected, or failed.
Retries must not create additional financial records. Failed extraction is not an empty successful import.

## 1. Shared import foundation and financial correctness

Build the backend inbox and minimal web review UI first, tested with synthetic fixtures.

- Persist import sources, source identifiers/fingerprints, candidate fields, parser/model version,
  extraction evidence, validation issues, review decisions, and the final linked financial record.
- Derive user ownership from authentication, including owned account, device, and document checks.
- Use a unique user/source event key for exact retry idempotency. Amount/date similarity alone
  must not suppress two legitimate equal purchases.
- Surface likely cross-source duplicates for review: SMS plus notification, PDF plus message,
  and previously entered manual transactions. Preserve evidence from all linked sources.
- Approval is transactional and repeat-safe, including concurrent requests.
- Allow correction of amount, direction, date, description, and account before approval.
- Never infer debit/credit from the bank balance shown in a message.
- Store source transaction date/time separately from capture time; require review if date,
  account, currency, or direction is ambiguous.
- Introduce an explicit account balance effective date and historical-import policy before
  applying older movements. Historical evidence may inform forecasts without changing today's balance.
- Represent expected monthly occurrences and their settlement links so a matched payment
  replaces the outstanding obligation rather than being deducted twice. Cover partial payments,
  edited payments, deleted payments, income receipts, and month-end day clamping.
- Do not create a recurring rule from a single transaction without confirmation.

Credit cards need a product decision before posting card PDFs: purchases, card liability,
statement settlement, and transfers between owned accounts cannot all be treated as independent expenses.
Until that model is approved, card documents may create review candidates and forecast suggestions,
but not automatic financial postings. Apply the same review restriction to suspected internal transfers.

Acceptance: identical retry/concurrent approval creates exactly one posting; equal independent purchases
remain separate; settled obligations are counted once; pre-balance history does not change current cash.

Foundation delivered: identical concurrent source-event retries create one candidate; reusing the event
key with a changed payload conflicts; a different key is never merged based on amount/date. Candidate
correction and rejection are available. Posting remains blocked in both the API and database until
recurring-obligation reconciliation and atomic approval are implemented. The balance-date and settlement
policies are now approved (see below); the opening-balance boundary is implemented. Cross-source
duplicate linking, failed extraction records, and approval/posting are not implemented.

### Approved policy and current slice

- Opening balance means the start of the selected date, at **00:00 UTC**. Earlier movements remain
  visible history with no cash impact; movements on that date count. Each account has its own date.
  A future effective balance does not count before its date. Never infer legacy dates: null dates
  preserve old calculations until explicit confirmation of both balance and date.
- Explicit monthly-occurrence links will reconcile both expenses and income. Part-payments leave
  only the unpaid remainder; overpayments do not create negative outstanding forecasts. Settling
  for less requires an explicit decision and does not rewrite the recurring rule.
- Linked payment edits must recalculate atomically, deletions reopen the obligation, and changes of
  account/direction/month require explicit reconciliation. Revisit exceptional short-payment settlement
  after edits. Rule edits/deactivation must not erase already reconciled occurrences.
- Unpaid expenses remain reserved after the due date and across months until settled/cancelled.
  Overdue unreceived income is not added to spendable cash unless received or rescheduled.

### Implemented monthly occurrence and settlement slice

- `recurring_occurrences` stores a monthly snapshot for each recurring rule, with an explicit linked
  transaction relation. Database uniqueness makes current-month materialization idempotent under
  concurrent plan requests; day 29–31 is clamped to the last calendar day.
- The initial cutover is the current UTC date. The authenticated free-to-spend request materializes only
  current-month occurrences scheduled today or later; it does not infer previous obligations or
  transactions. Following months are materialized when that month's plan is requested. Existing rows
  survive recurring-rule edits and deactivation.
- Settlements are explicit occurrence links, never inferred from matching amount/date. Partial payments
  reduce only the remaining amount; overpayments affect actual cash once and outstanding amounts clamp
  to zero. A smaller-than-expected settlement requires an explicit action. Editing a linked transaction
  recalculates atomically; deletion reopens the balance. Account, direction and month changes require
  explicit reconciliation. Cross-month rescheduling is rejected while linked transactions remain.
- Open bills stay reserved when overdue and across months. Unreceived income due today or earlier does
  not increase spendable funds unless received or explicitly rescheduled. Historical pre-opening-date
  transactions and future-dated movements do not change current cash or settle occurrences.
- The dashboard allows explicit payments/receipts, short settlement, cancellation, rescheduling and
  future-rule edits. Rule edits do not rewrite existing occurrences. Import approval remains blocked in
  the API and database. Cross-source/manual duplicate reconciliation, card posting and suspicious
  internal-transfer posting are still not implemented.
- At the user's request, only the 5 existing local development transaction rows were deleted; accounts,
  rules, settings and inbox records were preserved. The database target was verified as
  `localhost:5433/centwise`; synthetic integration transactions were cleaned afterward.

The occurrence layer is materialized lazily by the free-to-spend API; no background job exists. Visual
validation of the dashboard is pending user manual review after two browser-action timeouts. Do not
commit until the user confirms that review. Posting must remain blocked until cross-source ambiguity
handling and atomic/concurrent approval are implemented and verified. Never deduplicate or resolve a
collision solely by amount/date.

## 2. Android capture

- Add mobile login, secure session storage, device pairing/revocation, and authenticated sync over HTTPS.
- Use a local native Expo module/config plugin and locally built Android APK; Expo Go cannot run
  arbitrary new native receivers/services. Check compatibility against the installed Expo SDK.
- SMS: receive new SMS with explicitly granted receive permission; reconstruct multipart messages.
  Do not request historical SMS reading for this initial scope.
- Bank notifications: use Android NotificationListenerService with access enabled by the user
  in system settings. This is separate from permission to display the app's own notifications.
- Let the user select bank applications/senders. Filter locally before persisting or syncing.
  Ignore OTPs, verification codes, marketing, and unrelated notifications.
- Parse known bank templates deterministically on the device when practical. Sender names alone
  do not prove authenticity; all candidates still require review initially.
- Store a protected, bounded offline queue with stable event IDs; retry with backoff and acknowledgments.
  Treat notification updates/reposts as updates or duplicates, not additional purchases.
- Provide visible capture/permission/sync status, pause controls, and deletion/disconnect actions.
- Do not promise complete capture: hidden text, revoked access, force-stop, OEM battery policies,
  RCS rather than SMS, and missed/disconnected notifications can prevent collection.

Acceptance on a real Android device: synthetic SMS/notification, multipart SMS, repost, offline retry,
permission denial/revocation, app restart, and duplicate SMS+notification all behave as documented.
No bank credentials or accessibility-service scraping is required.

## 3. PDF import and review

The first slice is an authenticated, read-only bank-statement preview using the user's preferred
OpenAI API. It validates the active account and PDF signature, sends bytes directly to the Responses
API with `store: false`, and gives the model no tools or write access. Document contents are untrusted
input, not instructions. The original PDF and extracted transaction values are not persisted; the
browser holds candidates only for the current page view, while the database stores read metadata.

The current slice returns explicit failure states for unsupported document types, provider errors, and
invalid schema output. Incomplete rows remain reviewable; malformed rows and non-EUR amounts are
invalid. Transfer-like rows and same-direction/EUR-amount/UTC-date matches are flagged, but no rows are
removed. Selected files are processed sequentially. There is no product cap on number of files or PDF
pages; technical safeguards are a 20 MiB per-file maximum, 90-second provider timeout, two concurrent
reads per server process, and 12,000 output tokens. Large statements may fail explicitly if the provider
cannot complete within these limits; never treat truncated output as success.

Future work, before any posting:

- Reconcile overlaps and likely duplicates against other import sources and manually entered
  transactions. Similarity must prompt review, never merge transactions based only on amount/date.
- Detect and distinguish posted account movements from opening/closing balances, subtotals, forecasts,
  card settlements, and internal transfers.
- Add correction and provenance handling for persistent PDF candidates only if the product explicitly
  needs those values retained. Keep original PDFs and extracted text out of storage, logs and telemetry.
- Test synthetic selectable-text, scanned, encrypted/unreadable, malformed, overlapping, and instruction-
  like PDFs. Do not use real statements or credentials during development.
- Keep OpenAI credentials server-side. Confirm provider data-retention terms before processing real
  statements in production.

Acceptance: malformed files, provider timeouts, uncertain rows, repeated rows, unsupported currencies,
and instruction-like PDF text produce review/failure states, never silent partial results or financial
postings. Retry of an identical failed request must update one read record, not create financial data.

## 4. Recurring-spend prediction

- Analyze reviewed, deduplicated historical movements and confirmed bill documents.
- Suggest recurring merchant, expected date/window, frequency, typical amount/range, and variability,
  with evidence and explanation. Allow rejection and correction.
- Match against existing recurring rules before offering a new one.
- Distinguish forecast changes from already settled occurrences.
- Start with deterministic recurrence detection on reviewed history; add model assistance only where
  measured extraction or matching quality warrants it.
- Require confirmation before a suggestion changes protected funds/free-to-spend.
- Later automation is opt-in per trusted source/template, with measurable fixture accuracy,
  auditability, undo, and fallback to review for ambiguity or changed message formats.
  Model self-reported confidence is not an approval criterion.

## Delivery order and validation

1. The approved balance-date and occurrence/settlement slices and the first PDF preview slice are
   implemented. Next add cross-source/manual duplicate review and reconciliation, then separately verify
   atomic and concurrent posting.
2. Mobile authentication and one known bank's SMS format, then notification capture and offline sync.
3. Expand PDF review/reconciliation; card posting remains gated.
4. Recurrence suggestions and only then opt-in automation.

Implement one validated, documented commit-sized slice per session. No broad mobile parity or
bank API integrations are implied. Before each slice, confirm any unresolved behavior choices.

Run focused schema/parser/API/calculation tests and workspace typecheck. Exercise ownership isolation,
concurrent approvals, duplicate evidence, amount signs, decimal formats, month boundaries, negative
balances, paid/part-paid forecasts, and edits/deletions of linked transactions.
Use synthetic fixtures; perform real-device capture and focused mobile/desktop review-UI checks.
Apply generated migrations to local PostgreSQL before committing schema changes.

## Decisions needed before enabling posting or later integrations

- First bank application/sender and synthetic examples of its message formats.
- Card/transfer accounting behavior (balance-date and settlement semantics are approved above).
- Android device/version and backend connectivity while away from home.
- OpenAI account data-retention terms and production processing policy before using real statements.

The current PDF preview has no product cap on file count or page count. Technical safeguards are 20 MiB
per file, a 90-second provider timeout, at most two simultaneous reads per server process, and a 12,000
token output ceiling; provider-specific constraints may also apply. The uploaded PDF is sent directly
to the OpenAI Responses API with `store: false`. The server stores only sanitized filename, file size,
SHA-256 request fingerprint, status, counts, and retry metadata. It stores neither PDF bytes nor
extracted transaction values. Previews exist only in the browser until leaving the page.

Use synthetic PDFs only in development and never use real statements or credentials in tests. OpenAI
credentials stay server-side. Card/bill PDFs are rejected by the preview flow; suspected transfers and
same-date/amount rows are flagged for review, not removed or posted. Inbox approval remains blocked.

Recommended next session: continue from the latest handoff section. Keep posting disabled; any future
work that persists candidates must separately define duplicate/reconciliation review and atomic,
repeat-safe approval. Mobile capture and card accounting remain separate slices.

## Platform references

- [Android notification listener](https://developer.android.com/reference/android/service/notification/NotificationListenerService)
- [Android SMS intents](https://developer.android.com/reference/android/provider/Telephony.Sms.Intents)
- [Expo development builds](https://docs.expo.dev/develop/development-builds/introduction/)

## Bank statement extraction contract foundation (2026-11-04)

The core now validates structured extraction output against a transaction-shaped contract using
synthetic data. Rows keep page/excerpt evidence, a free-text category suggestion, and an explicitly
unconfirmed recurrence suggestion. Missing fields are reviewable; malformed rows and non-EUR currency
are rejected for correction. The extractor cannot select an owned account or recurring occurrence.
Equal amount/date rows remain separate, and validation never writes transactions or approves inbox
candidates.

This contract is now used by the authenticated PDF preview flow documented below. Extraction remains
read-only: account ownership comes from the authenticated session and the selected active account is
validated server-side. The model cannot assign accounts or occurrence IDs. Rows with equal direction,
EUR amount, and UTC date are retained and flagged as possible duplicates; transfer-like descriptions
are flagged for review. Neither flag approves a row or changes posting state.

## Authenticated PDF preview slice (2026-11-04)

The `/api/bank-statement-reads` route accepts one PDF body per authenticated request. It checks active
account ownership, content type, PDF signature, request-key idempotency, and a bounded byte stream
before calling the OpenAI Responses API. Provider output is schema-validated and returned as an
in-memory preview. Failed requests can be retried with the same request key and identical file/account;
completed keys cannot create another preview. Different content under the same key conflicts.

`bank_statement_reads` persists file metadata and processing state only. It has a user-scoped unique
request key and never stores uploaded bytes, extracted rows, or financial records. The browser processes
selected PDFs sequentially and shows read status, retry count, and candidate previews. No amount/date
deduplication, recurrence-rule creation, inbox approval, transaction write, card posting, or transfer
posting is enabled. Migration `0004_public_lilith` adds only this metadata table.

The key is `OPENAI_API_KEY` and remains server-side; `OPENAI_BANK_STATEMENT_MODEL` defaults to
`gpt-4.1-mini`. Requests use structured JSON output, `store: false`, a 90-second timeout, at most two
active reads per server process, and 12,000 output tokens. There is no product cap on file count or PDF
pages. The 20 MiB per-file limit is a technical memory/request safeguard; the timeout and output ceiling
bound provider work, and unusually large statements can fail explicitly rather than return partial success.
