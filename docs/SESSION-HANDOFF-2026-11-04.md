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

The pure calculation engine is in `packages/core/src/utils/free-to-spend.ts`, with tests in `packages/core/src/utils/free-to-spend.test.ts`. It currently calculates liquid balance from active opening balances and transactions through `asOf`, then applies remaining recurring income, bills due today or later, the full monthly investment, and safety reserve. Calendar calculations use UTC.

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

## Validation and Delivery

- Run focused calculation tests and `pnpm typecheck` before completing the slice.
- The previous `pnpm --filter @centwise/core run lint` failed because ESLint 9 could not find `eslint.config.*`; this is a workspace lint configuration issue, not a reported source lint finding. Do not expand scope to repair lint configuration unless needed and explicitly agreed.
- Use the repository workflow in `AGENTS.md`: one implementation owner, read-only review/validation agents, and commit only the validated slice. Do not push.

## Prompt For The Next Session

Continue in `c:\projects\centwise`. Read `AGENTS.md` and this handoff, then inspect the current branch and working tree. Phase 4 and inline entry editing are complete; do not redo them. Confirm the next product slice before implementation rather than assuming mobile parity, transaction classification, household features, or bank integrations. Do not push.
