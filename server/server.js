// 光台 · 序列帧工作室 — local server.
//
// Zero runtime dependencies: serves web/ as static files and a small JSON + binary
// API over data/projects. Binds to 127.0.0.1 only. Mutating requests must carry an
// X-Guangtai header, which a foreign web page cannot add without a CORS preflight
// this server never answers — so other sites open in the browser can't write here.
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exec } from "node:child_process";
import { createWorkspace, httpError, TYPE_BY_EXT } from "./projects.js";
import { pickFolder, pickProjectFile, reveal } from "./dialogs.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEB = path.join(ROOT, "web");
const LEGACY = path.join(ROOT, "序列帧动画工具.html");
const PORT = Number(process.env.PORT) || 5288;
const HOST = "127.0.0.1";
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const ALLOWED_ORIGINS = new Set([`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`]);

const MAX_JSON = 64 * 1024 * 1024;
const MAX_ASSET = 64 * 1024 * 1024;

// GUANGTAI_HOME moves data/ and projects/ elsewhere (used to run throwaway test
// instances that can never touch real projects)
const ws = createWorkspace(process.env.GUANGTAI_HOME ? path.resolve(process.env.GUANGTAI_HOME) : ROOT);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function sendJson(res, status, body) {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": data.length,
    "Cache-Control": "no-store",
  });
  res.end(data);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(httpError(413, "请求体过大"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readJson(req) {
  const buf = await readBody(req, MAX_JSON);
  try {
    return JSON.parse(buf.toString("utf8") || "null");
  } catch {
    throw httpError(400, "JSON 解析失败");
  }
}

function guardMutation(req) {
  if (req.headers["x-guangtai"] !== "1") throw httpError(403, "缺少 X-Guangtai 请求头");
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.has(origin)) throw httpError(403, "来源不被允许");
}

async function api(req, res, url) {
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent); // ["api", ...]
  const method = req.method;
  if (method !== "GET" && method !== "HEAD") guardMutation(req);

  const body = () => readJson(req).then((b) => b || {});

  if (parts[1] === "settings" && parts.length === 2) {
    if (method === "GET") return sendJson(res, 200, await ws.getSettings());
    if (method === "PUT") return sendJson(res, 200, await ws.putSettings(await body()));
  }

  if (parts[1] === "dialog" && method === "POST") {
    const b = await body();
    if (parts[2] === "folder") return sendJson(res, 200, { path: await pickFolder(b.title, b.start) });
    if (parts[2] === "project") return sendJson(res, 200, { path: await pickProjectFile(b.start) });
  }

  if (parts[1] === "projects" && parts.length === 2) {
    if (method === "GET") return sendJson(res, 200, await ws.list());
    if (method === "POST") { const b = await body(); return sendJson(res, 200, await ws.create(b.name, b.parent)); }
  }

  if (parts[1] === "projects" && parts[2] === "open" && parts.length === 3 && method === "POST") {
    return sendJson(res, 200, await ws.open((await body()).path));
  }

  if (parts[1] === "projects" && parts.length === 3) {
    const id = parts[2];
    if (method === "GET") return sendJson(res, 200, await ws.load(id));
    if (method === "PUT") return sendJson(res, 200, await ws.save(id, await readJson(req)));
    // DELETE forgets the project (files stay); ?trash=1 also moves the folder to data/trash
    if (method === "DELETE") {
      if (url.searchParams.get("trash") === "1") return sendJson(res, 200, await ws.trash(id));
      await ws.forget(id);
      return sendJson(res, 200, { ok: true });
    }
  }

  if (parts[1] === "projects" && parts.length === 4 && method === "POST") {
    const id = parts[2];
    if (parts[3] === "save-as") { const b = await body(); return sendJson(res, 200, await ws.saveAs(id, b.parent, b.name)); }
    if (parts[3] === "reveal") { reveal(ws.fileOf(await ws.projectDir(id))); return sendJson(res, 200, { ok: true }); }
  }

  if (parts[1] === "projects" && parts[3] === "backups" && method === "GET") {
    const id = parts[2];
    if (parts.length === 4) return sendJson(res, 200, await ws.backups(id));
    if (parts.length === 5) return sendJson(res, 200, await ws.readBackup(id, parts[4]));
  }

  if (parts[1] === "projects" && parts[3] === "assets") {
    const id = parts[2];
    if (parts.length === 4 && method === "POST") {
      const buf = await readBody(req, MAX_ASSET);
      if (!buf.length) throw httpError(400, "空文件");
      const assetId = await ws.putAsset(id, buf, String(req.headers["content-type"] || "").split(";")[0]);
      return sendJson(res, 200, { id: assetId });
    }
    if (parts.length === 5 && (method === "GET" || method === "HEAD")) {
      const file = await ws.assetFile(id, parts[4]);
      let st;
      try { st = await stat(file); } catch { throw httpError(404, "素材不存在"); }
      const ext = path.extname(file).slice(1);
      res.writeHead(200, {
        "Content-Type": TYPE_BY_EXT[ext] || "application/octet-stream",
        "Content-Length": st.size,
        // content-addressed: the bytes behind a name can never change
        "Cache-Control": "private, max-age=31536000, immutable",
      });
      if (method === "HEAD") return res.end();
      createReadStream(file).pipe(res);
      return;
    }
  }

  throw httpError(404, "接口不存在");
}

async function serveStatic(req, res, url) {
  if (req.method !== "GET" && req.method !== "HEAD") throw httpError(405, "方法不允许");
  let rel = decodeURIComponent(url.pathname);
  let file;
  if (rel === "/legacy" || rel === "/legacy/") {
    file = LEGACY;
  } else {
    if (rel.endsWith("/")) rel += "index.html";
    file = path.resolve(WEB, "." + rel);
    if (file !== WEB && !file.startsWith(WEB + path.sep)) throw httpError(403, "路径越界");
  }
  let data;
  try {
    data = await readFile(file);
  } catch {
    throw httpError(404, "文件不存在");
  }
  res.writeHead(200, {
    "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
    "Content-Length": data.length,
    "Cache-Control": "no-cache",
  });
  res.end(req.method === "HEAD" ? undefined : data);
}

const server = http.createServer(async (req, res) => {
  try {
    if (!ALLOWED_HOSTS.has(req.headers.host || "")) throw httpError(403, "Host 不被允许");
    const url = new URL(req.url, "http://localhost");
    if (url.pathname.startsWith("/api/")) await api(req, res, url);
    else await serveStatic(req, res, url);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    if (!res.headersSent) sendJson(res, status, { error: err.message || String(err) });
    else res.end();
  }
});

const appUrl = `http://${HOST}:${PORT}/`;

function openBrowser() {
  const cmd = process.platform === "win32" ? `start "" "${appUrl}"`
    : process.platform === "darwin" ? `open "${appUrl}"` : `xdg-open "${appUrl}"`;
  exec(cmd, () => {});
}

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    // most likely the studio is already running — just bring it up
    console.log(`端口 ${PORT} 已被占用，工作室可能已在运行：${appUrl}`);
    if (process.argv.includes("--open")) openBrowser();
    process.exit(0);
  }
  throw err;
});

server.listen(PORT, HOST, () => {
  console.log(`光台 · 序列帧工作室 已启动：${appUrl}`);
  console.log("关闭这个窗口即可停止服务。");
  if (process.argv.includes("--open")) openBrowser();
});
