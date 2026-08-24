# Nanotron

A mobile-first crypto investment platform, plus a Master CRM at `/admin`.

**Read [`CLAUDE.md`](./CLAUDE.md) before changing anything** — it is the single
source of truth for scope, architecture and conventions.
[`CHANGELOG.md`](./CHANGELOG.md) records what has actually been built.

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

That works with no database: the service layer falls back to the seed data in
`src/data`, and the app behaves exactly as it does with one. Nothing is
persisted.

## With a database

PostgreSQL 14+, local or managed.

```bash
cp .env.example .env.local     # then set DATABASE_URL
npm run db:migrate             # apply drizzle/*.sql
npm run db:seed                # load the development data
npm run db:check               # connected? migrated? seeded?
```

Reads then come from PostgreSQL. Writes are deliberately not implemented — see
CLAUDE.md §2 and §16.

`.env.local` is git-ignored. Never put a connection string in source.

## Checks

```bash
npm run typecheck
npx eslint .
npm test
npm run build
```
