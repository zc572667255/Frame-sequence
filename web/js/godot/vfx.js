// 特效图层 for programmers: an effect layer played by the game instead of baked
// into the animation's frames. The effect's own frames are rendered here as the
// editor draws them (one sheet); when and where they show goes out as data —
// per animation frame the effect frame and its region, which already covers the
// start frame, length, loop, per-frame keys and following a layer.
//
// The Godot 4 script plays it two ways: following the sprite's frame exactly as
// in the editor, or on its own — play() / play_at() anywhere, looping or once,
// at any speed, size and tint (a hit spark where the blow lands, an aura held
// for as long as a buff lasts).
import { vfxSettings, vfxFrame, vfxRegion, vfxRect, vfxCanvas } from "../vfx/layer.js";
import { VFX_KINDS } from "../vfx/effects.js";
import { createCanvas, canvasToBlob } from "../core/util.js";
import { sheetGrid } from "../nodes/exporters.js";

const clean = (s) => String(s || "").replace(/["\\]/g, "");

// ctx: { bbox(layerId, fi) } for a layer that follows another (vfx/layer.js vfxRegion)
export function vfxData(l, frameIds, w, h, fps, ctx, title) {
  const s = vfxSettings(l);
  const kind = VFX_KINDS.find((k) => k.id === s.kind);
  // per animation frame: [effect frame, x, y, w, h] (the region's top-left and size), or null
  const timeline = frameIds.map((_, fi) => {
    const i = vfxFrame(s, frameIds, fi);
    if (i < 0) return null;
    const r = vfxRect(vfxRegion(s, frameIds, fi, ctx));
    return [i, r.x, r.y, r.w, r.h];
  });
  return {
    format: "guangtai-vfx", version: 1,
    name: clean(title || l.name), kind: s.kind, kindName: kind ? kind.name : s.kind,
    canvas: { w, h }, fps: fps || 12, frames: frameIds.length,
    effect: { frames: Math.max(1, s.frames | 0), loop: !!s.loop, pixel: s.style === "pixel" },
    timeline,
  };
}

const toBase64 = async (blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let j = 0; j < bytes.length; j += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(j, j + 0x8000));
  return btoa(bin);
};

// the effect's frames, as the editor renders them, at the largest region it
// takes (smaller ones are drawn scaled down): embedded ("embed") or as a file
// next to the script ("files": returned for the zip)
export async function attachVfxSheet(data, l, mode = "embed", prefix = "vfx/") {
  const s = vfxSettings(l);
  let rw = 0, rh = 0;
  for (const e of data.timeline) if (e && e[3] * e[4] > rw * rh) { rw = e[3]; rh = e[4]; }
  if (!rw) { const r = vfxRect({ x: 0, y: 0, w: s.w, h: s.h }); rw = r.w; rh = r.h; }
  const n = data.effect.frames;
  const { cols, rows } = sheetGrid(n, { layout: "square" });
  const sheet = createCanvas(rw * cols, rh * rows), g = sheet.getContext("2d");
  for (let i = 0; i < n; i++) g.drawImage(vfxCanvas(s, i, rw, rh), (i % cols) * rw, Math.floor(i / cols) * rh);
  // pixel art as PNG (lossy compression would smear its hard edges), smooth light as WebP
  const [type, ext] = data.effect.pixel ? ["image/png", "png"] : ["image/webp", "webp"];
  const blob = await canvasToBlob(sheet, type, 0.9);
  data.effect.size = { w: rw, h: rh };
  const files = [];
  if (mode === "files") {
    const file = prefix + "effect." + ext;
    files.push({ file, blob });
    data.sheet = { cols, rows, file };
  } else data.sheet = { cols, rows, [ext]: await toBase64(blob) };
  return files;
}

export function vfxJSON(data) {
  return JSON.stringify({
    ...data,
    notes: {
      overview: "特效本身的每一帧在 sheet 里（编辑器渲染的原样），按 cols 列排成网格，每格 effect.size 大。effect.frames 帧，loop 为循环特效。",
      timeline: "跟着动画播放时：timeline[动画帧] = [特效帧, x, y, w, h] 或 null。把 sheet 里第「特效帧」格缩放画到画布（左上角为原点）的 (x, y, w, h) 上。开始帧、持续帧数、循环、逐帧调整、跟随图层都已经算在里面。",
      standalone: "单独播放时：每 1 / fps 秒前进一帧，从 0 播到 effect.frames − 1（loop 时取模一直循环），以 effect.size 为大小、以放置点为中心画出。",
      blend: "普通透明混合，光晕和叠加发光已经画进图里。",
    },
  }, null, 2);
}

// GDScript: data embedded in a """ string, where a backslash still escapes
const gdData = (data) => JSON.stringify(data).replace(/\\/g, "\\\\");

// data: vfxData(...) with its sheet embedded, or null for the generic copy the
// layered scene uses (each node then carries its own data_json)
export function vfxGodot(data) {
  const title = data ? data.name + "（" + data.kindName + "）" : "特效";
  const loop = data ? !!data.effect.loop : false;
  return `# 特效 Effect —— 由「光台 · 序列帧工作室」导出：${title}
# Godot 4.x。特效每一帧的画面是编辑器渲染好的，播放、位置和大小由本脚本控制。两种用法：
#   跟着动画（mode = 跟着动画）：新建一个 Node2D 挂上本脚本，放在角色精灵（AnimatedSprite2D 或 Sprite2D）下面，
#     按精灵当前帧显示，开始帧、持续、循环、位置大小（包括逐帧调整、跟随图层）都和编辑器一样。
#     精灵每一帧的图要和导出时的动画画布一样大；centered / offset / flip_h / flip_v 会自动换算。
#     AnimatedSprite2D：animation_name 填这段动画的名字，只在播它时显示；Sprite2D：frame_offset 填这段动画的第一帧。
#   单独播放（mode = 单独播放）：不依赖动画，调用 play() 在本节点位置播一遍（loop 时一直循环，stop() 停下），
#     play_at(全局坐标) 在指定位置播，比如命中点；播完发出 finished。
#   tint 给特效染色（乘法），effect_scale 整体缩放，speed 调播放速度。
extends Node2D

signal finished

@export_enum("跟着动画", "单独播放") var mode := 0
@export var target: NodePath
@export var animation_name: StringName = &""
@export var frame_offset := 0
## 关掉时坐标就是动画画布像素（左上角为原点），不按精灵换算（分层导出的场景里用）
@export var use_target_layout := true
@export_group("单独播放")
@export var autoplay := false
@export var loop := ${loop}
@export var speed := 1.0
@export var effect_scale := 1.0
@export_group("")
@export var tint := Color.WHITE
@export_multiline var data_json := """${data ? gdData(data) : ""}"""

var _sprite: Node2D
var _data: Dictionary
var _tex: Texture2D
var _w := 0.0
var _h := 0.0
var _cell := Vector2.ONE
var _cols := 1
var _n := 1
var _fps := 12.0
var _playing := false
var _t := 0.0
var _shown := ""


func _ready() -> void:
	_sprite = (get_node_or_null(target) if not target.is_empty() else get_parent()) as Node2D
	var data = JSON.parse_string(data_json)
	if typeof(data) != TYPE_DICTIONARY:
		push_warning("特效：data_json 不是有效的数据")
		return
	_data = data
	_w = float(data["canvas"]["w"])
	_h = float(data["canvas"]["h"])
	_fps = float(data["fps"])
	_n = maxi(1, int(data["effect"]["frames"]))
	_cell = Vector2(data["effect"]["size"]["w"], data["effect"]["size"]["h"])
	_cols = maxi(1, int(data["sheet"]["cols"]))
	_tex = _texture(data["sheet"])
	if data["effect"]["pixel"]:
		texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	if mode == 1 and autoplay:
		play()


# 图：数据里内嵌的 PNG / WebP（base64），或脚本旁边的文件
func _texture(s: Dictionary) -> Texture2D:
	if s.has("png") or s.has("webp"):
		var img := Image.new()
		var err := img.load_png_from_buffer(Marshalls.base64_to_raw(s["png"])) if s.has("png") else img.load_webp_from_buffer(Marshalls.base64_to_raw(s["webp"]))
		if err != OK:
			return null
		return ImageTexture.create_from_image(img)
	if s.has("file"):
		return load((get_script() as Script).resource_path.get_base_dir().path_join(s["file"])) as Texture2D
	return null


# 单独播放：从头播一遍（loop 时一直循环）
func play() -> void:
	_playing = true
	_t = 0.0
	queue_redraw()


# 单独播放：在这个全局坐标播
func play_at(at: Vector2) -> void:
	global_position = at
	play()


func stop() -> void:
	_playing = false
	queue_redraw()


func is_playing() -> bool:
	return _playing


func _process(delta: float) -> void:
	if _tex == null:
		return
	if mode == 1:
		if _playing:
			_t += delta * speed
			if not loop and int(_t * _fps) >= _n:
				_playing = false
				finished.emit()
			queue_redraw()
		return
	var key := "%d|%s" % [_current_frame(), _layout_key()]
	if key != _shown:
		_shown = key
		queue_redraw()


func _draw() -> void:
	if _tex == null:
		return
	if mode == 1:
		if not _playing:
			return
		var e := int(_t * _fps)
		e = posmod(e, _n) if loop else mini(e, _n - 1)
		var size := _cell * effect_scale
		_draw_cell(e, Rect2(-size * 0.5, size))
		return
	var fi := _current_frame()
	var tl: Array = _data["timeline"]
	if fi < 0 or fi >= tl.size() or tl[fi] == null:
		return
	var r: Array = tl[fi]
	draw_set_transform(_to_local(Vector2(r[1], r[2])), 0.0, _flips())
	_draw_cell(int(r[0]), Rect2(0, 0, r[3], r[4]))
	draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)


func _draw_cell(e: int, dest: Rect2) -> void:
	var src := Rect2(Vector2(e % _cols, floori(float(e) / _cols)) * _cell, _cell)
	draw_texture_rect_region(_tex, dest, src, tint)


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
	var q := p
	if sp.flip_h:
		q.x = _w - q.x
	if sp.flip_v:
		q.y = _h - q.y
	if sp.centered:
		q -= Vector2(_w, _h) * 0.5
	return q + sp.offset
`;
}
