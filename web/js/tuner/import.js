// Reading packages back in: the studio's character zip, sheet + JSON, PNG-zip
// exports, and the common Aseprite / TexturePacker JSON layouts.
import { blobToCanvas, createCanvas, uid } from "../core/util.js";
import { putCanvasAsset, putBlobAsset } from "../core/assets.js";
import { readZip } from "../imaging/zip.js";
import { newAnim, defaultCharacter } from "./model.js";

const TYPE = { png: "image/png", webp: "image/webp", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", wav: "audio/wav", mp3: "audio/mpeg", ogg: "audio/ogg" };
const typeOf = (name) => TYPE[((/\.([a-z0-9]+)$/i.exec(name) || [])[1] || "").toLowerCase()] || "application/octet-stream";
const base = (p) => String(p || "").split(/[\\/]/).pop();
const dir = (p) => { const i = String(p).lastIndexOf("/"); return i < 0 ? "" : p.slice(0, i + 1); };
const text = (u8) => new TextDecoder("utf-8").decode(u8);

// a lookup that resolves paths relative to the JSON, falling back to the bare file
// name (people move files around)
function resolver(entries, jsonPath) {
  const byBase = new Map();
  for (const k of entries.keys()) if (!byBase.has(base(k).toLowerCase())) byBase.set(base(k).toLowerCase(), k);
  return (p) => {
    if (!p) return null;
    const cands = [dir(jsonPath) + p, p];
    for (const c of cands) if (entries.has(c)) return new Blob([entries.get(c)], { type: typeOf(c) });
    const k = byBase.get(base(p).toLowerCase());
    return k ? new Blob([entries.get(k)], { type: typeOf(k) }) : null;
  };
}

// any of the supported JSON layouts -> { image, frames: [{ file? | x,y,w,h, duration, sounds? }], fps }
export function parseFrameJson(json) {
  if (!json || typeof json !== "object") return null;
  const image = json.image || json.sheet || (json.meta && json.meta.image) || null;
  let list = json.frames;
  if (list && !Array.isArray(list)) {
    // Aseprite "hash" / TexturePacker: { "name 0.png": { frame: {...}, duration } }
    list = Object.entries(list)
      .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
      .map(([, v]) => v);
  }
  if (!Array.isArray(list) || !list.length) return null;
  const frames = list.map((f) => {
    const r = f.frame || f;
    return { file: f.file || null, x: r.x, y: r.y, w: r.w, h: r.h, duration: f.duration || null, sounds: f.sounds || null };
  });
  if (!frames.every((f) => f.file || (f.w > 0 && f.h > 0))) return null;
  return { image, frames, fps: json.fps || null };
}

// spec (from parseFrameJson) -> [{ canvas, duration, name, sounds }]
export async function framesFromSpec(spec, get, label) {
  const sheets = new Map();
  const sheetFor = async (p) => {
    if (!sheets.has(p)) {
      const b = get(p);
      if (!b) throw new Error("找不到 JSON 里引用的图片：" + p);
      sheets.set(p, await blobToCanvas(b));
    }
    return sheets.get(p);
  };
  const out = [];
  for (const [k, f] of spec.frames.entries()) {
    let canvas;
    if (f.file) {
      const b = get(f.file);
      if (!b) throw new Error("找不到帧图片：" + f.file);
      canvas = await blobToCanvas(b);
    } else {
      const sheet = await sheetFor(spec.image);
      canvas = createCanvas(f.w, f.h);
      canvas.getContext("2d").drawImage(sheet, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);
    }
    out.push({ canvas, duration: f.duration, name: (label || "帧") + " #" + (k + 1), sounds: f.sounds });
  }
  return out;
}

export async function readZipFile(file) {
  return readZip(await file.arrayBuffer());
}

export function findFrameJson(entries) {
  for (const [k, v] of entries) {
    if (!/\.json$/i.test(k)) continue;
    try {
      const spec = parseFrameJson(JSON.parse(text(v)));
      if (spec) return { path: k, spec };
    } catch { /* not ours */ }
  }
  return null;
}

// character.json package -> animation cards + a character card
export async function importCharacterPackage(app, entries, at) {
  const json = JSON.parse(text(entries.get("character.json")));
  const get = resolver(entries, "character.json");
  const fw = json.frameSize.w, fh = json.frameSize.h;
  const soundAssets = new Map();
  const soundFor = async (path) => {
    if (!soundAssets.has(path)) {
      const b = get(path);
      soundAssets.set(path, b ? await putBlobAsset(app.store.projectId, b) : null);
    }
    return soundAssets.get(path);
  };

  const size0 = app.imageCardSize(fw, fh);
  const size = { w: Math.max(240, size0.w), h: size0.h + 10 };
  const progress = app.toast("正在导入角色包…");
  const anims = [];
  let y = at.y;
  for (const [n, an] of (json.animations || []).entries()) {
    progress.textContent = "正在导入动画 " + (n + 1) + " / " + json.animations.length + "：" + an.name;
    const spec = parseFrameJson({ ...an, image: an.sheet });
    if (!spec) continue;
    const frames = await framesFromSpec(spec, get, an.name);
    const assets = [];
    for (const f of frames) assets.push(await putCanvasAsset(app.store.projectId, f.canvas));
    const spot = app.freeSpot(at.x, y, size.w, size.h);
    const id = app.addCard("animation", spot.x, spot.y, {
      w: fw, h: fh, fps: 12,
      layers: [{ id: "L1", name: "图层 1", visible: true, opacity: 100 }],
      frames: frames.map((f, k) => ({ id: "F" + (k + 1), duration: f.duration || null, cels: { L1: assets[k] } })),
      palette: [],
    }, { size, title: an.name, select: false });
    y = spot.y + size.h + 24;
    const a = newAnim(uid("A"), an.name, { card: id });
    // the exported frames already contain every offset and effect: the only
    // thing to restore is where the shared origin sits on them
    a.pivot = { x: json.origin.x, y: json.origin.y };
    a.loop = an.loop !== false;
    for (const [k, f] of frames.entries()) {
      if (!f.sounds || !f.sounds.length) continue;
      const list = [];
      for (const s of f.sounds) {
        const asset = await soundFor(s.file);
        if (asset) list.push({ asset, name: s.name || base(s.file), volume: s.volume ?? 100 });
      }
      if (list.length) a.sounds[k] = list;
    }
    anims.push(a);
  }
  progress.remove();
  const def = defaultCharacter();
  const spot = app.freeSpot(at.x + size.w + 80, at.y, 280, 320);
  const charId = app.addCard("character", spot.x, spot.y, { ...def, anims }, { title: json.name || "角色", select: true });
  app.toast("已导入角色「" + (json.name || "角色") + "」：" + anims.length + " 组动画" + (soundAssets.size ? "、" + soundAssets.size + " 个音效" : "") + "。", "ok");
  return charId;
}
