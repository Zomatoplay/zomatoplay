# Zomato Play

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
npm run db:secure              # RLS + the KYC document bucket — run after every migration
npm run db:seed                # load the development data
npm run db:check               # connected? migrated? seeded?
```

Reads **and writes** both go to PostgreSQL — see CLAUDE.md §2, §16 and §17.

On a database that has been migrated but not reseeded,
`npm run db:backfill-tiers` gives each seeded plan the rate ladder from
`@/data/plans`. It is idempotent and never touches a plan that already has
one.

`.env.local` is git-ignored. Never put a connection string in source.

## Checks

```bash
npm run typecheck
npx eslint .
npm test
npm run build
```
