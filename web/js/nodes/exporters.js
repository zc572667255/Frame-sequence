// Turning a frames value into files.
import { createCanvas, canvasToBlob } from "../core/util.js";
import { drawFrameInto } from "../imaging/output.js";
import { quantizeFrame, encodeGIF } from "../imaging/gif.js";
import { makeZip } from "../imaging/zip.js";
import { encodeAnimatedWebP } from "../imaging/webp.js";

// p: export node params; v: frames value -> { w, h, perRow }
export function outputSize(p, v) {
  if (!p.custom) return { w: v.w, h: v.h };
  const w = p.w > 0 ? p.w : v.w, h = p.h > 0 ? p.h : v.h;
  return { w: Math.min(w, 8192), h: Math.min(h, 8192) };
}

export function renderFrame(v, i, p) {
  const s = outputSize(p, v);
  const c = createCanvas(s.w, s.h);
  const ctx = c.getContext("2d");
  ctx.imageSmoothingEnabled = p.smooth === true;
  drawFrameInto(ctx, v.frames[i].canvas, 0, 0, s.w, s.h, p.mode, p.anchor);
  return c;
}

// How a sheet of n frames is laid out. p.layout: "row" (one row), "column" (one
// column), "square" (as close to square as it gets) or "cols" (p.perRow columns).
// Older params only have perRow: 0 meant one row.
export const SHEET_LAYOUTS = [["row", "一行"], ["column", "一列"], ["square", "接近正方形"], ["cols", "自定列数"]];
export function sheetGrid(n, p) {
  const layout = p.layout || (p.perRow > 0 ? "cols" : "row");
  const want = layout === "column" ? 1 : layout === "square" ? Math.ceil(Math.sqrt(n)) : layout === "cols" ? p.perRow | 0 : n;
  const cols = Math.max(1, Math.min(want || 1, Math.max(1, n)));
  return { layout, cols, rows: Math.ceil(n / cols) };
}

export function renderSheet(v, p) {
  const s = outputSize(p, v);
  const n = v.frames.length;
  const { cols: perRow, rows } = sheetGrid(n, p);
  const sheet = createCanvas(s.w * perRow, s.h * rows);
  const ctx = sheet.getContext("2d");
  ctx.imageSmoothingEnabled = p.smooth === true;
  v.frames.forEach((f, i) => {
    drawFrameInto(ctx, f.canvas, (i % perRow) * s.w, Math.floor(i / perRow) * s.h, s.w, s.h, p.mode, p.anchor);
  });
  return { sheet, perRow, rows, w: s.w, h: s.h };
}

export function frameDurations(v, fps) {
  const fallback = 1000 / Math.max(1, fps || 12);
  return v.frames.map((f) => Math.round(f.duration || fallback));
}

export function exportGif(v, p) {
  const s = outputSize(p, v);
  const durs = frameDurations(v, p.fps);
  const frames = v.frames.map((_f, i) => {
    const c = renderFrame(v, i, p);
    const q = quantizeFrame(c.getContext("2d").getImageData(0, 0, s.w, s.h));
    q.delayCs = Math.max(1, Math.round(durs[i] / 10));
    return q;
  });
  const bytes = encodeGIF({ width: s.w, height: s.h, frames, loop: 0 });
  return new Blob([bytes], { type: "image/gif" });
}

// Animated WebP: full colour and 8-bit alpha, millisecond timing; quality 1 = lossless
export function exportWebp(v, p) {
  const s = outputSize(p, v);
  const durs = frameDurations(v, p.fps);
  const frames = v.frames.map((_f, i) => ({ canvas: renderFrame(v, i, p), duration: durs[i] }));
  return encodeAnimatedWebP(frames, { width: s.w, height: s.h, quality: p.webpQuality ?? 1, loop: 0 });
}

// Sprite sheet PNG plus a JSON description (frame rects and durations) that
// engines and the studio itself can read back.
export async function exportSheet(v, p) {
  const r = renderSheet(v, p);
  const durs = frameDurations(v, p.fps);
  const json = {
    generator: "光台 · 序列帧工作室",
    image: (p.name || "animation") + ".png",
    size: { w: r.sheet.width, h: r.sheet.height },
    frameSize: { w: r.w, h: r.h },
    columns: r.perRow,
    rows: r.rows,
    fps: p.fps || 12,
    frames: v.frames.map((f, i) => ({
      index: i,
      source: f.index ?? i,
      x: (i % r.perRow) * r.w,
      y: Math.floor(i / r.perRow) * r.h,
      w: r.w,
      h: r.h,
      duration: durs[i],
    })),
  };
  return { png: await canvasToBlob(r.sheet), json, info: r };
}

export async function exportPngZip(v, p) {
  const name = p.name || "animation";
  const files = [];
  const durs = frameDurations(v, p.fps);
  const pad = String(v.frames.length - 1).length;
  for (let i = 0; i < v.frames.length; i++) {
    const blob = await canvasToBlob(renderFrame(v, i, p));
    files.push({ name: name + "_" + String(i).padStart(Math.max(2, pad), "0") + ".png", data: new Uint8Array(await blob.arrayBuffer()) });
  }
  const s = outputSize(p, v);
  const meta = {
    generator: "光台 · 序列帧工作室",
    frameSize: s,
    fps: p.fps || 12,
    frames: files.map((f, i) => ({ file: f.name, duration: durs[i] })),
  };
  files.push({ name: name + ".json", data: new TextEncoder().encode(JSON.stringify(meta, null, 2)) });
  return makeZip(files);
}
