# Bank message and PDF import plan

Date: 2026-11-04
Status: reviewed-inbox foundation implemented; capture and document ingestion remain planned.

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
- No document storage, background worker, or reconciliation model exists yet.
- New accounts have an explicit start-of-day UTC opening-balance boundary; legacy accounts retain a null
  date until balance/date confirmation. Pre-boundary movements are history only, never additional cash.
- The web inbox now persists authenticated source events and review candidates with exact-event retry idempotency. It does not ingest Android messages or documents.

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

## 3. PDF import with local AI

- Add authenticated upload with owned account selection, source/document type, and statement period.
- Validate PDF content/signature and configured size/page limits before processing; enforce resource
  limits and isolate parsing. Do not execute embedded scripts or follow embedded links.
- Store originals privately outside public assets, with ownership-enforced retrieval/deletion.
- Use an asynchronous persisted job with explicit progress, retries, and cancellation/failure status.
- Extract selectable text first; use local OCR for scanned pages. Report encrypted/unreadable documents
  explicitly rather than pretending extraction succeeded.
- Run extraction with a locally hosted model on the self-hosted server. Choose model/runtime after a
  hardware and synthetic-document quality check; do not send financial documents to external services.
- Treat document text as untrusted data, never instructions. Give the extractor no tools or write access.
- Require schema-constrained output and validate cents, currency, dates, direction, account association,
  totals, and row types. Preserve page/evidence references for each suggested item.
- Separate opening/closing balances, subtotals, transactions, forecasts, and statement payments.
  Do not import summary amounts as additional movements.
- Exact file hashes make reuploads idempotent; overlapping statement periods need transaction-level
  reconciliation, not merely file deduplication.
- Preview/correct/approve extracted items in the same inbox as message candidates.
- Set explicit retention/deletion rules for originals, extracted text, local queue, and evidence.
  Keep raw financial content out of logs, telemetry, repository fixtures, and external services.

Acceptance: selectable-text and scanned fixtures, overlapping/reuploaded statements, invalid files,
encrypted documents, incorrect totals, and instruction-like PDF text produce correct candidates
or explicit review/failure states, never silent financial postings.

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

1. The approved balance-date and occurrence/settlement slices are implemented. Next add cross-source and
   manual-transaction duplicate review/reconciliation, then separately verify atomic and concurrent posting.
2. Mobile authentication and one known bank's SMS format, then notification capture and offline sync.
3. PDF upload, local extraction/OCR/AI, and inbox preview; card posting remains gated.
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
- Server RAM/CPU/GPU for local OCR/model selection and extraction throughput.
- Explicit upload limits and retention periods.

Recommended next session: visually validate the occurrence settlement UI, then continue the bank
statement slice with authenticated file-read tracking and safe, non-persisted PDF processing in preview
mode. The user expressed a preference for the OpenAI API, which conflicts with the current local-model
privacy constraint; resolve that boundary before transmitting statement content. Do not process real
documents during development or make PDF resource limits unbounded. Keep import approval blocked until
duplicate ambiguity, reconciliation and atomic/concurrent posting are fully verified.

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

This does not yet read PDFs or call a model. The user expressed a preference for the OpenAI API, which
needs reconciliation with the established local-model/privacy constraint before any statement content
is transmitted. The requested file-read status table, review UI/category persistence, transaction
posting, expense reports, and recurrence analysis remain future work. Approval stays blocked.
