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

The pure calculation engine is in `packages/core/src/utils/free-to-spend.ts`, with tests in `packages/core/src/utils/free-to-spend.test.ts`. It calculates liquid balance from effective active opening balances and eligible transactions through `asOf`, then applies remaining recurring income, bills due today or later, the full monthly investment, and safety reserve. Calendar calculations use UTC. See the latest balance-date slice below for the implemented history boundary and the still-pending settlement policies.

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

The inbox supports correcting amount, direction, date, description, and account, and rejecting with an optional reason. Posting is not available: `POST /api/import-candidates/{id}/approve` returns `409`, and the database constraint prevents changing the posting state. The policies are now approved below, but settlement/reconciliation and atomic approval must still be implemented before posting can be enabled. Card accounting remains out of scope.

No Android capture/device authentication, PDF upload, OCR, local AI extraction, or transaction posting was added. The endpoint accepts authenticated source events only; it is a foundation, not an ingestion implementation. Synthetic API checks covered parallel retries, distinct equal-value events, changed-payload conflicts, user/account isolation, correction, repeat rejection, and the posting block. The authenticated inbox was visually checked with synthetic data. Migration `0001_magical_shiva` was applied to the local PostgreSQL container.

## Validation and Delivery

- Run focused import-schema tests and `pnpm typecheck` before completing the slice.
- The previous `pnpm --filter @centwise/core run lint` failed because ESLint 9 could not find `eslint.config.*`; this is a workspace lint configuration issue, not a reported source lint finding. Do not expand scope to repair lint configuration unless needed and explicitly agreed.
- Use the repository workflow in `AGENTS.md`: one implementation owner, read-only review/validation agents, and commit only the validated slice. Do not push.

## Opening-Balance Date Slice (latest)

The user explicitly chose to implement only the opening-balance date/history slice in this session,
not the larger reconciliation/approval slice. Import posting MUST remain blocked in the API and database.
No prior records were deleted, despite permission to discard development fixtures.

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

Only the first two policies are implemented here. **Recurring settlement, persisted occurrences,
overdue carry-forward, cross-source reconciliation and atomic approval are NOT implemented.**
The engine still uses its existing recurring-date forecast behavior; do not describe the approved
future policies as current functionality.

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

## Prompt For The Next Session

Continue in `c:\projects\centwise`. Read `AGENTS.md`, this handoff, and [the import automation plan](./IMPORT-AUTOMATION-PLAN.md), then inspect the branch, status and recent commits. The opening-balance and settlement policies above were explicitly approved; do not ask for those same decisions again. The opening-balance date slice is implemented; preserve nullable legacy dates and require explicit balance/date confirmation. Next, implement one bounded slice of persisted monthly occurrences and explicit settlement links, including partial payments, edits/deletions and overdue carry-forward under the approved policies. Keep import approval blocked until financial reconciliation, cross-source ambiguity handling and transactional/concurrent posting are verified end-to-end. Android, PDF/OCR/AI, recurrence prediction, card posting, suspicious internal transfers and currency conversion remain out of scope. Use only synthetic data, one implementation owner, focused validation and `pnpm typecheck`; apply migrations locally and commit only the validated slice without pushing.
