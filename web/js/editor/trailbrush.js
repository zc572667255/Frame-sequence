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
import { renderStroke, mirrorTails } from "../trails/model.js";
import { GLOW_PRESETS, glowStyle, mixStyle, hashSeed, renderGlow, pixelateGlow, celShade } from "../trails/glow.js";

// bands: outer -> inner, [colour, width factor]. look: the rest of the band
// style a preset sets (see BAND_LOOK); the 弧光 styles light the blade-tip edge
// and let the grip side fade out in ragged streaks.
// the classic styles: crisp and solid, lit along the edge, only a touch ragged,
// thin at the tail and full at the head. Colours run
// like a hand-painted slash: a white-hot leading edge, a bright tint, the
// saturated main colour, then a deeper colour shifted in hue (never near black)
const CLASSIC = { bandLayout: "edge", edgeFade: 0.2, edgeBreak: 0.3, streaks: 0.25, bandBlend: "steps", bandShade: 0.2, fadeSteps: false, shape: "head" };
const ARC = { bandLayout: "edge", edgeFade: 0.55, streaks: 0.6, edgeBreak: 0.35, fadeSteps: true, bandBlend: "steps", bandShade: 0, shape: "head" };
export const TRAIL_PRESETS = [
  { id: "arc-ice", name: "冰蓝弧光", bands: [["#3a5bd9", 1], ["#4f9cf5", 0.7], ["#7fdcff", 0.44], ["#d6f6ff", 0.22], ["#ffffff", 0.09]], look: ARC },
  { id: "arc-fire", name: "烈焰弧光", bands: [["#c2321f", 1], ["#f26a1b", 0.7], ["#ffa52e", 0.44], ["#ffe07a", 0.22], ["#fffbe0", 0.09]], look: ARC },
  { id: "arc-gold", name: "金辉弧光", bands: [["#c8782a", 1], ["#eaa83a", 0.7], ["#ffd255", 0.44], ["#fff09a", 0.22], ["#ffffff", 0.09]], look: ARC },
  { id: "arc-shadow", name: "暗影弧光", bands: [["#5a2a9a", 1], ["#8a3fd0", 0.7], ["#c070f0", 0.44], ["#efc2ff", 0.22], ["#ffffff", 0.09]], look: ARC },
  { id: "arc-wind", name: "翠风弧光", bands: [["#1f8a6a", 1], ["#35c08a", 0.7], ["#7fe8b0", 0.44], ["#d0ffe4", 0.22], ["#ffffff", 0.09]], look: ARC },
  { id: "arc-spin", name: "赤红旋斩", bands: [["#b01e32", 1], ["#e8384a", 0.62], ["#ff8a7a", 0.34], ["#ffffff", 0.14]], look: { ...ARC, splits: 2, streaks: 0.4, edgeFade: 0.7, shape: "even" } },
  { id: "arc-water", name: "水刃", bands: [["#2457d6", 1], ["#3a9cf2", 0.68], ["#7fd8ff", 0.4], ["#dff8ff", 0.18], ["#ffffff", 0.07]], look: { ...ARC, edgeFade: 0.6, streaks: 0.7, edgeBreak: 0.5 } },
  { id: "white", name: "白光", bands: [["#4a5a86", 1], ["#7f8fb4", 0.74], ["#b9c6de", 0.5], ["#e6eef8", 0.28], ["#ffffff", 0.12]], look: CLASSIC },
  { id: "fire", name: "火焰", bands: [["#a8221e", 1], ["#e0431a", 0.76], ["#ff8a1e", 0.52], ["#ffd54a", 0.3], ["#fff6c8", 0.12]], look: CLASSIC },
  { id: "ice", name: "冰霜", bands: [["#1d4fb0", 1], ["#2a86e0", 0.74], ["#4fc4f5", 0.5], ["#a8ecff", 0.28], ["#ffffff", 0.12]], look: CLASSIC },
  { id: "thunder", name: "雷电", bands: [["#3a3fb8", 1], ["#4d74e8", 0.72], ["#59b4ff", 0.46], ["#c4ecff", 0.24], ["#ffffff", 0.1]], look: CLASSIC },
  { id: "shadow", name: "暗紫", bands: [["#4a1f6a", 1], ["#7a2fa0", 0.74], ["#b04ad0", 0.5], ["#e48ef0", 0.28], ["#ffd8fa", 0.1]], look: CLASSIC },
  { id: "blood", name: "鲜血", bands: [["#6a0e22", 1], ["#a8162c", 0.74], ["#dc2a3a", 0.5], ["#ff6a5e", 0.26], ["#ffd0c4", 0.1]], look: CLASSIC },
  { id: "holy", name: "圣光金", bands: [["#b0642a", 1], ["#e09a34", 0.74], ["#f8c84a", 0.5], ["#fff0a0", 0.28], ["#ffffff", 0.1]], look: CLASSIC },
  { id: "wind", name: "风刃", bands: [["#5a7a8c", 1], ["#9fc4cc", 0.6], ["#e0f6f2", 0.28], ["#ffffff", 0.1]], fade: 85, look: { ...CLASSIC, edgeFade: 0.5, streaks: 0.6, edgeBreak: 0.5 } },
  { id: "earth", name: "岩土", bands: [["#4a2e18", 1], ["#7a4e26", 0.74], ["#a8743a", 0.5], ["#d8aa68", 0.28], ["#f6e0a8", 0.1]], look: { ...CLASSIC, edgeBreak: 0.5 } },
  { id: "mono", name: "主色", bands: null, look: CLASSIC },
];

// what a band preset without its own look gets: bright middle, clean-ish edges
export const BAND_LOOK = { bandLayout: "center", edgeFade: 0, streaks: 0, edgeBreak: 0.3, fadeSteps: false, splits: 0, pxDust: 0, pxShards: 0, pxSplatter: 0, pxImpact: 0 };

export const TRAIL_DEFAULTS = { preset: "glow:dream", width: 10, shape: "head", fade: 45, sparks: false, toFxLayer: true, tailMode: "brush", brushId: "bristle", brushData: null, bandBlend: "steps", bandSoft: 60, bandShade: 40, edgeBreak: 40, pixelGlow: false, pxSize: 1, pxAlpha: "steps", mixEdge: 100, mixBody: 100, mixGlow: 100, mixFx: 100, mixBurst: 100, plane: "flat", planeSquash: 60, planeTilt: 0, headArc: 0.5, taper: 0.12, look: null, wrap: false, wrapFlip: false };

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

function profile(shape, t, taper = 0.12) {
  if (shape === "even") return 1;
  if (shape === "crescent") return Math.max(0.08, Math.pow(Math.sin(Math.PI * t), 0.7));
  return taper + (1 - taper) * t; // head: thin tail (stroke start) -> full width at the head (stroke end)
}

// 头部弧度: the head end rounded, bulging on along the stroke (as the attack
// trail's, trails/model.js) — cross-sections added past the last one
function headCap(sections, arc) {
  const H = sections[sections.length - 1], P = sections[sections.length - 2];
  if (!(arc > 0) || !P) return sections;
  const m = [(H.a[0] + H.b[0]) / 2, (H.a[1] + H.b[1]) / 2], pm = [(P.a[0] + P.b[0]) / 2, (P.a[1] + P.b[1]) / 2];
  let dx = m[0] - pm[0], dy = m[1] - pm[1];
  const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
  const hv = [(H.b[0] - H.a[0]) / 2, (H.b[1] - H.a[1]) / 2], bulge = arc * Math.hypot(hv[0], hv[1]);
  const out = sections.slice();
  for (let i = 1; i <= 6; i++) {
    const th = (i / 6) * Math.PI / 2, c = Math.cos(th), sn = Math.sin(th);
    out.push({ a: [m[0] - hv[0] * c + dx * bulge * sn, m[1] - hv[1] * c + dy * bulge * sn], b: [m[0] + hv[0] * c + dx * bulge * sn, m[1] + hv[1] * c + dy * bulge * sn], u: 1 });
  }
  return out;
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
  const n = curve.length - 1, taper = Math.max(0, Math.min(1, opts.taper ?? 0.12));
  let sections = curve.map((p, k) => {
    const a = curve[Math.max(0, k - 1)], b = curve[Math.min(n, k + 1)];
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
    const u = k / n, half = Math.max(0.5, (W * profile(shape, u, taper)) / 2);
    const nx = -dy / len * half, ny = dx / len * half;
    return { a: [p.x - nx, p.y - ny], b: [p.x + nx, p.y + ny], u };
  });
  if (shape !== "crescent") sections = headCap(sections, Math.max(0, Math.min(1, opts.headArc ?? 0.5)));
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
    fade, shape, tailMode: opts.tailMode || "brush", pixel: true, opacity: 100,
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
  // the preset, its layers as set under 细节 (opts.look), then the shared mixes
  const st0 = mixStyle({ ...glowStyle(p), ...(opts.look || {}), mixEdge: opts.mixEdge ?? 100, mixBody: opts.mixBody ?? 100, mixGlow: opts.mixGlow ?? 100, mixFx: opts.mixFx ?? 100, mixBurst: opts.mixBurst ?? 100 });
  const st = opts.pixelGlow || st0.cel > 0 ? { ...st0, glow: st0.glow * 0.5, haze: st0.haze * 0.6 } : st0;   // see model.js: tight glows
  // 两头尖: the head end is drawn as a tail too, as the attack trail does it
  // (trails/model.js mirrorTails) — drawn reversed as well and the two halves
  // joined, the tails sharing the fade length half each
  const two = (opts.shape || "head") === "crescent";
  const ctx = {
    seed: hashSeed(curve.length + ":" + Math.round(curve[0].x) + ":" + Math.round(curve[0].y)),
    frame: 0, alpha: 1, fade: fade * (two ? 0.5 : 1), fx: true, run, age: run.length + 3, ended: true, after: 0,
  };
  let c = renderGlow([sections], st, w, h, ctx);
  if (two) {
    const back = sections.slice().reverse().map((q) => ({ ...q, u: 1 - q.u }));
    c = mirrorTails(c, renderGlow([back], st, w, h, { ...ctx, fx: false, ended: false }), sections);
  }
  if (c && opts.pixelGlow) c = pixelateGlow(c, st, { size: opts.pxSize, alpha: opts.pxAlpha });
  else if (c && st.cel > 0) c = celShade(c, st, st.cel / 100, (st.celOutline || 0) / 100);
  return c && c.getContext("2d").getImageData(0, 0, w, h);
}

