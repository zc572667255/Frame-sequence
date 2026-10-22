// Glow trails (光效): the smooth, luminous look of slash / magic VFX, as opposed
// to the hard-edged pixel bands.
//
// Built from the same cross-sections as every trail ({ a, b, u }: inner end, outer
// end, position along the trail tail -> head), in one or more runs. Layers, back
// to front:
//   haze    — a wide, heavily blurred wash of colour left behind by the swing
//   strands — many thin lines of light at different heights across the trail,
//             each starting somewhere in the tail and growing toward the head,
//             added up (additive light)
//   core    — a sharp, white-hot crescent along the outer side with a coloured rim
//   flow    — the body as moving fire / water / energy: noise warped and
//             flowing along the swing, hugging the rim, the inner edge broken
//             into tongues
//   shadow  — (toon) a darker copy of the core, offset inward
//   bolts   — lightning: jagged forking lines along the blade, new every frame
//   flames  — tongues of fire licking off the blade, flickering every frame
//   rays    — (holy light) thin beams shining outward from the leading edge
//   crystal — (ice) faceted ice crystals packed along the leading edge
//   speed lines — long straight streaks left behind the head
//   snow    — (fx) six-armed snowflakes turning and twinkling around the trail
//   bubbles — (fx, water) hollow bubbles drifting up
//   rocks   — (fx, earth) chunks of rock flung off the edge, falling as they fly
//   curls   — (wind) wind blades: soft bands of wind wound round the blade
//   serrate — (wind) saw teeth along the blade's inner side
//   caustic — (water) the rippling net of light inside the water
//   drops   — (fx, water) teardrops flung off the edge
//   tear    — (water) the body torn into streaming strands, like a waterfall
//   leaves  — (fx, wind) leaves caught up by the swing, tumbling and fluttering
// Solid matter (earth, `solid` in the look) is painted like a dark palette.
//   embers  — (fx) glowing sparks rising and swaying off the swing
//   tail tint — the colour shifts along the trail toward a second colour at the
//             tail (blue tail, red head), changing hue but not brightness
// Optional finishing (celShade): flat cel-shaded tones with a dark outline, the
// 2D anime look.
// Dark palettes (黑炎) are painted rather than added as light: black fire has to
// cover what is behind it, and only its glowing edge adds light.
//   bloom   — a blurred copy of strands + core (+ flow) added on top
//   erosion — noise eats the trail as it dissolves, inner side first: the
//             leading edge is the last thing to go
//   fx      — twinkling four-point stars, fine dust, glassy shards, a starburst
//             flash where the swing starts, an impact burst where it ends, and
//             ink-like splatter flying off the blade
// Colours run across the width (inner -> outer); `core` / `rim` / `splat` are the
// colours of the hot crescent, its edge and the splatter.
import { createCanvas, hexToRgb } from "../core/util.js";
import { uvMap } from "./uv.js";

export const GLOW_PRESETS = [
  { id: "dream", name: "梦幻", colors: ["#2f5bff", "#2fd8ff", "#e8fbff", "#ff6ad5"], core: "#ffffff", rim: "#7fe9ff", splat: "#9fd8ff",
    look: { strands: 70, core: 25, haze: 35, glow: 75, sparkles: 16, sparkleSize: 7, flash: 0, splatter: 0, erode: 25, dust: 45, flow: 15 } },
  { id: "blaze", name: "烈焰斩", colors: ["#ff5a4a", "#ff7a2a", "#ffad3b", "#ffd27a"], core: "#fffaf0", rim: "#ff9a1a", splat: "#e08a2e",
    look: { strands: 14, core: 90, haze: 60, glow: 50, sparkles: 0, sparkleSize: 6, flash: 80, splatter: 50, erode: 35, flow: 60, impact: 60, flames: 55, embers: 45 } },
  { id: "frost", name: "冰晶", colors: ["#1b4dff", "#38c7ff", "#c4f4ff", "#ffffff"], core: "#ffffff", rim: "#5fd6ff", splat: "#a6e8ff",
    look: { strands: 30, core: 60, haze: 35, glow: 60, sparkles: 8, sparkleSize: 6, flash: 40, splatter: 0, erode: 35, flow: 20, shards: 45, dust: 15, crystal: 60, speedLines: 35, snow: 55 } },
  { id: "spark", name: "雷光", colors: ["#3a0a8a", "#7a2aff", "#c08aff", "#f2e4ff"], core: "#ffffff", rim: "#b47aff", splat: "#d8b8ff",
    look: { strands: 22, core: 70, haze: 25, glow: 80, sparkles: 14, sparkleSize: 5, flash: 100, splatter: 0, erode: 35, flow: 20, impact: 55, dust: 20, bolts: 85 } },
  { id: "radiant", name: "圣光", colors: ["#ff9f2e", "#ffdc7a", "#fff8de", "#ffffff"], core: "#ffffff", rim: "#ffd25c", splat: "#ffe08a",
    look: { strands: 34, core: 60, haze: 45, glow: 70, sparkles: 12, sparkleSize: 8, flash: 60, splatter: 0, erode: 35, flow: 10, impact: 35, dust: 45, rays: 70 } },
  { id: "umbra", name: "暗影", colors: ["#3a0b57", "#8a22c2", "#e07bff", "#ffd2ff"], core: "#ffe6ff", rim: "#b04de0", splat: "#6a2a8a",
    look: { strands: 35, core: 55, haze: 55, glow: 55, sparkles: 6, sparkleSize: 5, flash: 0, splatter: 40, erode: 40, flow: 55, dust: 15 } },
  { id: "venom", name: "毒雾", colors: ["#0b7a34", "#35d65a", "#b9ff8c", "#f2ffdc"], core: "#f4ffe8", rim: "#4be06a", splat: "#4caf3c",
    look: { strands: 25, core: 50, haze: 65, glow: 55, sparkles: 4, sparkleSize: 5, flash: 0, splatter: 80, erode: 40, flow: 70, dust: 30 } },
  { id: "shatter", name: "冰刃碎光", colors: ["#1a2f8a", "#2f6bff", "#6fd4ff", "#e8fbff"], core: "#ffffff", rim: "#9fe8ff", splat: "#bfe8ff",
    look: { strands: 30, core: 55, haze: 35, glow: 60, sparkles: 6, sparkleSize: 4, flash: 0, splatter: 0, erode: 40, flow: 45, shards: 75, dust: 40, crystal: 40, snow: 25 } },
  { id: "glacier", name: "寒冰斩", colors: ["#0a1a6a", "#1a50e0", "#5ab4ff", "#dff4ff"], core: "#ffffff", rim: "#8fd4ff", splat: "#bfe8ff",
    look: { strands: 18, core: 70, haze: 25, glow: 65, sparkles: 10, sparkleSize: 5, flash: 0, splatter: 0, erode: 30, flow: 15, shards: 30, dust: 25, crystal: 85, speedLines: 75, snow: 25 } },
  { id: "torrent", name: "激流", colors: ["#0a2a7a", "#1a5ae0", "#5ac0ff", "#e0f6ff"], core: "#ffffff", rim: "#a8e8ff", splat: "#8fd8ff",
    look: { strands: 20, core: 60, haze: 20, glow: 45, sparkles: 0, sparkleSize: 5, flash: 0, splatter: 0, erode: 30, flow: 75, dust: 0, bubbles: 25, speedLines: 10, tear: 40, caustic: 60, drops: 75 } },
  { id: "quake", name: "岩崩", colors: ["#26221c", "#57504a", "#8a8278", "#c8c0b0"], core: "#e0d4b8", rim: "#a89878", splat: "#4a4238",
    look: { strands: 0, core: 55, haze: 60, glow: 5, sparkles: 0, sparkleSize: 5, flash: 0, splatter: 30, erode: 45, flow: 85, dust: 45, impact: 0, rocks: 100, cel: 45, solid: true } },
  { id: "gale", name: "疾风", colors: ["#0a4a4a", "#14a8a0", "#5af0e0", "#e8fff8"], core: "#ffffff", rim: "#7af8e8", splat: "#c8fff4",
    look: { strands: 35, core: 65, haze: 15, glow: 50, sparkles: 0, sparkleSize: 5, flash: 0, splatter: 0, erode: 30, flow: 15, dust: 12, speedLines: 40, curls: 75, serrate: 0, leaves: 30, cel: 0 } },
  { id: "inferno", name: "炎爆", colors: ["#4a0000", "#c40c08", "#ff2e10", "#ff8a2a"], core: "#fff0d8", rim: "#ff4a18", splat: "#b01408",
    look: { strands: 4, core: 80, haze: 45, glow: 55, sparkles: 0, sparkleSize: 6, flash: 0, splatter: 40, erode: 45, flow: 90, impact: 90, dust: 10, flames: 75, embers: 65 } },
  { id: "blackfire", name: "黑炎", colors: ["#030005", "#0e0014", "#24062e", "#4a0c52"], core: "#0a0010", rim: "#c03aff", splat: "#3a0a44",
    look: { strands: 6, core: 85, haze: 60, glow: 60, sparkles: 0, sparkleSize: 5, flash: 0, splatter: 25, erode: 40, flow: 80, impact: 40, flames: 80, embers: 60 } },
  { id: "crescent", name: "月影", colors: ["#0b1f8a", "#1f5bff", "#6fb8ff", "#e8f4ff"], core: "#ffffff", rim: "#bfe4ff", splat: "#bfe4ff",
    look: { strands: 8, core: 75, haze: 20, glow: 85, sparkles: 4, sparkleSize: 3, flash: 0, splatter: 0, erode: 20, dust: 20 } },
  { id: "violet", name: "紫电", colors: ["#3a0040", "#a01ac8", "#ff5ae0", "#ffe0fa"], core: "#ffffff", rim: "#ff7aea", splat: "#f0a0e8",
    look: { strands: 24, core: 60, haze: 40, glow: 65, sparkles: 8, sparkleSize: 5, flash: 30, splatter: 0, erode: 35, flow: 45, dust: 30, bolts: 60 } },
  { id: "toon", name: "卡通白", colors: ["#9aa3b5", "#d8dde8", "#ffffff", "#ffffff"], core: "#ffffff", rim: "#ffffff", splat: "#ffffff",
    look: { strands: 8, core: 100, haze: 0, glow: 0, sparkles: 0, sparkleSize: 4, flash: 0, splatter: 0, erode: 20, shadow: 70 } },
  { id: "animefire", name: "动漫炎", colors: ["#a80a04", "#e8260c", "#ff6a10", "#ffc832"], core: "#fff3c0", rim: "#ff9a18", splat: "#c81808",
    look: { strands: 0, core: 80, haze: 0, glow: 10, sparkles: 0, sparkleSize: 6, flash: 0, splatter: 40, erode: 30, flow: 90, flames: 90, embers: 30, impact: 80, cel: 85, celOutline: 0 } },
  { id: "animebolt", name: "动漫雷", colors: ["#0a1a6a", "#1a5aff", "#5ac8ff", "#eaffff"], core: "#ffffff", rim: "#7ae0ff", splat: "#9ad8ff",
    look: { strands: 10, core: 70, haze: 20, glow: 40, sparkles: 6, sparkleSize: 5, flash: 60, splatter: 0, erode: 30, flow: 30, bolts: 90, impact: 60, cel: 50, celOutline: 0 } },
  { id: "tricolor", name: "三色斩", colors: ["#6a0a1a", "#e8283c", "#ffd8d8", "#ffffff"], core: "#ffffff", rim: "#ff6a7a", splat: "#ff8a9a", tail: "#1a46ff",
    look: { strands: 8, core: 90, haze: 15, glow: 25, sparkles: 0, sparkleSize: 5, flash: 0, splatter: 0, erode: 25, flow: 20, tailTint: 90, cel: 40, celOutline: 0 } },
  { id: "icefire", name: "冰火", colors: ["#8a1400", "#ff3a0a", "#ff8a2a", "#ffd8a8"], core: "#fff4e8", rim: "#ff5a1a", splat: "#8ad8ff", tail: "#1a8aff",
    look: { strands: 18, core: 60, haze: 30, glow: 40, sparkles: 0, sparkleSize: 6, flash: 0, splatter: 0, erode: 35, flow: 60, flames: 50, embers: 30, shards: 35, tailTint: 100 } },
  { id: "stardust", name: "星痕", colors: ["#3a2a80", "#c87aff", "#ffd27a", "#ffffff"], core: "#ffffff", rim: "#ffe6a0", splat: "#ffe6a0",
    look: { strands: 40, core: 30, haze: 25, glow: 75, sparkles: 26, sparkleSize: 9, flash: 0, splatter: 0, erode: 25, dust: 90 } },
  { id: "crimson", name: "血刃", colors: ["#6b0014", "#d0162a", "#ff6a6f", "#ffe0e0"], core: "#fff0f0", rim: "#e8283c", splat: "#a0101e",
    look: { strands: 16, core: 85, haze: 55, glow: 45, sparkles: 0, sparkleSize: 6, flash: 50, splatter: 90, erode: 35, flow: 30, impact: 60 } },
];

// the style fields a glow preset sets (trail.style / the 拖尾笔's options). Every
// layer is set, so switching presets never keeps a layer from the last one.
const LOOK_ZERO = { flow: 0, shards: 0, dust: 0, impact: 0, shadow: 0, bolts: 0, flames: 0, embers: 0, rays: 0, tailTint: 0, cel: 0, celOutline: 0, crystal: 0, speedLines: 0, snow: 0, bubbles: 0, rocks: 0, curls: 0, leaves: 0, tear: 0, serrate: 0, caustic: 0, drops: 0, solid: false };
export function glowStyle(p) {
  return { glowId: p.id, glowColors: p.colors.slice(), glowCore: p.core, glowRim: p.rim, glowSplat: p.splat, glowTail: p.tail || p.colors[0], ...LOOK_ZERO, ...p.look };
}
export const GLOW_DEFAULTS = glowStyle(GLOW_PRESETS[0]);

// The controls every glow style shares, whatever its preset. Each one scales
// the layers that sit in the same place on the effect (0..200 %, 100 = the
// preset as designed), so the same handful of sliders works on fire, ice,
// lightning or anything else.
export const MIX_GROUPS = {
  mixEdge: ["core", "crystal", "rays", "shadow"],                          // 刀锋: on the leading edge
  mixBody: ["strands", "flow", "flames", "bolts", "speedLines", "curls", "serrate", "caustic"],   // 刀身: inside the trail
  mixGlow: ["glow", "haze"],                                               // 光晕: around it
  mixFx: ["sparkles", "dust", "snow", "embers", "shards", "splatter", "bubbles", "rocks", "leaves", "drops"],   // 粒子: scattered about
  mixBurst: ["flash", "impact"],                                           // 爆发: where the swing starts and ends
};
const MIX_LIMIT = { strands: 160, sparkles: 60 };
export function mixStyle(st) {
  let out = null;
  for (const [k, keys] of Object.entries(MIX_GROUPS)) {
    const m = st[k] == null ? 1 : Math.max(0, +st[k]) / 100;
    if (m === 1) continue;
    out = out || { ...st };
    for (const key of keys) out[key] = Math.min(MIX_LIMIT[key] || 100, (+st[key] || 0) * m);
  }
  return out || st;
}

const lerp = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const smooth = (e0, e1, x) => { const t = clamp01((x - e0) / (e1 - e0 || 1e-6)); return t * t * (3 - 2 * t); };
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, a)).toFixed(3)})`;

export function rng(seed) {
  let s = (Math.abs(Math.floor(seed)) % 2147483646) + 1;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}
export function hashSeed(str) {
  let h = 2166136261;
  for (const ch of String(str)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0) % 2147483646 + 1;
}

function colorAcross(cols, v) {
  const t = clamp01(v) * (cols.length - 1);
  const i = Math.min(cols.length - 2, Math.floor(t)), f = t - i;
  const a = cols[i], b = cols[i + 1];
  return [0, 1, 2].map((k) => Math.round(a[k] + (b[k] - a[k]) * f));
}

const widthOf = (q) => Math.hypot(q.b[0] - q.a[0], q.b[1] - q.a[1]);

// runs: [[{ a, b, u }, ...], ...] tail -> head.
// ctx: { seed, frame, alpha, fade, fx, run, age }
//   frame — the frame index (stars twinkle and the flash flickers per frame)
//   alpha — overall opacity (the trail's dissolve)
//   fade  — 0..1, how much of the trail (from the tail) ramps up
//   fx    — false to leave out stars / flash / splatter (the "back" pass)
//   run, age — every stick of the swing so far and frames since its first stick;
//             the flash sits at the first stick, splatter flies off later ones
//   ended, after — the swing has reached its last stick, and how many frames
//             ago: the impact burst goes off there
// Returns a fullW×fullH canvas, or null when there is nothing to draw.
export function renderGlow(runs, style, fullW, fullH, ctx = {}) {
  runs = (runs || []).filter((r) => r.length >= 2);
  const st = { ...GLOW_DEFAULTS, ...style };
  let run = ctx.run || [];
  const doFx = ctx.fx !== false;
  if (!runs.length && !(doFx && run.length && (st.flash > 0 || st.splatter > 0 || st.impact > 0))) return null;

  const cols = (st.glowColors && st.glowColors.length >= 2 ? st.glowColors : GLOW_DEFAULTS.glowColors).map(hexToRgb);
  const coreC = hexToRgb(st.glowCore || "#ffffff"), rimC = hexToRgb(st.glowRim || st.glowColors[st.glowColors.length - 1]);
  const splatC = hexToRgb(st.glowSplat || st.glowRim || "#ffffff");
  const seed = ctx.seed || 1, frame = ctx.frame || 0;
  const alpha = clamp01(ctx.alpha ?? 1) * clamp01((st.opacity ?? 100) / 100);
  const tail = Math.max(0.05, Math.min(1, ctx.fade ?? 0.6));
  const pct = (k) => clamp01((+st[k] || 0) / 100);
  // a dark palette (black fire) is painted over, not added as light
  const lum = (c) => (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
  const dark = !!st.solid || cols.reduce((s, c) => s + lum(c), 0) / cols.length < 0.18;

  // size of everything: the widest cross-section (or the longest stick)
  let maxW = 1;
  for (const r of runs) for (const q of r) maxW = Math.max(maxW, widthOf(q));
  for (const s of run) maxW = Math.max(maxW, widthOf(s));
  const at = (q, v) => lerp(q.a, q.b, v);

  // work in the trail's bounding box only (plus room for bloom, flash and
  // splatter): blurs and the erosion pass cost per pixel
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const grow = (p) => { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); };
  for (const r of runs) for (const q of r) { grow(q.a); grow(q.b); }
  for (const s of run) { grow(s.a); grow(s.b); }
  const big = doFx && ((st.flash > 0 && (ctx.age ?? 0) < 4) || (st.impact > 0 && ctx.ended));
  const pad = maxW * (big || st.speedLines > 0 || st.rocks > 0 || st.leaves > 0 || st.drops > 0 ? 2.8 : st.embers > 0 || st.rays > 0 || st.snow > 0 || st.bubbles > 0 ? 2.2 : 1.4) + 4;
  x0 = Math.max(0, Math.floor(x0 - pad)); y0 = Math.max(0, Math.floor(y0 - pad));
  x1 = Math.min(fullW, Math.ceil(x1 + pad)); y1 = Math.min(fullH, Math.ceil(y1 + pad));
  if (!(x1 > x0 && y1 > y0)) return null;
  const w = x1 - x0, h = y1 - y0;
  const shift = (q) => ({ ...q, a: [q.a[0] - x0, q.a[1] - y0], b: [q.b[0] - x0, q.b[1] - y0] });
  runs = runs.map((r) => r.map(shift));
  run = run.map(shift);

  const out = createCanvas(w, h);
  const og = out.getContext("2d");
  let UV = null, F = null;
  const strokeSeg = (g, p, q, col, a, lw) => {
    if (a <= 0.002) return;
    g.strokeStyle = rgba(col, a);
    g.lineWidth = Math.max(0.35, lw);
    g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]); g.stroke();
  };

  if (runs.length) {
    // ---- haze: wide lanes of colour, blurred hard
    const haze = pct("haze");
    if (haze > 0) {
      const H = createCanvas(w, h), hg = H.getContext("2d");
      // butt ends: a round cap on the last segment would bulge past the head
      hg.lineCap = "butt"; hg.lineJoin = "round";
      const lanes = 6;
      for (const r of runs) for (let l = 0; l < lanes; l++) {
        const v = (l + 0.5) / lanes, col = colorAcross(cols, v);
        for (let i = 1; i < r.length; i++) {
          const p = r[i - 1], q = r[i];
          const a = haze * 0.38 * smooth(0, tail, q.u) * (0.5 + 0.5 * Math.sin(Math.PI * v)) * alpha;
          strokeSeg(hg, at(p, v), at(q, v), col, a, (widthOf(q) / lanes) * 1.7);
        }
      }
      drawBlurred(og, [H], Math.max(1.5, maxW / 6));
    }

    // where each pixel sits on the ribbon (half size): the flowing body and the
    // inner-side-first erosion both work in (u, v)
    UV = pct("flow") > 0 || pct("erode") > 0 || pct("tear") > 0 || pct("caustic") > 0 ? halfUV(runs, w, h) : null;

    // ---- flow: the textured body
    if (UV && pct("flow") > 0) {
      F = flowLayer(UV, cols, coreC, seed, frame, alpha, tail, pct("flow"));
      og.drawImage(F, 0, 0, UV.mw * UV.k, UV.mh * UV.k);
    }

    // ---- rocks set into the blade
    const Rk = pct("rocks") > 0 ? rockBody(runs, w, h, cols, seed, alpha, tail, pct("rocks")) : null;
    if (Rk) og.drawImage(Rk, 0, 0);

    // ---- wind wound round the blade: its back half goes under the blade
    const Cw = pct("curls") > 0 ? curls(runs, w, h, coreC, rimC, seed, frame, alpha, maxW, pct("curls")) : null;
    if (Cw) { og.globalCompositeOperation = "lighter"; og.drawImage(Cw.back, 0, 0); og.globalCompositeOperation = "source-over"; }

    // ---- flames: tongues of fire off the blade
    const T = pct("flames") > 0 ? flames(runs, w, h, cols, coreC, rimC, seed, frame, alpha, tail, maxW, pct("flames"), dark) : null;
    if (T) {
      og.globalCompositeOperation = dark ? "source-over" : "lighter";
      og.drawImage(T, 0, 0);
      og.globalCompositeOperation = "source-over";
    }

    // ---- strands (additive light): thin pointed filaments, each one polygon so
    // nothing overlaps itself. Their layout is fixed per trail so they don't
    // crawl; only their brightness shimmers a little from frame to frame
    const L = createCanvas(w, h), lg = L.getContext("2d");
    lg.globalCompositeOperation = "lighter";
    const N = Math.max(0, Math.min(160, st.strands | 0));
    const R = rng(seed), shimmer = rng(seed * 31 + frame * 977);
    const dim = Math.min(1, Math.sqrt(24 / Math.max(1, N)));     // many strands: each one fainter, so they don't add up to plain white
    for (let s = 0; s < N; s++) {
      const v = 0.03 + 0.94 * R();
      const reach = Math.sin(Math.PI * v);                       // middle strands reach furthest back
      const u0 = Math.max(0, (1 - reach) * tail * 0.9 + R() * tail * 0.7 - 0.05);
      const bright = Math.pow(R(), 1.6) * (0.85 + 0.3 * shimmer()); // a few bright, many faint
      const thick = (0.3 + 0.9 * R()) * Math.max(0.7, maxW / 28);
      const col = colorAcross(cols, v + (R() - 0.5) * 0.1);
      const drift = (R() - 0.5) * 0.06, phase = R() * 6.28;
      lg.fillStyle = rgba(col, (0.25 + 0.75 * bright) * dim * alpha);
      for (const r of runs) filament(lg, r, u0, (u) => v + drift * Math.sin(phase + u * 5), thick);
    }
    // the leading edge: one long, thin, bright line along the outer side
    if (N) {
      lg.fillStyle = rgba(rimC, 0.9 * alpha);
      for (const r of runs) filament(lg, r, 0, () => 0.975, Math.max(0.8, maxW / 40));
    }
    // fade toward the tail: a soft mask of the ribbon, brighter toward the head
    if (N) {
      const M = createCanvas(w, h), mg = M.getContext("2d");
      for (const r of runs) for (let i = 1; i < r.length; i++) {
        const p = r[i - 1], q = r[i];
        mg.fillStyle = `rgba(0,0,0,${(smooth(0, tail, q.u) * (0.45 + 0.55 * q.u)).toFixed(3)})`;
        mg.beginPath();
        for (const [x, y] of [at(p, -0.15), at(p, 1.15), at(q, 1.15), at(q, -0.15)]) mg.lineTo(x, y);
        mg.fill();
      }
      lg.globalCompositeOperation = "destination-in";
      lg.filter = "blur(1.5px)";                                // melts the seams between the quads
      lg.drawImage(M, 0, 0);
      lg.filter = "none";
      lg.globalCompositeOperation = "lighter";
    }

    // ---- core: a sharp crescent along the outer side, rim colour around a hot centre
    const core = pct("core");
    const C = createCanvas(w, h), cg = C.getContext("2d");
    if (core > 0) {
      const ca = alpha * alpha;                                  // the core goes before the haze when dissolving
      const u0 = Math.max(0, 1 - (0.35 + 0.6 * core));             // how far back the core reaches
      const band = (q, vc, half) => [at(q, vc - half), at(q, vc + half)];
      const poly = (r, k) => {
        const lo = [], hi = [];
        for (const q of r) {
          if (q.u < u0) continue;
          const t = (q.u - u0) / Math.max(1e-3, 1 - u0);
          const half = (0.04 + 0.26 * core) * Math.pow(t, 1.2) * k;
          const [p0, p1] = band(q, 0.74 + 0.04 * (1 - k), half);
          lo.push(p0); hi.push(p1);
        }
        if (lo.length < 2) return;
        cg.beginPath();
        cg.moveTo(lo[0][0], lo[0][1]);
        for (const p of lo) cg.lineTo(p[0], p[1]);
        for (let i = hi.length - 1; i >= 0; i--) cg.lineTo(hi[i][0], hi[i][1]);
        cg.closePath();
        cg.fill();
      };
      // toon shadow: the same crescent in a dark tone, pushed toward the grip side
      const shadow = pct("shadow");
      if (shadow > 0) {
        let dx = 0, dy = 0;
        for (const r of runs) for (const q of r) { dx += q.a[0] - q.b[0]; dy += q.a[1] - q.b[1]; }
        const dl = Math.hypot(dx, dy) || 1, off = maxW * 0.14 * shadow;
        cg.save();
        cg.translate(dx / dl * off, dy / dl * off);
        cg.fillStyle = rgba(cols[0].map((c) => Math.round(c * 0.75)), ca * 0.9);
        for (const r of runs) poly(r, 1);
        cg.restore();
      }
      cg.fillStyle = rgba(rimC, ca);
      for (const r of runs) poly(r, 1);
      // the hot centre, blurred a touch so it melts into the rim
      const W2 = createCanvas(w, h), wg = W2.getContext("2d");
      const keep = cg;
      wg.fillStyle = rgba(coreC, ca);
      for (const r of runs) {
        const lo = [], hi = [];
        for (const q of r) {
          if (q.u < u0) continue;
          const t = (q.u - u0) / Math.max(1e-3, 1 - u0);
          const half = (0.04 + 0.26 * core) * Math.pow(t, 1.5) * 0.6;
          lo.push(at(q, 0.76 - half)); hi.push(at(q, 0.76 + half));
        }
        if (lo.length < 2) continue;
        wg.beginPath();
        wg.moveTo(lo[0][0], lo[0][1]);
        for (const p of lo) wg.lineTo(p[0], p[1]);
        for (let i = hi.length - 1; i >= 0; i--) wg.lineTo(hi[i][0], hi[i][1]);
        wg.closePath();
        wg.fill();
      }
      keep.filter = `blur(${Math.max(0.5, maxW / 60)}px)`;
      keep.drawImage(W2, 0, 0);
      keep.filter = "none";
    }

    // hot head: a soft glow where the blade is now — only in the pass that has
    // the real head (a front / back split also ends runs mid-trail)
    const Hd = runs[runs.length - 1][runs[runs.length - 1].length - 1];
    if (Hd.u > 0.999) {
      const c = at(Hd, 0.7), r = widthOf(Hd) * 0.6 + 1;
      const gr = lg.createRadialGradient(c[0], c[1], 0, c[0], c[1], r);
      gr.addColorStop(0, rgba(coreC, 0.45 * alpha * alpha));
      gr.addColorStop(0.45, rgba(rimC, 0.22 * alpha));
      gr.addColorStop(1, rgba(rimC, 0));
      lg.fillStyle = gr;
      // kept inside the ribbon, so the head has the shape its arc setting gives
      // it (flat at 0) instead of a round blob of light
      const hr = runs[runs.length - 1];
      lg.save();
      lg.beginPath();
      hr.forEach((q, i) => (i ? lg.lineTo(q.a[0], q.a[1]) : lg.moveTo(q.a[0], q.a[1])));
      for (let i = hr.length - 1; i >= 0; i--) lg.lineTo(hr[i].b[0], hr[i].b[1]);
      lg.closePath();
      lg.clip();
      lg.beginPath(); lg.arc(c[0], c[1], r, 0, Math.PI * 2); lg.fill();
      lg.restore();
    }

    // ---- lightning
    const Bt = pct("bolts") > 0 ? bolts(runs, w, h, coreC, rimC, seed, frame, alpha, maxW, pct("bolts")) : null;

    og.globalCompositeOperation = "lighter";
    og.drawImage(L, 0, 0);
    og.globalCompositeOperation = "source-over";
    og.drawImage(C, 0, 0);
    if (Bt) { og.globalCompositeOperation = "lighter"; og.drawImage(Bt, 0, 0); og.globalCompositeOperation = "source-over"; }
    // ---- ice crystals and speed lines
    const Cr = pct("crystal") > 0 ? crystals(runs, w, h, cols, coreC, seed, alpha, tail, maxW, pct("crystal")) : null;
    if (Cr) og.drawImage(Cr, 0, 0);
    const Sl = pct("speedLines") > 0 ? speedLines(runs, w, h, coreC, rimC, seed, frame, alpha, maxW, pct("speedLines")) : null;
    if (Sl) { og.globalCompositeOperation = "lighter"; og.drawImage(Sl, 0, 0); og.globalCompositeOperation = "source-over"; }
    // ---- caustics inside the water
    const Ca = UV && pct("caustic") > 0 ? caustics(UV, colorAcross(cols, 0.85), seed, frame, alpha, pct("caustic")) : null;
    if (Ca) { og.globalCompositeOperation = "lighter"; og.drawImage(Ca, 0, 0, UV.mw * UV.k, UV.mh * UV.k); og.globalCompositeOperation = "source-over"; }
    // ---- saw teeth along the inner side
    const Sr = pct("serrate") > 0 ? serrate(runs, w, h, cols, coreC, seed, alpha, tail, pct("serrate")) : null;
    if (Sr) og.drawImage(Sr, 0, 0);
    // ---- whirls of air
    // (the front half of the wind, over the blade)
    const Cu = Cw ? Cw.front : null;
    if (Cu) { og.globalCompositeOperation = "lighter"; og.drawImage(Cu, 0, 0); og.globalCompositeOperation = "source-over"; }
    // ---- rays of light
    const Ry = pct("rays") > 0 ? rays(runs, w, h, coreC, rimC, seed, frame, alpha, maxW, pct("rays")) : null;
    if (Ry) { og.globalCompositeOperation = "lighter"; og.drawImage(Ry, 0, 0); og.globalCompositeOperation = "source-over"; }
    // bloom: blurred copies of the light and the core, added on top
    const bloom = pct("glow");
    if (bloom > 0) {
      og.globalCompositeOperation = "lighter";
      for (const [rad, k] of [[maxW / 9, 0.45], [maxW / 3.5, 0.35]]) {
        og.globalAlpha = bloom * k;
        drawBlurred(og, [L, C, F, Bt, T, Ry, Cr, Sl, Cu, Sr].filter(Boolean), Math.max(1, rad));
      }
      og.globalAlpha = 1;
      og.globalCompositeOperation = "source-over";
    }
  }

  // erosion: as the trail dissolves, noise eats it from the thin parts inward
  // (the usual alpha-erosion of slash VFX) instead of it just turning see-through
  if (UV && pct("tear") > 0) tear(og, UV, seed, frame, pct("tear"));
  if (runs.length && pct("tailTint") > 0 && st.glowTail) tintTail(og, w, h, runs, hexToRgb(st.glowTail), pct("tailTint"), maxW);
  if (runs.length) erode(og, w, h, x0, y0, seed, pct("erode"), ctx.alpha ?? 1, maxW, UV);

  if (doFx) {
    if (runs.length) {
      sparkles(og, runs, st, cols, seed, frame, alpha, maxW, at);
      dust(og, runs, cols, seed, frame, alpha, maxW, at, pct("dust"));
      snow(og, runs, coreC, rimC, seed, frame, alpha, maxW, at, pct("snow"));
      bubbles(og, runs, coreC, rimC, seed, frame, alpha, maxW, at, pct("bubbles"));
    }
    if (run.length) {
      flash(og, run, st, coreC, rimC, seed, frame, ctx.age ?? 0, alpha, pct("flash"));
      splatter(og, run, w, h, st, splatC, seed, ctx.age ?? 0, alpha, pct("splatter"));
      shards(og, run, cols, coreC, seed, ctx.age ?? 0, alpha, pct("shards"));
      rocks(og, run, cols, seed, ctx.age ?? 0, clamp01((st.opacity ?? 100) / 100), maxW, pct("rocks"));
      leaves(og, run, cols, seed, ctx.age ?? 0, clamp01((st.opacity ?? 100) / 100), maxW, pct("leaves"));
      drops(og, run, cols, coreC, seed, ctx.age ?? 0, clamp01((st.opacity ?? 100) / 100), maxW, pct("drops"));
      if (runs.length && pct("drops") > 0) dropsBody(og, runs, cols, coreC, seed, frame, alpha, tail, pct("drops"));
      embers(og, run, coreC, rimC, seed, frame, ctx.age ?? 0, clamp01((st.opacity ?? 100) / 100), maxW, pct("embers"), dark);
      if (ctx.ended) impact(og, run, coreC, rimC, splatC, seed, frame, ctx.after ?? 0, clamp01((st.opacity ?? 100) / 100), pct("impact"));
    }
  }
  // a canvas, not ImageData: everything above stays on the GPU, reading pixels
  // back would cost more than all the drawing
  const full = createCanvas(fullW, fullH);
  full.getContext("2d").drawImage(out, x0, y0);
  full.bbox = { x0, y0, w, h };              // where anything was drawn (pixelateGlow)
  return full;
}

// The accents alone — dust, splatter, shards and the impact burst — on a w×h
// canvas, coloured from `colors` (dark -> bright). The pixel bands draw these and
// then snap them to solid pixels in the trail's own colours.
// amounts: { dust, shards, splatter, impact } 0..1; ctx as renderGlow's.
export function renderFx(runs, run, colors, amounts, w, h, ctx = {}) {
  runs = (runs || []).filter((r) => r.length >= 2);
  run = run || [];
  if (!runs.length && !run.length) return null;
  const cols = colors.map((c) => (typeof c === "string" ? hexToRgb(c) : c));
  const coreC = cols[cols.length - 1], rimC = cols[Math.max(0, cols.length - 2)], splatC = cols[Math.floor((cols.length - 1) / 2)];
  const seed = ctx.seed || 1, frame = ctx.frame || 0, alpha = clamp01(ctx.alpha ?? 1);
  let maxW = 1;
  for (const r of runs) for (const q of r) maxW = Math.max(maxW, widthOf(q));
  for (const s of run) maxW = Math.max(maxW, widthOf(s));
  const at = (q, v) => lerp(q.a, q.b, v);
  const c = createCanvas(w, h), g = c.getContext("2d");
  if (runs.length && amounts.dust > 0) dust(g, runs, cols, seed, frame, alpha, Math.max(maxW, 60), at, amounts.dust);
  if (run.length) {
    if (amounts.splatter > 0) splatter(g, run, w, h, {}, splatC, seed, ctx.age ?? 0, alpha, amounts.splatter);
    if (amounts.shards > 0) shards(g, run, cols, coreC, seed, ctx.age ?? 0, alpha, amounts.shards);
    if (ctx.ended && amounts.impact > 0) impact(g, run, coreC, rimC, splatC, seed, frame, ctx.after ?? 0, 1, amounts.impact);
  }
  return c;
}

// draw the canvases blurred by rad px. Wide blurs are done on a smaller copy and
// scaled back up — the same picture at a fraction of the cost.
function drawBlurred(g, srcs, rad) {
  const w = g.canvas.width, h = g.canvas.height;
  const k = Math.max(1, Math.min(4, Math.floor(rad / 5)));
  if (k === 1) {
    g.filter = `blur(${rad}px)`;
    for (const s of srcs) g.drawImage(s, 0, 0);
    g.filter = "none";
    return;
  }
  const sw = Math.ceil(w / k), sh = Math.ceil(h / k);
  const small = createCanvas(sw, sh), sg = small.getContext("2d");
  for (const s of srcs) sg.drawImage(s, 0, 0, sw, sh);
  const out = createCanvas(sw, sh), tg = out.getContext("2d");
  tg.filter = `blur(${rad / k}px)`;
  tg.drawImage(small, 0, 0);
  g.drawImage(out, 0, 0, w, h);
}

// smooth value noise in [0, 1] for a w×h box at (ox, oy) in document pixels, two
// octaves, fixed per seed. The lattice is hashed once and interpolated per pixel.
function noiseGrid(seed, w, h, ox, oy, cell) {
  const hash = (x, y, o) => {
    let v = Math.imul(x + o * 7919, 374761393) ^ Math.imul(y - o * 104729, 668265263) ^ seed;
    v = Math.imul(v ^ (v >>> 13), 1274126177);
    return ((v ^ (v >>> 16)) >>> 0) / 4294967295;
  };
  const out = new Float32Array(w * h);
  for (const [c, o, wt] of [[cell, 0, 0.65], [cell / 2.7, 1, 0.35]]) {
    const gx0 = Math.floor(ox / c), gy0 = Math.floor(oy / c);
    const GW = Math.ceil((ox + w) / c) - gx0 + 2, GH = Math.ceil((oy + h) / c) - gy0 + 2;
    const lat = new Float32Array(GW * GH);
    for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) lat[j * GW + i] = hash(gx0 + i, gy0 + j, o);
    const ix = new Int32Array(w), tx = new Float32Array(w);
    for (let x = 0; x < w; x++) {
      const f = (x + ox) / c - gx0;
      ix[x] = Math.floor(f);
      const t = f - ix[x];
      tx[x] = t * t * (3 - 2 * t);
    }
    for (let y = 0; y < h; y++) {
      const f = (y + oy) / c - gy0, iy = Math.floor(f);
      let ty = f - iy;
      ty = ty * ty * (3 - 2 * ty);
      const r0 = iy * GW, r1 = r0 + GW, row = y * w;
      for (let x = 0; x < w; x++) {
        const i = ix[x], t = tx[x];
        const top = lat[r0 + i] + (lat[r0 + i + 1] - lat[r0 + i]) * t;
        const bot = lat[r1 + i] + (lat[r1 + i + 1] - lat[r1 + i]) * t;
        out[row + x] += (top + (bot - top) * ty) * wt;
      }
    }
  }
  return out;
}

function erode(og, w, h, ox, oy, seed, amount, life, maxW, UV) {
  const t = amount * (0.08 + 0.92 * (1 - clamp01(life)));       // a little always, more while dissolving
  if (t <= 0.02) return;
  // the mask is worked out at half size and laid over with destination-in
  const k = 2, mw = Math.ceil(w / k), mh = Math.ceil(h / k);
  const noise = noiseGrid(seed, mw, mh, ox / k, oy / k, Math.max(2, maxW / 4 / k));
  const img = new ImageData(mw, mh), d = img.data;
  const lo = t - 0.12, span = 0.24;
  // with the uv map, how far a pixel is from the leading edge counts too: the
  // grip side wears away first and the bright edge is the last to go. Pixels off
  // the ribbon (haze, bloom) count as middling.
  const uv = UV && UV.mw === mw && UV.mh === mh ? UV.d : null;
  for (let p = 0, i = 3; p < mw * mh; p++, i += 4) {
    const n = uv ? noise[p] * 0.6 + (uv[i] > 8 ? uv[i - 2] / 255 : 0.5) * 0.4 : noise[p];
    let m = (n - lo) / span;
    m = m <= 0 ? 0 : m >= 1 ? 1 : m * m * (3 - 2 * m);
    d[i] = Math.round(m * 255);
  }
  const M = createCanvas(mw, mh);
  M.getContext("2d").putImageData(img, 0, 0);
  og.save();
  og.globalCompositeOperation = "destination-in";
  og.drawImage(M, 0, 0, mw * k, mh * k);
  og.restore();
}

// a pointed filament along a run of sections: zero width where it starts (u0),
// full width at the head; vAt(u) says where across the trail it runs
function filament(g, r, u0, vAt, width) {
  const lo = [], hi = [];
  for (const q of r) {
    if (q.u < u0) continue;
    const t = (q.u - u0) / Math.max(1e-3, 1 - u0);
    const v = vAt(q.u);
    const c = [q.a[0] + (q.b[0] - q.a[0]) * v, q.a[1] + (q.b[1] - q.a[1]) * v];
    let nx = q.b[0] - q.a[0], ny = q.b[1] - q.a[1];
    const nl = Math.hypot(nx, ny) || 1;
    const half = (width / 2) * Math.pow(t, 0.8);
    nx = nx / nl * half; ny = ny / nl * half;
    lo.push([c[0] - nx, c[1] - ny]); hi.push([c[0] + nx, c[1] + ny]);
  }
  if (lo.length < 2) return;
  g.beginPath();
  for (const p of lo) g.lineTo(p[0], p[1]);
  for (let i = hi.length - 1; i >= 0; i--) g.lineTo(hi[i][0], hi[i][1]);
  g.closePath();
  g.fill();
}

// four-point stars around the front half of the trail, a new set every frame
function sparkles(og, runs, st, cols, seed, frame, alpha, maxW, at) {
  const K = Math.max(0, Math.min(80, st.sparkles | 0));
  if (!K) return;
  const r = runs[runs.length - 1];
  og.globalCompositeOperation = "lighter";
  const P = rng(seed * 7 + frame * 131);
  const size = Math.max(1, +st.sparkleSize || 6) * Math.max(0.6, maxW / 40);
  for (let k = 0; k < K; k++) {
    const u = 0.35 + 0.65 * Math.pow(P(), 0.7);
    let i = 1;
    while (i < r.length - 1 && r[i].u < u) i++;
    const v = -0.3 + 1.6 * P();
    const p = at(r[i], v);
    const tw = Math.pow(P(), 1.4) * alpha;
    const s = size * (0.4 + 0.9 * P()) * (0.6 + 0.6 * tw);
    if (tw < 0.08) continue;
    star(og, p, s, colorAcross(cols, clamp01(v)), tw, P() * 0.4);
  }
  og.globalCompositeOperation = "source-over";
}

function star(og, p, s, c, a, tilt) {
  const halo = og.createRadialGradient(p[0], p[1], 0, p[0], p[1], s);
  halo.addColorStop(0, `rgba(255,255,255,${(0.9 * a).toFixed(3)})`);
  halo.addColorStop(0.3, rgba(c, 0.4 * a));
  halo.addColorStop(1, rgba(c, 0));
  og.fillStyle = halo;
  og.beginPath(); og.arc(p[0], p[1], s, 0, Math.PI * 2); og.fill();
  const ca = Math.cos(tilt), sa = Math.sin(tilt);
  for (const [dx, dy, len] of [[ca, sa, s * 1.8], [-sa, ca, s * 1.2]]) {
    const x0 = p[0] - dx * len, y0 = p[1] - dy * len, x1 = p[0] + dx * len, y1 = p[1] + dy * len;
    const ray = og.createLinearGradient(x0, y0, x1, y1);
    ray.addColorStop(0, "rgba(255,255,255,0)");
    ray.addColorStop(0.5, `rgba(255,255,255,${(0.95 * a).toFixed(3)})`);
    ray.addColorStop(1, "rgba(255,255,255,0)");
    og.strokeStyle = ray;
    og.lineWidth = Math.max(0.6, s / 6);
    og.beginPath(); og.moveTo(x0, y0); og.lineTo(x1, y1); og.stroke();
  }
  // the lens streak: long and faint, always level
  const fl = s * 4.5, fx = og.createLinearGradient(p[0] - fl, p[1], p[0] + fl, p[1]);
  fx.addColorStop(0, rgba(c, 0));
  fx.addColorStop(0.5, rgba(c, 0.45 * a));
  fx.addColorStop(1, rgba(c, 0));
  og.strokeStyle = fx;
  og.lineWidth = Math.max(0.5, s / 10);
  og.beginPath(); og.moveTo(p[0] - fl, p[1]); og.lineTo(p[0] + fl, p[1]); og.stroke();
}

// a starburst where the swing starts: rays, a bright dot and an expanding ring,
// strongest on the first frame and gone after a few
function flash(og, run, st, coreC, rimC, seed, frame, age, alpha, amount) {
  const f = amount * clamp01(1 - age / 4) * alpha;
  if (f <= 0.01) return;
  const s0 = run[0], L = Math.max(4, widthOf(s0));
  const c = lerp(s0.a, s0.b, 0.8);
  const R = L * (0.7 + 0.15 * age);
  const P = rng(seed * 13 + 5), F = rng(seed * 17 + frame * 59);
  og.globalCompositeOperation = "lighter";
  const gl = og.createRadialGradient(c[0], c[1], 0, c[0], c[1], R * 0.9);
  gl.addColorStop(0, rgba(coreC, 0.9 * f));
  gl.addColorStop(0.15, rgba(rimC, 0.45 * f));
  gl.addColorStop(1, rgba(rimC, 0));
  og.fillStyle = gl;
  og.beginPath(); og.arc(c[0], c[1], R * 0.9, 0, Math.PI * 2); og.fill();
  // rays: a few long bright ones on a diagonal, many short soft ones around
  og.lineCap = "round";
  const main = P() * Math.PI;
  const rays = [];
  for (let k = 0; k < 2; k++) rays.push([main + k * Math.PI + (P() - 0.5) * 0.15, R * (1.0 + 0.4 * P()), 1]);
  for (let k = 0; k < 12; k++) rays.push([P() * Math.PI * 2, R * (0.35 + 0.6 * P()), 0.35 + 0.3 * F()]);
  for (const [th, len, b] of rays) {
    const x1 = c[0] + Math.cos(th) * len, y1 = c[1] + Math.sin(th) * len;
    const g = og.createLinearGradient(c[0], c[1], x1, y1);
    g.addColorStop(0, rgba(coreC, f * b));
    g.addColorStop(0.35, rgba(rimC, 0.7 * f * b));
    g.addColorStop(1, rgba(rimC, 0));
    og.strokeStyle = g;
    og.lineWidth = Math.max(0.8, L / (b === 1 ? 22 : 40));
    og.beginPath(); og.moveTo(c[0], c[1]); og.lineTo(x1, y1); og.stroke();
  }
  // the ring grows as it fades
  og.globalCompositeOperation = "source-over";
  og.strokeStyle = rgba(rimC, 0.7 * f);
  og.lineWidth = Math.max(0.8, L / 50);
  og.beginPath(); og.arc(c[0], c[1], R * (0.25 + 0.12 * age), 0, Math.PI * 2); og.stroke();
  og.fillStyle = `rgba(255,255,255,${f.toFixed(3)})`;
  og.beginPath(); og.arc(c[0], c[1], Math.max(1, L * 0.05), 0, Math.PI * 2); og.fill();
}

// ink-like splatter thrown off the blade: each splat is born on one stick of the
// swing, flies a little way outward and stays there until the trail dissolves
function splatter(og, run, w, h, st, col, seed, age, alpha, amount) {
  const K = Math.round(amount * 14);
  if (!K || alpha <= 0.01) return;
  const S = createCanvas(w, h), sg = S.getContext("2d");
  const first = age - (run.length - 1);                 // frame (relative to the swing) of run[0]
  let any = false, size = 1;
  for (const s of run) size = Math.max(size, widthOf(s));
  for (let k = 0; k < K; k++) {
    const R = rng(seed * 101 + k * 7919);
    const bi = 1 + Math.floor(R() * Math.max(1, Math.min(run.length, 8) - 1) * 1.6);
    const since = age - (first + bi);
    if (since < 0 || bi >= run.length) continue;
    const s = run[bi];
    const base = lerp(s.a, s.b, 0.6 + 0.6 * R());
    let dx = s.b[0] - s.a[0], dy = s.b[1] - s.a[1];
    const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
    const turn = (R() - 0.5) * 2.2;
    const ux = dx * Math.cos(turn) - dy * Math.sin(turn), uy = dx * Math.sin(turn) + dy * Math.cos(turn);
    const travel = size * (0.05 + 0.3 * R()) * (1 - Math.exp(-(since + 1) / 1.6));
    const p = [base[0] + ux * travel, base[1] + uy * travel];
    const grow = Math.min(1, (since + 1) / 2);
    const r = size * (0.03 + 0.05 * R()) * grow;
    const a = alpha * 0.9;
    sg.fillStyle = rgba(col, a);
    // the blob: a few overlapping circles
    const n = 3 + Math.floor(R() * 4);
    for (let i = 0; i < n; i++) {
      const o = r * 0.7 * R(), th = R() * Math.PI * 2;
      sg.beginPath(); sg.arc(p[0] + Math.cos(th) * o, p[1] + Math.sin(th) * o, r * (0.4 + 0.5 * R()), 0, Math.PI * 2); sg.fill();
    }
    // droplets flung further along its direction, getting smaller
    const m = 2 + Math.floor(R() * 5);
    for (let i = 0; i < m; i++) {
      const sp = (R() - 0.5) * 1.2, d = r * (1.4 + 2.6 * R()) * (0.6 + 0.4 * grow);
      const ex = ux * Math.cos(sp) - uy * Math.sin(sp), ey = ux * Math.sin(sp) + uy * Math.cos(sp);
      sg.beginPath(); sg.arc(p[0] + ex * d, p[1] + ey * d, Math.max(0.5, r * (0.1 + 0.25 * R())), 0, Math.PI * 2); sg.fill();
    }
    any = true;
  }
  if (!any) return;
  og.globalAlpha = 0.55;
  og.filter = `blur(${Math.max(1, size / 30)}px)`;
  og.drawImage(S, 0, 0);
  og.filter = "none";
  og.globalAlpha = 1;
  og.drawImage(S, 0, 0);
}

// the uv map at half size: { k, mw, mh, d } (d: RGBA, r = u, g = v, a = covered)
function halfUV(runs, w, h) {
  const k = 2, mw = Math.ceil(w / k), mh = Math.ceil(h / k);
  const sc = (q) => ({ a: [q.a[0] / k, q.a[1] / k], b: [q.b[0] / k, q.b[1] / k], u: q.u });
  const segs = [];
  for (const r of runs) for (let i = 1; i < r.length; i++) segs.push([sc(r[i - 1]), sc(r[i])]);
  return { k, mw, mh, d: uvMap(segs, mw, mh, false) };
}

// smooth fractal value noise, 3 octaves, 0..1
function fbmNoise(seed) {
  const hash = (x, y) => {
    let v = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ seed;
    v = Math.imul(v ^ (v >>> 13), 1274126177);
    return ((v ^ (v >>> 16)) >>> 0) / 4294967295;
  };
  const one = (x, y) => {
    const ix = Math.floor(x), iy = Math.floor(y);
    let tx = x - ix, ty = y - iy;
    tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
    const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  };
  return (x, y) => one(x, y) * 0.55 + one(x * 2.1 + 17.3, y * 2.1 + 3.1) * 0.3 + one(x * 4.3 + 7.7, y * 4.3 + 29.5) * 0.15;
}

// The flowing body (流体): noise warped by noise, stretched along the swing and
// moving a little every frame — licks of fire, rushing water, swirling energy.
// It hugs the leading edge; toward the grip side it breaks into tongues. Hot
// colours (and the core colour) near the edge, the darker ones inward.
function flowLayer(UV, cols, coreC, seed, frame, alpha, tail, amount) {
  const { mw, mh, d } = UV;
  const img = new ImageData(mw, mh), o = img.data;
  const fbm = fbmNoise(seed * 13 + 7), t = frame * 0.35;
  for (let i = 0; i < mw * mh * 4; i += 4) {
    const cov = d[i + 3];
    if (cov < 8) continue;
    const u = d[i] / 255, v = d[i + 1] / 255;
    const wx = fbm(u * 4 - t * 0.4, v * 3), wy = fbm(u * 4 + 9.1, v * 3 + 4.7 - t * 0.3);
    const n = fbm(u * 13 + (wx - 0.5) * 3 - t, v * 5 + (wy - 0.5) * 2.4);
    const body = v * 1.25 + (n - 0.5) * 1.8 * amount;
    const m = smooth(0.42, 0.58, body) * smooth(0, tail, u);
    if (m <= 0.01) continue;
    const lum = smooth(0.25, 0.75, n);                     // dark folds between the licks
    const heat = clamp01(v * 0.7 + (lum - 0.5) * 0.8 + 0.15);
    let c = colorAcross(cols, heat);
    if (heat > 0.85) { const k = (heat - 0.85) / 0.15; c = [0, 1, 2].map((j) => Math.round(c[j] + (coreC[j] - c[j]) * k)); }
    o[i] = c[0]; o[i + 1] = c[1]; o[i + 2] = c[2];
    o[i + 3] = Math.round(255 * m * (0.3 + 0.7 * lum) * alpha * (0.5 + 0.5 * amount) * (cov / 255));
  }
  const F = createCanvas(mw, mh);
  F.getContext("2d").putImageData(img, 0, 0);
  return F;
}

// fine dust (粒子): lots of tiny specks over the trail and just inside it, fixed
// to the trail so they ride with it, twinkling frame to frame
function dust(og, runs, cols, seed, frame, alpha, maxW, at, amount) {
  const N = Math.round(amount * 140);
  if (!N) return;
  const r = runs[runs.length - 1];
  const R = rng(seed * 91 + 3), T = rng(seed * 17 + frame * 389);
  const unit = Math.max(0.6, maxW / 90);
  og.globalCompositeOperation = "lighter";
  for (let k = 0; k < N; k++) {
    const u = Math.pow(R(), 0.6), v = 1.05 - Math.pow(R(), 0.8) * 1.35;
    const size = unit * (0.5 + 1.6 * Math.pow(R(), 3));
    const tw = (0.3 + 0.7 * T()) * alpha;
    let i = 1;
    while (i < r.length - 1 && r[i].u < u) i++;
    const p = at(r[i], v);
    const c = colorAcross(cols, clamp01(v + 0.3));
    og.fillStyle = rgba([0, 1, 2].map((j) => Math.round(c[j] + (255 - c[j]) * 0.5)), tw * (0.4 + 0.6 * u));
    og.beginPath(); og.arc(p[0], p[1], size, 0, Math.PI * 2); og.fill();
  }
  og.globalCompositeOperation = "source-over";
}

// one ice crystal: a long kite pointed at both ends, split down its length into
// a light face and a shaded face with a bright ridge between them — the look of
// a faceted shard catching the light. along / out: unit vectors (its length
// runs along `along`); light: the bright colour, dark: the shaded one.
function crystal(og, c, along, out, len, wid, light, dark, ridge, a) {
  const f = [c[0] + along[0] * len * 0.62, c[1] + along[1] * len * 0.62];
  const bk = [c[0] - along[0] * len * 0.38, c[1] - along[1] * len * 0.38];
  const s1 = [c[0] + out[0] * wid * 0.5 + along[0] * len * 0.06, c[1] + out[1] * wid * 0.5 + along[1] * len * 0.06];
  const s2 = [c[0] - out[0] * wid * 0.42 - along[0] * len * 0.04, c[1] - out[1] * wid * 0.42 - along[1] * len * 0.04];
  const tri = (p, q, r, col) => { og.fillStyle = col; og.beginPath(); og.moveTo(p[0], p[1]); og.lineTo(q[0], q[1]); og.lineTo(r[0], r[1]); og.closePath(); og.fill(); };
  tri(f, s1, bk, rgba(light, 0.8 * a));
  tri(f, bk, s2, rgba(dark, 0.7 * a));
  og.strokeStyle = rgba(ridge, 0.9 * a);
  og.lineWidth = Math.max(0.5, wid / 9);
  og.beginPath(); og.moveTo(f[0], f[1]); og.lineTo(bk[0], bk[1]); og.stroke();
}

// Shards (碎片): ice crystals breaking off the blade's edge. Each is born on one
// stick of the swing, near its outer half, lying along the swing; it drifts a
// little back and out and fades over several frames.
function shards(og, run, cols, coreC, seed, age, alpha, amount) {
  const K = Math.round(amount * 14);
  if (!K || alpha <= 0.01 || run.length < 2) return;
  const first = age - (run.length - 1);
  const light = colorAcross(cols, 0.85), dark = colorAcross(cols, 0.4);
  for (let k = 0; k < K; k++) {
    const R = rng(seed * 53 + k * 7907);
    const bi = 1 + Math.floor(R() * Math.max(1, Math.min(run.length, 8) - 1) * 1.5);
    const since = age - (first + bi);
    if (since < 0 || bi >= run.length) continue;
    const s = run[bi], p = run[bi - 1], L = widthOf(s);
    const life = alpha * clamp01(1 - since / 8);
    if (life <= 0.02) continue;
    let ox = s.b[0] - s.a[0], oy = s.b[1] - s.a[1];                 // out of the blade
    const ol = Math.hypot(ox, oy) || 1; ox /= ol; oy /= ol;
    let tx = s.b[0] - p.b[0], ty = s.b[1] - p.b[1];                 // the way the blade moves
    const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
    const c0 = lerp(s.a, s.b, 0.55 + 0.5 * R());
    const drift = L * (0.04 + 0.2 * R()) * (1 - Math.exp(-(since + 1) / 2));
    const c = [c0[0] - tx * drift * 1.5 + ox * drift * (R() - 0.3), c0[1] - ty * drift * 1.5 + oy * drift * (R() - 0.3)];
    const tilt = (R() - 0.5) * 0.7, ct = Math.cos(tilt), st = Math.sin(tilt);
    const along = [tx * ct - ty * st, tx * st + ty * ct], out = [-along[1], along[0]];
    const len = L * (0.16 + 0.24 * R()), wid = len * (0.22 + 0.16 * R());
    crystal(og, c, along, out, len, wid, light, dark, coreC, life);
  }
}

// Crystal (结晶): the front of the trail built from packed ice crystals along
// the leading edge, all lying along the swing — the faceted, jagged crescent of
// an ice slash. Fixed to the trail, so they ride with it.
function crystals(runs, w, h, cols, coreC, seed, alpha, tail, maxW, amount) {
  const r = runs[runs.length - 1];
  if (r.length < 2) return null;
  const N = Math.round(amount * 46);
  const S = rng(seed * 113 + 9);
  const C = createCanvas(w, h), g = C.getContext("2d");
  const light = colorAcross(cols, 0.9), dark = colorAcross(cols, 0.45);
  for (let k = 0; k < N; k++) {
    const u = 0.35 + 0.65 * Math.pow(S(), 0.6);
    const v = 0.5 + 0.5 * Math.pow(S(), 0.7);
    const { pt, across } = onRun(r, u, v);
    const behind = onRun(r, Math.max(0, u - 0.03), v).pt;
    let tx = pt[0] - behind[0], ty = pt[1] - behind[1];
    const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
    const tilt = (S() - 0.5) * 0.5, ct = Math.cos(tilt), st = Math.sin(tilt);
    const along = [tx * ct - ty * st, tx * st + ty * ct], out = [across[0], across[1]];
    const L = maxW * (0.5 + 0.5 * u);
    const len = L * (0.18 + 0.3 * S()), wid = len * (0.25 + 0.2 * S());
    const a = alpha * smooth(0, tail, u) * (0.5 + 0.5 * u);
    if (a <= 0.03) continue;
    crystal(g, pt, along, out, len, wid, light, dark, coreC, a);
  }
  return C;
}

// Speed lines (速度线): long straight streaks left behind the head, running back
// along the swing — straight, not following the curve, as if the air was cut.
// Their length flickers frame to frame.
function speedLines(runs, w, h, coreC, rimC, seed, frame, alpha, maxW, amount) {
  const r = runs[runs.length - 1];
  if (r.length < 2) return null;
  const N = Math.round(amount * 22);
  const S = rng(seed * 131 + 3), P = rng(seed * 131 + frame * 557 + 1);
  const C = createCanvas(w, h), g = C.getContext("2d");
  g.lineCap = "round";
  for (let k = 0; k < N; k++) {
    const u = 0.55 + 0.45 * Math.pow(S(), 0.5), v = 0.15 + 0.9 * S();
    const { pt } = onRun(r, u, v);
    const behind = onRun(r, Math.max(0, u - 0.04), v).pt;
    let bx = behind[0] - pt[0], by = behind[1] - pt[1];
    const bl = Math.hypot(bx, by) || 1; bx /= bl; by /= bl;
    const len = maxW * (0.8 + 2.2 * Math.pow(S(), 1.5)) * (0.6 + 0.6 * P());
    const end = [pt[0] + bx * len, pt[1] + by * len];
    const a = alpha * (0.35 + 0.5 * P()) * u;
    const gr = g.createLinearGradient(pt[0], pt[1], end[0], end[1]);
    gr.addColorStop(0, rgba(coreC, 0.85 * a));
    gr.addColorStop(0.3, rgba(rimC, 0.5 * a));
    gr.addColorStop(1, rgba(rimC, 0));
    g.strokeStyle = gr;
    g.lineWidth = Math.max(0.6, maxW / (30 + 50 * S()));
    g.beginPath(); g.moveTo(pt[0], pt[1]); g.lineTo(end[0], end[1]); g.stroke();
  }
  return C;
}

// Snow (雪花): six-armed snowflakes with side branches around the trail, turning
// slowly and twinkling, fixed to the trail
function snow(og, runs, coreC, rimC, seed, frame, alpha, maxW, at, amount) {
  const N = Math.round(amount * 26);
  if (!N) return;
  const r = runs[runs.length - 1];
  const R = rng(seed * 149 + 5), T = rng(seed * 151 + frame * 263);
  og.globalCompositeOperation = "lighter";
  og.lineCap = "round";
  for (let k = 0; k < N; k++) {
    const u = 0.15 + 0.85 * Math.pow(R(), 0.7), v = -0.35 + 1.6 * R();
    const size = maxW * (0.05 + 0.08 * Math.pow(R(), 2));
    const spin = R() * Math.PI + frame * (R() - 0.5) * 0.3;
    const tw = (0.35 + 0.65 * T()) * alpha * (0.4 + 0.6 * u);
    let i = 1;
    while (i < r.length - 1 && r[i].u < u) i++;
    const p = at(r[i], v);
    if (tw < 0.06) continue;
    // a soft glow behind it
    const halo = og.createRadialGradient(p[0], p[1], 0, p[0], p[1], size * 1.2);
    halo.addColorStop(0, rgba(rimC, 0.35 * tw));
    halo.addColorStop(1, rgba(rimC, 0));
    og.fillStyle = halo;
    og.beginPath(); og.arc(p[0], p[1], size * 1.2, 0, Math.PI * 2); og.fill();
    og.strokeStyle = rgba(coreC, 0.9 * tw);
    og.lineWidth = Math.max(0.5, size / 9);
    og.beginPath();
    for (let arm = 0; arm < 6; arm++) {
      const th = spin + (arm * Math.PI) / 3, dx = Math.cos(th), dy = Math.sin(th);
      og.moveTo(p[0], p[1]); og.lineTo(p[0] + dx * size, p[1] + dy * size);
      // two pairs of side branches, swept toward the tip
      for (const [at0, bl] of [[0.45, 0.32], [0.7, 0.22]]) {
        const bx = p[0] + dx * size * at0, by = p[1] + dy * size * at0;
        for (const sgn of [1, -1]) {
          const bt = th + sgn * Math.PI / 3;
          og.moveTo(bx, by); og.lineTo(bx + Math.cos(bt) * size * bl, by + Math.sin(bt) * size * bl);
        }
      }
    }
    og.stroke();
  }
  og.globalCompositeOperation = "source-over";
}

// the impact burst (命中爆点) where the swing ends: a hot flash, rays and debris
// flung out, growing and fading over the frames after the last stick
function impact(og, run, coreC, rimC, splatC, seed, frame, after, opacity, amount) {
  const f = amount * opacity * clamp01(1 - after / 4);
  if (f <= 0.01) return;
  const last = run[run.length - 1], prev = run[run.length - 2];
  const L = Math.max(4, widthOf(last));
  let c = lerp(last.a, last.b, 0.85);
  if (prev) {
    const dx = last.b[0] - prev.b[0], dy = last.b[1] - prev.b[1], dl = Math.hypot(dx, dy);
    if (dl > 1e-3) c = [c[0] + dx / dl * L * 0.18, c[1] + dy / dl * L * 0.18];
  }
  const R0 = L * (0.55 + 0.3 * after);
  const P = rng(seed * 29 + 11), F = rng(seed * 37 + frame * 71);
  og.globalCompositeOperation = "lighter";
  const gl = og.createRadialGradient(c[0], c[1], 0, c[0], c[1], R0);
  gl.addColorStop(0, rgba(coreC, 0.95 * f));
  gl.addColorStop(0.25, rgba(rimC, 0.6 * f));
  gl.addColorStop(1, rgba(rimC, 0));
  og.fillStyle = gl;
  og.beginPath(); og.arc(c[0], c[1], R0, 0, Math.PI * 2); og.fill();
  // sharp spikes flung out: the pointed burst of 2D impact effects
  for (let k = 0; k < 10; k++) {
    const th = P() * Math.PI * 2, len = R0 * (0.8 + 1.0 * P()) * (0.8 + 0.4 * F()), wid = R0 * (0.06 + 0.1 * P());
    const ex = c[0] + Math.cos(th) * len, ey = c[1] + Math.sin(th) * len, nx = -Math.sin(th) * wid, ny = Math.cos(th) * wid;
    const sg = og.createLinearGradient(c[0], c[1], ex, ey);
    sg.addColorStop(0, rgba(coreC, 0.85 * f));
    sg.addColorStop(0.45, rgba(rimC, 0.5 * f));
    sg.addColorStop(1, rgba(rimC, 0));
    og.fillStyle = sg;
    og.beginPath(); og.moveTo(c[0] + nx, c[1] + ny); og.lineTo(ex, ey); og.lineTo(c[0] - nx, c[1] - ny); og.closePath(); og.fill();
  }
  og.lineCap = "round";
  for (let k = 0; k < 18; k++) {
    const th = P() * Math.PI * 2, len = R0 * (0.6 + 1.1 * P()) * (0.8 + 0.4 * F());
    const x1 = c[0] + Math.cos(th) * len, y1 = c[1] + Math.sin(th) * len;
    const g = og.createLinearGradient(c[0], c[1], x1, y1);
    g.addColorStop(0, rgba(coreC, 0.9 * f));
    g.addColorStop(0.4, rgba(rimC, 0.5 * f));
    g.addColorStop(1, rgba(rimC, 0));
    og.strokeStyle = g;
    og.lineWidth = Math.max(0.7, L / (k < 4 ? 30 : 60));
    og.beginPath(); og.moveTo(c[0], c[1]); og.lineTo(x1, y1); og.stroke();
  }
  // debris: solid bits flying out
  og.globalCompositeOperation = "source-over";
  for (let k = 0; k < 26; k++) {
    const th = P() * Math.PI * 2, dist = R0 * (0.3 + 1.0 * P()) * (0.6 + 0.4 * after);
    const r = L * (0.008 + 0.025 * Math.pow(P(), 2));
    og.fillStyle = rgba(splatC, 0.9 * f);
    og.beginPath(); og.arc(c[0] + Math.cos(th) * dist, c[1] + Math.sin(th) * dist, Math.max(0.6, r), 0, Math.PI * 2); og.fill();
  }
}

// Lightning (闪电): a few jagged bolts running along the blade, each made by
// midpoint displacement (every segment split and its middle knocked sideways,
// less at each level), with forks breaking off it, mostly outward past the
// edge. A fresh set every frame, so it flickers. Each bolt is a band whose width
// changes along it — thick near its root, thinning to a point, swelling and
// pinching on the way — and a fork starts as thick as the bolt where it splits
// off and tapers from there. Drawn as a wide glow in the rim colour under a
// white-hot core of the same shape.
function bolts(runs, w, h, coreC, rimC, seed, frame, alpha, maxW, amount) {
  if (amount <= 0 || alpha <= 0.01) return null;
  const r = runs[runs.length - 1];
  if (r.length < 2) return null;
  const P = rng(seed * 61 + frame * 1297 + 5);
  // a point at (u, v) on the ribbon, interpolated between sections
  const sample = (u, v) => {
    let i = 1;
    while (i < r.length - 1 && r[i].u < u) i++;
    const p = r[i - 1], q = r[i], t = clamp01((u - p.u) / ((q.u - p.u) || 1));
    const a = lerp(p.a, p.b, v), b = lerp(q.a, q.b, v);
    return { pt: lerp(a, b, t), out: [q.b[0] - q.a[0], q.b[1] - q.a[1]] };
  };
  const jag = (pts, rough, depth) => {
    let cur = pts;
    for (let d = 0; d < depth; d++, rough *= 0.55) {
      const next = [cur[0]];
      for (let i = 1; i < cur.length; i++) {
        const a = cur[i - 1], b = cur[i];
        const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
        const off = (P() - 0.5) * len * rough;
        next.push([(a[0] + b[0]) / 2 - dy / len * off, (a[1] + b[1]) / 2 + dx / len * off], b);
      }
      cur = next;
    }
    return cur;
  };
  // relative widths along a path: from w0 to w1, with a smoothed random swell
  // and pinch; a bolt (not a fork) also narrows into its very first stretch
  const widths = (n, w0, w1, root) => {
    const out = [];
    let r = 1;
    for (let i = 0; i < n; i++) {
      const t = n > 1 ? i / (n - 1) : 0;
      r = 0.6 * r + 0.4 * (0.5 + P());
      const start = root ? 0.35 + 0.65 * smooth(0, 0.1, t) : 1;
      out.push(Math.max(0.04, (w0 + (w1 - w0) * t) * r * start));
    }
    return out;
  };
  const paths = [];
  const count = 1 + Math.round(amount * 3);
  for (let k = 0; k < count; k++) {
    const u0 = 0.12 + 0.45 * P(), v0 = 0.45 + 0.5 * P();
    const pts = [];
    for (let s = 0; s <= 6; s++) pts.push(sample(u0 + (1 - u0) * s / 6, Math.max(0.1, Math.min(1.05, v0 + (P() - 0.5) * 0.4))).pt);
    const main = jag(pts, 0.5, 4);
    const mw = widths(main.length, 1, 0.25, true);
    paths.push([main, mw]);
    const forks = 1 + Math.floor(P() * 3 * amount + 0.5);
    for (let f = 0; f < forks; f++) {
      const at = Math.floor(main.length * (0.2 + 0.7 * P()));
      const start = main[Math.min(main.length - 1, at)];
      const { out } = sample(u0 + (1 - u0) * at / main.length, 1);
      const ol = Math.hypot(out[0], out[1]) || 1, side = P() < 0.75 ? 1 : -1, turn = (P() - 0.5) * 1.4;
      let dx = out[0] / ol * side, dy = out[1] / ol * side;
      [dx, dy] = [dx * Math.cos(turn) - dy * Math.sin(turn), dx * Math.sin(turn) + dy * Math.cos(turn)];
      const len = maxW * (0.25 + 0.55 * P());
      const fork = jag([start, [start[0] + dx * len, start[1] + dy * len]], 0.6, 3);
      paths.push([fork, widths(fork.length, mw[Math.min(mw.length - 1, at)] * 0.7, 0.06, false)]);
    }
  }
  const B = createCanvas(w, h), g = B.getContext("2d");
  const flick = alpha * (0.75 + 0.25 * P());
  // a path as a filled band, ws[i] × scale wide at point i
  const band = (pts, ws, scale) => {
    const L = [], Rt = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      let dx = b[0] - a[0], dy = b[1] - a[1];
      const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
      const half = (ws[i] * scale) / 2;
      L.push([p[0] - dy * half, p[1] + dx * half]);
      Rt.push([p[0] + dy * half, p[1] - dx * half]);
    }
    g.beginPath();
    L.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
    for (let i = Rt.length - 1; i >= 0; i--) g.lineTo(Rt[i][0], Rt[i][1]);
    g.closePath();
    g.fill();
  };
  const glowW = Math.max(3, maxW / 6), coreW = Math.max(1.4, maxW / 22);
  g.fillStyle = rgba(rimC, 0.4 * flick);
  for (const [pts, ws] of paths) band(pts, ws, glowW);
  g.fillStyle = rgba(coreC, 0.95 * flick);
  for (const [pts, ws] of paths) band(pts, ws, coreW);
  return B;
}

// a point on the last run at (u, v), interpolated between sections, with the
// section's across vector (inner -> outer)
function onRun(r, u, v) {
  let i = 1;
  while (i < r.length - 1 && r[i].u < u) i++;
  const p = r[i - 1], q = r[i], t = clamp01((u - p.u) / ((q.u - p.u) || 1));
  const a = lerp(p.a, p.b, v), b = lerp(q.a, q.b, v);
  const ax = q.b[0] - q.a[0], ay = q.b[1] - q.a[1], al = Math.hypot(ax, ay) || 1;
  return { pt: lerp(a, b, t), across: [ax / al, ay / al] };
}

// Flames (火舌): soft tongues of fire growing out of the body and streaming
// back along the trail, the way flames trail behind something moving fast.
// They root inside the ribbon (mostly its inner half; bright fire also licks a
// little over the leading edge) and lean only slightly away from the blade.
// Where they sit is fixed per trail; their length, lean and sway change every
// frame, so they flicker. Bright fire is added as light and softened a touch.
// Black fire is painted dark, over a blurred halo of the rim colour, so it
// glows at its edges instead of being outlined.
function flames(runs, w, h, cols, coreC, rimC, seed, frame, alpha, tail, maxW, amount, dark) {
  const r = runs[runs.length - 1];
  if (r.length < 2) return null;
  const N = Math.round(amount * 26);
  const S = rng(seed * 71 + 1), P = rng(seed * 71 + frame * 733 + 2);
  const T = createCanvas(w, h), g = T.getContext("2d");
  const G = dark ? createCanvas(w, h) : null, gg = G && G.getContext("2d");
  for (let k = 0; k < N; k++) {
    const u = 0.15 + 0.85 * Math.pow(S(), 0.7);
    const outer = !dark && S() < 0.2;
    const vb = outer ? 0.9 + 0.06 * S() : 0.3 + 0.4 * S();
    const { pt: B, across } = onRun(r, u, vb);
    const back0 = onRun(r, Math.max(0, u - 0.04), vb).pt;
    let bx = back0[0] - B[0], by = back0[1] - B[1];
    const bl = Math.hypot(bx, by) || 1; bx /= bl; by /= bl;          // toward the tail
    const nx = outer ? across[0] : -across[0], ny = outer ? across[1] : -across[1];   // away from the blade
    const len = maxW * (0.2 + 0.4 * S()) * (0.75 + 0.45 * P()) * (0.5 + 0.5 * u);
    const wid = len * (0.3 + 0.2 * S());
    const lean = 0.15 + 0.2 * P();
    const tip = [B[0] + bx * len + nx * len * lean, B[1] + by * len + ny * len * lean];
    // the root lies along the trail, a little ahead of B; the sides bow out
    // and the tip whips to one side (an S-ish lick)
    const b1 = [B[0] - bx * wid * 0.6 + nx * wid * 0.3, B[1] - by * wid * 0.6 + ny * wid * 0.3];
    const b2 = [B[0] - bx * wid * 0.2 - nx * wid * 0.5, B[1] - by * wid * 0.2 - ny * wid * 0.5];
    const px = -(tip[1] - B[1]), py = tip[0] - B[0], pl = Math.hypot(px, py) || 1;
    const whip = (P() - 0.5) * wid * 1.4;
    const c1 = [(b1[0] + tip[0]) / 2 + px / pl * (wid * 0.5 + whip), (b1[1] + tip[1]) / 2 + py / pl * (wid * 0.5 + whip)];
    const c2 = [(b2[0] + tip[0]) / 2 - px / pl * (wid * 0.35 - whip), (b2[1] + tip[1]) / 2 - py / pl * (wid * 0.35 - whip)];
    const a = alpha * smooth(0, tail, u) * (0.55 + 0.45 * u);
    if (a <= 0.02) continue;
    const shape = (c) => { c.beginPath(); c.moveTo(b1[0], b1[1]); c.quadraticCurveTo(c1[0], c1[1], tip[0], tip[1]); c.quadraticCurveTo(c2[0], c2[1], b2[0], b2[1]); c.closePath(); };
    const gr = g.createLinearGradient(B[0], B[1], tip[0], tip[1]);
    gr.addColorStop(0, rgba(cols[dark ? 1 : 3], 0.85 * a));
    gr.addColorStop(0.55, rgba(cols[dark ? 0 : 2], 0.5 * a));
    gr.addColorStop(1, rgba(cols[dark ? 0 : 1], 0));
    g.fillStyle = gr;
    shape(g); g.fill();
    if (dark) {
      // its glow: the same lick in the rim colour, blurred under it later
      const eg = gg.createLinearGradient(B[0], B[1], tip[0], tip[1]);
      eg.addColorStop(0, rgba(rimC, 0.7 * a));
      eg.addColorStop(1, rgba(rimC, 0));
      gg.fillStyle = eg;
      shape(gg); gg.fill();
    } else if (S() < 0.5) {
      // a hot inner lick
      const m = (p, t) => lerp(B, p, t);
      g.fillStyle = rgba(coreC, 0.45 * a);
      g.beginPath(); g.moveTo(...m(b1, 0.5)); g.quadraticCurveTo(...m(c1, 0.5), ...m(tip, 0.55)); g.quadraticCurveTo(...m(c2, 0.5), ...m(b2, 0.5)); g.closePath(); g.fill();
    }
  }
  const out = createCanvas(w, h), og = out.getContext("2d");
  if (dark) {
    og.filter = `blur(${Math.max(1.5, maxW / 30)}px)`;
    og.drawImage(G, 0, 0);
    og.filter = `blur(${Math.max(0.5, maxW / 160)}px)`;
    og.drawImage(T, 0, 0);
  } else {
    og.filter = `blur(${Math.max(0.5, maxW / 90)}px)`;
    og.drawImage(T, 0, 0);
  }
  og.filter = "none";
  return out;
}

// Rays (光芒): thin beams of light shining out of the leading edge, longer
// toward the head, fanning a little and flickering frame to frame
function rays(runs, w, h, coreC, rimC, seed, frame, alpha, maxW, amount) {
  const r = runs[runs.length - 1];
  if (r.length < 2) return null;
  const N = Math.round(amount * 40);
  const S = rng(seed * 97 + 4), P = rng(seed * 97 + frame * 571 + 6);
  const Rc = createCanvas(w, h), g = Rc.getContext("2d");
  g.lineCap = "round";
  for (let k = 0; k < N; k++) {
    const u = 0.25 + 0.75 * Math.pow(S(), 0.6);
    const { pt: B, across } = onRun(r, u, 0.95);
    const spread = (S() - 0.5) * 0.6;
    const dx = across[0] * Math.cos(spread) - across[1] * Math.sin(spread), dy = across[0] * Math.sin(spread) + across[1] * Math.cos(spread);
    const len = maxW * (0.4 + 1.4 * Math.pow(S(), 2)) * (0.7 + 0.5 * P()) * (0.4 + 0.6 * u);
    const a = alpha * (0.35 + 0.65 * P());
    const end = [B[0] + dx * len, B[1] + dy * len];
    const gr = g.createLinearGradient(B[0], B[1], end[0], end[1]);
    gr.addColorStop(0, rgba(coreC, 0.75 * a));
    gr.addColorStop(0.35, rgba(rimC, 0.35 * a));
    gr.addColorStop(1, rgba(rimC, 0));
    g.strokeStyle = gr;
    g.lineWidth = Math.max(0.8, maxW / (35 + 60 * S()));
    g.beginPath(); g.moveTo(B[0], B[1]); g.lineTo(end[0], end[1]); g.stroke();
  }
  return Rc;
}

// Embers (余烬): glowing sparks thrown off the swing that rise, sway and burn
// out over several frames — they outlive the trail itself a little
function embers(og, run, coreC, rimC, seed, frame, age, opacity, maxW, amount, dark) {
  const K = Math.round(amount * 34);
  if (!K || run.length < 1) return;
  const first = age - (run.length - 1);
  const hot = dark ? [0, 1, 2].map((j) => Math.round(rimC[j] + (255 - rimC[j]) * 0.45)) : coreC;
  const F = rng(seed * 89 + frame * 313);
  og.globalCompositeOperation = "lighter";
  for (let k = 0; k < K; k++) {
    const R = rng(seed * 83 + k * 6151);
    const bi = Math.floor(R() * run.length);
    const since = age - (first + bi + Math.floor(R() * 2));
    const life = 5 + R() * 7;
    if (since < 0 || since > life) continue;
    const s = run[bi];
    const p0 = lerp(s.a, s.b, 0.3 + 0.7 * R());
    const rise = maxW * (0.05 + 0.08 * R()) * since;
    const sway = Math.sin(since * 0.9 + R() * 6.28) * maxW * 0.05 + (R() - 0.5) * maxW * 0.08 * since;
    const p = [p0[0] + sway, p0[1] - rise];
    const fade = 1 - since / life;
    const size = Math.max(0.6, maxW * (0.01 + 0.018 * R()) * (0.5 + 0.5 * fade));
    const a = opacity * fade * (0.6 + 0.4 * F());
    const halo = og.createRadialGradient(p[0], p[1], 0, p[0], p[1], size * 3.5);
    halo.addColorStop(0, rgba(hot, 0.9 * a));
    halo.addColorStop(0.35, rgba(rimC, 0.45 * a));
    halo.addColorStop(1, rgba(rimC, 0));
    og.fillStyle = halo;
    og.beginPath(); og.arc(p[0], p[1], size * 3.5, 0, Math.PI * 2); og.fill();
  }
  og.globalCompositeOperation = "source-over";
}

// ---------- 像素光效 ----------
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

// The palette a pixelated glow snaps to: the preset's own colours sorted dark to
// bright, with an in-between shade added between every two neighbours
const palettes = new Map();
function glowPalette(st, mids = true) {
  const tc = st.tailTint > 0 && st.glowTail ? hexToRgb(st.glowTail) : null;
  const tails = tc ? [st.glowTail, toHex(tc.map((v) => Math.round(v * 0.55))), toHex(tc.map((v) => Math.round(v + (255 - v) * 0.5)))] : [];
  const src = [...(st.glowColors || GLOW_DEFAULTS.glowColors), st.glowRim, st.glowCore, st.glowSplat, ...tails].filter(Boolean);
  const key = src.join(",") + (mids ? "" : ":flat");
  if (palettes.has(key)) return palettes.get(key);
  const lum = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
  const base = [];
  for (const c of src.map(hexToRgb)) if (!base.some((b) => Math.abs(b[0] - c[0]) + Math.abs(b[1] - c[1]) + Math.abs(b[2] - c[2]) < 24)) base.push(c);
  base.sort((p, q) => lum(p) - lum(q));
  const pal = [];
  base.forEach((c, i) => {
    if (i && mids) { const p = base[i - 1]; pal.push([0, 1, 2].map((j) => Math.round(Math.sqrt((p[j] * p[j] + c[j] * c[j]) / 2)))); }
    pal.push(c);
  });
  palettes.set(key, pal);
  return pal;
}

// A glow trail as pixel art: the canvas renderGlow made is shrunk to blocks of
// size × size (averaging), every block snaps to the palette above, its opacity
// to 4 steps (or a dither / a hard edge), and it is blown back up with hard
// edges. The blocks sit on the document's grid, so they don't crawl as the
// trail moves. opts: { size: 1..8, alpha: "steps" | "dither" | "hard" }
export function pixelateGlow(src, st, opts = {}) {
  if (!src) return src;
  const k = Math.max(1, Math.min(8, opts.size | 0 || 1));
  const W = src.width, H = src.height;
  const bb = src.bbox || { x0: 0, y0: 0, w: W, h: H };
  const bx0 = Math.floor(bb.x0 / k) * k, by0 = Math.floor(bb.y0 / k) * k;
  const bw = Math.ceil((bb.x0 + bb.w - bx0) / k), bh = Math.ceil((bb.y0 + bb.h - by0) / k);
  if (bw <= 0 || bh <= 0) return src;
  const small = createCanvas(bw, bh), sg = small.getContext("2d", { willReadFrequently: true });
  sg.imageSmoothingEnabled = true;
  sg.imageSmoothingQuality = "high";
  sg.drawImage(src, bx0, by0, bw * k, bh * k, 0, 0, bw, bh);
  const img = sg.getImageData(0, 0, bw, bh), d = img.data;
  const pal = glowPalette(st);
  const mode = opts.alpha || "steps";
  const gx = bx0 / k, gy = by0 / k;
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const i = (y * bw + x) * 4;
    const a = d[i + 3] / 255;
    if (a < 0.08) { d[i + 3] = 0; continue; }
    let al;
    if (mode === "hard") al = a >= 0.4 ? 1 : 0;
    else if (mode === "dither") al = a > (BAYER[((y + gy) & 3) * 4 + ((x + gx) & 3)] + 0.5) / 16 ? 1 : 0;
    else al = a < 0.2 ? 0 : Math.max(0.25, Math.round(a * 4) / 4);   // too faint to be worth a step: gone
    if (!al) { d[i + 3] = 0; continue; }
    const r = d[i], g = d[i + 1], b = d[i + 2];
    let best = pal[0], bd = Infinity;
    for (const c of pal) {
      const dr = c[0] - r, dg = c[1] - g, db = c[2] - b;
      const dd = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
      if (dd < bd) { bd = dd; best = c; }
    }
    d[i] = best[0]; d[i + 1] = best[1]; d[i + 2] = best[2]; d[i + 3] = Math.round(al * 255);
  }
  sg.putImageData(img, 0, 0);
  const out = createCanvas(W, H), og = out.getContext("2d");
  og.imageSmoothingEnabled = false;
  og.drawImage(small, 0, 0, bw, bh, bx0, by0, bw * k, bh * k);
  return out;
}

const toHex = (c) => "#" + c.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("");

// Tail tint (尾部变色): the trail shifts toward a second colour as it goes back
// from the head — a blue tail behind a red head. A wash of that colour, strongest
// at the tail and spread over the glow around it, is laid on with the "color"
// blend: hue and saturation change, brightness doesn't, so the white-hot core
// stays white. Kept to where something was already drawn.
function tintTail(og, w, h, runs, tint, amount, maxW) {
  const M = createCanvas(w, h), mg = M.getContext("2d");
  const at = (q, v) => lerp(q.a, q.b, v);
  for (const r of runs) for (let i = 1; i < r.length; i++) {
    const p = r[i - 1], q = r[i];
    // the front quarter keeps its own colours; from there back it turns
    const back = clamp01((0.75 - (p.u + q.u) / 2) / 0.75);
    mg.fillStyle = rgba(tint, Math.min(1, amount * 1.15 * Math.pow(back, 0.8)));
    mg.beginPath();
    for (const [x, y] of [at(p, -0.6), at(p, 1.6), at(q, 1.6), at(q, -0.6)]) mg.lineTo(x, y);
    mg.fill();
  }
  const S = createCanvas(w, h), sg = S.getContext("2d");
  sg.filter = `blur(${Math.max(2, maxW / 5)}px)`;
  sg.drawImage(M, 0, 0);
  const C2 = createCanvas(w, h), cg = C2.getContext("2d");
  cg.drawImage(og.canvas, 0, 0);
  cg.globalCompositeOperation = "color";
  cg.drawImage(S, 0, 0);
  cg.globalCompositeOperation = "destination-in";
  cg.drawImage(og.canvas, 0, 0);
  og.save();
  og.globalCompositeOperation = "copy";
  og.drawImage(C2, 0, 0);
  og.restore();
}

// 色阶: a glow trail as flat, cel-shaded 2D effect art — the same recipe as the
// pixel glows (pixelateGlow) but at full resolution with smooth edges. Every
// pixel snaps to the preset's palette (its colours plus in-between shades, and
// the tail colour's when it shifts) and its opacity to a few flat steps, so soft
// glow stays a see-through layer instead of becoming a solid lump. amount 0..1:
// how hard — 6 opacity steps at the soft end, solid-or-nothing at the hard end. outline 0..1:
// an optional dark outline around the whole shape.
export function celShade(src, st, amount, outline) {
  if (!src) return src;
  const W = src.width, H = src.height;
  const bb = src.bbox || { x0: 0, y0: 0, w: W, h: H };
  const { x0, y0, w, h } = bb;
  if (w <= 0 || h <= 0) return src;
  const c = createCanvas(w, h), g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(src, x0, y0, w, h, 0, 0, w, h);
  const img = g.getImageData(0, 0, w, h), d = img.data;
  const steps = amount >= 0.75 ? 2 : amount >= 0.35 ? 4 : 6;
  // the hard end keeps to the preset's own colours: flat, clean layers, no muddy
  // blends between them
  const pal = glowPalette(st, steps > 2);
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3] / 255;
    if (a < 0.2) { d[i + 3] = 0; continue; }
    const r = d[i], gg = d[i + 1], b = d[i + 2];
    let best = pal[0], bd = Infinity;
    for (const t of pal) {
      const dr = t[0] - r, dg = t[1] - gg, db = t[2] - b;
      const dd = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
      if (dd < bd) { bd = dd; best = t; }
    }
    d[i] = best[0]; d[i + 1] = best[1]; d[i + 2] = best[2];
    // the hard end is solid or nothing: a half-see-through bright colour over a
    // dark background reads as a muddy brown
    if (steps <= 2 && a < 0.45) { d[i + 3] = 0; continue; }
    d[i + 3] = steps <= 2 ? 255 : Math.round(255 * Math.max(1 / steps, Math.round(a * steps) / steps));
  }
  g.putImageData(img, 0, 0);
  const out = createCanvas(W, H), og = out.getContext("2d");
  const ow = outline > 0 ? Math.max(1, Math.round(outline * Math.max(2, Math.max(w, h) / 140))) : 0;
  if (ow) {
    // the outline follows only the solid part of the shape, not the see-through glow
    const S = createCanvas(w, h), sg = S.getContext("2d");
    const solid = new ImageData(new Uint8ClampedArray(d), w, h);
    for (let i = 3; i < solid.data.length; i += 4) solid.data[i] = solid.data[i] >= 190 ? 255 : 0;
    sg.putImageData(solid, 0, 0);
    sg.globalCompositeOperation = "source-in";
    sg.fillStyle = rgba(pal[0], 1);
    sg.fillRect(0, 0, w, h);
    og.globalAlpha = 0.8;
    for (let k = 0; k < 8; k++) {
      const th = (k * Math.PI) / 4;
      og.drawImage(S, x0 + Math.cos(th) * ow, y0 + Math.sin(th) * ow);
    }
    og.globalAlpha = 1;
  }
  og.filter = "blur(0.35px)";
  og.drawImage(c, x0, y0);
  og.filter = "none";
  out.bbox = { x0: Math.max(0, x0 - ow), y0: Math.max(0, y0 - ow), w: w + ow * 2, h: h + ow * 2 };
  return out;
}

// Bubbles (气泡): hollow bubbles around the trail with a glint, rising slowly
// frame by frame and wobbling, fixed to the trail like the dust
function bubbles(og, runs, coreC, rimC, seed, frame, alpha, maxW, at, amount) {
  const N = Math.round(amount * 30);
  if (!N) return;
  const r = runs[runs.length - 1];
  const R = rng(seed * 167 + 7);
  og.globalCompositeOperation = "lighter";
  for (let k = 0; k < N; k++) {
    const u = 0.2 + 0.8 * Math.pow(R(), 0.7), v = -0.3 + 1.5 * R();
    const size = maxW * (0.02 + 0.045 * Math.pow(R(), 1.5));
    const speed = maxW * (0.03 + 0.05 * R()), phase = R() * 6.28;
    let i = 1;
    while (i < r.length - 1 && r[i].u < u) i++;
    const p0 = at(r[i], v);
    const p = [p0[0] + Math.sin(frame * 0.8 + phase) * size * 0.6, p0[1] - speed * (frame % 12) * 0.3];
    const a = alpha * (0.4 + 0.6 * u);
    og.strokeStyle = rgba(rimC, 0.75 * a);
    og.lineWidth = Math.max(0.6, size / 5);
    og.beginPath(); og.arc(p[0], p[1], size, 0, Math.PI * 2); og.stroke();
    og.fillStyle = rgba(rimC, 0.12 * a);
    og.fill();
    og.fillStyle = rgba(coreC, 0.9 * a);
    og.beginPath(); og.arc(p[0] - size * 0.35, p[1] - size * 0.35, Math.max(0.5, size * 0.22), 0, Math.PI * 2); og.fill();
  }
  og.globalCompositeOperation = "source-over";
}

// one stone: an irregular polygon shaded like a solid lit from the upper left —
// a gradient from the light colour to the dark one across it, a lit top facet,
// a shadowed lower facet and a thin dark outline. rnd: the random source that
// shapes it.
function rockShape(og, c, size, spin, rnd, cols, a) {
  const n = 6 + Math.floor(rnd() * 3), pts = [];
  for (let i = 0; i < n; i++) {
    const th = spin + (i / n) * Math.PI * 2 + (rnd() - 0.5) * 0.5, rr = size * (0.62 + 0.45 * rnd());
    pts.push([c[0] + Math.cos(th) * rr, c[1] + Math.sin(th) * rr]);
  }
  const poly = (q) => { og.beginPath(); q.forEach((v, i) => (i ? og.lineTo(v[0], v[1]) : og.moveTo(v[0], v[1]))); og.closePath(); };
  const gr = og.createLinearGradient(c[0] - size, c[1] - size, c[0] + size, c[1] + size);
  gr.addColorStop(0, rgba(cols[2], a));
  gr.addColorStop(0.55, rgba(cols[1], a));
  gr.addColorStop(1, rgba(cols[0], a));
  poly(pts);
  og.fillStyle = gr; og.fill();
  og.strokeStyle = rgba(cols[0], 0.9 * a); og.lineWidth = Math.max(0.5, size / 8); og.stroke();
  // the lit top facet: the upper-left vertices pulled toward the centre
  const lit = pts.filter((v) => (v[0] - c[0]) + (v[1] - c[1]) < size * 0.2);
  if (lit.length >= 2) {
    poly([...lit, [c[0] + size * 0.05, c[1] + size * 0.05]]);
    og.fillStyle = rgba(cols[3] || cols[2], 0.75 * a); og.fill();
  }
  // a shadowed facet below-right
  const dark = pts.filter((v) => (v[0] - c[0]) + (v[1] - c[1]) > size * 0.35);
  if (dark.length >= 2) {
    poly([...dark, [c[0] + size * 0.15, c[1] + size * 0.15]]);
    og.fillStyle = rgba(cols[0], 0.55 * a); og.fill();
  }
}

// Rocks set into the blade (岩石): the trail itself made of stones, from tail to
// head and across its width, riding with it — a few big ones, many small ones
// (sizes fall off steeply), smaller and fainter toward the tail, and a scatter
// of grit around them
function rockBody(runs, w, h, cols, seed, alpha, tail, amount) {
  const r = runs[runs.length - 1];
  if (r.length < 2) return null;
  const N = Math.round(amount * 40);
  const S = rng(seed * 223 + 1);
  const C = createCanvas(w, h), g = C.getContext("2d");
  const width = (u) => { const a = onRun(r, u, 0).pt, b = onRun(r, u, 1).pt; return Math.hypot(b[0] - a[0], b[1] - a[1]); };
  for (let k = 0; k < N; k++) {
    const u = 0.06 + 0.94 * Math.pow(S(), 0.8), v = 0.05 + 0.92 * S();
    const { pt: c } = onRun(r, u, v);
    const size = width(u) * (0.04 + 0.2 * Math.pow(S(), 3)) * (0.45 + 0.55 * u);
    const a = alpha * smooth(0, tail, u);
    if (a <= 0.03 || size < 0.8) { S(); S(); continue; }
    rockShape(g, c, size, S() * 6.28, S, cols, a);
  }
  // grit: tiny stones in and just around the blade
  const G = Math.round(amount * 90);
  for (let k = 0; k < G; k++) {
    const u = 0.1 + 0.9 * Math.pow(S(), 0.7), v = -0.25 + 1.4 * S();
    const { pt: c } = onRun(r, u, Math.max(0, Math.min(1, v)));
    const ac = onRun(r, u, 1).pt, ai = onRun(r, u, 0).pt, off = v < 0 ? v : v > 1 ? v - 1 : 0;
    const p = [c[0] + (ac[0] - ai[0]) * off, c[1] + (ac[1] - ai[1]) * off];
    const size = Math.max(0.6, width(u) * (0.01 + 0.02 * S()));
    const a = alpha * smooth(0, tail, u) * (0.5 + 0.5 * S());
    g.fillStyle = rgba(S() < 0.5 ? cols[1] : cols[2], a);
    g.beginPath(); g.arc(p[0], p[1], size, 0, Math.PI * 2); g.fill();
  }
  return C;
}

// Flying rocks: a few chunks thrown off anywhere along the blade, flying out
// and on with the swing and dropping under gravity, tumbling
function rocks(og, run, cols, seed, age, opacity, maxW, amount) {
  const K = Math.round(amount * 10);
  if (!K || run.length < 2) return;
  const first = age - (run.length - 1);
  for (let k = 0; k < K; k++) {
    const R = rng(seed * 179 + k * 4391);
    const bi = 1 + Math.floor(R() * (run.length - 1));
    const since = age - (first + bi);
    const life = 6 + R() * 5;
    if (since < 0 || since > life || bi >= run.length) continue;
    const s = run[bi], p = run[bi - 1];
    let ox = s.b[0] - s.a[0], oy = s.b[1] - s.a[1];
    const ol = Math.hypot(ox, oy) || 1; ox /= ol; oy /= ol;
    let tx = s.b[0] - p.b[0], ty = s.b[1] - p.b[1];
    const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
    const base = lerp(s.a, s.b, 0.15 + 0.9 * R());
    const sp = maxW * (0.06 + 0.1 * R()), fw = maxW * 0.06 * R(), g = maxW * 0.025;
    const t = since + 0.5;
    const c = [base[0] + ox * sp * t + tx * fw * t, base[1] + oy * sp * t + ty * fw * t + g * t * t];
    const size = maxW * (0.035 + 0.07 * Math.pow(R(), 1.5));
    const a = opacity * clamp01(1 - (since - life * 0.6) / (life * 0.4));
    rockShape(og, c, size, R() * 6.28 + since * (R() - 0.5) * 0.8, R, cols, a);
  }
}

// Wind blades (风刃): soft bands of wind wound round the blade, like brush
// strokes. Each winds along the trail like a rope round a stick, swinging out
// past both edges and back, smooth and tapered at both ends. Where it passes
// behind the blade it is drawn into `back`, which goes under everything (and so
// disappears behind the blade); where it comes round the front it goes into
// `front`, over the blade but see-through, wider and with a thin bright core.
// The winding turns on every frame. Returns { back, front } canvases.
function curls(runs, w, h, coreC, rimC, seed, frame, alpha, maxW, amount) {
  const r = runs[runs.length - 1];
  if (r.length < 2) return null;
  const N = 2 + Math.round(amount * 2);
  const S = rng(seed * 191 + 3);
  const back = createCanvas(w, h), front = createCanvas(w, h);
  const gb = back.getContext("2d"), gf = front.getContext("2d");
  const ext = (u, v) => { const i = onRun(r, u, 0).pt, o = onRun(r, u, 1).pt; return [i[0] + (o[0] - i[0]) * v, i[1] + (o[1] - i[1]) * v]; };
  const bandW = Math.max(3, maxW / 6), coreW = Math.max(0.8, maxW / 45);
  for (let k = 0; k < N; k++) {
    const u0 = 0.02 + 0.3 * S(), u1 = Math.min(1, u0 + 0.6 + 0.4 * S());
    const turns = 0.6 + 0.4 * S(), amp = 0.75 + 0.2 * S();
    const phase = S() * 6.28 + frame * (0.45 + 0.25 * S());
    const fat = 0.7 + 0.5 * S();
    const n = 48;
    const pts = [], ws = [], fr = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, u = u0 + (u1 - u0) * t, ang = phase + t * turns * Math.PI * 2;
      pts.push(ext(u, 0.5 + amp * Math.sin(ang)));
      const z = Math.cos(ang);
      fr.push(z >= 0);
      ws.push(fat * Math.pow(Math.sin(Math.PI * t), 0.8) * (0.55 + 0.45 * Math.max(0, z)));
    }
    const a = alpha * (0.55 + 0.45 * u1);
    const band = (g, i0, i1, scale) => {
      const lo = [], hi = [];
      for (let i = i0; i <= i1; i++) {
        const p = pts[i], q = pts[Math.min(n, i + 1)], o = pts[Math.max(0, i - 1)];
        let dx = q[0] - o[0], dy = q[1] - o[1];
        const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
        const hw = (ws[i] * scale) / 2;
        lo.push([p[0] - dy * hw, p[1] + dx * hw]); hi.push([p[0] + dy * hw, p[1] - dx * hw]);
      }
      g.beginPath();
      lo.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
      for (let i = hi.length - 1; i >= 0; i--) g.lineTo(hi[i][0], hi[i][1]);
      g.closePath();
      g.fill();
    };
    let i0 = 0;
    for (let i = 1; i <= n; i++) {
      if (i < n && fr[i] === fr[i0]) continue;
      if (fr[i0]) {
        gf.fillStyle = rgba(rimC, 0.32 * a); band(gf, i0, i, bandW);
        gf.fillStyle = rgba(coreC, 0.6 * a); band(gf, i0, i, coreW);
      } else {
        gb.fillStyle = rgba(rimC, 0.28 * a); band(gb, i0, i, bandW * 0.8);
      }
      i0 = i;
    }
  }
  // soften both into brushy wind
  const soft = (c) => { const o = createCanvas(w, h), g = o.getContext("2d"); g.filter = `blur(${Math.max(0.6, maxW / 90)}px)`; g.drawImage(c, 0, 0); return o; };
  return { back: soft(back), front: soft(front) };
}

// Serrated edge (锯齿): sharp teeth along the inner side of the blade, pointing
// back toward the tail and in toward the grip — the feathered, saw-toothed
// edge of a wind blade. Fixed to the trail.
function serrate(runs, w, h, cols, coreC, seed, alpha, tail, amount) {
  const r = runs[runs.length - 1];
  if (r.length < 2) return null;
  const N = Math.max(1, Math.round(amount * 11));
  const S = rng(seed * 229 + 7);
  const C = createCanvas(w, h), g = C.getContext("2d");
  for (let k = 0; k < N; k++) {
    // spread over the middle and back of the blade, none at the head
    const u = 0.3 + 0.55 * (k + 0.2 + S() * 0.6) / N, du = 0.045 + 0.04 * S();
    const b1 = onRun(r, Math.min(1, u + du * 0.4), 0.62).pt, b2 = onRun(r, Math.max(0, u - du * 0.6), 0.52).pt;
    const tip = onRun(r, Math.max(0, u - du * (3 + 1.5 * S())), 0.04 + 0.14 * S()).pt;
    const a = alpha * smooth(0, tail, u) * (0.65 + 0.35 * u);
    if (a <= 0.03) continue;
    const gr = g.createLinearGradient(b1[0], b1[1], tip[0], tip[1]);
    gr.addColorStop(0, rgba(cols[2], 0.95 * a));
    gr.addColorStop(0.7, rgba(cols[1], 0.75 * a));
    gr.addColorStop(1, rgba(cols[1], 0.2 * a));
    g.fillStyle = gr;
    g.beginPath(); g.moveTo(b1[0], b1[1]); g.quadraticCurveTo((b1[0] + tip[0]) / 2, (b1[1] + tip[1]) / 2, tip[0], tip[1]); g.lineTo(b2[0], b2[1]); g.closePath(); g.fill();
    // the cutting edge: a bright line down the outer side of the tooth
    const eg = g.createLinearGradient(b1[0], b1[1], tip[0], tip[1]);
    eg.addColorStop(0, rgba(coreC, 0.85 * a));
    eg.addColorStop(1, rgba(coreC, 0));
    g.strokeStyle = eg;
    g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(b1[0], b1[1]); g.lineTo(tip[0], tip[1]); g.stroke();
  }
  return C;
}

// Leaves (叶片): small leaves caught up by the swing — each born on one stick,
// thrown out and back, fluttering side to side and turning over as it goes
function leaves(og, run, cols, seed, age, opacity, maxW, amount) {
  const K = Math.round(amount * 16);
  if (!K || run.length < 2) return;
  const first = age - (run.length - 1);
  for (let k = 0; k < K; k++) {
    const R = rng(seed * 197 + k * 5279);
    const bi = 1 + Math.floor(R() * (run.length - 1));
    const since = age - (first + bi);
    const life = 7 + R() * 6;
    if (since < 0 || since > life || bi >= run.length) continue;
    const s = run[bi], p = run[bi - 1];
    let ox = s.b[0] - s.a[0], oy = s.b[1] - s.a[1];
    const ol = Math.hypot(ox, oy) || 1; ox /= ol; oy /= ol;
    let tx = s.b[0] - p.b[0], ty = s.b[1] - p.b[1];
    const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
    const base = lerp(s.a, s.b, 0.5 + 0.6 * R());
    const t = since + 0.5, sp = maxW * (0.06 + 0.08 * R());
    const flutter = Math.sin(t * 1.7 + R() * 6) * maxW * 0.08;
    const c = [base[0] + ox * sp * t - tx * sp * 0.6 * t + -oy * flutter, base[1] + oy * sp * t - ty * sp * 0.6 * t + ox * flutter];
    const size = maxW * (0.04 + 0.04 * R());
    const turn = R() * 6.28 + t * (R() - 0.5) * 1.6, flip = Math.abs(Math.cos(t * 1.3 + R() * 6));   // turning over
    const ax = Math.cos(turn), ay = Math.sin(turn), nx = -ay * flip, ny = ax * flip;
    const a = opacity * clamp01(1 - (since - life * 0.6) / (life * 0.4));
    const tip = [c[0] + ax * size, c[1] + ay * size], tail = [c[0] - ax * size, c[1] - ay * size];
    og.beginPath();
    og.moveTo(tail[0], tail[1]);
    og.quadraticCurveTo(c[0] + nx * size * 0.9, c[1] + ny * size * 0.9, tip[0], tip[1]);
    og.quadraticCurveTo(c[0] - nx * size * 0.9, c[1] - ny * size * 0.9, tail[0], tail[1]);
    og.closePath();
    og.fillStyle = rgba(cols[1], 0.9 * a); og.fill();
    og.strokeStyle = rgba(cols[2], 0.9 * a); og.lineWidth = Math.max(0.5, size / 8);
    og.beginPath(); og.moveTo(tail[0], tail[1]); og.lineTo(tip[0], tip[1]); og.stroke();
  }
}

// Tearing (撕裂): the body pulled apart into streaming strands and gaps, like
// falling water — noise stretched along the flow, moving along it every frame,
// tearing most at the tail and on the grip side so the leading edge holds.
// Works on the uv map; pixels off the ribbon (the glow around) are kept.
function tear(og, UV, seed, frame, amount) {
  const { k, mw, mh, d } = UV;
  const fbm = fbmNoise(seed * 211 + 5);
  const img = new ImageData(mw, mh), o = img.data;
  for (let i = 0; i < mw * mh * 4; i += 4) {
    if (d[i + 3] < 8) { o[i + 3] = 255; continue; }
    const u = d[i] / 255, v = d[i + 1] / 255;
    const n = fbm(u * 2.6 - frame * 0.15, v * 34);
    const t = amount * (0.25 + 0.5 * (1 - u) + 0.4 * (1 - v));
    let m = (n - t + 0.06) / 0.12;
    m = m <= 0 ? 0 : m >= 1 ? 1 : m * m * (3 - 2 * m);
    // round holes punched through the body, in some of the cells of a cellular
    // noise, drifting with the flow; none on the leading edge
    if (v < 0.85) {
      const c = worley(u * 7 - frame * 0.1, v * 2.6, seed * 7 + 1);
      if (c.h < 0.35 * amount) m *= smooth(0.14, 0.24, c.f1);
    }
    o[i + 3] = Math.round(m * 255);
  }
  const M = createCanvas(mw, mh);
  M.getContext("2d").putImageData(img, 0, 0);
  og.save();
  og.globalCompositeOperation = "destination-in";
  og.drawImage(M, 0, 0, mw * k, mh * k);
  og.restore();
}

// Cellular noise: scattered points, one per unit cell, jittered; returns the
// distance to the nearest (f1) and second nearest (f2) point and a random value
// for the nearest one's cell (h)
function worley(x, y, seed) {
  const hash = (a, b, o) => {
    let v = Math.imul(a + o * 131, 374761393) ^ Math.imul(b - o * 977, 668265263) ^ seed;
    v = Math.imul(v ^ (v >>> 13), 1274126177);
    return ((v ^ (v >>> 16)) >>> 0) / 4294967295;
  };
  const ix = Math.floor(x), iy = Math.floor(y);
  let f1 = 9, f2 = 9, h = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = ix + i, cy = iy + j;
    const px = cx + hash(cx, cy, 1), py = cy + hash(cx, cy, 2);
    const dd = Math.hypot(px - x, py - y);
    if (dd < f1) { f2 = f1; f1 = dd; h = hash(cx, cy, 3); } else if (dd < f2) f2 = dd;
  }
  return { f1, f2, h };
}

// Caustics (水纹): the rippling net of light inside water — bright lines along
// the borders of a cellular pattern (where the nearest two points are about as
// far), stretched along the flow and drifting with it, brightest toward the
// leading edge. Added as light over the body, on the uv map.
function caustics(UV, lightC, seed, frame, alpha, amount) {
  const { mw, mh, d } = UV;
  const img = new ImageData(mw, mh), o = img.data;
  for (let i = 0; i < mw * mh * 4; i += 4) {
    if (d[i + 3] < 8) continue;
    const u = d[i] / 255, v = d[i + 1] / 255;
    const x = u * 9 - frame * 0.18, y = v * 3.2 + Math.sin(u * 23 + frame * 0.4) * 0.12;
    const c = worley(x, y, seed * 5 + 3);
    const line = 1 - smooth(0.02, 0.13, c.f2 - c.f1);
    const a = 0.7 * line * amount * alpha * (0.35 + 0.65 * v) * (d[i + 3] / 255);
    if (a <= 0.02) continue;
    o[i] = lightC[0]; o[i + 1] = lightC[1]; o[i + 2] = lightC[2]; o[i + 3] = Math.round(255 * Math.min(1, a));
  }
  const C = createCanvas(mw, mh);
  C.getContext("2d").putImageData(img, 0, 0);
  return C;
}

// one teardrop at c heading (dx, dy): round at the front, drawn out to a point
// behind, a light body fading toward the tail and a white glint
function teardrop(og, c, dx, dy, r, tailLen, cols, coreC, a) {
  const nx = -dy, ny = dx, back = [c[0] - dx * tailLen, c[1] - dy * tailLen];
  og.beginPath();
  og.moveTo(back[0], back[1]);
  og.quadraticCurveTo(c[0] + nx * r * 1.1 - dx * r * 0.6, c[1] + ny * r * 1.1 - dy * r * 0.6, c[0] + dx * r, c[1] + dy * r);
  og.quadraticCurveTo(c[0] - nx * r * 1.1 - dx * r * 0.6, c[1] - ny * r * 1.1 - dy * r * 0.6, back[0], back[1]);
  og.closePath();
  const gr = og.createLinearGradient(back[0], back[1], c[0] + dx * r, c[1] + dy * r);
  gr.addColorStop(0, rgba(cols[1], 0.4 * a));
  gr.addColorStop(1, rgba(cols[2], 0.95 * a));
  og.fillStyle = gr; og.fill();
  og.fillStyle = rgba(coreC, 0.9 * a);
  og.beginPath(); og.arc(c[0] + nx * r * 0.3, c[1] + ny * r * 0.3, Math.max(0.5, r * 0.3), 0, Math.PI * 2); og.fill();
}

// Drops along the blade (水滴): water shed all along the trail, tail to head —
// mostly just past the leading edge, some past the grip side or over the body —
// riding with it, lying along the swing, smaller and fainter toward the tail,
// and drifting out a little each frame
function dropsBody(og, runs, cols, coreC, seed, frame, alpha, tail, amount) {
  const r = runs[runs.length - 1];
  if (r.length < 2) return;
  const N = Math.round(amount * 30);
  const S = rng(seed * 239 + 5);
  const ext = (u, v) => { const i = onRun(r, u, 0).pt, o = onRun(r, u, 1).pt; return { p: [i[0] + (o[0] - i[0]) * v, i[1] + (o[1] - i[1]) * v], wd: Math.hypot(o[0] - i[0], o[1] - i[1]) }; };
  for (let k = 0; k < N; k++) {
    const u = 0.08 + 0.92 * Math.pow(S(), 0.85);
    const pick = S(), drift = ((frame * 0.03 + S()) % 1) * 0.25;
    const v = pick < 0.55 ? 1.03 + 0.35 * S() + drift : pick < 0.8 ? -0.03 - 0.35 * S() - drift : 0.15 + 0.7 * S();
    const { p, wd } = ext(u, v);
    const ahead = ext(Math.min(1, u + 0.03), v).p;
    let dx = ahead[0] - p[0], dy = ahead[1] - p[1];
    const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
    const r0 = wd * (0.035 + 0.06 * Math.pow(S(), 1.5)) * (0.45 + 0.55 * u);
    const a = alpha * smooth(0, tail, u) * (0.55 + 0.45 * u);
    if (a <= 0.03 || r0 < 0.6) { S(); continue; }
    teardrop(og, p, dx, dy, r0, r0 * (2.2 + 2 * S()), cols, coreC, a);
  }
}

// Flung drops: a few thrown clear of the blade from anywhere along it, flying
// out and on and dropping a little
function drops(og, run, cols, coreC, seed, age, opacity, maxW, amount) {
  const K = Math.round(amount * 9);
  if (!K || run.length < 2) return;
  const first = age - (run.length - 1);
  for (let k = 0; k < K; k++) {
    const R = rng(seed * 233 + k * 3779);
    const bi = 1 + Math.floor(R() * (run.length - 1));
    const since = age - (first + bi);
    const life = 4 + R() * 5;
    if (since < 0 || since > life || bi >= run.length) continue;
    const s = run[bi], p = run[bi - 1];
    let ox = s.b[0] - s.a[0], oy = s.b[1] - s.a[1];
    const ol = Math.hypot(ox, oy) || 1; ox /= ol; oy /= ol;
    let tx = s.b[0] - p.b[0], ty = s.b[1] - p.b[1];
    const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
    const base = lerp(s.a, s.b, 0.2 + 0.9 * R());
    const t = since + 0.6, so = maxW * (0.05 + 0.1 * R()), sf = maxW * (0.03 + 0.08 * R()), g = maxW * 0.012;
    const vx = ox * so + tx * sf, vy = oy * so + ty * sf + g * t * 2;
    const c = [base[0] + (ox * so + tx * sf) * t, base[1] + (oy * so + ty * sf) * t + g * t * t];
    const vl = Math.hypot(vx, vy) || 1;
    const r = maxW * (0.012 + 0.03 * Math.pow(R(), 1.5));
    const a = opacity * clamp01(1 - (since - life * 0.6) / (life * 0.4));
    teardrop(og, c, vx / vl, vy / vl, r, r * (2.5 + 2 * R()), cols, coreC, a);
  }
}
