import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import dotenv from 'dotenv';
import sharp from 'sharp';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');

dotenv.config({ path: path.join(ROOT, '.env') });

const PORT = Number(process.env.PORT) || 3000;
const STATS_USER = process.env.STATS_USER || 'admin';
const STATS_PASS = process.env.STATS_PASS || 'changeme';

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'clicks.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS clicks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL,
    ts TEXT NOT NULL DEFAULT (datetime('now')),
    ip TEXT,
    ua TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_clicks_slug ON clicks(slug);
`);

const insertClick = db.prepare(
  'INSERT INTO clicks (slug, ip, ua) VALUES (?, ?, ?)'
);

const countBySlug = db.prepare(`
  SELECT slug, COUNT(*) AS count
  FROM clicks
  GROUP BY slug
  ORDER BY count DESC
`);

const totalClicks = db.prepare('SELECT COUNT(*) AS total FROM clicks');

function loadConfig() {
  const raw = fs.readFileSync(path.join(ROOT, 'links.json'), 'utf8');
  return JSON.parse(raw);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderPage(config, baseUrl) {
  const { name, bio, avatar, links } = config;
  const siteUrl = config.siteUrl || baseUrl;
  const ogImage = `${siteUrl.replace(/\/$/, '')}/og.png`;

  const linkButtons = links
    .map((link) => {
      const emoji = link.emoji ? `<span class="emoji" aria-hidden="true">${escapeHtml(link.emoji)}</span>` : '';
      return `<a class="link-btn" href="/go/${escapeHtml(link.slug)}">${emoji}<span>${escapeHtml(link.title)}</span></a>`;
    })
    .join('\n        ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(name)}</title>
  <meta name="description" content="${escapeHtml(bio)}">

  <!-- Open Graph -->
  <meta property="og:type" content="website">
  <meta property="og:title" content="${escapeHtml(name)}">
  <meta property="og:description" content="${escapeHtml(bio)}">
  <meta property="og:image" content="${escapeHtml(ogImage)}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:url" content="${escapeHtml(siteUrl)}">

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(name)}">
  <meta name="twitter:description" content="${escapeHtml(bio)}">
  <meta name="twitter:image" content="${escapeHtml(ogImage)}">

  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg: #f8f9fb;
      --surface: #ffffff;
      --text: #1a1a2e;
      --text-muted: #6b7280;
      --border: #e5e7eb;
      --accent: #6366f1;
      --accent-hover: #4f46e5;
      --shadow: 0 1px 3px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.04);
      --shadow-hover: 0 4px 12px rgba(99,102,241,.15);
      --radius: 14px;
      --max-w: 480px;
    }

    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #0f0f14;
        --surface: #1a1a24;
        --text: #f0f0f5;
        --text-muted: #9ca3af;
        --border: #2a2a3a;
        --accent: #818cf8;
        --accent-hover: #a5b4fc;
        --shadow: 0 1px 3px rgba(0,0,0,.3);
        --shadow-hover: 0 4px 16px rgba(129,140,248,.2);
      }
    }

    html { -webkit-text-size-adjust: 100%; }

    body {
      font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100dvh;
      display: flex;
      justify-content: center;
      padding: 2.5rem 1.25rem 3rem;
      line-height: 1.5;
    }

    main {
      width: 100%;
      max-width: var(--max-w);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1.5rem;
    }

    .profile {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      gap: 0.75rem;
    }

    .avatar {
      width: 96px;
      height: 96px;
      border-radius: 50%;
      object-fit: cover;
      border: 3px solid var(--border);
      box-shadow: var(--shadow);
    }

    h1 {
      font-size: 1.5rem;
      font-weight: 700;
      letter-spacing: -0.02em;
    }

    .bio {
      color: var(--text-muted);
      font-size: 0.95rem;
      max-width: 32ch;
    }

    .links {
      width: 100%;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .link-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      width: 100%;
      padding: 0.9rem 1.25rem;
      background: var(--surface);
      color: var(--text);
      text-decoration: none;
      font-size: 1rem;
      font-weight: 500;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
    }

    .link-btn:hover {
      transform: translateY(-1px);
      box-shadow: var(--shadow-hover);
      border-color: var(--accent);
    }

    .link-btn:active {
      transform: translateY(0);
    }

    .link-btn .emoji {
      font-size: 1.15rem;
      line-height: 1;
    }

    footer {
      margin-top: auto;
      padding-top: 1rem;
      font-size: 0.75rem;
      color: var(--text-muted);
      opacity: 0.6;
    }
  </style>
</head>
<body>
  <main>
    <div class="profile">
      <img class="avatar" src="${escapeHtml(avatar)}" alt="${escapeHtml(name)}" width="96" height="96">
      <h1>${escapeHtml(name)}</h1>
      <p class="bio">${escapeHtml(bio)}</p>
    </div>
    <nav class="links" aria-label="Links">
        ${linkButtons}
    </nav>
    <footer>link-in-bio</footer>
  </main>
</body>
</html>`;
}

function renderStatsPage(config, counts, total) {
  const slugMap = Object.fromEntries(config.links.map((l) => [l.slug, l.title]));
  const rows = counts
    .map((row) => {
      const title = slugMap[row.slug] || row.slug;
      return `<tr><td>${escapeHtml(title)}</td><td><code>${escapeHtml(row.slug)}</code></td><td class="num">${row.count}</td></tr>`;
    })
    .join('');

  const zeroRows = config.links
    .filter((l) => !counts.find((c) => c.slug === l.slug))
    .map((l) => `<tr><td>${escapeHtml(l.title)}</td><td><code>${escapeHtml(l.slug)}</code></td><td class="num">0</td></tr>`)
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>Click Stats</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg: #f8f9fb; --surface: #fff; --text: #1a1a2e;
      --text-muted: #6b7280; --border: #e5e7eb; --accent: #6366f1;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #0f0f14; --surface: #1a1a24; --text: #f0f0f5;
        --text-muted: #9ca3af; --border: #2a2a3a; --accent: #818cf8;
      }
    }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: var(--bg); color: var(--text);
      padding: 2rem 1.25rem; max-width: 640px; margin: 0 auto;
    }
    h1 { font-size: 1.4rem; margin-bottom: 0.25rem; }
    .total { color: var(--text-muted); margin-bottom: 1.5rem; font-size: 0.95rem; }
    table { width: 100%; border-collapse: collapse; background: var(--surface); border-radius: 12px; overflow: hidden; border: 1px solid var(--border); }
    th, td { padding: 0.75rem 1rem; text-align: left; border-bottom: 1px solid var(--border); }
    th { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); }
    tr:last-child td { border-bottom: none; }
    .num { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; color: var(--accent); }
    code { font-size: 0.85em; background: var(--bg); padding: 0.15em 0.4em; border-radius: 4px; }
    a { color: var(--accent); }
  </style>
</head>
<body>
  <h1>Click Stats</h1>
  <p class="total">${total} total clicks</p>
  <table>
    <thead><tr><th>Link</th><th>Slug</th><th>Clicks</th></tr></thead>
    <tbody>${rows}${zeroRows}</tbody>
  </table>
  <p style="margin-top:1.5rem;font-size:0.85rem;color:var(--text-muted)"><a href="/">← Back to page</a></p>
</body>
</html>`;
}

async function generateOgImage(config) {
  const name = escapeHtml(config.name);
  const bio = escapeHtml(config.bio);
  const linkCount = config.links.length;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1a1a2e"/>
      <stop offset="100%" stop-color="#2d2b55"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#g)"/>
  <circle cx="600" cy="220" r="72" fill="#6366f1" opacity="0.3"/>
  <circle cx="600" cy="220" r="56" fill="#818cf8"/>
  <text x="600" y="340" text-anchor="middle" font-family="system-ui,sans-serif" font-size="52" font-weight="700" fill="#ffffff">${name}</text>
  <text x="600" y="400" text-anchor="middle" font-family="system-ui,sans-serif" font-size="28" fill="#a5b4fc">${bio}</text>
  <text x="600" y="520" text-anchor="middle" font-family="system-ui,sans-serif" font-size="22" fill="#6b7280">${linkCount} link${linkCount === 1 ? '' : 's'}</text>
</svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

function checkBasicAuth(req) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Basic ')) return false;
  const decoded = Buffer.from(header.slice(6), 'base64').toString();
  const sep = decoded.indexOf(':');
  if (sep === -1) return false;
  const user = decoded.slice(0, sep);
  const pass = decoded.slice(sep + 1);
  return user === STATS_USER && pass === STATS_PASS;
}

function send401(res) {
  res.writeHead(401, {
    'WWW-Authenticate': 'Basic realm="Stats"',
    'Content-Type': 'text/plain',
  });
  res.end('Unauthorized');
}

function getBaseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`;
  return `${proto}://${host}`;
}

function serveStatic(filePath, res) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
  };
  const type = types[ext] || 'application/octet-stream';

  try {
    const data = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'public, max-age=3600' });
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

let ogCache = null;
let ogCacheKey = '';

async function getOgImage(config) {
  const key = JSON.stringify({ name: config.name, bio: config.bio, count: config.links.length });
  if (ogCache && ogCacheKey === key) return ogCache;
  ogCache = await generateOgImage(config);
  ogCacheKey = key;
  return ogCache;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  try {
    const config = loadConfig();

    // Redirect /go/:slug
    const goMatch = pathname.match(/^\/go\/([a-zA-Z0-9_-]+)$/);
    if (goMatch && (req.method === 'GET' || req.method === 'HEAD')) {
      const slug = goMatch[1];
      const link = config.links.find((l) => l.slug === slug);
      if (!link) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Link not found');
        return;
      }
      const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress;
      const ua = req.headers['user-agent'] || '';
      if (req.method === 'GET') {
        insertClick.run(slug, ip, ua);
      }
      res.writeHead(302, { Location: link.url });
      res.end();
      return;
    }

    // Stats page
    if (pathname === '/stats' && (req.method === 'GET' || req.method === 'HEAD')) {
      if (!checkBasicAuth(req)) {
        send401(res);
        return;
      }
      if (req.method === 'HEAD') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end();
        return;
      }
      const counts = countBySlug.all();
      const { total } = totalClicks.get();
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderStatsPage(config, counts, total));
      return;
    }

    // OG image
    if (pathname === '/og.png' && (req.method === 'GET' || req.method === 'HEAD')) {
      const png = await getOgImage(config);
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=300',
        'Content-Length': png.length,
      });
      if (req.method === 'HEAD') {
        res.end();
      } else {
        res.end(png);
      }
      return;
    }

    // Static files from public/
    if (pathname !== '/' && (req.method === 'GET' || req.method === 'HEAD')) {
      const safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
      const filePath = path.join(PUBLIC, safePath);
      if (filePath.startsWith(PUBLIC) && serveStatic(filePath, res)) return;
    }

    // Main page
    if (pathname === '/' && (req.method === 'GET' || req.method === 'HEAD')) {
      if (req.method === 'HEAD') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end();
        return;
      }
      const baseUrl = getBaseUrl(req);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderPage(config, baseUrl));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  } catch (err) {
    console.error(err);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal server error');
  }
});

server.listen(PORT, () => {
  console.log(`Link-in-bio running at http://localhost:${PORT}`);
});
