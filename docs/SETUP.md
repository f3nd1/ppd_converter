# PPD Converter — Setup

First-time installation on the server. Follow the steps in order. Each one has a
**✅ Pass if:** line — if that is not what you see, stop and report it rather than continuing.

You will need SSH access to the server and about 20 minutes.

> **Nothing in this guide touches the four applications already running**
> (`admission-screening`, `ai_impact_builder`, `social_media_os`, `ucc_qa_hub`).
> No command here names them. Never run `pm2 restart all` or `pm2 delete all`.

---

## Before you start — what you need to have ready

1. A **Google Cloud OAuth client** (Client ID and Client Secret) for a Web application.
2. An **OpenAI API key**.
3. About **400 MB of free disk** (the server has plenty).

If you do not have 1 and 2 yet, you can still complete steps 1–6 and see the application run.
Google sign-in and migration will be unavailable until they are configured.

---

## Step 1 — Get the code onto the server

```bash
cd /var/www
git clone https://github.com/f3nd1/ppd_converter.git
cd ppd_converter
```

**✅ Pass if:** `ls` shows `package.json`, `server`, `src` and `prisma`.

---

## Step 2 — Install the dependencies

```bash
cd /var/www/ppd_converter
npm ci
```

This takes a couple of minutes and downloads about 200 MB.

**✅ Pass if:** the last line says `added ... packages` and there is no red `npm ERR!` text.

---

## Step 3 — Create the settings file

```bash
cd /var/www/ppd_converter
cp .env.example .env
chmod 600 .env
```

Now generate the two secrets the application needs:

```bash
echo "ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")"
echo "SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")"
```

Open `.env` in an editor (`nano .env`) and fill in every value:

| Setting | What to put |
|---|---|
| `DATABASE_URL` | `file:./data/ppd.db` |
| `HOST` | `127.0.0.1` |
| `PORT` | `4020` |
| `NODE_ENV` | `production` |
| `GOOGLE_CLIENT_ID` | From Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | From Google Cloud Console |
| `GOOGLE_REDIRECT_URI` | `https://apps.unitedceres.edu.sg/ppd_converter/api/auth/google/callback` |
| `ALLOWED_GOOGLE_EMAIL` | `felix@unitedceres.edu.sg` |
| `ENCRYPTION_KEY` | The first value you generated above |
| `SESSION_SECRET` | The second value you generated above |
| `OPENAI_API_KEY` | Your OpenAI key |
| `OPENAI_MODEL` | `gpt-5-mini` (or another GPT-5-family model) |

> `.env` is excluded from Git and must never be committed. `chmod 600` means only your
> account can read it.

**✅ Pass if:** `cat .env` shows all values filled in, and `ls -l .env` starts with `-rw-------`.

---

## Step 4 — Add the redirect URI in Google Cloud Console

1. Go to **Google Cloud Console → APIs & Services → Credentials**.
2. Click your OAuth 2.0 Client ID.
3. Under **Authorised redirect URIs**, click **Add URI** and paste exactly:
   `https://apps.unitedceres.edu.sg/ppd_converter/api/auth/google/callback`
4. Click **Save**.
5. Under **APIs & Services → Library**, make sure both **Google Drive API** and
   **Google Docs API** are enabled.

**✅ Pass if:** the redirect URI is listed, and both APIs show "API enabled".

---

## Step 5 — Create the database

```bash
cd /var/www/ppd_converter
mkdir -p data logs
chmod 700 data
npx prisma migrate deploy
node --experimental-strip-types prisma/seed.ts
```

**✅ Pass if:** you see `All migrations have been successfully applied.` and then
`Seeded. Criteria: 7. Sub-criteria: 0 (none seeded by design).`

> Sub-criteria being 0 is correct. Official sub-criterion names are entered by you —
> the application never invents them.

---

## Step 6 — Build

```bash
cd /var/www/ppd_converter
npm run build
```

This uses about 300 MB of memory for a few seconds.

**✅ Pass if:** you see `✓ built in ...ms` and then `⚡ Done in ...ms`, with no errors.

---

## Step 7 — Check it runs (before involving PM2)

```bash
cd /var/www/ppd_converter
node dist/server/index.js
```

In a second terminal:

```bash
curl -s http://127.0.0.1:4020/ppd_converter/api/health
```

**✅ Pass if:** you get back something like
`{"ok":true,"uptimeSeconds":3,"capabilities":{"google":true,"openai":true,"session":true},...}`

If `google` or `openai` says `false`, a value in `.env` is missing or wrong. Go back to Step 3.

Press **Ctrl+C** to stop it before continuing.

---

## Step 8 — Start it under PM2

```bash
cd /var/www/ppd_converter
pm2 start ecosystem.config.cjs
pm2 list
```

**✅ Pass if:** `pm2 list` shows `ppd_converter` as `online`, **and the four existing
applications are all still `online` too**. If any of them changed, stop and report it.

---

## Step 9 — Add the Nginx route

**Do not skip the backup or the test.** See `docs/NGINX.md` for the exact block and
the full procedure. In short:

1. Back up the config file.
2. Add the `location /ppd_converter/` block.
3. Run `sudo nginx -t`.
4. Only if that passes: `sudo systemctl reload nginx`.

**✅ Pass if:** `sudo nginx -t` says `syntax is ok` and `test is successful`, and
`https://apps.unitedceres.edu.sg/ppd_converter/` loads in a browser.

---

## Step 10 — Make it survive a reboot

Only after everything above works and you are happy with it:

```bash
pm2 save
```

**✅ Pass if:** you see `Successfully saved in ...`.

> This records the *current* PM2 process list, including the four existing applications.
> Check they were all `online` in Step 8 before running this.

---

## Step 11 — Sign in

1. Open `https://apps.unitedceres.edu.sg/ppd_converter/`.
2. Sign in with **felix@unitedceres.edu.sg**.
3. Approve the Google permission screen.

**✅ Pass if:** the Dashboard loads and shows 7 criteria.

> Only `felix@unitedceres.edu.sg` can sign in. Any other account is refused with a
> message, and nothing is stored for it.

---

## What to do next, in the application

1. **Source Documents** — add your sub-criteria, then set each one's old and new Google links.
   Click **Validate links**, then **Scan source**.
2. **Template and AI Rules → Template** — paste the approved Google Docs template URL,
   click **Validate**, then **Save as active template**.
3. **Template and AI Rules → Section Mapping** — create a mapping version, add the rules,
   then **Approve** and **Activate** it.
4. **Migration and Validation** — select documents and migrate.

> Migration stays blocked until an approved, active mapping version exists. That is
> deliberate and is enforced by the server, not just by the buttons.
