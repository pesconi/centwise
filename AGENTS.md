<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->

# Centwise Agent Guidelines

## Product Boundary

- Centwise is a self-hosted personal finance app focused on answering how much a user can safely spend this month.
- Store monetary values as integer cents. The current base currency is EUR; do not add currency conversion without an explicit product decision.
- Derive the authenticated user from the server session. Do not trust a user ID supplied by the browser for owned data.

## Multi-Agent Workflow

- Assign one implementation agent per worktree or branch. Never allow concurrent edits in the same working tree.
- Use review agents in read-only mode. They report findings and never edit implementation files.
- Use validation agents to run tests, migrations, and HTTP scenarios without changing source files.
- An integrator reviews findings, applies accepted fixes, validates the result, and creates the commit.

## Review Focus

- Financial reviewers must challenge calculation assumptions, double counting, month boundaries, negative balances, due dates on day 29-31, and reserve protection.
- Technical reviewers must check ownership boundaries, schema migrations, API validation, sensitive data exposure, and regression risk.
- Report findings by severity with concrete file paths, impact, and the smallest remediation. State explicitly when no findings exist.

## Delivery Rules

- Keep each change narrowly scoped to one product slice. Avoid speculative abstractions and unrelated refactors.
- Run focused validation after an edit. Run `pnpm typecheck` before completing a multi-package slice.
- Apply and verify generated Drizzle migrations against the local PostgreSQL container before committing schema changes.
- Commit validated slices with concise, informative messages. Do not push unless explicitly requested.
- Never commit `.env`, secrets, generated `*.tsbuildinfo` files, or local database volumes.
