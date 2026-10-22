// 残影: a layer that repeats the last few frames of other layers behind the
// current one, each fainter than the one after it — the afterimage of a dash or
// a fast swing. A ghost layer is a layer with a `ghost` settings object and no
// cels of its own; it is drawn at its place in the stack (usually under the
// character), from the layers it copies (all pixel layers, or one), on the
// frames picked for it.
import { createCanvas } from "../core/util.js";
import { BAYER } from "./glow/finish.js";

export const GHOST_DEFAULTS = {
  source: "all",     // "all" pixel layers, or one layer id
  count: 3,          // how many afterimages
  spacing: 1,        // frames between two of them
  fade: 60,          // opacity of the nearest one, %; the farthest is fade / count
  tint: "color",     // "color" silhouette | "mix" colour over the picture | "none" as drawn
  mix: 60,           // "mix": how much of the colour, %
  color: "#58c8ff",  // nearest ghost …
  color2: "#7a5cff", // … to the farthest
  alpha: "soft",     // "soft" translucent | "dither" solid pixels in a checker pattern (pixel art)
  blend: "normal",   // "normal" | "add" (glowing)
  dx: 0, dy: 0,      // extra shift per step, px: for animations that run in place
  loop: false,       // the first frames take their ghosts from the end
  frames: null,      // ids of the frames that show ghosts; null = every frame
};

export const ghostSettings = (l) => ({ ...GHOST_DEFAULTS, ...((l && l.ghost) || {}) });

// the layers a ghost layer copies: visible pixel layers (never trails, effects or other ghosts)
export function ghostSources(layers, gl) {
  const s = ghostSettings(gl);
  return layers.filter((l) => !l.trail && !l.ghost && !l.vfx && l.visible !== false && (s.source === "all" || l.id === s.source));
}

const hexRgb = (h) => { const n = parseInt(String(h).slice(1), 16) || 0; return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
const mixHex = (a, b, t) => { const p = hexRgb(a), q = hexRgb(b); return "rgb(" + p.map((v, i) => Math.round(v + (q[i] - v) * t)).join(",") + ")"; };

// does the ghost layer show on this frame (by id)?
export const ghostOn = (s, frameId) => !Array.isArray(s.frames) || s.frames.includes(frameId);

// the source frame of the k-th ghost of frame fi, or -1
export function ghostFrame(s, fi, k, n) {
  let j = fi - k * Math.max(1, s.spacing | 0);
  if (s.loop) j = ((j % n) + n) % n;
  return j < 0 || j === fi ? -1 : j;
}

// Rendered ghosts for one frame. The editor redraws on every pointer move, so
// when the caller can name what a cel looks like (celKey(layer, frame)) the
// result is kept until one of the copied cels or the settings change.
const cache = new Map();
const CACHE_MAX = 48;

// the ghosts of frame fi (frameIds: the animation's frame order, w×h) as a
// canvas, or null when there are none — also on frames the layer is off for.
// drawCelAt(layer, frame, g) draws one layer's cel of another frame into g.
export function renderGhost(gl, layers, frameIds, fi, w, h, drawCelAt, celKey) {
  const s = ghostSettings(gl);
  if (!ghostOn(s, frameIds[fi])) return null;
  const n = frameIds.length;
  const src = ghostSources(layers, gl);
  const count = Math.max(1, Math.min(12, s.count | 0));
  const steps = [];
  for (let k = count; k >= 1; k--) { const j = ghostFrame(s, fi, k, n); if (j >= 0) steps.push([k, j]); }
  if (!src.length || !steps.length) return null;
  let key = null;
  if (celKey) {
    key = JSON.stringify([{ ...s, frames: null }, w, h, steps, src.map((l) => [l.id, l.opacity ?? 100, ...steps.map(([, j]) => celKey(l, j))])]);
    if (cache.has(key)) { const v = cache.get(key); cache.delete(key); cache.set(key, v); return v; }
  }
  const out = createCanvas(w, h), g = out.getContext("2d");
  const tmp = createCanvas(w, h), tg = tmp.getContext("2d", { willReadFrequently: s.alpha === "dither" });
  for (const [k, j] of steps) {
    tg.globalCompositeOperation = "source-over";
    tg.clearRect(0, 0, w, h);
    for (const l of src) { tg.globalAlpha = (l.opacity ?? 100) / 100; drawCelAt(l, j, tg); }
    tg.globalAlpha = 1;
    // nearest (k = 1) in the first colour, the farthest in the second
    const t = count > 1 ? (k - 1) / (count - 1) : 0;
    if (s.tint !== "none") {
      tg.globalCompositeOperation = s.tint === "mix" ? "source-atop" : "source-in";
      tg.globalAlpha = s.tint === "mix" ? Math.max(0, Math.min(1, s.mix / 100)) : 1;
      tg.fillStyle = mixHex(s.color, s.color2 || s.color, t);
      tg.fillRect(0, 0, w, h);
      tg.globalAlpha = 1;
      tg.globalCompositeOperation = "source-over";
    }
    const a = Math.max(0, Math.min(1, s.fade / 100)) * (count - k + 1) / count;
    const ox = Math.round((s.dx || 0) * k), oy = Math.round((s.dy || 0) * k);
    if (s.alpha === "dither") {
      // pixel art: no half-transparent pixels — a pixel is kept or dropped by a
      // 4×4 Bayer pattern, so a fainter ghost is a sparser one
      const img = tg.getImageData(0, 0, w, h), d = img.data;
      for (let y = 0, i = 3; y < h; y++) for (let x = 0; x < w; x++, i += 4) {
        if (d[i] && d[i] / 255 * a <= (BAYER[((y + oy) & 3) * 4 + ((x + ox) & 3)] + 0.5) / 16) d[i] = 0;
      }
      tg.putImageData(img, 0, 0);
      g.globalAlpha = 1;
    } else g.globalAlpha = a;
    g.drawImage(tmp, ox, oy);
  }
  g.globalAlpha = 1;
  if (key) {
    cache.set(key, out);
    while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  }
  return out;
}

// draw a ghost layer's rendering into g with its blend mode
export function drawGhostCanvas(g, gl, c, ox = 0, oy = 0, w, h) {
  if (!c) return;
  const op = g.globalCompositeOperation;
  if (ghostSettings(gl).blend === "add") g.globalCompositeOperation = "lighter";
  if (w == null) g.drawImage(c, ox, oy); else g.drawImage(c, ox, oy, w, h);
  g.globalCompositeOperation = op;
}
