# PPD Converter — Nginx configuration

The application listens on `127.0.0.1:4020`, which is not reachable from the internet.
Nginx forwards `https://apps.unitedceres.edu.sg/ppd_converter/` to it.

**This adds one block. It replaces nothing and touches no other application.**

---

## Step 1 — Find the file that holds the server block

```bash
sudo nginx -T | grep -n "configuration file\|server_name apps.unitedceres"
```

Look for the `configuration file /etc/nginx/sites-enabled/...` line immediately above
`server_name apps.unitedceres.edu.sg`. That is the file to edit.

**✅ Pass if:** you have a filename, most likely under `/etc/nginx/sites-available/`.

---

## Step 2 — Back it up first

```bash
sudo cp /etc/nginx/sites-available/<file> /etc/nginx/sites-available/<file>.bak.$(date +%F-%H%M)
ls -l /etc/nginx/sites-available/ | grep bak
```

**✅ Pass if:** a `.bak.` copy with today's date is listed.

---

## Step 3 — Add the block

Open the file (`sudo nano /etc/nginx/sites-available/<file>`) and add this **inside** the
`server { ... }` block that has `listen 443 ssl` and `server_name apps.unitedceres.edu.sg`.
Put it next to the existing `location /gd4_simulator/` block. **Do not change anything
that is already there.**

```nginx
# --- PPD Converter ---
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

Two details that matter:

- **`proxy_pass` has no path after the port.** With a trailing `/` Nginx would strip the
  `/ppd_converter` prefix, and the application (which expects it) would return 404 for everything.
- The second `location` only redirects the no-slash form so `/ppd_converter` works as well
  as `/ppd_converter/`.

---

## Step 4 — Test the configuration

```bash
sudo nginx -t
```

**✅ Pass if:** you see `syntax is ok` and `test is successful`.

**If it fails:** do not reload. Restore the backup and report the error:

```bash
sudo cp /etc/nginx/sites-available/<file>.bak.<timestamp> /etc/nginx/sites-available/<file>
sudo nginx -t
```

---

## Step 5 — Reload (never restart)

```bash
sudo systemctl reload nginx
```

`reload` applies the new configuration without dropping connections.
`restart` would briefly take **every** site on this server offline — do not use it.

**✅ Pass if:** the command returns with no output, and
`https://apps.unitedceres.edu.sg/gd4_simulator/` still loads (proving nothing else broke).

---

## Step 6 — Check the new route

```bash
curl -sI https://apps.unitedceres.edu.sg/ppd_converter/ | head -3
```

**✅ Pass if:** the first line is `HTTP/2 200`.

Then open `https://apps.unitedceres.edu.sg/ppd_converter/` in a browser.

---

## TLS

No certificate change is needed. This is the same hostname Certbot already manages at
`/etc/letsencrypt/live/apps.unitedceres.edu.sg/`, and renewals are unaffected by adding
a location block.

---

## Rolling back the Nginx change

```bash
sudo cp /etc/nginx/sites-available/<file>.bak.<timestamp> /etc/nginx/sites-available/<file>
sudo nginx -t && sudo systemctl reload nginx
```

**✅ Pass if:** `nginx -t` passes and `https://apps.unitedceres.edu.sg/ppd_converter/`
now returns 404. The application itself keeps running on port 4020; only the public
route is gone.
