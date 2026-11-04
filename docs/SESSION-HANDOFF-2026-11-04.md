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

## Working Tree: Preserve

At handoff creation, the working tree has user/local changes in:
- `docker-compose.yml`: formatting and final newline only.
- `packages/core/src/utils/free-to-spend.ts`: indentation-only change around the transaction reduction.

Do not revert, overwrite, or stage these changes without reviewing them with the user. The last committed baseline is `d9ba884`.

## Development Server Diagnosis

The root `pnpm dev` and `pnpm dev:web` scripts start the Next.js web app. Both were reproduced successfully; `GET /` returned HTTP 200 without compilation/runtime errors. Port 3000 was intermittently occupied, so Next.js selected 3001. A later listener check found no process on ports 3000 or 3001. If development startup fails again, capture the exact terminal error and actual reported URL before changing scripts.

## Next Planned Slice: Phase 4

Build a decision-first dashboard around the server-calculated free-to-spend amount. Keep the scope narrow and mobile-friendly:
- Show a daily safe-spend amount with clearly stated calculation period/assumptions.
- Show protected/committed amounts (bills, investments, safety reserve) without double counting.
- Show upcoming recurring bills and remaining income this month.
- Keep quick transaction entry easy to reach.

Before implementing, inspect the current dirty tree and the existing dashboard/API contracts. Preserve local changes. Verify the proposed daily allowance calculation around month boundaries and negative free-to-spend values with focused tests. Do not start mobile parity, transaction classification, household features, or bank integrations in this slice.

## Validation and Delivery

- Run focused calculation tests and `pnpm typecheck` before completing the slice.
- The previous `pnpm --filter @centwise/core run lint` failed because ESLint 9 could not find `eslint.config.*`; this is a workspace lint configuration issue, not a reported source lint finding. Do not expand scope to repair lint configuration unless needed and explicitly agreed.
- Use the repository workflow in `AGENTS.md`: one implementation owner, read-only review/validation agents, and commit only the validated slice. Do not push.

## Prompt For The Next Session

Continue work in `c:\projects\centwise` from this handoff. First read `AGENTS.md` and this file, then inspect `git status` and the current diffs for `docker-compose.yml` and `packages/core/src/utils/free-to-spend.ts`. These are existing local changes; preserve them and do not stage them as part of your work unless their ownership is confirmed. Implement the next planned slice, Phase 4: make the dashboard decision-first by adding a carefully defined daily safe-spend amount, protected/committed amounts, and upcoming income/bills while retaining quick transaction entry. Start from the current dashboard and existing API/calculation code, state one falsifiable local hypothesis and focused validation check before the first edit, then implement the smallest coherent change. Add focused tests for date/month boundaries and negative free-to-spend behavior, run the focused tests and `pnpm typecheck`, and validate the dashboard visually if the interaction/layout changes require it. Keep all work within this slice, preserve user changes, and report any assumptions or validation gaps. Do not commit unrelated local changes or push.
