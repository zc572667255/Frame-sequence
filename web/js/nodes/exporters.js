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

// max: a preview no bigger than that on its longer side (the same layout, all
// of it scaled down) — a whole scene's frames side by side would be a picture
// too big for the browser to draw quickly, or at all
export function renderSheet(v, p, max = 0) {
  const s = outputSize(p, v);
  const n = v.frames.length;
  const { cols: perRow, rows } = sheetGrid(n, p);
  const k = max ? Math.min(1, max / Math.max(s.w * perRow, s.h * rows)) : 1;
  const sheet = createCanvas(Math.max(1, Math.round(s.w * perRow * k)), Math.max(1, Math.round(s.h * rows * k)));
  const ctx = sheet.getContext("2d");
  ctx.imageSmoothingEnabled = p.smooth === true || k < 1;
  if (k < 1) ctx.scale(k, k);
  v.frames.forEach((f, i) => {
    drawFrameInto(ctx, f.canvas, (i % perRow) * s.w, Math.floor(i / perRow) * s.h, s.w, s.h, p.mode, p.anchor);
  });
  return { sheet, perRow, rows, w: s.w, h: s.h };
}

export function frameDurations(v, fps) {
  const fallback = 1000 / Math.max(1, fps || 12);
  return v.frames.map((f) => Math.round(f.duration || fallback));
}

// How much of what is drawn is see-through (glows, soft fades): the share of
// visible pixels with partial alpha, sampled over up to 8 frames. GIF only has
// on/off transparency, so a high share means the GIF will look rough.
export function softAlphaShare(v) {
  const n = v.frames.length, step = Math.max(1, Math.floor(n / 8));
  let soft = 0, seen = 0;
  for (let i = 0; i < n; i += step) {
    const c = v.frames[i].canvas;
    const d = c.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data;
    const stride = Math.max(4, Math.floor(d.length / 4 / 40000)) * 4;   // at most ~40k samples a frame
    for (let k = 3; k < d.length; k += stride) {
      const a = d[k];
      if (!a) continue;
      seen++;
      if (a < 250) soft++;
    }
  }
  return seen ? soft / seen : 0;
}

// p.gifMatte: a colour (#rrggbb) to lay every frame on before it becomes a GIF,
// so see-through parts blend into it instead of breaking up; null keeps
// transparency
// The frames are read here (a breath between them now and then); their colours
// picked and the file put together in a worker (imaging/gifworker.js), so a
// big GIF doesn't freeze the page — or here when there are no workers.
export async function exportGif(v, p) {
  const s = outputSize(p, v);
  const durs = frameDurations(v, p.fps);
  const frames = [];
  let t0 = performance.now();
  for (let i = 0; i < v.frames.length; i++) {
    let c = renderFrame(v, i, p);
    if (p.gifMatte) {
      const m = createCanvas(s.w, s.h), mg = m.getContext("2d");
      mg.fillStyle = p.gifMatte;
      mg.fillRect(0, 0, s.w, s.h);
      mg.drawImage(c, 0, 0);
      c = m;
    }
    frames.push({ data: c.getContext("2d").getImageData(0, 0, s.w, s.h).data.buffer, delayCs: Math.max(1, Math.round(durs[i] / 10)) });
    if (performance.now() - t0 > 30) { await new Promise((r) => setTimeout(r, 0)); t0 = performance.now(); }
  }
  const bytes = (await gifInWorker(s.w, s.h, frames)) || encodeGIF({
    width: s.w, height: s.h, loop: 0,
    frames: frames.map((f) => ({ ...quantizeFrame({ data: new Uint8ClampedArray(f.data), width: s.w, height: s.h }), delayCs: f.delayCs })),
  });
  return new Blob([bytes], { type: "image/gif" });
}

// the GIF's bytes made by workers — the frames' colours picked by a few at
// once, the file put together by one — or null when they can't be had
async function gifInWorker(width, height, frames) {
  const n = Math.max(1, Math.min(4, ((typeof navigator !== "undefined" && navigator.hardwareConcurrency) || 2) - 1, frames.length));
  const pool = [];
  try {
    for (let i = 0; i < n; i++) pool.push(new Worker(new URL("../imaging/gifworker.js", import.meta.url), { type: "module" }));
  } catch { for (const w of pool) w.terminate(); return null; }
  const ask = (wk, msg) => new Promise((resolve) => {
    wk.onmessage = (e) => resolve(e.data && !e.data.error ? e.data : null);
    wk.onerror = () => resolve(null);
    wk.postMessage(msg);
  });
  try {
    // (copied, not handed over: should a worker fail, they are made here)
    const per = Math.ceil(frames.length / n);
    const parts = await Promise.all(pool.map((wk, i) => ask(wk, { op: "quantize", width, height, frames: frames.slice(i * per, (i + 1) * per) })));
    if (parts.some((r) => !r)) return null;
    const r = await ask(pool[0], { op: "encode", width, height, frames: parts.flatMap((x) => x.frames) });
    return r ? r.bytes : null;
  } finally {
    for (const w of pool) w.terminate();
  }
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
