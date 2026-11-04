# Centwise Session Handoff

Date: 2026-11-04

## Current State

Centwise is a pnpm/Turborepo monorepo for a self-hosted personal-finance app. Its central question is: "How much can I freely spend this month?" Money is integer cents and the product currency is EUR. User ownership must always come from the server session.

Completed and committed:

- `1c8f6a5` Add agent workflow guide
- `a7ecbf5` Enforce account-linked EUR transactions
- `a0dc30b` Add free-to-spend calculation
- `d9ba884` Add financial onboarding flow

The onboarding collects an opening account balance when needed, optional monthly recurring income and bills, monthly investments, and safety reserve. The onboarding endpoint writes these records atomically. The authenticated free-to-spend endpoint feeds the dashboard.

The pure calculation engine is in `packages/core/src/utils/free-to-spend.ts`, with tests in `packages/core/src/utils/free-to-spend.test.ts`. It calculates liquid balance from effective active opening balances and eligible transactions through `asOf`, then applies remaining recurring income, bills due today or later, the full monthly investment, and safety reserve. Calendar calculations use UTC. The opening-balance and monthly settlement semantics are implemented below.

## Working Tree

The working tree was clean at the start of Phase 4. The earlier local changes to `docker-compose.yml` and `packages/core/src/utils/free-to-spend.ts` were included in commit `2cdc015`.

## Development Server Diagnosis

The root `pnpm dev` and `pnpm dev:web` scripts start the Next.js web app. Both were reproduced successfully; `GET /` returned HTTP 200 without compilation/runtime errors. Port 3000 was intermittently occupied, so Next.js selected 3001. A later listener check found no process on ports 3000 or 3001. If development startup fails again, capture the exact terminal error and actual reported URL before changing scripts.

## Phase 4 Outcome

The dashboard now presents the remaining free-to-spend amount and a daily guide. The daily guide is the positive monthly free-to-spend amount divided across the remaining UTC calendar days, including today, rounded down to cents; when the monthly amount is negative, the guide is zero and the shortfall is shown. The dashboard also itemizes remaining bills, the monthly investment, and safety reserve as already accounted for, and lists remaining income and bills through month-end without subtracting them again. Quick transaction entry remains on the dashboard.

Focused calculation tests cover the end of February, a new month, and negative free-to-spend. `pnpm --filter @centwise/core exec vitest run src/utils/free-to-spend.test.ts` and `pnpm typecheck` passed. The local web app loaded, but only the signed-out screen could be visually inspected because no authenticated test session was available; the signed-in dashboard still needs a visual check with an authorized local account.

Do not start mobile parity, transaction classification, household features, or bank integrations without an explicit product decision.

## Entry Editing

The dashboard supports inline edits for upcoming recurring income/bills and recorded transactions. Recurring edits use the existing user-owned update endpoints; transaction edits use the user-owned `PUT /api/transactions` endpoint and refresh the activity and free-to-spend queries. No database migration is needed. The transaction update schema has focused tests; rerun the core tests and `pnpm typecheck` after further changes. Authenticated visual verification still requires a local test account.

## Import Inbox Foundation

The shared import inbox is available at `/imports`. `import_sources` stores user-owned source type, stable event key, capture time, parser version, payload fingerprint, and structured evidence. `import_candidates` stores the proposed EUR transaction fields, explicit review/validation state, rejection decision, provenance link, and a database-enforced `posting_status = blocked`.

Authenticated source intake uses the web session, not a browser-supplied user ID. The unique `(user_id, source_type, source_event_key)` key and transactionally created single candidate make exact retries concurrency-safe. Reusing the same key with changed source/candidate data returns `409`; different event keys remain separate even for equal amount/date. There is deliberately no fuzzy or cross-source duplicate linking yet, so one purchase received through separate channels may still appear twice.

The inbox supports correcting amount, direction, date, description, and account, and rejecting with an optional reason. Posting is not available: `POST /api/import-candidates/{id}/approve` returns `409`, and the database constraint prevents changing the posting state. Settlement is implemented, but import reconciliation and atomic approval must still be completed before posting can be enabled. Card accounting remains out of scope.

At this foundation stage, Android capture, PDF upload, OCR, local AI extraction, and transaction posting were not added. The endpoint accepted authenticated source events only. Synthetic API checks covered parallel retries, distinct equal-value events, changed-payload conflicts, user/account isolation, correction, repeat rejection, and the posting block. The authenticated inbox was visually checked with synthetic data. Migration `0001_magical_shiva` was applied to the local PostgreSQL container.

## Validation and Delivery

- Run focused import-schema tests and `pnpm typecheck` before completing the slice.
- The previous `pnpm --filter @centwise/core run lint` failed because ESLint 9 could not find `eslint.config.*`; this is a workspace lint configuration issue, not a reported source lint finding. Do not expand scope to repair lint configuration unless needed and explicitly agreed.
- Use the repository workflow in `AGENTS.md`: one implementation owner, read-only review/validation agents, and commit only the validated slice. Do not push.

## Opening-Balance Date Slice (previous)

The user explicitly chose to implement only the opening-balance date/history slice in that session,
not the larger reconciliation/approval slice. Import posting MUST remain blocked in the API and database.
No prior records were deleted during that slice.

### Approved financial policies

- An account's opening balance is cash at the **start of its selected UTC calendar day (00:00 UTC)**.
  Earlier movements remain visible history and do not change cash. Movements exactly at midnight count.
- Existing accounts retain a null effective date and the legacy calculation until the owner explicitly
  confirms both balance and date. Never infer the date from account creation or silently backfill it.
- Future settlement: explicitly link payments/receipts to a monthly occurrence, never by amount/date alone.
  Partial payments leave the remainder outstanding; overpayments affect actual cash once and cannot produce
  a negative outstanding amount. Settling for less requires explicit confirmation, not a change to future rules.
- Editing a linked payment must atomically recalculate the remainder; deletion reopens the obligation.
  Changes to account/direction/month require explicit reconciliation. Exceptional short-payment settlement
  must be reviewed after changes. Editing/deactivating a rule must not erase reconciled occurrences.
- Unsettled expenses remain reserved after their due date and across month boundaries until settled or
  explicitly cancelled. Overdue unreceived income is not spendable unless received or rescheduled.

Only the first two policies were implemented in that slice. The current implementation is described
in the latest occurrence section below.

### Implemented surfaces and limits

- Nullable PostgreSQL `accounts.opening_balance_date` (`date`, string in Drizzle); new account creation
  and onboarding require `openingBalanceDate` in `YYYY-MM-DD` form. Account updates must send the balance
  and effective date together; name/active-state-only legacy updates remain valid.
- The engine excludes pre-boundary movements, future transactions and balances not yet effective.
  Null/omitted dates preserve legacy calculation. Accounts retain independent boundaries.
- Onboarding, initial-account creation and per-account balance confirmation explain UTC start-of-day.
  Activity labels historical-only transactions. The dashboard cash summary uses the server calculation,
  not a second client calculation that would re-add historical transactions.
- Sources/candidates remain review-only. No approved historical imports, financial posting, card accounting,
  internal transfers, Android capture, PDF/OCR/AI, recurrence prediction or currency conversion was added.
- Synthetic HTTP regression tests are opt-in with `CENTWISE_TEST_BASE_URL`; they leave isolated synthetic
  users/accounts/candidates in the development database, delete their test transactions and use no real data.

### Validation and delivery

- Generated/applied Drizzle migration `0002_demonic_brood` to the healthy local PostgreSQL container.
  Verified `opening_balance_date` is nullable `date`; all 7 accounts present before migration retained
  null dates. No existing records were deleted or backfilled.
- 26 focused unit tests passed across calculation, financial schemas, transaction schemas and import
  schemas. Coverage includes exact UTC midnight, timezone offsets, year/month/leap-day boundaries,
  separate account dates, inactive/future accounts, negative balances, reserves, legacy null dates,
  transaction edits/deletions and balance/date paired validation.
- The synthetic HTTP integration passed (1 test): account creation/onboarding, ownership from session,
  foreign account rejection, historical transaction retention, cash recalculation, concurrent source retries,
  distinct equal-value events, changed-payload conflicts and repeated/concurrent blocked approvals.
  There are still **zero financial postings from approval**; this is a block regression, not posting support.
- `pnpm typecheck` passed (5 tasks). The first validation found a stale response-variable reference and
  Node-only HTTP tests inside the platform-neutral TypeScript compilation; both were fixed and revalidated.
  HTTP integration uses `.test.mjs` without changing the core runtime/type dependencies.
- A direct SQL attempt to set a synthetic candidate's posting status to `posted` failed with
  `import_candidates_posting_blocked_check`; rollback succeeded. All 3 HTTP-test candidates remained
  blocked and none approved. Existing synthetic development data, including fixtures from interrupted
  test runs and manual visual checks, may remain locally.
- Automated browser checks hit an unsupported cookie protocol operation and an unstable click;
  automation stopped after two failures. The user then explicitly confirmed manual visual validation at
  `http://localhost:3001`: UTC date/explanation, balance confirmation, historical-only label/no cash impact,
  same-day cash impact and the disabled inbox. No real data or credentials were requested.

To repeat the focused tests with a migrated local web server running:

```powershell
$env:CENTWISE_TEST_BASE_URL = "http://localhost:3001"
pnpm --filter @centwise/core exec vitest run src/utils/free-to-spend.test.ts src/schemas/financial.test.ts src/schemas/transaction.test.ts src/schemas/import-candidate.test.ts src/integration/opening-balance.test.mjs
pnpm typecheck
```

Without `CENTWISE_TEST_BASE_URL`, the HTTP integration is explicitly skipped; unit tests still run.

## Monthly Occurrence and Settlement Slice (latest)

The user approved clearing the local development transaction ledger and starting occurrence generation
without historical backfill. Only the local `transactions` rows were deleted (5 rows); accounts,
recurring rules, financial settings, and inbox records were preserved. The database target was verified
as `localhost:5433/centwise`. Synthetic HTTP tests were cleaned up and the transaction table was verified
empty afterward.

### Implemented behavior

- Migration `0003_flat_blade` adds persistent `recurring_occurrences` and an optional transaction link.
  Each occurrence snapshots its source rule, name, amount, UTC period and scheduled date; unique indexes
  prevent duplicate rows per source rule/month. A composite `(user_id, occurrence_id)` foreign key prevents
  cross-user transaction links.
- Authenticated `GET /api/free-to-spend` idempotently materializes the active rules' current UTC month.
  On first activation, dates earlier than the current UTC date are skipped; prior months are never
  backfilled. Day 29–31 is clamped to that month's last day. Later months are materialized when that
  month's plan is fetched. Existing occurrences survive rule edits and deactivation.
- Payments and receipts can be linked explicitly by occurrence ID. Partial settlement reserves only the
  remaining cents; excess reduces cash once and cannot create negative outstanding funds. Marking a
  smaller payment as fully settled requires a separate explicit confirmation. Cancellation and income
  rescheduling are explicit actions.
- Linked transaction creation, edits and deletion lock the affected rows in one PostgreSQL transaction.
  Editing/deleting recalculates settlement from linked transactions and reopens exceptional short
  settlements for review. Changes in account, direction or UTC month require an explicit occurrence
  selection or unlink; a rescheduled occurrence cannot move across months while it has linked transactions.
- Open unpaid bills remain reserved across month boundaries. Unreceived income due today or earlier is
  excluded from spendable income until received or explicitly rescheduled. Pre-opening-date and future
  transactions do not settle an occurrence or change current cash; the existing 00:00 UTC balance boundary
  remains unchanged.
- The dashboard exposes per-occurrence payment/receipt, partial settlement confirmation, cancellation,
  rescheduling, and rule editing. Rule edits change future occurrences only. Import candidate approval is
  still blocked in both API and database, including apparently complete/unique candidates. Cross-source
  duplicate resolution, card posting, and suspicious internal transfers remain unavailable.

### Validation and remaining limit

- `pnpm --filter @centwise/database db:generate` generated `0003_flat_blade`; `pnpm --filter @centwise/database db:migrate`
  applied it locally. The occurrence table exists; the ledger was empty immediately after the earlier synthetic tests.
- 26 focused unit tests passed for calculation, UTC date clamping, and transaction validation.
  Two HTTP integrations passed: occurrence materialization/settlement/ownership/concurrency and the existing
  opening-balance/import-posting-block regressions. `pnpm typecheck` passed for all 7 workspace packages.
- Revalidation for this commit passed 26 focused unit tests and `pnpm typecheck`. The two HTTP integrations
  were skipped without a base URL; attempts against `localhost:3001` could not connect because the app
  server was unavailable. The shared browser shows onboarding, not the settlement controls.
- Automated browser interaction timed out twice on the onboarding button. The current continuation
  resolved this gap with an authenticated synthetic account; see the latest slice below.
- Materialization is lazy and current-month-only on a plan fetch; there is no background job. There is no
  cross-source/manual duplicate resolution, so inbox posting remains disabled. Do not enable posting based
  on this slice alone.

## Current continuation slice (2026-11-04)

Commits at session start were `7fc8065` (synthetic extraction contract) and `b6fe66f` (monthly
occurrences/settlement). Branch was `main`, clean, at `b6fe66f`; no local source edits existed before
this slice.

The settlement UI was visually validated on the local server with a newly registered synthetic
`example.invalid` user. It showed both payment and receipt forms, income rescheduling/cancellation,
and after a synthetic EUR 40 partial utility payment, the EUR 83.45 outstanding balance and explicit
partial-settlement action. The 00:00 UTC opening date and cash/forecast arithmetic remained visible.

The authenticated PDF preview is on `/imports`. `POST /api/bank-statement-reads` accepts one bounded
PDF stream, derives user ownership from the session, validates the selected active account, and calls
the OpenAI Responses API with server-only `OPENAI_API_KEY`, `store: false`, strict structured output,
no tools, and untrusted-document instructions. PDF bytes exist only in request memory; extracted rows
are returned to the browser and are not written to the inbox or database. `bank_statement_reads`
stores sanitized filename, file size, an account-bound request fingerprint, status, candidate count,
attempt count, and safe error code. It stores neither PDF bytes nor extracted values. Migration
`0004_public_lilith` was generated and applied to local PostgreSQL.

Retries reuse one user/request key and must have the same PDF, filename, and selected account. Failed
reads increment the same row's attempt count; concurrent/incomplete reads return `409`; changed content
conflicts; completed keys cannot replay the ephemeral preview. Candidate rows with same direction,
EUR cents, and UTC date are flagged but both retained. Transfer-like text gets a review flag. Card/bill
documents are refused; all posting remains blocked and no recurring rule is created.

No product cap is imposed on file count or PDF pages. Technical limits: 20 MiB per file, 90 seconds per
provider request, two simultaneous reads per server process, and 12,000 model output tokens. Truncated
or invalid provider output is an explicit failure, never a partial success. The environment had no
OpenAI credential configured, so HTTP tests verified the explicit provider-unavailable state and retry
without making an external call. Provider parsing was unit-tested with a mocked synthetic response.
Final focused validation passed: core tests (43 passed, 2 skipped), web tests (4 passed), workspace
`pnpm typecheck`, and `git diff --check`.
Do not use real statements or credentials during development; confirm provider retention terms before
production processing.

The local HTTP checks with synthetic data passed: first request `503` (no server key), retry `503` with
attempt count 2 on one row, same-key/different-PDF `409`, unowned account `404`, second-user read
isolation (zero rows), import approval `409`, and unchanged transaction count during PDF failures.
Visual review covered the settlement dashboard and PDF upload/status states, including the failed-read
table and disabled posting. Candidate-preview rows were validated by unit tests but not rendered in the
browser because no OpenAI key was configured. A synthetic read metadata row, approval-blocker candidate,
and visual/isolation users remain in the development database; no original PDFs or real financial data
were used.

## Read-only cross-source/manual duplicate review (latest, 2026-11-04)

Started on `main`, clean, at the expected `e29da5b` (`Add authenticated bank statement preview`).

### Implemented and deliberately blocked

- Inbox reads and successful ephemeral PDF previews now return `duplicateReview` suggestions against
  owned inbox candidates and existing manual ledger transactions. Comparison requires the same owned
  account, EUR integer cents, direction and **UTC calendar day**. Equal nonempty descriptions after
  Unicode/whitespace/case normalization supply an additional signal, not a duplicate decision.
- The UI explains field-only coincidence versus also-matching descriptions, shows comparison amounts,
  dates and manual transaction IDs, and links to the other inbox candidate's original source evidence.
  Legitimate equal purchases remain separate and editable. Neither suggestions nor comparisons change
  candidate status, establish links, merge, reject, remove or approve anything.
- The server derives ownership from the session. Source and account joins independently enforce
  ownership before producing comparison evidence. Invalid source links are excluded; candidates with
  invalid/missing account links have no suggestions and cannot supply comparison evidence. Rejected,
  failed and approved candidates do not participate. Self/same-source comparisons are excluded.
- Suggestions recalculate on a new read, so corrections, rejections and manual transaction edits are
  reflected without storing potentially stale duplicate links. No schema migration was necessary.
- Approval still returns `409` for matching and nonmatching candidates, card sources and suspected
  transfers, including concurrent attempts. The database posting constraint is unchanged. No transaction,
  recurrence, settlement or financial balance logic was enabled or changed; 00:00 UTC remains the
  opening-balance boundary. The blocker text now distinguishes implemented settlement from unfinished
  import duplicate decisions/reconciliation.

### Validation

- 53 focused core tests passed, including synthetic duplicate/nonmatch cases, UTC day boundaries,
  incomplete/invalid fields, user isolation, extraction contracts, calculations and the two existing
  opening-balance/settlement HTTP regressions. Five web tests passed: four mocked extraction tests and
  one new local HTTP scenario exercising valid comparisons, changed/rejected candidates, edited manual
  transactions, foreign accounts/owners, deliberately malformed source/account links, invalid occurrence
  selection, concurrent blocked approvals, and unchanged ledger/candidate posting state.
- `pnpm typecheck` passed across the workspace. Strict array-access errors in new tests were corrected.
  A combined regression rerun encountered a transient Next development webpack `500` on an unchanged
  account route and a settlement timeout during recompilation; both HTTP regressions subsequently
  passed together in an isolated 4.68-second run. Do not mask those failures with product fallbacks.
- Local server availability was checked before HTTP testing; this session started a temporary web
  server on `http://localhost:3001` and stopped it after validation. Tests used only synthetic
  `example.invalid` accounts and no real PDFs,
  provider requests or credentials. The new HTTP test cleans up its own users and malformed fixtures;
  the dedicated visual user's three candidates, one manual transaction and account were also removed.
- Browser checks found three review panels, three manual references, six comparison links and three
  disabled posting buttons at desktop width, with no horizontal overflow. A mobile screenshot at
  390px confirmed readable comparison text and wrapped IDs without overflow.
- A screenshot scroll timed out, then a later browser-only PDF fixture could not construct `Buffer`.
  Automation stopped after those two failures and its request interception was removed. The shared
  review component was visually checked in the inbox; successful PDF preview rendering remains
  unverified in this slice. No provider credential was configured or requested to bypass that limit.

To repeat the new HTTP scenario with a running local server (the database guard requires
`localhost:5433/centwise`):

```powershell
Set-Location C:\projects\centwise\apps\web
$env:CENTWISE_TEST_BASE_URL = "http://localhost:3001"
node --env-file=..\..\.env node_modules\vitest\vitest.mjs run src\server\bank-statement-extraction.test.ts src\server\import-duplicate-review.integration.test.ts
```

### Limits and next boundary

This is comparison assistance, not resolved duplicate reconciliation. No durable confirmation/dismissal
workflow or atomic approval exists. Missing account/date/amount/direction, different UTC days or accounts,
and spelling differences can prevent a stronger signal; absence of suggestions does not prove uniqueness.
All current ledger transactions are user-entered; future posting must add explicit provenance rather
than assume that remains true. Original PDFs and extracted previews are still not retained, so separate
ephemeral PDF previews cannot be compared with each other after they disappear. No file/page product
limits were added, and the previous technical PDF safeguards remain unchanged. Comparisons currently
read the owned inbox/ledger into memory without truncation; large histories may require query-level
indexing/pagination in a separate slice, not silent omission of evidence.

## Next-session prompt

Continue in `C:\projects\centwise`; read this handoff and
[the import automation plan](./IMPORT-AUTOMATION-PLAN.md), then inspect git status and latest commit.
Do not redo the visual settlement check or re-ask approved financial/provider decisions. Keep EUR cents,
session-derived ownership, the UTC opening-balance boundary, and import posting blocked. The next slice
has delivered read-only cross-source/manual duplicate suggestions. A next slice can define explicit,
durable review decisions and reconciliation before any approval work; do not treat these hints as
resolved duplicates or posting permission. Card
accounting, suspicious internal transfers, mobile capture, and recurring suggestions remain gated.
Use synthetic fixtures, run focused tests and `pnpm typecheck`, validate visually when the UI changes,
commit only the validated slice, and do not push.

## Bank Statement Extraction Contract Foundation

- Added a platform-neutral schema boundary for structured bank-statement extraction results. It maps only candidate transaction fields to the existing endpoint shape; the extractor cannot provide account IDs or recurring-occurrence IDs.
- Each valid row is checked independently. Incomplete rows remain `needs_review`; malformed rows and non-EUR currency are explicitly invalid. No currency conversion, amount/date deduplication, transaction write, inbox approval, or recurring-rule creation occurs.
- Category and recurrence values are suggestions only. Recurrence classifications are restricted to possible recurring, ordinary spend, or uncertain; no suggestion creates a rule or future occurrence. Evidence includes a page number and short excerpt. Confidence signals reflect field completeness, not a model's self-reported probability.
- Synthetic contract tests cover valid endpoint-shaped rows, malformed/uncertain rows, unsupported currency, forbidden ownership/occurrence fields, and equal-value rows retained independently.
- At the time this contract foundation was committed, it did not read PDFs or call a model. The authenticated OpenAI preview and metadata-only read table are now implemented in the continuation slice above.
- The occurrence code and migration `0003_flat_blade` were local changes before the extraction-contract commit. Its earlier HTTP/browser validation gaps were resolved in the latest slice above. Import posting remains blocked.
