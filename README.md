# Centwise

Centwise is an open-source personal finance application for web and mobile.

## Requirements

- Node.js 20.9 or later
- pnpm 9.15 or later
- Docker Desktop

## Getting started

```bash
pnpm install
cp .env.example .env
docker compose up -d
pnpm --filter @centwise/database db:migrate
pnpm dev
```

`pnpm dev` starts the web application and API at `http://localhost:3000`.
Start Expo separately when mobile development begins:

```bash
pnpm dev:mobile
```

## Local authentication

Centwise uses local email-and-password accounts with password hashes and signed, `HttpOnly` session cookies. It is intended for local development and self-hosted household use.

After copying `.env.example`, replace `AUTH_SECRET` with a unique random value of at least 32 characters. Generate one with:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Each household member can create an account from the web app with an email address and a password of at least 12 characters. The API derives transaction ownership from the signed session; it does not accept a user ID from the browser.

## Local database

The local PostgreSQL 16 database runs in Docker Compose. Start it with:

```bash
docker compose up -d
```

It is available at `localhost:5433` to avoid conflicts with an existing local PostgreSQL installation.

Stop the database without deleting data:

```bash
docker compose down
```

Delete the local database volume when a clean state is needed:

```bash
docker compose down -v
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