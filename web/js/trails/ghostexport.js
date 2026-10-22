// 残影 settings for programmers: the same afterimage done at run time in the
// game instead of baked into the frames. A Godot 4 script with the settings
// filled in, and engine-neutral JSON with the formulas spelled out.
//
// Run-time model (matches the editor): a snapshot of the sprite is left every
// `interval` seconds (spacing frames at the animation's fps), or on the frames
// that feed the picked frames' ghosts. A snapshot of age t is at step s = t /
// interval: opacity strength · clamp((count + 1 − s) / count, 0, 1), colour
// near → far by clamp((s − 1) / (count − 1), 0, 1), moved by offsetPerStep · s.
import { ghostSettings, ghostOn, ghostFrame } from "./ghost.js";

// everything a program needs, from a ghost layer of an animation (fps, frame ids)
export function ghostParams(layer, fps, frameIds, title) {
  const s = ghostSettings(layer);
  const count = Math.max(1, Math.min(12, s.count | 0));
  const spacing = Math.max(1, s.spacing | 0);
  const interval = spacing / Math.max(1, fps || 12);
  const all = !Array.isArray(s.frames) || frameIds.every((id) => s.frames.includes(id));
  const show = frameIds.map((id, i) => (ghostOn(s, id) ? i : -1)).filter((i) => i >= 0);
  // the frames whose snapshots are seen on the picked frames
  const emit = new Set();
  if (!all) for (const f of show) for (let k = 1; k <= count; k++) { const j = ghostFrame(s, f, k, frameIds.length); if (j >= 0) emit.add(j); }
  return {
    name: (title ? title + " · " : "") + layer.name,
    fps: fps || 12,
    count, spacingFrames: spacing,
    interval: +interval.toFixed(4),
    lifetime: +(interval * (count + 1)).toFixed(4),
    strength: Math.max(0, Math.min(1, s.fade / 100)),
    tintMode: s.tint === "mix" ? "mix" : s.tint === "none" ? "none" : "silhouette",
    tintMix: Math.max(0, Math.min(1, s.mix / 100)),
    colorNear: s.color, colorFar: s.color2 || s.color,
    dither: s.alpha === "dither",
    additive: s.blend === "add",
    cover: Math.max(0, Math.min(1, (s.cover ?? 0) / 100)),
    offsetPerStep: { x: s.dx || 0, y: s.dy || 0 },
    loop: !!s.loop,
    allFrames: all,
    showFrames: all ? [] : show,
    emitFrames: [...emit].sort((a, b) => a - b),
  };
}

export function ghostJSON(p) {
  return JSON.stringify({
    format: "guangtai-afterimage", version: 1,
    ...p,
    notes: {
      overview: "运行时残影：每隔 interval 秒（或播到 emitFrames 里的帧时）把角色当前帧的样子留在原地一份快照，快照随时间变淡、变色，lifetime 秒后删除。快照画在角色后面。",
      frames: "帧序号从 0 开始。allFrames = true 时整段动画都留残影；否则只在播到 emitFrames 的帧时留快照，这样残影正好出现在 showFrames（编辑器里选的帧）上。",
      opacity: "s = age / interval；opacity = strength * clamp((count + 1 - s) / count, 0, 1)",
      color: "t = clamp((s - 1) / max(count - 1, 1), 0, 1)；颜色 = lerp(colorNear, colorFar, t)",
      tintMode: "silhouette：只保留精灵的透明度，颜色整片换成残影色；mix：rgb = lerp(原色, 残影色, tintMix)；none：保持原色",
      dither: "true 时不画半透明：按精灵纹素坐标查 4×4 Bayer 表 [0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5]，像素 alpha * opacity > (bayer + 0.5) / 16 则保留原 alpha，否则丢弃",
      additive: "true 时用叠加混合（变亮发光），否则普通透明混合",
      cover: "遮挡（0..1）：残影挡住它身后的特效和更远残影的程度。实现：先用残影轮廓（不透明）按 cover 抠掉下层，再画半透明残影；做不到抠图时，把残影放在身后特效之上一层、并让较近的快照盖住较远的",
      offsetPerStep: "快照位置 = 留下时的位置 + offsetPerStep * s（精灵像素，乘精灵缩放；精灵水平翻转时 x 取反）。原地播放的冲刺动画用它把残影拉开",
      interval: "= spacingFrames / fps（按动画帧率；帧有单独时长时以实际播放为准）",
    },
  }, null, 2);
}

// GDScript infers the type from the literal: a float must keep its decimal point
const gdFloat = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(v));
const gdColor = (h) => 'Color("' + h + '")';
const gdVec = (v) => "Vector2(" + v.x + ", " + v.y + ")";

export function ghostGodot(p) {
  return `# 残影 Afterimage —— 由「光台 · 序列帧工作室」导出：${p.name}
# Godot 4.x。用法：
#   1. 新建一个 Node2D，挂上本脚本，放在角色精灵（AnimatedSprite2D 或 Sprite2D）下面作为子节点；
#      或者把 target 指向角色精灵。
#   2. 需要残影时 active = true（例如冲刺开始），结束时 active = false；已留下的残影会自己淡出。
#   3. emit_frames 不为空时，只在 AnimatedSprite2D 播到这些帧（从 0 开始）时留残影，
#      对应编辑器里选的帧；为空时按 interval 定时留残影。
#      animation_name 填这段动画在 SpriteFrames 里的名字，只对它生效；空 = 任何动画。
#   4. 角色在场景里真的移动时，残影会自动沿移动路线拉开；原地播放的动画用 offset_per_step 拉开。
extends Node2D

@export var target: NodePath
@export var active := true
@export var animation_name: StringName = &""
@export var emit_frames := PackedInt32Array(${JSON.stringify(p.emitFrames)})
@export_range(1, 12) var count := ${p.count}
@export var interval := ${gdFloat(p.interval)}  # 秒 = ${p.spacingFrames} 帧 / ${p.fps} fps
@export_range(0.0, 1.0) var strength := ${gdFloat(p.strength)}
@export_enum("纯色剪影", "原图+染色", "原图颜色") var tint_mode := ${p.tintMode === "silhouette" ? 0 : p.tintMode === "mix" ? 1 : 2}
@export_range(0.0, 1.0) var tint_mix := ${gdFloat(p.tintMix)}
@export var color_near := ${gdColor(p.colorNear)}
@export var color_far := ${gdColor(p.colorFar)}
@export var dither := ${p.dither}  # 像素抖动：不画半透明像素
@export var additive := ${p.additive}  # 发光叠加
@export var offset_per_step := ${gdVec(p.offsetPerStep)}  # 每一步再挪多少（精灵像素）
@export var min_speed := 0.0  # 角色移动慢于这个速度（像素/秒）时不留残影；0 = 不限

const SHADER := """
shader_type canvas_item;
render_mode %s;
uniform vec4 tint : source_color = vec4(1.0);
uniform int mode = 0;
uniform float mix_amount = 0.6;
uniform float alpha = 1.0;
uniform bool dither = false;
const float BAYER[16] = float[](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
void fragment() {
	vec4 c = texture(TEXTURE, UV);
	vec3 rgb = c.rgb;
	if (mode == 0) { rgb = tint.rgb; }
	else if (mode == 1) { rgb = mix(c.rgb, tint.rgb, mix_amount); }
	float a = c.a * alpha;
	if (dither) {
		vec2 px = floor(UV / TEXTURE_PIXEL_SIZE);
		int i = int(mod(px.y, 4.0)) * 4 + int(mod(px.x, 4.0));
		a = a > (BAYER[i] + 0.5) / 16.0 ? c.a : 0.0;
	}
	COLOR = vec4(rgb, a);
}
"""

var _sprite: Node2D
var _layer: Node2D  # 放残影的节点：在角色精灵的前一个位置，所以画在角色后面
var _shader: Shader
var _ghosts: Array[Dictionary] = []
var _timer := 0.0
var _last_pos := Vector2.ZERO
var _speed := 0.0


func _ready() -> void:
	_sprite = (get_node(target) if not target.is_empty() else get_parent()) as Node2D
	if _sprite == null:
		push_warning("残影：找不到角色精灵，请设置 target")
		return
	_shader = Shader.new()
	_shader.code = SHADER % ("blend_add" if additive else "blend_mix")
	if _sprite is AnimatedSprite2D:
		(_sprite as AnimatedSprite2D).frame_changed.connect(_on_frame_changed)
	_last_pos = _sprite.global_position
	_setup_layer.call_deferred()


func _setup_layer() -> void:
	var parent := _sprite.get_parent()
	if parent == null:
		return
	_layer = Node2D.new()
	_layer.name = "Afterimages"
	_layer.z_index = _sprite.z_index
	_layer.z_as_relative = _sprite.z_as_relative
	parent.add_child(_layer)
	parent.move_child(_layer, _sprite.get_index())  # 紧挨着角色、在它前面 = 画在它后面


func _exit_tree() -> void:
	if is_instance_valid(_layer):
		_layer.queue_free()
	_ghosts.clear()


func _process(delta: float) -> void:
	if _sprite == null:
		return
	var pos := _sprite.global_position
	_speed = pos.distance_to(_last_pos) / maxf(delta, 0.0001)
	_last_pos = pos
	if active and emit_frames.is_empty():
		_timer += delta
		if _timer >= interval:
			_timer = fmod(_timer, interval)
			_spawn()
	else:
		_timer = interval  # 打开时立刻留第一个
	var life := interval * (count + 1)
	for i in range(_ghosts.size() - 1, -1, -1):
		var g := _ghosts[i]
		g["age"] += delta
		if g["age"] >= life:
			(g["node"] as Node).queue_free()
			_ghosts.remove_at(i)
		else:
			_style(g)


func _on_frame_changed() -> void:
	if not active or emit_frames.is_empty():
		return
	var a := _sprite as AnimatedSprite2D
	if animation_name != &"" and a.animation != animation_name:
		return
	if a.frame in emit_frames:
		_spawn()


# 立刻留一个残影（也可以在动画事件或代码里直接调用）
func emit_now() -> void:
	_spawn()


func _spawn() -> void:
	if not is_instance_valid(_layer) or not _layer.is_inside_tree():
		return
	if min_speed > 0.0 and _speed < min_speed:
		return
	var g := Sprite2D.new()
	if _sprite is AnimatedSprite2D:
		var a := _sprite as AnimatedSprite2D
		if a.sprite_frames:
			g.texture = a.sprite_frames.get_frame_texture(a.animation, a.frame)
		g.centered = a.centered
		g.offset = a.offset
		g.flip_h = a.flip_h
		g.flip_v = a.flip_v
	elif _sprite is Sprite2D:
		var sp := _sprite as Sprite2D
		g.texture = sp.texture
		g.centered = sp.centered
		g.offset = sp.offset
		g.flip_h = sp.flip_h
		g.flip_v = sp.flip_v
		g.hframes = sp.hframes
		g.vframes = sp.vframes
		g.frame = sp.frame
		g.region_enabled = sp.region_enabled
		g.region_rect = sp.region_rect
	if g.texture == null:
		g.free()
		return
	g.texture_filter = _sprite.texture_filter
	var m := ShaderMaterial.new()
	m.shader = _shader
	g.material = m
	_layer.add_child(g)
	var flip := -1.0 if g.flip_h else 1.0
	var sc := _sprite.global_scale
	# 留在原地：每帧按全局坐标摆放，不跟着角色走
	var ghost := {"node": g, "age": 0.0, "at": _sprite.global_transform, "drift": offset_per_step * Vector2(flip * sc.x, sc.y)}
	_ghosts.append(ghost)
	_style(ghost)


func _style(g: Dictionary) -> void:
	var s: float = g["age"] / interval
	var node := g["node"] as Sprite2D
	var m := node.material as ShaderMaterial
	m.set_shader_parameter("tint", color_near.lerp(color_far, clampf((s - 1.0) / maxf(count - 1, 1), 0.0, 1.0)))
	m.set_shader_parameter("mode", tint_mode)
	m.set_shader_parameter("mix_amount", tint_mix)
	m.set_shader_parameter("alpha", strength * clampf((count + 1 - s) / count, 0.0, 1.0))
	m.set_shader_parameter("dither", dither)
	var t: Transform2D = g["at"]
	t.origin += g["drift"] * s
	node.global_transform = t
`;
}
