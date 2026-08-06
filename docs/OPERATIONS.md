# PPD Converter — Day-to-day operation

Everything here is safe to run at any time unless it says otherwise.

---

## Is it running?

```bash
pm2 list
curl -s http://127.0.0.1:4020/ppd_converter/api/health
```

**✅ Pass if:** `ppd_converter` shows `online`, and the health check returns `"ok":true`.

The health check also reports memory and what is configured:

```json
{"ok":true,"uptimeSeconds":8123,
 "capabilities":{"google":true,"openai":true,"session":true},
 "memory":{"rssMb":92.4,"heapUsedMb":31.2}}
```

- `google: false` — Google sign-in is not configured. Check `.env`.
- `openai: false` — the OpenAI key is missing, or `OPENAI_MODEL` is not a GPT-5-family model.
- `rssMb` above **250** — PM2 will restart the application automatically. If it happens
  repeatedly, report it.

---

## Viewing the logs

```bash
pm2 logs ppd_converter --lines 100
```

Logs are JSON, one line per event, and are also written to
`/var/www/ppd_converter/logs/`.

**No secret and no document content is ever written to a log.** Log lines carry IDs,
counts and hashes only. If you ever see an API key in a log, that is a bug — report it.

Every error carries a `correlationId`. When a user reports a problem, ask for that
reference and search for it:

```bash
grep <correlation-id> /var/www/ppd_converter/logs/*.log
```

---

## Updating to a new version

```bash
cd /var/www/ppd_converter
git pull
npm ci
npx prisma migrate deploy
npm run build
pm2 reload ppd_converter
```

**✅ Pass if:** the build ends with `⚡ Done`, and the health check returns `"ok":true`
afterwards.

Two notes:

- Run the build when the server is quiet. It uses about 300 MB briefly, and this box
  has four other applications on it.
- `pm2 reload` (not `restart`) replaces the process gracefully.
- If a migration is in progress, wait for it to finish first — check the Migration page.

---

## Restarting

```bash
pm2 reload ppd_converter
```

Never `pm2 restart all` and never `pm2 delete all` — both would affect the other four
applications.

---

## Common problems

**"Google is not connected"**
The refresh token expired or was revoked. Sign out and sign in again from the application.

**"This account is not authorised"**
Someone signed in with an account other than `felix@unitedceres.edu.sg`. This is working
as intended. To change the allowed account, edit `ALLOWED_GOOGLE_EMAIL` in `.env` and
`pm2 reload ppd_converter`.

**"No approved active mapping version exists. Migration is blocked."**
Working as intended. Go to **Template and AI Rules → Section Mapping**, create a version,
add rules, then **Approve** and **Activate** it.

**A migration failed**
Open **Migration and Validation** and read the error on that row. Fix the cause, then
click **Retry**. Retry is safe — it will not create a second revised document.

**The page loads but says "Not signed in"**
The session cookie expired after 12 hours. Sign in again.

**Nginx returns 502**
The application is not running. `pm2 list`, then `pm2 logs ppd_converter --lines 50`.

---

## Things this application will never do

Worth knowing, because they are guaranteed in code and covered by tests:

- It never modifies a source Google Doc. Writes are refused if the target is a source.
- It never overwrites an existing revised document silently.
- It never approves a document with an unresolved validation failure.
- It never deletes or edits an activity log entry — the database refuses.
- It never invents a section mapping, a document code, a clause number or a date.
- It never touches another application on this server.
