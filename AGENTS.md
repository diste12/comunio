<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Table design rules

All platform tables must use `DataTable` from `src/components/data-table`. Provide
a stable table id (include the parent record id for detail tables) and stable
`data-row-id` values. Use `data-value` on cells with rich formatting: raw numbers
(in euros for money, percentage points for rates), ISO dates, or state values.
Every header supports sorting and advanced/multi-value filtering; every row
supports selection and export. Keep the shared column picker and saved/bookmarked
views. Use authenticated, validated server actions for bulk edits and preserve
domain checks. Mark mutually exclusive row actions `bulk={false}`. Never make
derived balances, voting results, or other computed values directly editable.
