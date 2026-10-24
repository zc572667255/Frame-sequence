// Effects drawn by the game: no pictures. One Godot 4 script (vfx_code.gd) that
// draws an effect itself, every frame, the way vfx/kinds/*.js does — the same
// shapes, the same seeded randomness (sparks fly the same way, runes have the
// same strokes), the same timing — from the effect's settings. In the editor an
// effect is drawn onto one canvas, partly as light added up (lighter) and
// partly painted over, then bloomed (blurred and added) and composited; here
// that is two layers (painted / added) inside a CanvasGroup whose shader adds
// the bloom from the blurred mip levels.
//
// The kinds drawn with shapes and gradients — 命中火花, 冲击波, 蓄力, 治疗光圈,
// 流光, 翅膀, 魔法阵 (with its fire rim) — and with 光效点缀; the ones made of
// per-pixel noise — 环绕光, 燃烧, 爆炸, 烟尘 — in a shader that works out the
// same noise (the same integer hash, value noise and octaves, the same loop
// cross-fade) and the same shading per pixel. Not carried over: the other rims
// and the ground auras of 魔法阵, and the pixel look — it is drawn smooth.
import { vfxSettings } from "../vfx/layer.js";
import { VFX_DEFAULTS, VFX_KINDS } from "../vfx/effects.js";
import { paletteOf } from "../vfx/common.js";
import { vfxData } from "./vfx.js";
import { ACCENTS, accentAmounts } from "../vfx/accents.js";

export const CODE_KINDS = ["hit", "shock", "charge", "heal", "ribbon", "wings", "circle", "aura", "burn", "explosion", "dust"];
const PATTERNS = { hex: 0, penta: 1, square: 2, taiji: 3 };
// how much bloom each kind gets (vfx/effects.js BLOOM)
const BLOOM = { hit: 1, shock: 0.8, charge: 1, heal: 0.7, circle: 0, ribbon: 1, wings: 1, aura: 0.9, burn: 0.9, explosion: 0.7, dust: 0 };

export function codeSupported(l) {
  const s = vfxSettings(l);
  return CODE_KINDS.includes(s.kind) && (s.kind !== "circle" || s.pattern in PATTERNS);
}

const num = (v) => { const r = +(+v).toFixed(4); return Number.isInteger(r) ? r.toFixed(1) : String(r); };
const color = (c) => "Color(" + c.map((v) => num(v / 255)).join(", ") + ", 1)";
const colors = (cs) => "PackedColorArray([" + cs.map(color).join(", ") + "])";
// in a .tscn packed arrays are written flat: PackedColorArray(r, g, b, a, …)
const tscnColors = (cs) => "PackedColorArray(" + cs.map((c) => [...c.map((v) => num(v / 255)), "1"].join(", ")).join(", ") + ")";

// an effect's settings (a 特效 layer's vfx, or VFX_DEFAULTS + a kind's own) and
// the box it is drawn in → what the script needs
export function codeParamsFrom(s, w, h, fps, name) {
  const pal = paletteOf(s.palette);
  const glow = Math.max(0, s.glow / 100), pixel = s.style === "pixel";
  return {
    name: name || (VFX_KINDS.find((k) => k.id === s.kind) || {}).name || s.kind,
    kind: CODE_KINDS.indexOf(s.kind), w, h,
    size: Math.max(0.05, Math.min(1, s.size / 100)),
    squash: Math.max(0.15, Math.cos(Math.max(0, Math.min(80, s.tilt)) * Math.PI / 180)),
    side: s.view === "side", pattern: PATTERNS[s.pattern] ?? 0, bolts: !!s.bolts,
    edge: (s.edge === "auto" ? pal.element : s.edge) === "fire" ? 1 : 0,
    loop: !!s.loop, frames: Math.max(1, s.frames | 0), fps: fps || s.fps || 12,
    glow, amount: Math.max(0, s.amount / 100), seed: s.seed | 0 || 1, rotate: +s.rotate || 0,
    soft: !pixel,
    // bloom: blurred and added, as much as the kind gets (none for dark palettes)
    bloom: pal.dark ? 0 : Math.min(1, 0.7 * (BLOOM[s.kind] ?? 1) * glow * (pixel ? 0.5 : 1)),
    additive: !pal.dark,
    cols: pal.cols, core: pal.core, rim: pal.rim, splat: pal.splat,
    // 光效点缀, in ACCENTS order: the palette's own mix (按配色), none, or the effect's own
    accents: (() => { const a = accentAmounts(s, pal.preset) || {}; return ACCENTS.map((x) => +(a[x.id] || 0)); })(),
  };
}

// from a 特效 layer of an animation: its settings, its largest region, and per
// frame where it is (following the animation)
export function codeParams(l, frameIds, w, h, fps, ctx, title) {
  const s = vfxSettings(l);
  const data = vfxData(l, frameIds, w, h, fps, ctx, title);
  let rw = s.w, rh = s.h;
  for (const e of data.timeline) if (e && e[3] * e[4] > rw * rh) { rw = e[3]; rh = e[4]; }
  return { ...codeParamsFrom(s, rw, rh, fps, data.name), follow: { canvas: data.canvas, frames: data.effect.frames, timeline: data.timeline } };
}

// the defaults of a kind (for trying them out)
export function kindSettings(kind, patch = {}) {
  const k = VFX_KINDS.find((x) => x.id === kind);
  return { ...VFX_DEFAULTS, ...(k ? k.defaults : {}), kind, style: "hd", ...patch };
}

// the tscn property lines that set a node's look (the layered scene)
export function codeProps(p) {
  return [
    `kind = ${p.kind}`, `box_size = Vector2(${num(p.w)}, ${num(p.h)})`, `size = ${num(p.size)}`,
    `squash = ${num(p.squash)}`, `side_view = ${p.side}`, `bolts = ${p.bolts}`, `pattern = ${p.pattern}`, `edge_effect = ${p.edge}`,
    `loop = ${p.loop}`, `frames = ${p.frames}`, `fps = ${num(p.fps)}`, `glow = ${num(p.glow)}`, `amount = ${num(p.amount)}`,
    `random_seed = ${p.seed}`, `rotate_degrees = ${num(p.rotate)}`, `soft_light = ${p.soft}`, `bloom = ${num(p.bloom)}`, `additive = ${p.additive}`,
    `colors = ${tscnColors(p.cols)}`, `accents = PackedFloat32Array(${p.accents.map(num).join(", ")})`, `core_color = ${color(p.core)}`, `rim_color = ${color(p.rim)}`, `splat_color = ${color(p.splat)}`,
    p.follow ? `data_json = ${JSON.stringify(JSON.stringify(p.follow))}` : null,
  ].filter(Boolean);
}

// p: codeParams(...) baked in as the defaults, or null for the generic copy the
// layered scene uses (its nodes set every property)
export function codeGodot(p) {
  const d = p || codeParamsFrom(kindSettings("hit"), 160, 160, 12, "特效");
  const follow = d.follow ? JSON.stringify(d.follow).replace(/\\/g, "\\\\") : "";
  return `@tool
# 特效（纯代码）—— 由「光台 · 序列帧工作室」导出：${d.name}
# Godot 4.x。不用任何图片：特效的每一帧都由本脚本实时画出来，形状、随机细节、节奏和编辑器里一样，
# 任意放大都清晰，类型、颜色、大小、速度都能随时改。编辑器里也会动（@tool），可以直接在 2D 视图里看效果。
# 支持：命中火花、冲击波、蓄力、治疗光圈、流光、翅膀、魔法阵（含火焰边缘）、环绕光、燃烧、爆炸、烟尘，以及光效点缀
#（星光、粉尘、余烬、雪花、碎片、闪电、光芒、气泡、水滴、落叶、碎石）。
# 两种用法：
#   单独播放（mode = 单独播放，默认）：新建一个 Node2D 挂上本脚本，节点位置是特效画幅的中心。
#     loop 时一直播；不循环时 play() 播一遍，播完发出 finished；play_at(全局坐标) 在指定位置播，stop() 停下。
#   跟着动画（mode = 跟着动画）：放在角色精灵（AnimatedSprite2D 或 Sprite2D）下面，按精灵当前帧显示，
#     出现的帧、位置、大小和编辑器里一样（data_json 里是每帧的位置）。
extends Node2D

signal finished

@export_enum("跟着动画", "单独播放") var mode := 1
@export var target: NodePath
@export var animation_name: StringName = &""
@export var frame_offset := 0
## 关掉时坐标就是动画画布像素（左上角为原点），不按精灵换算（分层导出的场景里用）
@export var use_target_layout := true
@export_group("单独播放")
@export var autoplay := true
@export var speed := 1.0
## 平滑播放：每个画面帧都重新画（费性能）；关掉时和编辑器一样一帧一帧地播
@export var smooth_motion := false
## 每一帧只画一次：画好的图记下来，再播到这一帧时直接用（同一帧画出来总是一样的）。运行时改了参数后调用 refresh()
@export var cache_frames := true
## 空闲时把还没画过的帧提前一帧一帧画好（第一遍播放也不卡）
@export var prewarm := true
@export_group("特效")
@export_enum("命中火花", "冲击波", "蓄力", "治疗光圈", "流光", "翅膀", "魔法阵", "环绕光", "燃烧", "爆炸", "烟尘") var kind := ${d.kind}
## 画幅大小（编辑器里特效的画幅框）
@export var box_size := Vector2(${num(d.w)}, ${num(d.h)})
## 特效大小：占画幅的比例
@export_range(0.05, 1.0) var size := ${num(d.size)}
## 地面透视（冲击波、治疗光圈、魔法阵）：1 = 从正上方看，越小越扁
@export_range(0.15, 1.0) var squash := ${num(d.squash)}
## 侧面（冲击波、翅膀、魔法阵）
@export var side_view := ${d.side}
## 环绕光：带闪电（超级赛亚人 2 那样）
@export var bolts := ${d.bolts}
@export_enum("六芒星", "五芒星", "双方形", "太极八卦") var pattern := ${d.pattern}
@export_enum("无", "火焰") var edge_effect := ${d.edge}
@export var loop := ${d.loop}
## 特效帧数，和 fps 一起决定一遍的时长
@export var frames := ${d.frames}
@export var fps := ${num(d.fps)}
@export_range(0.0, 3.0) var glow := ${num(d.glow)}
## 粒子、火花、光点的数量
@export_range(0.0, 3.0) var amount := ${num(d.amount)}
## 随机细节（同一个值和编辑器里画出来一样）
@export var random_seed := ${d.seed}
@export var rotate_degrees := ${num(d.rotate)}
## 柔光：大片的淡光、宽一些的辉光（编辑器里像素风格时关掉）
@export var soft_light := ${d.soft}
## 辉光：整个特效模糊后叠加上去的量
@export_range(0.0, 1.0) var bloom := ${num(d.bloom)}
## 发光：叠加到画面上（变亮）；关掉时普通盖上去（深色配色，比如黑炎）
@export var additive := ${d.additive}
@export_group("配色")
## 配色从暗到亮
@export var colors := ${colors(d.cols)}
@export var core_color := ${color(d.core)}
@export var rim_color := ${color(d.rim)}
@export var splat_color := ${color(d.splat)}
@export_group("光效点缀")
## 每种点缀的量（0..1），顺序：星光、粉尘、余烬、雪花、碎片、闪电、光芒、气泡、水滴、落叶、碎石
@export var accents := PackedFloat32Array([${d.accents.map(num).join(", ")}])
@export_group("")
@export_multiline var data_json := """${follow}"""

const TRIGRAMS := [[1, 1, 1], [0, 1, 1], [0, 1, 0], [0, 0, 1], [0, 0, 0], [1, 0, 0], [1, 0, 1], [1, 1, 0]]
# 整个特效画在一张离屏图里（颜色是已经乘过透明度的光的总和），再加上模糊过的一份（辉光），
# 像编辑器一样盖到画面上：光的地方按它的浓度挡住后面一点（预乘透明度）；深色配色（黑炎等）普通盖上去
const BLOOM_SHADER := """
shader_type canvas_item;
render_mode unshaded, %s;
uniform sampler2D blur_tex : repeat_disable, filter_linear;
uniform float bloom = 0.0;
void fragment() {
	vec4 c = texture(TEXTURE, UV);
	vec4 b = texture(blur_tex, UV);
	vec4 o = c + b * bloom;
	%s
}
"""
const ADD_OUT := "COLOR = vec4(o.rgb, clamp(max(c.a, max(max(o.r, o.g), o.b)), 0.0, 1.0));"
const MIX_OUT := "o.a = clamp(o.a, 0.0, 1.0); if (o.a > 0.0001) { o.rgb /= o.a; } COLOR = o;"
# 高斯模糊，一遍（在缩小的图上）
const BLUR_SHADER := """
shader_type canvas_item;
render_mode blend_disabled;
uniform sampler2D src_tex : filter_linear, repeat_disable;
uniform vec2 px;
uniform float sigma = 1.0;
uniform float spacing = 1.0;
uniform int taps = 3;
void fragment() {
	vec4 acc = vec4(0.0);
	float ws = 0.0;
	for (int j = -taps; j <= taps; j++) {
		for (int i = -taps; i <= taps; i++) {
			vec2 o = vec2(float(i), float(j)) * spacing;
			vec2 uv = UV + o * px;
			float w = exp(-dot(o, o) / (2.0 * sigma * sigma));
			if (uv.x >= 0.0 && uv.y >= 0.0 && uv.x <= 1.0 && uv.y <= 1.0) { acc += texture(src_tex, uv) * w; }
			ws += w;
		}
	}
	COLOR = acc / ws;
}
"""


# 噪声画出来的特效（环绕光、燃烧、爆炸、烟尘）：每个像素算一遍，和编辑器 vfx/kinds/*.js、vfx/common.js 的算法一样
# （整数哈希、值噪声、三层分形噪声、循环时首尾交叉淡化的上飘噪声都一模一样）。UV = 画幅像素坐标
const FIELD_SHADER := """
shader_type canvas_item;
render_mode %s;
uniform int mode = 0;
uniform float t = 0.0;
uniform bool loop_on = true;
uniform int seed = 1;
uniform float gmul = 1.0;
uniform float cx = 0.0;
uniform float cy = 0.0;
uniform float rx = 1.0;
uniform float ry = 1.0;
uniform float k = 0.1;
uniform float rs = 1.0;
uniform float amt = 1.0;
uniform float cool = 1.0;
uniform float flash = 0.0;
uniform bool dark = false;
uniform sampler2D ramp_aura : filter_linear, repeat_disable;
uniform sampler2D ramp_flame : filter_linear, repeat_disable;
uniform sampler2D ramp_dust : filter_linear, repeat_disable;
uniform sampler2D ramp_fire : filter_linear, repeat_disable;
uniform vec4 smoke_lo : source_color;
uniform vec4 smoke_hi : source_color;
uniform vec4 fsmoke_hi : source_color;
uniform int nb = 0;
uniform vec4 blobs[48];
uniform float cell = 4.0;
uniform vec2 drift = vec2(0.0);
uniform float rough = 0.5;
uniform float soft = 0.5;
uniform float vheat = 0.0;
uniform float thr = 0.3;
uniform float fade = 1.0;
uniform int vcolor = 0;

float lh(int x, int y, int s) {
	uint v = (uint(x) * 374761393u) ^ (uint(y) * 668265263u) ^ uint(s);
	v = (v ^ (v >> 13u)) * 1274126177u;
	return float(v ^ (v >> 16u)) / 4294967295.0;
}
float one(vec2 p, int s) {
	vec2 i = floor(p);
	vec2 f = p - i;
	f = f * f * (3.0 - 2.0 * f);
	int ix = int(i.x);
	int iy = int(i.y);
	float a = lh(ix, iy, s);
	float b = lh(ix + 1, iy, s);
	float c = lh(ix, iy + 1, s);
	float d = lh(ix + 1, iy + 1, s);
	return a + (b - a) * f.x + (c - a) * f.y + (a - b - c + d) * f.x * f.y;
}
float fbm(vec2 p, int s) {
	return one(p, s) * 0.55 + one(p * 2.1 + vec2(17.3, 3.1), s) * 0.3 + one(p * 4.3 + vec2(7.7, 29.5), s) * 0.15;
}
float loopn(vec2 p, int salt, float kk, float ky, float L) {
	int s = seed * salt + 1;
	float a = fbm(vec2(p.x * kk, p.y * kk * ky + t * L), s);
	if (!loop_on) { return a; }
	float b = fbm(vec2(p.x * kk, p.y * kk * ky + (t - 1.0) * L), s);
	float keep = 1.0 / length(vec2(1.0 - t, t));
	return clamp(0.5 + ((a - 0.5) * (1.0 - t) + (b - 0.5) * t) * keep, 0.0, 1.0);
}
float strand(float n, float p) { return pow(1.0 - abs(2.0 * n - 1.0), p); }
float sm(float e0, float e1, float x) { float u = clamp((x - e0) / max(e1 - e0, 0.000001), 0.0, 1.0); return u * u * (3.0 - 2.0 * u); }
float gh(int x, int y, int o) {
	uint v = (uint(x + o * 7919) * 374761393u) ^ (uint(y - o * 104729) * 668265263u) ^ uint(seed * 7 + 3);
	v = (v ^ (v >> 13u)) * 1274126177u;
	return float(v ^ (v >> 16u)) / 4294967295.0;
}
float gridn(vec2 p) {
	float outv = 0.0;
	for (int o = 0; o < 2; o++) {
		float c = o == 0 ? cell : cell / 2.7;
		float wt = o == 0 ? 0.65 : 0.35;
		vec2 f = (p + drift) / c;
		vec2 i = floor(f);
		vec2 tt = f - i;
		tt = tt * tt * (3.0 - 2.0 * tt);
		int ix = int(i.x);
		int iy = int(i.y);
		float top = mix(gh(ix, iy, o), gh(ix + 1, iy, o), tt.x);
		float bot = mix(gh(ix, iy + 1, o), gh(ix + 1, iy + 1, o), tt.x);
		outv += mix(top, bot, tt.y) * wt;
	}
	return outv;
}
vec4 fire(float heat, float light) {
	if (heat < 0.12) { return vec4(mix(smoke_lo.rgb, fsmoke_hi.rgb, light * light), 0.85); }
	return vec4(texture(ramp_fire, vec2((heat - 0.12) / 0.88, 0.5)).rgb, 1.0);
}
void fragment() {
	float x = UV.x - 0.5;
	float y = UV.y - 0.5;
	vec3 col = vec3(1.0);
	float a = 0.0;
	if (mode == 0) {
		// 环绕光：包住角色的光焰，尖顶、中间透明，亮丝顺着光焰往上，在边缘散成光缕
		float v = (y + 0.5 - cy) / ry;
		float top = max(0.0, -v);
		float xs = x + (loopn(vec2(x, y), 57, k * 0.3, 0.4, 1.5) - 0.5) * rx * (0.05 + 0.4 * top);
		float u = (xs + 0.5 - cx) / rx;
		float dd = sqrt(u * u * (1.0 + top * 1.3) + v * v * (v > 0.0 ? 1.2 : 0.85));
		float n = loopn(vec2(xs, y), 53, k, 0.3, 3.0);
		float e = 1.0 - dd + (n - 0.5) * (0.3 + 1.4 * top);
		if (e <= -0.16) { discard; }
		float s = strand(loopn(vec2(xs + (n - 0.5) * rx * 0.3, y), 83, k * 2.2, 0.13, 5.0), 4.0);
		float shell = sm(-0.02, 0.13, e);
		float hollow = sm(0.08, 0.4, e);
		float wisp = s * sm(-0.16, 0.02, e) * (1.0 - shell) * (0.25 + top);
		a = (shell * (1.0 - 0.96 * hollow) * (0.85 + 0.35 * s) + wisp) * (1.0 - sm(1.4, 1.75, top));
		col = texture(ramp_aura, vec2(clamp(0.2 + 0.8 * (1.0 - hollow) * (0.45 + 0.35 * n + 0.35 * s), 0.0, 1.0), 0.5)).rgb;
	} else if (mode == 1) {
		// 燃烧：从底部烧起的火焰，整体随气流摆动，火舌拉长，亮丝在边缘散成火缕
		float hgt = (cy - y - 0.5) / (2.0 * ry);
		if (hgt < -0.02) { discard; }
		float xs = x + (loopn(vec2(x, y), 73, k * 0.3, 0.4, 1.5) - 0.5) * rx * (0.1 + 0.6 * hgt);
		float u = (xs + 0.5 - cx) / rx;
		float n = loopn(vec2(xs, y), 67, k, 0.42, 4.0);
		float f = (1.0 - hgt) * 1.05 - pow(abs(u), 1.4) * (0.9 + 1.4 * hgt) + (n - 0.5) * (0.8 + 1.1 * hgt) - 0.18;
		if (f <= -0.14) { discard; }
		float s = strand(loopn(vec2(xs + (n - 0.5) * rx * 0.35, y), 79, k * 2.2, 0.13, 6.0), 4.0);
		float topf = 1.0 - sm(0.95, 1.15, hgt);
		float body = sm(-0.03, 0.22, f) * sm(-0.02, 0.05, hgt) * topf;
		float wisp = s * sm(-0.14, 0.02, f) * (1.0 - body) * (0.4 + hgt) * topf;
		float heat = clamp(f * 0.9 + (1.0 - hgt) * 0.08 + s * 0.3 * body, 0.0, 1.0);
		if (dark) {
			vec4 fc = fire(heat, 0.5 + 0.5 * (1.0 - hgt));
			col = fc.rgb;
			a = (body + wisp) * fc.a;
		} else {
			col = texture(ramp_flame, vec2(heat, 0.5)).rgb;
			a = body * (0.3 + 0.7 * sm(0.0, 0.5, heat)) * (0.75 + 0.25 * s) + wisp * 0.8;
		}
	} else if (mode == 2) {
		// 爆炸的烟：一团团翻滚、被顶光照亮的烟往上飘
		float dx = x + 0.5 - cx;
		float dy = y + 0.5 - cy;
		float wx = (fbm(vec2(dx * k * 0.6, dy * k * 0.6 + t), seed * 29 + 7) - 0.5) * rs * 0.5;
		float n = fbm(vec2((dx + wx) * k, dy * 1.1 * k + t * 1.3), seed * 19 + 3);
		float b = fbm(vec2((dx + wx) * k * 2.4 + 5.0, dy * k * 2.4 + t * 2.0), seed * 23 + 5);
		float d = 1.0 - length(vec2(dx + wx, dy * 1.1)) / rs + (n - 0.5) * 0.95 + (b - 0.5) * 0.35;
		if (d <= 0.0) { discard; }
		a = sm(0.0, 0.3, d) * amt * (0.65 + 0.35 * b) * 0.9;
		float lit = clamp(0.5 - dy / rs * 0.55 + (b - 0.5) * 0.9, 0.0, 1.0);
		col = mix(smoke_lo.rgb, smoke_hi.rgb, lit * lit);
	} else if (mode == 3) {
		// 爆炸的火球：白热的中心翻出一团团火焰和火舌，从白热经配色冷却
		float dx = x + 0.5 - cx;
		float dy = y + 0.5 - cy;
		float dist = length(vec2(dx, dy));
		float wx = (fbm(vec2(dx * k * 0.7 + 3.0, dy * k * 0.7 - t * 0.8), seed * 29 + 7) - 0.5) * rs * 0.6;
		float wy = (fbm(vec2(dx * k * 0.7 - 9.0, dy * k * 0.7 + 4.0), seed * 29 + 7) - 0.5) * rs * 0.4;
		float n = fbm(vec2((dx + wx) * k * 1.2 + 11.0, (dy + wy) * k * 1.2 - t * 1.6), seed * 19 + 3);
		float b = fbm(vec2((dx + wx) * k * 2.8 - 7.0, (dy + wy) * k * 2.8 - t * 2.6), seed * 23 + 5);
		float d = 1.0 - dist / rs + (n - 0.5) * 0.85 + (b - 0.5) * 0.3;
		if (d <= -0.12) { discard; }
		float body = sm(-0.04, 0.25, d);
		float tongue = sm(-0.12, 0.02, d) * (1.0 - body) * sm(0.55, 0.8, b) * 0.8;
		float heat = clamp((d * 1.2 + (b - 0.5) * 0.55) * cool + flash * body, 0.0, 1.0);
		a = body * sm(0.04, 0.35, heat) + tongue * cool;
		col = texture(ramp_flame, vec2(heat, 0.5)).rgb;
	} else {
		// 一团团噪声组成的体积（烟尘、深色配色的爆炸）
		vec2 px = UV;
		float D = 0.0;
		float H = 0.0;
		float L = 0.5;
		float best = 0.0;
		for (int i = 0; i < nb; i++) {
			vec4 bl = blobs[i];
			vec2 dv = px - bl.xy;
			float q = dot(dv, dv) / max(bl.z * bl.z, 0.0001);
			if (q >= 1.0) { continue; }
			float ff = (1.0 - q) * (1.0 - q);
			D += ff;
			H = max(H, ff * bl.w);
			if (ff > best) { best = ff; L = 0.5 - dv.y / (bl.z * 2.0); }
		}
		if (D <= 0.0) { discard; }
		float n = gridn(UV - 0.5);
		float v = (1.0 - exp(-D * 1.8)) + (n - 0.5) * rough - thr;
		if (v <= 0.0) { discard; }
		a = sm(0.0, soft, v) * fade;
		float heat = clamp(H * (0.75 + 0.5 * n) * vheat, 0.0, 1.0);
		float light = clamp(L + (n - 0.5) * 0.35, 0.0, 1.0);
		if (vcolor == 0) {
			col = texture(ramp_dust, vec2(light, 0.5)).rgb;
		} else {
			vec4 fc = fire(heat, light);
			col = fc.rgb;
			a *= fc.a;
		}
	}
	COLOR = vec4(col, clamp(a, 0.0, 1.0) * gmul);
}
"""


# 四层：普通（盖上去）、噪声（盖上去）、噪声（叠加）、光（叠加变亮），放在一个 CanvasGroup 里整体加辉光
class Layer extends Node2D:
	var host
	var role := 0  # 0 普通，1 光，2 噪声（普通），3 噪声（叠加）

	func _draw() -> void:
		host._draw_layer(self, role)


# 和编辑器一样的伪随机数（Park–Miller）
class Rand:
	var s := 1

	func _init(seed_value: int) -> void:
		s = (absi(seed_value) % 2147483646) + 1

	func next() -> float:
		s = (s * 16807) % 2147483647
		return float(s - 1) / 2147483646.0


var _sprite: Node2D
var _follow := {}
var _playing := false
var _time := 0.0
var _shown := ""
var _layers: Array[Layer] = []
# 离屏图：特效按画幅画进去（放大 _vs 倍），再模糊一份做辉光，最后由 _disp 显示到画面上
var _vp: SubViewport
var _canvas: Node2D
var _blur_vp: SubViewport
var _blur_mat: ShaderMaterial
var _disp: Sprite2D
var _disp_mat: ShaderMaterial
var _vs := 0
var _vbox := Vector2.ONE
var _kick := 0
# 这一层攒起来的三角形
var _bi := PackedInt32Array()
var _bp := PackedVector2Array()
var _bc := PackedColorArray()
var _ai := PackedInt32Array()
var _ap := PackedVector2Array()
var _ac := PackedColorArray()
var _serial := 0  # 每次重画加一
var _cache := {}  # 帧 → [画好的图, 模糊的那份]
var _cur := -3  # 正在显示的帧（-1 没有，-2 平滑播放）
var _busy := -1  # 正在画、等着记下来的帧
var _draw_key := -1  # 离屏图里画的是哪一帧
var _built := -1  # 两层的形状是按哪一次算的
var _last_fi := -1
var _xf := Transform2D.IDENTITY
# 画的时候用的
var _cv: CanvasItem
var _pass_light := false  # 现在画的是不是光那一层
var _role := 0  # 现在画的是哪一层
var _add := true  # 特效现在的画法：true = 叠加发光，false = 普通盖上去
var _gmul := 1.0  # 整体透明度
var _base := Transform2D.IDENTITY
var _t := 0.0
var _w := 1.0
var _h := 1.0
var _R := 1.0
var _cx := 0.0
var _cy := 0.0
var _gy := 0.0
var _rx := 0.0
var _ry := 0.0
var _px := 1.0  # 一个屏幕像素在本地坐标里多长（画抗锯齿的线用）


func _ready() -> void:
	_sprite = (get_node_or_null(target) if not target.is_empty() else get_parent()) as Node2D
	if not data_json.is_empty():
		var d = JSON.parse_string(data_json)
		if typeof(d) == TYPE_DICTIONARY:
			_follow = d
	_build()
	if mode == 1 and (autoplay or Engine.is_editor_hint()):
		play()


func play() -> void:
	_playing = true
	_time = 0.0
	_cur = -3


func play_at(at: Vector2) -> void:
	global_position = at
	play()


func stop() -> void:
	_playing = false
	_cur = -3


func is_playing() -> bool:
	return _playing


func _redraw() -> void:
	_serial += 1
	for l in _layers:
		l.queue_redraw()
	if _vp:
		_vp.render_target_update_mode = SubViewport.UPDATE_ALWAYS
		_blur_vp.render_target_update_mode = SubViewport.UPDATE_ALWAYS
		_kick = 2


# 清晰度：跟着屏幕上的放大倍数（1～4 倍）
func _want_scale() -> int:
	var sc := absf(get_global_transform_with_canvas().get_scale().x) if is_inside_tree() else 1.0
	return clampi(ceili(sc - 0.01), 1, 4)


func _exit_tree() -> void:
	for n in [_vp, _blur_vp, _disp]:
		if n and is_instance_valid(n):
			n.queue_free()
	_vp = null
	_layers.clear()
	_vs = 0


# 离屏图：盖住最大的画幅（跟着动画时每帧的画幅可能不一样大）
func _build() -> void:
	for n in [_vp, _blur_vp, _disp]:
		if n and is_instance_valid(n):
			n.queue_free()
	_layers.clear()
	_vs = _want_scale()
	_vbox = box_size
	if mode == 0 and not _follow.is_empty():
		_vbox = Vector2.ONE
		for r in _follow["timeline"]:
			if r != null:
				_vbox = _vbox.max(Vector2(float(r[3]), float(r[4])))
	var vsz := Vector2i(maxi(1, ceili(_vbox.x * _vs)), maxi(1, ceili(_vbox.y * _vs)))
	_vp = SubViewport.new()
	_vp.size = vsz
	_vp.transparent_bg = true
	_vp.disable_3d = true
	_vp.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	_canvas = Node2D.new()
	_canvas.scale = Vector2(_vs, _vs)
	_vp.add_child(_canvas)
	for role in [0, 2, 3, 1]:
		var l := Layer.new()
		l.host = self
		l.role = role
		if role == 1:
			var m := CanvasItemMaterial.new()
			m.blend_mode = CanvasItemMaterial.BLEND_MODE_ADD
			l.material = m
		elif role >= 2:
			var fm := ShaderMaterial.new()
			var fs := Shader.new()
			fs.code = FIELD_SHADER % ("blend_mix" if role == 2 else "blend_add")
			fm.shader = fs
			_setup_field(fm)
			l.material = fm
		_canvas.add_child(l)
		_layers.append(l)
	# 辉光：模糊半径跟着特效大小
	var sg := maxf(2.0, minf(box_size.x, box_size.y) / 2.0 * size * 0.1) * _vs * 0.6
	var k := clampi(int(floor(sg / 3.0)), 1, 4)
	var bs := Vector2i(maxi(1, ceili(float(vsz.x) / k)), maxi(1, ceili(float(vsz.y) / k)))
	_blur_vp = SubViewport.new()
	_blur_vp.size = bs
	_blur_vp.transparent_bg = true
	_blur_vp.disable_3d = true
	_blur_vp.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	var bsp := Sprite2D.new()
	bsp.centered = false
	bsp.texture = _vp.get_texture()
	bsp.scale = Vector2(bs) / Vector2(vsz)
	_blur_mat = ShaderMaterial.new()
	var bsh := Shader.new()
	bsh.code = BLUR_SHADER
	_blur_mat.shader = bsh
	var so := maxf(0.05, sg / k)
	var spc := maxf(1.0, so / 2.0)
	_blur_mat.set_shader_parameter("src_tex", bsp.texture)
	_blur_mat.set_shader_parameter("px", Vector2(1.0 / bs.x, 1.0 / bs.y))
	_blur_mat.set_shader_parameter("sigma", so)
	_blur_mat.set_shader_parameter("spacing", spc)
	_blur_mat.set_shader_parameter("taps", clampi(ceili(so * 2.5 / spc), 1, 6))
	bsp.material = _blur_mat
	_blur_vp.add_child(bsp)
	add_child(_vp, false, Node.INTERNAL_MODE_BACK)  # 内部节点：不显示在场景树里、不存进场景
	add_child(_blur_vp, false, Node.INTERNAL_MODE_BACK)
	_disp = Sprite2D.new()
	_disp.centered = false
	_disp.texture = _vp.get_texture()
	_disp.region_enabled = true
	_disp_mat = ShaderMaterial.new()
	var sh := Shader.new()
	sh.code = BLOOM_SHADER % (["blend_premul_alpha", ADD_OUT] if additive else ["blend_mix", MIX_OUT])
	_disp_mat.shader = sh
	_disp_mat.set_shader_parameter("blur_tex", _blur_vp.get_texture())
	_disp.material = _disp_mat
	_disp.visible = false
	add_child(_disp, false, Node.INTERNAL_MODE_BACK)
	_redraw()


# 这一帧的画幅：[宽, 高, 进度 t, 画幅 → 本节点]，没有时为空
func _frame_box() -> Array:
	var key := _key_now()
	if key == -1:
		return []
	var fb := _box_for(key)
	if mode == 1:
		fb.append(Transform2D(0.0, -box_size / 2.0))  # 节点位置 = 画幅中心
	else:
		var r: Array = _follow["timeline"][key]
		fb.append(Transform2D(0.0, _flips(), 0.0, _to_local(Vector2(r[1], r[2]))))
	return fb


# 现在该显示哪一帧：单独播放时是特效自己的第几帧（-2 = 平滑播放，不按帧），跟着动画时是精灵的帧；-1 = 没有
func _key_now() -> int:
	if mode == 1:
		if not _playing:
			return -1
		if smooth_motion:
			return -2
		var n := maxi(1, frames)
		var fi := int(floor(_time * fps))
		return posmod(fi, n) if loop else mini(fi, n - 1)
	if _follow.is_empty():
		return -1
	var fi := _current_frame()
	var tl: Array = _follow["timeline"]
	if fi < 0 or fi >= tl.size() or tl[fi] == null:
		return -1
	return fi


# 某一帧的 [宽, 高, 进度 t]
func _box_for(key: int) -> Array:
	if mode == 1:
		var t := 0.0
		if key == -2:
			var dur := float(frames) / maxf(fps, 1.0)
			t = fposmod(_time / dur, 1.0) if loop else clampf(_time / dur, 0.0, 0.999)
		else:
			var n := maxi(1, frames)
			t = float(key) / n if loop else (key + 0.5) / n
		return [box_size.x, box_size.y, t]
	var r: Array = _follow["timeline"][key]
	var n := float(_follow["frames"])
	return [float(r[3]), float(r[4]), float(r[0]) / n if loop else (float(r[0]) + 0.5) / n]


# 所有要画的帧
func _all_keys() -> Array:
	var out := []
	if mode == 1:
		for i in maxi(1, frames):
			out.append(i)
	elif not _follow.is_empty():
		var tl: Array = _follow["timeline"]
		for i in tl.size():
			if tl[i] != null:
				out.append(i)
	return out


func _caching() -> bool:
	return cache_frames and not smooth_motion and not Engine.is_editor_hint()


# 清掉记下来的帧（运行时改了参数之后调用）
func refresh() -> void:
	_cache.clear()
	_cur = -3


# 把某一帧画进离屏图（两帧后画完）
func _render(key: int) -> void:
	_draw_key = key
	_busy = key if key >= 0 else -1
	_redraw()


func _apply(img: Texture2D, blur: Texture2D) -> void:
	_disp.texture = img
	_disp_mat.set_shader_parameter("blur_tex", blur)


func _process(delta: float) -> void:
	if _vs == 0 or _want_scale() != _vs:
		_build()  # 第一次、屏幕上放大倍数变了、或者重新进入场景树
		_cache.clear()
		_cur = -3
	if _kick > 0:
		_kick -= 1
		if _kick == 0 and not (mode == 1 and _playing and smooth_motion):
			_vp.render_target_update_mode = SubViewport.UPDATE_DISABLED
			_blur_vp.render_target_update_mode = SubViewport.UPDATE_DISABLED
			if _busy >= 0:
				# 记下画好的这一帧
				if _caching():
					_cache[_busy] = [ImageTexture.create_from_image(_vp.get_texture().get_image()), ImageTexture.create_from_image(_blur_vp.get_texture().get_image())]
					if _cur == _busy:
						_apply(_cache[_busy][0], _cache[_busy][1])
				_busy = -1
	if mode == 1 and _playing:
		_time += delta * speed
		var dur := float(frames) / maxf(fps, 1.0)
		if not loop and _time >= dur:
			if Engine.is_editor_hint():
				_time = 0.0  # 编辑器里反复预览
			else:
				_playing = false
				finished.emit()
	# 显示：这一帧的画幅放到它该在的位置
	var fb := _frame_box()
	_disp.visible = not fb.is_empty()
	if not fb.is_empty():
		_disp.region_rect = Rect2(0, 0, ceilf(float(fb[0]) * _vs), ceilf(float(fb[1]) * _vs))
		_disp.transform = (fb[3] as Transform2D) * Transform2D(0.0, Vector2(1.0 / _vs, 1.0 / _vs), 0.0, Vector2.ZERO)
		_disp_mat.set_shader_parameter("bloom", bloom)
	var key := _key_now()
	if key == -2:
		_cur = -2
		_render(-2)  # 平滑播放：每帧都画
		_apply(_vp.get_texture(), _blur_vp.get_texture())
		return
	if key != _cur:
		_cur = key
		if key >= 0 and _caching() and _cache.has(key):
			_apply(_cache[key][0], _cache[key][1])
		elif key >= 0:
			_render(key)
			_apply(_vp.get_texture(), _blur_vp.get_texture())
	elif _caching() and prewarm and _kick == 0 and _busy < 0 and (_cur < 0 or _cache.has(_cur)):
		# 空闲：提前画一帧还没画过的（显示用的是记下来的图，不受影响）
		for k in _all_keys():
			if not _cache.has(k):
				_render(k)
				break


func _draw_layer(cv: CanvasItem, role: int) -> void:
	_cv = cv
	_role = role
	_pass_light = role == 1
	if role >= 2 and kind < 7:
		return  # 只有噪声画的特效用这两层
	_px = 1.0 / maxf(0.0001, absf(cv.get_global_transform_with_canvas().get_scale().x))
	if _draw_key == -1:
		return
	var fb := _box_for(_draw_key)
	_base = Transform2D.IDENTITY
	if role >= 2:
		_draw_effect(float(fb[0]), float(fb[1]), float(fb[2]))
		cv.draw_set_transform_matrix(Transform2D.IDENTITY)
		return
	# 普通层和光层的形状一次算出来（各进各的那一批），两层各自交出自己那批（一次绘制调用）
	if _built != _serial:
		_built = _serial
		_bi = PackedInt32Array()
		_bp = PackedVector2Array()
		_bc = PackedColorArray()
		_ai = PackedInt32Array()
		_ap = PackedVector2Array()
		_ac = PackedColorArray()
		_role = 0
		_draw_effect(float(fb[0]), float(fb[1]), float(fb[2]))
		cv.draw_set_transform_matrix(Transform2D.IDENTITY)
	if role == 1 and not _ai.is_empty():
		RenderingServer.canvas_item_add_triangle_array(cv.get_canvas_item(), _ai, _ap, _ac)
	elif role == 0 and not _bi.is_empty():
		RenderingServer.canvas_item_add_triangle_array(cv.get_canvas_item(), _bi, _bp, _bc)


# 攒起来的三角形（点按当前的变换算好）
func _tri(idx: PackedInt32Array, pts: PackedVector2Array, cols: PackedColorArray) -> void:
	if _add:
		var base := _ap.size()
		for i in idx:
			_ai.append(base + i)
		for p in pts:
			_ap.append(_xf * p)
		if cols.size() == pts.size():
			_ac.append_array(cols)
		else:
			for i in pts.size():
				_ac.append(cols[0])
		return
	var base := _bp.size()
	for i in idx:
		_bi.append(base + i)
	for p in pts:
		_bp.append(_xf * p)
	if cols.size() == pts.size():
		_bc.append_array(cols)
	else:
		for i in pts.size():
			_bc.append(cols[0])


func _tri_circle(c: Vector2, r: float, col: Color) -> void:
	var n := clampi(int(r * 2.0) + 8, 8, 40)
	var pts := PackedVector2Array([c])
	var idx := PackedInt32Array()
	for i in n:
		var a := TAU * i / n
		pts.append(c + Vector2(cos(a), sin(a)) * r)
		idx.append_array(PackedInt32Array([0, 1 + i, 1 + (i + 1) % n]))
	_tri(idx, pts, PackedColorArray([col]))


func _tri_rect(r: Rect2, col: Color) -> void:
	_tri(PackedInt32Array([0, 1, 2, 0, 2, 3]), PackedVector2Array([r.position, Vector2(r.end.x, r.position.y), r.end, Vector2(r.position.x, r.end.y)]), PackedColorArray([col]))


# 一帧：w × h 的画幅里，进度 t（0..1），和编辑器 vfx/effects.js renderVfx 一样的尺寸
func _draw_effect(w: float, h: float, t: float) -> void:
	_w = w
	_h = h
	_t = t
	_R = minf(w, h) / 2.0 * size
	_cx = w / 2.0
	_cy = h / 2.0
	_rx = w / 2.0 * size
	_ry = h / 2.0 * size
	var ground := kind == 3 or kind == 6 or (kind == 1 and squash < 0.999)
	_gy = h / 2.0 + _R * squash * 0.5 if ground else h / 2.0
	if kind == 6 or kind == 3:
		_gy = maxf(h / 2.0, h - _R * squash - 4.0)  # 站在地面上的：圆环刚好在底边里面
	if kind == 10:
		_gy = h * 0.85  # 烟尘：在画幅底部扬起
	var xf := _base
	if rotate_degrees != 0.0:
		var rot := deg_to_rad(rotate_degrees)
		var c := Vector2(_cx, _cy)
		xf = _base * Transform2D(rot, c - c.rotated(rot))
	_cv.draw_set_transform_matrix(xf)
	_xf = xf
	_gmul = 1.0
	if _role >= 2:
		_field_pass()
		return
	match kind:
		0: _k_hit()
		1: _k_shock()
		2: _k_charge()
		3: _k_heal()
		4: _k_ribbon()
		5: _k_wings()
		6: _k_circle()
		7: _k_aura()
		8: _k_burn()
		9: _k_explosion()
		10: _k_dust()
	_gmul = 1.0
	_accents()


# ---------- 各种特效（与编辑器 vfx/kinds/*.js 相同的画法） ----------

# 命中火花：白热闪光、十字长刺和短刺、飞溅的火花、一道细环、几颗实心碎屑
func _k_hit() -> void:
	var t := _t
	var R := _R
	var c := Vector2(_cx, _cy)
	var P := Rand.new(random_seed * 13 + 1)
	_add = true
	var fl := 1.0 - _smooth(0.0, 0.4, t)
	_blob(c, R * 0.75 * (0.7 + 0.5 * _ease_out(t * 3.0, 2.0)), [[0.0, core_color, fl], [0.25, core_color, 0.8 * fl], [0.5, rim_color, 0.55 * fl], [1.0, rim_color, 0.0]])
	var tilt := P.next() * PI
	var grow := _ease_out(t / 0.15, 2.0)
	var thin := 1.0 - _smooth(0.1, 0.7, t)
	for k in 4:
		var th := tilt + k * PI / 2.0 + (P.next() - 0.5) * 0.25
		_spike(c, th, R * (0.75 if k % 2 == 1 else 1.1) * grow * (1.0 + 0.2 * t), R * 0.12 * thin, core_color, rim_color, thin)
	for k in int(round(8.0 * amount)):
		var th := P.next() * TAU
		var ln := R * (0.35 + 0.4 * P.next())
		_spike(c, th, ln * grow, R * 0.06 * thin, core_color, rim_color, 0.85 * thin)
	_sparks(c, int(round(18.0 * amount)), R * 1.05, 0.0, 3, 0.25)
	_ring(c, R * (0.25 + 0.75 * _ease_out(t, 3.0)), R * 0.07 * (1.0 - t) + 0.8, 1.0, rim_color, 0.8 * (1.0 - _smooth(0.0, 0.75, t)), 1.0)
	_add = false
	var D := Rand.new(random_seed * 17 + 5)
	for k in int(round(8.0 * amount)):
		var th := D.next() * TAU
		var d := R * (0.25 + 0.75 * D.next()) * _ease_out(t, 2.0)
		var r := R * (0.015 + 0.025 * D.next())
		var a := 1.0 - _smooth(0.45, 1.05, t)
		if a <= 0.0 or not _ok():
			continue
		_tri_circle(Vector2(_cx + cos(th) * d, _cy + sin(th) * d + R * 0.2 * t * t), maxf(0.7, r), _col(splat_color, a))


# 冲击波：两道向外扩散的柔和光环（倾斜时压扁在地面上），前沿的速度线，扬起的碎屑
func _k_shock() -> void:
	var t := _t
	var R := _R
	var kx := squash if side_view else 1.0
	var k := 1.0 if side_view else squash
	var c := Vector2(_cx, _gy if k < 0.98 else _cy)
	_add = true
	var fl := 1.0 - _smooth(0.0, 0.3, t)
	_blob(c, R * 0.45, [[0.0, core_color, 0.9 * fl], [0.5, rim_color, 0.4 * fl], [1.0, rim_color, 0.0]], Vector2(1.0, k))
	var r1 := R * _ease_out(t, 2.6)
	var r2 := R * 0.8 * _ease_out((t - 0.12) / 0.88, 2.6)
	var left := 1.0 - _ease_in(t, 2.0)
	_ring(c, r1 * 0.8, r1 * 0.32 + 1.0, k, rim_color, 0.22 * left, kx)
	_ring(c, r1 * 0.93, r1 * 0.12 + 1.0, k, colors[colors.size() - 1], 0.25 * left, kx)
	_ring(c, r1, R * 0.11 * (1.0 - t) + 0.8, k, core_color, 0.95 * (1.0 - _ease_in(t, 2.2)), kx)
	_ring(c, r1, R * 0.2 * (1.0 - t) + 1.0, k, rim_color, 0.5 * left, kx)
	if t > 0.12:
		_ring(c, r2, R * 0.05 * (1.0 - t) + 0.6, k, rim_color, 0.7 * left, kx)
	var P := Rand.new(random_seed * 23 + 4)
	for i in int(round(18.0 * amount)):
		var th := P.next() * TAU
		var l := 0.1 + 0.15 * P.next()
		var a := left * (0.5 + 0.5 * P.next())
		var p := c + Vector2(cos(th) * r1 * (1.0 - l) * kx, sin(th) * r1 * (1.0 - l) * k)
		var q := c + Vector2(cos(th) * r1 * 1.04 * kx, sin(th) * r1 * 1.04 * k)
		_streak(p, q, rim_color, core_color, a, maxf(0.8, R * 0.02))
	if k < 0.98:
		for i in int(round(14.0 * amount)):
			var th := P.next() * TAU
			var hgt := R * (0.05 + 0.2 * P.next())
			var sz := R * 0.02 * (0.6 + P.next())
			var a := 1.0 - _smooth(0.5, 1.0, t)
			if a <= 0.0:
				continue
			var path := func(q: float) -> Vector2:
				var rr := R * _ease_out(q / 1.3, 2.6) * 0.95
				return c + Vector2(cos(th) * rr * kx, sin(th) * rr * k - hgt * sin(PI * q))
			_comet(path, clampf(t * 1.3, 0.0, 1.0), 0.2, maxf(0.7, sz), 0.85 * a, splat_color, core_color)


# 蓄力：沿螺旋汇聚的彗星，脉动的能量球，绕着转的光弧；不循环时最后爆开
func _k_charge() -> void:
	var t := _t
	var R := _R
	var c := Vector2(_cx, _cy)
	var P := Rand.new(random_seed * 31 + 8)
	var power := 1.0 if loop else 0.25 + 0.75 * _ease_in(t / 0.82, 1.4)
	var burst := 0.0 if loop else _smooth(0.8, 0.9, t)
	var gone := 1.0 if loop else 1.0 - _smooth(0.88, 1.0, t)
	_add = true
	for k in int(round(26.0 * amount)):
		var th0 := P.next() * TAU
		var ph := P.next()
		var sp := 1.0 + floorf(P.next() * 2.0)
		var r0 := R * (0.7 + 0.45 * P.next())
		var wid := 0.6 + 0.8 * P.next()
		var p := fposmod(ph + t * sp, 1.0)
		var a := _smooth(0.0, 0.2, p) * (1.0 - _smooth(0.85, 1.0, p)) * (1.0 - burst)
		if a <= 0.01:
			continue
		var pts := PackedVector2Array()
		for i in 11:
			var q := maxf(0.0, p - 0.22 * (1.0 - i / 10.0))
			var d := R * 0.14 + (r0 - R * 0.14) * (1.0 - _ease_in(q, 1.7))
			var th := th0 + q * 2.2
			pts.append(c + Vector2(cos(th), sin(th)) * d)
		_trail(pts, maxf(0.7, R * 0.022 * wid), a, true, rim_color, core_color)
	var pulse := 1.0 + 0.1 * sin(TAU * t * 2.0)
	var rr := R * 0.24 * pulse * power * gone
	_blob(c, rr * 2.4, [[0.0, rim_color, 0.45 * gone], [1.0, rim_color, 0.0]])
	_blob(c, rr, [[0.0, core_color, 1.0], [0.45, core_color, 0.95], [0.75, rim_color, 0.8], [1.0, colors[mini(2, colors.size() - 1)], 0.0]])
	for k in 3:
		var a0 := TAU * t * (-1.0 if k % 2 == 1 else 1.0) + k * TAU / 3.0
		var arx := rr * (1.35 + 0.2 * k)
		var ary := arx * (0.45 + 0.2 * k)
		var tilt := k * 1.05
		var pts := PackedVector2Array()
		for i in 25:
			var th := a0 + 1.9 * i / 24.0
			pts.append(c + Vector2(cos(th) * arx, sin(th) * ary).rotated(tilt))
		_trail(pts, maxf(0.8, R * 0.022), 0.9 * gone, false, rim_color, core_color)
	for k in int(round(4.0 * amount)):
		var th := P.next() * TAU
		var d := rr * (1.3 + 0.8 * P.next())
		var tw := 0.5 + 0.5 * sin(TAU * (t * 2.0 + P.next()))
		_star(c + Vector2(cos(th), sin(th)) * d, maxf(2.0, R * 0.06 * tw), rim_color, 0.9 * tw * gone, 0.0)
	if burst > 0.0:
		var bt := clampf((t - 0.8) / 0.2, 0.0, 1.0)
		_blob(c, R * (0.4 + 0.6 * _ease_out(bt, 2.0)), [[0.0, core_color, 1.0 - bt], [0.4, rim_color, 0.7 * (1.0 - bt)], [1.0, rim_color, 0.0]])
		_ring(c, R * (0.3 + 0.8 * _ease_out(bt, 2.0)), R * 0.06 + 0.6, 1.0, rim_color, 0.9 * (1.0 - bt), 1.0)


# 治疗光圈：地面上的光圈和柔光、升起的光柱、盘旋上升的光带、十字光点和上飘的光点
func _k_heal() -> void:
	var t := _t
	var R := _R
	var k := squash
	var cx := _cx
	var gy := _gy
	var env := 1.0 if loop else _smooth(0.0, 0.15, t) * (1.0 - _smooth(0.75, 1.0, t))
	var pulse := 0.85 + 0.15 * sin(TAU * t * 2.0)
	_add = true
	_gmul = env
	var H := R * 1.7
	var g := Vector2(cx, gy)
	if soft_light:
		# 一道柔和的光柱，从地面下面淡入
		var foot := R * k * 0.7
		var vstops := [[0.0, Color(rim_color, 0.0)], [foot / (H + foot), Color(rim_color, 0.4 * pulse)], [0.55, Color(colors[mini(2, colors.size() - 1)], 0.14 * pulse)], [1.0, Color(colors[mini(2, colors.size() - 1)], 0.0)]]
		_column(cx - R, gy - H, R * 2.0, H + foot, vstops, [0.0, 0.7, 1.0, 0.7, 0.0])
	if soft_light:
		_blob(g, R * 1.05, [[0.0, core_color, 0.22 * pulse], [0.5, rim_color, 0.14 * pulse], [0.85, rim_color, 0.2], [1.0, rim_color, 0.0]], Vector2(1.0, k))
	else:
		_blob(g, R, [[0.0, rim_color, 0.5 * pulse], [0.8, rim_color, 0.3], [1.0, rim_color, 0.0]], Vector2(1.0, k))
	_ring(g, R * 0.95, R * 0.2, k, rim_color, 0.35, 1.0)
	_ring(g, R * 0.95, R * 0.07, k, rim_color, 0.7, 1.0)
	_ring(g, R * 0.95, R * 0.025 + 0.6, k, core_color, 1.0, 1.0)
	var br := fposmod(t * (1.0 if loop else 1.5), 1.0)
	_ring(g, R * (0.35 + 0.6 * br), R * 0.03 + 0.5, k, core_color, 0.6 * (1.0 - br), 1.0)
	# 从光圈升起的光柱，各自明暗
	var Q := Rand.new(random_seed * 47 + 12)
	var rays := int(round(16.0 * maxf(0.4, amount)))
	var beams := []
	for i in rays:
		var u := (i + 0.5) / rays * 2.0 - 1.0 + (Q.next() - 0.5) * 0.12
		var ph := Q.next()
		var ln := H * (0.35 + 0.6 * Q.next())
		var sd := Q.next() * 2.0 - 1.0
		var x := cx + u * R * 0.9
		var y := gy + sqrt(maxf(0.0, 1.0 - u * u)) * R * k * 0.9 * sd
		var a := (0.2 + 0.7 * pow(sin(PI * fposmod(ph + t * (1.0 + (i % 2)), 1.0)), 2.0)) * (0.75 + 0.25 * (1.0 - absf(u)))
		beams.append([x, y, ln, maxf(0.7, R * (0.012 + 0.022 * Q.next())), a])
	for b in beams:
		_beam(b[0], b[1] + b[3], b[1] - b[2], b[3], b[4])
	# 绕着光柱盘旋上升的光带
	var turns := maxi(1, int(round(2.0 * amount)))
	for j in turns:
		var p := fposmod(t * (1.0 if loop else 1.2) + float(j) / turns, 1.0)
		var rr := R * (0.95 - 0.3 * p)
		var yy := gy - H * 0.5 * _ease_in(p, 1.3)
		_swirl(cx, yy, rr, rr * k, TAU * (p * 1.5 + j * 0.37), 0.9 * sin(PI * p), maxf(0.8, R * 0.025))
	# 十字光点和带拖尾上飘的光点
	var P := Rand.new(random_seed * 43 + 10)
	for i in int(round(14.0 * amount)):
		var x := cx + (P.next() * 2.0 - 1.0) * R * 0.85
		var y0 := gy + (P.next() * 2.0 - 1.0) * R * k * 0.6
		var ph := P.next()
		var sp := 1.0 + floorf(P.next() * 2.0)
		var plus := P.next() < 0.45
		var p := fposmod(ph + t * sp, 1.0)
		var a := sin(PI * p)
		var sw := ph * TAU
		var path := func(q: float) -> Vector2:
			return Vector2(x + R * 0.07 * sin(TAU * q * 1.2 + sw), y0 - R * 1.5 * q)
		var at: Vector2 = path.call(p)
		var s := R * (0.07 if plus else 0.035) * (0.7 + 0.3 * a)
		if plus:
			var th := maxf(1.0, s * 0.38)
			_blob(at, s * 2.4, [[0.0, rim_color, 0.5 * a], [1.0, rim_color, 0.0]])
			if _ok():
				_tri_rect(Rect2(at.x - s, at.y - th / 2.0, s * 2.0, th), _col(core_color, a))
				_tri_rect(Rect2(at.x - th / 2.0, at.y - s, th, s * 2.0), _col(core_color, a))
		else:
			_comet(path, p, 0.25, maxf(0.7, s * 0.55) * (1.0 if soft_light else 1.8), a, rim_color, core_color)
	_gmul = 1.0


# 流光：几条起伏扭转的光带横穿画幅，每条是一束细丝，边缘更亮、两端渐隐；闪烁的光尘和沿光带跑的火花
func _k_ribbon() -> void:
	var t := _t
	var P := Rand.new(random_seed * 89 + 5)
	var env := 1.0 if loop else _smooth(0.0, 0.2, t) * (1.0 - _smooth(0.65, 1.05, t))
	var xa := _cx - _rx
	var xb := xa + 2.0 * _rx * (1.0 if loop else _ease_out(t / 0.55, 2.0))
	var n_r := maxi(1, int(round(3.0 * maxf(0.34, amount))))
	var strands := 12 if soft_light else 4
	var M := 72
	var lw := maxf(0.6, _R * 0.007)
	# 只用饱和的颜色：白色来自光带交叠的地方
	var tones := []
	for q in Array(colors) + [rim_color, splat_color]:
		var lm: float = (0.299 * q.r + 0.587 * q.g + 0.114 * q.b) * 255.0
		if lm > 40.0 and lm < 215.0:
			tones.append(q)
	if tones.is_empty():
		tones.append(rim_color)
	var bands := []
	_add = true
	for r in n_r:
		var f1 := (0.7 + 0.7 * P.next()) * PI / _rx
		var f2 := (1.6 + 1.4 * P.next()) * PI / _rx
		var ft := (0.6 + 0.8 * P.next()) * PI / _rx
		var p1 := P.next() * TAU
		var p2 := P.next() * TAU
		var pt := P.next() * TAU
		var d1 := -1.0 if P.next() < 0.5 else 1.0
		var d2 := 1.0 + floorf(P.next() * 2.0)
		var A1 := _ry * (0.22 + 0.3 * P.next())
		var A2 := _ry * (0.06 + 0.1 * P.next())
		var W := _ry * (0.1 + 0.16 * P.next())
		var off := (P.next() - 0.5) * _ry * 0.5
		var ca: Color = tones[int(floor(P.next() * tones.size()))]
		var cb: Color = tones[int(floor(P.next() * tones.size()))]
		var band := [f1, f2, ft, p1, p2, pt, d1, d2, A1, A2, W, off]
		bands.append(band)
		if soft_light:
			for kk in [[2.6, 0.035], [1.4, 0.06]]:
				_ribbon_path(band, 0.0, xa, xb, M, ca, cb, kk[1] * env, W * kk[0])
		for j in strands:
			var v := 0.0
			if strands > 1:
				v = clampf((float(j) / (strands - 1) * 2.0 - 1.0) + (P.next() - 0.5) * 0.12, -1.0, 1.0)
			var e := pow(absf(v), 4.0)
			_ribbon_path(band, v, xa, xb, M, ca, cb, (0.1 + 0.65 * e if soft_light else 0.9) * env, lw * (0.6 + 0.8 * e))
	# 闪烁的光尘
	for i in int(round(36.0 * amount)):
		var band: Array = bands[int(floor(P.next() * bands.size()))]
		var x := xa + (xb - xa) * P.next()
		var y := _band_mid(band, x) + _band_wide(band, x) * (P.next() * 2.0 - 1.0) * 1.5 + (P.next() - 0.5) * _ry * 0.25
		var ph := P.next()
		var sp := 1.0 + floorf(P.next() * 3.0)
		var big := P.next()
		var a := pow(sin(PI * fposmod(ph + t * sp, 1.0)), 2.0) * env * _ribbon_edges(x)
		if big > 0.9 and soft_light:
			_star(Vector2(x, y), maxf(2.0, _R * 0.05), rim_color, a, 0.0)
		else:
			_blob(Vector2(x, y), maxf(1.0, _R * (0.01 + 0.015 * big)), [[0.0, core_color, a], [0.5, rim_color, 0.5 * a], [1.0, rim_color, 0.0]])
	# 沿光带从一头跑到另一头的火花
	for i in int(round(8.0 * amount)):
		var band: Array = bands[int(floor(P.next() * bands.size()))]
		var v := P.next() * 2.0 - 1.0
		var ph := P.next()
		var sp := 1.0 + floorf(P.next() * 2.0)
		var path := func(q: float) -> Vector2:
			var x := _cx - _rx + 2.0 * _rx * q
			return Vector2(x, _band_mid(band, x) + _band_wide(band, x) * v)
		var p := fposmod(ph + t * sp, 1.0)
		var hx: float = path.call(p).x
		if hx > xb:
			continue
		_comet(path, p, 0.12, maxf(0.7, _R * 0.016) * (1.0 if soft_light else 1.6), env * _ribbon_edges(hx), rim_color, core_color)


func _band_mid(b: Array, x: float) -> float:
	return _cy + b[11] + b[8] * sin(x * b[0] + b[3] + b[6] * TAU * _t) + b[9] * sin(x * b[1] + b[4] - b[7] * TAU * _t)


func _band_wide(b: Array, x: float) -> float:
	return b[10] * sin(x * b[2] + b[5] + TAU * _t)


func _ribbon_edges(x: float) -> float:
	return _smooth(0.0, 0.15, (x - (_cx - _rx)) / (2.0 * _rx)) * _smooth(0.0, 0.15, (_cx + _rx - x) / (2.0 * _rx))


# 光带的一条线：横向渐变（两端透明）
func _ribbon_path(b: Array, v: float, xa: float, xb: float, M: int, ca: Color, cb: Color, a: float, wd: float) -> void:
	if not _ok() or a <= 0.003:
		return
	var pts := PackedVector2Array()
	var cols := PackedColorArray()
	var mid := ca.lerp(cb, 0.5)
	for i in M + 1:
		var x := xa + (xb - xa) * i / M
		pts.append(Vector2(x, _band_mid(b, x) + _band_wide(b, x) * v))
		var u := (x - (_cx - _rx)) / (2.0 * _rx)
		var col: Color
		if u < 0.2:
			col = Color(ca, 0.0).lerp(Color(ca, a), u / 0.2)
		elif u < 0.5:
			col = Color(ca, a).lerp(Color(mid, a), (u - 0.2) / 0.3)
		elif u < 0.8:
			col = Color(mid, a).lerp(Color(cb, a), (u - 0.5) / 0.3)
		else:
			col = Color(cb, a).lerp(Color(cb, 0.0), clampf((u - 0.8) / 0.2, 0.0, 1.0))
		col.a *= _gmul
		cols.append(col)
	_line(pts, cols, wd)


# 翅膀：一对光做的翅膀（侧面是向后展开的近翼和远翼），翼骨、几十根发光的羽毛细丝、淡淡的光幕、飘落的光点
func _k_wings() -> void:
	var t := _t
	var R := _R
	var n := clampi(int(round(60.0 * sqrt(maxf(0.2, amount)))), 18, 110)
	var open := 1.0 if loop else _ease_out(t / 0.35, 2.0)
	var gone := 0.0 if loop else _smooth(0.62, 1.0, t)
	# 扇动：下扑快、上抬慢。u：+1 翅膀在上，−1 在下；vel：−1 正往下扑 … +1 正往上抬
	var cyc := t if loop else clampf(t / 0.62, 0.0, 1.0)
	var down := 0.42
	var amp := 1.0 if loop else 0.6
	var u := amp * (1.0 - 2.0 * _smooth(0.0, down, cyc) if cyc < down else -1.0 + 2.0 * _smooth(down, 1.0, cyc))
	var vel := amp * (-sin(PI * cyc / down) if cyc < down else sin(PI * (cyc - down) / (1.0 - down)))
	var P := Rand.new(random_seed * 97 + 11)
	var strands := []
	for i in n:
		strands.append([P.next(), P.next(), P.next(), P.next(), P.next()])
	_add = true
	if side_view:
		_wing(-1.0, Vector2(_cx + R * 0.45, _cy - R * 0.02), 0.8, 0.45, u, vel, open, gone, strands, P)
		var root := _wing(-1.0, Vector2(_cx + R * 0.38, _cy + R * 0.08), 1.05, 1.0, u, vel, open, gone, strands, P)
		_blob(root, R * 0.26, [[0.0, core_color, 0.6 * (1.0 - gone)], [0.35, rim_color, 0.3 * (1.0 - gone)], [1.0, rim_color, 0.0]])
	else:
		_wing(1.0, Vector2(_cx + R * 0.03, _cy + R * 0.1), 1.0, 1.0, u, vel, open, gone, strands, P)
		_wing(-1.0, Vector2(_cx - R * 0.03, _cy + R * 0.1), 1.0, 1.0, u, vel, open, gone, strands, P)
		_blob(Vector2(_cx, _cy + R * 0.1), R * 0.32, [[0.0, core_color, 0.75 * (1.0 - gone)], [0.3, rim_color, 0.35 * (1.0 - gone)], [1.0, rim_color, 0.0]])


# 一只翅膀：dir 1 向右展开，-1 向左；at 翼根；kk 大小；a 强度。返回翼根位置
func _wing(dir: float, at: Vector2, kk: float, a: float, u: float, vel: float, open: float, gone: float, strands: Array, P: Rand) -> Vector2:
	var t := _t
	var R := _R
	var M := 18
	var lw := maxf(0.6, R * 0.012) * (1.0 if soft_light else 1.8)
	var lower: Color = colors[mini(2, colors.size() - 1)]
	var S := (minf(_rx * 0.55, _ry * 0.58) * 0.9 if side_view else minf(_rx * 0.48, _ry * 0.72) * 0.82) * kk * (0.35 + 0.65 * open) * (1.0 - (0.25 if side_view else 0.12) * maxf(0.0, vel))
	var psi := -0.15 - 0.85 * u if side_view else -0.5 * u
	var fx := 1.0 if side_view else 1.0 - 0.42 * maxf(0.0, u)
	var cs := cos(psi)
	var sn := sin(psi)
	var place := func(x: float, y: float) -> Vector2:
		return at + Vector2(dir * fx * (x * cs - y * sn), x * sn + y * cs)
	var T := Vector2(S * 0.95, -S * 0.38)
	var C := Vector2(S * 0.38, -S * 0.55)
	var arm := func(s: float) -> Vector2:
		var r := 1.0 - s
		return C * 2.0 * r * s + T * s * s
	var feather := func(s: float, j1: float, j2: float, ph: float, sp: float) -> PackedVector2Array:
		var p0: Vector2 = arm.call(s)
		var phi := 0.95 + (-0.25 - 0.95) * pow(s, 0.9) + (j1 - 0.5) * 0.14
		var ln := S * (0.5 + 0.55 * pow(s, 0.7)) * (0.75 + 0.5 * j2)
		var bend := 0.1 + 0.25 * (1.0 - s)
		var pts := PackedVector2Array()
		var x := p0.x
		var y := p0.y
		for i in M + 1:
			var e := float(i) / M
			var wave := S * 0.02 * sin(TAU * t * sp + ph + e * 4.0) * e
			var lag := S * (0.2 if side_view else 0.15) * vel * e * e * (0.3 + (1.0 - s))
			pts.append(place.call(x, y + wave + lag))
			var ang := phi + bend * e
			x += cos(ang) * ln / M
			y += sin(ang) * ln / M
		return pts
	var bone := PackedVector2Array()
	for i in M + 1:
		var q: Vector2 = arm.call(float(i) / M)
		bone.append(place.call(q.x, q.y))
	# 光幕：翼骨到羽尖之间的一片淡光（编辑器里是模糊过的）
	if soft_light and _ok():
		var poly := PackedVector2Array(bone)
		for i in range(12, -1, -1):
			var fp: PackedVector2Array = feather.call(i / 12.0, 0.5, 0.5, 0.0, 0.0)
			poly.append(fp[M - 3])
		var center: Vector2 = place.call(S * 0.3, 0.0)
		var cols := PackedColorArray()
		for p in poly:
			var d := clampf(p.distance_to(center) / (S * 1.3), 0.0, 1.0)
			var col := Color(core_color, 0.26 * a).lerp(Color(rim_color, 0.14 * a), d / 0.4) if d < 0.4 else Color(rim_color, 0.14 * a).lerp(Color(lower, 0.0), (d - 0.4) / 0.6)
			col.a *= (1.0 - gone) * 0.75 * _gmul
			cols.append(col)
		var idx := Geometry2D.triangulate_polygon(poly)
		if not idx.is_empty():
			_tri(idx, poly, cols)
	# 羽毛：一缕缕发光的细丝，消散时从翼骨往外散开
	var from := int(floor(gone * (M - 2)))
	var tips := []
	for st in strands:
		var s := pow(st[0], 0.85)
		var pts: PackedVector2Array = feather.call(s, st[1], st[2], st[4] * TAU, 1.0 + floorf(st[3] * 2.0))
		tips.append([pts[M], s])
		_trail(pts.slice(from), lw * (0.9 + 0.7 * s) * (0.7 + 0.6 * st[2]), a * (0.42 + 0.3 * s) * (1.0 - 0.7 * gone), false, rim_color.lerp(lower, minf(1.0, (1.0 - s) * 0.8)), core_color)
	# 翼骨：最亮的前缘
	_trail(bone.slice(from), lw * 2.4, a * (1.0 - 0.6 * gone), false, rim_color, core_color)
	# 挂在翅膀上、从羽尖飘落的光点
	for m in int(round(26.0 * amount * (1.0 + 2.0 * gone))):
		var tp: Array = tips[int(floor(P.next() * tips.size()))]
		var tip: Vector2 = tp[0]
		var s: float = tp[1]
		var back := P.next()
		var out := 0.4 + P.next()
		var drop := P.next()
		var r := P.next()
		var ph := P.next()
		var sp := 1.0 + floorf(P.next() * 2.0)
		var p := fposmod(ph + t * sp, 1.0)
		var tw := sin(PI * p)
		var path := func(q: float) -> Vector2:
			return tip + Vector2(dir * R * 0.2 * (q * out - back * 0.6), R * (0.3 * q * q * (1.3 - s) - 0.15 * back * drop))
		if r < 0.25 and soft_light:
			_star(path.call(p), maxf(1.5, R * 0.03), rim_color, a * tw, 0.0)
		else:
			_comet(path, p, 0.3, maxf(0.6, R * (0.006 + 0.008 * r)) * (1.0 if soft_light else 1.8), a * tw, rim_color, core_color)
	return place.call(0.0, 0.0)


# 魔法阵：圆环、符文、刻度、星形 / 太极八卦，流转的高光，上飘的光点，火焰边缘
func _k_circle() -> void:
	var t := _t
	var R := _R
	var reveal := 1.0 if loop else _ease_out(t / 0.35, 2.0)
	var env := 1.0 if loop else 1.0 - _smooth(0.78, 1.0, t)
	var lw := maxf(0.8, R * 0.022)
	var kx := squash if side_view else 1.0
	var k := 1.0 if side_view else squash
	var o := Vector2(_cx, _cy if side_view else _gy)
	var taiji := pattern == 3
	var sym := 5 if pattern == 1 else 8 if pattern == 2 else 6
	var rot_out := 0.0 if taiji and loop else TAU / 6.0 * t * (1.0 if loop else 0.75)
	var rot_in := -TAU / sym * t * (1.0 if loop else 1.5)
	var to := func(x: float, y: float, rot: float) -> Vector2:
		return o + Vector2((x * cos(rot) - y * sin(rot)) * kx, (x * sin(rot) + y * cos(rot)) * k)
	var poly := func(pts: Array, rot: float) -> PackedVector2Array:
		var out := PackedVector2Array()
		for p in pts:
			out.append(to.call(p.x, p.y, rot))
		return out
	var circ := func(r: float) -> PackedVector2Array:
		var n := maxi(8, int(ceil(120.0 * reveal)))
		var pts := []
		for i in n + 1:
			var a := -PI / 2.0 + TAU * reveal * i / n
			pts.append(Vector2(cos(a), sin(a)) * r)
		return poly.call(pts, 0.0)
	var P := Rand.new(random_seed * 37 + 9)
	# 线条：先画成一张（普通盖上去），再整体淡淡地模糊叠一层
	var lines := []
	lines.append([[circ.call(R * 0.98), circ.call(R * 0.9)], core_color, lw, 1.0])
	if taiji:
		var hl := R * 0.105
		var gap := hl * 0.32
		var bars := []
		for n in int(floor(8.0 * reveal + 1e-6)):
			var rot := rot_out + n * TAU / 8.0
			for kk in 3:
				var y := -R * (0.762 + 0.048 * kk)
				if TRIGRAMS[n][kk]:
					bars.append(poly.call([Vector2(-hl, y), Vector2(hl, y)], rot))
				else:
					bars.append(poly.call([Vector2(-hl, y), Vector2(-gap, y)], rot))
					bars.append(poly.call([Vector2(gap, y), Vector2(hl, y)], rot))
		lines.append([bars, core_color, lw * 1.05, 1.0])
		var oct := []
		for i in 9:
			var a := -PI / 2.0 + PI / 8.0 + i * TAU / 8.0
			oct.append(Vector2(cos(a), sin(a)) * R * 0.66)
		lines.append([[circ.call(R * 0.72), poly.call(oct, rot_out), circ.call(R * 0.5)], rim_color, lw, 1.0])
		var rt := R * 0.46
		var rot_t := -TAU * t * (1.0 if loop else 0.6)
		var ta := minf(1.0, reveal * 1.5)
		if ta > 0.01:
			var lit: Array = _arc(Vector2.ZERO, rt, -PI / 2.0, PI / 2.0, 40) + _arc(Vector2(0, rt / 2.0), rt / 2.0, PI / 2.0, -PI / 2.0, 40) + _arc(Vector2(0, -rt / 2.0), rt / 2.0, PI / 2.0, PI * 1.5, 40)
			var dot: PackedVector2Array = poly.call(_arc(Vector2(0, rt / 2.0), rt * 0.13, 0.0, TAU, 24), rot_t)
			_add = false
			for pl in [poly.call(lit, rot_t), dot]:
				_fill(pl, _col(core_color, 0.55 * ta * env))
			var s_curve: Array = _arc(Vector2(0, -rt / 2.0), rt / 2.0, -PI / 2.0, -PI * 1.5, 30) + _arc(Vector2(0, rt / 2.0), rt / 2.0, -PI / 2.0, PI / 2.0, 30)
			lines.append([[poly.call(_arc(Vector2.ZERO, rt, 0.0, TAU, 96), rot_t), poly.call(s_curve, rot_t), poly.call(_arc(Vector2(0, -rt / 2.0), rt * 0.13, 0.0, TAU, 24), rot_t), dot], core_color, lw, ta])
	else:
		var glyphs := []
		for g in 12:
			var strokes := []
			for s in 2 + int(P.next() * 3.0):
				strokes.append([P.next(), P.next(), P.next(), P.next()])
			glyphs.append(strokes)
		var band := R * 0.075 * 1.6
		var runes := []
		for n in int(floor(12.0 * reveal + 1e-6)):
			for st in glyphs[n % 2 if loop else n]:
				runes.append(poly.call([Vector2((st[0] - 0.5) * band, (st[1] - 0.5) * band - R * 0.82), Vector2((st[2] - 0.5) * band, (st[3] - 0.5) * band - R * 0.82)], rot_out + n * TAU / 12.0))
		lines.append([runes, rim_color, lw * 0.8, 1.0])
		var ticks := []
		var n := 0
		while n < 48.0 * reveal:
			ticks.append(poly.call([Vector2(0, -R * 0.72), Vector2(0, -R * (0.69 if n % 4 != 0 else 0.66))], rot_out + n * TAU / 48.0))
			n += 1
		lines.append([ticks, rim_color, lw * 0.7, 1.0])
		lines.append([[circ.call(R * 0.72), circ.call(R * 0.34)], rim_color, lw, 1.0])
		var r := R * 0.68
		var star := []
		var figs := [[5, 2, 0.0]] if pattern == 1 else [[4, 1, 0.0], [4, 1, PI / 4.0]] if pattern == 2 else [[3, 1, 0.0], [3, 1, PI / 3.0]]
		for f in figs:
			var pts := []
			for i in f[0] + 1:
				var a: float = f[2] + ((i * f[1]) % f[0]) * TAU / f[0] - PI / 2.0
				pts.append(Vector2(cos(a), sin(a)) * r)
			star.append(poly.call(pts, rot_in))
		lines.append([star, rim_color, lw, _smooth(0.2, 0.9, reveal)])
		lines.append([[circ.call(R * 0.12)], core_color, lw, 1.0])
	_add = false
	if _ok():
		var glow_a := minf(1.0, env * (0.9 if soft_light else 0.35) * glow)
		var nrms := []
		for L in lines:
			var arr := []
			for pl in L[0]:
				arr.append(_normals(pl))
			nrms.append(arr)
		for ps in [[R * 0.12, 0.10], [R * 0.06, 0.16]]:
			for li in lines.size():
				var L: Array = lines[li]
				for pi in (L[0] as Array).size():
					_line_n(L[0][pi], nrms[li][pi], _col(rim_color, ps[1] * L[3] * glow_a), L[2] + ps[0])
		for li in lines.size():
			var L: Array = lines[li]
			for pi in (L[0] as Array).size():
				_line_n(L[0][pi], nrms[li][pi], _col(rim_color, 0.22 * L[3] * env), L[2] * 3.4)
		for li in lines.size():
			var L: Array = lines[li]
			for pi in (L[0] as Array).size():
				_line_n(L[0][pi], nrms[li][pi], _col(L[1], L[3] * env), L[2])
	# 光：地面上的一片光、流转的高光、上飘的光点
	_add = true
	if soft_light:
		_blob(o, R, [[0.0, rim_color, 0.12 * env * reveal], [0.85, rim_color, 0.07 * env * reveal], [1.0, rim_color, 0.0]], Vector2(kx, k))
		_ring(o, R * 0.94, R * 0.05, k, rim_color, 0.18 * env * reveal, kx)
	var lit_a := env * _smooth(0.6, 1.0, reveal)
	for spec in [[R * 0.94, 1.0, 1.0], [R * 0.72, -1.0, 1.0], [R * (0.5 if taiji else 0.34), 1.0, 2.0]]:
		for j in 2:
			var head: float = -PI / 2.0 + spec[1] * (TAU * spec[2] * t + j * PI)
			var pts := PackedVector2Array()
			for i in 25:
				var a: float = head - spec[1] * 1.3 * (1.0 - i / 24.0)
				pts.append(to.call(cos(a) * spec[0], sin(a) * spec[0], 0.0))
			_trail(pts, lw * 1.3, lit_a, true, rim_color, core_color)
	for i in int(round(14.0 * amount)):
		var th := P.next() * TAU
		var rr := sqrt(P.next()) * R * 0.9
		var ph := P.next()
		var sp := 1.0 + floorf(P.next() * 2.0)
		var p := fposmod(ph + t * sp, 1.0)
		var a := sin(PI * p) * env * reveal
		var path := func(q: float) -> Vector2:
			return o + Vector2(cos(th) * rr * kx + R * 0.06 * sin(TAU * q * 1.5 + th), sin(th) * rr * k - R * 0.9 * q)
		_comet(path, p, 0.22, maxf(0.6, R * 0.014) * (1.0 if soft_light else 1.8), a, rim_color, core_color)
	if edge_effect == 1:
		_fire_edge(o, R, kx, k, env * reveal)


# 火焰边缘：外圈立着的火舌，各自摇摆、闪烁；火星往上飘
func _fire_edge(o: Vector2, R: float, kx: float, k: float, a: float) -> void:
	if a <= 0.01:
		return
	var t := _t
	var amt := maxf(0.2, amount)
	var P := Rand.new(random_seed * 131 + 17)
	var flame: Color = colors[1] if colors.size() > 1 else rim_color
	var n := int(round(24.0 * amt))
	for i in n:
		var th := (i + P.next() * 0.6) / n * TAU
		var j := P.next()
		var ph := P.next()
		var sp := 1.0 + floorf(P.next() * 3.0)
		var ph2 := P.next()
		var b := o + Vector2(cos(th) * R * 0.97 * kx, sin(th) * R * 0.97 * k)
		var fl := 0.7 + 0.3 * sin(TAU * (t * sp + ph))
		var sway := R * 0.05 * sin(TAU * (t * (1.0 + fmod(sp, 2.0)) + ph2))
		_tongue(b, R * (0.055 + 0.05 * j), R * (0.22 + 0.3 * j) * fl, sway, a * (0.6 + 0.4 * fl), flame)
	for i in int(round(14.0 * amt)):
		var th := P.next() * TAU
		var ph := P.next()
		var sp := 1.0 + floorf(P.next() * 2.0)
		var sw := P.next() * TAU
		var b := o + Vector2(cos(th) * R * 0.97 * kx, sin(th) * R * 0.97 * k)
		var p := fposmod(ph + t * sp, 1.0)
		var path := func(q: float) -> Vector2:
			return b + Vector2(R * 0.08 * sin(sw + q * TAU), -R * (0.1 + 0.7 * q))
		_comet(path, p, 0.15, maxf(0.6, R * 0.012) * (1.0 if soft_light else 1.7), a * sin(PI * p), rim_color, core_color)


func _tongue(base: Vector2, wb: float, h: float, sway: float, a: float, flame: Color) -> void:
	if not _ok() or a <= 0.01 or h <= 1.0:
		return
	for L in [[1.0, 1.0, rim_color, flame, 0.75], [0.45, 0.6, core_color, rim_color, 1.0]]:
		var w: float = wb * L[0]
		var H: float = h * L[1]
		var tip := base + Vector2(sway * L[1], -H)
		var p0 := base + Vector2(-w, 0)
		var c1 := base + Vector2(-w * 0.5 + sway * 0.25, -H * 0.6)
		var c2 := base + Vector2(w * 0.6 + sway * 0.5, -H * 0.45)
		var p1 := base + Vector2(w, 0)
		var pts := PackedVector2Array()
		for i in 9:
			pts.append(_quad(p0, c1, tip, i / 8.0))
		for i in range(1, 9):
			pts.append(_quad(tip, c2, p1, i / 8.0))
		var axis := tip - base
		var len2 := maxf(axis.length_squared(), 1e-6)
		var cols := PackedColorArray()
		for p in pts:
			var u := clampf((p - base).dot(axis) / len2, 0.0, 1.0)
			var col := Color(L[2], a * L[4]).lerp(Color(L[3], a * L[4] * 0.6), u / 0.55) if u < 0.55 else Color(L[3], a * L[4] * 0.6).lerp(Color(L[3], 0.0), (u - 0.55) / 0.45)
			col.a *= _gmul
			cols.append(col)
		var idx := Geometry2D.triangulate_polygon(pts)
		if not idx.is_empty():
			_tri(idx, pts, cols)


# ---------- 噪声画出来的特效：环绕光、燃烧、爆炸、烟尘（形状在 FIELD_SHADER 里逐像素算） ----------

# 这一帧噪声层要画什么：设好 shader 参数，画一块覆盖范围的四边形（UV = 画幅像素坐标）
func _field_pass() -> void:
	var m := _cv.material as ShaderMaterial
	if m == null:
		return
	var mix_pass := _role == 2
	var t := _t
	var R := _R
	m.set_shader_parameter("t", t)
	m.set_shader_parameter("loop_on", loop)
	m.set_shader_parameter("seed", random_seed)
	m.set_shader_parameter("gmul", 1.0)
	m.set_shader_parameter("dark", not additive)
	match kind:
		7:  # 环绕光
			if mix_pass:
				return
			var L := _aura_layout()
			m.set_shader_parameter("mode", 0)
			m.set_shader_parameter("cx", L.cx)
			m.set_shader_parameter("cy", L.cy)
			m.set_shader_parameter("rx", L.rx)
			m.set_shader_parameter("ry", L.ry)
			m.set_shader_parameter("k", 4.5 / maxf(6.0, L.rx))
			_field_quad(L.cx - L.rx * 1.4, L.cy - L.ry * 1.75, L.cx + L.rx * 1.4, L.cy + L.ry * 1.2)
		8:  # 燃烧（发光的配色叠加；深色配色普通盖上去）
			if mix_pass == additive:
				return
			var L := _burn_layout()
			m.set_shader_parameter("mode", 1)
			m.set_shader_parameter("cx", L.cx)
			m.set_shader_parameter("cy", L.by)
			m.set_shader_parameter("rx", L.rx)
			m.set_shader_parameter("ry", L.ry)
			m.set_shader_parameter("k", 4.5 / maxf(6.0, L.rx))
			_field_quad(L.cx - L.rx * 1.5, L.by - L.ry * 2.3, L.cx + L.rx * 1.5, L.by + 1.0)
		9:  # 爆炸
			var e := _ease_out(t / 0.42, 2.2)
			var rise := R * 0.32 * _ease_in(t, 1.5)
			m.set_shader_parameter("cx", _cx)
			m.set_shader_parameter("k", 1.6 / R)
			if not additive:
				if mix_pass:
					_explosion_ink(m)
				return
			if mix_pass:
				var rs := R * (0.24 + 0.42 * e + 0.12 * t)
				var sy := _cy - rise * 0.9
				var smoke_a := _smooth(0.12, 0.5, t) * (1.0 - _smooth(0.55, 1.05, t))
				if smoke_a <= 0.01:
					return
				m.set_shader_parameter("mode", 2)
				m.set_shader_parameter("rs", rs)
				m.set_shader_parameter("cy", sy)
				m.set_shader_parameter("amt", smoke_a)
				_field_quad(_cx - rs * 1.6, sy - rs * 1.6, _cx + rs * 1.6, sy + rs * 1.5)
			else:
				var rb := R * (0.16 + 0.66 * e)
				var fy := _cy - rise * 0.5
				var cool := 1.0 - _smooth(0.1, 0.72, t)
				var flash := 0.5 * (1.0 - _smooth(0.0, 0.16, t))
				if cool + flash <= 0.02:
					return
				m.set_shader_parameter("mode", 3)
				m.set_shader_parameter("rs", rb)
				m.set_shader_parameter("cy", fy)
				m.set_shader_parameter("cool", cool)
				m.set_shader_parameter("flash", flash)
				_field_quad(_cx - rb * 1.7, fy - rb * 1.7, _cx + rb * 1.7, fy + rb * 1.7)
		10:  # 烟尘
			if not mix_pass:
				return
			var P := Rand.new(random_seed * 29 + 6)
			var K := int(round(8.0 + 8.0 * amount))
			var blobs := []
			for k in K:
				var side := 1.0 if k % 2 == 1 else -1.0
				var reach := 0.2 + 0.75 * P.next()
				var s := 0.16 + 0.16 * P.next()
				var up := P.next()
				var e := _ease_out(t / (0.55 + 0.4 * P.next()), 2.2)
				var r := R * s * (0.5 + 1.0 * e)
				blobs.append(Vector4(_cx + side * R * reach * e, _gy - r * 0.5 - R * 0.35 * up * e * (0.3 + squash), r, 0.0))
			_volume(m, blobs, maxf(3.0, R * 0.12), Vector2(t * R * 0.15, t * R * 0.25), 0.5 if soft_light else 0.6, 0.75 if soft_light else 0.55, 0.0, 0.25 + 0.4 * _smooth(0.25, 1.0, t), 0.9 * (1.0 - 0.8 * _smooth(0.4, 1.05, t)), 0)


# 黑炎这类深色配色的爆炸：翻滚的墨团（一团团噪声），普通盖上去
func _explosion_ink(m: ShaderMaterial) -> void:
	var t := _t
	var R := _R
	var P := Rand.new(random_seed * 19 + 2)
	var K := int(round(10.0 + 6.0 * amount))
	var e := _ease_out(t / 0.55, 2.5)
	var rise := R * 0.4 * _ease_in(t, 1.6)
	var blobs := []
	for k in K:
		var th := P.next() * TAU
		var d0 := pow(P.next(), 0.7)
		var s := 0.32 + 0.3 * P.next()
		var late := P.next()
		blobs.append(Vector4(_cx + cos(th) * R * 0.55 * d0 * e, _cy + sin(th) * R * 0.42 * d0 * e - rise * (0.6 + 0.8 * late), R * s * (0.3 + 0.7 * e) * (1.0 + 0.3 * t), (1.05 - d0 * 0.45) * pow(1.0 - _smooth(0.0, 0.8, t), 0.9) + (0.4 if t < 0.12 else 0.0)))
	_volume(m, blobs, maxf(4.0, R * 0.16), Vector2(0.0, t * R * 0.6), 0.65 if soft_light else 0.8, 0.42 if soft_light else 0.3, 1.35, 0.3 + 0.5 * _smooth(0.35, 1.0, t), 1.0 - 0.85 * _smooth(0.45, 1.05, t), 1)


# 一团团噪声组成的体积（烟尘、墨团）：blobs = Vector4(x, y, 半径, 热度)
func _volume(m: ShaderMaterial, blobs: Array, cell: float, drift: Vector2, rough: float, soft: float, heat: float, thr: float, fade: float, color_mode: int) -> void:
	if blobs.is_empty():
		return
	var lo := Vector2(_w, _h)
	var hi := Vector2.ZERO
	for b in blobs:
		lo = lo.min(Vector2(b.x - b.z, b.y - b.z))
		hi = hi.max(Vector2(b.x + b.z, b.y + b.z))
	while blobs.size() < 48:
		blobs.append(Vector4(0, 0, 0, 0))
	m.set_shader_parameter("mode", 4)
	m.set_shader_parameter("nb", mini(48, blobs.size()))
	m.set_shader_parameter("blobs", PackedVector4Array(blobs.slice(0, 48)))
	m.set_shader_parameter("cell", cell)
	m.set_shader_parameter("drift", drift)
	m.set_shader_parameter("rough", rough)
	m.set_shader_parameter("soft", soft)
	m.set_shader_parameter("vheat", heat)
	m.set_shader_parameter("thr", thr)
	m.set_shader_parameter("fade", fade)
	m.set_shader_parameter("vcolor", color_mode)
	_field_quad(lo.x, lo.y, hi.x, hi.y)


func _field_quad(x0: float, y0: float, x1: float, y1: float) -> void:
	x0 = maxf(0.0, floorf(x0))
	y0 = maxf(0.0, floorf(y0))
	x1 = minf(_w, ceilf(x1))
	y1 = minf(_h, ceilf(y1))
	if x1 <= x0 or y1 <= y0:
		return
	var pts := PackedVector2Array([Vector2(x0, y0), Vector2(x1, y0), Vector2(x1, y1), Vector2(x0, y1)])
	RenderingServer.canvas_item_add_triangle_array(_cv.get_canvas_item(), PackedInt32Array([0, 1, 2, 0, 2, 3]), pts, _fill_cols(4, Color(1, 1, 1, _gmul)), pts)


# 环绕光的位置：火焰尖、光束、火花到中心以上 1.77 ry，底部到中心以下 1.22 ry，两侧 1.15 rx，全部在画幅里
func _aura_layout() -> Dictionary:
	var Hs := _h * size
	var ry := Hs / 3.0
	return {"rx": (_w * size) / 2.3, "ry": ry, "cx": _w / 2.0, "cy": (_h - Hs) / 2.0 + 1.77 * ry}


# 燃烧的位置：火焰离底边 2.31 ry 高、两侧 1.22 rx 宽，全部在画幅里
func _burn_layout() -> Dictionary:
	var Hs := _h * size
	var rx := (_w * size) / 2.5
	var ry := Hs / 2.4
	return {"rx": rx, "ry": ry, "cx": _w / 2.0, "by": (_h + Hs) / 2.0 - 0.06 * ry}


# 环绕光（斗气）：噪声画的光焰之外，往上射的光束、往上窜的火花，可加闪电
func _k_aura() -> void:
	var t := _t
	var L := _aura_layout()
	var rx: float = L.rx
	var ry: float = L.ry
	var cx: float = L.cx
	var cy: float = L.cy
	_add = true
	var P := Rand.new(random_seed * 59 + 2)
	for k in int(round(10.0 * amount)):
		var ux := P.next() * 2.0 - 1.0
		var ph := P.next()
		var sp := 1.0 + floorf(P.next() * 2.0)
		var ln := ry * (0.3 + 0.4 * P.next())
		var p := fposmod(ph + t * sp, 1.0) if loop else fposmod(ph + t * sp * 1.5, 1.0)
		var x := cx + ux * rx * 0.8 * sqrt(1.0 - p * 0.5)
		var yb := cy + ry * (0.9 - 2.3 * p)
		_beam(x, yb + ln, yb, maxf(0.8, rx * 0.018), sin(PI * p) * 0.9)
	for k in int(round(10.0 * amount)):
		var ux := P.next() * 2.0 - 1.0
		var ph := P.next()
		var sp := 1.0 + floorf(P.next() * 2.0)
		var big := P.next()
		var p := fposmod(ph + t * sp, 1.0)
		var path := func(q: float) -> Vector2:
			return Vector2(cx + ux * rx * (0.9 + 0.35 * q * q), cy - ry * (0.3 + 1.2 * q))
		_comet(path, p, 0.2, maxf(0.7, rx * (0.012 + 0.016 * big)) * (1.0 if soft_light else 1.6), sin(PI * p), rim_color, core_color)
	if bolts:
		var fi := clampi(int(floor(t * frames)), 0, frames - 1)
		var B := Rand.new(random_seed * 61 + fi * 7919)
		for k in 2:
			if B.next() < 0.25:
				continue
			var th := B.next() * TAU
			var r := 0.75 + 0.2 * B.next()
			var pts := []
			for j in 7:
				pts.append(Vector2(cx + cos(th) * rx * r, cy + sin(th) * ry * r))
				th += 0.18 + 0.12 * B.next()
				r = clampf(r + (B.next() - 0.5) * 0.35, 0.5, 1.05)
			var main := _jag(pts, B, rx * 0.05)
			_bolt(main, maxf(0.8, rx * 0.018), 1.0)
			for f in 2:
				if B.next() < 0.4:
					continue
				var at0: Vector2 = main[int(floor(B.next() * (main.size() - 2)))]
				var ang := B.next() * TAU
				var ln := rx * (0.15 + 0.2 * B.next())
				_bolt(_jag([at0, at0 + Vector2(cos(ang), sin(ang)) * ln], B, rx * 0.04), maxf(0.6, rx * 0.01), 0.7)


func _bolt(pts: PackedVector2Array, wd: float, a: float) -> void:
	for ps in [[wd * 6.0, rim_color, 0.12], [wd * 2.8, rim_color, 0.4], [wd, core_color, 1.0]]:
		_line(pts, PackedColorArray([_col(ps[1], a * ps[2])]), ps[0])


# 燃烧：噪声画的火焰之外，上飘、摇摆、烧尽的火星
func _k_burn() -> void:
	var t := _t
	var L := _burn_layout()
	var rx: float = L.rx
	var ry: float = L.ry
	var cx: float = L.cx
	var by: float = L.by
	_add = true
	var P := Rand.new(random_seed * 71 + 3)
	for k in int(round(18.0 * amount)):
		var ux := (P.next() * 2.0 - 1.0) * 0.9
		var ph := P.next()
		var sp := 1.0 + floorf(P.next() * 2.0)
		var sw := P.next() * TAU
		var big := P.next()
		var p := fposmod(ph + t * sp, 1.0)
		var path := func(q: float) -> Vector2:
			return Vector2(cx + ux * rx * (1.0 + 0.4 * q) + sin(sw + q * TAU) * rx * 0.12, by - ry * (0.3 + 2.0 * q))
		_comet(path, p, 0.14, maxf(0.8, rx * (0.012 + 0.018 * big)) * (1.0 if soft_light else 1.6), sin(PI * p) * (1.0 - p * 0.4), rim_color, core_color)


# 爆炸：噪声画的火球和烟之外，闪光、冲击环、甩出去的火花
func _k_explosion() -> void:
	var t := _t
	var R := _R
	var c := Vector2(_cx, _cy)
	_add = true
	var fl := 1.0 - _smooth(0.0, 0.18, t)
	if additive:
		_blob(c, R * 0.7, [[0.0, core_color, fl], [0.35, rim_color, 0.6 * fl], [1.0, rim_color, 0.0]])
		var sr := R * (0.3 + 0.95 * _ease_out(t / 0.45, 2.0))
		var sa := 1.0 - _smooth(0.0, 0.5, t)
		_ring(c, sr, R * 0.12 * (1.0 - t) + 1.0, 1.0, rim_color, 0.25 * sa, 1.0)
		_ring(c, sr, R * 0.03 + 0.6, 1.0, core_color, 0.5 * sa, 1.0)
		_sparks(c, int(round(22.0 * amount)), R * 1.1, 0.02, 7, 0.45)
	else:
		_blob(c, R * 0.6, [[0.0, core_color, fl], [0.4, rim_color, 0.6 * fl], [1.0, rim_color, 0.0]])
		_ring(c, R * (0.3 + 0.9 * _ease_out(t / 0.4, 2.0)), R * 0.04 + 0.6, 1.0, rim_color, 0.35 * (1.0 - _smooth(0.0, 0.4, t)), 1.0)
		_sparks(c, int(round(18.0 * amount)), R * 1.1, 0.03, 7, 0.45)


# 烟尘：噪声画的烟团之外，被甩出去的小石子（先画：烟会滚过它们）
func _k_dust() -> void:
	var t := _t
	var R := _R
	var cx := _cx
	var gy := _gy
	var P := Rand.new(random_seed * 29 + 6)
	# 和噪声层一样先取掉烟团用的随机数，后面的石子才对得上
	for k in int(round(8.0 + 8.0 * amount)):
		for j in 4:
			P.next()
	_add = false
	var c1: Color = colors[mini(1, colors.size() - 1)]
	var cl: Color = colors[colors.size() - 1]
	for k in int(round(8.0 * amount)):
		var side := -1.0 if P.next() < 0.5 else 1.0
		var sp := 0.6 + 0.5 * P.next()
		var lt := clampf(t / (0.45 + 0.3 * P.next()), 0.0, 1.0)
		if lt >= 1.0:
			continue
		var path := func(q: float) -> Vector2:
			return Vector2(cx + side * R * 1.05 * sp * q, gy - R * 0.45 * sp * sin(PI * q) * (0.4 + squash))
		var at: Vector2 = path.call(lt)
		var sz := maxf(1.0, round(R * 0.035))
		if soft_light:
			_comet(path, lt, 0.18, sz * 0.8, 0.45 * (1.0 - lt), c1, cl)
		if _ok():
			_tri_rect(Rect2(round(at.x), round(at.y), sz, sz), _col(c1, 1.0 - lt * 0.4))


# 由配色做出的渐变贴图：stops 从左到右均匀分布（和编辑器的 colorAcross 一样）
func _ramp_tex(stops: Array, from := 0.0, to := 1.0) -> GradientTexture1D:
	var g := Gradient.new()
	var offs := PackedFloat32Array()
	var cols := PackedColorArray()
	var n := 32
	for i in n + 1:
		var v := lerpf(from, to, float(i) / n)
		var tt := clampf(v, 0.0, 1.0) * (stops.size() - 1)
		var j := mini(stops.size() - 2, int(floor(tt)))
		offs.append(float(i) / n)
		cols.append((stops[j] as Color).lerp(stops[j + 1], tt - j))
	g.offsets = offs
	g.colors = cols
	var tex := GradientTexture1D.new()
	tex.gradient = g
	tex.width = 256
	return tex


func _setup_field(m: ShaderMaterial) -> void:
	var cols := Array(colors)
	var c0: Color = colors[0]
	var c1: Color = colors[mini(1, colors.size() - 1)]
	var smoke := c0.lerp(Color8(58, 56, 60), 0.75)
	m.set_shader_parameter("ramp_aura", _ramp_tex([c0, c1, rim_color, rim_color, core_color], 0.0, 0.999))
	m.set_shader_parameter("ramp_flame", _ramp_tex([c0] + cols + [core_color], 0.0, 0.999))
	m.set_shader_parameter("ramp_dust", _ramp_tex(cols, 0.3, 1.0))
	m.set_shader_parameter("ramp_fire", _ramp_tex([smoke] + cols + [core_color], 0.0, 0.999))
	m.set_shader_parameter("smoke_lo", smoke)
	m.set_shader_parameter("smoke_hi", smoke.lerp(Color8(176, 168, 160), 0.5))
	m.set_shader_parameter("fsmoke_hi", smoke.lerp(Color8(168, 162, 158), 0.55))


# ---------- 共用的画法（与编辑器 vfx/common.js 相同） ----------

# 这一笔该不该画在当前这一层
# 形状都画进对应的那一批（_add 决定是光层还是普通层）；噪声层只画噪声
func _ok() -> bool:
	return _role < 2


func _col(c: Color, a: float) -> Color:
	return Color(c, clampf(a, 0.0, 1.0) * _gmul)


# 一圈圈的径向渐变：stops = [[半径, 颜色], ...]（半径从小到大），scale 压扁
func _radial(c: Vector2, stops: Array, sc := Vector2.ONE) -> void:
	if not _ok() or stops.size() < 2:
		return
	var n := 40
	var pts := PackedVector2Array()
	var cols := PackedColorArray()
	var idx := PackedInt32Array()
	var rings := []  # 每一圈第一个顶点的序号；半径 0 时只有一个点
	for st in stops:
		var r: float = st[0]
		var col: Color = st[1]
		col.a *= _gmul
		rings.append([pts.size(), r <= 0.0001])
		if r <= 0.0001:
			pts.append(c)
			cols.append(col)
		else:
			for i in n:
				var th := TAU * i / n
				pts.append(c + Vector2(cos(th) * r * sc.x, sin(th) * r * sc.y))
				cols.append(col)
	for k in range(1, rings.size()):
		var a0: int = rings[k - 1][0]
		var a_pt: bool = rings[k - 1][1]
		var b0: int = rings[k][0]
		for i in n:
			var j := (i + 1) % n
			if a_pt:
				idx.append_array(PackedInt32Array([a0, b0 + i, b0 + j]))
			else:
				idx.append_array(PackedInt32Array([a0 + i, b0 + i, b0 + j, a0 + i, b0 + j, a0 + j]))
	_tri(idx, pts, cols)


# 柔和的圆形光：stops = [[位置 0..1, 颜色, 透明度], ...]
func _blob(c: Vector2, r: float, stops: Array, sc := Vector2.ONE) -> void:
	if r <= 0.3 or not _ok():
		return
	var rs := []
	for st in stops:
		rs.append([r * float(st[0]), Color(st[1], clampf(st[2], 0.0, 1.0))])
	_radial(c, rs, sc)


# 半径 r、半宽 wd 的柔和光环，竖向压扁 k（横向 kx）
func _ring(c: Vector2, r: float, wd: float, k: float, col: Color, a: float, kx := 1.0) -> void:
	if r <= 0.0 or a <= 0.005 or not _ok():
		return
	_radial(c, [[maxf(0.0, r - wd), Color(col, 0.0)], [r, Color(col, clampf(a, 0.0, 1.0))], [r + wd, Color(col, 0.0)]], Vector2(kx, k))


# 一道从 p 到 q 的光线，p 端透明
func _streak(p: Vector2, q: Vector2, c0: Color, c1: Color, a: float, lw: float) -> void:
	if not _ok():
		return
	_line(PackedVector2Array([p, p.lerp(q, 0.6), q]), PackedColorArray([_col(c0, 0.0), _col(c0, 0.7 * a), _col(c1, a)]), lw)


# 从中心射出的尖刺：细长的菱形，根部最亮
func _spike(c: Vector2, th: float, ln: float, wid: float, core: Color, rim: Color, a: float) -> void:
	if ln <= 0.5 or a <= 0.005 or not _ok():
		return
	var d := Vector2(cos(th), sin(th))
	var nv := Vector2(-d.y, d.x) * wid
	var tip := c + d * ln
	var pts := PackedVector2Array([c - d * wid * 1.5, c + nv, (c + nv).lerp(tip, 0.4), tip, (c - nv).lerp(tip, 0.4), c - nv])
	var cols := PackedColorArray()
	for p in pts:
		var u := clampf((p - c).dot(d) / ln, 0.0, 1.0)
		cols.append(_col(core, a).lerp(_col(rim, 0.75 * a), u / 0.4) if u < 0.4 else _col(rim, 0.75 * a).lerp(_col(rim, 0.0), (u - 0.4) / 0.6))
	var idx := Geometry2D.triangulate_polygon(pts)
	if not idx.is_empty():
		_tri(idx, pts, cols)


# 从 c 甩出去的火花：越飞越慢、往下弯、烧尽，拖尾顺着弧线
func _sparks(c: Vector2, n: int, reach: float, t0: float, seed_k: int, gravity: float) -> void:
	var P := Rand.new(random_seed * 41 + seed_k)
	for k in n:
		var th := P.next() * TAU
		var sp := 0.45 + 0.75 * P.next()
		var life := 0.6 + 0.45 * P.next()
		var wid := 0.6 + 0.8 * P.next()
		var lt := (_t - t0) / life
		if lt <= 0.0 or lt >= 1.0:
			continue
		var path := func(q: float) -> Vector2:
			var d := reach * (0.12 + sp * _ease_out(q, 2.4))
			return c + Vector2(cos(th) * d, sin(th) * d + reach * gravity * q * q)
		_comet(path, lt, 0.12 + 0.1 * sp, maxf(0.8, _R * 0.026 * wid * (1.0 - lt * 0.6)), 1.0 - lt * lt, rim_color, core_color)


# 一道竖直的光柱：两端淡出，中间一根亮芯，外面几层更宽更淡的光
func _beam(x: float, yb: float, yt: float, wd: float, a: float) -> void:
	if not _ok() or a <= 0.01 or yb - yt < 1.0:
		return
	for ps in [[wd * 5.0, rim_color, 0.1], [wd * 2.6, rim_color, 0.22], [wd, core_color, 0.9]]:
		var pts := PackedVector2Array([Vector2(x, yb), Vector2(x, yb + (yt - yb) * 0.2), Vector2(x, yb + (yt - yb) * 0.55), Vector2(x, yt)])
		var cols := PackedColorArray([_col(ps[1], 0.0), _col(ps[1], a * ps[2]), _col(ps[1], 0.7 * a * ps[2]), _col(ps[1], 0.0)])
		_line(pts, cols, ps[0])


# 绕着 (x, y) 的一条光带：椭圆上大约三分之二圈，两头细，前半圈更亮更宽
func _swirl(x: float, y: float, rx: float, ry: float, a0: float, a: float, wd: float) -> void:
	if not _ok() or a <= 0.01:
		return
	var N := 40
	var span := TAU * 0.68
	for ps in 2:
		var pts := PackedVector2Array()
		var cols := PackedColorArray()
		var ws := PackedFloat32Array()
		for i in N + 1:
			var s := float(i) / N
			var th := a0 + span * s
			var front := 0.35 + 0.65 * (0.5 + 0.5 * sin(th))
			var k := sin(PI * s) * front * a
			pts.append(Vector2(x + cos(th) * rx, y + sin(th) * ry))
			cols.append(_col(core_color, k) if ps == 1 else _col(rim_color, 0.35 * k))
			ws.append((1.0 if ps == 1 else 3.5) * wd * (0.5 + 0.5 * front))
		_line(pts, cols, wd, ws)


# 带亮头的拖尾（head）或两头细中间粗的光（not head）
func _trail(pts: PackedVector2Array, wd: float, a: float, head: bool, rim: Color, core: Color) -> void:
	var n := pts.size() - 1
	if not _ok() or a <= 0.01 or n < 1 or pts[0].distance_to(pts[n]) < 0.5:
		return
	var chord := pts[n] - pts[0]
	var len2 := maxf(chord.length_squared(), 1e-6)
	for ps in [[3.2, rim, 0.25], [1.0, core, 1.0]]:
		var verts := PackedVector2Array()
		var cols := PackedColorArray()
		var idx := PackedInt32Array()
		var ka: float = ps[2]
		for i in n + 1:
			var s := float(i) / n
			var f := pow(s, 1.5) if head else sin(PI * s)
			var hw: float = wd * ps[0] * (0.12 + 0.88 * f) / 2.0
			var d := (pts[mini(n, i + 1)] - pts[maxi(0, i - 1)]).normalized()
			var nv := Vector2(-d.y, d.x) * hw
			var u := clampf((pts[i] - pts[0]).dot(chord) / len2, 0.0, 1.0)
			var col: Color
			if head:
				col = _col(rim, 0.0).lerp(_col(rim, 0.45 * a * ka), u / 0.55) if u < 0.55 else _col(rim, 0.45 * a * ka).lerp(_col(ps[1], a * ka), (u - 0.55) / 0.45)
			else:
				col = _col(rim, 0.0).lerp(_col(ps[1], a * ka), u / 0.5) if u < 0.5 else _col(ps[1], a * ka).lerp(_col(rim, 0.0), (u - 0.5) / 0.5)
			verts.append(pts[i] + nv)
			verts.append(pts[i] - nv)
			cols.append(col)
			cols.append(col)
			if i > 0:
				var b := (i - 1) * 2
				idx.append_array(PackedInt32Array([b, b + 1, b + 2, b + 1, b + 3, b + 2]))
		_tri(idx, verts, cols)
	if head:
		_blob(pts[n], wd * 2.0, [[0.0, core, a], [0.4, rim, 0.5 * a], [1.0, rim, 0.0]])


# 带拖尾的粒子：path(q) 是它在自己飞行进度 q 时的位置，拖尾顺着走过的路弯
func _comet(path: Callable, q: float, back: float, wd: float, a: float, rim: Color, core: Color) -> void:
	if not _ok() or a <= 0.01 or wd <= 0.0:
		return
	var pts := PackedVector2Array()
	for i in range(8, -1, -1):
		pts.append(path.call(maxf(0.0, q - back * i / 8.0)))
	_trail(pts, wd, a, true, rim, core)


# 闪烁的四角星：光晕、十字光芒、一道横向的镜头光
func _star(p: Vector2, s: float, col: Color, a: float, tilt: float) -> void:
	if not _ok() or a <= 0.01:
		return
	_radial(p, [[0.0, Color(1, 1, 1, 0.9 * a)], [s * 0.3, Color(col, 0.4 * a)], [s, Color(col, 0.0)]])
	for d in [[Vector2(cos(tilt), sin(tilt)), s * 1.8], [Vector2(-sin(tilt), cos(tilt)), s * 1.2]]:
		var v: Vector2 = d[0] * d[1]
		_line(PackedVector2Array([p - v, p, p + v]), PackedColorArray([_col(Color.WHITE, 0.0), _col(Color.WHITE, 0.95 * a), _col(Color.WHITE, 0.0)]), maxf(0.6, s / 6.0))
	var fl := s * 4.5
	_line(PackedVector2Array([p - Vector2(fl, 0), p, p + Vector2(fl, 0)]), PackedColorArray([_col(col, 0.0), _col(col, 0.45 * a), _col(col, 0.0)]), maxf(0.5, s / 10.0))


# 一道竖向渐变（stops: [[位置, 颜色]]）× 横向遮罩（mask 从左到右）的矩形光
func _column(x: float, y: float, w: float, h: float, vstops: Array, mask: Array) -> void:
	if not _ok():
		return
	var pts := PackedVector2Array()
	var cols := PackedColorArray()
	var idx := PackedInt32Array()
	var nc := mask.size()
	for st in vstops:
		var yy: float = y + h - h * float(st[0])  # 位置 0 在底部
		for i in nc:
			pts.append(Vector2(x + w * i / (nc - 1), yy))
			var col: Color = st[1]
			col.a *= float(mask[i]) * _gmul
			cols.append(col)
	for r in range(1, vstops.size()):
		for i in nc - 1:
			var a := (r - 1) * nc + i
			var b := r * nc + i
			idx.append_array(PackedInt32Array([a, a + 1, b + 1, a, b + 1, b]))
	_tri(idx, pts, cols)


# 抗锯齿的线：一条三角形带，两边各淡出半个屏幕像素；比一个像素还细的线画成一个像素宽、更淡
# cols：每个点一个颜色，或只给一个；ws：每个点的宽度（可选）
# 折线每个点的法线（几遍描边共用）
func _normals(pts: PackedVector2Array) -> PackedVector2Array:
	var n := pts.size()
	var out := PackedVector2Array()
	out.resize(n)
	for i in n:
		var d0 := (pts[i] - pts[maxi(0, i - 1)]).normalized()
		var d1 := (pts[mini(n - 1, i + 1)] - pts[i]).normalized()
		var d := d0 + d1
		if d.length_squared() < 1e-8:
			d = d1 if d1 != Vector2.ZERO else d0
		d = d.normalized()
		out[i] = Vector2(-d.y, d.x)
	return out


# 同 _line，一种颜色、一个宽度，法线已经算好
func _line_n(pts: PackedVector2Array, nrm: PackedVector2Array, col: Color, wi: float) -> void:
	var n := pts.size()
	if not _ok() or n < 2:
		return
	var c := col
	var core := maxf(0.0, wi * 0.5 - _px * 0.5)
	var outer := wi * 0.5 + _px * 0.5
	if wi < _px:
		c.a *= wi / _px
		core = 0.0
		outer = _px
	var ct := Color(c, 0.0)
	var verts := PackedVector2Array()
	verts.resize(n * 4)
	var vc := PackedColorArray()
	vc.resize(n * 4)
	var idx := PackedInt32Array()
	idx.resize((n - 1) * 18)
	var k := 0
	for i in n:
		var p := pts[i]
		var m := nrm[i]
		verts[i * 4] = p + m * outer
		verts[i * 4 + 1] = p + m * core
		verts[i * 4 + 2] = p - m * core
		verts[i * 4 + 3] = p - m * outer
		vc[i * 4] = ct
		vc[i * 4 + 1] = c
		vc[i * 4 + 2] = c
		vc[i * 4 + 3] = ct
		if i > 0:
			var b := (i - 1) * 4
			for j in 3:
				idx[k] = b + j
				idx[k + 1] = b + j + 1
				idx[k + 2] = b + 5 + j
				idx[k + 3] = b + j
				idx[k + 4] = b + 5 + j
				idx[k + 5] = b + 4 + j
				k += 6
	_tri(idx, verts, vc)


func _line(pts: PackedVector2Array, cols: PackedColorArray, w: float, ws := PackedFloat32Array()) -> void:
	var n := pts.size()
	if not _ok() or n < 2 or cols.is_empty():
		return
	var verts := PackedVector2Array()
	var vc := PackedColorArray()
	var idx := PackedInt32Array()
	for i in n:
		var d0 := (pts[i] - pts[maxi(0, i - 1)]).normalized()
		var d1 := (pts[mini(n - 1, i + 1)] - pts[i]).normalized()
		var d := d0 + d1
		if d.length_squared() < 1e-8:
			d = d1 if d1 != Vector2.ZERO else d0
		d = d.normalized()
		var nrm := Vector2(-d.y, d.x)
		var wi: float = ws[i] if ws.size() == n else w
		var c: Color = cols[i] if cols.size() == n else cols[0]
		var core := maxf(0.0, wi * 0.5 - _px * 0.5)
		var outer := wi * 0.5 + _px * 0.5
		if wi < _px:
			c.a *= wi / _px
			core = 0.0
			outer = _px
		var ct := Color(c, 0.0)
		verts.append_array(PackedVector2Array([pts[i] + nrm * outer, pts[i] + nrm * core, pts[i] - nrm * core, pts[i] - nrm * outer]))
		vc.append_array(PackedColorArray([ct, c, c, ct]))
		if i > 0:
			var b := (i - 1) * 4
			for j in 3:
				idx.append_array(PackedInt32Array([b + j, b + j + 1, b + 5 + j, b + j, b + 5 + j, b + 4 + j]))
	_tri(idx, verts, vc)


func _seg(a: Vector2, b: Vector2, c: Color, w: float) -> void:
	_line(PackedVector2Array([a, b]), PackedColorArray([c]), w)


func _poly_fill(pts: PackedVector2Array, cols: PackedColorArray) -> void:
	if not _ok() or pts.size() < 3:
		return
	var idx := Geometry2D.triangulate_polygon(pts)
	if not idx.is_empty():
		_tri(idx, pts, cols)


func _fill_cols(n: int, c: Color) -> PackedColorArray:
	var cols := PackedColorArray()
	cols.resize(n)
	cols.fill(c)
	return cols


# 配色上从暗到亮的位置 v（0..1）的颜色
func _across(v: float) -> Color:
	var n := colors.size()
	if n == 1:
		return colors[0]
	var t := clampf(v, 0.0, 1.0) * (n - 1)
	var i := mini(n - 2, int(floor(t)))
	return colors[i].lerp(colors[i + 1], t - i)


# ---------- 光效点缀（与编辑器 vfx/accents.js 相同） ----------

func _accents() -> void:
	var any := false
	for v in accents:
		if v > 0.0:
			any = true
	if not any:
		return
	var wraps := kind == 4 or kind == 5 or kind == 7 or kind == 8
	var ground := kind == 3 or kind == 6 or kind == 10 or (kind == 1 and squash < 0.98)
	var A := {}
	A.rx = _rx if wraps else _R
	A.ry = _ry if wraps else (_R * 0.8 if ground else _R)
	A.x = _cx
	A.y = _gy - A.ry * 0.5 if ground else _cy
	A.s = minf(A.rx, A.ry)
	A.bottom = _gy if ground else A.y + A.ry * 0.8
	A.top = A.y - A.ry
	A.burst = kind == 0 or kind == 2 or kind == 9
	var env := 1.0 if loop else _smooth(0.0, 0.1, _t) * (1.0 - _smooth(0.6, 1.0, _t))
	if env <= 0.01:
		return
	for n in mini(11, accents.size()):
		var amt: float = accents[n]
		if amt <= 0.0:
			continue
		_add = additive  # 光叠加；深色配色（黑炎）普通盖上去
		var P := Rand.new(random_seed * 1009 + n * 7919 + 11)
		match n:
			0: _acc_stars(A, amt, env, P)
			1: _acc_dust(A, amt, env, P)
			2: _acc_embers(A, amt, env, P)
			3: _acc_snow(A, amt, env, P)
			4: _acc_shards(A, amt, env, P)
			5: _acc_bolts(A, amt, env)
			6: _acc_rays(A, amt, env, P)
			7: _acc_bubbles(A, amt, env, P)
			8: _acc_drops(A, amt, env, P)
			9: _acc_leaves(A, amt, env, P)
			10: _acc_rocks(A, amt, env, P)


func _in_ellipse(A: Dictionary, P: Rand, k: float) -> Vector2:
	var th := P.next() * TAU
	var r := sqrt(P.next()) * k
	return Vector2(A.x + cos(th) * A.rx * r, A.y + sin(th) * A.ry * r)


# 星光：原地一闪一闪的四角星
func _acc_stars(A: Dictionary, amt: float, env: float, P: Rand) -> void:
	for k in int(round(16.0 * amt)):
		var p := _in_ellipse(A, P, 1.1)
		var ph := P.next()
		var sp := 1.0 + floorf(P.next() * 2.0)
		var sz: float = maxf(1.5, A.s * 0.08 * (0.5 + P.next()))
		var col := _across(0.4 + 0.6 * P.next())
		var tilt := P.next() * 0.6
		var tw := pow(maxf(0.0, sin(TAU * fposmod(ph + _t * sp, 1.0))), 2.0) * env
		if tw > 0.05:
			_star(p, sz, col, tw, tilt)


# 粉尘：飘在空中、来回游移的细小光点
func _acc_dust(A: Dictionary, amt: float, env: float, P: Rand) -> void:
	for k in int(round(40.0 * amt)):
		var p := _in_ellipse(A, P, 1.15)
		var th := P.next() * TAU
		var ph := P.next()
		var ph2 := P.next()
		var col := _across(0.45 + 0.55 * P.next())
		var d: float = A.s * 0.12 * sin(TAU * fposmod(ph + _t, 1.0))
		var a := (0.35 + 0.65 * pow(sin(TAU * fposmod(ph2 + _t, 1.0)), 2.0)) * env
		_blob(p + Vector2(cos(th), sin(th)) * d, maxf(0.8, A.s * 0.02), [[0.0, core_color, a], [0.4, col, 0.7 * a], [1.0, col, 0.0]])


# 余烬：从底部升起、左右摇摆、渐渐熄灭的火星
func _acc_embers(A: Dictionary, amt: float, env: float, P: Rand) -> void:
	var span: float = A.bottom - (A.top - A.ry * 0.3)
	for k in int(round(20.0 * amt)):
		var ux := (P.next() * 2.0 - 1.0) * 0.9
		var ph := P.next()
		var sp := 1.0 + floorf(P.next() * 2.0)
		var sw := P.next() * TAU
		var sz := 0.8 + P.next()
		var p := fposmod(ph + _t * sp, 1.0)
		var a := sin(PI * p) * (1.0 - 0.4 * p) * env
		var x: float = A.x + ux * A.rx + sin(sw + p * TAU) * A.rx * 0.1
		var y: float = A.bottom - span * p
		_blob(Vector2(x, y), maxf(1.2, A.s * 0.05 * sz), [[0.0, core_color, a], [0.45, rim_color, 0.6 * a], [1.0, rim_color, 0.0]])


# 雪花：六瓣带侧枝，一边转一边飘落
func _acc_snow(A: Dictionary, amt: float, env: float, P: Rand) -> void:
	var y0: float = A.top - A.ry * 0.2
	var span: float = A.bottom + A.ry * 0.2 - y0
	for k in int(round(22.0 * amt)):
		var ux := (P.next() * 2.0 - 1.0) * 1.05
		var ph := P.next()
		var sw := P.next() * TAU
		var dir := 1.0 if P.next() < 0.5 else -1.0
		var sz: float = maxf(2.0, A.s * (0.07 + 0.08 * pow(P.next(), 2.0)))
		var p := fposmod(ph + _t, 1.0)
		var a := sin(PI * p) * env
		if a < 0.05:
			continue
		var c := Vector2(A.x + ux * A.rx + sin(sw + p * TAU) * A.rx * 0.08, y0 + span * p)
		var spin := sw + dir * TAU * p
		_blob(c, sz * 1.2, [[0.0, rim_color, 0.35 * a], [1.0, rim_color, 0.0]])
		var col := _col(core_color, 0.9 * a)
		var lw := maxf(0.5, sz / 9.0)
		for arm in 6:
			var th := spin + arm * PI / 3.0
			var d := Vector2(cos(th), sin(th))
			_seg(c, c + d * sz, col, lw)
			for br in [[0.45, 0.32], [0.7, 0.22]]:
				var b: Vector2 = c + d * sz * br[0]
				for sgn in [1.0, -1.0]:
					var bt: float = th + sgn * PI / 3.0
					_seg(b, b + Vector2(cos(bt), sin(bt)) * sz * br[1], col, lw)


# 碎片：从中心甩出去、翻转着的晶体碎片
func _acc_shards(A: Dictionary, amt: float, env: float, P: Rand) -> void:
	_add = false
	var light: Color = colors[3] if colors.size() > 3 else core_color
	var dark: Color = colors[1] if colors.size() > 1 else colors[0]
	for k in int(round(14.0 * amt)):
		var th := P.next() * TAU
		var ph := P.next()
		var sp := 1.0 + floorf(P.next() * 2.0)
		var ln: float = A.s * (0.16 + 0.14 * P.next())
		var turn := (P.next() - 0.5) * 2.0
		var p := fposmod(ph + _t * sp, 1.0)
		var a := (1.0 - p) * _smooth(0.0, 0.08, p) * env
		if a < 0.03:
			continue
		var d: float = A.s * (0.15 + 1.0 * _ease_out(p, 2.0))
		var sp2 := th + turn * p * PI
		var along := Vector2(cos(sp2), sin(sp2))
		var out := Vector2(-along.y, along.x)
		var c := Vector2(A.x + cos(th) * d * A.rx / A.s, A.y + sin(th) * d * A.ry / A.s)
		var wid := ln * 0.42
		var f := c + along * ln * 0.62
		var bk := c - along * ln * 0.38
		var s1 := c + out * wid * 0.5 + along * ln * 0.06
		var s2 := c - out * wid * 0.42 - along * ln * 0.04
		_poly_fill(PackedVector2Array([f, s1, bk]), _fill_cols(3, _col(light, 0.8 * a)))
		_poly_fill(PackedVector2Array([f, bk, s2]), _fill_cols(3, _col(dark, 0.7 * a)))
		_seg(f, bk, _col(core_color, 0.9 * a), maxf(0.5, wid / 9.0))


# 闪电：绕着区域窜动，每帧都是新的
func _acc_bolts(A: Dictionary, amt: float, env: float) -> void:
	var fi := clampi(int(floor(_t * frames)), 0, frames - 1)
	var B := Rand.new(random_seed * 977 + fi * 7919 + 3)
	for k in maxi(1, int(round(3.0 * amt))):
		if B.next() < 0.3:
			continue
		var th := B.next() * TAU
		var r := 0.75 + 0.25 * B.next()
		var pts := []
		for j in 5:
			pts.append(Vector2(A.x + cos(th) * A.rx * r, A.y + sin(th) * A.ry * r))
			th += 0.22 + 0.15 * B.next()
			r = clampf(r + (B.next() - 0.5) * 0.4, 0.5, 1.1)
		var jagged := _jag(pts, B, A.s * 0.06)
		var wd: float = maxf(0.8, A.s * 0.018)
		var a := (0.6 + 0.4 * B.next()) * env
		for ps in [[wd * 6.0, rim_color, 0.12], [wd * 2.8, rim_color, 0.4], [wd, core_color, 1.0]]:
			_line(jagged, PackedColorArray([_col(ps[1], a * ps[2])]), ps[0])


# 折线拆成更细的锯齿：每段分四段，拐点往旁边推最多 amp
func _jag(pts: Array, rnd: Rand, amp: float) -> PackedVector2Array:
	var out := PackedVector2Array([pts[0]])
	for i in range(1, pts.size()):
		var a: Vector2 = pts[i - 1]
		var b: Vector2 = pts[i]
		var dv := (b - a).normalized()
		var nrm := Vector2(-dv.y, dv.x)
		for j in range(1, 5):
			var s := j / 4.0
			var o := (rnd.next() - 0.5) * 2.0 * amp if j < 4 else 0.0
			out.append(a.lerp(b, s) + nrm * o)
	return out


# 光芒：从中心放射的长光束，循环时转过一格
func _acc_rays(A: Dictionary, amt: float, env: float, P: Rand) -> void:
	var N := 8
	var rot := TAU / N * _t * (1.0 if loop else 0.5)
	var m := _t if loop else 0.0
	var rs := []
	for k in N:
		rs.append([(P.next() - 0.5) * 0.3, P.next(), 0.05 + 0.06 * P.next()])
	var c := Vector2(A.x, A.y)
	for k in N:
		var r0: Array = rs[k]
		var r1: Array = rs[(k + 1) % N]
		var th: float = rot + k * TAU / N + lerpf(r0[0], r1[0], m)
		var wid: float = A.s * lerpf(r0[2], r1[2], m)
		var ln: float = A.s * (1.05 + 0.35 * lerpf(sin(TAU * fposmod(r0[1] + _t, 1.0)), sin(TAU * fposmod(r1[1] + _t, 1.0)), m))
		var a := 0.55 * minf(1.0, amt * 1.4) * env
		var d := Vector2(cos(th), sin(th))
		var e := Vector2(A.x + d.x * ln * A.rx / A.s, A.y + d.y * ln * A.ry / A.s)
		var b1 := c + Vector2(-d.y, d.x) * wid
		var b2 := c - Vector2(-d.y, d.x) * wid
		var pts := PackedVector2Array([b1, b1.lerp(e, 0.4), e, b2.lerp(e, 0.4), b2])
		var cols := PackedColorArray([_col(core_color, a), _col(rim_color, 0.5 * a), _col(rim_color, 0.0), _col(rim_color, 0.5 * a), _col(core_color, a)])
		_poly_fill(pts, cols)


# 气泡：上浮、晃动的空心气泡
func _acc_bubbles(A: Dictionary, amt: float, env: float, P: Rand) -> void:
	var span: float = A.bottom - (A.top - A.ry * 0.2)
	for k in int(round(20.0 * amt)):
		var ux := (P.next() * 2.0 - 1.0) * 0.9
		var ph := P.next()
		var sp := 1.0 + floorf(P.next() * 2.0)
		var sw := P.next() * TAU
		var sz: float = maxf(1.5, A.s * (0.04 + 0.05 * pow(P.next(), 1.5)))
		var p := fposmod(ph + _t * sp, 1.0)
		var a := sin(PI * p) * env
		if a < 0.05:
			continue
		var c := Vector2(A.x + ux * A.rx + sin(sw + p * TAU * 2.0) * sz * 0.8, A.bottom - span * p)
		if _ok():
			_tri_circle(c, sz, _col(rim_color, 0.12 * a))
		var ring := PackedVector2Array()
		for i in 25:
			ring.append(c + Vector2(cos(TAU * i / 24.0), sin(TAU * i / 24.0)) * sz)
		_line(ring, PackedColorArray([_col(rim_color, 0.75 * a)]), maxf(0.6, sz / 5.0))
		if _ok():
			_tri_circle(c - Vector2(sz, sz) * 0.35, maxf(0.5, sz * 0.22), _col(core_color, 0.9 * a))


# 水滴：甩出去又落下的泪滴
func _acc_drops(A: Dictionary, amt: float, env: float, P: Rand) -> void:
	_add = false
	for k in int(round(16.0 * amt)):
		var th := -PI * (0.1 + 0.8 * P.next())
		var ph := P.next()
		var sp := 1.0 + floorf(P.next() * 2.0)
		var r: float = maxf(1.2, A.s * (0.035 + 0.03 * P.next()))
		var reach := 0.6 + 0.6 * P.next()
		var p := fposmod(ph + _t * sp, 1.0)
		var a := sin(PI * p) * env
		if a < 0.05:
			continue
		var v := Vector2(cos(th), sin(th)) * reach
		var c := Vector2(A.x + v.x * A.s * 1.2 * p, A.y + (v.y * 1.2 * p + 1.1 * p * p) * A.s)
		var d := Vector2(v.x, v.y + 2.2 * p).normalized()
		var nv := Vector2(-d.y, d.x)
		var back := c - d * r * 3.0
		var front := c + d * r
		var pts := PackedVector2Array()
		for i in 9:
			pts.append(_quad(back, c + nv * r * 1.1 - d * r * 0.6, front, i / 8.0))
		for i in range(1, 8):
			pts.append(_quad(front, c - nv * r * 1.1 - d * r * 0.6, back, i / 8.0))
		var cols := PackedColorArray()
		var axis := front - back
		for q in pts:
			var u := clampf((q - back).dot(axis) / maxf(axis.length_squared(), 1e-6), 0.0, 1.0)
			cols.append(_col(colors[mini(1, colors.size() - 1)], 0.4 * a).lerp(_col(colors[mini(2, colors.size() - 1)], 0.95 * a), u))
		_poly_fill(pts, cols)
		if _ok():
			_tri_circle(c + nv * r * 0.3, maxf(0.5, r * 0.3), _col(core_color, 0.9 * a))


# 落叶：被风卷着横穿、翻面
func _acc_leaves(A: Dictionary, amt: float, env: float, P: Rand) -> void:
	_add = false
	for k in int(round(14.0 * amt)):
		var dir := 1.0 if P.next() < 0.5 else -1.0
		var ph := P.next()
		var y0: float = A.y + (P.next() * 2.0 - 1.0) * A.ry * 0.8
		var sw := P.next() * TAU
		var sz: float = maxf(2.5, A.s * (0.07 + 0.06 * P.next()))
		var p := fposmod(ph + _t, 1.0)
		var a := sin(PI * p) * env
		if a < 0.05:
			continue
		var c := Vector2(A.x + dir * (p * 2.4 - 1.2) * A.rx, y0 + sin(TAU * (p + sw)) * A.ry * 0.2)
		var turn := sw + TAU * p * dir
		var flip := absf(cos(TAU * p * 2.0 + sw))
		var ax := Vector2(cos(turn), sin(turn))
		var nv := Vector2(-ax.y, ax.x) * flip
		var tip := c + ax * sz
		var tail := c - ax * sz
		if flip > 0.05:
			var pts := PackedVector2Array()
			for i in 9:
				pts.append(_quad(tail, c + nv * sz * 0.9, tip, i / 8.0))
			for i in range(1, 8):
				pts.append(_quad(tip, c - nv * sz * 0.9, tail, i / 8.0))
			_poly_fill(pts, _fill_cols(pts.size(), _col(colors[mini(1, colors.size() - 1)], 0.9 * a)))
		_seg(tail, tip, _col(colors[mini(2, colors.size() - 1)], 0.9 * a), maxf(0.5, sz / 8.0))


# 碎石：爆开时甩出去落下，或者从地面（包住角色的特效的底部）蹦起来，一边翻滚
func _acc_rocks(A: Dictionary, amt: float, env: float, P: Rand) -> void:
	_add = false
	for k in int(round(12.0 * amt)):
		var ux := (P.next() * 2.0 - 1.0) * 0.7
		var side := (P.next() * 2.0 - 1.0) * 0.6
		var up := 0.8 + 0.8 * P.next()
		var th := P.next() * TAU
		var reach := 0.7 + 0.6 * P.next()
		var ph := P.next()
		var sp := 1.0 + floorf(P.next() * 2.0)
		var sz: float = maxf(1.5, A.s * (0.05 + 0.06 * P.next()))
		var shape := int(floor(P.next() * 1e6))
		var spin0 := P.next() * TAU
		var p := fposmod(ph + _t * sp, 1.0)
		var a := pow(sin(PI * p), 0.5) * env
		if a < 0.05:
			continue
		var c: Vector2
		if A.burst:
			var d: float = A.s * reach * _ease_out(p, 1.6)
			c = Vector2(A.x + cos(th) * d, A.y + sin(th) * d + A.s * 0.7 * p * p)
		else:
			c = Vector2(A.x + ux * A.rx + side * A.s * p, A.bottom - (up * p - up * p * p) * A.s * 1.6)
		_rock(c, sz, spin0 + TAU * p, Rand.new(shape), a)


# 一块石头：不规则多边形，左上亮、右下暗，有亮面、暗面和深色轮廓
func _rock(c: Vector2, sz: float, spin: float, rnd: Rand, a: float) -> void:
	var n := 6 + int(floor(rnd.next() * 3.0))
	var pts := PackedVector2Array()
	for i in n:
		var th := spin + float(i) / n * TAU + (rnd.next() - 0.5) * 0.5
		var rr := sz * (0.62 + 0.45 * rnd.next())
		pts.append(c + Vector2(cos(th), sin(th)) * rr)
	var c0: Color = colors[0]
	var c1: Color = colors[mini(1, colors.size() - 1)]
	var c2: Color = colors[mini(2, colors.size() - 1)]
	var c3: Color = colors[3] if colors.size() > 3 else c2
	var cols := PackedColorArray()
	for p in pts:
		var u := clampf(((p.x - c.x + sz) + (p.y - c.y + sz)) / (4.0 * sz), 0.0, 1.0)
		cols.append(_col(c2, a).lerp(_col(c1, a), u / 0.55) if u < 0.55 else _col(c1, a).lerp(_col(c0, a), (u - 0.55) / 0.45))
	_poly_fill(pts, cols)
	var outline := PackedVector2Array(pts)
	outline.append(pts[0])
	_line(outline, PackedColorArray([_col(c0, 0.9 * a)]), maxf(0.5, sz / 8.0))
	var lit := PackedVector2Array()
	var dark := PackedVector2Array()
	for p in pts:
		var s := (p.x - c.x) + (p.y - c.y)
		if s < sz * 0.2:
			lit.append(p)
		if s > sz * 0.35:
			dark.append(p)
	if lit.size() >= 2:
		lit.append(c + Vector2(sz, sz) * 0.05)
		_poly_fill(lit, _fill_cols(lit.size(), _col(c3, 0.75 * a)))
	if dark.size() >= 2:
		dark.append(c + Vector2(sz, sz) * 0.15)
		_poly_fill(dark, _fill_cols(dark.size(), _col(c0, 0.55 * a)))


func _fill(pl: PackedVector2Array, col: Color) -> void:
	if not _ok() or pl.size() < 3:
		return
	var idx := Geometry2D.triangulate_polygon(pl)
	if idx.is_empty():
		return
	var cols := PackedColorArray()
	cols.resize(pl.size())
	cols.fill(col)
	_tri(idx, pl, cols)


func _arc(c: Vector2, r: float, a0: float, a1: float, n: int) -> Array:
	var out := []
	for i in n + 1:
		var a := a0 + (a1 - a0) * i / n
		out.append(c + Vector2(cos(a), sin(a)) * r)
	return out


func _quad(a: Vector2, c: Vector2, b: Vector2, t: float) -> Vector2:
	return a * (1.0 - t) * (1.0 - t) + c * 2.0 * t * (1.0 - t) + b * t * t


func _smooth(e0: float, e1: float, x: float) -> float:
	var t := clampf((x - e0) / maxf(e1 - e0, 1e-6), 0.0, 1.0)
	return t * t * (3.0 - 2.0 * t)


func _ease_out(t: float, p: float) -> float:
	return 1.0 - pow(1.0 - clampf(t, 0.0, 1.0), p)


func _ease_in(t: float, p: float) -> float:
	return pow(clampf(t, 0.0, 1.0), p)


# ---------- 跟着动画 ----------

func _current_frame() -> int:
	if _sprite == null:
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
	if not use_target_layout or _sprite == null or not (_sprite is AnimatedSprite2D or _sprite is Sprite2D):
		return ""
	var sp = _sprite
	return "%s%s%s%s" % [sp.centered, sp.offset, sp.flip_h, sp.flip_v]


func _flips() -> Vector2:
	if not use_target_layout or _sprite == null or not (_sprite is AnimatedSprite2D or _sprite is Sprite2D):
		return Vector2.ONE
	var sp = _sprite
	return Vector2(-1.0 if sp.flip_h else 1.0, -1.0 if sp.flip_v else 1.0)


# 动画画布像素 → 本节点的坐标
func _to_local(p: Vector2) -> Vector2:
	if not use_target_layout or _sprite == null or not (_sprite is AnimatedSprite2D or _sprite is Sprite2D):
		return p
	var sp = _sprite
	var w := float(_follow["canvas"]["w"])
	var h := float(_follow["canvas"]["h"])
	var q := p
	if sp.flip_h:
		q.x = w - q.x
	if sp.flip_v:
		q.y = h - q.y
	if sp.centered:
		q -= Vector2(w, h) * 0.5
	return q + sp.offset
`;
}
