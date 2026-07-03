// NetJarvis web mode.
//
// Serves the built frontend (dist/) plus an HTTP API that mirrors the
// Electron IPC surface, so the full app - dashboard, tools, and realtime
// voice - runs in any browser. Voice audio flows directly between the browser
// and OpenAI over WebRTC; this server only mints the short-lived client
// secret and executes network tools.
//
//   npm run build && npm run web       # http://localhost:8080
//
// Every request, tool call, and client-side realtime event is recorded by the
// debug logger (data/logs/netjarvis-*.jsonl).

const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(process.cwd(), ".env.local") });

const logger = require("../electron/logger.cjs");
const db = require("../electron/db.cjs");
const { createTools } = require("../electron/tools.cjs");
const { createRealtimeToken } = require("../electron/realtime-token.cjs");

const tools = createTools({ readDb: db.readDb, updateDb: db.updateDb });
tools.startBackgroundServices();
const distDir = path.join(process.cwd(), "dist");
const port = Number(process.env.PORT || 8080);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

function readBody(request, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let raw = "";
    request.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > limit) {
        reject(new Error("Request body too large"));
        request.destroy();
      }
    });
    request.on("end", () => resolve(raw));
    request.on("error", reject);
  });
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body) });
  response.end(body);
}

async function handleApi(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/tools/list") {
    return sendJson(response, 200, tools.toolSpecs);
  }

  if (request.method === "POST" && url.pathname === "/api/tools/execute") {
    const raw = await readBody(request);
    let call = {};
    try {
      call = JSON.parse(raw || "{}");
    } catch {
      return sendJson(response, 400, { ok: false, error: "Invalid JSON body" });
    }
    const name = String(call.name || "");
    const args = call.arguments && typeof call.arguments === "object" && !Array.isArray(call.arguments) ? call.arguments : {};
    const result = await tools.execute(name, args);
    return sendJson(response, 200, result);
  }

  if (request.method === "GET" && url.pathname === "/api/dashboard") {
    try {
      const snapshot = await tools.getSnapshot(url.searchParams.get("force") === "1");
      return sendJson(response, 200, snapshot);
    } catch (error) {
      return sendJson(response, 200, { error: error instanceof Error ? error.message : String(error) });
    }
  }

  if (request.method === "POST" && url.pathname === "/api/realtime/token") {
    try {
      const token = await createRealtimeToken({ instructions: tools.instructions, toolSpecs: tools.toolSpecs });
      return sendJson(response, 200, token);
    } catch (error) {
      return sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  }

  if (request.method === "POST" && url.pathname === "/api/log") {
    const raw = await readBody(request);
    let event = {};
    try {
      event = JSON.parse(raw || "{}");
    } catch {
      event = { raw: raw.slice(0, 300) };
    }
    const type = typeof event.type === "string" && event.type ? event.type : "event";
    delete event.type;
    logger.log(`client.${type}`, event);
    return sendJson(response, 200, { ok: true });
  }

  if (request.method === "GET" && url.pathname === "/api/logs/recent") {
    const limit = Number(url.searchParams.get("limit") || 200);
    return sendJson(response, 200, logger.recent(limit));
  }

  if (request.method === "GET" && url.pathname === "/api/tasks") {
    const options = {
      limit: url.searchParams.get("limit"),
      offset: url.searchParams.get("offset"),
      status: url.searchParams.get("status"),
    };
    return sendJson(response, 200, await tools.listTasks(options));
  }

  if (request.method === "GET" && url.pathname === "/api/org") {
    return sendJson(response, 200, tools.getOrg());
  }

  if (request.method === "GET" && url.pathname === "/api/artifacts") {
    const limit = Number(url.searchParams.get("limit") || 40);
    return sendJson(response, 200, await tools.listArtifacts(limit));
  }

  if (request.method === "GET" && url.pathname.startsWith("/api/artifacts/") && url.pathname.endsWith("/download")) {
    const id = path.basename(url.pathname.replace(/\/download$/, ""));
    const download = await tools.getArtifactDownload(id);
    if (!download) {
      return sendJson(response, 404, { error: `No such artifact: ${id}` });
    }
    response.writeHead(200, {
      "Content-Type": download.mime,
      "Content-Disposition": `attachment; filename="${download.filename}"`,
    });
    response.end(download.body);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/proactive/pending") {
    return sendJson(response, 200, await tools.alertWatcher.pendingEvents());
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/proactive/") && url.pathname.endsWith("/spoken")) {
    const id = path.basename(url.pathname.replace(/\/spoken$/, ""));
    return sendJson(response, 200, await tools.alertWatcher.markSpoken(id));
  }

  if (request.method === "POST" && url.pathname === "/api/scheduler/briefing") {
    return sendJson(response, 200, await tools.scheduler.run("api"));
  }

  if (request.method === "GET" && url.pathname === "/api/scheduler/status") {
    return sendJson(response, 200, tools.scheduler.status());
  }

  if (request.method === "GET" && url.pathname.startsWith("/api/exports/")) {
    const name = path.basename(url.pathname);
    const filePath = path.join(process.cwd(), "data", "exports", name);
    if (!fs.existsSync(filePath)) {
      return sendJson(response, 404, { error: `No such export: ${name}` });
    }
    response.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
    });
    fs.createReadStream(filePath).pipe(response);
    return;
  }

  if (request.method === "GET" && url.pathname === "/healthz") {
    return sendJson(response, 200, { ok: true, uptimeSeconds: Math.round(process.uptime()) });
  }

  return sendJson(response, 404, { error: `No such API route: ${request.method} ${url.pathname}` });
}

function serveStatic(response, url) {
  let filePath = path.normalize(path.join(distDir, url.pathname === "/" ? "index.html" : url.pathname));
  if (!filePath.startsWith(distDir)) {
    response.writeHead(403);
    return response.end("Forbidden");
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(distDir, "index.html");
  }
  const type = MIME[path.extname(filePath)] || "application/octet-stream";
  response.writeHead(200, { "Content-Type": type });
  fs.createReadStream(filePath).pipe(response);
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  const started = Date.now();
  response.on("finish", () => {
    if (url.pathname !== "/api/logs/recent" && url.pathname !== "/healthz") {
      logger.log("web.request", { method: request.method, path: url.pathname, status: response.statusCode, ms: Date.now() - started });
    }
  });

  if (url.pathname.startsWith("/api/") || url.pathname === "/healthz") {
    handleApi(request, response, url).catch((error) => {
      logger.log("web.error", { path: url.pathname, error: String(error && error.message) });
      if (!response.headersSent) sendJson(response, 500, { error: String(error && error.message) });
    });
    return;
  }

  serveStatic(response, url);
});

if (!fs.existsSync(path.join(distDir, "index.html"))) {
  console.error("dist/index.html not found. Run `npm run build` first.");
  process.exit(1);
}

server.listen(port, () => {
  logger.log("web.start", { port });
  console.log(`NetJarvis web mode listening on http://localhost:${port}`);
});
