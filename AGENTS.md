# Agent instructions

**See [`CLAUDE.md`](./CLAUDE.md)** — it is the single source of truth for this
project's scope, architecture, conventions and rules. Read it before making any
change.

For a factual history of what has been built and changed, see
[`CHANGELOG.md`](./CHANGELOG.md).

---

### Note on a previous version of this file

This file originally contained an auto-generated `nextjs-agent-rules` block from
the `create-next-app` scaffold, which shipped Next.js 16. It instructed agents to
read `node_modules/next/dist/docs/` before writing code.

This project was subsequently pinned to **Next.js 15.5.23** to match its
specified stack. Neither that docs directory nor the generator that re-adds the
block (`next/dist/server/lib/generate-agent-files.js`) exists in Next 15, so the
block was stale and misleading and has been removed. It will not be regenerated
while the project stays on Next 15.
