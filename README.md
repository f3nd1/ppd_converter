# PPD Converter — United Ceres College

An internal, single-user tool for migrating Policy & Procedure Documents (PPDs) from
their old structure into the approved new Google Docs template, with an AI-assisted
rewrite, two independent validation layers, and a full audit trail.

> **Internal use only.** Source documents are never modified. Migrated documents remain
> fully editable in Google Docs. No migration runs without an approved section mapping.

---

## What it does

| Page | Purpose |
|---|---|
| **Dashboard** | Live counts, migration progress, active template / AI instruction / mapping versions, recent activity |
| **Source Documents** | Seven criteria, editable sub-criteria, `old Google link → new Google link`, link validation and source scanning |
| **Template and AI Rules** | The approved Google Docs template (by URL), versioned AI instructions, and the section mapping with its approval state |
| **Migration and Validation** | Select documents, run migrations, review every change, both validation layers, resolve warnings, approve |
| **Reports and Activity** | Migration and per-document reports, CSV / JSON / printable HTML export, and the append-only activity log |

## How a migration works

```
Google Docs source → structured parser → internal JSON model → mapping engine
   → AI rewrite engine → validation engine → diff engine → Google Docs generator
```

A raw Google Doc is never sent to the AI. It is parsed into an internal model first,
where every content block gets a stable identifier — which is what makes "every source
block is accounted for" a check rather than a claim.

Output is always: `REVISED - [Document Code] [Document Title] (v2.1)`

## Guarantees, each covered by a test

- Source Google Docs are **never** modified — writes are refused if the target is a source
- Migration is **blocked** unless an approved, active mapping version exists
- Approval is **blocked** while any validation failure is unresolved; warnings must be acknowledged
- Change-record excerpts are **sliced from real content**, never authored by the AI
- Document codes, clause numbers, dates and factual values are checked by pure code, not by the AI
- The activity log is **append-only**, enforced by the database
- No secret and no document content reaches a log
- Nothing is shared with, or imported from, any other application on the server

---

## Documentation

| Document | For |
|---|---|
| [`docs/SETUP.md`](docs/SETUP.md) | First-time installation, step by step |
| [`docs/OPERATIONS.md`](docs/OPERATIONS.md) | Daily use, updating, troubleshooting |
| [`docs/NGINX.md`](docs/NGINX.md) | The Nginx route, and how to remove it |
| [`docs/BACKUP_AND_ROLLBACK.md`](docs/BACKUP_AND_ROLLBACK.md) | Backups, restoring, rolling back, uninstalling |
| [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) | Why it is built this way |

---

## Development

```bash
npm ci
npx prisma migrate deploy
node --experimental-strip-types prisma/seed.ts

npm run dev          # Vite dev server (client) on 5174
npm run dev:server   # Express (API) on 4020

npm run typecheck    # tsc --noEmit
npm test             # unit + component tests
npm run test:e2e     # Playwright, against a real server and a throwaway database
npm run build        # client + server → dist/
npm run measure      # report memory cost per dependency
```

No test touches live Google Drive, a real OpenAI key, or a real document.

**Stack:** TypeScript · Express 5 · React 19 · Vite 8 · Prisma 7 + SQLite · Zod ·
Vitest · Playwright. One process, one port, under PM2 behind the existing Nginx.

## Deployment

Runs at `https://apps.unitedceres.edu.sg/ppd_converter/`, from `/var/www/ppd_converter`,
as PM2 process `ppd_converter` bound to `127.0.0.1:4020`. Port 4020 is not publicly
reachable. See [`docs/SETUP.md`](docs/SETUP.md).
