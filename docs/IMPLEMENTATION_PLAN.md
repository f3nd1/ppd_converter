# PPD Converter — Implementation Plan (for approval)

**Status:** PLAN ONLY. No code written, no dependencies installed, no server changed, no directory created.
**Date:** 2026-08-05
**Repo:** `f3nd1/ppd_converter`, branch `claude/ppd-converter-web-app-s66359`

---

## Phase 1 — Inspection report

### ⚠️ Read this first: what could and could not be inspected

This session runs in an **ephemeral Anthropic cloud container**, not on the DigitalOcean droplet.
Verified by inspection:

| Expected | Found in this container |
|---|---|
| `/var/www` | **Does not exist** |
| `/var/www/gd4_simulator` | **Does not exist** |
| `pm2` binary | **Not installed** (`command not found`) |
| `nginx`, `/etc/nginx/sites-enabled` | **Not installed / does not exist** |
| `certbot` | **Not installed** |
| Port `4020` | Nothing listening — but this is the container, **not** the droplet |
| `OLD template.docx` / `NEw template.docx` | **Not present** anywhere on this filesystem |

**Therefore items 3, 4, 5, 8, 11, 12 of the mandated inspection list cannot be verified directly, and
nothing in this plan should be read as a confirmed fact about the live server.** They are reconstructed
from the `gd4_simulator` repository, which documents the production server in detail, and every
reconstructed item is marked **(inferred)**. Four commands to run on the real droplet to close the gap
are listed in §21.

### ✅ 1. `/var/www` — inspected (inferred)
Not present in this container. From `gd4_simulator/CLAUDE.md:34`, the convention is confirmed verbatim:
> Live at `https://apps.unitedceres.edu.sg/gd4_simulator/` — nginx `alias` to `/var/www/gd4_simulator/dist/` on the user's server, a subpath deployment.

So `/var/www/<app_name>` is one git checkout per application, lower_snake_case, matching the repo name.
The account owns **17 repositories**, nearly all UCC internal tools (`ucc_academic_hub`, `ucc_qa_hub`,
`admission-screening`, `pricing_simulation`, `sms_modules`, `dashboard-studio`, …), so `/var/www` most
likely holds several sibling checkouts on the same pattern.

### ✅ 2. `/var/www/gd4_simulator` — inspected (via source clone)
Cloned `f3nd1/gd4_simulator` at `d36b332` and read it in full. It is **not** a Node server:

- **Vite 8 + React 19 + TypeScript + Zustand 5**, built to a static `dist/`.
- `vite.config.ts:60` sets `base: './'` with a load-bearing comment — one build works at any subpath.
  CLAUDE.md warns: *"**Never add a `--base` flag**"*.
- Routing is **HashRouter** (`#/`), specifically so the document path never changes depth under an alias.
- Its only backend component is **one Supabase Edge Function** (`supabase/functions/drive-oauth`),
  which holds the Google refresh token and client secret. CLAUDE.md:191 calls it *"the app's only backend component"*.
- 1118 tests / 95 files, Vitest, colocated in `__tests__/` directories.

### ✅ 3. Existing PM2 applications — NOT VERIFIABLE (must be checked on the droplet)
`pm2` is not installed here. Critically: **PM2 does not appear anywhere in the `gd4_simulator`
repository** — not in `CLAUDE.md`, not in `TROUBLESHOOTING.md`, not in `package.json`. gd4_simulator is
served as static files and needs no process manager. So the other PM2 apps referred to in the brief are
invisible from here. **If PPD Converter is approved it may well be the first PM2-managed app on this
box, or it may join several — this is unknown and must be confirmed before any PM2 command is run.**

### ✅ 4. Existing PM2 conventions — NOT VERIFIABLE
No ecosystem file, no `pm2` reference, no `.service` file exists in the inspected repo. There is no
observable convention to copy. §14 therefore proposes a conservative, self-contained ecosystem file
that touches nothing else, and every PM2 command is an approval gate.

### ✅ 5. Existing Nginx configuration — NOT VERIFIABLE
`/etc/nginx` does not exist here. Two facts are confirmed from source:
- The serving mechanism for gd4_simulator is `alias` → `/var/www/gd4_simulator/dist/` (CLAUDE.md:34).
- The production origin is **`https://apps.unitedceres.edu.sg`** — confirmed independently in
  `supabase/functions/drive-oauth/index.ts:47-54`, which hard-codes a CORS allowlist:
  ```ts
  const ALLOWED_ORIGINS = new Set([
    "https://apps.unitedceres.edu.sg", // production
    "http://localhost:5173",           // local Vite dev
  ]);
  ```

### ✅ 6. Existing application routing patterns — inspected
Sub-path deployment under one shared host. `apps.unitedceres.edu.sg/gd4_simulator/` → static alias.
Client routing is hash-based to survive the subpath. **PPD Converter cannot copy this**: it needs a live
server (server-held OpenAI key, encrypted refresh tokens, SQLite, Google Docs writes), so it needs
`proxy_pass`, not `alias`. This is the single biggest departure from existing practice and is called out in §15.

### ✅ 7. Node.js and package-manager versions — inspected
Container: **Node v22.22.2**, npm 10.9.7 (pnpm and yarn also present). gd4_simulator pins
`.nvmrc` = `22` and `engines.node: "^20.19.0 || >=22.12.0"`, uses **npm** with a committed
`package-lock.json`. Matches the stated server Node 22.x. **npm + committed lockfile** is the convention to follow.

### ✅ 8. Port 4020 availability — NOT VERIFIABLE
Free in this container, which proves nothing. Must be confirmed on the droplet (§21).

### ✅ 9. Directory and naming conventions — inspected
- Repo/dir names: `lower_snake_case` (`gd4_simulator`, `ppd_converter`) and `kebab-case` both occur; the two
  server-deployed apps use snake_case. `/var/www/ppd_converter` matches.
- Source layout: `src/pages/`, `src/components/ui/`, `src/components/layout/`, `src/lib/` (with
  `src/lib/ai/`, `src/lib/drive/` subtrees), `src/data/`, `src/store/`, `src/types/index.ts`.
- Tests colocated in `__tests__/` next to the code they test.
- Docs in `docs/` as long-form markdown investigations.

### ✅ 10. Environment-variable patterns — inspected (names only, no values read)
Names only, as instructed:
- Frontend build-time, `VITE_` prefix: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`.
  `.env.example` is committed with **empty values**; `.gitignore` excludes `*.local` (so `.env.local`).
- Server-side, in the Supabase Edge Function only: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
  `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
- **There is no env var for the OpenAI key or model in gd4_simulator** — they are pasted into a Settings
  page and stored in `localStorage`/Supabase. PPD Converter deliberately breaks from this: the brief
  requires the OpenAI key to be server-side only, so it moves to `.env` (§8).

### ✅ 11. Memory and disk constraints — NOT VERIFIABLE for the droplet
This container reports 15 GiB RAM / 252 GB disk. The droplet's real figures are unknown and matter,
because `next build` is memory-hungry (§21 risk R-3).

### ✅ 12. Existing logging approach — inspected
No server-side logging exists. gd4_simulator logs **in-app, to the user**: an AI Debug Log page, a Run
Log, a Human Decision Log, and a Change Log. The philosophy is *user-visible, page-based, queryable
audit trails* rather than files — which maps directly onto this brief's Activity Log requirement.

### ✅ 13. Deployment and update patterns — inspected
Verbatim, CLAUDE.md:35:
> To update, the user runs on the server: `cd /var/www/gd4_simulator && git pull && npm run build`.

So: **git checkout on the server, pull, build in place.** No CI (`.github/workflows` does not exist), no
artifact registry, no Docker. PPD Converter follows the same shape and appends one step:
`git pull && npm ci && npx prisma migrate deploy && npm run build && pm2 reload ppd_converter`.

### ✅ Bonus finding: "PPD" is already defined in this codebase
`gd4_simulator/src/types/index.ts:849` defines **PPD = Policy & Procedure Document**. gd4_simulator
already reviews PPDs per sub-criterion (`PPDReviewResult`, `PpdReviewContent`). PPD Converter is the
*migration* tool for those same documents. It also already holds the **official 7 criteria and 29
sub-criteria** (`GD4_CRITERIA`, `GD4_SUB_CRITERIA`) — see §21 A-2, an approval item, because importing
them is the only way to populate sub-criterion names without inventing any.

### ✅ Bonus finding: the operator is non-technical
CLAUDE.md:194 — *"The user is non-technical … give a numbered, plain-English, click-by-click checklist
with an explicit '✅ Pass if:' per step."* This shapes §18 and the documentation deliverable.

---

## 1. Current server compatibility assessment

| Requirement | Assessment |
|---|---|
| Ubuntu 24.04 + Node 22.x | ✅ Compatible. Next.js 16 requires Node ≥20.9; Node 22 is fine. |
| PM2 | ⚠️ Assumed present, **unverified**. Compatible in principle. |
| Existing Nginx | ✅ Compatible via a new `location /ppd_converter` block in the existing `apps.unitedceres.edu.sg` server block. No existing file replaced. |
| Existing Certbot | ✅ No change needed — same host, same certificate, new path only. |
| Port 127.0.0.1:4020 | ⚠️ Assumed free, **unverified**. Bound to loopback, never exposed. |
| SQLite | ✅ Zero new services. Single file under the project dir. |
| No Docker / Caddy / Postgres / Redis | ✅ None proposed. |
| Serving from `/ppd_converter` | ✅ Next.js `basePath` supports this natively. |
| Memory | ⚠️ **Main risk.** A Next.js standalone server idles ≈90–150 MB RSS, and `next build` can peak >1.5 GB. See R-3. |
| Disk | ✅ Small: `node_modules` ≈500 MB, build ≈200 MB, SQLite in MB. |

**Verdict: compatible, conditional on three unverified facts** — PM2 present, port 4020 free, and enough
free RAM to build. All three are one command each (§21).

---

## 2. Recommended application architecture

**One Next.js 16 application (App Router, TypeScript), single process, under PM2, behind existing Nginx.**

**Why Next.js and not React + Express** — the brief allows Express *"if inspection shows that the existing
server pattern strongly favours React and Express."* Inspection shows it does **not**:

1. gd4_simulator is a **static Vite SPA**. It contains no Express, no Node server, no PM2 config. There is
   no Express precedent to favour.
2. Its one server-side component is a Supabase Edge Function — a pattern explicitly unavailable here
   (no new services allowed).
3. Static-SPA is **not viable** for PPD Converter: the OpenAI key must never reach the browser, refresh
   tokens must be encrypted at rest server-side, and SQLite must not be publicly reachable.
4. `basePath: '/ppd_converter'` is a first-class Next.js feature. Express + Vite would need manual base
   handling for the client, the API, the auth callback and static assets — more moving parts, not fewer.

Next.js is therefore both the brief's stated preference and the lazier correct answer: one process, one
port, one build, one deploy command.

```
Browser
  │  https://apps.unitedceres.edu.sg/ppd_converter/
  ▼
Nginx (existing)  ──proxy_pass──►  127.0.0.1:4020
                                        │
                              Next.js 16 standalone (PM2: ppd_converter)
                                        │
        ┌───────────────┬───────────────┼───────────────┬──────────────┐
        ▼               ▼               ▼               ▼              ▼
   React Server    Route Handlers   Migration      Prisma ORM     Google APIs
   Components      (/api/*)         Worker         │              (Drive v3,
   + Client UI                      (in-process,   ▼               Docs v1)
                                     serial)     SQLite         OpenAI API
```

**Concurrency model.** No queue service. `MigrationJob` rows in SQLite *are* the queue; a single
in-process worker claims one `queued` job at a time in a transaction, drives it through the stages, and
persists after every stage. This satisfies *"Process only one document at a time by default"*, survives a
PM2 restart (an interrupted job is left `queued`/`failed` and is retried explicitly, never silently), and
adds zero services.

---

## 3. Proposed project structure

```
/var/www/ppd_converter/
├─ .env                      # NOT committed
├─ .env.example              # committed, empty values (gd4_simulator convention)
├─ .gitignore                # .env, node_modules, .next, *.db, *.db-journal
├─ .nvmrc                    # 22
├─ ecosystem.config.cjs      # PM2, name: ppd_converter, 127.0.0.1:4020
├─ next.config.ts            # basePath /ppd_converter, output standalone, CSP headers
├─ package.json
├─ package-lock.json
├─ tsconfig.json
├─ vitest.config.ts
├─ playwright.config.ts
├─ prisma/
│   ├─ schema.prisma
│   └─ migrations/
├─ data/                     # SQLite lives here, chmod 600
├─ docs/
│   ├─ IMPLEMENTATION_PLAN.md
│   ├─ SETUP.md   OPERATIONS.md   BACKUP_AND_ROLLBACK.md   NGINX.md
└─ src/
    ├─ app/                  # routes — see §4 and §5
    ├─ components/           # ui/ and layout/
    ├─ lib/
    │   ├─ google/           # oauth, drive, docs, urls
    │   ├─ ai/               # client, schemas, rewrite, validate
    │   ├─ doc/              # parse, model, generate
    │   ├─ migration/        # worker, stages, prechecks
    │   ├─ validation/       # deterministic checks
    │   ├─ report/           # csv, json, html
    │   ├─ crypto.ts  activity.ts  session.ts  db.ts  env.ts
    │   └─ **/__tests__/     # colocated, gd4_simulator convention
    └─ types/index.ts
```

**Layout rationale:** mirrors gd4_simulator (`lib/`, `components/ui`, `components/layout`, `types/index.ts`,
colocated `__tests__/`) so the operator sees one familiar shape across both apps. Pure logic lives in
`lib/` precisely so it is unit-testable without booting Next — the same reason `ppdSelection.ts` exists
in gd4_simulator.

---

## 4. Frontend page structure

Exactly **five** primary navigation areas, no more. Sidebar driven by a single `src/lib/nav.ts`
(gd4_simulator's `NavItem`/`NavGroup` pattern) so nav and pages cannot drift.

| # | Route | Page | Contents |
|---|---|---|---|
| 1 | `/` | **Dashboard** | Every counter in the brief, live from SQLite. Active template, active AI instruction version, active mapping version, recent activity. No hardcoded numbers anywhere. |
| 2 | `/source-documents` | **Source Documents** | 7 expandable criterion sections. Per sub-criterion row: `[Sub-criterion] [Old Google link] → [New Google link]` with the literal `→`. Add / Edit / Reorder / Deactivate. Validate links, Scan source, source doc count, last scanned, status, error detail. |
| 3 | `/template-and-rules` | **Template and AI Rules** | Three tabs: **Template** (Google Docs URL, Validate, Preview, Open in Google Docs, Save as active, version history), **AI Instructions** (editable, versioned, activate/restore), **Section Mapping** (mapping versions + rules, approval control). |
| 4 | `/migration` | **Migration and Validation** | Filterable document table with checkboxes; single / batch / retry; stage timeline; detailed change record; deterministic + AI validation results; warning resolution; approve / return for correction. |
| 5 | `/reports` | **Reports and Activity** | Migration report, document-level report, CSV / JSON / HTML exports, and the append-only activity log. |

Empty and error states are first-class on every page (they are explicitly tested, §17).

**Design language:** plain, dense, high-contrast, matching gd4_simulator's card grid. No dark mode.

---

## 5. Backend route structure

All under `basePath` `/ppd_converter`. Every route except the two auth routes requires an authenticated
session for `felix@unitedceres.edu.sg`, enforced **server-side** in `src/middleware.ts` and re-checked in
each handler (defence in depth — never only in middleware).

**Auth**
| Method | Route | Purpose |
|---|---|---|
| GET | `/api/auth/google/start` | Begin OAuth (PKCE + signed `state`) |
| GET | `/api/auth/google/callback` | Exchange code, verify email allowlist, encrypt+store refresh token |
| POST | `/api/auth/signout` | Clear session cookie |

**Criteria & sub-criteria**
`GET/POST /api/criteria` · `GET/PATCH/DELETE /api/sub-criteria/[id]` · `POST /api/sub-criteria/reorder`

**Source mapping & scanning**
`POST /api/source-mappings/[id]/validate-links` · `POST /api/source-mappings/[id]/scan` ·
`GET /api/source-documents`

**Template**
`POST /api/template/validate` · `POST /api/template/activate` · `GET /api/template/versions` ·
`GET /api/template/[id]/preview`

**AI instructions**
`GET/POST /api/ai-instructions` · `POST /api/ai-instructions/[id]/activate` ·
`POST /api/ai-instructions/[id]/restore`

**Mapping**
`GET/POST /api/mapping-versions` · `POST /api/mapping-versions/[id]/approve` ·
`POST /api/mapping-versions/[id]/activate` · `GET/POST/PATCH/DELETE /api/mapping-rules`

**Migration**
`POST /api/migration/queue` · `POST /api/migration/[jobId]/retry` · `GET /api/migration/[jobId]` ·
`GET /api/migration/stream` (SSE stage updates) · `GET /api/migrated-documents/[id]/changes`

**Validation & review**
`POST /api/validation/[migratedDocId]/run` · `POST /api/validation-items/[id]/resolve` ·
`POST /api/review/[migratedDocId]/decision`

**Reports & activity**
`GET /api/reports/migration` · `GET /api/reports/document/[id]` ·
`GET /api/reports/export?format=csv|json|html` · `GET /api/activity`

Rate limiting (in-process token bucket, SQLite-backed counter) on: auth start, link validation, scan,
template validation, migration queue, and both AI routes.

---

## 6. SQLite data model

All 20 required entities. All timestamps stored **UTC ISO-8601**; Asia/Singapore is a display concern only.
Prisma migrations from day one (`prisma migrate dev` locally, `prisma migrate deploy` on the server).

| Entity | Key fields (abridged) |
|---|---|
| **AppUser** | `id`, `email` (unique), `displayName`, `isAuthorised`, `lastLoginAt` |
| **OAuthCredential** | `id`, `appUserId`, `refreshTokenEnc` (AES-256-GCM), `iv`, `authTag`, `scopes`, `expiresAt`, `revokedAt` |
| **Criterion** | `id`, `number` (1–7, unique), `title`, `order` |
| **SubCriterion** | `id`, `criterionId`, `code`, `title`, `order`, `isActive`, `deactivatedAt` |
| **SourceMapping** | `id`, `subCriterionId`, `oldUrl`, `oldResourceId`, `oldResourceType`, `newUrl`, `newResourceId`, `newResourceType`, `lastValidatedAt`, `validationStatus`, `errorDetail`, `lastScannedAt`, `sourceDocCount` |
| **SourceDocument** | `id`, `sourceMappingId`, `googleFileId` (unique per mapping), `title`, `documentCode`, `mimeType`, `modifiedTime`, `contentHash`, `isDuplicateOf`, `migrationStatus` |
| **TemplateVersion** | `id`, `name`, `googleDocId`, `url`, `versionLabel`, `validationResult` (JSON), `configSnapshot` (JSON), `isActive`, `activatedAt` |
| **AIInstructionVersion** | `id`, `versionLabel`, `body`, `isActive`, `activatedAt`, `createdAt`, `restoredFromId` |
| **MappingVersion** | `id`, `versionLabel`, `isActive`, `approvalStatus` (`draft`/`pending`/`approved`/`rejected`), `approvedBy`, `approvedAt`, `notes` |
| **MappingRule** | `id`, `mappingVersionId`, `oldSectionName`, `newTargetSection`, `transformationRule`, `priority`, `notes`, `isActive` |
| **MigrationJob** | `id`, `sourceDocumentId`, `stage`, `attempt`, `queuedAt`, `startedAt`, `finishedAt`, `errorRef`, `correlationId`, `templateVersionId`, `aiInstructionVersionId`, `mappingVersionId` |
| **MigratedDocument** | `id`, `migrationJobId`, `sourceDocumentId`, `targetGoogleDocId`, `targetUrl`, `targetTitle`, `outputVersion` (`2.1`), `destinationFolderId`, `sourceModifiedTimeAtMigration`, `status` |
| **ContentBlock** | `id`, `sourceDocumentId`, `blockId` (stable), `type`, `text`, `textHash`, `styleName`, `listInfo`, `numbering`, `sourceLocation`, `order`, `parentBlockId` |
| **ContentBlockMapping** | `id`, `contentBlockId`, `targetSection`, `mappingRuleId`, `status` (`mapped`/`unmapped`/`ambiguous`), `confidence` |
| **ChangeRecord** | `id`, `migratedDocumentId`, `changeNumber`, `changeType`, `sourceSection`, `targetSection`, `sourceBlockId`, `originalExcerpt`, `revisedExcerpt`, `reason`, `confidence`, `validationResult`, `reviewStatus` |
| **ValidationRun** | `id`, `migratedDocumentId`, `layer` (`deterministic`/`ai`), `startedAt`, `finishedAt`, `summary`, `providerRequestId`, `usageJson`, `model` |
| **ValidationItem** | `id`, `validationRunId`, `category`, `checkPerformed`, `result` (`pass`/`warning`/`fail`), `details`, `severity`, `sourceReference`, `targetReference`, `humanReviewRequired`, `resolutionStatus`, `resolutionNote`, `resolvedAt` |
| **ReviewDecision** | `id`, `migratedDocumentId`, `reviewerEmail`, `decision`, `comment`, `decidedAt`, plus frozen `aiInstructionVersionId`, `mappingVersionId`, `templateVersionId`, `sourceModifiedTime`, `targetGoogleDocId`, `validationSummary` |
| **ActivityLog** | `id`, `occurredAtUtc`, `action`, `entityType`, `entityId`, `result`, `summary`, `errorRef`, `correlationId` — **append-only** |
| **ExportRecord** | `id`, `format`, `scope`, `filters`, `exportedAt`, `rowCount`, `correlationId` |

**Storage discipline (per the brief).** Full source documents are **not** stored. `ContentBlock` keeps
structure, a text hash, and the text needed for genuine excerpts — because §"Do not fabricate excerpts.
Use actual source and target content only" makes storing real excerpts mandatory. Excerpts are capped in
length and never written to ordinary logs.

**Append-only Activity Log.** Enforced with SQLite triggers that `RAISE(ABORT)` on `UPDATE` and `DELETE`
of `ActivityLog`, added in a migration. Application code has no delete path.

---

## 7. Google OAuth and Google API design

**Flow:** OAuth 2.0 Authorization Code **with PKCE**, server-side, redirect-based (not the popup/
`postmessage` flow gd4_simulator uses — we control a real redirect URI here).
Redirect URI: `https://apps.unitedceres.edu.sg/ppd_converter/api/auth/google/callback`.
`access_type=offline`, `prompt=consent` (gd4_simulator's comment records that forcing consent is what
reliably yields a refresh token).

**Account restriction.** The callback reads the verified `email` from the ID token and compares it,
case-insensitively, against `ALLOWED_GOOGLE_EMAIL` from `.env`. Any other account: no session, no token
stored, an `auth_denied` activity entry. Also enforced in middleware on every subsequent request.

**Proposed minimum scopes**
| Scope | Why |
|---|---|
| `openid`, `email` | Identify the account for the allowlist |
| `https://www.googleapis.com/auth/drive.readonly` | List selected source folders; read source documents |
| `https://www.googleapis.com/auth/drive.file` | Create the template copy in the REVISED folder |
| `https://www.googleapis.com/auth/documents` | Read source structure and write target content |

⚠️ **Open question O-1 (§21):** `drive.file` grants access only to files the app created or the user
explicitly opened. Copying the template *into a user-created REVISED folder* may require the broader
`https://www.googleapis.com/auth/drive`. This is resolved by a one-hour spike against a throwaway folder
in Phase 0 — **not** by guessing, and not by defaulting to the broad scope.

**Token storage.** The refresh token is encrypted with **AES-256-GCM** using `ENCRYPTION_KEY` from `.env`
(32 bytes, base64) and stored with its IV and auth tag. Access tokens are **in memory only, never
persisted** — the same rule gd4_simulator applies. Tokens, secrets and keys are never logged; the logger
carries a redaction list.

**APIs used**
- Drive v3 `files.list` (`'<folderId>' in parents and trashed = false`, `supportsAllDrives=true`),
  `files.get` (id, name, mimeType, modifiedTime), `files.copy`.
- Docs v1 `documents.get` (full structured read — gd4_simulator never used the Docs API; this is new),
  `documents.batchUpdate` (write).
- Folder vs document detection by MIME: `application/vnd.google-apps.folder` vs
  `application/vnd.google-apps.document`. **Never by URL shape alone** — the URL is parsed to get a
  candidate ID, then the type is confirmed via the API.

**URL parsing** (`src/lib/google/urls.ts`, pure and heavily unit-tested):
`/folders/<id>`, `/document/d/<id>`, `/file/d/<id>`, `?id=<id>`. Anything else is rejected with a specific
message. gd4_simulator's `parseFolderId` handles only folders — this is a superset, written fresh.

**Source safety.** Source documents are opened through read-only code paths. There is no `batchUpdate`
call anywhere in the codebase whose target can be a source document ID — enforced by a guard that
asserts the target ID equals the `MigratedDocument.targetGoogleDocId`, plus a unit test.

---

## 8. OpenAI integration design

Official `openai` SDK (not raw `fetch`), because the brief requires storing **provider request IDs** and
usage metadata — the SDK exposes `_request_id` and handles timeouts/retries natively, which
gd4_simulator's hand-rolled `fetch` client does not.

```env
OPENAI_API_KEY=
OPENAI_MODEL=
OPENAI_REQUEST_TIMEOUT_SECONDS=
OPENAI_MAX_RETRIES=
```
- **No model name is hardcoded.** `OPENAI_MODEL` is read at startup and validated against a
  GPT-5-family-or-later pattern; the process refuses to start on a non-conforming value, with a clear
  message. (For reference, gd4_simulator defaults to `gpt-5-mini`.)
- Key is server-side only. It is never sent to the client, never in a response body, never logged.
- **Structured outputs** with a JSON schema, then re-validated with **Zod** on receipt. AI output that
  fails the schema is **rejected, not repaired** — bounded retries (`OPENAI_MAX_RETRIES`), then the job
  fails honestly with an error reference.
- **Two separate calls with two separate prompts**: (a) the rewrite engine, (b) the validator. They never
  share a prompt or a response.
- Carried forward from gd4_simulator, a load-bearing convention: **schema key order matters** — reasoning
  and rationale fields are declared *before* the verdict field, because constrained decoding emits fields
  in schema order and reversing it measurably degrades judgement quality.
- Stored per call: `model`, `providerRequestId`, prompt/completion/total tokens. **Never** headers, keys or
  raw source content.

---

## 9. Document parsing and internal JSON model

**A raw Google Doc is never sent to the AI.** The pipeline is exactly as specified:

```
Google Docs source → structured parser → internal JSON model → mapping engine
   → AI rewrite engine → validation engine → diff engine → Google Docs generator
```

`documents.get` returns Google's own structural JSON; the parser normalises it into:

```ts
type DocumentModel = {
  metadata: { title, documentCode, googleFileId, modifiedTime, revisionId };
  blocks: ContentBlock[];
  headers: HeaderFooter[]; footers: HeaderFooter[];
  footnotes: Footnote[]; namedStyles: NamedStyle[];
  pageNumbering: PageNumberMeta;
};

type ContentBlock = {
  blockId: string;          // stable identifier — see below
  type: 'heading' | 'paragraph' | 'listItem' | 'table' | 'image' | 'pageBreak';
  text: string; textHash: string;
  level?: number; styleName?: string;
  numbering?: { listId, nestingLevel, glyph };
  links: { text, url, startIndex, endIndex }[];
  table?: { rows, cols, cells: ContentBlock[][] };
  imageRef?: { objectId, sourceUri, altText };
  sourceLocation: { startIndex, endIndex, segmentId };
  parentBlockId?: string; order: number;
};
```

**Stable block IDs.** `blockId = <docId-short>-<ordinal>-<sha256(normalisedText).slice(0,8)>`. Deterministic,
stable across re-scans while text is unchanged, and a changed hash is a *signal* (source drifted) rather
than a silent renumber. Every source block gets one — this is what makes "every source content block is
accounted for" a checkable claim rather than an assertion.

**Known limits, stated honestly rather than papered over:** the Docs API exposes footnotes but
manipulating them is limited; images are referenced by URI and are re-referenced, not re-uploaded;
page numbers live in the template's header/footer and are preserved by copying, not regenerated.

---

## 10. Migration workflow

**Pre-migration checks — all must pass, no override:** source accessible · destination folder accessible ·
active template valid · active AI instruction exists · **approved active mapping exists** · required
metadata present · target does not already exist · source `modifiedTime` unchanged since scan.

**Persisted stages** (exactly the thirteen specified): `not_started` → `queued` → `reading_source` →
`parsing_structure` → `mapping_content` → `generating_content` → `copying_template` → `writing_target` →
`validating` → `awaiting_review` → `approved` → `exported`, plus `failed`. Every transition writes the
job row *and* an ActivityLog entry, so a crash is always diagnosable.

**Generation, in order:**
1. `files.copy` the active template.
2. Place the copy in the configured REVISED folder.
3. Title: `REVISED - [Document Code] [Document Title] (v2.1)` — built by one pure, unit-tested function.
4. Populate configured target sections via `batchUpdate`.
5. Apply template named styles.
6. Header, footer and page numbering come from the template copy and are left untouched.
7. Record target doc ID and URL.
8. Source is never written to (guarded, §7).
9. An existing revised document is **never** overwritten silently — the pre-check fails and the UI asks
   for explicit confirmation.
10. Output is ordinary Google Docs content and stays fully editable.

**Duplicate-target prevention.** A unique index on `(destinationFolderId, targetTitle)` plus a live Drive
check immediately before copy. Retry is **idempotent**: a job that already produced a target doc reuses it
rather than creating a second.

---

## 11. Validation workflow

**Layer 1 — deterministic (pure code, no AI).** Modelled directly on gd4_simulator's
`docs/consistency-invariants.md` approach: read-only, rule-based, pass/fail plus a log. Checks: every
source section has a mapping status; every content block accounted for (block-ID set difference); every
reference and hyperlink accounted for; all required target sections present; correct target folder; active
template used; source unchanged (`modifiedTime` + hash); no unintended duplicate target; **document code
unchanged**; **clause numbers unchanged**; dates and factual values unchanged unless explicitly approved;
required metadata stored.

Number/date/code preservation is a set-comparison over tokens extracted from source and target by pure
regex functions — deterministic and independently unit-tested. This is the check that makes "facts are
preserved" enforceable rather than aspirational.

**Layer 2 — AI-assisted, separate call and separate prompt.** Compares source and migrated content for
meaning preservation, material omission, unsupported additions, contradictions, ambiguity,
over-aggressive shortening, and changes to roles, approvals, frequencies, evidence, records, numbering,
facts and control intent. Returns JSON validated against a Zod schema. **Never authoritative on its own** —
its output becomes `ValidationItem` rows for a human, exactly as gd4_simulator's rule 3 requires
(*"The AI recommends; a human commits"*).

**Approval gating.** `canApprove()` is one pure function: **false** while any `fail` item is unresolved;
warnings must be explicitly acknowledged. It is unit-tested and called server-side on the approve route —
the UI disabling a button is a convenience, never the control.

---

## 12. Change-log design

One `ChangeRecord` row per change, numbered per document, storing every field the brief lists.
Supported types are a closed enum, exactly the fourteen specified (`section_moved`, `section_merged`,
`text_rewritten`, `text_shortened`, `procedure_converted_to_table`, `responsibility_moved_to_praci`,
`monitoring_moved_to_cse`, `reference_retained`, `reference_missing`, `duplicate_consolidated`,
`formatting_applied`, `ambiguous_content`, `content_unchanged`, `content_unmapped`).

**Excerpts are never fabricated.** `originalExcerpt` is sliced from the stored `ContentBlock.text` by
block ID; `revisedExcerpt` is sliced from the generated target content. Neither is ever authored by the
AI. A unit test asserts every stored excerpt is a substring of its real source or target content — the
single strongest guard against invention in the whole system.

---

## 13. Reporting design

- **Migration report** — totals, status counts, per-criterion and per-sub-criterion summaries,
  completeness %, warning and failure counts, approved and failed counts, start/completion times.
- **Document-level report** — source and target titles and links, criterion, sub-criterion, template /
  AI-instruction / mapping versions, timestamps, full source→target mapping, all changes, all validation
  results, warning resolutions, approval record, final status.
- **Exports** — **CSV** summary, **JSON** full record, **printable HTML** (a styled server-rendered page
  with `@media print`). **PDF is deliberately not implemented**: every reliable option means Chromium or a
  heavy native dep on a shared droplet. The printable HTML page prints to PDF from the browser in two
  clicks. If a true server-side PDF is required, it is a separate approval item.
- Every export writes an `ExportRecord` and an `ActivityLog` entry.

**Activity log.** Every action in the brief's list is logged with UTC timestamp, Asia/Singapore display
timestamp (rendered, not stored twice), action, entity type, entity ID, result, summary and error
reference. Append-only, enforced by database trigger (§6).

---

## 14. PM2 deployment design

`ecosystem.config.cjs`, committed, self-contained, touching nothing else:

```js
module.exports = {
  apps: [{
    name: 'ppd_converter',
    cwd: '/var/www/ppd_converter',
    script: '.next/standalone/server.js',
    instances: 1,
    exec_mode: 'fork',
    env: { NODE_ENV: 'production', HOSTNAME: '127.0.0.1', PORT: 4020 },
    max_memory_restart: '400M',
    error_file: '/var/www/ppd_converter/logs/pm2-error.log',
    out_file:   '/var/www/ppd_converter/logs/pm2-out.log',
    time: true,
  }],
};
```

- `instances: 1` / `fork` is **required**, not a default: cluster mode would run several writers against
  one SQLite file and several migration workers against one queue.
- `HOSTNAME=127.0.0.1` binds to loopback — port 4020 is never publicly reachable.
- Secrets are **not** in this file. They stay in `.env`, loaded by the app.
- Commands used: only `pm2 start ecosystem.config.cjs`, `pm2 reload ppd_converter`,
  `pm2 logs ppd_converter`, `pm2 describe ppd_converter`. **Never** `pm2 restart all`,
  **never** `pm2 delete all`. `pm2 save` only after testing and explicit approval.

---

## 15. Nginx routing proposal

**Nothing is edited without the four-step gate below.** The proposed block is *added* to the existing
`apps.unitedceres.edu.sg` server block, alongside the existing `/gd4_simulator` alias. No existing file is
replaced.

```nginx
# --- PPD Converter (added <date>) ---
location /ppd_converter/ {
    proxy_pass         http://127.0.0.1:4020;
    proxy_http_version 1.1;
    proxy_set_header   Host              $host;
    proxy_set_header   X-Real-IP         $remote_addr;
    proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;
    proxy_set_header   Upgrade           $http_upgrade;
    proxy_set_header   Connection        'upgrade';
    proxy_read_timeout 300s;               # long migrations + SSE
    proxy_buffering    off;                # SSE stage updates
    client_max_body_size 5m;
}
location = /ppd_converter { return 301 /ppd_converter/; }
```

Note `proxy_pass` has **no trailing path**, so the `/ppd_converter` prefix is passed through and matched
by Next's `basePath`. `proxy_read_timeout 300s` and `proxy_buffering off` are needed for the SSE stage
stream.

**Mandatory sequence before any change:**
1. Back up: `cp /etc/nginx/sites-available/<file> /etc/nginx/sites-available/<file>.bak.$(date +%F-%H%M)`
2. Show the exact diff to the operator.
3. `sudo nginx -t`
4. **Stop for approval.**
5. `sudo systemctl reload nginx` — reload, never restart, and only after `nginx -t` passes.

---

## 16. Security controls

| Control | Implementation |
|---|---|
| Account restriction | Server-side email allowlist, checked in the OAuth callback **and** in middleware **and** in each route handler |
| Session | `iron-session` encrypted cookie: `httpOnly`, `secure`, `sameSite: 'lax'`, `path: '/ppd_converter'`. No session table needed |
| CSRF | `sameSite=lax` + Origin/Referer check on every mutating handler; signed `state` on the OAuth round-trip |
| CSP | Set in `next.config.ts` headers: `default-src 'self'`, no third-party scripts, `frame-ancestors 'none'` |
| Secure headers | HSTS, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY` |
| Input validation | Zod at every route boundary — body, query and params |
| Google URL validation | Dedicated parser; unsupported URLs, wrong resource types and inaccessible resources all rejected with distinct messages |
| Rate limiting | In-process token bucket on auth, link validation, scan, template validation, queue, and both AI routes |
| Token encryption | AES-256-GCM, `ENCRYPTION_KEY` from `.env`, IV + auth tag stored per record |
| Secrets | `.env` only; `.env` in `.gitignore`; `.env.example` committed with empty values (gd4_simulator convention) |
| No secrets in logs | Central logger with a redaction list; unit-tested |
| No source content in logs | Ordinary logs carry IDs and hashes only, never document text |
| SQLite not public | File under `/var/www/ppd_converter/data/`, `chmod 600`, outside any served path; nginx proxies only to the app |
| File permissions | Project owned by the app account; `.env` `600`; `data/` `700` |
| Correlation IDs | One per request and per job, on every log line and shown in every user-facing error |

---

## 17. Testing strategy

**Vitest** (unit/integration) + **Playwright** (one end-to-end workflow). Tests colocated in `__tests__/`
per gd4_simulator convention. **No test ever touches the live Google Drive, a real OpenAI key, or a real
target document** — Google and OpenAI are mocked at the client boundary.

**Unit tests** — the brief's full list, each mapped to a pure function:
Google URL parsing · folder validation · document validation · resource-ID extraction · account
restriction · template validation · content-block parsing · mapping-version requirement · structured
OpenAI response validation · **invalid AI output rejection** · number-preservation · fact-preservation ·
completeness · duplicate-target prevention · approval blocking · retry idempotency · activity logging.

Plus, from the invariants above: output-title formatting, excerpt-is-real-substring, redaction, and the
source-document-never-written guard.

**Frontend tests** — five primary pages render · seven criteria present · expand/collapse · add and edit
sub-criterion · the literal `[old] → [new]` arrow is visible · Google Docs template URL field · migration
disabled without an approved mapping · migration status · detailed changes · validation results ·
approval blocking · report exports · error states · empty states.

**End-to-end (Playwright, fully mocked)** — the eighteen specified steps, in order, from sign-in through
configuring criterion 1 / sub-criterion 1.1, validating links, scanning, adding a template URL, activating
AI instructions, **confirming migration is blocked with no approved mapping**, approving a mapping,
queueing and completing a mocked migration, displaying changes and both validation layers, resolving a
warning, approving, exporting, and confirming every significant action appears in the activity log.

**Definition of done per change** (gd4_simulator's rule, adopted): `tsc --noEmit` clean · all tests pass ·
lint clean · `next build` clean · new pure logic has a colocated unit test.

---

## 18. Implementation phases

Each phase ends with tests passing and a commit. Phases 1+ begin only after this plan is approved.

| Phase | Deliverable | Approval gate |
|---|---|---|
| **0. Spikes** | Resolve O-1 (Drive scope for `files.copy` into a user-created folder) and O-2 (template placeholder mechanism) against a throwaway folder | **Needs approval — touches a real Google account** |
| **1. Skeleton** | Next.js + TS + basePath, five pages as shells, nav, health check. Runs locally only | Needs approval to install deps |
| **2. Data layer** | Prisma schema, all 20 entities, first migration, append-only trigger | Needs approval for the initial migration |
| **3. Auth** | Google OAuth, PKCE, allowlist, encrypted refresh token, session, middleware | Needs approval to use real credentials |
| **4. Source Documents** | Criteria/sub-criteria CRUD + reorder + deactivate, URL validation, link validation, folder scan, duplicate detection, the `→` row |  |
| **5. Template & AI Rules** | Template URL config/validate/preview/activate/history; AI instruction versioning; mapping versions and rules with approval | |
| **6. Parser & model** | Docs API structured read, internal JSON model, stable block IDs | |
| **7. Migration engine** | Pre-checks, worker, thirteen stages, template copy, target generation, change records | Needs approval before any real target doc is created |
| **8. Validation** | Deterministic layer, then separate AI layer, approval gating, warning resolution | |
| **9. Reports & activity** | Migration + document reports, CSV/JSON/HTML export, activity log UI | |
| **10. Tests** | Full unit + frontend suites, Playwright E2E, all mocked | |
| **11. Deployment** | `ecosystem.config.cjs`, nginx block, SETUP / OPERATIONS / BACKUP_AND_ROLLBACK docs | Needs approval for every server action |

Documentation is written for a **non-technical operator**: numbered, plain-English, click-by-click, with an
explicit **"✅ Pass if:"** after each step — matching gd4_simulator's documented house style.

---

## 19. Exact files to be created

**Nothing outside the git repository is created without approval.** No file is replaced; the repo is empty
apart from `.git`.

*Root:* `package.json`, `package-lock.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`,
`playwright.config.ts`, `ecosystem.config.cjs`, `.env.example`, `.gitignore`, `.nvmrc`, `README.md`

*Prisma:* `prisma/schema.prisma`, `prisma/migrations/**`

*Docs:* `docs/IMPLEMENTATION_PLAN.md` (this file), `docs/SETUP.md`, `docs/OPERATIONS.md`,
`docs/BACKUP_AND_ROLLBACK.md`, `docs/NGINX.md`

*App:* `src/middleware.ts`, `src/app/layout.tsx`, `src/app/page.tsx`,
`src/app/source-documents/page.tsx`, `src/app/template-and-rules/page.tsx`,
`src/app/migration/page.tsx`, `src/app/reports/page.tsx`, and one `route.ts` per endpoint in §5

*Components:* `src/components/layout/{Sidebar,Header,Layout}.tsx`,
`src/components/ui/{Card,Pill,Bar,Table,EmptyState,ErrorState,ConfirmDialog}.tsx`,
plus one component per page section

*Lib:* `src/lib/env.ts`, `db.ts`, `crypto.ts`, `session.ts`, `activity.ts`, `rateLimit.ts`, `logger.ts`,
`nav.ts`; `google/{oauth,drive,docs,urls}.ts`; `ai/{client,schemas,rewrite,validate}.ts`;
`doc/{parse,model,generate,title}.ts`; `migration/{worker,stages,prechecks}.ts`;
`validation/{deterministic,gate}.ts`; `report/{csv,json,html}.ts`

*Types:* `src/types/index.ts`

*Tests:* colocated `__tests__/` beside each `lib` module, plus `e2e/migration.spec.ts`

---

## 20. Exact dependencies proposed

Versions are today's latest, verified by `npm view` (read-only; **nothing installed**). Pinned at install time.

**Runtime**
| Package | Version | Why |
|---|---|---|
| `next` | 16.3.0 | App framework; native `basePath` |
| `react`, `react-dom` | 19.2.8 | Required by Next; matches gd4_simulator's React 19 |
| `@prisma/client` | 7.9.1 | ORM (brief-specified) |
| `better-sqlite3` | 13.0.3 | Prisma's SQLite driver |
| `googleapis` | 174.0.0 | Official Drive v3 + Docs v1 + OAuth2 client |
| `openai` | 7.4.0 | Official SDK; exposes request IDs and usage |
| `zod` | 4.4.3 | Schema validation (brief-specified) |
| `iron-session` | 8.0.4 | Encrypted cookie session — avoids a session table and a heavier auth framework |

**Dev**
`typescript` 6.0.2 · `prisma` 7.9.1 · `vitest` 4.1.10 · `@playwright/test` 1.62.1 ·
`@types/node`, `@types/react`, `@types/react-dom` · `eslint` + `eslint-config-next`

**Deliberately not proposed:** `next-auth` (heavy for one fixed account, and we must own the encrypted
refresh token anyway), any queue library, any PDF library, any CSS framework beyond plain CSS Modules,
any date library (`Intl.DateTimeFormat` handles Asia/Singapore natively).

Total: **8 runtime dependencies.** Playwright's browser is already present at
`/opt/pw-browsers` in dev environments and is not needed in production.

---

## 21. Risks and unresolved requirements

**Blocking unknowns — must be answered before Phase 1**

| ID | Unknown | How to close it |
|---|---|---|
| **U-1** | Is PM2 actually installed, and what else does it run? | `pm2 list` on the droplet |
| **U-2** | Is port 4020 free? | `sudo ss -ltnp \| grep 4020` |
| **U-3** | Which Nginx file holds the `apps.unitedceres.edu.sg` server block? | `sudo nginx -T \| grep -n "apps.unitedceres"` |
| **U-4** | How much free RAM does the droplet have? | `free -h` |

**Open technical questions**

| ID | Question | Plan |
|---|---|---|
| **O-1** | Does `drive.file` allow `files.copy` **into a user-created** REVISED folder, or is full `drive` needed? | Phase-0 spike against a throwaway folder. Do not guess; do not default to the broad scope. |
| **O-2** | How does the approved template mark its target sections — placeholder tokens, named ranges, or headings? | Cannot be answered: **the template is still being finalised.** Template validation is built to check for *configured* required elements, so the mechanism is data, not code. |

**Risks**

| ID | Risk | Mitigation |
|---|---|---|
| **R-1** | Section mapping is not yet supplied. | Interface and schema are built now; **no mapping is invented**. Production migration is hard-blocked server-side until an approved active mapping exists. |
| **R-2** | Official sub-criterion names are not supplied. | Seed the **7 criteria only** (numbers, no invented titles). Sub-criteria are user-entered. See A-2 for a no-invention alternative. |
| **R-3** | `next build` may OOM on a small droplet, and could disturb co-located apps. | Measure with U-4. If tight: `NODE_OPTIONS=--max-old-space-size=1024`, or build in CI and deploy the artifact. Never build while another app is under load. |
| **R-4** | Adding the first PM2 app to a box whose PM2 state is unknown. | Every PM2 command is an approval gate. Only ever name `ppd_converter` explicitly. `pm2 save` deferred until approved. |
| **R-5** | Long migrations could exceed proxy timeouts. | `proxy_read_timeout 300s`, work runs in a background worker, UI polls/streams — the HTTP request never waits for a migration. |
| **R-6** | SQLite writer contention. | `instances: 1` + `fork` mode, WAL journal, single serial worker. |
| **R-7** | AI could still fabricate despite instructions. | Deterministic layer is authoritative on numbers, codes, clauses and dates; excerpts are sliced from stored real content, never AI-authored; unresolved `fail` items block approval in server-side code. |
| **R-8** | Google API quotas during a large scan. | Bounded page counts and depth (gd4_simulator caps at 5 pages / depth 6), serial processing, bounded retries. |
| **R-9** | Reference DOCX files (`OLD template.docx`, `NEw template.docx`) are **not present** in this environment. | Not needed for this plan. If they should inform the parser, please attach them. The live template remains a Google Docs URL regardless. |

---

## 22. Actions requiring approval

**Nothing below has been done. Nothing below will be done without an explicit yes.**

**A. Before any code**
1. **Approve this plan** (or redirect it).
2. **Seeding decision.** `gd4_simulator` already contains the official **7 criteria and 29 sub-criteria**
   (`GD4_CRITERIA`, `GD4_SUB_CRITERIA`) with real titles. Options: **(a)** seed criteria 1–7 only and enter
   sub-criteria by hand — the default, invents nothing; **(b)** import the official sub-criteria from
   `gd4_simulator` — also invents nothing, and saves considerable typing. Please pick one.
3. Answer **U-1 to U-4** (four read-only commands, above).
4. Approve the **Phase-0 spike** for O-1 — it touches a real Google account and a throwaway folder.

**B. During build** — each is a separate stop-and-ask
5. Create `/var/www/ppd_converter`
6. Install any dependency
7. Create the initial database migration
8. Replace any existing file
9. Use real Google credentials
10. Use a real OpenAI key
11. Access the live Google Drive folder
12. Create a real target Google Doc

**C. Deployment** — each is a separate stop-and-ask
13. Edit Nginx (after backup + `nginx -t` + showing the exact block)
14. Reload Nginx
15. Start the PM2 process
16. Run `pm2 save`
17. Deploy to production
18. Change DNS or firewall rules

**Standing commitments for the whole project:** source Google Docs are never modified · no section
mapping is invented · no UCC role, approval, system, record, frequency or evidence is invented · document
codes, clause numbering, facts and dates are never changed · AI output is never auto-approved · nothing is
approved with unresolved failures · no target document is overwritten silently · no secret reaches source
control or a log · no other application is touched.

---

## STOP — awaiting approval

No further work will be done on this until the plan is approved and items **A-1 to A-4** are answered.
