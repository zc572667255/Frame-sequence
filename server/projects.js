// Project storage: every project is an ordinary folder anywhere on disk.
//
//   <folder>/project.gtproj        the document (board, cards, edges, params, ui state)
//   <folder>/assets/<sha1>.<ext>   content-addressed binaries (PNG frames, audio)
//   <folder>/backups/*.gtproj      rolling automatic backups (at most one per 10 minutes)
//
// data/registry.json remembers which folders are projects (the "recent" list), the
// last one opened and app settings, so nothing important lives only in the browser.
// Assets are named by the hash of their bytes: re-uploading an identical frame costs
// nothing, and a document never points at a file that changed under it.
import { mkdir, readFile, writeFile, rename, readdir, copyFile, access, stat, cp, rm } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";

export function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

export const PROJECT_FILE = "project.gtproj";
const ID_RE = /^[a-z0-9-]{4,64}$/;
const ASSET_RE = /^[0-9a-f]{40}\.(png|webp|jpg|gif|wav|mp3|ogg)$/;
const BACKUP_RE = /^\d{8}-\d{6}\.gtproj$/;
const BACKUP_EVERY_MS = 10 * 60 * 1000;
const BACKUP_KEEP = 30;
const EXT_BY_TYPE = {
  "image/png": "png", "image/webp": "webp", "image/jpeg": "jpg", "image/gif": "gif",
  "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav",
  "audio/mpeg": "mp3", "audio/ogg": "ogg",
};
export const TYPE_BY_EXT = {
  png: "image/png", webp: "image/webp", jpg: "image/jpeg", gif: "image/gif",
  wav: "audio/wav", mp3: "audio/mpeg", ogg: "audio/ogg",
};

// the declared type is only a hint; the magic bytes decide
function sniffExt(b, declared) {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b.length >= 6 && b.toString("ascii", 0, 3) === "GIF") return "gif";
  if (b.length >= 12 && b.toString("ascii", 0, 4) === "RIFF") {
    const kind = b.toString("ascii", 8, 12);
    if (kind === "WEBP") return "webp";
    if (kind === "WAVE") return "wav";
  }
  if (b.length >= 4 && b.toString("ascii", 0, 4) === "OggS") return "ogg";
  if (b.length >= 3 && (b.toString("ascii", 0, 3) === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0))) return "mp3";
  return EXT_BY_TYPE[declared] || null;
}

const newId = () => Date.now().toString(36) + "-" + randomBytes(3).toString("hex");

export function newDoc(id, name) {
  const now = new Date().toISOString();
  return {
    format: 1,
    id,
    name: name || "未命名项目",
    createdAt: now,
    updatedAt: now,
    board: { view: { x: 0, y: 0, z: 1 }, cards: {}, edges: {} },
    ui: {},
  };
}

// Windows-safe folder name
function safeName(name) {
  const s = String(name || "").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/[. ]+$/, "").trim();
  return (s || "未命名项目").slice(0, 80);
}

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function uniqueDir(parent, base) {
  let dir = path.join(parent, base);
  for (let i = 2; await exists(dir); i++) dir = path.join(parent, base + " (" + i + ")");
  return dir;
}

async function writeAtomic(file, data) {
  const tmp = file + "." + randomBytes(3).toString("hex") + ".tmp";
  await writeFile(tmp, data);
  await rename(tmp, file);
}

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

export function createWorkspace(appRoot) {
  const dataDir = path.join(appRoot, "data");
  const regFile = path.join(dataDir, "registry.json");
  const trashDir = path.join(dataDir, "trash");
  const defaultParent = path.join(appRoot, "projects");

  // ---------- registry ----------
  let reg = null;
  let regWrite = Promise.resolve();

  async function registry() {
    if (reg) return reg;
    try {
      reg = JSON.parse(await readFile(regFile, "utf8"));
    } catch {
      reg = {};
    }
    reg.version = 1;
    reg.projects = reg.projects || {};
    reg.settings = reg.settings || {};
    reg.last = reg.last || null;
    return reg;
  }

  function saveRegistry() {
    // serialized: overlapping writes of the same file would race on rename
    regWrite = regWrite.then(async () => {
      await mkdir(dataDir, { recursive: true });
      await writeAtomic(regFile, JSON.stringify(reg, null, 2));
    }).catch((err) => console.error("registry write failed:", err));
    return regWrite;
  }

  async function entry(id) {
    if (typeof id !== "string" || !ID_RE.test(id)) throw httpError(400, "项目 id 不合法");
    const r = (await registry()).projects[id];
    if (!r) throw httpError(404, "项目不在列表里，请用「打开项目」重新打开它");
    return r;
  }

  const fileOf = (dir) => path.join(dir, PROJECT_FILE);

  async function readDoc(dir) {
    let text;
    try {
      text = await readFile(fileOf(dir), "utf8");
    } catch (err) {
      if (err.code === "ENOENT") throw httpError(404, "找不到项目文件：" + fileOf(dir));
      throw err;
    }
    try {
      const doc = JSON.parse(text);
      if (!doc || typeof doc !== "object" || !doc.board) throw new Error();
      return doc;
    } catch {
      throw httpError(422, "项目文件损坏或不是光台项目：" + fileOf(dir));
    }
  }

  function register(doc, dir) {
    reg.projects[doc.id] = {
      path: dir,
      name: doc.name,
      updatedAt: doc.updatedAt || null,
      lastOpened: new Date().toISOString(),
    };
  }

  // ---------- projects ----------
  async function list() {
    const r = await registry();
    const out = [];
    for (const id in r.projects) {
      const p = r.projects[id];
      out.push({ id, name: p.name, path: p.path, updatedAt: p.updatedAt, lastOpened: p.lastOpened, missing: !(await exists(fileOf(p.path))) });
    }
    out.sort((a, b) => String(b.lastOpened).localeCompare(String(a.lastOpened)));
    return { projects: out, last: r.last, defaultParent };
  }

  async function create(name, parent) {
    await registry();
    const base = safeName(name);
    const parentDir = parent ? path.resolve(String(parent)) : defaultParent;
    await mkdir(parentDir, { recursive: true });
    const dir = await uniqueDir(parentDir, base);
    await mkdir(path.join(dir, "assets"), { recursive: true });
    const doc = newDoc(newId(), String(name || "").trim().slice(0, 120) || base);
    await writeAtomic(fileOf(dir), JSON.stringify(doc));
    register(doc, dir);
    reg.last = doc.id;
    await saveRegistry();
    return { id: doc.id, path: dir };
  }

  // p: a .gtproj file or a folder containing one
  async function open(p) {
    await registry();
    let dir = path.resolve(String(p || ""));
    if (dir.toLowerCase().endsWith(".gtproj")) dir = path.dirname(dir);
    const doc = await readDoc(dir);
    // a copied project folder carries its original's id; give it its own so the two
    // don't overwrite each other through the registry
    const clash = reg.projects[doc.id];
    if (!doc.id || !ID_RE.test(doc.id) || (clash && path.resolve(clash.path) !== dir && await exists(fileOf(clash.path)))) {
      doc.id = newId();
      await writeAtomic(fileOf(dir), JSON.stringify(doc));
    }
    register(doc, dir);
    reg.last = doc.id;
    await saveRegistry();
    return { id: doc.id, path: dir };
  }

  async function load(id) {
    const e = await entry(id);
    const doc = await readDoc(e.path);
    e.lastOpened = new Date().toISOString();
    e.name = doc.name;
    reg.last = id;
    await saveRegistry();
    return { doc, path: e.path };
  }

  async function save(id, doc) {
    const e = await entry(id);
    if (!doc || typeof doc !== "object" || !doc.board) throw httpError(400, "文档格式不对");
    const file = fileOf(e.path);
    if (!(await exists(file))) throw httpError(404, "项目文件不见了：" + file + "。可以用「另存为」存到新位置。");
    doc.id = id;
    doc.updatedAt = new Date().toISOString();
    await backupIfDue(e.path);
    // write-then-rename: a crash mid-save never leaves a truncated project file
    await writeAtomic(file, JSON.stringify(doc));
    e.name = doc.name;
    e.updatedAt = doc.updatedAt;
    await saveRegistry();
    return { updatedAt: doc.updatedAt };
  }

  async function backupIfDue(dir) {
    const bdir = path.join(dir, "backups");
    let names = [];
    try { names = (await readdir(bdir)).filter((n) => BACKUP_RE.test(n)).sort(); } catch { /* none yet */ }
    const newest = names[names.length - 1];
    if (newest) {
      const st = await stat(path.join(bdir, newest));
      if (Date.now() - st.mtimeMs < BACKUP_EVERY_MS) return;
    }
    await mkdir(bdir, { recursive: true });
    await copyFile(fileOf(dir), path.join(bdir, stamp() + ".gtproj"));
    names = (await readdir(bdir)).filter((n) => BACKUP_RE.test(n)).sort();
    for (const old of names.slice(0, Math.max(0, names.length - BACKUP_KEEP))) {
      await rm(path.join(bdir, old), { force: true });
    }
  }

  async function backups(id) {
    const e = await entry(id);
    const bdir = path.join(e.path, "backups");
    let names = [];
    try { names = (await readdir(bdir)).filter((n) => BACKUP_RE.test(n)); } catch { return []; }
    const out = [];
    for (const n of names) {
      const st = await stat(path.join(bdir, n));
      out.push({ name: n, savedAt: st.mtime.toISOString(), size: st.size });
    }
    return out.sort((a, b) => b.name.localeCompare(a.name));
  }

  async function readBackup(id, name) {
    if (!BACKUP_RE.test(String(name))) throw httpError(400, "备份名不合法");
    const e = await entry(id);
    try {
      return JSON.parse(await readFile(path.join(e.path, "backups", name), "utf8"));
    } catch {
      throw httpError(404, "备份不存在或已损坏");
    }
  }

  async function saveAs(id, parent, name) {
    const e = await entry(id);
    const parentDir = parent ? path.resolve(String(parent)) : path.dirname(e.path);
    await mkdir(parentDir, { recursive: true });
    const dir = await uniqueDir(parentDir, safeName(name));
    // assets come along; old backups belong to the original
    await cp(e.path, dir, { recursive: true, filter: (src) => path.basename(src) !== "backups" });
    const doc = await readDoc(dir);
    doc.id = newId();
    doc.name = String(name || "").trim().slice(0, 120) || doc.name;
    doc.updatedAt = new Date().toISOString();
    await writeAtomic(fileOf(dir), JSON.stringify(doc));
    register(doc, dir);
    reg.last = doc.id;
    await saveRegistry();
    return { id: doc.id, path: dir };
  }

  async function forget(id) {
    await entry(id);
    delete reg.projects[id];
    if (reg.last === id) reg.last = null;
    await saveRegistry();
  }

  // never unlinks: the folder moves to data/trash, which the user can empty by hand
  async function trash(id) {
    const e = await entry(id);
    await mkdir(trashDir, { recursive: true });
    const dest = path.join(trashDir, path.basename(e.path) + "-" + stamp());
    try {
      await rename(e.path, dest);
    } catch (err) {
      if (err.code !== "EXDEV") throw err;
      await cp(e.path, dest, { recursive: true }); // across drives rename can't work
      await rm(e.path, { recursive: true, force: true });
    }
    await forget(id);
    return { movedTo: dest };
  }

  async function projectDir(id) {
    return (await entry(id)).path;
  }

  // ---------- assets ----------
  async function putAsset(id, buf, declaredType) {
    const e = await entry(id);
    const ext = sniffExt(buf, declaredType);
    if (!ext) throw httpError(415, "不支持的文件类型");
    const name = createHash("sha1").update(buf).digest("hex") + "." + ext;
    const assetsDir = path.join(e.path, "assets");
    await mkdir(assetsDir, { recursive: true });
    const file = path.join(assetsDir, name);
    if (!(await exists(file))) await writeAtomic(file, buf);
    return name;
  }

  async function assetFile(id, assetId) {
    if (typeof assetId !== "string" || !ASSET_RE.test(assetId)) throw httpError(400, "素材 id 不合法");
    return path.join((await entry(id)).path, "assets", assetId);
  }

  // Assets nothing refers to any more: not the project file, not any of its
  // backups (restoring one must still find its images), and not `keep` — names
  // the page still holds, e.g. in its undo history. Old versions of edited
  // frames pile up otherwise, since saving only ever adds files.
  const ASSET_NAME = /[0-9a-f]{40}\.(?:png|webp|jpg|gif|wav|mp3|ogg)/g;
  async function unusedAssets(id, keep = []) {
    const e = await entry(id);
    const used = new Set((Array.isArray(keep) ? keep : []).filter((k) => typeof k === "string" && ASSET_RE.test(k)));
    const texts = [];
    try { texts.push(await readFile(path.join(e.path, PROJECT_FILE), "utf8")); } catch { throw httpError(409, "读不到项目文件，先保存一次再试"); }
    const bdir = path.join(e.path, "backups");
    let bnames = [];
    try { bnames = await readdir(bdir); } catch { /* no backups yet */ }
    for (const n of bnames) if (n.endsWith(".gtproj")) texts.push(await readFile(path.join(bdir, n), "utf8"));
    for (const t of texts) for (const m of t.matchAll(ASSET_NAME)) used.add(m[0]);
    const dir = path.join(e.path, "assets");
    let names = [];
    try { names = await readdir(dir); } catch { /* no assets */ }
    const files = [];
    let bytes = 0;
    for (const n of names) {
      if (!ASSET_RE.test(n) || used.has(n)) continue;
      files.push(n);
      bytes += (await stat(path.join(dir, n))).size;
    }
    return { count: files.length, bytes, total: names.length, files };
  }

  // never unlinks: the unused files move to data/trash/<project>-assets-<time>
  async function cleanAssets(id, keep) {
    const e = await entry(id);
    const r = await unusedAssets(id, keep);
    if (!r.count) return { count: 0, bytes: 0 };
    const dest = path.join(trashDir, path.basename(e.path) + "-assets-" + stamp());
    await mkdir(dest, { recursive: true });
    for (const n of r.files) {
      const src = path.join(e.path, "assets", n), to = path.join(dest, n);
      try {
        await rename(src, to);
      } catch (err) {
        if (err.code !== "EXDEV") throw err;
        await copyFile(src, to);
        await rm(src, { force: true });
      }
    }
    return { count: r.count, bytes: r.bytes, movedTo: dest };
  }

  // ---------- settings ----------
  async function getSettings() { return (await registry()).settings; }
  async function putSettings(patch) {
    const r = await registry();
    if (patch && typeof patch === "object") Object.assign(r.settings, patch);
    await saveRegistry();
    return r.settings;
  }

  return {
    list, create, open, load, save, backups, readBackup, saveAs, forget, trash, projectDir,
    putAsset, assetFile, unusedAssets, cleanAssets, getSettings, putSettings, defaultParent, fileOf,
  };
}
