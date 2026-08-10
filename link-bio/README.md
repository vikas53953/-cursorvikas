# Link-in-Bio

A self-hosted Linktree replacement: one JSON file as your CMS, zero third-party analytics, and click tracking you own.

## Quick start

```bash
cd link-bio
cp .env.example .env        # set STATS_USER / STATS_PASS
npm install
# Edit links.json — name, bio, avatar, and links
npm start                   # http://localhost:3000
```

Edit **`links.json`** to change everything visible on the page:

```json
{
  "name": "Your Name",
  "bio": "Short bio here",
  "avatar": "/avatar.svg",
  "siteUrl": "https://links.yourdomain.com",
  "links": [
    { "slug": "github", "title": "GitHub", "url": "https://github.com/you", "emoji": "💻" }
  ]
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `name` | yes | Display name |
| `bio` | yes | One-line bio (also used in OG tags) |
| `avatar` | yes | Path under `public/` (e.g. `/avatar.jpg`) |
| `siteUrl` | no | Canonical URL for OG tags (auto-detected if omitted) |
| `links[].slug` | yes | URL-safe ID used in `/go/:slug` |
| `links[].title` | yes | Button label |
| `links[].url` | yes | Destination URL |
| `links[].emoji` | no | Optional emoji prefix |

Drop a real photo at `public/avatar.jpg` and set `"avatar": "/avatar.jpg"`.

## Routes

| Path | Auth | Description |
|------|------|-------------|
| `/` | — | Your link-in-bio page |
| `/go/:slug` | — | Logs click → 302 redirect |
| `/og.png` | — | Generated Open Graph image (1200×630) |
| `/stats` | Basic auth | Click counts per link |

Clicks are stored in `data/clicks.db` (SQLite). No external services.

## Deploy on a VPS

These instructions assume Ubuntu 22.04+, a domain pointing at your server, and Node 20+.

### 1. Install Node and clone

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git
git clone <your-repo-url> /opt/link-bio
cd /opt/link-bio/link-bio
cp .env.example .env
nano .env          # set STATS_USER, STATS_PASS, PORT=3000
nano links.json    # your content
npm install --production
```

### 2. Run as a systemd service

```bash
sudo tee /etc/systemd/system/link-bio.service <<'EOF'
[Unit]
Description=Link-in-bio server
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/link-bio/link-bio
EnvironmentFile=/opt/link-bio/link-bio/.env
ExecStart=/usr/bin/node server.mjs
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo chown -R www-data:www-data /opt/link-bio/link-bio
sudo systemctl daemon-reload
sudo systemctl enable --now link-bio
```

### Option A — Caddy (recommended)

Caddy handles HTTPS automatically.

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install caddy
```

```caddyfile
# /etc/caddy/Caddyfile
links.yourdomain.com {
    reverse_proxy localhost:3000
}
```

```bash
sudo systemctl reload caddy
```

Set `"siteUrl": "https://links.yourdomain.com"` in `links.json` so OG previews use the correct domain.

### Option B — nginx

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```

```nginx
# /etc/nginx/sites-available/link-bio
server {
    listen 80;
    server_name links.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/link-bio /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d links.yourdomain.com
```

### Updating content

Edit `links.json` on the server — no rebuild needed. Restart only if you change `.env`:

```bash
sudo systemctl restart link-bio
```

### Viewing stats

Open `https://links.yourdomain.com/stats` and sign in with the credentials from `.env`.

## Development

```bash
npm run dev   # auto-restarts on file changes (Node --watch)
```

## File layout

```
link-bio/
├── links.json       ← your CMS
├── server.mjs       ← HTTP server, tracking, OG image
├── public/          ← static assets (avatar, etc.)
├── data/            ← SQLite DB (gitignored)
├── .env             ← stats credentials (gitignored)
└── package.json
```
