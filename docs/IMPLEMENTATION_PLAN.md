# PPD Converter — Implementation Plan (for approval)

**Status:** PLAN ONLY — revision 2. No code written, no dependencies installed, no server changed,
`/var/www/ppd_converter` not created.
**Date:** 2026-08-05
**Repo:** `f3nd1/ppd_converter`, branch `claude/ppd-converter-web-app-s66359`

> **Revision 2 changed the architecture.** Server inspection results came back showing 1.9 GiB total RAM
> with four PM2 apps already running. **Next.js is withdrawn; the recommendation is now Express + a Vite
> React SPA in one process.** Full reasoning in §1a. Also added: a hard project-isolation requirement
> (§1b), deferred Google spike, and the sub-criterion seeding question left open.

---

## Phase 1 — Inspection report

### ⚠️ What could and could not be inspected from here

This session runs in an **ephemeral Anthropic cloud container**, not on the DigitalOcean droplet.
`/var/www`, `pm2`, `nginx` and `certbot` do not exist here. Items reconstructed from the `gd4_simulator`
repository are marked **(inferred)**. Items confirmed by the operator running commands on the real
droplet are marked **(confirmed on server)**.

### ✅ 1. `/var/www` — (inferred)
Convention from `gd4_simulator/CLAUDE.md:34`, verbatim:
> Live at `https://apps.unitedceres.edu.sg/gd4_simulator/` — nginx `alias` to `/var/www/gd4_simulator/dist/` on the user's server, a subpath deployment.

One git checkout per app under `/var/www/<app_name>`.

### ✅ 2. `/var/www/gd4_simulator` — inspected via source clone (`d36b332`)
Vite 8 + React 19 + TypeScript + Zustand, built to a static `dist/`. `base: './'` and HashRouter so one
build works at any subpath. Its only backend component is a Supabase Edge Function. 1118 tests / 95 files,
Vitest, colocated in `__tests__/`. **Not a Node server, no PM2.**

### ✅ 3. Existing PM2 applications — **(confirmed on server)**
Four apps, all online, all low memory:

| Process | RSS |
|---|---|
| `admission-screening` | 42–98 MB |
| `ai_impact_builder` | 42–98 MB |
| `social_media_os` | 42–98 MB |
| `ucc_qa_hub` | 42–98 MB |
| **Total (midpoint estimate)** | **≈280 MB** |

**None of these will be touched.** `ppd_converter` would be the fifth process.

### ✅ 4. Existing PM2 conventions — no ecosystem file is visible in any inspected repo
gd4_simulator contains none. The four running apps' configs were not inspected. §14 therefore proposes a
conservative self-contained ecosystem file that names only `ppd_converter`.

### ✅ 5. Existing Nginx configuration — **(confirmed on server)**
- `nginx -T` passes; syntax OK.
- `server_name` is `apps.unitedceres.edu.sg` (also reachable via `188.166.254.54.nip.io`).
- TLS by Certbot at `/etc/letsencrypt/live/apps.unitedceres.edu.sg/`.
- Independently corroborated by the CORS allowlist in `gd4_simulator/supabase/functions/drive-oauth/index.ts:47-54`.
- ⚠️ **Still unknown: which file on disk holds that server block.** Needed before any edit (§21 U-3).

### ✅ 6. Routing patterns — subpath deployment on one shared host
gd4_simulator uses `alias` → static `dist/`, hash routing to survive the subpath. PPD Converter needs a
live process, so it uses `proxy_pass` instead. This is the one structural departure and is isolated to a
single new `location` block.

### ✅ 7. Node.js and package-manager versions
Container: Node v22.22.2, npm 10.9.7. gd4_simulator pins `.nvmrc` = 22, `engines.node: "^20.19.0 || >=22.12.0"`,
uses **npm** with a committed `package-lock.json`. Matches the stated server Node 22.x.

### ✅ 8. Port 4020 — **(confirmed on server)** free
`sudo ss -ltnp | grep 4020` returned nothing. Nothing is listening.

### ✅ 9. Directory and naming conventions
`lower_snake_case` for server-deployed dirs. Source layout `src/{pages,components/ui,components/layout,lib,data,store,types}`,
tests colocated in `__tests__/`, long-form docs in `docs/`.

### ✅ 10. Environment-variable patterns — names only, no values read
`VITE_`-prefixed build-time vars in a committed `.env.example` with **empty values**; `.gitignore` excludes
`*.local`. Server-side secrets (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) live only in the Edge Function.
**No OpenAI env var exists today** — that key is pasted into a Settings page. PPD Converter deliberately
breaks from this: the brief requires the key server-side only, so it moves to `.env`.

### ✅ 11. Memory and disk — **(confirmed on server)**
```
total 1.9Gi · used 1.2Gi · free 95Mi · buff/cache 821Mi
swap  2.0Gi · used 168Mi
```
**This is the constraint that drove the architecture change — see §1a.**

### ✅ 12. Existing logging approach
No server-side log files. gd4_simulator logs **in-app, to the user**: AI Debug Log, Run Log, Human Decision
Log, Change Log. User-visible queryable audit trails, not files. Maps directly onto this brief's Activity Log.

### ✅ 13. Deployment and update patterns
Verbatim, CLAUDE.md:35:
> To update, the user runs on the server: `cd /var/www/gd4_simulator && git pull && npm run build`.

Git checkout on the server, pull, build in place. No CI, no Docker, no artifact registry.

### ✅ Bonus: "PPD" is already defined in your own code
`gd4_simulator/src/types/index.ts:849` — **PPD = Policy & Procedure Document.** gd4_simulator already
reviews PPDs per sub-criterion. It also already holds the official **7 criteria and 29 sub-criteria**.
**This is only an observation — see §22 A-2, still open, no default taken.**

### ✅ Bonus: the operator is non-technical
CLAUDE.md:194 — *"give a numbered, plain-English, click-by-click checklist with an explicit '✅ Pass if:'
per step."* Shapes §18 and the documentation deliverable.

---

## 1a. Memory assessment and the architecture reversal

### First, a correction to the reading

`free -h` reports **95 MiB free**, but "free" is not "available". The 821 MiB in `buff/cache` is largely
reclaimable page cache. Real **available** memory is roughly **600–900 MiB**. Less alarming than 95 MiB
suggests — **but the conclusion below is the same either way**, so this correction does not rescue Next.js.

Two facts do matter and are not softened by the correction: **swap has already been touched (168 MiB
used)**, which means this box has been under memory pressure at least once; and headroom must be left for
the four existing apps to grow, not consumed by a fifth.

> ### ⚠️ Revision 3 — the estimates below were partly wrong. Measured reality:
>
> | | Estimated | **Measured** |
> |---|---|---|
> | Build peak RSS | 300–500 MB | **291 MB** ✅ |
> | Full-app idle RSS | 70–110 MB | **~177 MB** ❌ |
> | Under load (200 requests) | — | **181 MB, stable** |
>
> **The build figure held; the runtime figure did not.** The cause is Prisma:
> **~80 MB** of the total (36 MB to import, ~43 MB more once connected). Every other
> dependency combined is ~35 MB, and `better-sqlite3` alone is 1.4 MB.
>
> The architecture decision still holds — 181 MB is comparable to two of the four
> existing apps, and Next.js would have added its own runtime on top of this same
> Prisma cost. But the PM2 ceiling was set from the estimate: `max_memory_restart`
> was raised from 250 MB (which would have restart-looped during a migration) to
> **400 MB**, now a genuine runaway backstop at 45% headroom.
>
> **Option, not taken:** dropping Prisma for `better-sqlite3` directly would save
> ~80 MB. Prisma was named in the approved stack, so this is flagged rather than
> decided. Re-check any time with `npm run measure` and `/api/health`.

### Runtime footprint comparison — the question you asked

Estimates, to be **measured** at Phase 1 rather than trusted:

| | Idle RSS | Under load | vs. the four existing apps combined (≈280 MB) |
|---|---|---|---|
| Each existing app | 42–98 MB | — | baseline |
| **Next.js 16 standalone** | ~150–200 MB | ~250–350 MB | **0.9–1.25× all four combined** |
| **Express + static SPA** | ~70–110 MB | ~120–180 MB | **in line with one existing app** |

The Express option lands PPD Converter as an ordinary fifth app. Next.js would make it the largest process
on the box by a wide margin.

### But runtime is not what kills it — the build is

This is the decisive point.

| Build | Peak memory | Fits in ~600–900 MiB available? |
|---|---|---|
| `next build` | **~1–2 GB** | ❌ **No.** Would thrash 2 GiB of swap for many minutes. |
| `vite build` + `esbuild` | **~300–500 MB** | ✅ **Yes — and proven on this exact box.** |

Your deployment convention is **build on the server** (`git pull && npm run build`). Running `next build`
under this memory ceiling risks invoking the Linux **OOM killer**, and the OOM killer chooses its victim by
score — **it could kill `ucc_qa_hub` or `social_media_os` rather than the build.** That directly violates
your "do not touch any of these" instruction, in the worst possible way: silently, at deploy time.

Meanwhile `vite build` is not a guess — **gd4_simulator builds on this box today** with that exact command.
We have working proof for one path and good reason to expect failure on the other.

### Recommendation: withdraw Next.js, use Express + Vite React SPA

Your brief permitted exactly this: *"Next.js full-stack application, **unless inspection shows that the
existing server pattern strongly favours React and Express**."* Inspection now shows something stronger
than a stylistic preference — **the box can build Vite and probably cannot build Next.js safely.**

Nothing in the requirements needs Next.js. Everything that forces a server — server-only OpenAI key,
encrypted refresh tokens, SQLite privacy, Google Docs writes, CSP, CSRF, rate limiting, sessions — is
satisfied by a plain Node server. React SSR was never a requirement.

**This is still one application, one process, one port, one PM2 entry, one nginx location.** It is not a
split into frontend and backend services: a single Express process serves both the built SPA and the API.

### Three further memory decisions that follow

1. **Drop the `googleapis` package.** It is notoriously heavy (it loads a full API index). Use
   `google-auth-library` for the OAuth token exchange, refresh and ID-token verification — the security-
   sensitive parts I will not hand-roll — and plain Node 22 `fetch` for Drive v3 and Docs v1 REST calls.
   gd4_simulator already calls Drive this way successfully. **Largest single memory saving available.**
2. **Drop SSE for stage updates; poll instead.** One user, one job at a time. Polling every 2 s removes the
   long-lived connection, and removes `proxy_buffering off` and the extended `proxy_read_timeout` from the
   nginx block — a smaller change to your shared nginx.
3. **Type-check off the server.** `tsc --noEmit` runs in dev and tests. The server build is `vite build`
   (client) + `esbuild` (server bundle) only — both fast and low-memory.

### Safety nets on the box

- PM2 `max_memory_restart: '250M'` — if PPD Converter ever leaks, PM2 restarts **it** before the OOM killer
  gets a chance to choose one of your four apps instead.
- `--max-old-space-size=192` — caps V8's heap so it garbage-collects rather than growing into other apps' space.
- Deploy guidance: run the build when the box is quiet; a documented off-server build fallback exists if it
  ever proves tight.

---

## 1b. Project isolation (new hard requirement)

**PPD Converter shares nothing with gd4_simulator or any other app on this server, at build time or runtime.**

| Boundary | How it is kept separate |
|---|---|
| Source | Own repository, own `/var/www/ppd_converter` checkout. **Zero imports from any other project.** |
| Dependencies | Own `node_modules`, own `package-lock.json`. No workspace, no monorepo, no linked packages. |
| Config | Own `.env`, own `ecosystem.config.cjs`. No shared or parent config file. |
| Database | Own SQLite file under `data/`. No shared database, no shared Supabase project. |
| Process | Own PM2 process `ppd_converter`, own port 4020. No shared process, no cluster. |
| Nginx | One **added** `location` block. No existing file replaced, no shared `root`/`alias`. |
| Logs | Own `logs/` directory inside the project. |
| Runtime calls | **Never calls into another app's HTTP API or reads another app's files.** |

**Enforcement, not just intent.** Everything I took from gd4_simulator is *convention* — naming, folder
layout, colocated tests, error-handling style. Not one line of its code is imported. To make that
permanent rather than a promise, a unit test walks every source file and fails the build if any import
specifier resolves outside the project root, or if any path segment names another app. Roughly 15 lines,
runs in CI and in `npm test`, and catches the mistake on the day someone makes it rather than at 3 a.m.

A future change to any other app cannot break PPD Converter, and vice versa.

---

## 2. Recommended application architecture

**One Node process: Express 5 serving a Vite-built React SPA plus a JSON API, under PM2, behind existing Nginx.**

```
Browser
  │  https://apps.unitedceres.edu.sg/ppd_converter/
  ▼
Nginx (existing, one added location)  ──proxy_pass──►  127.0.0.1:4020
                                                            │
                                    Express 5  (PM2: ppd_converter, fork, 1 instance)
                                                            │
        ┌────────────────┬────────────────┬─────────────────┼──────────────┐
        ▼                ▼                ▼                 ▼              ▼
  static SPA        JSON API        Migration worker    Prisma 7      Drive v3 / Docs v1
  (vite build)      (/api/*)        (in-process,        + SQLite      (fetch + google-auth-library)
                                     serial)                          OpenAI SDK
```

**Client:** React 19 + React Router (BrowserRouter, `basename="/ppd_converter"`). Real URLs so a reviewer
can deep-link to a document or job; the cost is a three-line catch-all in Express that returns `index.html`
for non-API paths. Vite builds it exactly as gd4_simulator does.

**Concurrency:** no queue service. `MigrationJob` rows in SQLite **are** the queue. A single in-process
worker claims one `queued` job at a time inside a transaction, drives it through the stages, and persists
after every stage. This satisfies *"Process only one document at a time by default"*, survives a PM2
restart (an interrupted job is left `queued`/`failed` and retried explicitly, never silently), and adds
zero services and zero memory beyond the one process.

---

## 3. Proposed project structure

```
/var/www/ppd_converter/
├─ .env                      # NOT committed
├─ .env.example              # committed, empty values (gd4_simulator convention)
├─ .gitignore                # .env, node_modules, dist, data/*.db*, logs/
├─ .nvmrc                    # 22
├─ ecosystem.config.cjs      # PM2: ppd_converter, 127.0.0.1:4020
├─ package.json  package-lock.json  tsconfig.json
├─ vite.config.ts            # client build → dist/client
├─ vitest.config.ts  playwright.config.ts
├─ prisma/{schema.prisma, migrations/}
├─ data/                     # SQLite, chmod 700 dir / 600 file
├─ logs/                     # PM2 logs, project-local
├─ docs/                     # IMPLEMENTATION_PLAN, SETUP, OPERATIONS, BACKUP_AND_ROLLBACK, NGINX
├─ server/
│   ├─ index.ts              # Express app, static + API + catch-all
│   ├─ middleware/{session,auth,csrf,rateLimit,headers,correlation}.ts
│   ├─ routes/               # one file per group in §5
│   └─ lib/
│       ├─ google/{oauth,drive,docs,urls}.ts
│       ├─ ai/{client,schemas,rewrite,validate}.ts
│       ├─ doc/{parse,model,generate,title}.ts
│       ├─ migration/{worker,stages,prechecks}.ts
│       ├─ validation/{deterministic,gate}.ts
│       ├─ report/{csv,json,html}.ts
│       ├─ {db,crypto,activity,env,logger}.ts
│       └─ **/__tests__/     # colocated (gd4_simulator convention)
├─ src/                      # React SPA
│   ├─ main.tsx  App.tsx  nav.ts
│   ├─ pages/{Dashboard,SourceDocuments,TemplateAndRules,Migration,Reports}.tsx
│   ├─ components/{layout,ui}/
│   └─ types/index.ts
└─ e2e/migration.spec.ts
```

`server/` and `src/` are separate build targets in **one** deployable process — not separate services.

---

## 4. Frontend page structure

Exactly **five** primary navigation areas. Sidebar driven by a single `src/nav.ts` (gd4_simulator's
`NavItem`/`NavGroup` pattern) so nav and pages cannot drift.

| # | Route | Page | Contents |
|---|---|---|---|
| 1 | `/` | **Dashboard** | Every counter in the brief, live from SQLite: total source documents, configured criteria and sub-criteria, not started / queued / processing / migrated / awaiting review / approved / failed, validation issue count, overall progress, active template, active AI instruction version, recent activity. **No hardcoded statistics anywhere.** |
| 2 | `/source-documents` | **Source Documents** | Seven expandable criterion sections. Each sub-criterion row shows `[Sub-criterion] [Old Google link] → [New Google link]` with the literal `→`. Add / Edit / Reorder / Deactivate. Per row: Validate links, Scan source, source document count, last scanned date, status, error detail. |
| 3 | `/template-and-rules` | **Template and AI Rules** | Three tabs — **Template** (Google Docs URL, Validate, Preview, Open in Google Docs, Save as active, version history), **AI Instructions** (editable, versioned, activate, restore), **Section Mapping** (mapping versions and rules, approval control). |
| 4 | `/migration` | **Migration and Validation** | Filterable document table with checkboxes; single / batch / retry; stage timeline; detailed change record; deterministic and AI validation results; warning resolution; approve / return for correction. |
| 5 | `/reports` | **Reports and Activity** | Migration report, document-level report, CSV / JSON / HTML export, append-only activity log. |

Empty states and error states are first-class on every page and are explicitly tested (§17).
UK English throughout — a de-facto convention across gd4_simulator, enforced by consistency.

---

## 5. Backend route structure

All under `/ppd_converter`. Every route except the two auth routes requires an authenticated session for
`felix@unitedceres.edu.sg`, enforced in middleware **and** re-checked in each handler (defence in depth —
never only in middleware).

**Auth** — `GET /api/auth/google/start` · `GET /api/auth/google/callback` · `POST /api/auth/signout`

**Criteria & sub-criteria** — `GET/POST /api/criteria` · `GET/PATCH/DELETE /api/sub-criteria/:id` ·
`POST /api/sub-criteria/reorder`

**Source mapping & scanning** — `POST /api/source-mappings/:id/validate-links` ·
`POST /api/source-mappings/:id/scan` · `GET /api/source-documents`

**Template** — `POST /api/template/validate` · `POST /api/template/activate` ·
`GET /api/template/versions` · `GET /api/template/:id/preview`

**AI instructions** — `GET/POST /api/ai-instructions` · `POST /api/ai-instructions/:id/activate` ·
`POST /api/ai-instructions/:id/restore`

**Mapping** — `GET/POST /api/mapping-versions` · `POST /api/mapping-versions/:id/approve` ·
`POST /api/mapping-versions/:id/activate` · `GET/POST/PATCH/DELETE /api/mapping-rules`

**Migration** — `POST /api/migration/queue` · `POST /api/migration/:jobId/retry` ·
`GET /api/migration/:jobId` · `GET /api/migration/status` (polled, 2 s) ·
`GET /api/migrated-documents/:id/changes`

**Validation & review** — `POST /api/validation/:migratedDocId/run` ·
`POST /api/validation-items/:id/resolve` · `POST /api/review/:migratedDocId/decision`

**Reports & activity** — `GET /api/reports/migration` · `GET /api/reports/document/:id` ·
`GET /api/reports/export?format=csv|json|html` · `GET /api/activity`

**Health** — `GET /api/health` (liveness + memory RSS, so the box can be monitored cheaply)

Rate limiting (in-process token bucket) on auth start, link validation, scan, template validation,
migration queue, and both AI routes.

---

## 6. SQLite data model

All 20 required entities. Timestamps stored **UTC ISO-8601**; Asia/Singapore is a display concern only,
rendered with `Intl.DateTimeFormat` (no date library). Prisma migrations from day one.

| Entity | Key fields (abridged) |
|---|---|
| **AppUser** | `id`, `email` (unique), `displayName`, `isAuthorised`, `lastLoginAt` |
| **OAuthCredential** | `id`, `appUserId`, `refreshTokenEnc` (AES-256-GCM), `iv`, `authTag`, `scopes`, `expiresAt`, `revokedAt` |
| **Criterion** | `id`, `number` (1–7, unique), `title`, `order` |
| **SubCriterion** | `id`, `criterionId`, `code`, `title`, `order`, `isActive`, `deactivatedAt` |
| **SourceMapping** | `id`, `subCriterionId`, `oldUrl`, `oldResourceId`, `oldResourceType`, `newUrl`, `newResourceId`, `newResourceType`, `lastValidatedAt`, `validationStatus`, `errorDetail`, `lastScannedAt`, `sourceDocCount` |
| **SourceDocument** | `id`, `sourceMappingId`, `googleFileId`, `title`, `documentCode`, `mimeType`, `modifiedTime`, `contentHash`, `isDuplicateOf`, `migrationStatus` |
| **TemplateVersion** | `id`, `name`, `googleDocId`, `url`, `versionLabel`, `validationResult` (JSON), `configSnapshot` (JSON), `isActive`, `activatedAt` |
| **AIInstructionVersion** | `id`, `versionLabel`, `body`, `isActive`, `activatedAt`, `createdAt`, `restoredFromId` |
| **MappingVersion** | `id`, `versionLabel`, `isActive`, `approvalStatus`, `approvedBy`, `approvedAt`, `notes` |
| **MappingRule** | `id`, `mappingVersionId`, `oldSectionName`, `newTargetSection`, `transformationRule`, `priority`, `notes`, `isActive` |
| **MigrationJob** | `id`, `sourceDocumentId`, `stage`, `attempt`, `queuedAt`, `startedAt`, `finishedAt`, `errorRef`, `correlationId`, `templateVersionId`, `aiInstructionVersionId`, `mappingVersionId` |
| **MigratedDocument** | `id`, `migrationJobId`, `sourceDocumentId`, `targetGoogleDocId`, `targetUrl`, `targetTitle`, `outputVersion` (`2.1`), `destinationFolderId`, `sourceModifiedTimeAtMigration`, `status` |
| **ContentBlock** | `id`, `sourceDocumentId`, `blockId` (stable), `type`, `text`, `textHash`, `styleName`, `listInfo`, `numbering`, `sourceLocation`, `order`, `parentBlockId` |
| **ContentBlockMapping** | `id`, `contentBlockId`, `targetSection`, `mappingRuleId`, `status`, `confidence` |
| **ChangeRecord** | `id`, `migratedDocumentId`, `changeNumber`, `changeType`, `sourceSection`, `targetSection`, `sourceBlockId`, `originalExcerpt`, `revisedExcerpt`, `reason`, `confidence`, `validationResult`, `reviewStatus` |
| **ValidationRun** | `id`, `migratedDocumentId`, `layer` (`deterministic`/`ai`), `startedAt`, `finishedAt`, `summary`, `providerRequestId`, `usageJson`, `model` |
| **ValidationItem** | `id`, `validationRunId`, `category`, `checkPerformed`, `result` (`pass`/`warning`/`fail`), `details`, `severity`, `sourceReference`, `targetReference`, `humanReviewRequired`, `resolutionStatus`, `resolutionNote`, `resolvedAt` |
| **ReviewDecision** | `id`, `migratedDocumentId`, `reviewerEmail`, `decision`, `comment`, `decidedAt`, plus frozen `aiInstructionVersionId`, `mappingVersionId`, `templateVersionId`, `sourceModifiedTime`, `targetGoogleDocId`, `validationSummary` |
| **ActivityLog** | `id`, `occurredAtUtc`, `action`, `entityType`, `entityId`, `result`, `summary`, `errorRef`, `correlationId` — **append-only** |
| **ExportRecord** | `id`, `format`, `scope`, `filters`, `exportedAt`, `rowCount`, `correlationId` |

**Storage discipline.** Full source documents are **not** stored. `ContentBlock` keeps structure, a text
hash, and the text needed for genuine excerpts — because *"Do not fabricate excerpts. Use actual source and
target content only"* makes storing real excerpts mandatory. Excerpts are length-capped and never written
to ordinary logs.

**Append-only Activity Log** enforced by SQLite triggers that `RAISE(ABORT)` on `UPDATE` and `DELETE`.
Application code has no delete path.

**SQLite settings:** WAL journal, `synchronous = NORMAL`, single writer (guaranteed by PM2 `fork` +
`instances: 1`).

---

## 7. Google OAuth and Google API design

**Flow:** OAuth 2.0 Authorization Code **with PKCE**, server-side, redirect-based.
Redirect URI: `https://apps.unitedceres.edu.sg/ppd_converter/api/auth/google/callback`.
`access_type=offline`, `prompt=consent` (gd4_simulator's own comment records that forcing consent is what
reliably yields a refresh token).

**Account restriction.** The callback reads the **verified** email from the ID token (verified via
`google-auth-library`, not parsed from an unsigned payload) and compares it case-insensitively against
`ALLOWED_GOOGLE_EMAIL` in `.env`. Any other account: no session, no token stored, an `auth_denied` activity
entry. Re-checked in middleware on every subsequent request.

**Proposed minimum scopes**

| Scope | Why |
|---|---|
| `openid`, `email` | Identify the account for the allowlist |
| `https://www.googleapis.com/auth/drive.readonly` | List selected source folders; read source documents |
| `https://www.googleapis.com/auth/drive.file` | Create the template copy in the REVISED folder |
| `https://www.googleapis.com/auth/documents` | Read source structure and write target content |

⚠️ **O-1 remains open and is now explicitly deferred.** `drive.file` grants access only to files the app
created or the user explicitly opened; copying the template *into a user-created* REVISED folder may
require the broader `https://www.googleapis.com/auth/drive`. **The spike will not run until you hand over
credentials.** Until then the scope list is a single exported constant, so resolving O-1 later changes one
line and no logic.

**Token storage.** Refresh token encrypted with **AES-256-GCM** (`ENCRYPTION_KEY` from `.env`, 32 bytes
base64), stored with its IV and auth tag. Access tokens are **in memory only, never persisted** — the same
rule gd4_simulator applies. Tokens, secrets and keys are never logged; the logger carries a redaction list.

**APIs — via `fetch`, not the `googleapis` package** (see §1a):
- Drive v3 `files.list` (`'<id>' in parents and trashed = false`, `supportsAllDrives=true`), `files.get`, `files.copy`
- Docs v1 `documents.get` (structured read) and `documents.batchUpdate` (write)
- Type detection by MIME — `application/vnd.google-apps.folder` vs `...document`. **Never by URL shape
  alone:** the URL yields a candidate ID, then the API confirms the type.

**URL parsing** (`server/lib/google/urls.ts`, pure, heavily unit-tested): `/folders/<id>`,
`/document/d/<id>`, `/file/d/<id>`, `?id=<id>`. Anything else rejected with a specific message.
Written fresh — gd4_simulator's `parseFolderId` handles folders only, and per §1b nothing is imported.

**Source safety.** No `batchUpdate` call anywhere can target a source document: a guard asserts the target
ID equals `MigratedDocument.targetGoogleDocId`, backed by a unit test.

---

## 8. OpenAI integration design

Official `openai` SDK — the brief requires storing **provider request IDs** and usage metadata, and the SDK
exposes `_request_id` and handles timeouts and bounded retries natively. It is light at runtime (~5 MB), so
it survives the memory review.

```env
OPENAI_API_KEY=
OPENAI_MODEL=
OPENAI_REQUEST_TIMEOUT_SECONDS=
OPENAI_MAX_RETRIES=
```

- **No model name is hardcoded.** `OPENAI_MODEL` is read at startup and validated against a
  GPT-5-family-or-later pattern; the process refuses to start on a non-conforming value with a clear
  message. (For reference only: gd4_simulator defaults to `gpt-5-mini`.)
- Key is server-side only — never in a response body, never in the client bundle, never logged.
- **Structured outputs** with a JSON schema, re-validated with **Zod** on receipt. Output failing the schema
  is **rejected, not repaired** — bounded retries, then the job fails honestly with an error reference.
- **Two separate calls, two separate prompts:** the rewrite engine and the validator never share either.
- Carried forward from gd4_simulator as convention (not code): **schema key order matters** — reasoning and
  rationale fields are declared *before* the verdict field, because constrained decoding emits fields in
  schema order and reversing it measurably degrades judgement quality.
- Stored per call: model, `providerRequestId`, prompt/completion/total tokens. **Never** headers, keys, or
  raw source content.

---

## 9. Document parsing and internal JSON model

**A raw Google Doc is never sent to the AI.** Pipeline exactly as specified:

```
Google Docs source → structured parser → internal JSON model → mapping engine
   → AI rewrite engine → validation engine → diff engine → Google Docs generator
```

`documents.get` returns Google's structural JSON; the parser normalises it into:

```ts
type DocumentModel = {
  metadata: { title, documentCode, googleFileId, modifiedTime, revisionId };
  blocks: ContentBlock[];
  headers: HeaderFooter[]; footers: HeaderFooter[];
  footnotes: Footnote[]; namedStyles: NamedStyle[];
  pageNumbering: PageNumberMeta;
};

type ContentBlock = {
  blockId: string;
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

**Stable block IDs.** `blockId = <docId-short>-<ordinal>-<sha256(normalisedText).slice(0,8)>`.
Deterministic, stable across re-scans while text is unchanged, and a changed hash is a *signal* (source
drifted) rather than a silent renumber. Every source block gets one — this is what makes "every source
content block is accounted for" a checkable claim rather than an assertion.

**Documents are parsed one at a time and the model is not held in memory between jobs** — relevant on a
1.9 GiB box. Blocks are persisted to SQLite as they are parsed; the worker holds one document's model.

**Known limits, stated rather than papered over:** the Docs API exposes footnotes but manipulating them is
limited; images are referenced by URI and re-referenced, not re-uploaded; page numbers live in the
template's header/footer and are preserved by copying, not regenerated.

---

## 10. Migration workflow

**Pre-migration checks — all must pass, no override:** source accessible · destination folder accessible ·
active template valid · active AI instruction exists · **approved active mapping exists** · required
metadata present · target does not already exist · source `modifiedTime` unchanged since scan.

**Persisted stages** (exactly the thirteen specified): `not_started` → `queued` → `reading_source` →
`parsing_structure` → `mapping_content` → `generating_content` → `copying_template` → `writing_target` →
`validating` → `awaiting_review` → `approved` → `exported`, plus `failed`. Every transition writes the job
row *and* an ActivityLog entry, so a crash is always diagnosable.

**Generation, in order:**
1. `files.copy` the active template
2. Place the copy in the configured REVISED folder
3. Title `REVISED - [Document Code] [Document Title] (v2.1)` — one pure, unit-tested function
4. Populate configured target sections via `batchUpdate`
5. Apply template named styles
6. Header, footer and page numbering come from the template copy, untouched
7. Record target document ID and URL
8. Source never written to (guarded, §7)
9. An existing revised document is **never** overwritten silently — the pre-check fails and the UI requires explicit confirmation
10. Output stays fully editable in Google Docs

**Duplicate-target prevention.** Unique index on `(destinationFolderId, targetTitle)` plus a live Drive
check immediately before copy. Retry is **idempotent** — a job that already produced a target reuses it
rather than creating a second.

---

## 11. Validation workflow

**Layer 1 — deterministic, pure code, no AI.** Modelled on gd4_simulator's
`docs/consistency-invariants.md` approach (read-only, rule-based, pass/fail plus a log) — pattern only, no
shared code. Checks: every source section has a mapping status · every content block accounted for
(block-ID set difference) · every reference and hyperlink accounted for · all required target sections
present · correct target folder · active template used · source unchanged (`modifiedTime` + hash) · no
unintended duplicate target · **document code unchanged** · **clause numbers unchanged** · dates and
factual values unchanged unless explicitly approved · required metadata stored.

Number, date and code preservation is a set comparison over tokens extracted from source and target by
pure regex functions — deterministic and independently unit-tested. This is what makes "facts are
preserved" enforceable rather than aspirational.

**Layer 2 — AI-assisted, separate call, separate prompt.** Compares source and migrated content for
meaning preservation, material omission, unsupported additions, contradictions, ambiguity, over-aggressive
shortening, and changes to roles, approvals, frequencies, evidence, records, numbering, facts and control
intent. Returns JSON validated against a Zod schema. **Never authoritative on its own** — its output
becomes `ValidationItem` rows for a human, matching gd4_simulator's rule *"The AI recommends; a human commits."*

**Approval gating.** `canApprove()` is one pure function: **false** while any `fail` item is unresolved;
warnings require explicit acknowledgement. Unit-tested and called **server-side** on the approve route —
the UI disabling a button is a convenience, never the control.

---

## 12. Change-log design

One `ChangeRecord` per change, numbered per document, storing every field the brief lists. Change types are
a closed enum, exactly the fourteen specified (`section_moved`, `section_merged`, `text_rewritten`,
`text_shortened`, `procedure_converted_to_table`, `responsibility_moved_to_praci`,
`monitoring_moved_to_cse`, `reference_retained`, `reference_missing`, `duplicate_consolidated`,
`formatting_applied`, `ambiguous_content`, `content_unchanged`, `content_unmapped`).

**Excerpts are never fabricated.** `originalExcerpt` is sliced from the stored `ContentBlock.text` by block
ID; `revisedExcerpt` is sliced from the generated target content. Neither is ever authored by the AI. A
unit test asserts every stored excerpt is a substring of its real source or target content — the single
strongest guard against invention in the system.

---

## 13. Reporting design

- **Migration report** — totals, status counts, per-criterion and per-sub-criterion summaries,
  completeness %, warning and failure counts, approved and failed counts, start and completion times.
- **Document-level report** — source and target titles and links, criterion, sub-criterion, template /
  AI-instruction / mapping versions, timestamps, full source→target mapping, all changes, all validation
  results, warning resolutions, approval record, final status.
- **Exports** — **CSV** summary, **JSON** full record, **printable HTML** (server-rendered, `@media print`).
  **PDF is deliberately not implemented:** every reliable option means Chromium or a heavy native
  dependency, which on a 1.9 GiB box with four other apps is exactly the wrong trade. The printable HTML
  page prints to PDF from the browser in two clicks. A true server-side PDF would be a separate approval item.
- Exports stream to the response rather than building large strings in memory.
- Every export writes an `ExportRecord` and an `ActivityLog` entry.

**Activity log.** Every action in the brief's list, with UTC timestamp, Asia/Singapore display timestamp
(rendered, not stored twice), action, entity type, entity ID, result, summary and error reference.
Append-only, enforced by database trigger (§6).

---

## 14. PM2 deployment design

`ecosystem.config.cjs` — committed, self-contained, naming only `ppd_converter`:

```js
module.exports = {
  apps: [{
    name: 'ppd_converter',
    cwd: '/var/www/ppd_converter',
    script: 'dist/server/index.js',
    instances: 1,
    exec_mode: 'fork',
    node_args: '--max-old-space-size=192',
    env: { NODE_ENV: 'production', HOST: '127.0.0.1', PORT: 4020 },
    max_memory_restart: '250M',
    error_file: '/var/www/ppd_converter/logs/pm2-error.log',
    out_file:   '/var/www/ppd_converter/logs/pm2-out.log',
    time: true,
  }],
};
```

- `instances: 1` + `fork` is **required**, not a default: cluster mode would run several writers against one
  SQLite file and several migration workers against one queue.
- `max_memory_restart: '250M'` and `--max-old-space-size=192` are the box-safety nets from §1a — if this app
  misbehaves, PM2 restarts **it**, rather than the OOM killer choosing one of your four apps.
- `HOST=127.0.0.1` binds to loopback; port 4020 is never publicly reachable.
- Logs are project-local, so nothing is shared (§1b).
- Secrets stay in `.env`, not in this file.
- Commands used: only `pm2 start ecosystem.config.cjs`, `pm2 reload ppd_converter`,
  `pm2 logs ppd_converter`, `pm2 describe ppd_converter`. **Never** `pm2 restart all`,
  **never** `pm2 delete all`. `pm2 save` only after testing and explicit approval.

**Update procedure** (follows your existing convention, plus two steps):
```
cd /var/www/ppd_converter && git pull && npm ci && npx prisma migrate deploy && npm run build && pm2 reload ppd_converter
```

---

## 15. Nginx routing proposal

**Nothing is edited without the five-step gate below.** The block is *added* to the existing
`apps.unitedceres.edu.sg` server block, alongside the existing `/gd4_simulator` alias. No existing file is
replaced, no existing block modified.

Simpler than revision 1 — dropping SSE for polling removed the buffering and extended-timeout directives:

```nginx
# --- PPD Converter (added <date>) ---
location /ppd_converter/ {
    proxy_pass       http://127.0.0.1:4020;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 2m;
}
location = /ppd_converter { return 301 /ppd_converter/; }
```

`proxy_pass` has **no trailing path**, so the `/ppd_converter` prefix passes through to Express.

**Mandatory sequence:**
1. Back up: `sudo cp <file> <file>.bak.$(date +%F-%H%M)`
2. Show you the exact diff
3. `sudo nginx -t`
4. **Stop for your approval**
5. `sudo systemctl reload nginx` — reload, never restart, and only after `nginx -t` passes

⚠️ Still needed: **which file** holds the server block (§21 U-3). `nginx -T` passing does not tell me the path.

---

## 16. Security controls

| Control | Implementation |
|---|---|
| Account restriction | Verified ID-token email against an allowlist, in the OAuth callback **and** middleware **and** each handler |
| Session | `iron-session` `sealData`/`unsealData` (framework-agnostic) in a cookie: `httpOnly`, `secure`, `sameSite: 'lax'`, `path: '/ppd_converter'`. No session table |
| CSRF | `sameSite=lax` + Origin/Referer check on every mutating handler; signed `state` on the OAuth round-trip |
| CSP | `default-src 'self'`, no third-party scripts, `frame-ancestors 'none'` |
| Secure headers | `helmet` — HSTS, `nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY` |
| Input validation | Zod at every route boundary — body, query and params |
| Google URL validation | Dedicated parser; unsupported URLs, wrong resource types and inaccessible resources rejected with distinct messages |
| Rate limiting | In-process token bucket on auth, link validation, scan, template validation, queue, and both AI routes |
| Token encryption | AES-256-GCM, `ENCRYPTION_KEY` from `.env`, IV + auth tag per record |
| Secrets | `.env` only; in `.gitignore`; `.env.example` committed with empty values |
| No secrets in logs | Central logger with a redaction list; unit-tested |
| No source content in logs | Ordinary logs carry IDs and hashes only, never document text |
| SQLite not public | `data/` outside any served path, dir `700`, file `600`; nginx proxies only to the app |
| File permissions | Project owned by the app account; `.env` `600` |
| Correlation IDs | One per request and per job, on every log line and in every user-facing error |

---

## 17. Testing strategy

**Vitest** (unit/integration) + **Playwright** (one end-to-end workflow). Tests colocated in `__tests__/`.
**No test ever touches the live Google Drive, a real OpenAI key, or a real target document** — both are
mocked at the client boundary.

**Unit tests** — the brief's full list: Google URL parsing · folder validation · document validation ·
resource-ID extraction · account restriction · template validation · content-block parsing ·
mapping-version requirement · structured OpenAI response validation · **invalid AI output rejection** ·
number preservation · fact preservation · completeness · duplicate-target prevention · approval blocking ·
retry idempotency · activity logging.

Plus, from the invariants above: output-title formatting · excerpt-is-a-real-substring · log redaction ·
source-document-never-written guard · **project-isolation guard (§1b)**.

**Frontend tests** — five primary pages · seven criteria · expand and collapse · add and edit
sub-criterion · the literal `[old] → [new]` arrow visible · Google Docs template URL field · migration
disabled without an approved mapping · migration status · detailed changes · validation results ·
approval blocking · report exports · error states · empty states.

**End-to-end (Playwright, fully mocked)** — the eighteen specified steps in order, from sign-in through
configuring Criterion 1 / sub-criterion 1.1, validating links, scanning, adding a template URL, activating
AI instructions, **confirming migration is blocked with no approved mapping**, approving a mapping,
queueing and completing a mocked migration, displaying changes and both validation layers, resolving a
warning, approving, exporting, and confirming every significant action appears in the activity log.

**Definition of done per change** (gd4_simulator's rule, adopted as convention): `tsc --noEmit` clean ·
all tests pass · lint clean · build clean · new pure logic has a colocated unit test.

---

## 18. Implementation phases

Reordered from revision 1: the Google spike moved from Phase 0 to Phase 3a and is **gated on you handing
over credentials**. Nothing before it needs Google access.

| Phase | Deliverable | Gate |
|---|---|---|
| **1. Skeleton** | Express + Vite + TS, base path, five page shells, nav, `/api/health`. **Measure real RSS and build peak on the droplet and report back.** | Needs approval to install deps |
| **2. Data layer** | Prisma schema, all 20 entities, first migration, append-only trigger, isolation guard test | Needs approval for the initial migration |
| **3. Auth** | Google OAuth, PKCE, allowlist, encrypted refresh token, session, middleware — built against mocks | |
| **3a. Google spike** | Resolve O-1 (`drive.file` vs `drive` for `files.copy`) against a throwaway folder | ⏸ **Blocked until you hand over credentials** |
| **4. Source Documents** | Criteria/sub-criteria CRUD, reorder, deactivate; URL and link validation; folder scan; duplicate detection; the `→` row | |
| **5. Template & AI Rules** | Template config/validate/preview/activate/history; AI instruction versioning; mapping versions and rules with approval | |
| **6. Parser & model** | Docs API structured read, internal JSON model, stable block IDs | |
| **7. Migration engine** | Pre-checks, worker, thirteen stages, template copy, target generation, change records | Needs approval before any real target document is created |
| **8. Validation** | Deterministic layer, then separate AI layer, approval gating, warning resolution | |
| **9. Reports & activity** | Migration and document reports, CSV/JSON/HTML export, activity log UI | |
| **10. Tests** | Full unit and frontend suites, Playwright E2E, all mocked | |
| **11. Deployment** | `ecosystem.config.cjs`, nginx block, SETUP / OPERATIONS / BACKUP_AND_ROLLBACK docs | Needs approval for every server action |

**Phase 1 includes a real measurement checkpoint.** The RSS and build-peak figures in §1a are estimates.
Phase 1 produces measured numbers on your actual droplet, and I report them before going further. If the
measured footprint is worse than projected, we revisit before any more is built on top of it.

Documentation is written for a **non-technical operator**: numbered, plain-English, click-by-click, with an
explicit **"✅ Pass if:"** after each step.

---

## 19. Exact files to be created

**Nothing outside the git repository is created without approval.** The repo currently holds only `.git`
and `docs/`. No file is replaced.

*Root:* `package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`,
`playwright.config.ts`, `ecosystem.config.cjs`, `.env.example`, `.gitignore`, `.nvmrc`, `README.md`

*Prisma:* `prisma/schema.prisma`, `prisma/migrations/**`

*Docs:* `docs/IMPLEMENTATION_PLAN.md` (this file), `docs/SETUP.md`, `docs/OPERATIONS.md`,
`docs/BACKUP_AND_ROLLBACK.md`, `docs/NGINX.md`

*Server:* `server/index.ts`; `server/middleware/{session,auth,csrf,rateLimit,headers,correlation}.ts`;
one `server/routes/*.ts` per group in §5; `server/lib/google/{oauth,drive,docs,urls}.ts`;
`server/lib/ai/{client,schemas,rewrite,validate}.ts`; `server/lib/doc/{parse,model,generate,title}.ts`;
`server/lib/migration/{worker,stages,prechecks}.ts`; `server/lib/validation/{deterministic,gate}.ts`;
`server/lib/report/{csv,json,html}.ts`; `server/lib/{db,crypto,activity,env,logger}.ts`

*Client:* `src/{main,App}.tsx`, `src/nav.ts`, `src/types/index.ts`,
`src/pages/{Dashboard,SourceDocuments,TemplateAndRules,Migration,Reports}.tsx`,
`src/components/layout/{Sidebar,Header,Layout}.tsx`,
`src/components/ui/{Card,Pill,Bar,Table,EmptyState,ErrorState,ConfirmDialog}.tsx`

*Tests:* colocated `__tests__/` beside each `server/lib` module and each page; `e2e/migration.spec.ts`

---

## 20. Exact dependencies proposed

Versions verified by `npm view` (read-only; **nothing installed**). Pinned at install time.

**Runtime**

| Package | Version | Why |
|---|---|---|
| `express` | 5.x | HTTP server, static SPA, API — one process |
| `helmet` | 8.x | Security headers and CSP; correct on edge cases I would otherwise hand-roll |
| `iron-session` | 8.0.4 | Encrypted cookie session via `sealData`/`unsealData`; no session table |
| `@prisma/client` | 7.9.1 | ORM (brief-specified). Prisma 7's TypeScript client is materially lighter than 5/6 |
| `better-sqlite3` | 13.0.3 | SQLite driver |
| `google-auth-library` | 10.x | OAuth exchange, refresh, **ID-token verification**. Security boundary — not hand-rolled |
| `openai` | 7.4.0 | Official SDK; exposes request IDs and usage, bounded retries |
| `zod` | 4.4.3 | Schema validation (brief-specified) |
| `react`, `react-dom` | 19.2.8 | Client UI |
| `react-router-dom` | 7.x | Client routing with `basename` |

**Dev:** `vite` 8.x · `@vitejs/plugin-react` · `esbuild` · `typescript` 6.0.2 · `prisma` 7.9.1 ·
`vitest` 4.1.10 · `@playwright/test` 1.62.1 · `@types/{node,react,react-dom,express}` · `eslint`

**Deliberately not proposed:**
- **`next`** — withdrawn on memory grounds (§1a)
- **`googleapis`** — replaced by `google-auth-library` + `fetch`; the largest single memory saving
- **`next-auth`** — heavy for one fixed account, and we must own the encrypted refresh token anyway
- **any queue library** — the `MigrationJob` table is the queue
- **any PDF library** — printable HTML instead (§13)
- **any date library** — `Intl.DateTimeFormat` handles Asia/Singapore natively
- **any CSS framework** — plain CSS Modules

---

## 21. Risks and unresolved requirements

**Remaining blocking unknown**

| ID | Unknown | How to close it |
|---|---|---|
| **U-3** | Which file on disk holds the `apps.unitedceres.edu.sg` server block? | `sudo nginx -T \| grep -n "configuration file\|server_name apps.unitedceres"` — needed before any nginx edit |

*(U-1 PM2, U-2 port 4020, U-4 memory: all now answered.)*

**Open questions**

| ID | Question | Status |
|---|---|---|
| **O-1** | Does `drive.file` allow `files.copy` **into a user-created** REVISED folder, or is full `drive` needed? | ⏸ **Deferred at your instruction** until credentials are handed over. Scope list is one constant, so resolving it later changes one line. |
| **O-2** | How does the approved template mark target sections — placeholder tokens, named ranges, or headings? | Cannot be answered: **the template is still being finalised.** Template validation checks *configured* required elements, so the mechanism is data, not code. |
| **O-3** | Sub-criterion seeding: import the official 29 from gd4_simulator, or enter manually? | ⏸ **Left open at your instruction. No default taken.** Schema and UI support both; no seed of the 29 will be written. Criteria 1–7 are seeded by number only (`Criterion 1`…`Criterion 7`), which the brief mandates and which invents no names. |

**Risks**

| ID | Risk | Mitigation |
|---|---|---|
| **R-1** | Section mapping not yet supplied | Interface and schema built now; **no mapping invented**. Production migration hard-blocked server-side until an approved active mapping exists. |
| **R-2** | Official sub-criterion names not supplied | See O-3. Nothing invented either way. |
| **R-3** | ~~`next build` OOM~~ | **Resolved by withdrawing Next.js.** `vite build` + `esbuild` peaks ~300–500 MB and is proven on this box. |
| **R-4** | Memory pressure from a fifth process on a 1.9 GiB box | Est. 70–110 MB idle (§1a), `max_memory_restart: '250M'`, `--max-old-space-size=192`, no `googleapis`, one document parsed at a time, streamed exports. **Measured for real in Phase 1 and reported before proceeding.** |
| **R-5** | Deploy-time build competing with the four running apps | Build when the box is quiet; documented off-server build fallback if it proves tight. |
| **R-6** | Adding the fifth PM2 app | Every PM2 command is an approval gate; only `ppd_converter` ever named. `pm2 save` deferred. |
| **R-7** | SQLite writer contention | `instances: 1` + `fork`, WAL journal, single serial worker. |
| **R-8** | AI fabrication despite instructions | Deterministic layer authoritative on numbers, codes, clauses and dates; excerpts sliced from stored real content, never AI-authored; unresolved `fail` items block approval in server-side code. |
| **R-9** | Google API quotas during a large scan | Bounded page counts and depth, serial processing, bounded retries. |
| **R-10** | Accidental coupling to another app | Isolation rules §1b, enforced by a unit test that fails the build on any import escaping the project root. |
| **R-11** | Reference DOCX files not present in this environment | Not needed for this plan. Attach them if they should inform the parser. The live template remains a Google Docs URL regardless. |

---

## 22. Actions requiring approval

**Nothing below has been done. Nothing below will be done without an explicit yes.**

**A. Before any code**
1. **Approve this revised plan** — in particular the **Next.js → Express + Vite reversal** (§1a).
2. **O-3 sub-criterion seeding** — still open, no default taken. Answer whenever you like; it does not block Phases 1–3.
3. **U-3** — which nginx file holds the server block. Only needed before Phase 11.

**B. During build** — each a separate stop-and-ask
4. Create `/var/www/ppd_converter`
5. Install any dependency
6. Create the initial database migration
7. Replace any existing file
8. Use real Google credentials — ⏸ **you hold these; I will not ask until you offer**
9. Use a real OpenAI key
10. Access the live Google Drive folder
11. Create a real target Google Doc

**C. Deployment** — each a separate stop-and-ask
12. Edit Nginx (after backup + `nginx -t` + showing the exact block)
13. Reload Nginx
14. Start the PM2 process
15. Run `pm2 save`
16. Deploy to production
17. Change DNS or firewall rules

**Standing commitments for the whole project:** source Google Docs are never modified · no section mapping
is invented · no UCC role, approval, system, record, frequency or evidence is invented · document codes,
clause numbering, facts and dates are never changed · AI output is never auto-approved · nothing is
approved with unresolved failures · no target document is overwritten silently · no secret reaches source
control or a log · **no file, module or script is shared with or imported from any other application** ·
the four existing PM2 apps are never touched.

---

## STOP — awaiting approval

No files will be created and nothing installed until this revision is approved.
