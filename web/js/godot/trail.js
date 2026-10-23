// 攻击拖尾 for programmers: the trails drawn by the game at run time instead of
// baked into the frames. The sticks (one per frame) and the look go out as data;
// the Godot 4 script rebuilds each frame's ribbon exactly as trails/model.js does
// (trailState → sections → bow → trim → width profile → head cap) and colours it
// with its look: a strip texture (attachStrips) — the editor's own rendering of
// the trail laid out straight, u along it and v across — mapped onto the ribbon,
// so flames, strands, flow, brush streaks and the rim come along; a few variants
// of it take turns so fire flickers. Without a strip a shader ramp stands in:
// the 色带 bands across the width, the 光效 colours inner → outer with a bright
// rim, one colour, or a gradient along the trail.
//
// What flies off the trail — sparks, embers, shards, the flash at the start
// and the burst at the end — goes with it as baked frames (renderFx): the
// editor's rendering of each frame with the ribbon itself cut away, laid over
// the runtime ribbon on that frame.
import { normalizeTrail, renderTrail, trailState } from "../trails/model.js";
import { GLOW_DEFAULTS } from "../trails/glow.js";
import { textureFor, brushFor } from "../trails/composite.js";
import { hexToRgb, createCanvas, canvasToBlob } from "../core/util.js";

const r2 = (v) => Math.round(v * 100) / 100;
const clean = (s) => String(s || "").replace(/["\\]/g, "");

// how the shader colours the ribbon: a ramp (offsets ascending) read at
// layout 0: e = |2v − 1| (0 on the middle line), 1: e = 1 − v (0 at the blade-tip
// edge), 2: e = v (grip → tip), 3: e = u (tail → head)
function colorSpec(st) {
  const glow = st.colorMode === "glow";
  const pixel = glow ? !!st.pixelGlow : st.pixel !== false;
  // pixel art: block size, and alpha as a dither (0), 4 steps (1) or hard (2)
  const px = glow ? Math.max(1, Math.min(8, st.pxSize | 0 || 1)) : 1;
  const alphaMode = glow ? (st.pxAlpha === "dither" ? 0 : st.pxAlpha === "hard" ? 2 : 1) : st.fadeSteps ? 1 : 0;
  const out = colorRamp(st, pixel);
  return { ...out, pixel, px, alphaMode };
}

function colorRamp(st, pixel) {
  if (st.colorMode === "bands" && st.bands && st.bands.length) {
    // bands run outer → inner, each [colour, how far from the middle / edge it reaches]
    const b = st.bands, n = b.length;
    const stops = [[0, b[n - 1][0]]];
    for (let k = n - 1; k >= 1; k--) stops.push([b[k][1], b[k - 1][0]]);
    const edge = st.bandLayout === "edge";
    return { layout: edge ? 1 : 0, hard: true, stops, additive: false, innerSoft: edge ? r2(st.edgeFade || 0) : 0 };
  }
  if (st.colorMode === "glow") {
    const cols = st.glowColors && st.glowColors.length >= 2 ? st.glowColors : GLOW_DEFAULTS.glowColors;
    const rim = st.glowRim || cols[cols.length - 1], core = st.glowCore || "#ffffff";
    const lum = (h) => { const c = hexToRgb(h); return (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255; };
    // a dark palette (black fire) and solid ones (rock) are painted over, not added as light
    const dark = !!st.solid || cols.reduce((s, c) => s + lum(c), 0) / cols.length < 0.18;
    const stops = cols.map((c, i) => [r2((i / (cols.length - 1)) * 0.8), c]);
    stops.push([0.9, rim], [1, core]);
    return { layout: 2, hard: false, stops, additive: !dark, innerSoft: 0.35 };
  }
  if (st.colorMode === "gradient" && st.gradient && st.gradient.length) {
    const stops = [...st.gradient].sort((a, b) => a.p - b.p).map((s) => [r2(s.p), s.c]);
    return { layout: 3, hard: pixel, stops, additive: false, innerSoft: 0 };
  }
  const c = st.colorMode === "mono" ? st.color || "#ffffff" : "#ffffff";
  return { layout: 0, hard: true, stops: [[0, c], [1, c]], additive: false, innerSoft: 0 };
}

// one trail: its sticks per frame (null = no stick) and everything its shape needs
function trailEntry(raw, frameIds) {
  const t = normalizeTrail(raw), st = t.style;
  return {
    name: clean(t.name),
    length: Math.max(1, t.length | 0), dissolve: Math.max(0, t.dissolve ?? 3) | 0,
    rotate: t.rotate !== false, turn: t.turn || "auto", bow: +t.bow || 0, smooth: t.smooth !== false,
    plane: t.plane === "flat" ? "flat" : "screen", squash: +t.squash || 0.35, tilt: +t.tilt || 0, autoDepth: t.autoDepth !== false,
    shape: st.shape || "head", taper: st.taper ?? 0.25, headArc: st.headArc ?? 0.5,
    fade: st.fade ?? 0.6, opacity: (st.opacity ?? 100) / 100, fineness: Math.max(2, Math.min(64, st.fineness | 0 || 20)),
    color: colorSpec(st),
    keys: frameIds.map((id) => {
      const k = t.keys[id];
      return k ? [r2(k.a[0]), r2(k.a[1]), r2(k.b[0]), r2(k.b[1]), k.z === "back" ? 1 : 0] : null;
    }),
  };
}

// every trail of an animation that has at least one stick
export function trailData(trails, frameIds, w, h, fps, title) {
  return {
    format: "guangtai-attack-trail", version: 1,
    name: clean(title),
    canvas: { w, h }, fps: fps || 12, frames: frameIds.length,
    trails: (trails || []).filter((t) => t.keys && frameIds.some((id) => t.keys[id])).map((t) => trailEntry(t, frameIds)),
  };
}

// ---------- strip textures ----------
const STRIP_VARIANTS = 3;
const STRIP_MAX = 640;   // px along the trail: the texture is stretched over the ribbon anyway
const median = (a) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[b.length >> 1] : 0; };

// The trail's look on a straight ribbon: every variant one band of the atlas,
// x = u (tail → head), y = v across, with `margin` of the width added on each
// side for the light round it. One block of variants per dissolve step (the
// frames after the swing, as trailState gives them: trimmed and fading), so the
// trail goes out at run time exactly as the editor draws it. Rendered by the editor's own renderer, with the
// shape left even (the runtime ribbon is already tapered) and what flies off
// the trail left out.
export function renderStrip(raw) {
  const t = normalizeTrail(raw);
  const keys = Object.values(t.keys || {}).filter(Boolean);
  if (keys.length < 2) return null;
  const glow = t.style.colorMode === "glow";
  const pixel = glow ? !!t.style.pixelGlow : t.style.pixel !== false;
  const width = Math.max(8, median(keys.map((k) => Math.hypot(k.b[0] - k.a[0], k.b[1] - k.a[1]))));
  // how far one swing of this trail usually reaches: the steps between sticks × its length
  const order = Object.keys(t.keys);
  const steps = [];
  for (let i = 1; i < order.length; i++) {
    const p = t.keys[order[i - 1]], q = t.keys[order[i]];
    if (p && q) steps.push(Math.hypot((p.a[0] + p.b[0] - q.a[0] - q.b[0]) / 2, (p.a[1] + p.b[1] - q.a[1] - q.b[1]) / 2));
  }
  const reach = Math.max(width * 2, (median(steps) || width) * Math.max(1, t.length));
  // smooth light gets some extra resolution; pixel art stays at the canvas' pixel size
  const scale = Math.min(pixel ? 1 : 1.5, STRIP_MAX / reach);
  const margin = glow ? 0.35 : 0.08;
  const W = Math.max(16, Math.round(reach * scale)), Wd = Math.max(4, Math.round(width * scale));
  const H = Math.round(Wd * (1 + 2 * margin)), pad = Math.round(Wd * 0.6);
  const n = Math.max(2, (t.length | 0) + 1);
  // pixel styles are rendered as the editor's pixel art — its palette, alpha steps and
  // clean-up of stray faint pixels — and used as they are at run time
  const st = { ...noFx(t.style), shape: "even", headArc: 0 };
  const flat = { ...t, style: st, plane: "screen", bow: 0, rotate: true, smooth: true, turn: "auto" };
  const y0 = (H - Wd) / 2;
  // laid out so that what is left after trimming p off the tail spans the strip
  const layout = (p) => {
    const len = W / (1 - p);
    return Array.from({ length: n }, (_, i) => { const x = pad + W - len + (len * i) / (n - 1); return { a: [x, y0], b: [x, y0 + Wd] }; });
  };
  const assets = { tex: textureFor(t), brush: brushFor(t) };
  const levels = Math.min(6, Math.max(0, t.dissolve | 0)) + 1;
  const atlas = createCanvas(W, H * STRIP_VARIANTS * levels), ag = atlas.getContext("2d");
  for (let L = 0; L < levels; L++) {
    const p = L / ((t.dissolve | 0) + 1), sticks = layout(p);
    for (let k = 0; k < STRIP_VARIANTS; k++) {
      const state = { sticks, trim: p, alpha: 1 - p, run: sticks, age: n - 1 + L, frame: k * 7 + 3 + L, ended: L > 0, after: L };
      let img = renderTrail(flat, state, W + 2 * pad, H, assets);
      if (!img) continue;
      if (img instanceof ImageData) { const c = createCanvas(img.width, img.height); c.getContext("2d").putImageData(img, 0, 0); img = c; }
      ag.drawImage(img, pad, 0, W, H, 0, (L * STRIP_VARIANTS + k) * H, W, H);
    }
  }
  return { canvas: atlas, variants: STRIP_VARIANTS, levels, margin, pixel };
}

// the style without what is scattered about or bursts (粒子, 爆发)
const noFx = (st) => ({ ...st, mixFx: 0, mixBurst: 0, pxFx: 0, pxDust: 0, pxShards: 0, pxSplatter: 0, pxImpact: 0 });

const toCanvas = (img) => {
  if (!img || !(img instanceof ImageData)) return img;
  const c = createCanvas(img.width, img.height);
  c.getContext("2d").putImageData(img, 0, 0);
  return c;
};

// What flies off the trail, frame by frame: the editor's rendering of the frame
// with the same rendering minus 粒子 and 爆发 cut out of it, so only what is
// outside the ribbon is left. Packed in one row: { canvas, frames } with frames[i]
// = [sx, sy, w, h, dx, dy] (where it sits on the canvas) or null.
export function renderFx(raw, frameIds, w, h) {
  const t = normalizeTrail(raw);
  const bare = { ...t, style: noFx(t.style) };
  const assets = { tex: textureFor(t), brush: brushFor(t) };
  const parts = frameIds.map((_, i) => {
    const state = trailState(t, frameIds, i);
    if (!state) return null;
    const a = toCanvas(renderTrail(t, state, w, h, assets));
    if (!a) return null;
    const c = createCanvas(w, h), g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(a, 0, 0);
    const b = state.sticks.length >= 2 ? toCanvas(renderTrail(bare, state, w, h, assets)) : null;
    const img = g.getImageData(0, 0, w, h), d = img.data;
    if (b) {
      // where the ribbon is: its pixels (and 2 px round them) belong to the runtime ribbon. A
      // plain subtraction would leave a pale ghost, since pixel art snaps the two
      // renderings to slightly different colours.
      const bd = b.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, w, h).data;
      const on = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) if (bd[i * 4 + 3] > 24) on[i] = 1;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let hit = 0;
        for (let dy = -2; dy <= 2 && !hit; dy++) for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < w && yy < h && on[yy * w + xx]) { hit = 1; break; }
        }
        if (hit) d[(y * w + x) * 4 + 3] = 0;
      }
      g.putImageData(img, 0, 0);
    }
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] < 8) continue;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    return x1 < 0 ? null : { c, x0, y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  });
  if (!parts.some(Boolean)) return null;
  const W = parts.reduce((s, p) => s + (p ? p.w + 1 : 0), 0), H = Math.max(...parts.map((p) => (p ? p.h : 0)));
  const atlas = createCanvas(W, H), ag = atlas.getContext("2d");
  let x = 0;
  const frames = parts.map((p) => {
    if (!p) return null;
    ag.drawImage(p.c, p.x0, p.y0, p.w, p.h, x, 0, p.w, p.h);
    const r = [x, 0, p.w, p.h, p.x0, p.y0];
    x += p.w + 1;
    return r;
  });
  return { canvas: atlas, frames };
}

const toBase64 = async (blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let j = 0; j < bytes.length; j += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(j, j + 0x8000));
  return btoa(bin);
};

// give every trail of data its strip: as base64 inside the data ("embed", one
// self-contained script) or as files next to the scene ("files": returns them
// for the zip, the data naming each one relative to the script)
// (and its fx frames): as base64 inside the data ("embed", one self-contained
// script) or as files next to the scene ("files": returned for the zip, the
// data naming each relative to the script). rawTrails in the same order as
// data.trails (trailData keeps the order, leaving out trails without sticks).
export async function attachStrips(data, rawTrails, frameIds, mode = "embed", prefix = "trails/") {
  const files = [];
  const drawn = rawTrails.filter((r) => r.keys && frameIds.some((id) => r.keys[id]));
  for (const [i, t] of data.trails.entries()) {
    const raw = drawn[i];
    if (!raw) continue;
    const base = prefix + "trail" + (i + 1);
    // smooth light as lossy WebP (small); pixel art as PNG — lossy compression would
    // blur its hard edges into dark fringes
    const put = async (canvas, suffix, pixel) => {
      const [type, ext] = pixel ? ["image/png", "png"] : ["image/webp", "webp"];
      const blob = await canvasToBlob(canvas, type, 0.9);
      if (mode !== "files") return { [ext]: await toBase64(blob) };
      files.push({ file: base + suffix + "." + ext, blob });
      return { file: base + suffix + "." + ext };
    };
    const strip = renderStrip(raw);
    if (strip) t.strip = { variants: strip.variants, levels: strip.levels, margin: strip.margin, ...(await put(strip.canvas, "_strip", strip.pixel)) };
    const fx = renderFx(raw, frameIds, data.canvas.w, data.canvas.h);
    if (fx) t.fx = { frames: fx.frames, ...(await put(fx.canvas, "_fx", t.color.pixel)) };
  }
  return files;
}

export function trailJSON(data) {
  return JSON.stringify({
    ...data,
    notes: {
      overview: "每段拖尾每帧有一根「棍子」：keys[帧] = [内端x, 内端y, 刀尖x, 刀尖y, 是否在角色后方]，坐标是动画画布像素（左上角为原点），没有棍子的帧为 null。某一帧的拖尾 = 最近 length+1 根棍子扫过的区域，从最旧（尾，u=0）到当前（头，u=1）。",
      state: "当前帧有棍子：取往前连续的棍子（遇到 null 停），保留最后 length+1 根。当前帧没有棍子、但前 dissolve 帧内有：头停在最后一根，k = 距最后一根的帧数，p = k / (dissolve + 1)，裁掉 u < p 的部分并把 u 重新铺满 0..1，整体透明度 × (1 − p)。",
      orient: "画反的棍子自动对调：其余棍子内端的平均点 c，若 |刀尖 − c| < 0.6 × |内端 − c| 则交换两端。",
      sections: "每两根棍子之间插 fineness 个截面。rotate：内端沿 Catmull-Rom 曲线（smooth）或直线插值，角度和长度同样插值，刀尖 = 内端 + (cosθ, sinθ) × 长度（刀尖走圆弧）。turn：auto 取较小转角，cw 角度递增（y 向下），ccw 递减。曲线两端外推：3·P0 − 3·P1 + P2（只有两根时 2·P0 − P1）。u 按截面中点的累计弧长归一化。",
      plane: "plane = flat（横扫）：先把点变到挥动平面 (x·cosθ + y·sinθ, (−x·sinθ + y·cosθ) / squash)，θ = tilt，在平面里按 rotate 插值，再变回屏幕。autoDepth 时刀尖朝平面上方（b.y − a.y < 0）的截面画在角色后方。",
      bow: "每个截面沿弦的法线（朝刀尖一侧）平移 bow × sin(πu) × max(弦长, 路径长) × 0.35。",
      profile: "宽度系数 w(u)：head = taper + (1 − taper)·u；crescent = max(0.06, sin(π·(0.92u + 0.04))^0.7)；even = 1。截面两端从中点按 w 收缩。head 形状再在头部加 headArc 控制的半圆帽（6 段）。",
      color: "color.stops 是一条渐变（offset 升序），按 layout 取样：0 → e = |2v − 1|（中间最亮的色带），1 → e = 1 − v（刀尖一侧最亮），2 → e = v（握柄 → 刀尖），3 → e = u（尾 → 头）。v：内端 0、刀尖 1。hard = true 时颜色不插值（色带硬边）。",
      strip: "strip（可选）：编辑器烘焙的拖尾贴图，拖尾拉直后的样子。x = u（尾 → 头），y = 加宽后的横向位置；每个消散阶段（levels 个：0 = 挥砍中，1..dissolve = 挥完后第几帧，已经按编辑器的样子裁短、侵蚀）一组 variants 张，从上到下排列，第 level 组第 variant 张在第 level × variants + variant 行；variant = 帧号 % variants。用贴图时把每个截面两端各向外加宽 margin × 截面宽度，v 从加宽后的内端 0 到外端 1，透明度直接取贴图的（不再另算渐隐），普通混合。webp / png = base64 内嵌的图（像素风格用 PNG，已经是编辑器的像素画效果，直接用、最近邻采样），file = 相对于脚本的路径。",
      fx: "fx（可选）：飞出拖尾的火星、闪光、命中爆点，逐帧烘焙好、已经去掉了拖尾带子本身。frames[帧] = [图集x, 图集y, 宽, 高, 画布x, 画布y] 或 null，按帧画在拖尾上面（画布坐标，左上角为原点）。",
      alpha: "透明度 = opacity × (1 − p) × clamp(ends(u) / fade, 0, 1)，ends(u) = u（crescent 为 2·min(u, 1 − u)）；innerSoft > 0 时再乘 smoothstep(0, innerSoft, v)。pixel = true 时按 px×px 的方块取一次颜色和透明度，透明度按 alphaMode 量化：0 抖动（按方块坐标查 4×4 Bayer 表，alpha > (bayer + 0.5) / 16 则不透明，否则丢弃），1 四级透明（round(alpha × 4) / 4），2 硬边（alpha ≥ 0.5 则不透明）。additive = true 时用叠加混合（发光）。",
    },
  }, null, 2);
}

// GDScript: data embedded in a """ string, where a backslash still escapes
const gdData = (data) => JSON.stringify(data).replace(/\\/g, "\\\\");

// data: trailData(...) to embed (the script then works on its own), or null for
// the generic copy the layered scene uses, each node carrying its own data_json
export function trailGodot(data) {
  const embedded = data ? gdData(data) : "";
  const title = data ? data.name || "攻击拖尾" : "攻击拖尾";
  return `# 攻击拖尾 Attack trail —— 由「光台 · 序列帧工作室」导出：${title}
# Godot 4.x。运行时按每帧的「棍子」画出拖尾，和编辑器里的形状一致，可随时改颜色、开关。
# 用法：
#   1. 新建一个 Node2D，挂上本脚本，放在角色精灵（AnimatedSprite2D 或 Sprite2D）下面作为子节点；
#      或者把 target 指向角色精灵。
#   2. 精灵每一帧的图要和导出时的动画画布一样大（这个工具导出的序列帧都是）。
#      精灵的 centered / offset / flip_h / flip_v 会自动换算。
#   3. AnimatedSprite2D：animation_name 填这段动画在 SpriteFrames 里的名字，只在播它时画拖尾；空 = 任何动画。
#      Sprite2D（配 AnimationPlayer）：读 frame；同一张图里有多段动画时，用 frame_offset 填这段动画的第一帧。
#   4. 在角色后方的部分会自动画到精灵后面。
#   5. 拖尾的样子（火焰、光丝、流光、亮边）是编辑器烘焙好的贴图，贴在运行时的拖尾上；
#      飞出去的火星、闪光、命中爆点是烘焙好的逐帧图，按帧叠在上面。
extends Node2D

@export var target: NodePath
@export var active := true
@export var animation_name: StringName = &""
@export var frame_offset := 0
## 关掉时坐标就是动画画布像素（左上角为原点），不按精灵换算（分层导出的场景里用）
@export var use_target_layout := true
@export_multiline var data_json := """${embedded}"""

const SHADER := """
shader_type canvas_item;
render_mode %s;
uniform sampler2D ramp : repeat_disable, filter_linear;
uniform sampler2D strip : repeat_disable, %s;
uniform bool textured = false;
uniform int variants = 1;
uniform int variant = 0;
uniform int levels = 1;
uniform int level = 0;
uniform int ramp_mode = 0;
uniform float fade = 0.6;
uniform float alpha = 1.0;
uniform bool crescent = false;
uniform bool pixel = false;
uniform float px = 1.0;
uniform int alpha_mode = 0;
uniform float inner_soft = 0.0;
varying vec2 local_px;
const float BAYER[16] = float[](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
void vertex() { local_px = VERTEX; }
void fragment() {
	vec2 uv = UV;
	vec2 cell = floor(local_px / px);
	if (pixel && !textured) {
		// the uv at the middle of this pixel block: one colour and alpha per block
		mat2 j = mat2(dFdx(local_px), dFdy(local_px));
		mat2 k = mat2(dFdx(UV), dFdy(UV));
		if (abs(determinant(j)) > 1e-8) { uv = clamp(UV + k * inverse(j) * ((cell + 0.5) * px - local_px), 0.0, 1.0); }
	}
	float u = uv.x;
	float v = uv.y;
	float e = ramp_mode == 0 ? abs(2.0 * v - 1.0) : ramp_mode == 1 ? 1.0 - v : ramp_mode == 2 ? v : u;
	vec4 c;
	float a;
	if (textured) {
		// the editor's look, laid out straight: u along, v across (fades already in it)
		// the row of this dissolve step and variant; the fade-out is drawn into it
		float row = float(level * variants + variant);
		c = texture(strip, vec2(clamp(u, 0.002, 0.998), (row + clamp(v, 0.004, 0.996)) / float(variants * levels)));
		a = c.a * alpha;
	} else {
		c = texture(ramp, vec2(clamp(e, 0.002, 0.998), 0.5));
		float ends = crescent ? 2.0 * min(u, 1.0 - u) : u;
		a = c.a * alpha * (fade > 0.0 ? clamp(ends / fade, 0.0, 1.0) : 1.0);
		if (inner_soft > 0.0) { a *= smoothstep(0.0, inner_soft, v); }
	}
	if (pixel && !textured) {
		if (alpha_mode == 1) { a = floor(a * 4.0 + 0.5) / 4.0; }
		else if (alpha_mode == 2) { a = a >= 0.5 ? 1.0 : 0.0; }
		else {
			int i = int(mod(cell.y, 4.0)) * 4 + int(mod(cell.x, 4.0));
			a = a > (BAYER[i] + 0.5) / 16.0 ? 1.0 : 0.0;
		}
	}
	COLOR = vec4(c.rgb, a);
}
"""


# 画一段拖尾的一个深度（前方 / 后方）
class Drawer extends Node2D:
	var host
	var index := 0
	var back := false
	var fx := false

	func _draw() -> void:
		host._draw_part(self)


var _sprite: Node2D
var _w := 0.0
var _h := 0.0
var _trails: Array = []
var _front: Array = []
var _back: Array = []
var _secs: Array = []
var _fx: Array = []
var _shown := ""
var _fi := -1


func _ready() -> void:
	_sprite = (get_node_or_null(target) if not target.is_empty() else get_parent()) as Node2D
	var data = JSON.parse_string(data_json)
	if typeof(data) != TYPE_DICTIONARY:
		push_warning("攻击拖尾：data_json 不是有效的数据")
		return
	_w = float(data["canvas"]["w"])
	_h = float(data["canvas"]["h"])
	for t in data["trails"]:
		_trails.append(_load_trail(t))
	_setup.call_deferred()


func _load_trail(t: Dictionary) -> Dictionary:
	var keys := []
	for k in t["keys"]:
		keys.append(null if k == null else {"a": Vector2(k[0], k[1]), "b": Vector2(k[2], k[3]), "back": int(k[4]) == 1})
	t["keys"] = keys
	t["strip_tex"] = _texture(t["strip"]) if t.has("strip") else null
	t["fx_tex"] = _texture(t["fx"]) if t.has("fx") else null
	return t


# 贴图：数据里内嵌的 WebP / PNG（base64），或脚本旁边的文件
func _texture(s: Dictionary) -> Texture2D:
	if s.has("webp") or s.has("png"):
		var img := Image.new()
		var err := img.load_webp_from_buffer(Marshalls.base64_to_raw(s["webp"])) if s.has("webp") else img.load_png_from_buffer(Marshalls.base64_to_raw(s["png"]))
		if err != OK:
			return null
		return ImageTexture.create_from_image(img)
	if s.has("file"):
		return load((get_script() as Script).resource_path.get_base_dir().path_join(s["file"])) as Texture2D
	return null


func _setup() -> void:
	var parent := get_parent()
	for i in _trails.size():
		var t: Dictionary = _trails[i]
		var shader := Shader.new()
		# a strip carries the editor's colours and light as they are: mixed, not added
		var textured: bool = t["strip_tex"] != null
		# a pixel-art strip is read texel by texel: it is drawn at the canvas' pixel size
		shader.code = SHADER % ["blend_add" if t["color"]["additive"] and not textured else "blend_mix", "filter_nearest" if textured and t["color"]["pixel"] else "filter_linear"]
		var f := _drawer(i, false, shader, t)
		add_child(f)
		var x := Drawer.new()
		x.name = "%s_fx%d" % [name, i]
		x.host = self
		x.index = i
		x.fx = true
		add_child(x)  # 飞出去的火星、闪光、爆点：烘焙好的逐帧图，叠在拖尾上面
		_fx.append(x)
		var b := _drawer(i, true, shader, t)
		parent.add_child(b)
		if parent == _sprite:
			b.show_behind_parent = true  # 画在精灵后面
		else:
			parent.move_child(b, 0)  # 垫到所有兄弟节点下面
		_front.append(f)
		_back.append(b)
		_secs.append([])


func _drawer(i: int, back: bool, shader: Shader, t: Dictionary) -> Drawer:
	var d := Drawer.new()
	d.name = "%s_%s%d" % [name, "back" if back else "front", i]
	d.host = self
	d.index = i
	d.back = back
	var c: Dictionary = t["color"]
	var g := Gradient.new()
	var offs := PackedFloat32Array()
	var cols := PackedColorArray()
	for s in c["stops"]:
		offs.append(float(s[0]))
		cols.append(Color(String(s[1])))
	g.offsets = offs
	g.colors = cols
	if c["hard"]:
		g.interpolation_mode = Gradient.GRADIENT_INTERPOLATE_CONSTANT
	var ramp := GradientTexture1D.new()
	ramp.gradient = g
	ramp.width = 256
	var m := ShaderMaterial.new()
	m.shader = shader
	m.set_shader_parameter("ramp", ramp)
	m.set_shader_parameter("ramp_mode", int(c["layout"]))
	m.set_shader_parameter("fade", float(t["fade"]))
	m.set_shader_parameter("crescent", t["shape"] == "crescent")
	m.set_shader_parameter("pixel", bool(c["pixel"]))
	m.set_shader_parameter("px", float(c["px"]))
	m.set_shader_parameter("alpha_mode", int(c["alphaMode"]))
	m.set_shader_parameter("inner_soft", float(c["innerSoft"]))
	if t["strip_tex"] != null:
		m.set_shader_parameter("textured", true)
		m.set_shader_parameter("strip", t["strip_tex"])
		m.set_shader_parameter("variants", int(t["strip"]["variants"]))
		m.set_shader_parameter("levels", int(t["strip"].get("levels", 1)))
	d.material = m
	return d


func _exit_tree() -> void:
	for b in _back:
		if is_instance_valid(b):
			b.queue_free()


func _process(_delta: float) -> void:
	if _front.is_empty():
		return
	var fi := _current_frame()
	var key := "%d|%s" % [fi, _layout_key()]
	for b in _back:
		b.transform = transform
		b.visible = visible
	if key == _shown:
		return
	_shown = key
	_fi = fi
	for i in _trails.size():
		var t: Dictionary = _trails[i]
		var st := _state(t, fi)
		_secs[i] = [] if st.is_empty() else _ribbon(t, st["sticks"], st["trim"])
		var textured: bool = t["strip_tex"] != null
		var p: float = 0.0 if st.is_empty() else float(st["trim"])
		# a strip has the fade-out drawn into it (one row per step); the plain ramp fades
		var a: float = float(t["opacity"]) * (1.0 if textured else 1.0 - p)
		var levels: int = int(t["strip"].get("levels", 1)) if t.has("strip") else 1
		var level: int = 0 if st.is_empty() else clampi(int(st["after"]), 0, levels - 1)
		var variants: int = int(t["strip"]["variants"]) if t.has("strip") else 1
		for d in [_front[i], _back[i]]:
			(d.material as ShaderMaterial).set_shader_parameter("alpha", a)
			(d.material as ShaderMaterial).set_shader_parameter("variant", maxi(fi, 0) % variants)
			(d.material as ShaderMaterial).set_shader_parameter("level", level)
			d.queue_redraw()
		_fx[i].queue_redraw()


func _current_frame() -> int:
	if not active or _sprite == null:
		return -1
	if _sprite is AnimatedSprite2D:
		var a := _sprite as AnimatedSprite2D
		if animation_name != &"" and a.animation != animation_name:
			return -1
		return a.frame
	if _sprite is Sprite2D:
		return (_sprite as Sprite2D).frame - frame_offset
	return -1


func _layout_key() -> String:
	if not use_target_layout or _sprite == null:
		return ""
	if _sprite is AnimatedSprite2D:
		var a := _sprite as AnimatedSprite2D
		return "%s%s%s%s" % [a.centered, a.offset, a.flip_h, a.flip_v]
	if _sprite is Sprite2D:
		var s := _sprite as Sprite2D
		return "%s%s%s%s" % [s.centered, s.offset, s.flip_h, s.flip_v]
	return ""


# 动画画布像素 → 本节点的坐标
func _to_local(p: Vector2) -> Vector2:
	if not use_target_layout or _sprite == null:
		return p
	var centered := true
	var off := Vector2.ZERO
	var fh := false
	var fv := false
	if _sprite is AnimatedSprite2D or _sprite is Sprite2D:
		var sp = _sprite  # 两种精灵都有这几个属性
		centered = sp.centered
		off = sp.offset
		fh = sp.flip_h
		fv = sp.flip_v
	var q := p
	if fh:
		q.x = _w - q.x
	if fv:
		q.y = _h - q.y
	if centered:
		q -= Vector2(_w, _h) * 0.5
	return q + off


func _flips() -> Vector2:
	if not use_target_layout or _sprite == null or not (_sprite is AnimatedSprite2D or _sprite is Sprite2D):
		return Vector2.ONE
	var sp = _sprite
	return Vector2(-1.0 if sp.flip_h else 1.0, -1.0 if sp.flip_v else 1.0)


# 这一帧烘焙好的点缀（在拖尾带子外面的部分）
func _draw_fx(d: Drawer) -> void:
	var t: Dictionary = _trails[d.index]
	var tex: Texture2D = t["fx_tex"]
	if tex == null or _fi < 0:
		return
	var frames: Array = t["fx"]["frames"]
	if _fi >= frames.size() or frames[_fi] == null:
		return
	var r: Array = frames[_fi]
	d.draw_set_transform(_to_local(Vector2(r[4], r[5])), 0.0, _flips())
	d.draw_texture_rect_region(tex, Rect2(0, 0, r[2], r[3]), Rect2(r[0], r[1], r[2], r[3]))
	d.draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)


func _draw_part(d: Drawer) -> void:
	if d.fx:
		_draw_fx(d)
		return
	var secs: Array = _secs[d.index]
	if secs.size() < 2:
		return
	var t: Dictionary = _trails[d.index]
	# with a strip the ribbon is widened by its margin on both sides: the light round it
	var mg: float = float(t["strip"]["margin"]) if t["strip_tex"] != null else 0.0
	var pts := PackedVector2Array()
	var uvs := PackedVector2Array()
	var cols := PackedColorArray()
	var idx := PackedInt32Array()
	for s in range(secs.size() - 1):
		var p: Dictionary = secs[s]
		var q: Dictionary = secs[s + 1]
		if p["back"] != d.back:
			continue
		var pa: Vector2 = p["a"] - (p["b"] - p["a"]) * mg
		var pb: Vector2 = p["b"] + (p["b"] - p["a"]) * mg
		var qa: Vector2 = q["a"] - (q["b"] - q["a"]) * mg
		var qb: Vector2 = q["b"] + (q["b"] - q["a"]) * mg
		# a textured ribbon in thin strips across its width: the texture stays straight
		# where the inner edge is much shorter than the outer one
		var strips := 8 if mg > 0.0 else 1
		for k in strips:
			var v0 := float(k) / strips
			var v1 := float(k + 1) / strips
			var n := pts.size()
			for v in [_to_local(pa.lerp(pb, v0)), _to_local(pa.lerp(pb, v1)), _to_local(qa.lerp(qb, v1)), _to_local(qa.lerp(qb, v0))]:
				pts.append(v)
				cols.append(Color.WHITE)
			uvs.append(Vector2(p["u"], v0))
			uvs.append(Vector2(p["u"], v1))
			uvs.append(Vector2(q["u"], v1))
			uvs.append(Vector2(q["u"], v0))
			for i in [n, n + 1, n + 2, n, n + 2, n + 3]:
				idx.append(i)
	if not idx.is_empty():
		RenderingServer.canvas_item_add_triangle_array(d.get_canvas_item(), idx, pts, cols, uvs)


# ---------- 拖尾形状（与编辑器 trails/model.js 相同） ----------

# 这一帧拖尾用到的棍子：{sticks, trim, alpha}，没有拖尾时为空
func _state(t: Dictionary, fi: int) -> Dictionary:
	var keys: Array = t["keys"]
	if fi < 0 or fi >= keys.size():
		return {}
	var end := fi
	var k := 0
	var dis := int(t["dissolve"])
	if keys[fi] == null:
		var j := fi - 1
		while j >= 0 and keys[j] == null and fi - j <= dis:
			j -= 1
		if j < 0 or keys[j] == null or fi - j > dis:
			return {}
		end = j
		k = fi - j
	var start := end
	while start > 0 and keys[start - 1] != null and end - start < 47:
		start -= 1
	var swing := _orient(keys.slice(start, end + 1))
	var sticks := swing.slice(maxi(0, swing.size() - (int(t["length"]) + 1)))
	if sticks.size() < 2:
		return {}
	var p := float(k) / float(dis + 1) if k > 0 else 0.0
	return {"sticks": sticks, "trim": p, "alpha": 1.0 - p, "after": k}


# 画反的棍子（刀尖在握柄一侧）对调两端
func _orient(s: Array) -> Array:
	if s.size() < 2:
		return s
	var out := []
	for i in s.size():
		var c := Vector2.ZERO
		for j in s.size():
			if j != i:
				c += s[j]["a"]
		c /= float(s.size() - 1)
		var k: Dictionary = s[i]
		if k["b"].distance_to(c) < k["a"].distance_to(c) * 0.6:
			out.append({"a": k["b"], "b": k["a"], "back": k["back"]})
		else:
			out.append(k)
	return out


func _cr(p0, p1, p2, p3, t: float):
	var t2 := t * t
	var t3 := t2 * t
	return 0.5 * (2.0 * p1 + (p2 - p0) * t + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t2 + (3.0 * p1 - p0 - 3.0 * p2 + p3) * t3)


# 曲线两端外推一个点：顺着原来的走势继续
func _extend(v: Array) -> Array:
	var m := v.size()
	var lo
	var hi
	if m >= 3:
		lo = 3.0 * v[0] - 3.0 * v[1] + v[2]
		hi = 3.0 * v[m - 1] - 3.0 * v[m - 2] + v[m - 3]
	else:
		lo = 2.0 * v[0] - v[1]
		hi = 2.0 * v[m - 1] - v[m - 2]
	return [lo] + v + [hi]


# 棍子之间的密集截面，u 按中点弧长 0（尾）→ 1（头）
func _sections(s: Array, smooth: bool, fineness: int, rotate: bool, turn: String) -> Array:
	var n := clampi(fineness, 2, 64)
	var ang := []
	var lens := []
	for i in s.size():
		var d: Vector2 = s[i]["b"] - s[i]["a"]
		var a := atan2(d.y, d.x)
		if i > 0:
			var p: float = ang[i - 1]
			if turn == "cw":
				while a < p:
					a += TAU
				while a - p >= TAU:
					a -= TAU
			elif turn == "ccw":
				while a > p:
					a -= TAU
				while p - a >= TAU:
					a += TAU
			else:
				while a - p > PI:
					a -= TAU
				while a - p < -PI:
					a += TAU
		ang.append(a)
		lens.append(d.length())
	var pa := []
	var pb := []
	for k in s:
		pa.append(k["a"])
		pb.append(k["b"])
	var ea := _extend(pa)
	var eb := _extend(pb)
	var et := _extend(ang)
	var el := _extend(lens)
	var out := []
	for k in range(s.size() - 1):
		for j in range(n):
			var t := float(j) / n
			var a: Vector2 = _cr(ea[k], ea[k + 1], ea[k + 2], ea[k + 3], t) if smooth else s[k]["a"].lerp(s[k + 1]["a"], t)
			var b: Vector2
			if rotate:
				var th: float = _cr(et[k], et[k + 1], et[k + 2], et[k + 3], t) if smooth else ang[k] + (ang[k + 1] - ang[k]) * t
				var ln: float = maxf(0.0, _cr(el[k], el[k + 1], el[k + 2], el[k + 3], t) if smooth else lens[k] + (lens[k + 1] - lens[k]) * t)
				b = a + Vector2(cos(th), sin(th)) * ln
			else:
				b = _cr(eb[k], eb[k + 1], eb[k + 2], eb[k + 3], t) if smooth else s[k]["b"].lerp(s[k + 1]["b"], t)
			out.append({"a": a, "b": b, "back": (s[k] if t < 0.5 else s[k + 1])["back"]})
	var last: Dictionary = s[s.size() - 1]
	out.append({"a": last["a"], "b": last["b"], "back": last["back"]})
	var total := 0.0
	out[0]["u"] = 0.0
	for i in range(1, out.size()):
		total += ((out[i]["a"] + out[i]["b"]) * 0.5).distance_to((out[i - 1]["a"] + out[i - 1]["b"]) * 0.5)
		out[i]["u"] = total
	for q in out:
		q["u"] = q["u"] / total if total > 0.0 else 0.0
	return out


# 横扫：在倾斜、压扁的挥动平面里插值，刀尖在屏幕上走椭圆
func _swept(t: Dictionary, sticks: Array) -> Array:
	var fine := int(t["fineness"])
	if t["plane"] != "flat":
		return _sections(sticks, t["smooth"], fine, t["rotate"], t["turn"])
	var sq := clampf(float(t["squash"]), 0.05, 1.0)
	var th := deg_to_rad(float(t["tilt"]))
	var c := cos(th)
	var sn := sin(th)
	var flat := []
	for q in sticks:
		var a: Vector2 = q["a"]
		var b: Vector2 = q["b"]
		flat.append({"a": Vector2(a.x * c + a.y * sn, (-a.x * sn + a.y * c) / sq), "b": Vector2(b.x * c + b.y * sn, (-b.x * sn + b.y * c) / sq), "back": q["back"]})
	var out := []
	for q in _sections(flat, t["smooth"], fine, true, t["turn"]):
		var a: Vector2 = q["a"]
		var b: Vector2 = q["b"]
		var back: bool = (b.y - a.y < 0.0) if t["autoDepth"] else q["back"]
		out.append({"a": Vector2(a.x * c - a.y * sq * sn, a.x * sn + a.y * sq * c), "b": Vector2(b.x * c - b.y * sq * sn, b.x * sn + b.y * sq * c), "back": back, "u": q["u"]})
	return out


func _bow(out: Array, bow: float) -> Array:
	if bow == 0.0 or out.size() < 3:
		return out
	var p0: Vector2 = (out[0]["a"] + out[0]["b"]) * 0.5
	var p1: Vector2 = (out[out.size() - 1]["a"] + out[out.size() - 1]["b"]) * 0.5
	var chord := p0.distance_to(p1)
	var nrm := Vector2(-(p1.y - p0.y) / chord, (p1.x - p0.x) / chord) if chord > 1e-6 else Vector2(0, -1)
	var o := Vector2.ZERO
	for q in out:
		o += q["b"] - q["a"]
	if nrm.dot(o) < 0.0:
		nrm = -nrm
	var path := 0.0
	for i in range(1, out.size()):
		path += ((out[i]["a"] + out[i]["b"]) * 0.5).distance_to((out[i - 1]["a"] + out[i - 1]["b"]) * 0.5)
	var amp := clampf(bow, -1.0, 1.0) * maxf(chord, path) * 0.35
	var res := []
	for q in out:
		var dv: Vector2 = nrm * sin(PI * q["u"]) * amp
		res.append({"a": q["a"] + dv, "b": q["b"] + dv, "back": q["back"], "u": q["u"]})
	return res


# 收尾消散：去掉 u < trim 的部分，剩下的重新铺满 0..1
func _trim(out: Array, trim: float) -> Array:
	if trim <= 0.0:
		return out
	if trim >= 0.999:
		return []
	var res := []
	for i in out.size():
		var q: Dictionary = out[i]
		if q["u"] < trim:
			if i + 1 < out.size() and out[i + 1]["u"] > trim:
				var r: Dictionary = out[i + 1]
				var f: float = (trim - q["u"]) / (r["u"] - q["u"])
				res.append({"a": q["a"].lerp(r["a"], f), "b": q["b"].lerp(r["b"], f), "back": q["back"], "u": trim})
			continue
		res.append(q)
	for q in res:
		q["u"] = (q["u"] - trim) / (1.0 - trim)
	return res


func _profile(t: Dictionary, u: float) -> float:
	if t["shape"] == "even":
		return 1.0
	if t["shape"] == "crescent":
		return maxf(0.06, pow(sin(PI * minf(1.0, u * 0.92 + 0.04)), 0.7))
	var taper := clampf(float(t["taper"]), 0.0, 1.0)
	return taper + (1.0 - taper) * u


# 截面按宽度系数收窄，头部加圆弧帽
func _ribbon(t: Dictionary, sticks: Array, trim: float) -> Array:
	var out := []
	for q in _trim(_bow(_swept(t, sticks), float(t["bow"])), trim):
		var w := _profile(t, q["u"])
		var m: Vector2 = (q["a"] + q["b"]) * 0.5
		out.append({"a": m.lerp(q["a"], w), "b": m.lerp(q["b"], w), "back": q["back"], "u": q["u"]})
	if out.size() < 2:
		return []
	var arc := clampf(float(t["headArc"]), 0.0, 1.0)
	if arc > 0.0 and t["shape"] != "crescent":
		var hd: Dictionary = out[out.size() - 1]
		var pr: Dictionary = out[out.size() - 2]
		var m: Vector2 = (hd["a"] + hd["b"]) * 0.5
		var dir: Vector2 = (m - (pr["a"] + pr["b"]) * 0.5).normalized()
		var hv: Vector2 = (hd["b"] - hd["a"]) * 0.5
		var bulge := arc * hv.length()
		for i in range(1, 7):
			var th := float(i) / 6.0 * PI * 0.5
			var fwd: Vector2 = dir * bulge * sin(th)
			out.append({"a": m - hv * cos(th) + fwd, "b": m + hv * cos(th) + fwd, "back": hd["back"], "u": 1.0})
	return out
`;
}
