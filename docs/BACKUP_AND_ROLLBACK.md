# PPD Converter — Backup and rollback

Everything worth keeping is in two places:

| What | Where | Matters because |
|---|---|---|
| The database | `/var/www/ppd_converter/data/ppd.db` | All configuration, migration records, change records, validation results and the activity log |
| The settings | `/var/www/ppd_converter/.env` | Secrets. **Not in Git** — if this is lost it must be recreated by hand |

The code is in GitHub. The revised Google Docs are in Google Drive. Neither needs
backing up here.

---

## Taking a backup

Run this any time — it is safe while the application is running:

```bash
cd /var/www/ppd_converter
mkdir -p backups
STAMP=$(date +%F-%H%M)
sqlite3 data/ppd.db ".backup 'backups/ppd-$STAMP.db'"
cp .env backups/env-$STAMP.txt
chmod 600 backups/*
ls -lh backups/ | tail -4
```

**✅ Pass if:** you see two new files with today's date and a non-zero size.

> Use `sqlite3 .backup`, not `cp`. A plain copy of a database that is being written to
> can produce a file that will not open.

If `sqlite3` is not installed:

```bash
sudo apt-get install -y sqlite3
```

---

## Backing up automatically each night

```bash
crontab -e
```

Add this one line:

```cron
15 2 * * * cd /var/www/ppd_converter && mkdir -p backups && sqlite3 data/ppd.db ".backup 'backups/ppd-$(date +\%F).db'" && find backups -name 'ppd-*.db' -mtime +30 -delete
```

That takes a backup at 02:15 every night and keeps 30 days.

**✅ Pass if:** `crontab -l` shows the line, and a new file appears in `backups/` tomorrow.

> It does **not** back up `.env`, on purpose — a nightly copy of your secrets sitting on
> the same disk adds risk without adding safety. Copy `.env` somewhere secure once, by hand.

---

## Restoring the database

This replaces all current data. Be sure.

```bash
cd /var/www/ppd_converter

# 1. Stop the application so nothing writes during the swap
pm2 stop ppd_converter

# 2. Keep the current file — do not delete it
mv data/ppd.db data/ppd.db.before-restore-$(date +%F-%H%M)

# 3. Put the backup in place
cp backups/ppd-<the-one-you-want>.db data/ppd.db

# 4. Apply any migrations the backup predates
npx prisma migrate deploy

# 5. Start again
pm2 start ecosystem.config.cjs
curl -s http://127.0.0.1:4020/ppd_converter/api/health
```

**✅ Pass if:** the health check returns `"ok":true` and the Dashboard shows the counts
you expect from that backup.

> Step 2 moves the current database rather than deleting it. If the restore turns out to
> be the wrong backup, the original is still there.

---

## Rolling back to a previous version of the code

```bash
cd /var/www/ppd_converter

# See what is deployed and what came before
git log --oneline -10

# Go back to a specific commit
git checkout <commit-hash>
npm ci
npm run build
pm2 reload ppd_converter
```

**✅ Pass if:** the health check returns `"ok":true`.

To return to the latest version:

```bash
git checkout claude/ppd-converter-web-app-s66359
npm ci && npm run build && pm2 reload ppd_converter
```

> **Database migrations do not roll back.** If the version you are rolling back *from*
> added a migration, the database keeps the newer shape. That is usually harmless
> (extra columns are ignored), but if the older code errors, restore a database backup
> from before the upgrade as well.

---

## Removing the application entirely

In this order:

```bash
# 1. Take the public route away first
sudo cp /etc/nginx/sites-available/<file>.bak.<timestamp> /etc/nginx/sites-available/<file>
sudo nginx -t && sudo systemctl reload nginx

# 2. Take a final backup
cd /var/www/ppd_converter && sqlite3 data/ppd.db ".backup 'backups/ppd-final.db'"
cp -r backups ~/ppd_converter-final-backup

# 3. Stop and remove ONLY this process
pm2 stop ppd_converter
pm2 delete ppd_converter
pm2 save

# 4. Remove the directory
sudo rm -rf /var/www/ppd_converter
```

**✅ Pass if:** `pm2 list` shows the four other applications still `online`, and
`https://apps.unitedceres.edu.sg/gd4_simulator/` still loads.

> `pm2 delete ppd_converter` names one process. Never `pm2 delete all`.
> Revised Google Docs already created in Drive are unaffected — they are ordinary
> documents and stay where they are.

---

## What a backup does not contain

- The revised Google Docs (they live in Google Drive)
- The source documents (never copied into this application)
- `node_modules` (rebuilt by `npm ci`)
- The build output (rebuilt by `npm run build`)
