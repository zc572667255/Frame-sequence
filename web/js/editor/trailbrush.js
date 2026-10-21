// Trail brush (拖尾笔): drag a stroke, get a slash effect — pixel-art colour bands
// or a smooth 光效 ("glow:<id>" presets, trails/glow.js).
//
// The look is the usual hand-drawn one: bands of colour from a dark outer rim to a
// bright core, each band a tapered ribbon along the stroke. Everything is hard-
// edged — a band covers a pixel only if it covers at least half of it — and the
// tail ends in brush streaks along the stroke (or a 4×4 dither), never partial
// alpha, so the result is clean pixel art that can be touched up with the pencil.
// The bands and tail are rendered by trails/model.js, shared with attack trails.
import { hexToRgb } from "../core/util.js";
import { renderStroke } from "../trails/model.js";
import { GLOW_PRESETS, glowStyle, hashSeed, renderGlow } from "../trails/glow.js";

// bands: outer -> inner, [colour, width factor]. look: the rest of the band
// style a preset sets (see BAND_LOOK); the 弧光 styles light the blade-tip edge
// and let the grip side fade out in ragged streaks.
const ARC = { bandLayout: "edge", edgeFade: 0.55, streaks: 0.6, edgeBreak: 0.6, fadeSteps: true, bandBlend: "steps", bandShade: 0, shape: "crescent" };
export const TRAIL_PRESETS = [
  { id: "arc-ice", name: "冰蓝弧光", bands: [["#8c7fd6", 1], ["#5d8ff0", 0.62], ["#7fdcff", 0.34], ["#ffffff", 0.1]], look: ARC },
  { id: "arc-fire", name: "烈焰弧光", bands: [["#a8322e", 1], ["#f77622", 0.62], ["#feae34", 0.34], ["#fff3b0", 0.1]], look: ARC },
  { id: "arc-gold", name: "金辉弧光", bands: [["#b86f50", 1], ["#e8b04a", 0.62], ["#fee761", 0.34], ["#ffffff", 0.1]], look: ARC },
  { id: "arc-shadow", name: "暗影弧光", bands: [["#3e2050", 1], ["#7a3aa8", 0.62], ["#c070e0", 0.34], ["#ffd8ff", 0.1]], look: ARC },
  { id: "arc-wind", name: "翠风弧光", bands: [["#2a7a5a", 1], ["#3fbf7f", 0.62], ["#9ff0c0", 0.34], ["#ffffff", 0.1]], look: ARC },
  { id: "arc-spin", name: "赤红旋斩", bands: [["#8a1a2a", 1], ["#d0303a", 0.62], ["#ff8a72", 0.34], ["#ffffff", 0.14]], look: { ...ARC, splits: 2, streaks: 0.4, edgeFade: 0.7, shape: "even" } },
  { id: "arc-water", name: "水刃", bands: [["#2a5fd0", 1], ["#3ea0f0", 0.6], ["#8fe0ff", 0.32], ["#ffffff", 0.1]], look: { ...ARC, edgeFade: 0.6, streaks: 0.7, edgeBreak: 0.75 } },
  { id: "white", name: "白光", bands: [["#5a6988", 1], ["#c0cbdc", 0.72], ["#ffffff", 0.4]] },
  { id: "fire", name: "火焰", bands: [["#a22633", 1], ["#f77622", 0.75], ["#feae34", 0.5], ["#fee761", 0.25]] },
  { id: "ice", name: "冰霜", bands: [["#124e89", 1], ["#0099db", 0.72], ["#2ce8f5", 0.45], ["#ffffff", 0.18]] },
  { id: "thunder", name: "雷电", bands: [["#3b5dc9", 1], ["#41a6f6", 0.6], ["#ffffff", 0.28]] },
  { id: "shadow", name: "暗紫", bands: [["#3e2731", 1], ["#68386c", 0.75], ["#b55088", 0.45], ["#f6757a", 0.18]] },
  { id: "blood", name: "鲜血", bands: [["#3e2731", 1], ["#a22633", 0.7], ["#e43b44", 0.35]] },
  { id: "holy", name: "圣光金", bands: [["#b86f50", 1], ["#feae34", 0.72], ["#fee761", 0.45], ["#ffffff", 0.18]] },
  { id: "wind", name: "风刃", bands: [["#8b9bb4", 1], ["#ffffff", 0.45]], fade: 85 },
  { id: "mono", name: "主色", bands: null },
];

// what a band preset without its own look gets: bright middle, clean-ish edges
export const BAND_LOOK = { bandLayout: "center", edgeFade: 0, streaks: 0, edgeBreak: 0.3, fadeSteps: false, splits: 0 };

export const TRAIL_DEFAULTS = { preset: "glow:dream", width: 10, shape: "head", fade: 45, sparks: false, toFxLayer: true, tailMode: "brush", brushId: "bristle", brushData: null, bandBlend: "steps", bandSoft: 60, bandShade: 40, edgeBreak: 40 };

// ---------- stroke geometry ----------
// resample the raw pointer path at ~1px spacing, then smooth it so a shaky hand
// still gives a clean arc
function prepare(raw) {
  const pts = [];
  for (const p of raw) {
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= 0.5) pts.push({ x: p.x, y: p.y });
  }
  if (pts.length < 2) return pts;
  const out = [pts[0]];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    let d = 1 - carry;
    while (d <= len) {
      const t = d / len;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      d += 1;
    }
    carry = len - (d - 1);
  }
  out.push(pts[pts.length - 1]);
  // moving average, ends pinned
  const k = Math.min(4, Math.floor(out.length / 4));
  if (k < 1) return out;
  return out.map((p, i) => {
    if (i === 0 || i === out.length - 1) return p;
    let sx = 0, sy = 0, n = 0;
    for (let j = Math.max(0, i - k); j <= Math.min(out.length - 1, i + k); j++) { sx += out[j].x; sy += out[j].y; n++; }
    return { x: sx / n, y: sy / n };
  });
}

function profile(shape, t) {
  if (shape === "even") return 1;
  if (shape === "crescent") return Math.max(0.08, Math.pow(Math.sin(Math.PI * t), 0.7));
  return 0.12 + 0.88 * t; // head: thin tail (stroke start) -> full width at the head (stroke end)
}

// raw: pointer path in pixel coordinates (floats). Returns ImageData w×h with the
// effect painted (transparent elsewhere), or null for a too-short stroke.
export function rasterizeTrail(raw, opts, w, h, primary, brushCanvas) {
  const curve = prepare(raw);
  if (curve.length < 2) return null;
  const glow = String(opts.preset || "").startsWith("glow:") && (GLOW_PRESETS.find((p) => "glow:" + p.id === opts.preset) || GLOW_PRESETS[0]);
  const preset = TRAIL_PRESETS.find((p) => p.id === opts.preset) || TRAIL_PRESETS[0];
  const bands = preset.bands
    ? preset.bands.map(([c, f]) => [hexToRgb(c), f])
    : [[[primary[0], primary[1], primary[2]], 1]];
  const W = Math.max(1, +opts.width || 10);
  const fade = Math.max(0, Math.min(100, opts.fade ?? preset.fade ?? 45)) / 100;
  const shape = opts.shape || "head";

  // cross-sections along the stroke; the bands and the tail (brush streaks or
  // dither) are drawn exactly like the attack trail's (trails/model.js)
  const n = curve.length - 1;
  const sections = curve.map((p, k) => {
    const a = curve[Math.max(0, k - 1)], b = curve[Math.min(n, k + 1)];
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
    const u = k / n, half = Math.max(0.5, (W * profile(shape, u)) / 2);
    const nx = -dy / len * half, ny = dx / len * half;
    return { a: [p.x - nx, p.y - ny], b: [p.x + nx, p.y + ny], u };
  });
  if (glow) return glowStroke(curve, sections, glow, opts, w, h, fade);
  // edge-lit styles light the outside of the curve (where a blade tip would be):
  // if the stroke bends toward the b side, swap the sides
  const look = { ...BAND_LOOK, ...(preset.look || {}) };
  if (look.bandLayout === "edge") {
    let turn = 0;
    for (let k = 2; k < curve.length; k++) {
      const d1x = curve[k - 1].x - curve[k - 2].x, d1y = curve[k - 1].y - curve[k - 2].y;
      const d2x = curve[k].x - curve[k - 1].x, d2y = curve[k].y - curve[k - 1].y;
      turn += d1x * d2y - d1y * d2x;
    }
    if (turn > 0) for (const q of sections) [q.a, q.b] = [q.b, q.a];
  }
  const out = renderStroke(sections, {
    bands: bands.map(([c, f]) => ["#" + c.map((v) => v.toString(16).padStart(2, "0")).join(""), f]),
    fade, tailMode: opts.tailMode || "brush", pixel: true, opacity: 100,
    bandBlend: opts.bandBlend || "steps", bandSoft: (opts.bandSoft ?? 60) / 100, bandShade: (opts.bandShade ?? 40) / 100,
    bandLayout: look.bandLayout, edgeFade: look.edgeFade, streaks: look.streaks, fadeSteps: look.fadeSteps, splits: look.splits,
    edgeBreak: opts.edgeBreak != null ? opts.edgeBreak / 100 : look.edgeBreak,
  }, w, h, brushCanvas);
  if (!out) return null;
  const od = out.data;

  if (opts.sparks) {
    // a few loose pixels around the head in the brightest colour
    const bright = bands[bands.length - 1][0];
    let seed = Math.round(curve[0].x * 131 + curve[0].y * 977 + curve.length * 17);
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const n = Math.max(3, Math.round(curve.length / 6));
    for (let s = 0; s < n; s++) {
      const k = Math.floor(curve.length * (0.45 + 0.55 * rnd()));
      const p = curve[Math.min(curve.length - 1, k)];
      const ang = rnd() * Math.PI * 2, r = W * (0.6 + rnd() * 0.9);
      const x = Math.round(p.x + Math.cos(ang) * r), y = Math.round(p.y + Math.sin(ang) * r);
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const i = (y * w + x) * 4;
      od[i] = bright[0]; od[i + 1] = bright[1]; od[i + 2] = bright[2]; od[i + 3] = 255;
    }
  }
  return out;
}

// 光效 strokes (trails/glow.js): the stroke stands in for a swing — a few of its
// cross-sections act as the sticks the splatter flies off. No flash: it belongs to
// the first frame of an animated swing.
function glowStroke(curve, sections, p, opts, w, h, fade) {
  const n = sections.length - 1, run = [];
  for (let k = 0; k <= 6; k++) run.push(sections[Math.round(n * (0.3 + 0.7 * k / 6))]);
  const c = renderGlow([sections], glowStyle(p), w, h, {
    seed: hashSeed(curve.length + ":" + Math.round(curve[0].x) + ":" + Math.round(curve[0].y)),
    frame: 0, alpha: 1, fade, fx: true, run, age: run.length + 3,
  });
  return c && c.getContext("2d").getImageData(0, 0, w, h);
}

// swatch for the preset picker
export function presetSwatch(p, primary) {
  const bands = p.bands || [[primary, 1]];
  const stops = bands.map(([c], i) => (typeof c === "string" ? c : "rgb(" + c.slice(0, 3).join(",") + ")") + " " + Math.round(i / Math.max(1, bands.length - 1) * 100) + "%");
  return "linear-gradient(90deg, " + (stops.length > 1 ? stops.join(", ") : stops[0] + ", " + stops[0]) + ")";
}
