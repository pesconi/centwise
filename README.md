# Centwise

Centwise is an open-source personal finance application for web and mobile.

## Requirements

- Node.js 20.9 or later
- pnpm 9.15 or later
- PostgreSQL 16 or later

## Getting started

```bash
pnpm install
pnpm dev
```

Run quality checks with:

```bash
pnpm lint
pnpm typecheck
pnpm build
```

## Workspace layout

- `apps/web`: Next.js web interface and REST API.
- `apps/mobile`: Expo mobile application.
- `packages/core`: Universal business logic, types, schemas, and utilities.
- `packages/database`: Drizzle ORM client and PostgreSQL schemas.
- `packages/design-tokens`: Shared colors, typography, and spacing values.
- `packages/config-eslint`: Shared ESLint configurations.
- `packages/config-typescript`: Shared strict TypeScript configurations.