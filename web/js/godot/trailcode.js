// 攻击拖尾 drawn entirely by the game: the pure-code twin of godot/trail.js. The
// sticks and the trail's settings go out as data, and the Godot 4 script draws
// every frame itself the way the editor does — the ribbon (trails/model.js),
// the 光效 layers and accents (trails/glow.js, trails/glow/*), the 色带 bands
// with their brush tails, speed lines and breaking up, and the textured modes —
// with the same random numbers, noise and order of layers. No pictures go with
// it, except a texture or brush the user imported.
//
// In Godot each trail and depth (front / back) renders into off-screen canvases
// at the animation's pixel size (SubViewports): what the editor blurs is blurred
// there for real (separable Gaussian passes), what it draws as added light is
// added, and the per-pixel passes — erosion, tearing, tail tint, cel shading,
// pixel art, the two-tailed hand-over — run in shaders over the result.
import { normalizeTrail, STYLE_DEFAULTS } from "../trails/model.js";
import { GLOW_DEFAULTS, mixStyle, hashSeed } from "../trails/glow.js";
import { glowPalette } from "../trails/glow/finish.js";
import { textureKey, brushKey, textureFor, brushFor } from "../trails/composite.js";
import { canvasToBlob, createCanvas } from "../core/util.js";
import { strokeAt, strokeShows, strokePlane, strokeWraps } from "../trails/stroke.js";
import { TRAIL_PRESETS, BAND_LOOK } from "../editor/trailbrush.js";
import { GLOW_PRESETS, glowStyle } from "../trails/glow.js";
import { trailEntry, TRAIL_FOLLOW_GD, TRAIL_SHAPE_GD } from "./trail.js";

const clamp01 = (x) => Math.max(0, Math.min(1, +x || 0));
const hex = (c) => "#" + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
const clean = (s) => String(s || "").replace(/["\\]/g, "");

// trails/model.js hashStr (the seeds of the band noise)
function hashStr(str) {
  let h = 2166136261;
  for (const ch of String(str)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h | 0;
}

// the glow settings that are amounts (0..100 in the style)
const LOOK_KEYS = ["core", "haze", "glow", "flash", "splatter", "erode", "dust", "flow", "impact", "flames", "embers", "shards", "crystal",
  "speedLines", "snow", "bubbles", "bolts", "rays", "shadow", "tailTint", "rocks", "curls", "leaves", "tear", "serrate", "caustic", "drops"];

// the glow as renderGlowTrail hands it to renderGlow: the shared controls applied,
// pixel art and cel shading keeping it tight
function glowSpec(t) {
  const two = t.style.shape === "crescent";
  return glowFrom(mixStyle(t.style), { pixelGlow: !!t.style.pixelGlow, pxSize: t.style.pxSize, pxAlpha: t.style.pxAlpha, cel: t.style.cel, celOutline: t.style.celOutline, pal: t.style },
    two, (t.style.fade ?? 0.6) * (two ? 0.5 : 1), hashSeed(t.id), true);
}

// base: the style with the shared controls applied; fin: 像素光效 / 色阶 and the style whose
// palette they snap to (null: the glow's own); less: pixel art thins the fine detail
function glowFrom(base, fin, two, fade, seed, less) {
  const flat = fin.pixelGlow || base.cel > 0;
  let st = flat ? { ...base, glow: (base.glow || 0) * 0.5, haze: (base.haze || 0) * 0.6 } : base;
  if (fin.pixelGlow && less) {
    const less = { strands: 0.5, haze: 0.4, sparkles: 0.3, dust: 0.25, splatter: 0.5, shards: 0.5, flash: 0.35, impact: 0.4, snow: 0.5, embers: 0.6 };
    st = { ...st };
    for (const [k, m] of Object.entries(less)) st[k] = (+base[k] || 0) * m;
  }
  st = { ...GLOW_DEFAULTS, ...st };
  const cols = st.glowColors && st.glowColors.length >= 2 ? st.glowColors : GLOW_DEFAULTS.glowColors;
  const lum = (h) => { const n = parseInt(h.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; };
  const look = { strands: +st.strands || 0, sparkles: +st.sparkles || 0, sparkleSize: +st.sparkleSize || 0, opacity: st.opacity ?? 100 };
  for (const k of LOOK_KEYS) look[k] = Math.round(clamp01((+st[k] || 0) / 100) * 1e4) / 1e4;
  const out = {
    cols: cols.slice(0, 8), core: st.glowCore || "#ffffff", rim: st.glowRim || cols[cols.length - 1], splat: st.glowSplat || st.glowRim || "#ffffff",
    tail: st.tailTint > 0 && st.glowTail ? st.glowTail : "",
    dark: !!st.solid || cols.reduce((s, c) => s + lum(c), 0) / cols.length < 0.18,
    look, seed, fade, mirror: two,
  };
  // 像素光效 / 色阶: the finishing on the preset's own palette
  const pal = fin.pal || st;
  if (fin.pixelGlow) {
    out.pixel = { size: Math.max(1, Math.min(8, fin.pxSize | 0 || 1)), alpha: fin.pxAlpha || "steps", palette: glowPalette(pal).slice(0, 24).map(hex) };
  } else if (fin.cel > 0) {
    const amount = fin.cel / 100, steps = amount >= 0.75 ? 2 : amount >= 0.35 ? 4 : 6;
    out.cel = { steps, outline: (fin.celOutline || 0) / 100, palette: glowPalette(pal, steps > 2).slice(0, 24).map(hex) };
  }
  return out;
}

// 色带: the bands outer -> inner and everything renderBands reads
function bandSpec(t) {
  const st = t.style, amt = (k) => clamp01(st[k]);
  const all = amt("pxFx");
  const id = t.id || "x";
  return {
    bands: (st.bands && st.bands.length ? st.bands : [[st.color || "#ffffff", 1]]).map(([c, f]) => [c, +f]).sort((p, q) => q[1] - p[1]).slice(0, 8),
    blend: ["hard", "steps", "dither", "smooth"].indexOf(st.bandBlend || "steps"), soft: clamp01(st.bandSoft ?? 0.6), shade: clamp01(st.bandShade ?? 0.4),
    edge: st.bandLayout === "edge", edgeFade: clamp01(st.edgeFade), fadeSteps: !!st.fadeSteps,
    streaks: clamp01(st.streaks), edgeBreak: clamp01(st.edgeBreak), splits: Math.max(0, Math.min(4, st.splits | 0)),
    fx: { dust: Math.max(amt("pxDust"), all), shards: Math.max(amt("pxShards"), all * 0.6), splatter: Math.max(amt("pxSplatter"), all * 0.6), impact: amt("pxImpact") },
    seeds: { noise: hashStr(id), pieces: hashStr(id + "#pieces"), fx: hashSeed(id) },
  };
}

const toBase64 = async (blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let j = 0; j < bytes.length; j += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(j, j + 0x8000));
  return btoa(bin);
};

// a built-in image by name, or an imported one as PNG
async function imageSpec(key, canvas, builtin) {
  if (key === "builtin") return { builtin };
  if (key.startsWith("builtin:")) return { builtin: key.slice(8) };
  if (!canvas) return { builtin };
  return { png: await toBase64(await canvasToBlob(canvas, "image/png")) };
}

// one trail: its shape (as godot/trail.js) and its look, for the script to draw
async function codeEntry(raw, frameIds) {
  const t = normalizeTrail(raw), st = t.style;
  const e = trailEntry(raw, frameIds);
  delete e.color;
  e.mode = st.colorMode === "glow" ? "glow" : st.colorMode === "bands" ? "bands" : "tex";
  e.flip = !!t.flip;
  if (e.mode === "glow") {
    e.glow = glowSpec(t);
    return e;
  }
  // the tail (both band and textured trails): trails/model.js tailFn
  e.pixel = !!st.pixel;
  e.tail = { mode: ["brush", "dither", "smooth"].indexOf(st.tailMode || "brush"), fade: clamp01(st.fade ?? 0.45), crescent: st.shape === "crescent" };
  e.brush = await imageSpec(brushKey(t), brushFor(t), "bristle");
  if (e.mode === "bands") {
    e.bands = bandSpec(t);
    return e;
  }
  const stops = st.gradient && st.gradient.length ? st.gradient : STYLE_DEFAULTS.gradient;
  e.tex = {
    mode: ["original", "mono", "gradient"].indexOf(st.colorMode === "original" ? "original" : st.colorMode === "gradient" ? "gradient" : "mono"),
    color: st.colorMode === "mono" ? st.color || "#ffffff" : "#ffffff", invert: !!st.invert,
    stops: stops.slice(0, 8).map((s) => [+s.p, s.c]),
    image: await imageSpec(textureKey(t), textureFor(t), "luma"),
  };
  return e;
}

// what the script builds its off-screen canvases from: trails with the same can share them
function lookSig(e) {
  const { seed, ...glow } = e.glow || {};
  const { seeds, ...bands } = e.bands || {};
  const str = JSON.stringify([e.mode, glow, bands, e.tex, e.brush, e.pixel, e.tail, e.flip, e.opacity, e.kind, e.geo, e.sparks, e.gain]);
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

// every trail of an animation that has at least one stick
export async function trailCodeData(trails, frameIds, w, h, fps, title) {
  const drawn = (trails || []).filter((t) => t.keys && frameIds.some((id) => t.keys[id]));
  const out = [];
  for (const t of drawn) { const e = await codeEntry(t, frameIds); e.sig = lookSig(e); out.push(e); }
  return {
    format: "guangtai-attack-trail-code", version: 1,
    name: clean(title), canvas: { w, h }, fps: fps || 12, frames: frameIds.length,
    trails: out,
  };
}

// ---------- 拖尾笔 ----------
const r4 = (v) => Math.round(v * 1e4) / 1e4;

// an imported brush (a data URL) as PNG
async function dataUrlPng(url) {
  const im = new Image();
  await new Promise((res, rej) => { im.onload = res; im.onerror = rej; im.src = url; });
  const c = createCanvas(im.naturalWidth, im.naturalHeight);
  c.getContext("2d").drawImage(im, 0, 0);
  return toBase64(await canvasToBlob(c, "image/png"));
}

// A 拖尾笔 stroke layer for the same script: per frame its key as the editor works it out
// (its own, tweened, turned round its circle, or dissolving: [tail x, y, head x, y, bend, width %,
// fade]) and the look editor/trailbrush.js rasterizeTrail gives it
export async function strokeCodeData(layer, frameIds, w, h, fps, title) {
  const s = layer.stroke, style = s.style || {};
  const pl = strokePlane(style);
  const glowP = String(style.preset || "").startsWith("glow:") && (GLOW_PRESETS.find((p) => "glow:" + p.id === style.preset) || GLOW_PRESETS[0]);
  const preset = TRAIL_PRESETS.find((p) => p.id === style.preset) || TRAIL_PRESETS[0];
  const fade = Math.max(0, Math.min(100, style.fade ?? preset.fade ?? 45)) / 100;
  const shape = style.shape || "head";
  const e = {
    kind: "stroke", name: clean(layer.name), gain: (layer.opacity ?? 100) / 100, opacity: 1, flip: false,
    geo: {
      width: +style.width || 10, shape, taper: clamp01(style.taper ?? 0.12), headArc: clamp01(style.headArc ?? 0.5),
      plane: pl ? { h: pl.h, s: r4(pl.s), cos: r4(pl.cos), sin: r4(pl.sin) } : null,
      wrap: strokeWraps(s) ? { flip: !!style.wrapFlip } : null,
    },
    skeys: frameIds.map((_, i) => {
      const st = strokeAt(s, frameIds, i);
      if (!strokeShows(st)) return null;
      const k = st.key;
      return [k.a[0], k.a[1], k.b[0], k.b[1], k.bend || 0, k.ws ?? 100, st.kind === "fade" ? st.fade : 0].map(r4);
    }),
  };
  if (glowP) {
    // glowStroke: the preset, its layers as set under 细节, the shared mixes
    const base = mixStyle({ ...glowStyle(glowP), ...(style.look || {}), mixEdge: style.mixEdge ?? 100, mixBody: style.mixBody ?? 100, mixGlow: style.mixGlow ?? 100, mixFx: style.mixFx ?? 100, mixBurst: style.mixBurst ?? 100 });
    const two = shape === "crescent";
    e.mode = "glow";
    e.glow = glowFrom(base, { pixelGlow: !!style.pixelGlow, pxSize: style.pxSize, pxAlpha: style.pxAlpha, cel: base.cel, celOutline: base.celOutline, pal: null }, two, fade * (two ? 0.5 : 1), 0, false);
  } else {
    const c = s.color || [255, 255, 255];
    const bands = preset.bands ? preset.bands.map(([col, f]) => [col, f]) : [["#" + [c[0], c[1], c[2]].map((v) => v.toString(16).padStart(2, "0")).join(""), 1]];
    const look = { ...BAND_LOOK, ...(preset.look || {}) };
    const st = {
      ...STYLE_DEFAULTS, colorMode: "bands", bands, fade, shape, tailMode: style.tailMode || "brush", pixel: true, opacity: 100,
      bandBlend: style.bandBlend || "steps", bandSoft: (style.bandSoft ?? 60) / 100, bandShade: (style.bandShade ?? 40) / 100,
      bandLayout: look.bandLayout, edgeFade: look.edgeFade, streaks: look.streaks, fadeSteps: look.fadeSteps, splits: look.splits,
      edgeBreak: style.edgeBreak != null ? style.edgeBreak / 100 : look.edgeBreak,
    };
    e.mode = "bands";
    e.bands = bandSpec({ style: st });
    e.pixel = true;
    e.tail = { mode: ["brush", "dither", "smooth"].indexOf(st.tailMode), fade: clamp01(fade), crescent: shape === "crescent" };
    e.brush = style.brushData ? { png: await dataUrlPng(style.brushData) } : { builtin: style.brushId || "bristle" };
    e.sparks = !!style.sparks;
  }
  e.sig = lookSig(e);
  return { format: "guangtai-attack-trail-code", version: 1, name: clean(title), canvas: { w, h }, fps: fps || 12, frames: frameIds.length, trails: [e] };
}

// GDScript: data embedded in a """ string, where a backslash still escapes
const gdData = (data) => JSON.stringify(data).replace(/\\/g, "\\\\");

// data: trailCodeData(...) to embed (the script then works on its own), or null
// for the generic copy the layered scene uses, each node carrying its own data_json
export function trailCodeGodot(data) {
  const embedded = data ? gdData(data) : "";
  const title = data ? data.name || "攻击拖尾" : "攻击拖尾";
  return `@tool
# 攻击拖尾（纯代码）—— 由「光台 · 序列帧工作室」导出：${title}
# Godot 4.x。整段拖尾都由本脚本现场画出来，不用任何图片（只有导入了自定义纹理 / 笔刷图的拖尾带着那张图）：
# 形状按每帧的「棍子」算；光效的光晕、光丝、刃芯、流动、火舌、闪电、冰晶、速度线、水纹、风刃、锯齿、光芒、辉光、
# 侵蚀消散、撕裂、尾部变色、色阶、像素光效，飞出去的星光、粉尘、雪花、气泡、闪光、飞溅、碎片、碎石、落叶、水滴、
# 余烬、命中爆点；色带的刷痕、速度线、破碎、分条、消散；纹理拖尾——都和编辑器的画法、随机数、叠加顺序一样。
# 用法：
#   1. 新建一个 Node2D，挂上本脚本，放在角色精灵（AnimatedSprite2D 或 Sprite2D）下面作为子节点；或者把 target 指向角色精灵。
#   2. 精灵每一帧的图要和导出时的动画画布一样大。精灵的 centered / offset / flip_h / flip_v 会自动换算。
#   3. AnimatedSprite2D：animation_name 填这段动画在 SpriteFrames 里的名字，只在播它时画拖尾；空 = 任何动画。
#      Sprite2D（配 AnimationPlayer）：读 frame；同一张图里有多段动画时，用 frame_offset 填这段动画的第一帧。
#   4. 在角色后方的部分自动画到精灵后面。编辑器里也会画（@tool），拖动精灵的 frame 就能看。
#   5. render_scale：清晰度。0 = 自动（跟着屏幕上的放大倍数，2～4 倍）；像素风格的拖尾总是按画布像素画（像素画）。
# 实现：每段拖尾（前方、后方各一份）按动画画布的像素画进几张离屏图（SubViewport），像编辑器的画布一样一层层叠上去：
# 叠加发光的层按 Canvas 的 lighter 规则相加，模糊是真正的高斯模糊；侵蚀、撕裂、尾部变色、色阶、像素化在最后一步的
# shader 里按像素算。拖尾每换一帧重画一次。
extends Node2D

@export var target: NodePath
@export var active := true
@export var animation_name: StringName = &""
@export var frame_offset := 0
## 关掉时坐标就是动画画布像素（左上角为原点），不按精灵换算（分层导出的场景里用）
@export var use_target_layout := true
## 清晰度：0 = 自动（2～4 倍画布像素），1～4 = 固定倍数。像素风格的拖尾总是 1
@export_range(0, 4) var render_scale := 0
## 每一帧只画一次：画好的图记下来，动画再播到这一帧时直接用（同一帧画出来总是一样的）。改了数据后调用 refresh()
@export var cache_frames := true
## 空闲时把还没画过的帧提前一帧一帧画好（第一遍播放也不卡）
@export var prewarm := true
@export_multiline var data_json := """${embedded}"""
${SHADERS_GD}
${CORE_GD}
${GLOW_GD}
${FX_GD}
${BANDS_GD}
${PRIMS_GD}

# ---------- 跟着精灵的帧 ----------

${TRAIL_FOLLOW_GD}


${TRAIL_SHAPE_GD}
`;
}

// ---------------------------------------------------------------------------
// GLSL. NOISE: the editor's integer hashes and value noises (trails/glow/util.js
// latticeHash / fbmNoise / noiseGrid / worley), bit for bit in unsigned ints.
const SHADERS_GD = String.raw`
# ---------- shader ----------

# 编辑器 trails/glow/util.js 的整数哈希和噪声，逐位一样
const NOISE := """
uint hmix(uint v) {
	v = (v ^ (v >> 13u)) * 1274126177u;
	return v ^ (v >> 16u);
}
float h01(uint v) { return float(hmix(v)) / 4294967295.0; }
float lat(int x, int y, int sd) { return h01(uint(x) * 374761393u ^ uint(y) * 668265263u ^ uint(sd)); }
float gh(int x, int y, int o, int sd) { return h01(uint(x + o * 7919) * 374761393u ^ uint(y - o * 104729) * 668265263u ^ uint(sd)); }
float wh(int x, int y, int o, int sd) { return h01(uint(x + o * 131) * 374761393u ^ uint(y - o * 977) * 668265263u ^ uint(sd)); }
float vn(vec2 p, int sd) {
	vec2 i = floor(p);
	vec2 t = p - i;
	t = t * t * (3.0 - 2.0 * t);
	int ix = int(i.x);
	int iy = int(i.y);
	float a = lat(ix, iy, sd);
	float b = lat(ix + 1, iy, sd);
	float c = lat(ix, iy + 1, sd);
	float d = lat(ix + 1, iy + 1, sd);
	return a + (b - a) * t.x + (c - a) * t.y + (a - b - c + d) * t.x * t.y;
}
float fbm(vec2 p, int sd) { return vn(p, sd) * 0.55 + vn(p * 2.1 + vec2(17.3, 3.1), sd) * 0.3 + vn(p * 4.3 + vec2(7.7, 29.5), sd) * 0.15; }
float gvn(vec2 p, int o, int sd) {
	vec2 i = floor(p);
	vec2 t = p - i;
	t = t * t * (3.0 - 2.0 * t);
	int ix = int(i.x);
	int iy = int(i.y);
	float top = mix(gh(ix, iy, o, sd), gh(ix + 1, iy, o, sd), t.x);
	float bot = mix(gh(ix, iy + 1, o, sd), gh(ix + 1, iy + 1, o, sd), t.x);
	return mix(top, bot, t.y);
}
float grid(vec2 p, float cell, int sd) { return gvn(p / cell, 0, sd) * 0.65 + gvn(p / (cell / 2.7), 1, sd) * 0.35; }
vec3 worley(vec2 p, int sd) {
	int ix = int(floor(p.x));
	int iy = int(floor(p.y));
	float f1 = 9.0;
	float f2 = 9.0;
	float h = 0.0;
	for (int j = -1; j <= 1; j++) {
		for (int i = -1; i <= 1; i++) {
			int cx = ix + i;
			int cy = iy + j;
			vec2 q = vec2(float(cx) + wh(cx, cy, 1, sd), float(cy) + wh(cx, cy, 2, sd));
			float dd = distance(q, p);
			if (dd < f1) { f2 = f1; f1 = dd; h = wh(cx, cy, 3, sd); }
			else if (dd < f2) { f2 = dd; }
		}
	}
	return vec3(f1, f2, h);
}
float sm01(float x) { x = clamp(x, 0.0, 1.0); return x * x * (3.0 - 2.0 * x); }
float sstep(float e0, float e1, float x) { float d = e1 - e0; return sm01((x - e0) / (d != 0.0 ? d : 1e-6)); }
const float BAYER[16] = float[](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
float bayer(vec2 px) {
	int x = int(mod(floor(px.x), 4.0));
	int y = int(mod(floor(px.y), 4.0));
	return (BAYER[y * 4 + x] + 0.5) / 16.0;
}
"""

# 叠加发光（Canvas 的 lighter）：颜色和透明度都直接相加
const ADD_PART := """
shader_type canvas_item;
render_mode blend_add;
void fragment() {
	float s = sqrt(clamp(COLOR.a, 0.0, 1.0));
	COLOR = vec4(COLOR.rgb * s, s);
}
"""
# 原样写进去（坐标图）
const RAW_PART := "shader_type canvas_item;\nrender_mode blend_disabled;\nvoid fragment() {}\n"
# 一张离屏图（已经乘过透明度）盖上去 / 叠加上去
const OVER_TEX := "shader_type canvas_item;\nrender_mode blend_premul_alpha;\nuniform float gain = 1.0;\nvoid fragment() { COLOR = texture(TEXTURE, UV) * gain; }\n"
const ADD_TEX := """
shader_type canvas_item;
render_mode blend_add;
void fragment() {
	vec4 c = texture(TEXTURE, UV);
	float s = sqrt(clamp(c.a, 0.0, 1.0));
	COLOR = s > 0.0001 ? vec4(c.rgb / s, s) : vec4(0.0);
}
"""
# 一个方向的高斯模糊（横竖各一遍）
# 高斯模糊，一遍（在缩小 k 倍的图上，和编辑器 drawBlurred 一样）：间隔 step 取 (2·taps+1)² 个点
const BLUR := """
shader_type canvas_item;
render_mode blend_disabled;
uniform vec2 px;
uniform float sigma = 1.0;
uniform float spacing = 1.0;
uniform int taps = 3;
uniform sampler2D src_tex : filter_linear, repeat_disable;
vec4 tap(vec2 uv) { return (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) ? vec4(0.0) : texture(src_tex, uv); }
void fragment() {
	vec4 acc = vec4(0.0);
	float ws = 0.0;
	for (int j = -taps; j <= taps; j++) {
		for (int i = -taps; i <= taps; i++) {
			vec2 o = vec2(float(i), float(j)) * spacing;
			float w = exp(-dot(o, o) / (2.0 * sigma * sigma));
			acc += tap(UV + o * px) * w;
			ws += w;
		}
	}
	COLOR = acc / ws;
}
"""
# 流动的刀身（trails/glow/layers.js flowLayer）：画在拖尾网格上，UV = (u, v)
# 盖上去 / 叠加的两种写法（同一个 shader 两种用法）
const MIX_HEAD := "render_mode blend_mix;
vec4 outc(vec4 c) { return c; }
"
const ADD_HEAD := "render_mode blend_add;
vec4 outc(vec4 c) { float s = sqrt(clamp(c.a, 0.0, 1.0)); return vec4(c.rgb * s, s); }
"
const FLOW := """
shader_type canvas_item;
%s
%s
uniform int seed = 0;
uniform float frame = 0.0;
uniform float alpha = 1.0;
uniform float tail = 0.6;
uniform float amount = 0.0;
uniform vec3 cols[8];
uniform int ncols = 2;
uniform vec3 core = vec3(1.0);
vec3 across(float v) {
	float t = clamp(v, 0.0, 1.0) * float(ncols - 1);
	int i = min(ncols - 2, int(floor(t)));
	return mix(cols[i], cols[i + 1], t - float(i));
}
// 一格（已乘透明度）
vec4 cell(vec2 uv) {
	float u = uv.x;
	float v = uv.y;
	float t = frame * 0.35;
	float wx = fbm(vec2(u * 4.0 - t * 0.4, v * 3.0), seed);
	float wy = fbm(vec2(u * 4.0 + 9.1, v * 3.0 + 4.7 - t * 0.3), seed);
	float n = fbm(vec2(u * 13.0 + (wx - 0.5) * 3.0 - t, v * 5.0 + (wy - 0.5) * 2.4), seed);
	float body = v * 1.25 + (n - 0.5) * 1.8 * amount;
	float m = sstep(0.42, 0.58, body) * sstep(0.0, tail, u);
	if (m <= 0.01) { return vec4(0.0); }
	float lum = sstep(0.25, 0.75, n);
	float heat = clamp(v * 0.7 + (lum - 0.5) * 0.8 + 0.15, 0.0, 1.0);
	vec3 c = across(heat);
	if (heat > 0.85) { c = mix(c, core, (heat - 0.85) / 0.15); }
	float a = clamp(m * (0.3 + 0.7 * lum) * alpha * (0.5 + 0.5 * amount), 0.0, 1.0);
	return vec4(c * a, a);
}
uniform vec2 box0 = vec2(0.0);
varying vec2 lp;
void vertex() { lp = VERTEX; }
// 编辑器在半尺寸的图上算（网格对齐它这一帧画的范围），再平滑放大：取最近的四格按双线性混合
vec4 half_grid(vec2 uv0, mat2 M) {
	vec2 hp = (lp - box0) * 0.5 - 0.5;
	vec2 fl = floor(hp);
	vec2 f = hp - fl;
	vec4 acc = vec4(0.0);
	for (int j = 0; j < 2; j++) {
		for (int i = 0; i < 2; i++) {
			vec2 c = box0 + (fl + vec2(float(i), float(j))) * 2.0 + 1.0;
			vec2 uv = uv0 + M * (c - lp);
			float w = (i == 0 ? 1.0 - f.x : f.x) * (j == 0 ? 1.0 - f.y : f.y);
			if (uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0) { acc += cell(uv) * w; }
		}
	}
	return acc;
}
void fragment() {
	mat2 J = mat2(dFdx(lp), dFdy(lp));
	mat2 K = mat2(dFdx(UV), dFdy(UV));
	vec4 acc = half_grid(UV, abs(determinant(J)) > 1e-12 ? K * inverse(J) : mat2(0.0));
	if (acc.a <= 0.003) { discard; }
	COLOR = outc(vec4(acc.rgb / acc.a, acc.a));
}
"""
# 水纹（caustics）：细胞噪声的边界线，叠加发光
const CAUSTIC := """
shader_type canvas_item;
render_mode blend_add;
%s
uniform int seed = 0;
uniform float frame = 0.0;
uniform float alpha = 1.0;
uniform float amount = 0.0;
uniform vec3 light = vec3(1.0);
vec4 cell(vec2 uv) {
	float u = uv.x;
	float v = uv.y;
	vec3 c = worley(vec2(u * 9.0 - frame * 0.18, v * 3.2 + sin(u * 23.0 + frame * 0.4) * 0.12), seed);
	float line = 1.0 - sstep(0.02, 0.13, c.y - c.x);
	float a = min(1.0, 0.7 * line * amount * alpha * (0.35 + 0.65 * v));
	return a <= 0.02 ? vec4(0.0) : vec4(light * a, a);
}
uniform vec2 box0 = vec2(0.0);
varying vec2 lp;
void vertex() { lp = VERTEX; }
// 编辑器在半尺寸的图上算（网格对齐它这一帧画的范围），再平滑放大：取最近的四格按双线性混合
vec4 half_grid(vec2 uv0, mat2 M) {
	vec2 hp = (lp - box0) * 0.5 - 0.5;
	vec2 fl = floor(hp);
	vec2 f = hp - fl;
	vec4 acc = vec4(0.0);
	for (int j = 0; j < 2; j++) {
		for (int i = 0; i < 2; i++) {
			vec2 c = box0 + (fl + vec2(float(i), float(j))) * 2.0 + 1.0;
			vec2 uv = uv0 + M * (c - lp);
			float w = (i == 0 ? 1.0 - f.x : f.x) * (j == 0 ? 1.0 - f.y : f.y);
			if (uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0) { acc += cell(uv) * w; }
		}
	}
	return acc;
}
void fragment() {
	mat2 J = mat2(dFdx(lp), dFdy(lp));
	mat2 K = mat2(dFdx(UV), dFdy(UV));
	vec4 acc = half_grid(UV, abs(determinant(J)) > 1e-12 ? K * inverse(J) : mat2(0.0));
	if (acc.a <= 0.003) { discard; }
	float s = sqrt(clamp(acc.a, 0.0, 1.0));
	COLOR = vec4(acc.rgb / acc.a * s, s);
}
"""
# 头部的热光：径向渐变，只在拖尾的形状里面
const HEAD := """
shader_type canvas_item;
render_mode blend_add;
uniform vec2 center;
uniform float radius = 1.0;
uniform vec4 c0;
uniform vec4 c1;
varying vec2 lp;
void vertex() { lp = VERTEX; }
void fragment() {
	float t = length(lp - center) / radius;
	vec4 c = t < 0.45 ? mix(c0, c1, t / 0.45) : mix(c1, vec4(c1.rgb, 0.0), clamp((t - 0.45) / 0.55, 0.0, 1.0));
	float s = sqrt(clamp(c.a, 0.0, 1.0));
	COLOR = vec4(c.rgb * s, s);
}
"""
# 拖尾末端怎么断开（trails/model.js tailFn），色带和纹理拖尾共用
const TAIL := """
uniform bool pixel = true;
uniform int tail_mode = 0;
uniform float fade = 0.45;
uniform bool crescent = false;
uniform bool flip = false;
uniform float op = 1.0;
uniform sampler2D brush : filter_nearest, repeat_disable;
varying vec2 lp;
void vertex() { lp = VERTEX; }
float brush_at(float u, float v) {
	ivec2 sz = textureSize(brush, 0);
	int x = clamp(int(round(u * float(sz.x - 1))), 0, sz.x - 1);
	int y = clamp(int(round(v * float(sz.y - 1))), 0, sz.y - 1);
	return texelFetch(brush, ivec2(x, y), 0).r;
}
float ends(float u) { return crescent ? 2.0 * min(u, 1.0 - u) : u; }
float tailf(float u, float v, vec2 px) {
	float s = fade > 0.0 ? min(1.0, u / fade) : 1.0;
	if (s >= 1.0) { return 1.0; }
	if (tail_mode == 0) {
		float e = s - (1.0 - brush_at(min(1.0, u / max(fade, 1e-3)), v));
		if (pixel) { return e >= 0.0 ? 1.0 : 0.0; }
		return clamp(0.5 + e / 0.18, 0.0, 1.0);
	}
	if (tail_mode == 2 && !pixel) { return s; }
	return s > bayer(px) ? 1.0 : 0.0;
}
"""
# 色带（trails/model.js renderBands），每个像素按它在拖尾上的 (u, v) 算；streak_pass = 速度线
const BAND := """
shader_type canvas_item;
render_mode blend_mix;
%s
%s
uniform vec3 bc[8];
uniform float bf[8];
uniform int bn = 1;
uniform int blend_mode = 1;
uniform float soft = 0.6;
uniform float shade = 0.4;
uniform bool edge = false;
uniform float efade = 0.0;
uniform bool fade_steps = false;
uniform float brk = 0.0;
uniform int nseed = 0;
uniform float gone = 0.0;
uniform int pseed = 0;
uniform int splits = 0;
uniform bool streak_pass = false;
float streakn(float u, float v, int sd) { return vn(vec2(u * 7.0, v * 38.0), sd) * 0.6 + vn(vec2(u * 19.0 + 5.3, v * 90.0 + 1.7), sd) * 0.4; }
vec3 mixsq(vec3 p, vec3 q, float t) { return sqrt(p * p * (1.0 - t) + q * q * t); }
vec3 ramp(float e, vec2 px) {
	int k = 0;
	for (int i = 0; i < 7; i++) {
		if (k < bn - 1 && e <= bf[k + 1]) { k++; }
	}
	if (blend_mode == 0 || soft <= 0.0 || bn < 2) { return bc[k]; }
	for (int jj = 0; jj < 2; jj++) {
		int j = k + jj;
		if (j < 1 || j > bn - 1) { continue; }
		float nxt = j + 1 < bn ? bf[j + 1] : 0.0;
		float hw = soft * 0.5 * min(bf[j - 1] - bf[j], bf[j] - nxt);
		float d = e - bf[j];
		if (hw <= 0.0 || abs(d) >= hw) { continue; }
		float tt = (d + hw) / (2.0 * hw);
		if (blend_mode == 2) { return tt > bayer(px) ? bc[j - 1] : bc[j]; }
		tt = blend_mode == 1 ? round(tt * 3.0) / 3.0 : tt * tt * (3.0 - 2.0 * tt);
		return mixsq(bc[j], bc[j - 1], tt);
	}
	return bc[k];
}
void fragment() {
	float u = UV.x;
	float v0 = UV.y;
	if (abs(2.0 * v0 - 1.0) > bf[0] + 1e-4) { discard; }
	float v = flip ? 1.0 - v0 : v0;
	vec2 px = lp;
	float nz = brk > 0.0 ? streakn(u, v, nseed) - 0.5 : 0.0;
	float sv = v;
	float dim = 1.0;
	if (splits > 0) {
		float pos = v * float(splits + 1);
		float kk = min(float(splits), floor(pos));
		float lv = pos - kk;
		float gap = max(0.05, 0.3 + nz * brk * 0.5);
		if (lv < gap) { discard; }
		sv = (lv - gap) / (1.0 - gap);
		dim = 1.0 - 0.2 * (float(splits) - kk);
	}
	float e0 = edge ? 1.0 - sv : abs(2.0 * sv - 1.0);
	float a = tailf(ends(u), v, px) * op * dim;
	if (efade > 0.0) { a *= 1.0 - sm01((e0 + nz * brk - (1.0 - efade)) / efade); }
	if (brk > 0.0 && !edge && e0 > 0.8 && nz < (e0 - 0.8) * 3.0 * brk - 0.5) { a = 0.0; }
	if (brk > 0.0 && e0 < 0.12 && u < 0.75 && nz < -0.5 + brk * 0.45 * (1.0 - u / 0.75)) { a = 0.0; }
	if (gone > 0.0) {
		if (e0 > 1.0 - gone + nz * 0.2) { discard; }
		if (streakn(u * 1.2, 0.5, pseed) < gone * 0.6) { discard; }
	}
	vec3 col;
	if (streak_pass) {
		float sk = COLOR.a * op;
		if (!(sk > a)) { discard; }
		a = sk;
		col = COLOR.rgb;
	} else {
		float e = 1.0 - (1.0 - e0) * (1.0 - shade * (1.0 - ends(u))) + nz * brk * 0.45;
		col = ramp(clamp(e, 0.0, 1.0), px);
	}
	if (pixel && a < 1.0) { a = fade_steps ? round(a * 4.0) / 4.0 : (a > bayer(px) ? 1.0 : 0.0); }
	if (a <= 0.0) { discard; }
	COLOR = vec4(col, a);
}
"""
# 纹理拖尾（单色 / 渐变 / 原色）
const TEXB := """
shader_type canvas_item;
render_mode blend_mix;
%s
%s
uniform sampler2D tex : filter_linear, repeat_disable;
uniform int cmode = 1;
uniform vec3 mono = vec3(1.0);
uniform bool invert = false;
uniform vec3 gc[8];
uniform float gp[8];
uniform vec3 rc[8];
uniform float rp[8];
uniform int gn = 0;
vec3 gat(float u) {
	if (u <= gp[0]) { return gc[0]; }
	for (int i = 1; i < 8; i++) {
		if (i >= gn) { break; }
		if (u <= gp[i]) {
			float d = gp[i] - gp[i - 1];
			return mix(gc[i - 1], gc[i], (u - gp[i - 1]) / (d != 0.0 ? d : 1.0));
		}
	}
	return gc[max(0, gn - 1)];
}
vec3 gstep(float u) {
	vec3 best = rc[0];
	float bd = 1e9;
	for (int i = 0; i < 8; i++) {
		if (i >= gn) { break; }
		float d = abs(rp[i] - u);
		if (d < bd) { bd = d; best = rc[i]; }
	}
	return best;
}
void fragment() {
	float u = UV.x;
	float v = flip ? 1.0 - UV.y : UV.y;
	vec4 t = texture(tex, vec2(clamp(u, 0.0, 1.0), v));
	float keep = tailf(ends(u), v, lp);
	if (keep <= 0.0 || t.a <= 0.0) { discard; }
	vec3 col;
	float a;
	if (cmode == 0) {
		col = t.rgb;
		a = t.a * keep * op;
	} else {
		float l = dot(t.rgb, vec3(0.299, 0.587, 0.114));
		if (invert) { l = 1.0 - l; }
		a = l * t.a * keep * op;
		col = cmode == 2 ? (pixel ? gstep(u) : gat(u)) : mono;
	}
	if (pixel) {
		if (a <= bayer(lp)) { discard; }
		a = 1.0;
	}
	COLOR = vec4(col, a);
}
"""
# 最后一步（按画布像素）：辉光、撕裂、尾部变色、侵蚀，再盖上飞出去的点缀
const POST := """
shader_type canvas_item;
render_mode blend_disabled;
%s
uniform bool has_bloom = false;
uniform sampler2D bl1 : filter_linear, repeat_disable;
uniform sampler2D bl2 : filter_linear, repeat_disable;
uniform float k1 = 0.0;
uniform float k2 = 0.0;
uniform bool has_fx = false;
uniform sampler2D fx : filter_linear, repeat_disable;
uniform bool has_uv = false;
uniform sampler2D uvm : filter_nearest, repeat_disable;
uniform vec2 box0 = vec2(0.0);
uniform vec2 origin = vec2(0.0);
uniform vec2 canvas = vec2(1.0);
uniform float frame = 0.0;
uniform float tear_amt = 0.0;
uniform int tear_seed = 0;
uniform int tear_wseed = 0;
uniform float tint_amt = 0.0;
uniform vec3 tint = vec3(1.0);
uniform float tint_dv = 0.2;
uniform float erode_t = 0.0;
uniform float erode_cell = 4.0;
uniform int erode_seed = 0;
uniform bool snap = false;
uniform vec3 snap_cols[8];
uniform int snap_n = 0;
uniform float fx_op = 1.0;
float lum(vec3 c) { return dot(c, vec3(0.3, 0.59, 0.11)); }
vec3 clipc(vec3 c) {
	float l = lum(c);
	float n = min(c.r, min(c.g, c.b));
	float x = max(c.r, max(c.g, c.b));
	if (n < 0.0) { c = l + (c - l) * l / (l - n); }
	if (x > 1.0) { c = l + (c - l) * (1.0 - l) / (x - l); }
	return c;
}
// 半尺寸坐标图上的一格：撕裂、尾部变色、侵蚀三个量
vec3 masks(ivec2 q) {
	ivec2 sz = textureSize(uvm, 0);
	vec4 m = (q.x < 0 || q.y < 0 || q.x >= sz.x || q.y >= sz.y) ? vec4(0.0) : texelFetch(uvm, q, 0);
	bool cov = m.a > 0.25;
	bool on = m.a > 0.75;
	float u = m.r;
	float v = m.g;
	float vx = m.b * 5.0 - 2.0;
	float tm = 1.0;
	if (tear_amt > 0.0 && on) {
		float n = fbm(vec2(u * 2.6 - frame * 0.15, v * 34.0), tear_seed);
		float t = tear_amt * (0.25 + 0.5 * (1.0 - u) + 0.4 * (1.0 - v));
		tm = sm01((n - t + 0.06) / 0.12);
		if (v < 0.85) {
			vec3 w = worley(vec2(u * 7.0 - frame * 0.1, v * 2.6), tear_wseed);
			if (w.z < 0.35 * tear_amt) { tm *= sstep(0.14, 0.24, w.x); }
		}
	}
	float sa = 0.0;
	if (tint_amt > 0.0 && cov) {
		float back = clamp((0.75 - u) / 0.75, 0.0, 1.0);
		float e = sstep(-0.6 - 2.0 * tint_dv, -0.6 + 2.0 * tint_dv, vx) * (1.0 - sstep(1.6 - 2.0 * tint_dv, 1.6 + 2.0 * tint_dv, vx));
		sa = min(1.0, tint_amt * 1.15 * pow(back, 0.8)) * e;
	}
	float em = 1.0;
	if (erode_t > 0.02) {
		float n = grid(vec2(q) + box0 * 0.5, erode_cell, erode_seed);
		n = n * 0.6 + (on ? v : 0.5) * 0.4;
		em = sm01((n - (erode_t - 0.12)) / 0.24);
	}
	return vec3(tm, sa, em);
}
void fragment() {
	vec2 uv = UV;
	vec4 c = texture(TEXTURE, uv);
	if (has_bloom) { c = min(c + texture(bl1, uv) * k1 + texture(bl2, uv) * k2, vec4(1.0)); }
	if (has_uv) {
		// 编辑器在半尺寸的图上算这几层遮罩（网格对齐它这一帧画的范围），再平滑放大
		vec2 hp = (origin + uv * canvas - box0) * 0.5 - 0.5;
		vec2 fl = floor(hp);
		vec2 f = hp - fl;
		ivec2 q0 = ivec2(fl);
		vec3 m00 = masks(q0);
		vec3 m10 = masks(q0 + ivec2(1, 0));
		vec3 m01 = masks(q0 + ivec2(0, 1));
		vec3 m11 = masks(q0 + ivec2(1, 1));
		vec3 mm = mix(mix(m00, m10, f.x), mix(m01, m11, f.x), f.y);
		// 撕裂：顺着拖尾流动的噪声把刀身撕成一条条，再打出圆洞（刀锋那一侧不打）
		c *= mm.x;
		// 尾部变色：Canvas 的 color 混合（换色相和饱和度，亮度不变），再 destination-in 原来的透明度
		if (tint_amt > 0.0) {
			float sa = mm.y;
			float ab = c.a;
			if (ab > 0.0) {
				vec3 cb = c.rgb / ab;
				vec3 B = clipc(tint + (lum(cb) - lum(tint)));
				vec3 co = sa * (1.0 - ab) * tint + sa * ab * B + (1.0 - sa) * c.rgb;
				c = vec4(co, sa + ab - sa * ab) * ab;
			}
		}
		// 侵蚀：噪声从细的地方吃进去，握柄一侧先没，刀锋最后
		c *= mm.z;
	}
	if (has_fx) {
		vec4 f = texture(fx, uv);
		if (snap) {
			// 像素色带：点缀里够实的像素换成最近的色带颜色，直接盖掉
			if (f.a >= 85.0 / 255.0) {
				vec3 col = f.rgb / f.a;
				vec3 best = snap_cols[0];
				float bd = 1e9;
				for (int i = 0; i < 8; i++) {
					if (i >= snap_n) { break; }
					vec3 d = snap_cols[i] - col;
					float dd = dot(d, d);
					if (dd < bd) { bd = dd; best = snap_cols[i]; }
				}
				c = vec4(best * fx_op, fx_op);
			}
		} else {
			f *= fx_op;
			c = f + c * (1.0 - f.a);
		}
	}
	COLOR = c;
}
"""
# 像素光效：按画布网格 k×k 一块取平均，吸到预设的配色上，透明度分级（trails/glow/finish.js pixelateGlow）
const PIX := """
shader_type canvas_item;
render_mode blend_disabled;
%s
uniform bool mirror = false;
uniform sampler2D fwd : filter_nearest, repeat_disable;
uniform sampler2D rev : filter_nearest, repeat_disable;
uniform vec2 blocks = vec2(1.0);
uniform vec2 origin = vec2(0.0);
uniform int k = 1;
uniform int amode = 0;
uniform vec3 pal[24];
uniform int pal_n = 1;
uniform vec2 mids[48];
uniform float mus[48];
uniform int mid_n = 0;
// 两头尖：像素在拖尾上的位置 = 中线上最近一点的 u（编辑器 mirrorTails）
float mid_u(vec2 p) {
	float best = 1e20;
	float u = 0.0;
	for (int i = 1; i < 48; i++) {
		if (i >= mid_n) { break; }
		vec2 a = mids[i - 1];
		vec2 d = mids[i] - a;
		float l2 = dot(d, d);
		float s = l2 > 0.0 ? clamp(dot(p - a, d) / l2, 0.0, 1.0) : 0.0;
		vec2 e = a + d * s - p;
		float d2 = dot(e, e);
		if (d2 < best) { best = d2; u = mus[i - 1] + (mus[i] - mus[i - 1]) * s; }
	}
	return u;
}
vec4 at(ivec2 d) {
	vec4 c = texelFetch(fwd, d, 0);
	if (mirror) {
		float wf = 1.0 - sm01((mid_u(origin + vec2(d) + 0.5) - 0.42) / 0.16);
		c = c * wf + texelFetch(rev, d, 0) * (1.0 - wf);
	}
	return c;
}
void fragment() {
	ivec2 sz = textureSize(fwd, 0);
	ivec2 b = ivec2(floor(UV * blocks));
	vec4 acc = vec4(0.0);
	for (int j = 0; j < 8; j++) {
		if (j >= k) { break; }
		for (int i = 0; i < 8; i++) {
			if (i >= k) { break; }
			ivec2 d = b * k + ivec2(i, j);
			if (d.x < sz.x && d.y < sz.y) { acc += at(d); }
		}
	}
	vec4 c = acc / float(k * k);
	float a = c.a;
	float al = 0.0;
	if (a >= 0.08) {
		if (amode == 2) { al = a >= 0.4 ? 1.0 : 0.0; }
		else if (amode == 1) { al = a > bayer(vec2(b) + origin / float(k)) ? 1.0 : 0.0; }
		else { al = a < 0.2 ? 0.0 : max(0.25, round(a * 4.0) / 4.0); }
	}
	if (al <= 0.0) {
		COLOR = vec4(0.0);
	} else {
		vec3 col = c.rgb / a * 255.0;
		float L = dot(col, vec3(0.299, 0.587, 0.114));
		vec3 s = L + (col - L) * 1.45;
		vec3 best = pal[0];
		float bd = 1e20;
		for (int i = 0; i < 24; i++) {
			if (i >= pal_n) { break; }
			vec3 d = pal[i] * 255.0 - s;
			float dd = 2.0 * d.r * d.r + 4.0 * d.g * d.g + 3.0 * d.b * d.b;
			if (dd < bd) { bd = dd; best = pal[i]; }
		}
		COLOR = vec4(best, al);
	}
}
"""
# 显示到画面上：0 原样（两头尖时前后两半交接），1 色阶，2 像素光效的收拾（孤立的淡块去掉、杂色并进周围的颜色）
const DISPLAY := """
shader_type canvas_item;
render_mode blend_premul_alpha;
%s
uniform int mode = 0;
uniform bool mirror = false;
uniform sampler2D fwd : filter_linear, repeat_disable;
uniform sampler2D rev : filter_linear, repeat_disable;
uniform vec2 canvas = vec2(1.0);
uniform vec2 origin = vec2(0.0);
uniform vec3 pal[24];
uniform int pal_n = 1;
uniform int steps = 4;
uniform float outline_px = 0.0;
uniform float gain = 1.0;
uniform vec2 span = vec2(1.0);
uniform vec4 clip = vec4(0.0);
uniform vec2 mids[48];
uniform float mus[48];
uniform int mid_n = 0;
// 两头尖：像素在拖尾上的位置 = 中线上最近一点的 u（编辑器 mirrorTails）
float mid_u(vec2 p) {
	float best = 1e20;
	float u = 0.0;
	for (int i = 1; i < 48; i++) {
		if (i >= mid_n) { break; }
		vec2 a = mids[i - 1];
		vec2 d = mids[i] - a;
		float l2 = dot(d, d);
		float s = l2 > 0.0 ? clamp(dot(p - a, d) / l2, 0.0, 1.0) : 0.0;
		vec2 e = a + d * s - p;
		float d2 = dot(e, e);
		if (d2 < best) { best = d2; u = mus[i - 1] + (mus[i] - mus[i - 1]) * s; }
	}
	return u;
}
vec4 src(vec2 uv) {
	vec4 c = texture(fwd, uv);
	if (mirror) {
		float wf = 1.0 - sm01((mid_u(origin + uv * canvas) - 0.42) / 0.16);
		c = c * wf + texture(rev, uv) * (1.0 - wf);
	}
	return c;
}
vec3 nearest(vec3 c) {
	vec3 best = pal[0];
	float bd = 1e20;
	for (int i = 0; i < 24; i++) {
		if (i >= pal_n) { break; }
		vec3 d = (pal[i] - c) * 255.0;
		float dd = 2.0 * d.r * d.r + 4.0 * d.g * d.g + 3.0 * d.b * d.b;
		if (dd < bd) { bd = dd; best = pal[i]; }
	}
	return best;
}
vec4 cel(vec2 uv) {
	vec4 c = src(uv);
	float a = c.a;
	if (a < 0.2) { return vec4(0.0); }
	vec3 col = nearest(c.rgb / a);
	if (steps <= 2 && a < 0.45) { return vec4(0.0); }
	float al = steps <= 2 ? 1.0 : max(1.0 / float(steps), round(a * float(steps)) / float(steps));
	return vec4(col, al);
}
bool same(vec3 a, vec3 b) { return all(lessThan(abs(a - b), vec3(0.002))); }
void fragment() {
	if (mode == 2) {
		ivec2 sz = textureSize(TEXTURE, 0);
		ivec2 p = ivec2(floor(UV * vec2(sz)));
		vec4 s0 = texelFetch(TEXTURE, p, 0);
		vec4 o = s0;
		if (s0.a > 0.0) {
			int near = 0;
			for (int dy = -1; dy <= 1; dy++) {
				for (int dx = -1; dx <= 1; dx++) {
					ivec2 q = p + ivec2(dx, dy);
					if ((dx != 0 || dy != 0) && q.x >= 0 && q.y >= 0 && q.x < sz.x && q.y < sz.y && texelFetch(TEXTURE, q, 0).a > 0.0) { near++; }
				}
			}
			if (near == 0) {
				if (s0.a < 190.0 / 255.0) { o = vec4(0.0); }
			} else {
				ivec2 dirs[4] = ivec2[](ivec2(1, 0), ivec2(-1, 0), ivec2(0, 1), ivec2(0, -1));
				vec3 seen[4];
				int ns = 0;
				bool hit = false;
				for (int i = 0; i < 4; i++) {
					ivec2 q = p + dirs[i];
					if (q.x < 0 || q.y < 0 || q.x >= sz.x || q.y >= sz.y) { continue; }
					vec4 c = texelFetch(TEXTURE, q, 0);
					if (c.a <= 0.0) { continue; }
					if (same(c.rgb, s0.rgb)) { hit = true; break; }
					seen[ns] = c.rgb;
					ns++;
				}
				if (!hit && ns >= 3) {
					for (int i = 0; i < 4; i++) {
						if (i >= ns) { break; }
						int cnt = 0;
						for (int j = 0; j < 4; j++) {
							if (j < ns && same(seen[j], seen[i])) { cnt++; }
						}
						if (cnt >= 3) { o.rgb = seen[i]; break; }
					}
				}
			}
		}
		COLOR = vec4(o.rgb * o.a, o.a);
	} else if (mode == 1) {
		vec4 c = cel(UV);
		vec4 o = vec4(0.0);
		if (outline_px > 0.0) {
			float cover = 0.0;
			for (int i = 0; i < 8; i++) {
				float th = float(i) * 0.7853982;
				vec2 off = vec2(cos(th), sin(th)) * outline_px / canvas;
				if (cel(UV - off).a >= 190.0 / 255.0) { cover += 0.8 * (1.0 - cover); }
			}
			o = vec4(pal[0] * cover, cover);
		}
		COLOR = vec4(c.rgb * c.a, c.a) + o * (1.0 - c.a);
	} else {
		COLOR = src(UV);
	}
	// 环绕：只留这一半（前半圈 / 后半圈）；图层不透明度、拖尾笔消散时的淡出
	if (clip.z != 0.0 || clip.w != 0.0) {
		vec2 doc = origin + UV * span;
		if (dot(doc - clip.xy, clip.zw) < 0.0) { COLOR = vec4(0.0); }
	}
	COLOR *= gain;
}
"""
`;

// ---------------------------------------------------------------------------
// GDScript: the node tree per trail and depth, and the per-frame update
const CORE_GD = String.raw`
# ---------- 每段拖尾的离屏画布 ----------

# 画的层（编辑器 renderGlow 里的顺序）
const S_HAZE := 0
const S_FLOW := 1
const S_ROCKBODY := 2
const S_CURLS_BACK := 3
const S_FLAME_HALO := 4
const S_FLAMES_ADD := 5  # （不再用）
const S_FLAMES_MIX := 6
const S_STRANDS := 7
const S_HEAD := 8
const S_CORE := 9
const S_BOLTS := 10
const S_CRYSTALS := 11
const S_SPEED := 12
const S_CAUSTIC := 13
const S_SERRATE := 14
const S_CURLS_FRONT := 15
const S_RAYS := 16
const S_SPARK := 17
const S_FLASH_ADD := 18
const S_FLASH_MIX := 19
const S_SPLAT := 20
const S_SOLID := 21
const S_EMBERS := 22
const S_IMPACT_ADD := 23
const S_IMPACT_MIX := 24
const S_BAND_BODY := 25
const S_BAND_STREAK := 26
const S_TEX_BODY := 27
const S_UV := 28
const S_SPLAT_SOFT := 29
const S_SPARKS := 30

const LOOK_PCT := ["core", "haze", "glow", "flash", "splatter", "erode", "dust", "flow", "impact", "flames", "embers", "shards", "crystal", "speedLines", "snow", "bubbles", "bolts", "rays", "shadow", "tailTint", "rocks", "curls", "leaves", "tear", "serrate", "caustic", "drops"]


# 一层的三角形（一次画完）
class Ops:
	var idx := PackedInt32Array()
	var pts := PackedVector2Array()
	var cols := PackedColorArray()
	var uvs := PackedVector2Array()


class Part extends Node2D:
	var ops: Dictionary
	var slot := 0

	func _draw() -> void:
		var o: Ops = ops.get(slot)
		if o == null or o.idx.is_empty():
			return
		if o.uvs.size() == o.pts.size():
			RenderingServer.canvas_item_add_triangle_array(get_canvas_item(), o.idx, o.pts, o.cols, o.uvs)
		else:
			RenderingServer.canvas_item_add_triangle_array(get_canvas_item(), o.idx, o.pts, o.cols)


# 和编辑器一样的伪随机数（Park–Miller）
class Rand:
	var s := 1

	func _init(seed_value: int) -> void:
		s = (absi(seed_value) % 2147483646) + 1

	func next() -> float:
		s = (s * 16807) % 2147483647
		return float(s - 1) / 2147483646.0


# 高斯模糊，在缩小 k 倍的图上一遍做完（和编辑器 drawBlurred 一样）
class Blur:
	var x: SubViewport
	var mx: ShaderMaterial
	var sx: Sprite2D
	var k := 1
	var s := 1

	func set_sigma(doc_sigma: float) -> void:
		var sg := maxf(0.05, doc_sigma * s / k)
		var st := maxf(1.0, sg / 2.0)
		mx.set_shader_parameter("sigma", sg)
		mx.set_shader_parameter("spacing", st)
		mx.set_shader_parameter("taps", clampi(ceili(sg * 2.5 / st), 1, 6))

	func tex() -> Texture2D:
		return x.get_texture()

	func set_src(t: Texture2D) -> void:
		if sx.texture != t:
			sx.texture = t
			mx.set_shader_parameter("src_tex", t)


# 一次完整的渲染（正着画；两头尖的拖尾再倒过来画一遍）
class Pipe:
	var ops := {}
	var parts: Array = []
	var mats := {}
	var blurs := {}
	var fx: SubViewport
	var post: SubViewport
	var post_mat: ShaderMaterial
	var info := {}
	# 半尺寸、对齐编辑器这一帧绘制范围的几张图：坐标图、流动、水纹
	var uv: SubViewport
	var uv_ops := {}
	var uv_part: Part
	var halves: Array = []
	var half_sprites: Array = []


# 一段拖尾的一个深度（前方 / 后方）
class Pass:
	var trail: Dictionary
	var back := false
	var s := 1
	var pixel := false
	var fwd: Pipe
	var rev: Pipe
	var pix: SubViewport
	var pix_mat: ShaderMaterial
	var disp: Sprite2D
	var disp_mat: ShaderMaterial
	var dscale := Vector2.ONE  # 显示图的缩放（离屏图 → 画布像素）
	var box := Rect2()  # 离屏图只盖住这段拖尾可能画到的范围（画布像素）
	var vps: Array = []
	var kick := 0
	var shown := false
	var fx_root: Node2D  # 直接画在画面上的点缀
	var cache := {}  # 帧 → 画好的图（和显示用的参数）
	var busy := -1  # 正在画、等着记下来的帧
	var cur := -2  # 正在显示的帧
	var frames: Array = []  # 这一套离屏图要画的所有帧
	var live := {}  # 正在画的这一帧的显示参数
	var members: Array = []  # 共用这一套离屏图的几段拖尾（样式一样、不会同时出现）


var _sprite: Node2D
var _w := 0.0
var _h := 0.0
var _trails: Array = []
var _passes: Array = []
var _scale := 0
var _shown := ""
var _fi := -1
static var _shaders := {}
var _add_mat: ShaderMaterial
var _raw_mat: ShaderMaterial
var _msaa := false  # 多重采样抗锯齿：显存是四倍，靠 2 倍以上的超采样就够了，不开
var _bx := Rect2()  # 正在建的这一份离屏图在画布上的范围
# 画的时候用的
var _P: Pipe
var _slot := 0
var _s := 1.0


func _ready() -> void:
	_sprite = (get_node_or_null(target) if not target.is_empty() else get_parent()) as Node2D
	if data_json.strip_edges().is_empty():
		return
	var data = JSON.parse_string(data_json)
	if typeof(data) != TYPE_DICTIONARY:
		push_warning("攻击拖尾：data_json 不是有效的数据")
		return
	_w = float(data["canvas"]["w"])
	_h = float(data["canvas"]["h"])
	for t in data["trails"]:
		_trails.append(_load_trail(t))
	_add_mat = _mat("add")
	_raw_mat = _mat("raw")


func _exit_tree() -> void:
	_clear()
	_scale = 0


func _process(_delta: float) -> void:
	if _trails.is_empty() or _w <= 0.0:
		return
	var want := _want_scale()
	if want != _scale:
		_build(want)  # 第一次、放大倍数变了、或者重新进入场景树
	var lay := _layout()
	for P in _passes:
		var ps: Pass = P
		if ps.kick > 0:
			ps.kick -= 1
			if ps.kick == 0:
				_update_mode(ps, SubViewport.UPDATE_DISABLED)
				if ps.busy >= 0:
					_capture(ps)
		elif cache_frames and prewarm and ps.busy < 0 and (ps.cur < 0 or ps.cache.has(ps.cur) or not ps.shown):
			# 空闲：提前画一帧还没画过的（显示用的是记下来的图，不受影响）
			for f in ps.frames:
				if not ps.cache.has(f):
					_render(ps, f)
					break
		if ps.disp == null:
			continue
		ps.disp.transform = (transform * lay if ps.back else lay) * Transform2D(0.0, ps.dscale, 0.0, ps.box.position)
		ps.disp.visible = visible and active and ps.shown
		if ps.fx_root:
			ps.fx_root.transform = lay
			ps.fx_root.visible = ps.disp.visible
	var fi := _current_frame() if active else -1
	var key := "%d" % fi
	if key == _shown:
		return
	_shown = key
	_fi = fi
	for P in _passes:
		_show(P, fi)


# 画布像素 → 本节点（精灵的 centered / offset / 翻转）
func _layout() -> Transform2D:
	return Transform2D(0.0, _flips(), 0.0, _to_local(Vector2.ZERO))


func _want_scale() -> int:
	if render_scale > 0:
		return render_scale
	var sc := absf(get_global_transform_with_canvas().get_scale().x) if is_inside_tree() else 1.0
	return clampi(ceili(sc - 0.01), 2, 4)


func _clear() -> void:
	for P in _passes:
		var ps: Pass = P
		for v in ps.vps:
			if is_instance_valid(v):
				v.queue_free()
		if ps.disp and is_instance_valid(ps.disp):
			ps.disp.queue_free()
		if ps.fx_root and is_instance_valid(ps.fx_root):
			ps.fx_root.queue_free()
	_passes.clear()


func _build(s: int) -> void:
	_clear()
	_scale = s
	_shown = ""
	# 样式一样、不会同时出现的几段拖尾共用一套离屏图
	var groups := []
	for t in _trails:
		var placed := false
		for g in groups:
			if g["sig"] == t["sig"] and not _overlaps(g["frames"], t["frames"]):
				g["members"].append(t)
				g["frames"].append_array(t["frames"])
				placed = true
				break
		if not placed:
			groups.append({"sig": t["sig"], "members": [t], "frames": (t["frames"] as Array).duplicate()})
	for g in groups:
		var ms: Array = g["members"]
		var box: Rect2 = ms[0]["box"]
		var wmax: float = ms[0]["wmax"]
		var has_back := false
		for t in ms:
			box = box.merge(t["box"])
			wmax = maxf(wmax, t["wmax"])
			has_back = has_back or t["has_back"]
		var lead: Dictionary = (ms[0] as Dictionary).duplicate()
		lead["box"] = box
		lead["wmax"] = wmax
		for back in [false, true]:
			if back and not has_back:
				continue  # 从不转到角色后面的拖尾不用后方那一套
			var P := _make_pass(lead, back, s)
			P.members = ms
			P.frames = g["frames"]
			_passes.append(P)


func _overlaps(a: Array, b: Array) -> bool:
	for x in b:
		if a.has(x):
			return true
	return false


func _shader(name: String) -> Shader:
	if _shaders.has(name):
		return _shaders[name]
	var code := ""
	match name:
		"add": code = ADD_PART
		"raw": code = RAW_PART
		"over": code = OVER_TEX
		"addtex": code = ADD_TEX
		"blur": code = BLUR
		"flow": code = FLOW % [MIX_HEAD, NOISE]
		"flow_add": code = FLOW % [ADD_HEAD, NOISE]
		"caustic": code = CAUSTIC % NOISE
		"head": code = HEAD
		"band": code = BAND % [NOISE, TAIL]
		"tex": code = TEXB % [NOISE, TAIL]
		"post": code = POST % NOISE
		"pix": code = PIX % NOISE
		"display": code = DISPLAY % NOISE
	var sh := Shader.new()
	sh.code = code
	_shaders[name] = sh
	return sh


func _mat(name: String) -> ShaderMaterial:
	var m := ShaderMaterial.new()
	m.shader = _shader(name)
	return m


# level：读别的离屏图的层级更高；按层级顺序放进场景树，Godot 按这个顺序渲染，一帧就能画完整条链
func _vp(P: Pass, size: Vector2i, aa := false, level := 0) -> SubViewport:
	var v := SubViewport.new()
	v.size = Vector2i(maxi(1, size.x), maxi(1, size.y))
	v.transparent_bg = true
	v.disable_3d = true
	v.render_target_update_mode = SubViewport.UPDATE_DISABLED
	if aa and _msaa and not P.pixel:
		v.msaa_2d = Viewport.MSAA_4X
	v.set_meta("lv", level)
	P.vps.append(v)
	return v


# 画布：按画布像素画（放大 s 倍）
func _canvas(v: SubViewport, s: int) -> Node2D:
	var c := Node2D.new()
	c.transform = Transform2D(0.0, Vector2(s, s), 0.0, -_bx.position * s)
	v.add_child(c)
	return c


func _part(pp: Pipe, parent: Node, slot: int, mat: Material = null) -> Part:
	var p := Part.new()
	p.ops = pp.ops
	p.slot = slot
	p.material = mat
	parent.add_child(p)
	pp.parts.append(p)
	return p


# 一张离屏图铺满画布，盖上去（over）或叠加（add）
func _tex_sprite(parent: Node, v: Variant, kind := "over", gain := 1.0) -> Sprite2D:
	var sp := Sprite2D.new()
	sp.centered = false
	var tex: Texture2D = v.tex() if v is Blur else (v as SubViewport).get_texture()
	var size: Vector2i = (v as Blur).x.size if v is Blur else (v as SubViewport).size
	sp.texture = tex
	sp.position = _bx.position
	sp.scale = _bx.size / Vector2(size)
	var m := _mat("over" if kind == "over" else "addtex")
	if kind == "over":
		m.set_shader_parameter("gain", gain)
	sp.material = m
	parent.add_child(sp)
	return sp


func _blur(P: Pass, src: SubViewport, typ_sigma: float) -> Blur:
	var b := Blur.new()
	b.s = P.s
	var lv: int = src.get_meta("lv", 0)
	b.k = clampi(int(floor(typ_sigma * P.s / 5.0)), 1, 4)
	var sz := Vector2i(ceili(float(src.size.x) / b.k), ceili(float(src.size.y) / b.k))
	b.x = _vp(P, sz, false, lv + 1)
	var sx := Sprite2D.new()
	sx.centered = false
	sx.texture = src.get_texture()
	sx.scale = Vector2(sz) / Vector2(src.size)
	b.mx = _mat("blur")
	b.mx.set_shader_parameter("src_tex", sx.texture)
	b.mx.set_shader_parameter("px", Vector2(1.0 / sz.x, 1.0 / sz.y))
	sx.material = b.mx
	b.x.add_child(sx)
	b.sx = sx
	return b


func _post(P: Pass, pp: Pipe, body: SubViewport) -> void:
	var v := _vp(P, body.size, false, 7)
	var sp := Sprite2D.new()
	sp.centered = false
	sp.texture = body.get_texture()
	pp.post_mat = _mat("post")
	pp.post_mat.set_shader_parameter("canvas", _bx.size)
	pp.post_mat.set_shader_parameter("origin", _bx.position)
	sp.material = pp.post_mat
	v.add_child(sp)
	pp.post = v


func _make_pass(t: Dictionary, back: bool, s: int) -> Pass:
	var P := Pass.new()
	P.trail = t
	P.back = back
	var mode: String = t["mode"]
	P.pixel = (mode == "glow" and t["glow"].has("pixel")) or (mode != "glow" and bool(t["pixel"]))
	P.s = 1 if P.pixel else s
	# 范围：所有棍子绕握柄扫过的圆再往外留出光效的余量；像素光效按块对齐
	var k0: int = int(t["glow"]["pixel"]["size"]) if (mode == "glow" and t["glow"].has("pixel")) else 1
	var bx: Rect2 = t["box"]
	var x0 := floori(bx.position.x / k0) * k0
	var y0 := floori(bx.position.y / k0) * k0
	P.box = Rect2(x0, y0, ceili(bx.end.x) - x0, ceili(bx.end.y) - y0)
	_bx = P.box
	var ws := Vector2i(ceili(P.box.size.x * P.s), ceili(P.box.size.y * P.s))
	if mode == "glow":
		P.fwd = _pipe_glow(P, ws, not back or String(t.get("kind", "")) == "stroke", false)
		if t["glow"]["mirror"]:
			P.rev = _pipe_glow(P, ws, false, true)
	elif mode == "bands":
		P.fwd = _pipe_bands(P, ws)
	else:
		P.fwd = _pipe_tex(P, ws)
	# 显示：像素光效先在小图上按块算好
	var sp := Sprite2D.new()
	sp.centered = false
	P.disp_mat = _mat("display")
	P.disp_mat.set_shader_parameter("canvas", P.box.size)
	P.disp_mat.set_shader_parameter("origin", P.box.position)
	if mode == "glow" and t["glow"].has("pixel"):
		var px: Dictionary = t["glow"]["pixel"]
		var k: int = px["size"]
		var bs := Vector2i(ceili(P.box.size.x / k), ceili(P.box.size.y / k))
		P.pix = _vp(P, bs, false, 8)
		var ps := Sprite2D.new()
		ps.centered = false
		ps.texture = P.fwd.post.get_texture()
		ps.scale = Vector2(bs) / Vector2(P.fwd.post.size)
		P.pix_mat = _mat("pix")
		P.pix_mat.set_shader_parameter("fwd", ps.texture)
		P.pix_mat.set_shader_parameter("blocks", Vector2(bs))
		P.pix_mat.set_shader_parameter("origin", P.box.position)
		P.pix_mat.set_shader_parameter("k", k)
		P.pix_mat.set_shader_parameter("amode", ["steps", "dither", "hard"].find(String(px["alpha"])) if ["steps", "dither", "hard"].has(String(px["alpha"])) else 0)
		_set_pal(P.pix_mat, px["palette"])
		_set_mirror(P, P.pix_mat)
		ps.material = P.pix_mat
		P.pix.add_child(ps)
		sp.texture = P.pix.get_texture()
		sp.scale = Vector2(k, k)
		P.disp_mat.set_shader_parameter("span", Vector2(bs) * k)
		P.disp_mat.set_shader_parameter("mode", 2)
	else:
		sp.texture = P.fwd.post.get_texture()
		sp.scale = P.box.size / Vector2(P.fwd.post.size)
		P.disp_mat.set_shader_parameter("fwd", sp.texture)
		P.disp_mat.set_shader_parameter("span", P.box.size)
		if mode == "glow" and t["glow"].has("cel"):
			var cl: Dictionary = t["glow"]["cel"]
			P.disp_mat.set_shader_parameter("mode", 1)
			P.disp_mat.set_shader_parameter("steps", int(cl["steps"]))
			_set_pal(P.disp_mat, cl["palette"])
		if mode == "glow":
			_set_mirror(P, P.disp_mat)
	sp.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST if P.pixel else CanvasItem.TEXTURE_FILTER_LINEAR
	sp.material = P.disp_mat
	P.dscale = sp.scale
	sp.visible = false
	sp.name = "%s_%s%d" % [name, "back" if back else "front", _trails.find(t)]
	var order := P.vps.duplicate()
	order.sort_custom(func(a, b): return int(a.get_meta("lv")) < int(b.get_meta("lv")))
	for v in order:
		add_child(v, false, Node.INTERNAL_MODE_BACK)
	P.disp = sp
	if back:
		var parent := get_parent()
		parent.add_child(sp)
		if parent == _sprite:
			sp.show_behind_parent = true  # 画在精灵后面
		else:
			parent.move_child(sp, 0)  # 垫到所有兄弟节点下面
	else:
		add_child(sp, false, Node.INTERNAL_MODE_BACK)
		if P.fx_root:
			add_child(P.fx_root, false, Node.INTERNAL_MODE_BACK)
	return P


func _set_pal(m: ShaderMaterial, pal: Array) -> void:
	var a := PackedVector3Array()
	for h in pal:
		var c := Color(String(h))
		a.append(Vector3(c.r, c.g, c.b))
	while a.size() < 24:
		a.append(Vector3.ZERO)
	m.set_shader_parameter("pal", a)
	m.set_shader_parameter("pal_n", mini(24, pal.size()))


func _set_mirror(P: Pass, m: ShaderMaterial) -> void:
	m.set_shader_parameter("mirror", P.rev != null)
	if P.rev != null:
		m.set_shader_parameter("rev", P.rev.post.get_texture())


# 光效：编辑器 renderGlow 的层，按顺序画进刀身（body）和辉光的来源（light），飞出去的点缀另画一张
func _pipe_glow(P: Pass, ws: Vector2i, with_fx: bool, is_rev: bool) -> Pipe:
	var pp := Pipe.new()
	var t := P.trail
	var G: Dictionary = t["glow"]
	var p: Dictionary = G["p"]
	var s := P.s
	var wt: float = t["wmax"]
	var dark: bool = G["dark"]
	var B := _vp(P, ws, false, 4)
	var cB := _canvas(B, s)
	if p["haze"] > 0.0:
		var H := _vp(P, ws, false, 0)
		_part(pp, _canvas(H, s), S_HAZE)
		pp.blurs["haze"] = _blur(P, H, maxf(1.5, wt / 6.0))
		_tex_sprite(cB, pp.blurs["haze"])
	# 辉光的来源（不含光晕、刀身里的岩石、后半圈的风）：编辑器小半径时把各层分别模糊后相加，
	# 大半径时先叠好再模糊（这里用刀身那张）
	var LS: SubViewport = null
	if p["glow"] > 0.0:
		LS = _vp(P, ws, false, 4)
	# 火舌先在一张图里叠好（黑炎下面垫模糊的亮边色），亮火叠加上去，黑炎盖上去
	var T: SubViewport = null
	if p["flames"] > 0.0:
		T = _vp(P, ws, false, 3)
		var cv := _canvas(T, s)
		if dark:
			var hv := _vp(P, ws, false, 0)
			_part(pp, _canvas(hv, s), S_FLAME_HALO)
			pp.blurs["halo"] = _blur(P, hv, maxf(1.5, wt / 30.0))
			_tex_sprite(cv, pp.blurs["halo"])
		_part(pp, cv, S_FLAMES_MIX)
	# 坐标图（半尺寸）：撕裂、尾部变色、侵蚀用
	var need_uv: bool = p["tear"] > 0.0 or p["tailTint"] > 0.0 or p["erode"] > 0.0
	if need_uv:
		var hs := Vector2i(ceili(_bx.size.x / 2.0) + 2, ceili(_bx.size.y / 2.0) + 2)
		pp.uv = _vp(P, hs)
		pp.halves.append(_canvas(pp.uv, 1))
		pp.uv_part = Part.new()
		pp.uv_part.ops = pp.uv_ops
		pp.uv_part.slot = S_UV
		pp.uv_part.material = _raw_mat
		pp.halves[0].add_child(pp.uv_part)
	if p["flow"] > 0.0:
		pp.mats["flow"] = _mat("flow")
		if LS:
			pp.mats["flow_add"] = _mat("flow_add")
	if p["caustic"] > 0.0:
		pp.mats["caustic"] = _mat("caustic")
	pp.mats["head"] = _mat("head")
	for target in [[cB, false], [_canvas(LS, s) if LS else null, true]]:
		var cv: Node2D = target[0]
		if cv == null:
			continue
		var add: bool = target[1]
		if p["flow"] > 0.0:
			_part(pp, cv, S_FLOW, pp.mats["flow_add"] if add else pp.mats["flow"])
		if p["rocks"] > 0.0 and not add:
			_part(pp, cv, S_ROCKBODY)
		if p["curls"] > 0.0 and not add:
			_part(pp, cv, S_CURLS_BACK, _add_mat)
		if T:
			_tex_sprite(cv, T, "add" if (add or not dark) else "over")
		_part(pp, cv, S_STRANDS, _add_mat)
		_part(pp, cv, S_HEAD, pp.mats["head"])
		if p["core"] > 0.0:
			_part(pp, cv, S_CORE)
		if p["bolts"] > 0.0:
			_part(pp, cv, S_BOLTS, _add_mat)
		if p["crystal"] > 0.0:
			_part(pp, cv, S_CRYSTALS)
		if p["speedLines"] > 0.0:
			_part(pp, cv, S_SPEED, _add_mat)
		if p["caustic"] > 0.0:
			_part(pp, cv, S_CAUSTIC, pp.mats["caustic"])
		if p["serrate"] > 0.0:
			_part(pp, cv, S_SERRATE)
		if p["curls"] > 0.0:
			_part(pp, cv, S_CURLS_FRONT, _add_mat)
		if p["rays"] > 0.0:
			_part(pp, cv, S_RAYS, _add_mat)
	pp.info["ls"] = LS
	pp.info["lo"] = B
	if LS:
		pp.blurs["bloom1"] = _blur(P, LS, maxf(1.0, wt / 9.0))
		pp.blurs["bloom2"] = _blur(P, LS, maxf(1.0, wt / 3.5))
	var L: Dictionary = G["look"]
	var any_fx: bool = L["sparkles"] > 0.0 or p["dust"] > 0.0 or p["snow"] > 0.0 or p["bubbles"] > 0.0 or p["flash"] > 0.0 or p["splatter"] > 0.0 or p["shards"] > 0.0 or p["rocks"] > 0.0 or p["leaves"] > 0.0 or p["drops"] > 0.0 or p["embers"] > 0.0 or p["impact"] > 0.0
	if with_fx and any_fx:
		# 点缀先画进一张图，最后一步盖在刀身上面（不被侵蚀；两头尖的交接、像素化、色阶都连它一起）
		_fx_pipe(P, pp, ws)
	_post(P, pp, B)
	var m := pp.post_mat
	if LS:
		m.set_shader_parameter("has_bloom", true)
		m.set_shader_parameter("bl1", pp.blurs["bloom1"].tex())
		m.set_shader_parameter("bl2", pp.blurs["bloom2"].tex())
	if pp.fx:
		m.set_shader_parameter("has_fx", true)
		m.set_shader_parameter("fx", pp.fx.get_texture())
	if need_uv:
		m.set_shader_parameter("has_uv", true)
		m.set_shader_parameter("uvm", pp.uv.get_texture())
	return pp


# 点缀的各层（叠加 / 盖上去交替，和编辑器的顺序一样）
func _fx_parts(pp: Pipe, parent: Node) -> void:
	_part(pp, parent, S_SPARK, _add_mat)
	_part(pp, parent, S_FLASH_ADD, _add_mat)
	_part(pp, parent, S_FLASH_MIX)
	_part(pp, parent, S_SPLAT_SOFT)
	_part(pp, parent, S_SPLAT)
	_part(pp, parent, S_SOLID)
	_part(pp, parent, S_EMBERS, _add_mat)
	_part(pp, parent, S_IMPACT_ADD, _add_mat)
	_part(pp, parent, S_IMPACT_MIX)


# 飞出去的点缀画进一张图，最后一步盖在刀身上面（不被侵蚀）
func _fx_pipe(P: Pass, pp: Pipe, ws: Vector2i) -> void:
	var F := _vp(P, ws, false, 4)
	_fx_parts(pp, _canvas(F, P.s))
	pp.fx = F


# 色带：一张按像素算颜色的网格，速度线，点缀
func _pipe_bands(P: Pass, ws: Vector2i) -> Pipe:
	var pp := Pipe.new()
	var t := P.trail
	var bd: Dictionary = t["bands"]
	var B := _vp(P, ws, true, 4)
	var cB := _canvas(B, P.s)
	pp.mats["band"] = _band_mat(t, false)
	pp.mats["streak"] = _band_mat(t, true)
	_part(pp, cB, S_BAND_BODY, pp.mats["band"])
	_part(pp, cB, S_BAND_STREAK, pp.mats["streak"])
	_part(pp, cB, S_SPARKS)
	var fx: Dictionary = bd["fx"]
	if fx["dust"] > 0.0 or fx["shards"] > 0.0 or fx["splatter"] > 0.0 or fx["impact"] > 0.0:
		_fx_pipe(P, pp, ws)
	_post(P, pp, B)
	if pp.fx:
		var m := pp.post_mat
		m.set_shader_parameter("has_fx", true)
		m.set_shader_parameter("fx", pp.fx.get_texture())
		m.set_shader_parameter("snap", bool(t["pixel"]))
		var a := PackedVector3Array()
		for c in bd["colors"]:
			a.append(Vector3(c.r, c.g, c.b))
		while a.size() < 8:
			a.append(Vector3.ZERO)
		m.set_shader_parameter("snap_cols", a)
		m.set_shader_parameter("snap_n", (bd["colors"] as Array).size())
		m.set_shader_parameter("fx_op", float(t["opacity"]))
	return pp


func _tail_params(m: ShaderMaterial, t: Dictionary) -> void:
	var tl: Dictionary = t["tail"]
	m.set_shader_parameter("pixel", bool(t["pixel"]))
	m.set_shader_parameter("tail_mode", int(tl["mode"]))
	m.set_shader_parameter("fade", float(tl["fade"]))
	m.set_shader_parameter("crescent", bool(tl["crescent"]))
	m.set_shader_parameter("flip", bool(t["flip"]))
	m.set_shader_parameter("brush", t["brush_tex"])


func _band_mat(t: Dictionary, streak: bool) -> ShaderMaterial:
	var m := _mat("band")
	var bd: Dictionary = t["bands"]
	_tail_params(m, t)
	var bc := PackedVector3Array()
	var bf := PackedFloat32Array()
	for i in 8:
		if i < (bd["colors"] as Array).size():
			var c: Color = bd["colors"][i]
			bc.append(Vector3(c.r, c.g, c.b))
			bf.append(float(bd["bands"][i][1]))
		else:
			bc.append(Vector3.ZERO)
			bf.append(0.0)
	m.set_shader_parameter("bc", bc)
	m.set_shader_parameter("bf", bf)
	m.set_shader_parameter("bn", (bd["colors"] as Array).size())
	m.set_shader_parameter("blend_mode", maxi(0, int(bd["blend"])))
	m.set_shader_parameter("soft", float(bd["soft"]))
	m.set_shader_parameter("shade", float(bd["shade"]))
	m.set_shader_parameter("edge", bool(bd["edge"]))
	m.set_shader_parameter("efade", float(bd["edgeFade"]))
	m.set_shader_parameter("fade_steps", bool(bd["fadeSteps"]))
	m.set_shader_parameter("brk", float(bd["edgeBreak"]))
	m.set_shader_parameter("nseed", int(bd["seeds"]["noise"]))
	m.set_shader_parameter("pseed", int(bd["seeds"]["pieces"]))
	m.set_shader_parameter("splits", int(bd["splits"]))
	m.set_shader_parameter("streak_pass", streak)
	return m


# 纹理拖尾：贴图按 (u, v) 贴在拖尾上，再按模式上色
func _pipe_tex(P: Pass, ws: Vector2i) -> Pipe:
	var pp := Pipe.new()
	var t := P.trail
	var tx: Dictionary = t["tex"]
	var B := _vp(P, ws, true, 4)
	var m := _mat("tex")
	_tail_params(m, t)
	m.set_shader_parameter("tex", t["tex_tex"])
	m.set_shader_parameter("cmode", maxi(0, int(tx["mode"])))
	var mono := Color(String(tx["color"]))
	m.set_shader_parameter("mono", Vector3(mono.r, mono.g, mono.b))
	m.set_shader_parameter("invert", bool(tx["invert"]))
	var raw: Array = tx["stops"]
	var sorted := raw.duplicate()
	sorted.sort_custom(func(a, b): return float(a[0]) < float(b[0]))
	var gc := PackedVector3Array()
	var gp := PackedFloat32Array()
	var rc := PackedVector3Array()
	var rp := PackedFloat32Array()
	for i in 8:
		for pair in [[sorted, gc, gp], [raw, rc, rp]]:
			var list: Array = pair[0]
			if i < list.size():
				var c := Color(String(list[i][1]))
				pair[1].append(Vector3(c.r, c.g, c.b))
				pair[2].append(float(list[i][0]))
			else:
				pair[1].append(Vector3.ZERO)
				pair[2].append(0.0)
	m.set_shader_parameter("gc", gc)
	m.set_shader_parameter("gp", gp)
	m.set_shader_parameter("rc", rc)
	m.set_shader_parameter("rp", rp)
	m.set_shader_parameter("gn", raw.size())
	pp.mats["tex"] = m
	_part(pp, _canvas(B, P.s), S_TEX_BODY, m)
	_post(P, pp, B)
	return pp


func _update_mode(P: Pass, mode: int) -> void:
	for v in P.vps:
		(v as SubViewport).render_target_update_mode = mode


# 这一帧：重新画这段拖尾的这个深度
# 清掉记下来的帧（改了数据、颜色之后调用）
func refresh() -> void:
	for P in _passes:
		(P as Pass).cache.clear()
	_shown = ""


# 显示这一帧：记下来过就直接用，否则现在画
func _show(P: Pass, fi: int) -> void:
	P.cur = fi
	if not P.frames.has(fi):
		P.shown = false
		if P.disp:
			P.disp.visible = false
		return
	if P.cache.has(fi):
		_apply(P, P.cache[fi])
		return
	P.busy = -1  # 提前画的那一帧不要了，以后再画
	var drew := _render(P, fi)
	_apply(P, _live_entry(P, drew))


# 记下画好的这一帧
func _capture(P: Pass) -> void:
	var e := _live_entry(P, bool(P.live.get("drew", false)))
	if cache_frames:
		for k in ["fwd", "rev", "pix"]:
			if e.has(k):
				e[k] = ImageTexture.create_from_image((e[k] as Texture2D).get_image())
		P.cache[P.busy] = e
	if P.cur == P.busy:
		_apply(P, e)
	P.busy = -1


func _live_entry(P: Pass, drew: bool) -> Dictionary:
	var e := P.live.duplicate()
	e["drew"] = drew
	e["fwd"] = P.fwd.post.get_texture()
	if P.rev != null:
		e["rev"] = P.rev.post.get_texture()
	if P.pix != null:
		e["pix"] = P.pix.get_texture()
	return e


func _apply(P: Pass, e: Dictionary) -> void:
	P.shown = e["drew"]
	if P.disp == null:
		return
	P.disp.visible = visible and active and P.shown
	P.disp.texture = e["pix"] if e.has("pix") else e["fwd"]
	var m := P.disp_mat
	m.set_shader_parameter("fwd", e["fwd"])
	if e.has("rev"):
		m.set_shader_parameter("rev", e["rev"])
	for k in ["mids", "mus", "mid_n", "outline_px", "gain", "clip"]:
		if e.has(k):
			m.set_shader_parameter(k, e[k])


# 画这一帧（画进离屏图，两帧后画完）
func _render(P: Pass, fi: int) -> bool:
	P.live = {}
	if String(P.trail.get("kind", "")) == "stroke":
		var dr := _render_stroke(P, fi)
		P.live["drew"] = dr
		P.busy = fi
		_update_mode(P, SubViewport.UPDATE_ALWAYS)
		P.kick = 2
		return dr
	# 这一帧在画的是哪一段（共用这一套的几段不会同时出现）
	for m in P.members:
		if (m["frames"] as Array).has(fi):
			P.trail = m
			break
	var t := P.trail
	var mode: String = t["mode"]
	var st := _state(t, fi, mode == "glow" and float(t["glow"]["p"]["flash"]) > 0.0)
	var drew := false
	if not st.is_empty():
		var secs: Array = _ribbon(t, st["sticks"], st["trim"]) if (st["sticks"] as Array).size() >= 2 else []
		_s = P.s
		if mode == "glow":
			var runs := _glow_runs(secs, P.back)
			var ctx := {"frame": st["frame"], "alpha": st["alpha"], "fade": t["glow"]["fade"], "fx": not P.back, "run": st["run"], "age": st["age"], "ended": st["ended"], "after": st["after"]}
			drew = _glow_frame(P, secs, runs, ctx)
		else:
			var runs := _band_runs(secs, P.back)
			if mode == "bands":
				drew = _paint_bands(P, P.fwd, runs, st)
			else:
				drew = _paint_tex(P, P.fwd, runs, st)
	P.live["gain"] = float(t.get("gain", 1.0))
	P.live["drew"] = drew
	P.busy = fi
	_update_mode(P, SubViewport.UPDATE_ALWAYS)
	P.kick = 2
	return drew


# 光效的一帧：正着画，两头尖再倒着画一遍，交接用的中线，色阶的描边粗细
func _glow_frame(P: Pass, secs: Array, runs: Array, ctx: Dictionary) -> bool:
	var t := P.trail
	var drew := _paint_glow(P, P.fwd, runs, ctx)
	if P.rev != null:
		var rr := []
		for i in range(runs.size() - 1, -1, -1):
			var r: Array = runs[i]
			var out := []
			for j in range(r.size() - 1, -1, -1):
				var q: Dictionary = r[j]
				out.append({"a": q["a"], "b": q["b"], "u": 1.0 - float(q["u"]), "back": q["back"]})
			rr.append(out)
		var c2 := ctx.duplicate()
		c2["fx"] = false
		c2["ended"] = false
		if not runs.is_empty():
			_paint_glow(P, P.rev, rr, c2)
		else:
			P.rev.ops.clear()
			for prt in P.rev.parts:
				prt.queue_redraw()
	if P.rev != null:
		_set_mids(P, secs)
	if P.disp_mat and t["glow"].has("cel"):
		var cl: Dictionary = t["glow"]["cel"]
		var ow := 0.0
		if float(cl["outline"]) > 0.0:
			ow = maxf(1.0, roundf(float(cl["outline"]) * maxf(2.0, maxf(P.fwd.info.get("bw", 0.0), P.fwd.info.get("bh", 0.0)) / 140.0)))
		P.live["outline_px"] = ow
	return drew


# ---------- 拖尾笔（与编辑器 trails/stroke.js、editor/trailbrush.js 相同） ----------

# 拖尾平面：画面 → 平面（转回去，再拉开）和反过来；pl 为空时不变
func _unsq(pl, x: float, y: float) -> Array:
	if pl == null:
		return [x, y]
	var u: float = x * float(pl["cos"]) + y * float(pl["sin"])
	var v: float = -x * float(pl["sin"]) + y * float(pl["cos"])
	return [u, v / float(pl["s"])] if pl["h"] else [u / float(pl["s"]), v]


func _sq(pl, x: float, y: float) -> Array:
	if pl == null:
		return [x, y]
	var u: float = x if pl["h"] else x * float(pl["s"])
	var v: float = y * float(pl["s"]) if pl["h"] else y
	return [u * float(pl["cos"]) - v * float(pl["sin"]), u * float(pl["sin"]) + v * float(pl["cos"])]


# 弦：两端、中点、长度、左法线（在平面里）
func _chord(k: Array, pl) -> Dictionary:
	var a := _unsq(pl, float(k[0]), float(k[1]))
	var b := _unsq(pl, float(k[2]), float(k[3]))
	var dx: float = b[0] - a[0]
	var dy: float = b[1] - a[1]
	var L := sqrt(dx * dx + dy * dy)
	if L == 0.0:
		L = 1.0
	return {"ax": a[0], "ay": a[1], "bx": b[0], "by": b[1], "mx": (a[0] + b[0]) / 2.0, "my": (a[1] + b[1]) / 2.0, "L": L, "nx": -dy / L, "ny": dx / L}


# 笔触这一帧的路径：直线中点外 bend 处的二次曲线，平面里是一段圆弧再压扁（点用双精度的两个数组）
func _stroke_path(k: Array, pl, n: int) -> Array:
	var c := _chord(k, pl)
	var h := float(k[4])
	var xs := PackedFloat64Array()
	var ys := PackedFloat64Array()
	if pl == null:
		var cx: float = c["mx"] + c["nx"] * 2.0 * h
		var cy: float = c["my"] + c["ny"] * 2.0 * h
		for i in n + 1:
			var t := float(i) / n
			var u := 1.0 - t
			xs.append(u * u * c["ax"] + 2.0 * u * t * cx + t * t * c["bx"])
			ys.append(u * u * c["ay"] + 2.0 * u * t * cy + t * t * c["by"])
		return [xs, ys]
	if absf(h) < 0.01:
		for i in n + 1:
			var p := _sq(pl, c["ax"] + (c["bx"] - c["ax"]) * i / n, c["ay"] + (c["by"] - c["ay"]) * i / n)
			xs.append(p[0])
			ys.append(p[1])
		return [xs, ys]
	var Lr: float = c["L"]
	var R := (Lr * Lr / 4.0 + h * h) / (2.0 * absf(h))
	var ox: float = c["mx"] + c["nx"] * (h - signf(h) * R)
	var oy: float = c["my"] + c["ny"] * (h - signf(h) * R)
	var t0 := atan2(c["ay"] - oy, c["ax"] - ox)
	var tm := atan2(c["my"] + c["ny"] * h - oy, c["mx"] + c["nx"] * h - ox)
	var half := tm - t0
	while half > PI:
		half -= TAU
	while half < -PI:
		half += TAU
	for i in n + 1:
		var t := t0 + 2.0 * half * i / n
		var p := _sq(pl, ox + cos(t) * R, oy + sin(t) * R)
		xs.append(p[0])
		ys.append(p[1])
	return [xs, ys]


# 笔触所在的圆（平面里）：[圆心 x, y, 半径]，直的时候为空
func _stroke_circle(k: Array, pl) -> Array:
	var c := _chord(k, pl)
	var h := float(k[4])
	if absf(h) < 0.5:
		return []
	var Lr: float = c["L"]
	var R := (Lr * Lr / 4.0 + h * h) / (2.0 * absf(h))
	return [c["mx"] + c["nx"] * (h - signf(h) * R), c["my"] + c["ny"] * (h - signf(h) * R), R]


# 重新按约 1 像素取点，再滑动平均（两端不动）：编辑器 trailbrush.js prepare
func _prepare(xs0: PackedFloat64Array, ys0: PackedFloat64Array) -> Array:
	var px := PackedFloat64Array()
	var py := PackedFloat64Array()
	for i in xs0.size():
		if px.is_empty() or sqrt((xs0[i] - px[px.size() - 1]) ** 2 + (ys0[i] - py[py.size() - 1]) ** 2) >= 0.5:
			px.append(xs0[i])
			py.append(ys0[i])
	if px.size() < 2:
		return [px, py]
	var ox := PackedFloat64Array([px[0]])
	var oy := PackedFloat64Array([py[0]])
	var carry := 0.0
	for i in range(1, px.size()):
		var ln := sqrt((px[i] - px[i - 1]) ** 2 + (py[i] - py[i - 1]) ** 2)
		var d := 1.0 - carry
		while d <= ln:
			var t := d / ln
			ox.append(px[i - 1] + (px[i] - px[i - 1]) * t)
			oy.append(py[i - 1] + (py[i] - py[i - 1]) * t)
			d += 1.0
		carry = ln - (d - 1.0)
	ox.append(px[px.size() - 1])
	oy.append(py[py.size() - 1])
	var k := mini(4, int(floor(ox.size() / 4.0)))
	if k < 1:
		return [ox, oy]
	var sx := PackedFloat64Array()
	var sy := PackedFloat64Array()
	var m := ox.size()
	for i in m:
		if i == 0 or i == m - 1:
			sx.append(ox[i])
			sy.append(oy[i])
			continue
		var ax := 0.0
		var ay := 0.0
		var cnt := 0
		for j in range(maxi(0, i - k), mini(m - 1, i + k) + 1):
			ax += ox[j]
			ay += oy[j]
			cnt += 1
		sx.append(ax / cnt)
		sy.append(ay / cnt)
	return [sx, sy]


func _bprofile(shape: String, t: float, taper: float) -> float:
	if shape == "even":
		return 1.0
	if shape == "crescent":
		return maxf(0.08, pow(sin(PI * t), 0.7))
	return taper + (1.0 - taper) * t


# 拖尾笔的一帧
func _render_stroke(P: Pass, fi: int) -> bool:
	var t := P.trail
	var k = t["skeys"][fi]
	if k == null:
		return false
	var g: Dictionary = t["geo"]
	var pl = g.get("plane")
	var fade := float(k[6])
	P.live["gain"] = float(t.get("gain", 1.0)) * pow(1.0 - fade, 0.8)  # 消散时也淡出
	P.live["clip"] = Vector4.ZERO
	# 环绕：前半圈 / 后半圈（沿椭圆长轴切开，后半圈画在所有图层下面）
	if g.get("wrap") != null:
		var C := _stroke_circle(k, pl)
		if C.is_empty():
			if P.back:
				return false
		else:
			var f := -1.0 if g["wrap"]["flip"] else 1.0
			var fr := _sq(pl, 0.0, -f) if pl["h"] else _sq(pl, -f, 0.0)
			var far := Vector2(fr[0], fr[1]).normalized() * (1.0 if P.back else -1.0)
			var cc := _sq(pl, C[0], C[1])
			P.live["clip"] = Vector4(cc[0], cc[1], far.x, far.y)
	var path := _stroke_path(k, pl, 90 if pl != null else 60)
	var xs: PackedFloat64Array = path[0]
	var ys: PackedFloat64Array = path[1]
	var gone := fade * 0.85
	if gone > 0.0:
		var from := mini(xs.size() - 3, roundi(gone * (xs.size() - 1)))
		xs = xs.slice(from)
		ys = ys.slice(from)
	var curve := _prepare(xs, ys)
	var cx: PackedFloat64Array = curve[0]
	var cy: PackedFloat64Array = curve[1]
	if cx.size() < 2:
		return false
	# 截面：沿笔触，宽度按形状收窄，头部加圆弧
	var W := maxf(1.0, float(g["width"]) * float(k[5]) / 100.0)
	var n := cx.size() - 1
	var shape := String(g["shape"])
	var secs := []
	for i in n + 1:
		var ia := maxi(0, i - 1)
		var ib := mini(n, i + 1)
		var dx := cx[ib] - cx[ia]
		var dy := cy[ib] - cy[ia]
		var ln := sqrt(dx * dx + dy * dy)
		if ln == 0.0:
			ln = 1.0
		var u := float(i) / n
		var half := maxf(0.5, W * _bprofile(shape, u, float(g["taper"])) / 2.0)
		var nv := Vector2(-dy / ln * half, dx / ln * half)
		var p := Vector2(cx[i], cy[i])
		secs.append({"a": p - nv, "b": p + nv, "u": u, "back": P.back})
	if shape != "crescent" and float(g["headArc"]) > 0.0 and secs.size() >= 2:
		var hd: Dictionary = secs[secs.size() - 1]
		var pr: Dictionary = secs[secs.size() - 2]
		var m: Vector2 = ((hd["a"] as Vector2) + (hd["b"] as Vector2)) / 2.0
		var dir: Vector2 = (m - ((pr["a"] as Vector2) + (pr["b"] as Vector2)) / 2.0).normalized()
		var hv: Vector2 = ((hd["b"] as Vector2) - (hd["a"] as Vector2)) / 2.0
		var bulge := float(g["headArc"]) * hv.length()
		for i in range(1, 7):
			var th := float(i) / 6.0 * PI / 2.0
			secs.append({"a": m - hv * cos(th) + dir * bulge * sin(th), "b": m + hv * cos(th) + dir * bulge * sin(th), "u": 1.0, "back": P.back})
	_s = P.s
	if t["mode"] == "glow":
		# 光效：笔触代替一次挥砍，取几个截面当飞溅的「棍子」；不画起手闪光
		var run := []
		var ns := secs.size() - 1
		for j in 7:
			run.append(secs[roundi(ns * (0.3 + 0.7 * j / 6.0))])
		var seed_str := "%d:%d:%d" % [cx.size(), roundi(cx[0]), roundi(cy[0])]
		var ctx := {"frame": 0, "alpha": 1.0, "fade": t["glow"]["fade"], "fx": true, "run": run, "age": run.size() + 3, "ended": true, "after": 0, "seed": _hash_seed(seed_str)}
		return _glow_frame(P, secs, [secs], ctx)
	# 色带：亮边在弯的外侧
	if t["bands"]["edge"]:
		var turn := 0.0
		for i in range(2, cx.size()):
			turn += (cx[i - 1] - cx[i - 2]) * (cy[i] - cy[i - 1]) - (cy[i - 1] - cy[i - 2]) * (cx[i] - cx[i - 1])
		if turn > 0.0:
			for q in secs:
				var a = q["a"]
				q["a"] = q["b"]
				q["b"] = a
	var st := {"alpha": 1.0, "run": [], "frame": 0, "age": 0, "ended": false, "after": 0}
	var drew := _paint_bands(P, P.fwd, [secs], st)
	if drew and t.get("sparks", false):
		# 火星：头部附近几颗最亮颜色的散点
		_P = P.fwd
		_slot = S_SPARKS
		var cols: Array = t["bands"]["colors"]
		var bright: Color = cols[cols.size() - 1]
		var sd := [float(roundi(cx[0] * 131.0 + cy[0] * 977.0 + cx.size() * 17))]
		var cnt := maxi(3, roundi(cx.size() / 6.0))
		for s2 in cnt:
			var kk := int(floor(cx.size() * (0.45 + 0.55 * _lcg(sd))))
			var pi := mini(cx.size() - 1, kk)
			var ang := _lcg(sd) * TAU
			var rr := W * (0.6 + _lcg(sd) * 0.9)
			var x := roundi(cx[pi] + cos(ang) * rr)
			var y := roundi(cy[pi] + sin(ang) * rr)
			if x < 0 or y < 0 or x >= int(_w) or y >= int(_h):
				continue
			_emit(PackedInt32Array([0, 1, 2, 0, 2, 3]), PackedVector2Array([Vector2(x, y), Vector2(x + 1, y), Vector2(x + 1, y + 1), Vector2(x, y + 1)]), PackedColorArray([bright]))
		for prt in P.fwd.parts:
			prt.queue_redraw()
	return drew


# 编辑器火星用的线性同余随机数（和 JS 的双精度运算一样）
func _lcg(sd: Array) -> float:
	var v: float = float(sd[0]) * 1103515245.0 + 12345.0
	sd[0] = float(int(fmod(v, 4294967296.0)) & 0x7fffffff)
	return float(sd[0]) / 2147483647.0


# 编辑器 hashSeed：FNV-1a
func _hash_seed(text: String) -> int:
	var h := 2166136261
	for i in text.length():
		h = h ^ text.unicode_at(i)
		h = (h * 16777619) & 0xFFFFFFFF
	return h % 2147483646 + 1

# 两头尖：整条拖尾的中线（最多 48 个点）和每点的 u，交给 shader 找每个像素最近的一点
func _set_mids(P: Pass, secs: Array) -> void:
	var mids := PackedVector2Array()
	var us := PackedFloat32Array()
	var step := maxi(1, ceili(secs.size() / 48.0))
	for i in secs.size():
		if i % step == 0 or i == secs.size() - 1:
			mids.append(((secs[i]["a"] as Vector2) + (secs[i]["b"] as Vector2)) * 0.5)
			us.append(float(secs[i]["u"]))
	var n := mini(48, mids.size())
	mids.resize(48)
	us.resize(48)
	P.live["mids"] = mids
	P.live["mus"] = us
	P.live["mid_n"] = n
	if P.pix_mat != null:
		P.pix_mat.set_shader_parameter("mids", mids)
		P.pix_mat.set_shader_parameter("mus", us)
		P.pix_mat.set_shader_parameter("mid_n", n)


# 光效：同一深度、连续的截面分成一段段
func _glow_runs(secs: Array, back: bool) -> Array:
	var runs := []
	var cur = null
	for q in secs:
		if bool(q["back"]) == back:
			if cur == null:
				cur = []
				runs.append(cur)
			cur.append(q)
		else:
			cur = null
	return runs


# 色带 / 纹理：起点在这个深度的每一节（两个截面之间），连起来
func _band_runs(secs: Array, back: bool) -> Array:
	var runs := []
	var last := -2
	for i in range(secs.size() - 1):
		if bool(secs[i]["back"]) != back:
			continue
		if last == i - 1:
			runs[runs.size() - 1].append(secs[i + 1])
		else:
			runs.append([secs[i], secs[i + 1]])
		last = i
	return runs


# 坐标图：每个像素在拖尾上的 u、v（编辑器 uv.js 的 uvMap），外面再往两边延伸一截（尾部变色用）
func _paint_uv(pp: Pipe, runs: Array) -> void:
	pp.uv_ops.clear()
	var keep := _P
	var up := Pipe.new()
	up.ops = pp.uv_ops
	_P = up
	_slot = S_UV
	for pass_i in 2:
		for r in runs:
			for i in range(1, r.size()):
				var p: Dictionary = r[i - 1]
				var q: Dictionary = r[i]
				var spans: Array = [[-1.2, 0.0, 0.5], [1.0, 2.2, 0.5]] if pass_i == 0 else [[0.0, 1.0, 1.0]]
				for sp in spans:
					var v0: float = sp[0]
					var v1: float = sp[1]
					var f: float = sp[2]
					var on := f > 0.75
					var pts := PackedVector2Array([_at(p, v0), _at(p, v1), _at(q, v1), _at(q, v0)])
					var cols := PackedColorArray([
						Color(p["u"], 0.0 if not on else v0, (v0 + 2.0) / 5.0, f), Color(p["u"], 0.0 if not on else v1, (v1 + 2.0) / 5.0, f),
						Color(q["u"], 0.0 if not on else v1, (v1 + 2.0) / 5.0, f), Color(q["u"], 0.0 if not on else v0, (v0 + 2.0) / 5.0, f)])
					_emit(PackedInt32Array([0, 1, 2, 0, 2, 3]), pts, cols)
	_P = keep
	pp.uv_part.queue_redraw()
`;

// ---------------------------------------------------------------------------
// GDScript: trails/glow.js renderGlow and trails/glow/layers.js, layer by layer
const GLOW_GD = String.raw`
# ---------- 光效（与编辑器 trails/glow.js、trails/glow/layers.js 相同） ----------

func _paint_glow(P: Pass, pp: Pipe, runs: Array, ctx: Dictionary) -> bool:
	_P = pp
	pp.ops.clear()
	var p: Dictionary = P.trail["glow"]["p"]
	var run: Array = ctx["run"]
	var do_fx: bool = ctx["fx"]
	var ok: bool = not runs.is_empty() or (do_fx and not run.is_empty() and (p["flash"] > 0.0 or p["splatter"] > 0.0 or p["impact"] > 0.0))
	if ok:
		_glow_layers(P, pp, runs, ctx)
	for prt in pp.parts:
		prt.queue_redraw()
	return ok


func _glow_layers(P: Pass, pp: Pipe, runs: Array, ctx: Dictionary) -> void:
	var t := P.trail
	var G: Dictionary = t["glow"]
	var p: Dictionary = G["p"]
	var L: Dictionary = G["look"]
	var cols: Array = G["colors"]
	var core: Color = G["core_c"]
	var rim: Color = G["rim_c"]
	var splat: Color = G["splat_c"]
	var seed: int = ctx.get("seed", G["seed"])
	var frame: int = ctx["frame"]
	var alpha := clampf(float(ctx["alpha"]), 0.0, 1.0) * clampf(float(L["opacity"]) / 100.0, 0.0, 1.0)
	var opacity := clampf(float(L["opacity"]) / 100.0, 0.0, 1.0)
	var tail := clampf(float(ctx["fade"]), 0.05, 1.0)
	var dark: bool = G["dark"]
	var run: Array = ctx["run"]
	var do_fx: bool = ctx["fx"]
	var age: int = ctx["age"]
	var maxW := 1.0
	for r in runs:
		for q in r:
			maxW = maxf(maxW, _wd(q))
	for s in run:
		maxW = maxf(maxW, _wd(s))
	# 编辑器只在拖尾周围这一块里画（色阶的描边粗细按它算）
	var lo := Vector2(INF, INF)
	var hi := Vector2(-INF, -INF)
	for r in runs:
		for q in r:
			for k in ["a", "b"]:
				lo = lo.min(q[k])
				hi = hi.max(q[k])
	for s in run:
		for k in ["a", "b"]:
			lo = lo.min(s[k])
			hi = hi.max(s[k])
	var big: bool = do_fx and ((p["flash"] > 0.0 and age < 4) or (p["impact"] > 0.0 and bool(ctx["ended"])))
	var padk := 2.8 if (big or p["speedLines"] > 0.0 or p["rocks"] > 0.0 or p["leaves"] > 0.0 or p["drops"] > 0.0) else (2.2 if (p["embers"] > 0.0 or p["rays"] > 0.0 or p["snow"] > 0.0 or p["bubbles"] > 0.0) else 1.4)
	var pad := maxW * padk + 4.0
	var box0 := Vector2(maxf(0.0, floorf(lo.x - pad)), maxf(0.0, floorf(lo.y - pad)))
	pp.info["bw"] = minf(_w, ceilf(hi.x + pad)) - box0.x
	pp.info["bh"] = minf(_h, ceilf(hi.y + pad)) - box0.y
	for hc in pp.halves:
		(hc as Node2D).transform = Transform2D(0.0, Vector2(0.5, 0.5), 0.0, -box0 * 0.5)
	for hsp in pp.half_sprites:
		(hsp as Sprite2D).position = box0
	pp.post_mat.set_shader_parameter("box0", box0)
	for key in ["flow", "flow_add", "caustic"]:
		if pp.mats.has(key):
			(pp.mats[key] as ShaderMaterial).set_shader_parameter("box0", box0)
	if pp.uv != null:
		_paint_uv(pp, runs)

	if not runs.is_empty():
		var last: Array = runs[runs.size() - 1]
		# ---- haze：宽宽的几道颜色，重重地模糊
		if p["haze"] > 0.0:
			_slot = S_HAZE
			var haze: float = p["haze"]
			for r in runs:
				for l in 6:
					var v := (l + 0.5) / 6.0
					var col := _across(cols, v)
					for i in range(1, r.size()):
						var a: float = haze * 0.38 * _smooth(0.0, tail, r[i]["u"]) * (0.5 + 0.5 * sin(PI * v)) * alpha
						if a > 0.002:
							_seg(_at(r[i - 1], v), _at(r[i], v), _rgba(col, a), maxf(0.35, _wd(r[i]) / 6.0 * 1.7), false)
			pp.blurs["haze"].set_sigma(maxf(1.5, maxW / 6.0))
		# ---- flow：流动的刀身（shader）
		if p["flow"] > 0.0:
			_slot = S_FLOW
			for r in runs:
				_mesh(r)
			for m in [pp.mats["flow"], pp.mats.get("flow_add")]:
				if m == null:
					continue
				m.set_shader_parameter("seed", _i32(seed * 13 + 7))
				m.set_shader_parameter("frame", float(frame))
				m.set_shader_parameter("alpha", alpha)
				m.set_shader_parameter("tail", tail)
				m.set_shader_parameter("amount", float(p["flow"]))
				m.set_shader_parameter("cols", G["cols3"])
				m.set_shader_parameter("ncols", cols.size())
				m.set_shader_parameter("core", Vector3(core.r, core.g, core.b))
		# ---- 刀身里的岩石
		if p["rocks"] > 0.0:
			_slot = S_ROCKBODY
			_rock_body(last, cols, seed, alpha, tail, p["rocks"])
		# ---- 风刃：后半圈在刀身下面
		if p["curls"] > 0.0:
			_curls(last, core, rim, seed, frame, alpha, maxW, p["curls"])
		# ---- 火舌
		if p["flames"] > 0.0:
			_flames(last, cols, core, rim, seed, frame, alpha, tail, maxW, p["flames"], dark)
			if dark:
				pp.blurs["halo"].set_sigma(maxf(1.5, maxW / 30.0))
		# ---- 光丝（叠加）：每根是一个尖尖的多边形，位置每段拖尾固定，只有亮度每帧闪一点
		_slot = S_STRANDS
		var N := clampi(int(L["strands"]), 0, 160)
		var R := Rand.new(seed)
		var shimmer := Rand.new(seed * 31 + frame * 977)
		var dim := minf(1.0, sqrt(24.0 / maxf(1.0, N)))
		for s in N:
			var v := 0.03 + 0.94 * R.next()
			var reach := sin(PI * v)
			var u0 := maxf(0.0, (1.0 - reach) * tail * 0.9 + R.next() * tail * 0.7 - 0.05)
			var bright := pow(R.next(), 1.6) * (0.85 + 0.3 * shimmer.next())
			var thick := (0.3 + 0.9 * R.next()) * maxf(0.7, maxW / 28.0)
			var col := _across(cols, v + (R.next() - 0.5) * 0.1)
			var drift := (R.next() - 0.5) * 0.06
			var phase := R.next() * 6.28
			var c := _rgba(col, (0.25 + 0.75 * bright) * dim * alpha)
			for r in runs:
				_filament(r, u0, v, drift, phase, thick, c, tail)
		if N > 0:
			for r in runs:
				_filament(r, 0.0, 0.975, 0.0, 0.0, maxf(0.8, maxW / 40.0), _rgba(rim, 0.9 * alpha), tail)
		# ---- core：外侧一道锐利的月牙，边上是亮边色，中间白热
		if p["core"] > 0.0:
			_slot = S_CORE
			var cr: float = p["core"]
			var ca := alpha * alpha
			var u0 := maxf(0.0, 1.0 - (0.35 + 0.6 * cr))
			if p["shadow"] > 0.0:
				var dsum := Vector2.ZERO
				for r in runs:
					for q in r:
						dsum += (q["a"] as Vector2) - (q["b"] as Vector2)
				var dl := dsum.length()
				var off := dsum / (dl if dl > 0.0 else 1.0) * maxW * 0.14 * float(p["shadow"])
				var c0: Color = cols[0]
				var sc := Color(roundf(c0.r * 255.0 * 0.75) / 255.0, roundf(c0.g * 255.0 * 0.75) / 255.0, roundf(c0.b * 255.0 * 0.75) / 255.0)
				for r in runs:
					_crescent(r, u0, cr, 1.2, 0.74, 1.0, off, _rgba(sc, ca * 0.9))
			for r in runs:
				_crescent(r, u0, cr, 1.2, 0.74, 1.0, Vector2.ZERO, _rgba(rim, ca))
			for r in runs:
				_crescent(r, u0, cr, 1.5, 0.76, 0.6, Vector2.ZERO, _rgba(core, ca))
		# ---- 头部的热光，只在真正的头那一遍（前后分开时中间断开的不算）
		var hd: Dictionary = last[last.size() - 1]
		if float(hd["u"]) > 0.999:
			_slot = S_HEAD
			var lo_e := PackedVector2Array()
			var hi_e := PackedVector2Array()
			for q in last:
				lo_e.append(q["a"])
				hi_e.append(q["b"])
			_strip(lo_e, hi_e, PackedColorArray([Color.WHITE]), PackedColorArray([Color.WHITE]))
			var m: ShaderMaterial = pp.mats["head"]
			m.set_shader_parameter("center", _at(hd, 0.7))
			m.set_shader_parameter("radius", _wd(hd) * 0.6 + 1.0)
			m.set_shader_parameter("c0", Color(core, clampf(0.45 * alpha * alpha, 0.0, 1.0)))
			m.set_shader_parameter("c1", Color(rim, clampf(0.22 * alpha, 0.0, 1.0)))
		# ---- 闪电
		if p["bolts"] > 0.0:
			_bolts(last, core, rim, seed, frame, alpha, maxW, p["bolts"])
		# ---- 冰晶、速度线
		if p["crystal"] > 0.0:
			_slot = S_CRYSTALS
			_crystals(last, cols, core, seed, alpha, tail, maxW, p["crystal"])
		if p["speedLines"] > 0.0:
			_slot = S_SPEED
			_speed_lines(last, core, rim, seed, frame, alpha, maxW, p["speedLines"])
		# ---- 水纹（shader）
		if p["caustic"] > 0.0:
			_slot = S_CAUSTIC
			for r in runs:
				_mesh(r)
			var m: ShaderMaterial = pp.mats["caustic"]
			var lc := _across(cols, 0.85)
			m.set_shader_parameter("seed", _i32(seed * 5 + 3))
			m.set_shader_parameter("frame", float(frame))
			m.set_shader_parameter("alpha", alpha)
			m.set_shader_parameter("amount", float(p["caustic"]))
			m.set_shader_parameter("light", Vector3(lc.r, lc.g, lc.b))
		# ---- 锯齿、光芒
		if p["serrate"] > 0.0:
			_slot = S_SERRATE
			_serrate(last, cols, core, seed, alpha, tail, p["serrate"])
		if p["rays"] > 0.0:
			_slot = S_RAYS
			_rays(last, core, rim, seed, frame, alpha, maxW, p["rays"])
		if pp.blurs.has("bloom1"):
			var r1 := maxf(1.0, maxW / 9.0)
			var r2 := maxf(1.0, maxW / 3.5)
			for bb in [[pp.blurs["bloom1"], r1], [pp.blurs["bloom2"], r2]]:
				var bl: Blur = bb[0]
				var rad: float = bb[1]
				bl.set_sigma(rad)
				bl.set_src(((pp.info["ls"] if int(floor(rad / 5.0)) <= 1 else pp.info["lo"]) as SubViewport).get_texture())

	# 最后一步的参数：辉光、撕裂、尾部变色、侵蚀
	var m := pp.post_mat
	var bloom: float = p["glow"] if not runs.is_empty() else 0.0
	m.set_shader_parameter("k1", bloom * 0.45)
	m.set_shader_parameter("k2", bloom * 0.35)
	m.set_shader_parameter("frame", float(frame))
	m.set_shader_parameter("tear_amt", float(p["tear"]) if not runs.is_empty() else 0.0)
	m.set_shader_parameter("tear_seed", _i32(seed * 211 + 5))
	m.set_shader_parameter("tear_wseed", _i32(seed * 7 + 1))
	var tint_on: bool = not runs.is_empty() and p["tailTint"] > 0.0 and G["tail_c"] != null
	m.set_shader_parameter("tint_amt", float(p["tailTint"]) if tint_on else 0.0)
	if tint_on:
		var tc: Color = G["tail_c"]
		m.set_shader_parameter("tint", Vector3(tc.r, tc.g, tc.b))
		m.set_shader_parameter("tint_dv", maxf(2.0, maxW / 5.0) / maxW)
	var life := clampf(float(ctx["alpha"]), 0.0, 1.0)
	var et: float = float(p["erode"]) * (0.08 + 0.92 * (1.0 - life)) if not runs.is_empty() else 0.0
	m.set_shader_parameter("erode_t", et)
	m.set_shader_parameter("erode_cell", maxf(2.0, maxW / 4.0 / 2.0))
	m.set_shader_parameter("erode_seed", _i32(seed))

	if do_fx:
		_glow_fx(pp, runs, run, ctx, G, maxW, alpha, opacity)


# 光丝：从 u0 开始由尖变粗，横向位置 v 随 u 轻轻摆动；越靠近尾部越淡（编辑器里的遮罩）
func _filament(r: Array, u0: float, v: float, drift: float, phase: float, width: float, col: Color, tail: float) -> void:
	var lo := PackedVector2Array()
	var hi := PackedVector2Array()
	var cl := PackedColorArray()
	for q in r:
		var u: float = q["u"]
		if u < u0:
			continue
		var t := (u - u0) / maxf(1e-3, 1.0 - u0)
		var c := _at(q, v + drift * sin(phase + u * 5.0))
		var nv: Vector2 = (q["b"] as Vector2) - (q["a"] as Vector2)
		var nl := nv.length()
		nv = nv / (nl if nl > 0.0 else 1.0) * (width / 2.0 * pow(t, 0.8))
		lo.append(c - nv)
		hi.append(c + nv)
		cl.append(_rgba(col, col.a * _smooth(0.0, tail, u) * (0.45 + 0.55 * u)))
	_strip(lo, hi, cl, cl)


# 刃芯的月牙：外侧 vc 处、从 u0 到头越来越宽
func _crescent(r: Array, u0: float, core: float, ex: float, vc: float, k: float, off: Vector2, col: Color) -> void:
	var lo := PackedVector2Array()
	var hi := PackedVector2Array()
	for q in r:
		var u: float = q["u"]
		if u < u0:
			continue
		var t := (u - u0) / maxf(1e-3, 1.0 - u0)
		var half := (0.04 + 0.26 * core) * pow(t, ex) * k
		lo.append(_at(q, vc - half) + off)
		hi.append(_at(q, vc + half) + off)
	_strip(lo, hi, PackedColorArray([col]), PackedColorArray([col]))


# 拖尾本身的网格（UV = 截面的 u、横向 v），和编辑器 texTri 一样的三角形
func _mesh(r: Array) -> void:
	var pts := PackedVector2Array()
	var uvs := PackedVector2Array()
	var cols := PackedColorArray()
	var idx := PackedInt32Array()
	for i in range(1, r.size()):
		var p: Dictionary = r[i - 1]
		var q: Dictionary = r[i]
		var b := pts.size()
		pts.append_array(PackedVector2Array([p["a"], p["b"], q["b"], q["a"]]))
		uvs.append_array(PackedVector2Array([Vector2(p["u"], 0.0), Vector2(p["u"], 1.0), Vector2(q["u"], 1.0), Vector2(q["u"], 0.0)]))
		for j in 4:
			cols.append(Color.WHITE)
		idx.append_array(PackedInt32Array([b, b + 1, b + 2, b, b + 2, b + 3]))
	_emit(idx, pts, cols, uvs)


func _rock_body(r: Array, cols: Array, seed: int, alpha: float, tail: float, amount: float) -> void:
	if r.size() < 2:
		return
	var N := roundi(amount * 36.0)
	var S := Rand.new(seed * 223 + 1)
	for k in N:
		var u := 0.05 + 0.83 * pow(S.next(), 0.8)
		var v := 0.05 + 0.92 * S.next()
		var c: Vector2 = _on_run(r, u, v)[0]
		var size := _width(r, u) * (0.05 + 0.2 * pow(S.next(), 3.0)) * (0.5 + 0.5 * u)
		var a := alpha * _smooth(0.0, tail, u)
		if a <= 0.03 or size < 0.8:
			S.next()
			S.next()
			continue
		_rock(c, size, S.next() * 6.28, S, cols, a)
	var GN := roundi(amount * 90.0)
	for k in GN:
		var u := 0.08 + 0.82 * pow(S.next(), 0.7)
		var v := -0.25 + 1.4 * S.next()
		var c: Vector2 = _on_run(r, u, clampf(v, 0.0, 1.0))[0]
		var ac: Vector2 = _on_run(r, u, 1.0)[0]
		var ai: Vector2 = _on_run(r, u, 0.0)[0]
		var off := v if v < 0.0 else (v - 1.0 if v > 1.0 else 0.0)
		var pt := c + (ac - ai) * off
		var size := maxf(0.6, _width(r, u) * (0.01 + 0.02 * S.next()))
		var a := alpha * _smooth(0.0, tail, u) * (0.5 + 0.5 * S.next())
		_disc(pt, size, _rgba(cols[1] if S.next() < 0.5 else cols[mini(2, cols.size() - 1)], a))


# 风刃：一条条软软的风，像绳子一样绕着刀身转；转到后面的那段画进 S_CURLS_BACK（在刀身下面）
func _curls(r: Array, core: Color, rim: Color, seed: int, frame: int, alpha: float, maxW: float, amount: float) -> void:
	if r.size() < 2:
		return
	var N := 2 + roundi(amount * 2.0)
	var S := Rand.new(seed * 191 + 3)
	var bandW := maxf(3.0, maxW / 6.0)
	var coreW := maxf(0.8, maxW / 45.0)
	for k in N:
		var u0 := 0.02 + 0.3 * S.next()
		var u1 := minf(1.0, u0 + 0.6 + 0.4 * S.next())
		var turns := 0.6 + 0.4 * S.next()
		var amp := 0.75 + 0.2 * S.next()
		var phase := S.next() * 6.28
		phase += frame * (0.45 + 0.25 * S.next())
		var fat := 0.7 + 0.5 * S.next()
		var n := 48
		var pts := PackedVector2Array()
		var ws := PackedFloat32Array()
		var fr := []
		for i in n + 1:
			var t := float(i) / n
			var u := u0 + (u1 - u0) * t
			var ang := phase + t * turns * TAU
			pts.append(_ext(r, u, 0.5 + amp * sin(ang)))
			var z := cos(ang)
			fr.append(z >= 0.0)
			ws.append(fat * pow(maxf(0.0, sin(PI * t)), 0.8) * (0.55 + 0.45 * maxf(0.0, z)))
		var a := alpha * (0.55 + 0.45 * u1)
		var i0 := 0
		for i in range(1, n + 1):
			if i < n and fr[i] == fr[i0]:
				continue
			if fr[i0]:
				_slot = S_CURLS_FRONT
				_band(pts, ws, i0, i, bandW, _rgba(rim, 0.32 * a))
				_band(pts, ws, i0, i, coreW, _rgba(core, 0.6 * a))
			else:
				_slot = S_CURLS_BACK
				_band(pts, ws, i0, i, bandW * 0.8, _rgba(rim, 0.28 * a))
			i0 = i


func _band(pts: PackedVector2Array, ws: PackedFloat32Array, i0: int, i1: int, scale: float, col: Color) -> void:
	var n := pts.size() - 1
	var lo := PackedVector2Array()
	var hi := PackedVector2Array()
	for i in range(i0, i1 + 1):
		var d := pts[mini(n, i + 1)] - pts[maxi(0, i - 1)]
		var l := d.length()
		d = d / (l if l > 0.0 else 1.0)
		var hw := ws[i] * scale / 2.0
		lo.append(pts[i] + Vector2(-d.y, d.x) * hw)
		hi.append(pts[i] + Vector2(d.y, -d.x) * hw)
	_strip(lo, hi, PackedColorArray([col]), PackedColorArray([col]))


# 火舌：从刀身里长出来、往拖尾后面飘的火；黑炎用深色画，下面垫一层模糊的亮边色
func _flames(r: Array, cols: Array, core: Color, rim: Color, seed: int, frame: int, alpha: float, tail: float, maxW: float, amount: float, dark: bool) -> void:
	if r.size() < 2:
		return
	var N := roundi(amount * 26.0)
	var S := Rand.new(seed * 71 + 1)
	var P := Rand.new(seed * 71 + frame * 733 + 2)
	var nc := cols.size() - 1
	for k in N:
		var u := 0.15 + 0.85 * pow(S.next(), 0.7)
		var outer := (not dark) and S.next() < 0.2
		var vb := (0.9 + 0.06 * S.next()) if outer else (0.3 + 0.4 * S.next())
		var o := _on_run(r, u, vb)
		var B: Vector2 = o[0]
		var across: Vector2 = o[1]
		var bd: Vector2 = (_on_run(r, maxf(0.0, u - 0.04), vb)[0] as Vector2) - B
		var bl := bd.length()
		bd = bd / (bl if bl > 0.0 else 1.0)
		var nv := across if outer else -across
		var ln := maxW * (0.2 + 0.4 * S.next()) * (0.75 + 0.45 * P.next()) * (0.5 + 0.5 * u)
		var wid := ln * (0.3 + 0.2 * S.next())
		var lean := 0.15 + 0.2 * P.next()
		var tip := B + bd * ln + nv * ln * lean
		var b1 := B - bd * wid * 0.6 + nv * wid * 0.3
		var b2 := B - bd * wid * 0.2 - nv * wid * 0.5
		var pv := Vector2(-(tip.y - B.y), tip.x - B.x)
		var pl := pv.length()
		pv = pv / (pl if pl > 0.0 else 1.0)
		var whip := (P.next() - 0.5) * wid * 1.4
		var c1 := (b1 + tip) / 2.0 + pv * (wid * 0.5 + whip)
		var c2 := (b2 + tip) / 2.0 - pv * (wid * 0.35 - whip)
		var a := alpha * _smooth(0.0, tail, u) * (0.55 + 0.45 * u)
		if a <= 0.02:
			continue
		var shape := _lick(b1, c1, tip, c2, b2)
		_slot = S_FLAMES_MIX
		var i0 := mini(1, nc) if dark else mini(3, nc)
		var i1 := 0 if dark else mini(2, nc)
		var i2 := 0 if dark else mini(1, nc)
		_gfill(shape, B, tip, [[0.0, _rgba(cols[i0], 0.85 * a)], [0.55, _rgba(cols[i1], 0.5 * a)], [1.0, _rgba(cols[i2], 0.0)]])
		if dark:
			_slot = S_FLAME_HALO
			_gfill(shape, B, tip, [[0.0, _rgba(rim, 0.7 * a)], [1.0, _rgba(rim, 0.0)]])
		elif S.next() < 0.5:
			_slot = S_FLAMES_MIX
			_poly(_lick(B.lerp(b1, 0.5), B.lerp(c1, 0.5), B.lerp(tip, 0.55), B.lerp(c2, 0.5), B.lerp(b2, 0.5)), PackedColorArray([_rgba(core, 0.45 * a)]))


# b1 →（c1 弯）→ tip →（c2 弯）→ b2 的封闭形状
func _lick(b1: Vector2, c1: Vector2, tip: Vector2, c2: Vector2, b2: Vector2) -> PackedVector2Array:
	var out := PackedVector2Array()
	for i in 11:
		out.append(_quad(b1, c1, tip, i / 10.0))
	for i in range(1, 11):
		out.append(_quad(tip, c2, b2, i / 10.0))
	return out


# 闪电：沿着刀身的几道锯齿（中点位移），带往外的分叉；每帧都是新的
func _bolts(r: Array, core: Color, rim: Color, seed: int, frame: int, alpha: float, maxW: float, amount: float) -> void:
	if amount <= 0.0 or alpha <= 0.01 or r.size() < 2:
		return
	var P := Rand.new(seed * 61 + frame * 1297 + 5)
	var paths := []
	var count := 1 + roundi(amount * 3.0)
	for k in count:
		var u0 := 0.12 + 0.45 * P.next()
		var v0 := 0.45 + 0.5 * P.next()
		var pts := []
		for s in 7:
			var uu := u0 + (1.0 - u0) * s / 6.0
			pts.append(_on_run(r, uu, clampf(v0 + (P.next() - 0.5) * 0.4, 0.1, 1.05))[0])
		var main := _jag(pts, 0.5, 4, P)
		var mw := _widths(main.size(), 1.0, 0.25, true, P)
		paths.append([main, mw])
		var forks := 1 + int(floor(P.next() * 3.0 * amount + 0.5))
		for f in forks:
			var at := int(floor(main.size() * (0.2 + 0.7 * P.next())))
			var start: Vector2 = main[mini(main.size() - 1, at)]
			var out: Vector2 = _on_run(r, u0 + (1.0 - u0) * float(at) / main.size(), 1.0)[2]
			var ol := out.length()
			var side := 1.0 if P.next() < 0.75 else -1.0
			var turn := (P.next() - 0.5) * 1.4
			var d := (out / (ol if ol > 0.0 else 1.0) * side).rotated(turn)
			var ln := maxW * (0.25 + 0.55 * P.next())
			var fork := _jag([start, start + d * ln], 0.6, 3, P)
			paths.append([fork, _widths(fork.size(), mw[mini(mw.size() - 1, at)] * 0.7, 0.06, false, P)])
	var flick := alpha * (0.75 + 0.25 * P.next())
	_slot = S_BOLTS
	var glowW := maxf(3.0, maxW / 6.0)
	var coreW := maxf(1.4, maxW / 22.0)
	for pw in paths:
		_wband(pw[0], pw[1], glowW, _rgba(rim, 0.4 * flick))
	for pw in paths:
		_wband(pw[0], pw[1], coreW, _rgba(core, 0.95 * flick))


func _jag(pts: Array, rough: float, depth: int, P: Rand) -> Array:
	var cur: Array = pts
	for d in depth:
		var nxt := [cur[0]]
		for i in range(1, cur.size()):
			var a: Vector2 = cur[i - 1]
			var b: Vector2 = cur[i]
			var dd := b - a
			var ln := dd.length()
			if ln == 0.0:
				ln = 1.0
			var off := (P.next() - 0.5) * ln * rough
			nxt.append((a + b) / 2.0 + Vector2(-dd.y / ln * off, dd.x / ln * off))
			nxt.append(b)
		cur = nxt
		rough *= 0.55
	return cur


func _widths(n: int, w0: float, w1: float, root: bool, P: Rand) -> PackedFloat32Array:
	var out := PackedFloat32Array()
	var rr := 1.0
	for i in n:
		var t := float(i) / (n - 1) if n > 1 else 0.0
		rr = 0.6 * rr + 0.4 * (0.5 + P.next())
		var start := 0.35 + 0.65 * _smooth(0.0, 0.1, t) if root else 1.0
		out.append(maxf(0.04, (w0 + (w1 - w0) * t) * rr * start))
	return out


# 一条宽度沿路变化的带子（闪电）
func _wband(pts: Array, ws: PackedFloat32Array, scale: float, col: Color) -> void:
	var n := pts.size()
	var lo := PackedVector2Array()
	var hi := PackedVector2Array()
	for i in n:
		var p: Vector2 = pts[i]
		var d: Vector2 = (pts[mini(n - 1, i + 1)] as Vector2) - (pts[maxi(0, i - 1)] as Vector2)
		var l := d.length()
		d = d / (l if l > 0.0 else 1.0)
		var half := ws[i] * scale / 2.0
		lo.append(p + Vector2(-d.y, d.x) * half)
		hi.append(p + Vector2(d.y, -d.x) * half)
	_strip(lo, hi, PackedColorArray([col]), PackedColorArray([col]))


func _crystals(r: Array, cols: Array, core: Color, seed: int, alpha: float, tail: float, maxW: float, amount: float) -> void:
	if r.size() < 2:
		return
	var N := roundi(amount * 46.0)
	var S := Rand.new(seed * 113 + 9)
	var light := _across(cols, 0.9)
	var dark := _across(cols, 0.45)
	for k in N:
		var u := 0.35 + 0.65 * pow(S.next(), 0.6)
		var v := 0.5 + 0.5 * pow(S.next(), 0.7)
		var o := _on_run(r, u, v)
		var pt: Vector2 = o[0]
		var behind: Vector2 = _on_run(r, maxf(0.0, u - 0.03), v)[0]
		var td := pt - behind
		var tl := td.length()
		td = td / (tl if tl > 0.0 else 1.0)
		var along := td.rotated((S.next() - 0.5) * 0.5)
		var Lw := maxW * (0.5 + 0.5 * u)
		var ln := Lw * (0.18 + 0.3 * S.next())
		var wid := ln * (0.25 + 0.2 * S.next())
		var a := alpha * _smooth(0.0, tail, u) * (0.5 + 0.5 * u)
		if a <= 0.03:
			continue
		_crystal(pt, along, o[1], ln, wid, light, dark, core, a)


func _crystal(c: Vector2, along: Vector2, out: Vector2, ln: float, wid: float, light: Color, dark: Color, ridge: Color, a: float) -> void:
	var f := c + along * ln * 0.62
	var bk := c - along * ln * 0.38
	var s1 := c + out * wid * 0.5 + along * ln * 0.06
	var s2 := c - out * wid * 0.42 - along * ln * 0.04
	_poly(PackedVector2Array([f, s1, bk]), PackedColorArray([_rgba(light, 0.8 * a)]))
	_poly(PackedVector2Array([f, bk, s2]), PackedColorArray([_rgba(dark, 0.7 * a)]))
	_seg(f, bk, _rgba(ridge, 0.9 * a), maxf(0.5, wid / 9.0), false)


func _speed_lines(r: Array, core: Color, rim: Color, seed: int, frame: int, alpha: float, maxW: float, amount: float) -> void:
	if r.size() < 2:
		return
	var N := roundi(amount * 22.0)
	var S := Rand.new(seed * 131 + 3)
	var P := Rand.new(seed * 131 + frame * 557 + 1)
	for k in N:
		var u := 0.55 + 0.45 * pow(S.next(), 0.5)
		var v := 0.15 + 0.9 * S.next()
		var pt: Vector2 = _on_run(r, u, v)[0]
		var bd: Vector2 = (_on_run(r, maxf(0.0, u - 0.04), v)[0] as Vector2) - pt
		var bl := bd.length()
		bd = bd / (bl if bl > 0.0 else 1.0)
		var ln := maxW * (0.8 + 2.2 * pow(S.next(), 1.5)) * (0.6 + 0.6 * P.next())
		var a := alpha * (0.35 + 0.5 * P.next()) * u
		var lw := maxf(0.6, maxW / (30.0 + 50.0 * S.next()))
		_gline(pt, pt + bd * ln, [[0.0, _rgba(core, 0.85 * a)], [0.3, _rgba(rim, 0.5 * a)], [1.0, _rgba(rim, 0.0)]], lw, true)


func _serrate(r: Array, cols: Array, core: Color, seed: int, alpha: float, tail: float, amount: float) -> void:
	if r.size() < 2:
		return
	var N := maxi(1, roundi(amount * 11.0))
	var S := Rand.new(seed * 229 + 7)
	var nc := cols.size() - 1
	for k in N:
		var u := 0.3 + 0.55 * (k + 0.2 + S.next() * 0.6) / N
		var du := 0.045 + 0.04 * S.next()
		var b1: Vector2 = _on_run(r, minf(1.0, u + du * 0.4), 0.62)[0]
		var b2: Vector2 = _on_run(r, maxf(0.0, u - du * 0.6), 0.52)[0]
		var tu := maxf(0.0, u - du * (3.0 + 1.5 * S.next()))
		var tip: Vector2 = _on_run(r, tu, 0.04 + 0.14 * S.next())[0]
		var a := alpha * _smooth(0.0, tail, u) * (0.65 + 0.35 * u)
		if a <= 0.03:
			continue
		_gfill(PackedVector2Array([b1, tip, b2]), b1, tip, [[0.0, _rgba(cols[mini(2, nc)], 0.95 * a)], [0.7, _rgba(cols[mini(1, nc)], 0.75 * a)], [1.0, _rgba(cols[mini(1, nc)], 0.2 * a)]])
		_gline(b1, tip, [[0.0, _rgba(core, 0.85 * a)], [1.0, _rgba(core, 0.0)]], 1.2, false)


func _rays(r: Array, core: Color, rim: Color, seed: int, frame: int, alpha: float, maxW: float, amount: float) -> void:
	if r.size() < 2:
		return
	var N := roundi(amount * 40.0)
	var S := Rand.new(seed * 97 + 4)
	var P := Rand.new(seed * 97 + frame * 571 + 6)
	for k in N:
		var u := 0.25 + 0.75 * pow(S.next(), 0.6)
		var o := _on_run(r, u, 0.95)
		var B: Vector2 = o[0]
		var d: Vector2 = (o[1] as Vector2).rotated((S.next() - 0.5) * 0.6)
		var ln := maxW * (0.4 + 1.4 * pow(S.next(), 2.0)) * (0.7 + 0.5 * P.next()) * (0.4 + 0.6 * u)
		var a := alpha * (0.35 + 0.65 * P.next())
		var lw := maxf(0.8, maxW / (35.0 + 60.0 * S.next()))
		_gline(B, B + d * ln, [[0.0, _rgba(core, 0.75 * a)], [0.35, _rgba(rim, 0.35 * a)], [1.0, _rgba(rim, 0.0)]], lw, true)
`;

// ---------------------------------------------------------------------------
// GDScript: trails/glow/fx.js, the accents around the trail
const FX_GD = String.raw`
# ---------- 飞出去的点缀（与编辑器 trails/glow/fx.js 相同） ----------

func _glow_fx(pp: Pipe, runs: Array, run: Array, ctx: Dictionary, G: Dictionary, maxW: float, alpha: float, opacity: float) -> void:
	var p: Dictionary = G["p"]
	var L: Dictionary = G["look"]
	var cols: Array = G["colors"]
	var core: Color = G["core_c"]
	var rim: Color = G["rim_c"]
	var splat: Color = G["splat_c"]
	var seed: int = ctx.get("seed", G["seed"])
	var frame: int = ctx["frame"]
	var age: int = ctx["age"]
	if not runs.is_empty():
		var r: Array = runs[runs.size() - 1]
		_slot = S_SPARK
		_sparkles(r, cols, seed, frame, alpha, maxW, clampi(int(L["sparkles"]), 0, 80), float(L["sparkleSize"]))
		_dust(r, cols, seed, frame, alpha, maxW, p["dust"])
		_snow(r, core, rim, seed, frame, alpha, maxW, p["snow"])
		_bubbles(r, core, rim, seed, frame, alpha, maxW, p["bubbles"])
	if not run.is_empty():
		_flash(run, core, rim, seed, frame, age, alpha, p["flash"])
		_splatter(pp, run, splat, seed, age, alpha, p["splatter"])
		_slot = S_SOLID
		_shards(run, cols, core, seed, age, alpha, p["shards"])
		_rocks(run, cols, seed, age, opacity, maxW, p["rocks"])
		_leaves(run, cols, seed, age, opacity, maxW, p["leaves"])
		_drops(run, cols, core, seed, age, opacity, maxW, p["drops"])
		if not runs.is_empty() and p["drops"] > 0.0:
			_drops_body(runs[runs.size() - 1], cols, core, seed, frame, alpha, clampf(float(ctx["fade"]), 0.05, 1.0), p["drops"])
		_slot = S_EMBERS
		_embers(run, core, rim, seed, frame, age, opacity, maxW, p["embers"], G["dark"])
		if bool(ctx["ended"]):
			_impact(run, core, rim, splat, seed, frame, int(ctx["after"]), opacity, p["impact"])


# 截面序号：编辑器 fx.js 里 while (i < r.length - 1 && r[i].u < u) i++
func _sec_at(r: Array, u: float) -> Dictionary:
	var i := 1
	while i < r.size() - 1 and float(r[i]["u"]) < u:
		i += 1
	return r[mini(i, r.size() - 1)]


func _sparkles(r: Array, cols: Array, seed: int, frame: int, alpha: float, maxW: float, K: int, sz: float) -> void:
	if K <= 0:
		return
	var P := Rand.new(seed * 7 + frame * 131)
	var size := maxf(1.0, sz if sz != 0.0 else 6.0) * maxf(0.6, maxW / 40.0)
	for k in K:
		var u := 0.35 + 0.65 * pow(P.next(), 0.7)
		var v := -0.3 + 1.6 * P.next()
		var pt := _at(_sec_at(r, u), v)
		var tw := pow(P.next(), 1.4) * alpha
		var s := size * (0.4 + 0.9 * P.next()) * (0.6 + 0.6 * tw)
		if tw < 0.08:
			continue
		_star(pt, s, _across(cols, clampf(v, 0.0, 1.0)), tw, P.next() * 0.4)


func _star(p: Vector2, s: float, c: Color, a: float, tilt: float) -> void:
	_radial(p, s, [[0.0, Color(1, 1, 1, 0.9 * a)], [0.3, _rgba(c, 0.4 * a)], [1.0, _rgba(c, 0.0)]])
	for d in [[Vector2(cos(tilt), sin(tilt)), s * 1.8], [Vector2(-sin(tilt), cos(tilt)), s * 1.2]]:
		var v: Vector2 = d[0] * d[1]
		_gline(p - v, p + v, [[0.0, Color(1, 1, 1, 0.0)], [0.5, Color(1, 1, 1, clampf(0.95 * a, 0.0, 1.0))], [1.0, Color(1, 1, 1, 0.0)]], maxf(0.6, s / 6.0), false)
	var fl := s * 4.5
	_gline(p - Vector2(fl, 0), p + Vector2(fl, 0), [[0.0, _rgba(c, 0.0)], [0.5, _rgba(c, 0.45 * a)], [1.0, _rgba(c, 0.0)]], maxf(0.5, s / 10.0), false)


func _dust(r: Array, cols: Array, seed: int, frame: int, alpha: float, maxW: float, amount: float) -> void:
	var N := roundi(amount * 140.0)
	if N <= 0:
		return
	var R := Rand.new(seed * 91 + 3)
	var T := Rand.new(seed * 17 + frame * 389)
	var unit := maxf(0.6, maxW / 90.0)
	for k in N:
		var u := pow(R.next(), 0.6)
		var v := 1.05 - pow(R.next(), 0.8) * 1.35
		var size := unit * (0.5 + 1.6 * pow(R.next(), 3.0))
		var tw := (0.3 + 0.7 * T.next()) * alpha
		var pt := _at(_sec_at(r, u), v)
		var c := _across(cols, clampf(v + 0.3, 0.0, 1.0))
		var w := Color(roundf((c.r + (1.0 - c.r) * 0.5) * 255.0) / 255.0, roundf((c.g + (1.0 - c.g) * 0.5) * 255.0) / 255.0, roundf((c.b + (1.0 - c.b) * 0.5) * 255.0) / 255.0)
		_disc(pt, size, _rgba(w, tw * (0.4 + 0.6 * u)))


func _snow(r: Array, core: Color, rim: Color, seed: int, frame: int, alpha: float, maxW: float, amount: float) -> void:
	var N := roundi(amount * 26.0)
	if N <= 0:
		return
	var R := Rand.new(seed * 149 + 5)
	var T := Rand.new(seed * 151 + frame * 263)
	for k in N:
		var u := 0.15 + 0.85 * pow(R.next(), 0.7)
		var v := -0.35 + 1.6 * R.next()
		var size := maxW * (0.05 + 0.08 * pow(R.next(), 2.0))
		var spin := R.next() * PI
		spin += frame * (R.next() - 0.5) * 0.3
		var tw := (0.35 + 0.65 * T.next()) * alpha * (0.4 + 0.6 * u)
		var p := _at(_sec_at(r, u), v)
		if tw < 0.06:
			continue
		_radial(p, size * 1.2, [[0.0, _rgba(rim, 0.35 * tw)], [1.0, _rgba(rim, 0.0)]])
		var col := _rgba(core, 0.9 * tw)
		var lw := maxf(0.5, size / 9.0)
		for arm in 6:
			var th := spin + arm * PI / 3.0
			var d := Vector2(cos(th), sin(th))
			_seg(p, p + d * size, col, lw, true)
			for br in [[0.45, 0.32], [0.7, 0.22]]:
				var bp: Vector2 = p + d * size * float(br[0])
				for sgn in [1.0, -1.0]:
					var bt: float = th + sgn * PI / 3.0
					_seg(bp, bp + Vector2(cos(bt), sin(bt)) * size * float(br[1]), col, lw, true)


func _bubbles(r: Array, core: Color, rim: Color, seed: int, frame: int, alpha: float, maxW: float, amount: float) -> void:
	var N := roundi(amount * 30.0)
	if N <= 0:
		return
	var R := Rand.new(seed * 167 + 7)
	for k in N:
		var u := 0.2 + 0.8 * pow(R.next(), 0.7)
		var v := -0.3 + 1.5 * R.next()
		var size := maxW * (0.02 + 0.045 * pow(R.next(), 1.5))
		var speed := maxW * (0.03 + 0.05 * R.next())
		var phase := R.next() * 6.28
		var p0 := _at(_sec_at(r, u), v)
		var p := p0 + Vector2(sin(frame * 0.8 + phase) * size * 0.6, -speed * (frame % 12) * 0.3)
		var a := alpha * (0.4 + 0.6 * u)
		_ring(p, size, maxf(0.6, size / 5.0), _rgba(rim, 0.75 * a))
		_disc(p, size, _rgba(rim, 0.12 * a))
		_disc(p - Vector2(size, size) * 0.35, maxf(0.5, size * 0.22), _rgba(core, 0.9 * a))


# 起手的闪光：几道光芒、一个亮点、一圈变大的环，几帧就没了
func _flash(run: Array, core: Color, rim: Color, seed: int, frame: int, age: int, alpha: float, amount: float) -> void:
	var f := amount * clampf(1.0 - age / 4.0, 0.0, 1.0) * alpha
	if f <= 0.01:
		return
	var s0: Dictionary = run[0]
	var Lw := maxf(4.0, _wd(s0))
	var c: Vector2 = (s0["a"] as Vector2).lerp(s0["b"], 0.8)
	var R := Lw * (0.7 + 0.15 * age)
	var P := Rand.new(seed * 13 + 5)
	var F := Rand.new(seed * 17 + frame * 59)
	_slot = S_FLASH_ADD
	_radial(c, R * 0.9, [[0.0, _rgba(core, 0.9 * f)], [0.15, _rgba(rim, 0.45 * f)], [1.0, _rgba(rim, 0.0)]])
	var main := P.next() * PI
	var rays := []
	for k in 2:
		var th := main + k * PI + (P.next() - 0.5) * 0.15
		rays.append([th, R * (1.0 + 0.4 * P.next()), 1.0])
	for k in 12:
		var th := P.next() * TAU
		var ln := R * (0.35 + 0.6 * P.next())
		rays.append([th, ln, 0.35 + 0.3 * F.next()])
	for ry in rays:
		var th: float = ry[0]
		var b: float = ry[2]
		_gline(c, c + Vector2(cos(th), sin(th)) * float(ry[1]), [[0.0, _rgba(core, f * b)], [0.35, _rgba(rim, 0.7 * f * b)], [1.0, _rgba(rim, 0.0)]], maxf(0.8, Lw / (22.0 if b == 1.0 else 40.0)), true)
	_slot = S_FLASH_MIX
	_ring(c, R * (0.25 + 0.12 * age), maxf(0.8, Lw / 50.0), _rgba(rim, 0.7 * f))
	_disc(c, maxf(1.0, Lw * 0.05), Color(1, 1, 1, clampf(f, 0.0, 1.0)))


# 墨点一样的飞溅：每一滴在某根棍子上出生，往外飞一点，停在那里直到拖尾消散
func _splatter(pp: Pipe, run: Array, col: Color, seed: int, age: int, alpha: float, amount: float) -> void:
	var K := roundi(amount * 14.0)
	if K <= 0 or alpha <= 0.01:
		return
	_slot = S_SPLAT
	var first := age - (run.size() - 1)
	var size := 1.0
	for s in run:
		size = maxf(size, _wd(s))
	var c := _rgba(col, alpha * 0.9)
	var sg := maxf(1.0, size / 30.0)
	for k in K:
		var R := Rand.new(seed * 101 + k * 7919)
		var bi := 1 + int(floor(R.next() * maxi(1, mini(run.size(), 8) - 1) * 1.6))
		var since := age - (first + bi)
		if since < 0 or bi >= run.size():
			continue
		var s: Dictionary = run[bi]
		var base: Vector2 = (s["a"] as Vector2).lerp(s["b"], 0.6 + 0.6 * R.next())
		var d: Vector2 = (s["b"] as Vector2) - (s["a"] as Vector2)
		var dl := d.length()
		d = d / (dl if dl > 0.0 else 1.0)
		var ud := d.rotated((R.next() - 0.5) * 2.2)
		var travel := size * (0.05 + 0.3 * R.next()) * (1.0 - exp(-(since + 1) / 1.6))
		var p := base + ud * travel
		var grow := minf(1.0, (since + 1) / 2.0)
		var rr := size * (0.03 + 0.05 * R.next()) * grow
		var n := 3 + int(floor(R.next() * 4.0))
		for i in n:
			var o := rr * 0.7 * R.next()
			var th := R.next() * TAU
			_splat_disc(p + Vector2(cos(th), sin(th)) * o, rr * (0.4 + 0.5 * R.next()), c, sg)
		var m := 2 + int(floor(R.next() * 5.0))
		for i in m:
			var sp := (R.next() - 0.5) * 1.2
			var dd := rr * (1.4 + 2.6 * R.next()) * (0.6 + 0.4 * grow)
			_splat_disc(p + ud.rotated(sp) * dd, maxf(0.5, rr * (0.1 + 0.25 * R.next())), c, sg)


# 飞溅的一点：实心的，加上编辑器里模糊后 55% 叠在下面的那一份（柔边的圆）
func _splat_disc(c: Vector2, r: float, col: Color, sg: float) -> void:
	_slot = S_SPLAT_SOFT
	var R := r + 2.0 * sg
	var stops := []
	for d in [0.0, maxf(0.0, r - sg), r, r + sg, R]:
		var x: float = (r - d) / sg
		var phi := 0.5 * (1.0 + tanh(0.7978846 * (x + 0.044715 * x * x * x)))
		stops.append([d / R, _rgba(col, col.a * 0.55 * phi)])
	_radial(c, R, stops)
	_slot = S_SPLAT
	_disc(c, r, col)


func _shards(run: Array, cols: Array, core: Color, seed: int, age: int, alpha: float, amount: float) -> void:
	var K := roundi(amount * 14.0)
	if K <= 0 or alpha <= 0.01 or run.size() < 2:
		return
	var first := age - (run.size() - 1)
	var light := _across(cols, 0.85)
	var dark := _across(cols, 0.4)
	for k in K:
		var R := Rand.new(seed * 53 + k * 7907)
		var bi := 1 + int(floor(R.next() * maxi(1, mini(run.size(), 8) - 1) * 1.5))
		var since := age - (first + bi)
		if since < 0 or bi >= run.size():
			continue
		var s: Dictionary = run[bi]
		var pv: Dictionary = run[bi - 1]
		var Lw := _wd(s)
		var life := alpha * clampf(1.0 - since / 8.0, 0.0, 1.0)
		if life <= 0.02:
			continue
		var o := _unit((s["b"] as Vector2) - (s["a"] as Vector2))
		var tv := _unit((s["b"] as Vector2) - (pv["b"] as Vector2))
		var c0: Vector2 = (s["a"] as Vector2).lerp(s["b"], 0.55 + 0.5 * R.next())
		var drift := Lw * (0.04 + 0.2 * R.next()) * (1.0 - exp(-(since + 1) / 2.0))
		var cx := c0.x - tv.x * drift * 1.5 + o.x * drift * (R.next() - 0.3)
		var cy := c0.y - tv.y * drift * 1.5 + o.y * drift * (R.next() - 0.3)
		var along := tv.rotated((R.next() - 0.5) * 0.7)
		var ln := Lw * (0.16 + 0.24 * R.next())
		var wid := ln * (0.22 + 0.16 * R.next())
		_crystal(Vector2(cx, cy), along, Vector2(-along.y, along.x), ln, wid, light, dark, core, life)


func _rocks(run: Array, cols: Array, seed: int, age: int, opacity: float, maxW: float, amount: float) -> void:
	var K := roundi(amount * 20.0)
	if K <= 0 or run.size() < 2:
		return
	var first := age - (run.size() - 1)
	for k in K:
		var R := Rand.new(seed * 179 + k * 4391)
		var bi := 1 + int(floor(R.next() * (run.size() - 1)))
		var since := age - (first + bi)
		var life := 6.0 + R.next() * 5.0
		if since < 0 or since > life or bi >= run.size():
			continue
		var s: Dictionary = run[bi]
		var pv: Dictionary = run[bi - 1]
		var o := _unit((s["b"] as Vector2) - (s["a"] as Vector2))
		var tv := _unit((s["b"] as Vector2) - (pv["b"] as Vector2))
		var base: Vector2 = (s["a"] as Vector2).lerp(s["b"], 0.15 + 0.9 * R.next())
		var sp := maxW * (0.06 + 0.1 * R.next())
		var fw := maxW * 0.06 * R.next()
		var g := maxW * 0.025
		if since < 1:
			continue
		var t := since + 1.6
		var c := base + o * sp * t + tv * fw * t + Vector2(0.0, g * t * t)
		var size := maxW * (0.035 + 0.07 * pow(R.next(), 1.5))
		var a := opacity * clampf(1.0 - (since - life * 0.6) / (life * 0.4), 0.0, 1.0)
		var spin := R.next() * 6.28
		spin += since * (R.next() - 0.5) * 0.8
		_rock(c, size, spin, R, cols, a)


func _leaves(run: Array, cols: Array, seed: int, age: int, opacity: float, maxW: float, amount: float) -> void:
	var K := roundi(amount * 16.0)
	if K <= 0 or run.size() < 2:
		return
	var first := age - (run.size() - 1)
	var nc := cols.size() - 1
	for k in K:
		var R := Rand.new(seed * 197 + k * 5279)
		var bi := 1 + int(floor(R.next() * (run.size() - 1)))
		var since := age - (first + bi)
		var life := 7.0 + R.next() * 6.0
		if since < 0 or since > life or bi >= run.size():
			continue
		var s: Dictionary = run[bi]
		var pv: Dictionary = run[bi - 1]
		var o := _unit((s["b"] as Vector2) - (s["a"] as Vector2))
		var tv := _unit((s["b"] as Vector2) - (pv["b"] as Vector2))
		var base: Vector2 = (s["a"] as Vector2).lerp(s["b"], 0.5 + 0.6 * R.next())
		var t := since + 0.5
		var sp := maxW * (0.06 + 0.08 * R.next())
		var flutter := sin(t * 1.7 + R.next() * 6.0) * maxW * 0.08
		var c := base + o * sp * t - tv * sp * 0.6 * t + Vector2(-o.y, o.x) * flutter
		var size := maxW * (0.04 + 0.04 * R.next())
		var turn := R.next() * 6.28
		turn += t * (R.next() - 0.5) * 1.6
		var flip := absf(cos(t * 1.3 + R.next() * 6.0))
		var ax := Vector2(cos(turn), sin(turn))
		var nv := Vector2(-ax.y, ax.x) * flip
		var a := opacity * clampf(1.0 - (since - life * 0.6) / (life * 0.4), 0.0, 1.0)
		var tip := c + ax * size
		var tl := c - ax * size
		var shape := PackedVector2Array()
		for i in 11:
			shape.append(_quad(tl, c + nv * size * 0.9, tip, i / 10.0))
		for i in range(1, 10):
			shape.append(_quad(tip, c - nv * size * 0.9, tl, i / 10.0))
		_poly(shape, PackedColorArray([_rgba(cols[mini(1, nc)], 0.9 * a)]))
		_seg(tl, tip, _rgba(cols[mini(2, nc)], 0.9 * a), maxf(0.5, size / 8.0), false)


func _drops(run: Array, cols: Array, core: Color, seed: int, age: int, opacity: float, maxW: float, amount: float) -> void:
	var K := roundi(amount * 9.0)
	if K <= 0 or run.size() < 2:
		return
	var first := age - (run.size() - 1)
	for k in K:
		var R := Rand.new(seed * 233 + k * 3779)
		var bi := 1 + int(floor(R.next() * (run.size() - 1)))
		var since := age - (first + bi)
		var life := 4.0 + R.next() * 5.0
		if since < 0 or since > life or bi >= run.size():
			continue
		var s: Dictionary = run[bi]
		var pv: Dictionary = run[bi - 1]
		var o := _unit((s["b"] as Vector2) - (s["a"] as Vector2))
		var tv := _unit((s["b"] as Vector2) - (pv["b"] as Vector2))
		var base: Vector2 = (s["a"] as Vector2).lerp(s["b"], 0.2 + 0.9 * R.next())
		var t := since + 0.6
		var so := maxW * (0.05 + 0.1 * R.next())
		var sf := maxW * (0.03 + 0.08 * R.next())
		var g := maxW * 0.012
		var vel := o * so + tv * sf + Vector2(0.0, g * t * 2.0)
		var c := base + (o * so + tv * sf) * t + Vector2(0.0, g * t * t)
		var rr := maxW * (0.012 + 0.03 * pow(R.next(), 1.5))
		var a := opacity * clampf(1.0 - (since - life * 0.6) / (life * 0.4), 0.0, 1.0)
		_teardrop(c, _unit(vel), rr, rr * (2.5 + 2.0 * R.next()), cols, core, a)


func _drops_body(r: Array, cols: Array, core: Color, seed: int, frame: int, alpha: float, tail: float, amount: float) -> void:
	if r.size() < 2:
		return
	var N := roundi(amount * 30.0)
	var S := Rand.new(seed * 239 + 5)
	for k in N:
		var u := 0.08 + 0.92 * pow(S.next(), 0.85)
		var pick := S.next()
		var drift := fmod(frame * 0.03 + S.next(), 1.0) * 0.25
		var v := 0.0
		if pick < 0.55:
			v = 1.03 + 0.35 * S.next() + drift
		elif pick < 0.8:
			v = -0.03 - 0.35 * S.next() - drift
		else:
			v = 0.15 + 0.7 * S.next()
		var p := _ext(r, u, v)
		var wd := (_on_run(r, u, 1.0)[0] as Vector2).distance_to(_on_run(r, u, 0.0)[0])
		var d := _unit(_ext(r, minf(1.0, u + 0.03), v) - p)
		var r0 := wd * (0.035 + 0.06 * pow(S.next(), 1.5)) * (0.45 + 0.55 * u)
		var a := alpha * _smooth(0.0, tail, u) * (0.55 + 0.45 * u)
		if a <= 0.03 or r0 < 0.6:
			S.next()
			continue
		_teardrop(p, d, r0, r0 * (2.2 + 2.0 * S.next()), cols, core, a)


func _teardrop(c: Vector2, d: Vector2, r: float, tail_len: float, cols: Array, core: Color, a: float) -> void:
	var nv := Vector2(-d.y, d.x)
	var back := c - d * tail_len
	var front := c + d * r
	var shape := PackedVector2Array()
	for i in 11:
		shape.append(_quad(back, c + nv * r * 1.1 - d * r * 0.6, front, i / 10.0))
	for i in range(1, 10):
		shape.append(_quad(front, c - nv * r * 1.1 - d * r * 0.6, back, i / 10.0))
	var nc := cols.size() - 1
	_gfill(shape, back, front, [[0.0, _rgba(cols[mini(1, nc)], 0.4 * a)], [1.0, _rgba(cols[mini(2, nc)], 0.95 * a)]])
	_disc(c + nv * r * 0.3, maxf(0.5, r * 0.3), _rgba(core, 0.9 * a))


func _embers(run: Array, core: Color, rim: Color, seed: int, frame: int, age: int, opacity: float, maxW: float, amount: float, dark: bool) -> void:
	var K := roundi(amount * 34.0)
	if K <= 0 or run.is_empty():
		return
	var first := age - (run.size() - 1)
	var hot := Color(roundf((rim.r + (1.0 - rim.r) * 0.45) * 255.0) / 255.0, roundf((rim.g + (1.0 - rim.g) * 0.45) * 255.0) / 255.0, roundf((rim.b + (1.0 - rim.b) * 0.45) * 255.0) / 255.0) if dark else core
	var F := Rand.new(seed * 89 + frame * 313)
	for k in K:
		var R := Rand.new(seed * 83 + k * 6151)
		var bi := int(floor(R.next() * run.size()))
		var since := age - (first + bi + int(floor(R.next() * 2.0)))
		var life := 5.0 + R.next() * 7.0
		if since < 0 or since > life:
			continue
		var s: Dictionary = run[bi]
		var p0: Vector2 = (s["a"] as Vector2).lerp(s["b"], 0.3 + 0.7 * R.next())
		var rise := maxW * (0.05 + 0.08 * R.next()) * since
		var sway := sin(since * 0.9 + R.next() * 6.28) * maxW * 0.05
		sway += (R.next() - 0.5) * maxW * 0.08 * since
		var p := p0 + Vector2(sway, -rise)
		var fade := 1.0 - since / life
		var size := maxf(0.6, maxW * (0.01 + 0.018 * R.next()) * (0.5 + 0.5 * fade))
		var a := opacity * fade * (0.6 + 0.4 * F.next())
		_radial(p, size * 3.5, [[0.0, _rgba(hot, 0.9 * a)], [0.35, _rgba(rim, 0.45 * a)], [1.0, _rgba(rim, 0.0)]])


# 命中爆点：挥完的地方炸开，光、尖刺、光线、碎屑，之后几帧变大、变淡
func _impact(run: Array, core: Color, rim: Color, splat: Color, seed: int, frame: int, after: int, opacity: float, amount: float) -> void:
	var f := amount * opacity * clampf(1.0 - after / 4.0, 0.0, 1.0)
	if f <= 0.01:
		return
	var last: Dictionary = run[run.size() - 1]
	var Lw := maxf(4.0, _wd(last))
	var c: Vector2 = (last["a"] as Vector2).lerp(last["b"], 0.85)
	if run.size() >= 2:
		var d: Vector2 = (last["b"] as Vector2) - (run[run.size() - 2]["b"] as Vector2)
		var dl := d.length()
		if dl > 1e-3:
			c += d / dl * Lw * 0.18
	var R0 := Lw * (0.55 + 0.3 * after)
	var P := Rand.new(seed * 29 + 11)
	var F := Rand.new(seed * 37 + frame * 71)
	_slot = S_IMPACT_ADD
	_radial(c, R0, [[0.0, _rgba(core, 0.95 * f)], [0.25, _rgba(rim, 0.6 * f)], [1.0, _rgba(rim, 0.0)]])
	for k in 10:
		var th := P.next() * TAU
		var ln := R0 * (0.8 + 1.0 * P.next())
		ln *= 0.8 + 0.4 * F.next()
		var wid := R0 * (0.06 + 0.1 * P.next())
		var e := c + Vector2(cos(th), sin(th)) * ln
		var nv := Vector2(-sin(th), cos(th)) * wid
		_gfill(PackedVector2Array([c + nv, e, c - nv]), c, e, [[0.0, _rgba(core, 0.85 * f)], [0.45, _rgba(rim, 0.5 * f)], [1.0, _rgba(rim, 0.0)]])
	for k in 18:
		var th := P.next() * TAU
		var ln := R0 * (0.6 + 1.1 * P.next())
		ln *= 0.8 + 0.4 * F.next()
		_gline(c, c + Vector2(cos(th), sin(th)) * ln, [[0.0, _rgba(core, 0.9 * f)], [0.4, _rgba(rim, 0.5 * f)], [1.0, _rgba(rim, 0.0)]], maxf(0.7, Lw / (30.0 if k < 4 else 60.0)), true)
	_slot = S_IMPACT_MIX
	for k in 26:
		var th := P.next() * TAU
		var dist := R0 * (0.3 + 1.0 * P.next()) * (0.6 + 0.4 * after)
		var rr := Lw * (0.008 + 0.025 * pow(P.next(), 2.0))
		_disc(c + Vector2(cos(th), sin(th)) * dist, maxf(0.6, rr), _rgba(splat, 0.9 * f))


# 一块石头：不规则多边形，左上亮右下暗，一道深色描边（编辑器 shapes.js rockShape）
func _rock(c: Vector2, size: float, spin: float, rnd: Rand, cols: Array, a: float) -> void:
	var nc := cols.size() - 1
	var n := 6 + int(floor(rnd.next() * 3.0))
	var pts := PackedVector2Array()
	for i in n:
		var th := spin + float(i) / n * TAU + (rnd.next() - 0.5) * 0.5
		var rr := size * (0.62 + 0.45 * rnd.next())
		pts.append(c + Vector2(cos(th), sin(th)) * rr)
	_gfill(pts, c - Vector2(size, size), c + Vector2(size, size), [[0.0, _rgba(cols[mini(2, nc)], a)], [0.55, _rgba(cols[mini(1, nc)], a)], [1.0, _rgba(cols[0], a)]])
	_pline(pts, _rgba(cols[0], 0.9 * a), maxf(0.5, size / 8.0), true)
	var lit := PackedVector2Array()
	var dk := PackedVector2Array()
	for v in pts:
		if (v.x - c.x) + (v.y - c.y) < size * 0.2:
			lit.append(v)
		if (v.x - c.x) + (v.y - c.y) > size * 0.35:
			dk.append(v)
	if lit.size() >= 2:
		lit.append(c + Vector2(size, size) * 0.05)
		_poly(lit, PackedColorArray([_rgba(cols[mini(3, nc)], 0.75 * a)]))
	if dk.size() >= 2:
		dk.append(c + Vector2(size, size) * 0.15)
		_poly(dk, PackedColorArray([_rgba(cols[0], 0.55 * a)]))
`;

// ---------------------------------------------------------------------------
// GDScript: trails/model.js renderBands and the textured modes
const BANDS_GD = String.raw`
# ---------- 色带、纹理拖尾（与编辑器 trails/model.js 相同） ----------

func _paint_bands(P: Pass, pp: Pipe, runs: Array, st: Dictionary) -> bool:
	_P = pp
	pp.ops.clear()
	var t := P.trail
	var bd: Dictionary = t["bands"]
	if runs.is_empty():
		for prt in pp.parts:
			prt.queue_redraw()
		return false
	_slot = S_BAND_BODY
	for r in runs:
		_mesh(r)
	var gone := 1.0 - clampf(float(st["alpha"]), 0.0, 1.0)
	var op := float(t["opacity"]) * (1.0 if bool(t["pixel"]) else 1.0 - 0.5 * gone)
	for key in ["band", "streak"]:
		var m: ShaderMaterial = pp.mats[key]
		m.set_shader_parameter("op", op)
		m.set_shader_parameter("gone", gone)
		m.set_shader_parameter("nseed", int(bd["seeds"]["noise"]))
		m.set_shader_parameter("pseed", int(bd["seeds"]["pieces"]))
	# 速度线：每段拖尾固定的几条细线，透过淡掉的刀身露出来
	var n := roundi(float(bd["streaks"]) * 16.0)
	if n > 0:
		_slot = S_BAND_STREAK
		var edge: bool = bd["edge"]
		var sd := 1
		for r in runs:
			for q in r:
				sd = (sd * 31 + roundi((q["a"] as Vector2).x * 7.0 + (q["b"] as Vector2).y * 13.0)) % 2147483647
		var box := [sd]
		for s in n:
			var v := 0.04 + 0.6 * pow(_lrnd(box), 0.8) if edge else 0.08 + 0.84 * _lrnd(box)
			var u0 := _lrnd(box) * 0.55
			var u1 := minf(1.0, u0 + 0.25 + _lrnd(box) * 0.6)
			var e := 1.0 - v if edge else absf(2.0 * v - 1.0)
			var col := _band_smooth(bd, maxf(0.0, e - 0.25))
			for r in runs:
				var prev = null
				var prev_u := 0.0
				for q in r:
					var qu: float = q["u"]
					if qu < u0 or qu > u1:
						prev = null
						continue
					var pt := _at(q, v)
					if prev != null:
						var mm := (qu - u0) / (u1 - u0)
						var a := sin(PI * mm) * (0.55 + 0.45 * _lrnd(box))
						_uvline(prev, pt, Vector2(prev_u, v), Vector2(qu, v), Color(col, clampf(a, 0.0, 1.0)), 1.1)
					prev = pt
					prev_u = qu
	# 点缀（粒子、碎片、飞溅、命中爆点），像素风格时吸到色带的颜色上
	var fx: Dictionary = bd["fx"]
	var run: Array = st["run"]
	if pp.fx and not run.is_empty():
		var cols: Array = bd["colors"]
		var core: Color = cols[cols.size() - 1]
		var rim: Color = cols[maxi(0, cols.size() - 2)]
		var splat: Color = cols[int(floor((cols.size() - 1) / 2.0))]
		var seed: int = bd["seeds"]["fx"]
		var frame: int = st["frame"]
		var age: int = st["age"]
		var alpha := clampf(float(st["alpha"]), 0.0, 1.0)
		var maxW := 1.0
		for r in runs:
			for q in r:
				maxW = maxf(maxW, _wd(q))
		for s in run:
			maxW = maxf(maxW, _wd(s))
		if fx["dust"] > 0.0:
			_slot = S_SPARK
			_dust(runs[runs.size() - 1], cols, seed, frame, alpha, maxf(maxW, 60.0), fx["dust"])
		if fx["splatter"] > 0.0:
			_splatter(pp, run, splat, seed, age, alpha, fx["splatter"])
		if fx["shards"] > 0.0:
			_slot = S_SOLID
			_shards(run, cols, core, seed, age, alpha, fx["shards"])
		if bool(st["ended"]) and fx["impact"] > 0.0:
			_impact(run, core, rim, splat, seed, frame, int(st["after"]), 1.0, fx["impact"])
	for prt in pp.parts:
		prt.queue_redraw()
	return true


# 速度线的随机数（编辑器里按截面坐标起的种子）
func _lrnd(box: Array) -> float:
	box[0] = (int(box[0]) * 16807) % 2147483647
	return float(box[0]) / 2147483647.0


# 色带的平滑渐变（速度线的颜色）
func _band_smooth(bd: Dictionary, e: float) -> Color:
	var cols: Array = bd["colors"]
	var fs: Array = []
	for b in bd["bands"]:
		fs.append(float(b[1]))
	var n := cols.size()
	var k := 0
	while k < n - 1 and e <= fs[k + 1]:
		k += 1
	var soft: float = bd["soft"]
	if soft <= 0.0 or n < 2:
		return cols[k]
	for j in [k, k + 1]:
		if j < 1 or j > n - 1:
			continue
		var nxt: float = fs[j + 1] if j + 1 < n else 0.0
		var hw: float = soft * 0.5 * minf(fs[j - 1] - fs[j], fs[j] - nxt)
		var d: float = e - fs[j]
		if hw <= 0.0 or absf(d) >= hw:
			continue
		var tt := (d + hw) / (2.0 * hw)
		tt = tt * tt * (3.0 - 2.0 * tt)
		var p: Color = cols[j]
		var q: Color = cols[j - 1]
		return Color(sqrt(p.r * p.r * (1.0 - tt) + q.r * q.r * tt), sqrt(p.g * p.g * (1.0 - tt) + q.g * q.g * tt), sqrt(p.b * p.b * (1.0 - tt) + q.b * q.b * tt))
	return cols[k]


# 一段带 UV 的细线（色带 shader 按 UV 判断这里的刀身是不是已经淡掉）
func _uvline(p: Vector2, q: Vector2, up: Vector2, uq: Vector2, col: Color, lw: float) -> void:
	var d := _unit(q - p)
	var nv := Vector2(-d.y, d.x) * lw / 2.0
	var b := 0
	_emit(PackedInt32Array([b, b + 1, b + 2, b, b + 2, b + 3]), PackedVector2Array([p - nv, p + nv, q + nv, q - nv]), PackedColorArray([col, col, col, col]), PackedVector2Array([up, up, uq, uq]))


func _paint_tex(P: Pass, pp: Pipe, runs: Array, st: Dictionary) -> bool:
	_P = pp
	pp.ops.clear()
	_slot = S_TEX_BODY
	for r in runs:
		_mesh(r)
	(pp.mats["tex"] as ShaderMaterial).set_shader_parameter("op", float(P.trail["opacity"]) * float(st["alpha"]))
	for prt in pp.parts:
		prt.queue_redraw()
	return not runs.is_empty()
`;

// ---------------------------------------------------------------------------
// GDScript: drawing primitives (Canvas 2D's strokes, fills and gradients as
// triangles), geometry helpers, loading
const PRIMS_GD = String.raw`
# ---------- 画法 ----------

func _emit(idx: PackedInt32Array, pts: PackedVector2Array, cols: PackedColorArray, uvs := PackedVector2Array()) -> void:
	if idx.is_empty() or pts.is_empty():
		return
	var o: Ops = _P.ops.get(_slot)
	if o == null:
		o = Ops.new()
		_P.ops[_slot] = o
	var base := o.pts.size()
	for i in idx:
		o.idx.append(base + i)
	o.pts.append_array(pts)
	if cols.size() == pts.size():
		o.cols.append_array(cols)
	else:
		for i in pts.size():
			o.cols.append(cols[0])
	if not uvs.is_empty():
		o.uvs.append_array(uvs)


func _rgba(c: Color, a: float) -> Color:
	return Color(c.r, c.g, c.b, clampf(a, 0.0, 1.0))


func _unit(v: Vector2) -> Vector2:
	var l := v.length()
	return v / (l if l > 0.0 else 1.0)


# 两条折线之间的带子
func _strip(lo: PackedVector2Array, hi: PackedVector2Array, clo: PackedColorArray, chi: PackedColorArray) -> void:
	var n := lo.size()
	if n < 2:
		return
	var pts := PackedVector2Array()
	var cols := PackedColorArray()
	var idx := PackedInt32Array()
	for i in n:
		pts.append(lo[i])
		pts.append(hi[i])
		cols.append(clo[i] if clo.size() == n else clo[0])
		cols.append(chi[i] if chi.size() == n else chi[0])
	for i in n - 1:
		var b := i * 2
		idx.append_array(PackedInt32Array([b, b + 1, b + 3, b, b + 3, b + 2]))
	_emit(idx, pts, cols)


# 多边形填充（不是简单多边形时从第一个点扇形填）
func _poly(pts: PackedVector2Array, cols: PackedColorArray) -> void:
	if pts.size() < 3:
		return
	var idx := Geometry2D.triangulate_polygon(pts)
	if idx.is_empty():
		for i in range(1, pts.size() - 1):
			idx.append_array(PackedInt32Array([0, i, i + 1]))
	_emit(idx, pts, cols)


func _grad(stops: Array, t: float) -> Color:
	if t <= float(stops[0][0]):
		return stops[0][1]
	for i in range(1, stops.size()):
		var b: float = stops[i][0]
		if t <= b:
			var a: float = stops[i - 1][0]
			return (stops[i - 1][1] as Color).lerp(stops[i][1], (t - a) / maxf(b - a, 1e-6))
	return stops[stops.size() - 1][1]


# 多边形，从 p0 到 p1 的线性渐变：拆成三角形，每个三角形在色标处切开，每块里的颜色按顶点插值正好是渐变
func _gfill(pts: PackedVector2Array, p0: Vector2, p1: Vector2, stops: Array) -> void:
	if pts.size() < 3:
		return
	var d := p1 - p0
	var dd := d.length_squared()
	if dd < 1e-8:
		_poly(pts, PackedColorArray([stops[0][1]]))
		return
	var tri := Geometry2D.triangulate_polygon(pts)
	if tri.is_empty():
		for i in range(1, pts.size() - 1):
			tri.append_array(PackedInt32Array([0, i, i + 1]))
	var cuts: Array = []
	for i in range(1, stops.size() - 1):
		cuts.append(float(stops[i][0]))
	var op := PackedVector2Array()
	var oc := PackedColorArray()
	var oi := PackedInt32Array()
	for k in range(0, tri.size(), 3):
		var poly: Array = [pts[tri[k]], pts[tri[k + 1]], pts[tri[k + 2]]]
		var lo := -INF
		for j in cuts.size() + 1:
			var hi: float = cuts[j] if j < cuts.size() else INF
			var piece := _clip_band(poly, p0, d, dd, lo, hi)
			if piece.size() >= 3:
				var base := op.size()
				for v in piece:
					op.append(v)
					oc.append(_grad(stops, clampf(((v as Vector2) - p0).dot(d) / dd, 0.0, 1.0)))
				for m in range(1, piece.size() - 1):
					oi.append_array(PackedInt32Array([base, base + m, base + m + 1]))
			lo = hi
	_emit(oi, op, oc)


# 凸多边形里 lo ≤ t ≤ hi 的部分（t：沿渐变方向的位置）
func _clip_band(poly: Array, p0: Vector2, d: Vector2, dd: float, lo: float, hi: float) -> Array:
	var cur := poly
	for side in 2:
		var lim := lo if side == 0 else hi
		if is_inf(lim):
			continue
		var nxt := []
		var n := cur.size()
		for i in n:
			var a: Vector2 = cur[i]
			var b: Vector2 = cur[(i + 1) % n]
			var ta := (a - p0).dot(d) / dd
			var tb := (b - p0).dot(d) / dd
			var ia := ta >= lim if side == 0 else ta <= lim
			var ib := tb >= lim if side == 0 else tb <= lim
			if ia:
				nxt.append(a)
			if ia != ib:
				nxt.append(a.lerp(b, (lim - ta) / (tb - ta)))
		cur = nxt
		if cur.size() < 3:
			return []
	return cur


# 一笔直线 p → q，沿线的渐变（色标 [[位置, 颜色], ...]），线宽 lw，round = 圆头
func _gline(p: Vector2, q: Vector2, stops: Array, lw: float, round_cap: bool) -> void:
	var d := q - p
	var L := d.length()
	if L < 1e-5:
		return
	var u := d / L
	var nv := Vector2(-u.y, u.x) * lw / 2.0
	var pts := PackedVector2Array()
	var cols := PackedColorArray()
	var idx := PackedInt32Array()
	for i in stops.size():
		var c := p + d * clampf(float(stops[i][0]), 0.0, 1.0)
		pts.append(c - nv)
		pts.append(c + nv)
		cols.append(stops[i][1])
		cols.append(stops[i][1])
		if i > 0:
			var b := (i - 1) * 2
			idx.append_array(PackedInt32Array([b, b + 1, b + 3, b, b + 3, b + 2]))
	_emit(idx, pts, cols)
	if round_cap:
		_cap(p, -u, lw / 2.0, stops[0][1])
		_cap(q, u, lw / 2.0, stops[stops.size() - 1][1])


func _cap(c: Vector2, dir: Vector2, r: float, col: Color) -> void:
	if col.a <= 0.0 or r <= 0.0:
		return
	var n := 6
	var pts := PackedVector2Array([c])
	var a0 := dir.angle() - PI / 2.0
	for i in n + 1:
		var a := a0 + PI * i / n
		pts.append(c + Vector2(cos(a), sin(a)) * r)
	var idx := PackedInt32Array()
	for i in n:
		idx.append_array(PackedInt32Array([0, i + 1, i + 2]))
	_emit(idx, pts, PackedColorArray([col]))


func _seg(p: Vector2, q: Vector2, col: Color, lw: float, round_cap: bool) -> void:
	_gline(p, q, [[0.0, col], [1.0, col]], lw, round_cap)


# 一条封闭的折线描边
func _pline(pts: PackedVector2Array, col: Color, lw: float, closed: bool) -> void:
	var n := pts.size()
	for i in (n if closed else n - 1):
		_seg(pts[i], pts[(i + 1) % n], col, lw, false)


func _segs(r: float) -> int:
	return clampi(int(r * _s * 1.5) + 10, 10, 64)


func _disc(c: Vector2, r: float, col: Color) -> void:
	if r <= 0.0 or col.a <= 0.0:
		return
	var n := _segs(r)
	var pts := PackedVector2Array([c])
	var idx := PackedInt32Array()
	for i in n:
		var a := TAU * i / n
		pts.append(c + Vector2(cos(a), sin(a)) * r)
		idx.append_array(PackedInt32Array([0, 1 + i, 1 + (i + 1) % n]))
	_emit(idx, pts, PackedColorArray([col]))


func _ring(c: Vector2, r: float, lw: float, col: Color) -> void:
	if r <= 0.0 or col.a <= 0.0:
		return
	var n := _segs(r)
	var pts := PackedVector2Array()
	var idx := PackedInt32Array()
	for i in n:
		var a := TAU * i / n
		var d := Vector2(cos(a), sin(a))
		pts.append(c + d * maxf(0.0, r - lw / 2.0))
		pts.append(c + d * (r + lw / 2.0))
		var b := i * 2
		var e := ((i + 1) % n) * 2
		idx.append_array(PackedInt32Array([b, b + 1, e + 1, b, e + 1, e]))
	_emit(idx, pts, PackedColorArray([col]))


# 径向渐变的圆：stops = [[半径比例 0..1, 颜色], ...]
func _radial(c: Vector2, r: float, stops: Array) -> void:
	if r <= 0.0:
		return
	var n := _segs(r)
	var pts := PackedVector2Array()
	var cols := PackedColorArray()
	var idx := PackedInt32Array()
	var rings := []
	var all := stops.duplicate()
	if float(all[0][0]) > 0.0:
		all.push_front([0.0, all[0][1]])
	for st in all:
		var rr: float = float(st[0]) * r
		rings.append([pts.size(), rr <= 0.0001])
		if rr <= 0.0001:
			pts.append(c)
			cols.append(st[1])
		else:
			for i in n:
				var a := TAU * i / n
				pts.append(c + Vector2(cos(a), sin(a)) * rr)
				cols.append(st[1])
	for k in range(1, rings.size()):
		var a0: int = rings[k - 1][0]
		var pt: bool = rings[k - 1][1]
		var b0: int = rings[k][0]
		for i in n:
			var j := (i + 1) % n
			if pt:
				idx.append_array(PackedInt32Array([a0, b0 + i, b0 + j]))
			else:
				idx.append_array(PackedInt32Array([a0 + i, b0 + i, b0 + j, a0 + i, b0 + j, a0 + j]))
	_emit(idx, pts, cols)


func _quad(a: Vector2, c: Vector2, b: Vector2, t: float) -> Vector2:
	return a * (1.0 - t) * (1.0 - t) + c * 2.0 * t * (1.0 - t) + b * t * t


func _smooth(e0: float, e1: float, x: float) -> float:
	var d := e1 - e0
	var t := clampf((x - e0) / (d if d != 0.0 else 1e-6), 0.0, 1.0)
	return t * t * (3.0 - 2.0 * t)


# 配色上从暗到亮的位置 v 的颜色（编辑器 colorAcross，取整到 0..255）
func _across(cols: Array, v: float) -> Color:
	var t := clampf(v, 0.0, 1.0) * (cols.size() - 1)
	var i := mini(cols.size() - 2, int(floor(t)))
	var f := t - i
	var a: Color = cols[i]
	var b: Color = cols[i + 1]
	return Color(roundf((a.r + (b.r - a.r) * f) * 255.0) / 255.0, roundf((a.g + (b.g - a.g) * f) * 255.0) / 255.0, roundf((a.b + (b.b - a.b) * f) * 255.0) / 255.0)


# 截面 q 上横向 v 处
func _at(q: Dictionary, v: float) -> Vector2:
	return (q["a"] as Vector2).lerp(q["b"], v)


func _wd(q: Dictionary) -> float:
	return (q["a"] as Vector2).distance_to(q["b"])


# 拖尾上 (u, v) 处的点（截面之间插值）、横向单位向量、横向向量
func _on_run(r: Array, u: float, v: float) -> Array:
	var i := 1
	while i < r.size() - 1 and float(r[i]["u"]) < u:
		i += 1
	var p: Dictionary = r[i - 1]
	var q: Dictionary = r[i]
	var den: float = float(q["u"]) - float(p["u"])
	var t := clampf((u - float(p["u"])) / (den if den != 0.0 else 1.0), 0.0, 1.0)
	var ax: Vector2 = (q["b"] as Vector2) - (q["a"] as Vector2)
	var al := ax.length()
	return [_at(p, v).lerp(_at(q, v), t), ax / (al if al > 0.0 else 1.0), ax]


func _ext(r: Array, u: float, v: float) -> Vector2:
	var i: Vector2 = _on_run(r, u, 0.0)[0]
	var o: Vector2 = _on_run(r, u, 1.0)[0]
	return i.lerp(o, v)


func _width(r: Array, u: float) -> float:
	return (_on_run(r, u, 0.0)[0] as Vector2).distance_to(_on_run(r, u, 1.0)[0])


# 着色器里的整数种子：按 32 位整数换算（和 JS 的 ^ 一样）
func _i32(v: int) -> int:
	var x := v & 0xFFFFFFFF
	return x - 0x100000000 if x >= 0x80000000 else x


# ---------- 读入数据 ----------

func _load_trail(t: Dictionary) -> Dictionary:
	if String(t.get("kind", "")) == "stroke":
		_load_stroke(t)
	else:
		_load_sticks(t)
	t["opacity"] = float(t.get("opacity", 1.0))
	match String(t["mode"]):
		"glow":
			var G: Dictionary = t["glow"]
			var cols := []
			var c3 := PackedVector3Array()
			for h in G["cols"]:
				var c := Color(String(h))
				cols.append(c)
				c3.append(Vector3(c.r, c.g, c.b))
			while c3.size() < 8:
				c3.append(Vector3.ZERO)
			G["colors"] = cols
			G["cols3"] = c3
			G["core_c"] = Color(String(G["core"]))
			G["rim_c"] = Color(String(G["rim"]))
			G["splat_c"] = Color(String(G["splat"]))
			G["tail_c"] = Color(String(G["tail"])) if String(G["tail"]) != "" else null
			var p := {}
			for k in LOOK_PCT:
				p[k] = float(G["look"].get(k, 0.0))
			G["p"] = p
			G["seed"] = int(G["seed"])
		"bands":
			var cols := []
			for b in t["bands"]["bands"]:
				cols.append(Color(String(b[0])))
			t["bands"]["colors"] = cols
			t["brush_tex"] = _brush_tex(t["brush"])
		_:
			t["brush_tex"] = _brush_tex(t["brush"])
			t["tex_tex"] = _image_tex(t["tex"]["image"])
	return t


# 拖尾笔：每帧的笔触（编辑器算好的 [尾 x, y, 头 x, y, 弯度, 宽度 %, 消散]）
func _load_stroke(t: Dictionary) -> void:
	var shows := []
	var wmax := 8.0
	var sk: Array = t["skeys"]
	for i in sk.size():
		if sk[i] != null:
			shows.append(i)
			wmax = maxf(wmax, float(t["geo"]["width"]) * float(sk[i][5]) / 100.0)
	t["frames"] = shows
	t["wmax"] = wmax
	t["has_back"] = t["geo"].get("wrap") != null
	t["box"] = Rect2(0, 0, _w, _h)


func _load_sticks(t: Dictionary) -> void:
	var keys := []
	var wmax := 8.0
	for k in t["keys"]:
		if k == null:
			keys.append(null)
		else:
			var a := Vector2(k[0], k[1])
			var b := Vector2(k[2], k[3])
			keys.append({"a": a, "b": b, "back": int(k[4]) == 1})
			wmax = maxf(wmax, a.distance_to(b))
	t["keys"] = keys
	t["wmax"] = wmax
	var any_back := false
	for k in keys:
		if k != null and k["back"]:
			any_back = true
	t["has_back"] = any_back or (t["plane"] == "flat" and t["autoDepth"])
	# 拖尾可能画到的范围：每根棍子绕握柄扫过的圆，外面留出光效、火花、爆点的余量（编辑器也只在这样的范围里画）
	var full := Rect2(0, 0, _w, _h)
	var box := Rect2()
	var first := true
	for k in keys:
		if k == null:
			continue
		var r: float = (k["a"] as Vector2).distance_to(k["b"])
		var c := Rect2((k["a"] as Vector2) - Vector2(r, r), Vector2(r, r) * 2.0)
		box = c if first else box.merge(c)
		first = false
	if first or float(t["bow"]) != 0.0 or t["plane"] == "flat":
		box = full  # 弯曲、横扫会超出棍子扫过的圆：整张画布
	else:
		box = box.grow(wmax * 2.8 + 8.0).intersection(full)
	var shows := []
	var flash_only: bool = String(t["mode"]) == "glow" and float(t["glow"]["look"].get("flash", 0.0)) > 0.0
	for fi in keys.size():
		if not _state(t, fi, flash_only).is_empty():
			shows.append(fi)
	t["frames"] = shows
	t["box"] = Rect2(floorf(box.position.x), floorf(box.position.y), ceilf(box.end.x) - floorf(box.position.x), ceilf(box.end.y) - floorf(box.position.y))


func _png(b64: String) -> Image:
	var img := Image.new()
	if img.load_png_from_buffer(Marshalls.base64_to_raw(b64)) != OK:
		return null
	img.convert(Image.FORMAT_RGBA8)
	return img


# 刷痕笔刷：灰度 × 透明度（编辑器 brushSampler）
func _brush_tex(b: Dictionary) -> ImageTexture:
	var img: Image = _png(b["png"]) if b.has("png") else null
	var out: Image
	if img != null:
		out = Image.create(img.get_width(), img.get_height(), false, Image.FORMAT_R8)
		for y in img.get_height():
			for x in img.get_width():
				var c := img.get_pixel(x, y)
				out.set_pixel(x, y, Color((0.299 * c.r + 0.587 * c.g + 0.114 * c.b) * c.a, 0, 0))
	else:
		out = _builtin_brush(String(b.get("builtin", "bristle")))
	return ImageTexture.create_from_image(out)


# 编辑器的内置笔刷（trails/model.js builtinBrush），同样的随机数
func _builtin_brush(id: String) -> Image:
	var W := 256
	var H := 64
	var dry := id == "dry"
	var box := [91 if dry else 17]
	var ctl := []
	for i in 13:
		ctl.append(_lrnd(box))
	var rows := []
	for y in H:
		var t := float(y) / (H - 1) * (ctl.size() - 1)
		var i := int(floor(t))
		var f := t - i
		var group: float = ctl[i] * (1.0 - f) + ctl[mini(ctl.size() - 1, i + 1)] * f
		if dry:
			rows.append(0.05 if _lrnd(box) < 0.35 else 0.25 + 0.75 * (0.5 * group + 0.5 * _lrnd(box)))
		else:
			rows.append(0.2 + 0.8 * (0.55 * group + 0.45 * _lrnd(box)))
	var gaps := []
	for y in H:
		var g := []
		if dry:
			for k in 3:
				var gu := _lrnd(box)
				g.append([gu, 0.02 + _lrnd(box) * 0.08])
		gaps.append(g)
	var img := Image.create(W, H, false, Image.FORMAT_R8)
	for y in H:
		for x in W:
			var u := float(x) / (W - 1)
			var b: float = rows[y] + 0.18 * u + 0.06 * sin(u * 23.0 + y * 1.7)
			for gp in gaps[y]:
				if absf(u - float(gp[0])) < float(gp[1]):
					b *= 0.25
			img.set_pixel(x, y, Color(clampf(roundf(b * 255.0), 0.0, 255.0) / 255.0, 0, 0))
	return img


# 纹理：内置的灰度纹理（trails/model.js builtinTexture），或导入的图
func _image_tex(s: Dictionary) -> ImageTexture:
	var img: Image = _png(s["png"]) if s.has("png") else null
	if img == null:
		var W := 256
		var H := 64
		var box := [7]
		var streaks := []
		for i in 9:
			var v := 0.25 + _lrnd(box) * 0.7
			var w := 0.02 + _lrnd(box) * 0.05
			var k := 0.25 + _lrnd(box) * 0.5
			var ph := _lrnd(box) * 6.28
			streaks.append([v, w, k, ph])
		img = Image.create(W, H, false, Image.FORMAT_RGBA8)
		for y in H:
			var v := float(y) / (H - 1)
			for x in W:
				var u := float(x) / (W - 1)
				var l := 0.62 + 0.3 * pow(v, 1.2)
				l += exp(-pow((v - 0.9) / 0.07, 2.0)) * 0.3
				for sk in streaks:
					var along := 0.6 + 0.4 * sin(u * 18.0 * sk[2] + sk[3])
					l += exp(-pow((v - sk[0]) / sk[1], 2.0)) * sk[2] * along * 0.25
				l *= minf(1.0, v * 4.0)
				var L := clampf(roundf(l * 255.0), 0.0, 255.0) / 255.0
				img.set_pixel(x, y, Color(L, L, L, 1.0))
	return ImageTexture.create_from_image(img)
`;
