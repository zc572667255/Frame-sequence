// Importing frame sequences: several images, a folder, or an animated GIF / WebP /
// APNG, turned into one animation card.
import { el, createCanvas, blobToCanvas, clamp } from "../core/util.js";
import { openModal } from "./modal.js";

const MAX_FRAMES = 1000;
const IMAGE_EXT = /\.(png|apng|gif|webp|jpe?g|bmp)$/i;
const TYPE_BY_EXT = { png: "image/png", apng: "image/apng", gif: "image/gif", webp: "image/webp", jpg: "image/jpeg", jpeg: "image/jpeg", bmp: "image/bmp" };

export const isImageFile = (f) => (f.type && f.type.startsWith("image/")) || IMAGE_EXT.test(f.name || "");

// "walk_2.png" before "walk_10.png"
export function naturalSort(files) {
  return [...files].sort((a, b) => (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name, undefined, { numeric: true, sensitivity: "base" }));
}

// Files from a drop, including the contents of dropped folders (recursively).
// The entries must be taken synchronously inside the drop event; reading them
// happens afterwards.
export function entriesFromDrop(dt) {
  const items = [...(dt.items || [])];
  const entries = items.map((i) => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null)).filter(Boolean);
  if (!entries.length || !entries.some((e) => e.isDirectory)) return null;
  return entries;
}

export async function filesFromEntries(entries) {
  const out = [];
  const walk = async (entry, prefix) => {
    if (entry.isFile) {
      const f = await new Promise((res, rej) => entry.file(res, rej));
      Object.defineProperty(f, "webkitRelativePath", { value: prefix + f.name });
      out.push(f);
      return;
    }
    const reader = entry.createReader();
    for (;;) {
      // readEntries returns at most ~100 entries per call
      const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
      if (!batch.length) break;
      for (const e of batch) await walk(e, prefix + entry.name + "/");
    }
  };
  for (const e of entries) await walk(e, "");
  return out;
}

function typeOf(file) {
  if (file.type) return file.type;
  const m = /\.([a-z0-9]+)$/i.exec(file.name || "");
  return m ? TYPE_BY_EXT[m[1].toLowerCase()] || "" : "";
}

// every frame of an animated image, fully composited, with its duration (ms);
// null for a still image or where the browser can't decode animations
export async function decodeAnimated(file) {
  if (typeof ImageDecoder === "undefined") return null;
  const type = typeOf(file);
  if (!/^image\/(gif|webp|png|apng)$/.test(type)) return null;
  try {
    if (!(await ImageDecoder.isTypeSupported(type))) return null;
    const dec = new ImageDecoder({ data: await file.arrayBuffer(), type });
    await dec.tracks.ready;
    const n = dec.tracks.selectedTrack ? dec.tracks.selectedTrack.frameCount : 1;
    if (n <= 1) { dec.close(); return null; }
    const frames = [];
    for (let i = 0; i < Math.min(n, MAX_FRAMES); i++) {
      const { image } = await dec.decode({ frameIndex: i });
      const c = createCanvas(image.displayWidth, image.displayHeight);
      c.getContext("2d").drawImage(image, 0, 0);
      frames.push({ canvas: c, duration: image.duration ? Math.round(image.duration / 1000) : null, name: file.name + " #" + (i + 1) });
      image.close();
    }
    dec.close();
    return frames;
  } catch {
    return null;
  }
}

// files -> [{ canvas, duration, name }] in order; animated files expand in place
export async function decodeFiles(files, onProgress) {
  const out = [];
  let i = 0;
  for (const f of files) {
    onProgress && onProgress(++i, files.length);
    const anim = await decodeAnimated(f);
    if (anim) out.push(...anim);
    else out.push({ canvas: await blobToCanvas(f), duration: null, name: f.webkitRelativePath || f.name });
    if (out.length >= MAX_FRAMES) break;
  }
  return out.slice(0, MAX_FRAMES);
}

function guessName(frames) {
  const n = (frames[0] && frames[0].name) || "序列帧";
  const base = n.split("/").pop().replace(/\.[^.]+$/, "").replace(/\s*#\d+$/, "");
  // walk_00 / walk-001 / walk 3 -> walk
  return base.replace(/[\s_\-.]*\d+$/, "") || base || "序列帧";
}

// Ask how to build the animation. Resolves { name, fps, keepDurations, reverse,
// anchor } or null when cancelled.
export function importDialog(frames) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const sizes = new Set(frames.map((f) => f.canvas.width + "×" + f.canvas.height));
    const W = Math.max(...frames.map((f) => f.canvas.width)), H = Math.max(...frames.map((f) => f.canvas.height));
    const timed = frames.filter((f) => f.duration).map((f) => f.duration);
    const avg = timed.length ? timed.reduce((a, b) => a + b, 0) / timed.length : 0;

    const name = el("input", { type: "text", value: guessName(frames) });
    const fps = el("input", { type: "number", class: "mono", min: 1, max: 60, value: avg ? clamp(Math.round(1000 / avg), 1, 60) : 12 });
    const keep = el("input", { type: "checkbox", checked: timed.length > 0 });
    const reverse = el("input", { type: "checkbox" });
    let anchor = "1,2";
    const grid = el("div", { class: "anchor-grid" });
    const cells = [];
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
      const v = x + "," + y;
      const c = el("button", { type: "button", class: "anchor-cell" + (v === anchor ? " on" : ""), onclick: () => {
        anchor = v; cells.forEach((k) => k.classList.toggle("on", k === c));
      } });
      cells.push(c); grid.append(c);
    }

    const strip = el("div", { class: "filmstrip" });
    for (const f of frames.slice(0, 24)) {
      const s = Math.min(48 / f.canvas.width, 48 / f.canvas.height, 4);
      const c = el("canvas", { width: Math.max(1, Math.round(f.canvas.width * s)), height: Math.max(1, Math.round(f.canvas.height * s)) });
      const g = c.getContext("2d");
      g.imageSmoothingEnabled = false;
      g.drawImage(f.canvas, 0, 0, c.width, c.height);
      strip.append(el("div", { class: "film-cell", title: f.name }, c));
    }

    const m = openModal("导入为动画", {
      wide: true,
      onClose: () => finish(null),
      buttons: [
        { label: "取消", action: () => finish(null) },
        { label: "导入 " + frames.length + " 帧", primary: true, action: () => finish({
          name: name.value.trim() || "序列帧",
          fps: clamp(Math.round(+fps.value) || 12, 1, 60),
          keepDurations: keep.checked && timed.length > 0,
          reverse: reverse.checked,
          anchor,
        }) },
      ],
    });
    m.body.append(
      el("div", { class: "f-readout mono" },
        el("span", null, el("span", { class: "k" }, "帧数"), el("span", { class: "v" }, String(frames.length) + (frames.length >= MAX_FRAMES ? "（已到上限）" : ""))),
        el("span", null, el("span", { class: "k" }, "尺寸"), el("span", { class: "v" }, sizes.size === 1 ? W + " × " + H : "不一致，统一为 " + W + " × " + H)),
        el("span", { class: "span2" }, el("span", { class: "k" }, "顺序"), el("span", { class: "v" }, frames[0].name + "  →  " + frames[frames.length - 1].name)),
      ),
      strip,
      el("label", { class: "f-field" }, el("span", { class: "f-label" }, "动画名称"), name),
      el("div", { class: "f-pair" },
        el("label", { class: "f-field" }, el("span", { class: "f-label" }, "帧率 fps"), fps),
        el("div", { class: "f-field" },
          timed.length ? el("label", { class: "f-check" }, keep, el("span", null, "保留动图里的逐帧时长")) : null,
          el("label", { class: "f-check" }, reverse, el("span", null, "反转顺序")))),
      sizes.size > 1
        ? el("div", { class: "f-field" }, el("span", { class: "f-label" }, "各帧尺寸不一致：小的帧放在画布的哪里"), grid)
        : null,
      el("p", { class: "f-hint" }, "按文件名里的数字排序（2 在 10 前面）。导入后得到一张「动画」卡片：可以接去背景、完美像素、调色、对齐、画框调整等节点处理，也可以双击进像素编辑器修改。"),
    );
    name.focus();
    name.select();
  });
}

// place each frame on a shared W×H canvas by anchor
export function normalizeFrames(frames, anchor) {
  const W = Math.max(...frames.map((f) => f.canvas.width)), H = Math.max(...frames.map((f) => f.canvas.height));
  const [ax, ay] = anchor.split(",").map(Number);
  const pos = (size, len, a) => (a === 0 ? 0 : a === 2 ? size - len : Math.round((size - len) / 2));
  return {
    w: W, h: H,
    frames: frames.map((f) => {
      if (f.canvas.width === W && f.canvas.height === H) return f;
      const c = createCanvas(W, H);
      c.getContext("2d").drawImage(f.canvas, pos(W, f.canvas.width, ax), pos(H, f.canvas.height, ay));
      return { ...f, canvas: c };
    }),
  };
}

// ---------- one image holding many frames (a sprite sheet) ----------
// Shows the sheet with the detected grid, lets the size / margins be corrected,
// and resolves the cut frames ([{ canvas, duration, name }]) or null.
export function sheetDialog(sheet, baseName) {
  return import("../imaging/slice.js").then(({ computeGrid, cutFrames, guessFrameSize }) => new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const W = sheet.width, H = sheet.height;
    const data = sheet.getContext("2d").getImageData(0, 0, W, H);
    const guess = guessFrameSize(data);
    const g = { fw: guess.fw, fh: guess.fh, mx: 0, my: 0, sx: 0, sy: 0 };

    const preview = el("canvas", { class: "sheet-preview" });
    const readout = el("div", { class: "f-status" });
    const skip = el("input", { type: "checkbox", checked: true });
    const inputs = {};
    const num = (key, label) => {
      const i = el("input", { type: "number", class: "mono", min: key === "fw" || key === "fh" ? 1 : 0, value: g[key] });
      i.addEventListener("input", () => { const v = Math.round(+i.value); if (v >= 0) { g[key] = v; draw(); } });
      inputs[key] = i;
      return el("label", { class: "f-field" }, el("span", { class: "f-label" }, label), i);
    };
    const quick = (cols, rows) => {
      g.fw = Math.floor(W / cols); g.fh = Math.floor(H / rows); g.mx = g.my = g.sx = g.sy = 0;
      for (const k in inputs) inputs[k].value = g[k];
      draw();
    };
    const colsIn = el("input", { type: "number", class: "mono", min: 1, value: guess.cols });
    const rowsIn = el("input", { type: "number", class: "mono", min: 1, value: guess.rows });
    const applyCR = () => { const c = Math.max(1, Math.round(+colsIn.value)), r = Math.max(1, Math.round(+rowsIn.value)); quick(c, r); };
    colsIn.addEventListener("input", applyCR);
    rowsIn.addEventListener("input", applyCR);

    // fit the sheet into the dialog; grid lines drawn at screen resolution
    const draw = () => {
      const maxW = 700, maxH = 280;
      const s = Math.min(maxW / W, maxH / H, 8);
      preview.width = Math.max(1, Math.round(W * s));
      preview.height = Math.max(1, Math.round(H * s));
      const c = preview.getContext("2d");
      c.imageSmoothingEnabled = s < 1;
      c.drawImage(sheet, 0, 0, preview.width, preview.height);
      const grid = computeGrid(W, H, g);
      if (grid.tooMany) { readout.textContent = "格子太多（" + grid.total + "），请调大单帧尺寸。"; readout.dataset.tone = "error"; return; }
      c.strokeStyle = "rgba(242, 165, 65, 0.95)";
      c.setLineDash([4, 3]);
      for (const cell of grid.cells) c.strokeRect(cell.x * s + 0.5, cell.y * s + 0.5, grid.fw * s - 1, grid.fh * s - 1);
      readout.textContent = W + " × " + H + " → " + grid.cols + " 列 × " + grid.rows + " 行 = " + grid.total + " 帧，单帧 " + grid.fw + " × " + grid.fh;
      readout.dataset.tone = "";
    };

    const m = openModal("切成动画", {
      wide: true,
      onClose: () => finish(null),
      buttons: [
        { label: "取消", action: () => finish(null) },
        { label: "下一步", primary: true, action: () => {
          const grid = computeGrid(W, H, g);
          if (grid.tooMany || !grid.cells.length) return false;
          let frames = cutFrames(sheet, grid.cells, grid.fw, grid.fh).map((canvas, i) => ({ canvas, duration: null, name: (baseName || "序列帧") + " #" + (i + 1) }));
          if (skip.checked) {
            const kept = frames.filter((f) => {
              const d = f.canvas.getContext("2d").getImageData(0, 0, f.canvas.width, f.canvas.height).data;
              for (let i = 3; i < d.length; i += 4) if (d[i] > 8) return true;
              return false;
            });
            if (kept.length) frames = kept;
          }
          finish(frames);
        } },
      ],
    });
    m.body.append(
      el("div", { class: "sheet-preview-wrap" }, preview),
      readout,
      el("div", { class: "f-pair" },
        el("label", { class: "f-field" }, el("span", { class: "f-label" }, "列数"), colsIn),
        el("label", { class: "f-field" }, el("span", { class: "f-label" }, "行数"), rowsIn),
        num("fw", "单帧宽"), num("fh", "单帧高")),
      el("details", { class: "f-section" }, el("summary", { class: "f-section-title" }, "边距与间距（格子之间有空隙时）"),
        el("div", { class: "f-pair" }, num("mx", "起始边距 X"), num("my", "起始边距 Y"), num("sx", "帧间距 X"), num("sy", "帧间距 Y"))),
      el("label", { class: "f-check" }, skip, el("span", null, "去掉全透明的空帧（比如最后一行没排满）")),
      el("p", { class: "f-hint" }, "已自动识别网格；不对的话改列数 / 行数，或直接改单帧尺寸。按从左到右、从上到下的顺序排帧。"),
    );
    draw();
  }));
}
