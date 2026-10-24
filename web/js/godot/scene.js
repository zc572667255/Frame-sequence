// A Godot 4 scene (.tscn) for a layered export: one child per layer, all on the
// same canvas and origin, so stacked they look as in the editor. Either an
// AnimatedSprite2D per layer (SpriteFrames, per-frame durations) or a Sprite2D
// per layer stepped by one AnimationPlayer. Glowing layers get an additive
// material; trails drawn at run time are Node2Ds with attack_trail.gd.
//
// Paths are relative to the scene file — Godot resolves them on load, so the
// exported folder can go anywhere in the project.

import { codeProps } from "./code.js";

const str = (s) => JSON.stringify(String(s));          // a tscn / GDScript string literal
const num = (v) => { const r = +(+v).toFixed(4); return Number.isInteger(r) ? r.toFixed(1) : String(r); };
const vec = (x, y) => "Vector2(" + x + ", " + y + ")";

// Godot node names can't hold . : @ / " % and must be unique among siblings
export function nodeNames(names) {
  const used = new Set(["AnimationPlayer"]);
  return names.map((n) => {
    const base = String(n || "Layer").replace(/[.:@/"%]/g, "_").trim() || "Layer";
    let s = base, k = 2;
    while (used.has(s)) s = base + "_" + k++;
    used.add(s);
    return s;
  });
}

// pack: { name, fps, durations (ms per frame), origin {x, y}, layers: [
//   { node, kind: "sprite", file, blend, box {x, y, w, h}, cols, rows }
//   | { node, kind: "trail" | "trailcode" | "vfx", data } | { node, kind: "code", params } ] }
// opts: { mode: "animated" | "sprite", nearest, trailScript, rootScript }
export function godotScene(pack, opts) {
  const ext = [], subs = [], nodes = [];
  const fps = pack.fps || 12, step = 1000 / fps, n = pack.durations.length;
  const extId = (type, path) => { const id = ext.length + 1 + "_" + type.toLowerCase(); ext.push(`[ext_resource type="${type}" path=${str(path)} id="${id}"]`); return id; };
  const rootScript = extId("Script", opts.rootScript);
  const trailScript = pack.layers.some((l) => l.kind === "trail") ? extId("Script", opts.trailScript) : null;
  const trailCodeScript = pack.layers.some((l) => l.kind === "trailcode") ? extId("Script", opts.trailCodeScript) : null;
  const vfxScript = pack.layers.some((l) => l.kind === "vfx") ? extId("Script", opts.vfxScript) : null;
  const codeScript = pack.layers.some((l) => l.kind === "code") ? extId("Script", opts.codeScript) : null;
  let addMat = null;
  const material = () => {
    if (!addMat) { addMat = "CanvasItemMaterial_add"; subs.push(`[sub_resource type="CanvasItemMaterial" id="${addMat}"]\nblend_mode = 1`); }
    return addMat;
  };
  const ox = pack.origin.x, oy = pack.origin.y;
  const sprites = pack.layers.filter((l) => l.kind === "sprite");

  nodes.push(`[node name=${str(pack.rootName)} type="Node2D"]` + (opts.nearest ? "\ntexture_filter = 1" : "") + `\nscript = ExtResource("${rootScript}")`);

  pack.layers.forEach((l, li) => {
    if (l.kind === "code") {
      // drawn by its script alone, following the first sprite layer's frame
      nodes.push([
        `[node name=${str(l.node)} type="Node2D" parent="."]`,
        `position = ${vec(-ox, -oy)}`,
        `script = ExtResource("${codeScript}")`,
        "mode = 0",
        sprites.length ? `target = NodePath(${str("../" + sprites[0].node)})` : null,
        "use_target_layout = false",
        ...codeProps(l.params),
      ].filter(Boolean).join("\n"));
      return;
    }
    if (l.kind === "trailcode") {
      // drawn by its script alone, following the first sprite layer's frame
      nodes.push([
        `[node name=${str(l.node)} type="Node2D" parent="."]`,
        `position = ${vec(-ox, -oy)}`,
        `script = ExtResource("${trailCodeScript}")`,
        sprites.length ? `target = NodePath(${str("../" + sprites[0].node)})` : null,
        "use_target_layout = false",
        `data_json = ${str(JSON.stringify(l.data))}`,
      ].filter(Boolean).join("\n"));
      return;
    }
    if (l.kind === "trail" || l.kind === "vfx") {
      // drawn / played at run time; frames come from the first sprite layer. Its
      // local origin is the canvas' top-left corner, like the sprites' offsets.
      nodes.push([
        `[node name=${str(l.node)} type="Node2D" parent="."]`,
        `position = ${vec(-ox, -oy)}`,
        `script = ExtResource("${l.kind === "trail" ? trailScript : vfxScript}")`,
        sprites.length ? `target = NodePath(${str("../" + sprites[0].node)})` : null,
        "use_target_layout = false",
        `data_json = ${str(JSON.stringify(l.data))}`,
      ].filter(Boolean).join("\n"));
      return;
    }
    const tex = extId("Texture2D", l.file);
    const head = [
      `[node name=${str(l.node)} type="${opts.mode === "sprite" ? "Sprite2D" : "AnimatedSprite2D"}" parent="."]`,
      l.blend === "add" ? `material = SubResource("${material()}")` : null,
    ];
    const place = ["centered = false", `offset = ${vec(l.box.x - ox, l.box.y - oy)}`];
    if (opts.mode === "sprite") {
      nodes.push([...head, `texture = ExtResource("${tex}")`, ...place, `hframes = ${l.cols}`, `vframes = ${l.rows}`].filter(Boolean).join("\n"));
      return;
    }
    const frames = [];
    for (let i = 0; i < n; i++) {
      const id = `AtlasTexture_${li}_${i}`;
      subs.push(`[sub_resource type="AtlasTexture" id="${id}"]\natlas = ExtResource("${tex}")\nregion = Rect2(${(i % l.cols) * l.box.w}, ${Math.floor(i / l.cols) * l.box.h}, ${l.box.w}, ${l.box.h})`);
      frames.push(`{\n"duration": ${num((pack.durations[i] || step) / step)},\n"texture": SubResource("${id}")\n}`);
    }
    const sf = `SpriteFrames_${li}`;
    subs.push(`[sub_resource type="SpriteFrames" id="${sf}"]\nanimations = [{\n"frames": [${frames.join(", ")}],\n"loop": true,\n"name": &"default",\n"speed": ${num(fps)}\n}]`);
    nodes.push([...head, `sprite_frames = SubResource("${sf}")`, `animation = &"default"`, ...place].filter(Boolean).join("\n"));
  });

  if (opts.mode === "sprite" && sprites.length) {
    // one animation stepping every layer's frame together, each frame for its own duration
    const times = [];
    let t = 0;
    for (let i = 0; i < n; i++) { times.push(num(t / 1000)); t += pack.durations[i] || step; }
    const frames = Array.from({ length: n }, (_, i) => i).join(", ");
    const tracks = sprites.map((l, k) => [
      `tracks/${k}/type = "value"`,
      `tracks/${k}/imported = false`,
      `tracks/${k}/enabled = true`,
      `tracks/${k}/path = NodePath(${str(l.node + ":frame")})`,
      `tracks/${k}/interp = 0`,
      `tracks/${k}/loop_wrap = true`,
      `tracks/${k}/keys = {\n"times": PackedFloat32Array(${times.join(", ")}),\n"transitions": PackedFloat32Array(${times.map(() => "1").join(", ")}),\n"update": 1,\n"values": [${frames}]\n}`,
    ].join("\n"));
    subs.push(`[sub_resource type="Animation" id="Animation_default"]\nresource_name = "default"\nlength = ${num(t / 1000)}\nloop_mode = 1\n${tracks.join("\n")}`);
    subs.push(`[sub_resource type="AnimationLibrary" id="AnimationLibrary_main"]\n_data = {\n"default": SubResource("Animation_default")\n}`);
    nodes.push(`[node name="AnimationPlayer" type="AnimationPlayer" parent="."]\nlibraries = {\n"": SubResource("AnimationLibrary_main")\n}`);
  }

  return [`[gd_scene load_steps=${ext.length + subs.length + 1} format=3]`, ext.join("\n"), ...subs, ...nodes].filter(Boolean).join("\n\n") + "\n";
}

// the root's script: plays, stops and loops every layer together
export function layeredScript(name) {
  return `# 分层动画 —— 由「光台 · 序列帧工作室」导出：${name}
# Godot 4.x。每个图层是一个子节点，共用同一个原点，叠起来就是编辑器里看到的样子。
#   play() / stop() 同时控制所有图层，播完（不循环时）发出 finished。
#   set_layer_visible("图层名", false) 单独关掉某一层，比如只要角色不要特效。
#   挂着 attack_trail.gd / attack_trail_code.gd 的节点是运行时画的攻击拖尾，跟着第一个图层的帧走。
#   水平翻转整段动画：把本节点的 scale.x 设为 -1。
extends Node2D

signal finished

@export var autoplay := true
@export var loop := true


func _ready() -> void:
	# F6 单独运行这个场景、又没有摄像机时：原点（脚底）在窗口左上角，整段动画会画到窗口外面，
	# 所以挪到窗口中间偏下。放进别的场景里用时不动它。
	if get_tree().current_scene == self and get_viewport().get_camera_2d() == null:
		var size := get_viewport_rect().size
		position = Vector2(size.x * 0.5, size.y * 0.75)
	var ap := _player()
	if ap:
		ap.animation_finished.connect(func(_n: StringName) -> void: finished.emit())
	else:
		var s := _sprites()
		if not s.is_empty():
			(s[0] as AnimatedSprite2D).animation_finished.connect(func() -> void: finished.emit())
	if autoplay:
		play()


func play() -> void:
	var ap := _player()
	if ap:
		ap.get_animation("default").loop_mode = Animation.LOOP_LINEAR if loop else Animation.LOOP_NONE
		ap.stop()
		ap.play("default")
		return
	for s in _sprites():
		s.sprite_frames.set_animation_loop("default", loop)
		s.stop()
		s.play("default")


func stop() -> void:
	var ap := _player()
	if ap:
		ap.stop()
	for s in _sprites():
		s.stop()


func set_layer_visible(layer_name: String, on: bool) -> void:
	var n := get_node_or_null(NodePath(layer_name)) as CanvasItem
	if n:
		n.visible = on


func _player() -> AnimationPlayer:
	return get_node_or_null("AnimationPlayer") as AnimationPlayer


func _sprites() -> Array[AnimatedSprite2D]:
	var out: Array[AnimatedSprite2D] = []
	for c in get_children():
		if c is AnimatedSprite2D:
			out.append(c)
	return out
`;
}
