// Character output: a zip package (per-animation sheets or PNG sequences plus
// character.json and the sound files), or one animation baked back into an
// animation card. Everything is rendered on the character's shared canvas, so
// every animation has the same size and the origin at the same pixel.
import { canvasToBlob, createCanvas } from "../core/util.js";
import { putCanvasAsset, assetUrl } from "../core/assets.js";
import { makeZip } from "../imaging/zip.js";
import { timeline, exportCanvas, renderExportFrame } from "./model.js";
import { sheetGrid } from "../nodes/exporters.js";

export const PACKAGE_VERSION = 1;

const safe = (s) => String(s || "anim").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim() || "anim";
const enc = new TextEncoder();

export async function exportCharacterZip(app, char, sources, name) {
  const canvas = exportCanvas(char, sources);
  const opts = char.export;
  const files = [];
  const soundFiles = new Map(); // asset id -> path in zip
  const used = new Set();
  const uniqueName = (base) => {
    let n = safe(base), k = 2;
    while (used.has(n)) n = safe(base) + "_" + k++;
    used.add(n);
    return n;
  };

  const anims = [];
  for (const a of char.anims) {
    const src = sources.get(a.source && a.source.card);
    const tl = timeline(a, src);
    if (!tl.length) continue;
    const base = uniqueName(a.name);
    const frames = tl.map((e) => ({ ...e, canvas: renderExportFrame(char, a, e.i, sources, canvas) }));
    const sound = (i) => ((a.sounds && a.sounds[i]) || []).map((s) => {
      if (!soundFiles.has(s.asset)) soundFiles.set(s.asset, "sounds/" + s.asset);
      return { file: soundFiles.get(s.asset), name: s.name, volume: s.volume ?? 100 };
    });

    const entry = { name: a.name, loop: a.loop !== false, frames: [] };
    if (opts.format === "png") {
      const pad = Math.max(2, String(frames.length - 1).length);
      for (const [k, f] of frames.entries()) {
        const path = base + "/" + base + "_" + String(k).padStart(pad, "0") + ".png";
        files.push({ name: path, data: new Uint8Array(await (await canvasToBlob(f.canvas)).arrayBuffer()) });
        entry.frames.push({ file: path, source: f.i, duration: f.duration, sounds: sound(f.i) });
      }
    } else {
      const { cols: perRow, rows } = sheetGrid(frames.length, opts);
      const sheet = createCanvas(canvas.w * perRow, canvas.h * rows);
      const g = sheet.getContext("2d");
      frames.forEach((f, k) => g.drawImage(f.canvas, (k % perRow) * canvas.w, Math.floor(k / perRow) * canvas.h));
      const path = base + ".png";
      files.push({ name: path, data: new Uint8Array(await (await canvasToBlob(sheet)).arrayBuffer()) });
      entry.sheet = path;
      entry.columns = perRow;
      entry.rows = rows;
      entry.frames = frames.map((f, k) => ({
        x: (k % perRow) * canvas.w, y: Math.floor(k / perRow) * canvas.h, w: canvas.w, h: canvas.h,
        source: f.i, duration: f.duration, sounds: sound(f.i),
      }));
    }
    anims.push(entry);
  }

  for (const [asset, path] of soundFiles) {
    const res = await fetch(assetUrl(app.store.projectId, asset));
    if (res.ok) files.push({ name: path, data: new Uint8Array(await res.arrayBuffer()) });
  }

  const json = {
    generator: "光台 · 序列帧工作室",
    type: "character",
    version: PACKAGE_VERSION,
    name,
    // every frame image is frameSize; the character's origin (feet) is at `origin`
    frameSize: { w: canvas.w, h: canvas.h },
    origin: { x: canvas.ox, y: canvas.oy },
    animations: anims,
  };
  files.push({ name: "character.json", data: enc.encode(JSON.stringify(json, null, 2)) });
  return makeZip(files);
}

// One animation, with its offsets and timing applied, as an animation card
// next to the character card.
export async function bakeAnimation(app, charCardId, char, anim, sources) {
  const src = sources.get(anim.source && anim.source.card);
  const tl = timeline(anim, src);
  if (!tl.length) { app.toast("这组动画没有可用的帧。", "warn"); return null; }
  const canvas = exportCanvas(char, sources);
  const t = app.toast("正在烘焙 " + tl.length + " 帧…");
  const assets = [];
  for (const e of tl) assets.push(await putCanvasAsset(app.store.projectId, renderExportFrame(char, anim, e.i, sources, canvas)));
  t.remove();
  const card = app.store.cards[charCardId];
  const s = app.imageCardSize(canvas.w, canvas.h);
  const size = { w: Math.max(240, s.w), h: s.h + 10 };
  const at = app.freeSpot(card.x + card.w + 80, card.y, size.w, size.h);
  const id = app.addCard("animation", at.x, at.y, {
    w: canvas.w, h: canvas.h, fps: anim.fps || src.fps || 12,
    layers: [{ id: "L1", name: "图层 1", visible: true, opacity: 100 }],
    frames: tl.map((e, k) => ({ id: "F" + (k + 1), duration: e.duration, cels: { L1: assets[k] } })),
    palette: [],
  }, { size, title: (card.title || "角色") + " · " + anim.name, select: false });
  app.toast("已烘焙为动画卡片「" + anim.name + "」，在画布上角色卡片旁边。", "ok");
  return id;
}
