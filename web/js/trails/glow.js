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
//
// The layers themselves live in trails/glow/: util (helpers), shapes, layers
// (drawn into the trail), fx (the accents around it) and finish (pixel art and
// cel shading). This file holds the presets, the shared controls and the
// assembly.
import { createCanvas, hexToRgb } from "../core/util.js";
import { celShade, pixelateGlow } from "./glow/finish.js";
import { bubbles, drops, dropsBody, dust, embers, flash, impact, leaves, rocks, shards, snow, sparkles, splatter } from "./glow/fx.js";
import { bolts, caustics, crystals, curls, erode, flames, flowLayer, rays, rockBody, serrate, speedLines, tear, tintTail } from "./glow/layers.js";
import { crystal, filament } from "./glow/shapes.js";
import { clamp01, colorAcross, drawBlurred, halfUV, hashSeed, lerp, rgba, rng, smooth, widthOf } from "./glow/util.js";

export { rng, hashSeed, pixelateGlow, celShade };

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
  { id: "sand", name: "沙金", colors: ["#6b3917", "#ac6a28", "#dca947", "#ffe19a"], core: "#fff4cf", rim: "#e6ba62", splat: "#bd843e",
    look: { strands: 26, core: 35, haze: 30, glow: 25, flow: 25, dust: 75, speedLines: 30 } },
  { id: "air", name: "白风", colors: ["#566875", "#a8bdc8", "#e1edf2", "#ffffff"], core: "#ffffff", rim: "#e1edf2", splat: "#d9e7ed",
    look: { strands: 24, core: 35, haze: 18, glow: 20, flow: 35, curls: 65, speedLines: 35, dust: 8, erode: 35 } },
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
//   loop  — frames per cycle when what moves with time (the flowing body,
//             wind, water) has to come round to where it started (0: it doesn't)
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
      F = flowLayer(UV, cols, coreC, seed, frame, alpha, tail, pct("flow"), ctx.loop | 0);
      og.drawImage(F, 0, 0, UV.mw * UV.k, UV.mh * UV.k);
    }

    // ---- rocks set into the blade
    const Rk = pct("rocks") > 0 ? rockBody(runs, w, h, cols, seed, alpha, tail, pct("rocks")) : null;
    if (Rk) og.drawImage(Rk, 0, 0);

    // ---- wind wound round the blade: its back half goes under the blade
    const Cw = pct("curls") > 0 ? curls(runs, w, h, coreC, rimC, seed, frame, alpha, maxW, pct("curls"), ctx.loop | 0) : null;
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
    const Ca = UV && pct("caustic") > 0 ? caustics(UV, colorAcross(cols, 0.85), seed, frame, alpha, pct("caustic"), ctx.loop | 0) : null;
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
  if (UV && pct("tear") > 0) tear(og, UV, seed, frame, pct("tear"), ctx.loop | 0);
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
