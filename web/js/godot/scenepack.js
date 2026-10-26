// 场景导出: a scene card (scene/model.js) as a Godot 4 project folder.
//
//   <scene>/<scene>.tscn       the scene: background, every item in stack
//                               order, a camera on the stage
//   <scene>/scene.gd           its root script: brings each item in at its
//                               start time, plays it, loops the whole scene
//   <scene>/actors/NN_<name>/  each animation card it holds, as the layered
//                               export makes it (godot/layers.js): a scene of
//                               its own (actor.tscn), instanced here once per
//                               placement
//   <scene>/sprites/NN.png     every other card (素材图, 特效, processing
//                               results) as a sheet: a Sprite2D or an
//                               AnimatedSprite2D
//   <scene>/vfx_code.gd        or (opts.fx = "code") a 特效 card drawn by the
//                               game itself, no pictures (godot/code.js) — the
//                               kinds it knows; the others still as sheets
//   <scene>/<scene>_scene.json the same, engine-neutral
//
// Everything the scene refers to has a plain ASCII name (only the folder and
// the scene itself are named after the card), so an unzip tool that garbles
// other names can't break it.
//
// Items stand by the middle of their picture's bottom edge (rounded down) —
// the layered export's 底部中心 origin — so positions, scale and turn carry
// over as they are.
import { el, createCanvas, canvasToBlob, downloadBlob, fmtBytes } from "../core/util.js";
import { openModal } from "../ui/modal.js";
import { nodeType } from "../nodes/registry.js";
import { sheetGrid } from "../nodes/exporters.js";
import { makeZip } from "../imaging/zip.js";
import { normalizeScene, sources, sceneLength } from "../scene/model.js";
import { layeredFiles, alphaBox } from "./layers.js";
import { nodeNames } from "./scene.js";
import { codeSupported, codeParamsFrom, codeProps, codeGodot } from "./code.js";
import { VFX_DEFAULTS } from "../vfx/effects.js";

const safe = (s) => String(s || "scene").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim() || "scene";
// ASCII folder and file names: some unzip tools still garble UTF-8 ones
const ascii = (s) => String(s || "").replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24);
const enc = new TextEncoder();
const str = (s) => JSON.stringify(String(s));
const num = (v) => { const r = +(+v).toFixed(4); return Number.isInteger(r) ? r.toFixed(1) : String(r); };
const vec = (x, y) => "Vector2(" + num(x) + ", " + num(y) + ")";
const hexColor = (h) => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h || "");
  return m ? "Color(" + [1, 2, 3].map((i) => num(parseInt(m[i], 16) / 255)).join(", ") + ", 1)" : null;
};

// opts: { mode, trails, vfx, nearest, camera, fx } — mode / trails / vfx as
// the layered export takes them, for the animations; fx: "code" | "baked",
// for the 特效 cards
export async function exportSceneZip(app, cardId, opts) {
  const card = app.store.cards[cardId];
  const scene = normalizeScene(card.params), srcs = sources(app, scene), length = sceneLength(scene, srcs);
  const title = card.title || "场景", root = safe(title);
  const files = [];
  const parts = new Map(); // card id -> what it became
  let ai = 0, si = 0;
  for (const it of scene.items) {
    if (parts.has(it.card)) continue;
    const c = app.store.cards[it.card], src = srcs.get(it.card);
    if (!c || !src) { parts.set(it.card, null); continue; }
    const name = c.title || nodeType(c.type).title;
    if (c.type === "animation") {
      // the layered export, in a folder of its own
      const dir = "actors/" + String(++ai).padStart(2, "0") + (ascii(name) ? "_" + ascii(name) : "");
      const r = await layeredFiles(app, it.card, name, { mode: opts.mode, origin: "feet", trails: opts.trails, vfx: opts.vfx, nearest: opts.nearest, fileName: "actor", frameMs: 1000 / scene.fps }, root + "/" + dir);
      files.push(...r.files);
      parts.set(it.card, { kind: "actor", name, scene: r.scene.slice(root.length + 1), w: r.w, h: r.h, seconds: r.durations.length / scene.fps });
      continue;
    }
    if (c.type === "vfx" && opts.fx === "code" && codeSupported({ vfx: c.params })) {
      // drawn by vfx_code.gd, from the card's settings
      const v = { ...VFX_DEFAULTS, ...c.params };
      parts.set(it.card, { kind: "code", name, w: src.w, h: src.h, params: codeParamsFrom(v, src.w, src.h, scene.fps, name), seconds: src.frames.length / scene.fps });
      continue;
    }
    // anything else as one sheet, trimmed to what it ever covers
    let box = null;
    for (const f of src.frames) {
      const b = alphaBox(f.canvas);
      if (b) box = box ? { x0: Math.min(box.x0, b.x0), y0: Math.min(box.y0, b.y0), x1: Math.max(box.x1, b.x1), y1: Math.max(box.y1, b.y1) } : b;
    }
    if (!box) { parts.set(it.card, null); continue; }
    const bw = box.x1 - box.x0 + 1, bh = box.y1 - box.y0 + 1, n = src.frames.length;
    // shown only smaller than it is (a big painting scaled down): the sheet
    // made at the largest size it is shown at, smoothly, and the nodes scaled
    // up by as much — Godot's own filter can't scale it down that smoothly
    // without mipmaps (and the file gets smaller)
    const most = Math.max(...scene.items.filter((x) => x.card === it.card).map((x) => Math.abs(x.scale || 1)));
    const f = most < 1 ? Math.max(1 / Math.max(bw, bh), most) : 1;
    const cw = Math.max(1, Math.round(bw * f)), ch = Math.max(1, Math.round(bh * f));
    const { cols, rows } = sheetGrid(n, { layout: "square" });
    const sheet = createCanvas(cw * cols, ch * rows), sg = sheet.getContext("2d");
    sg.imageSmoothingEnabled = f < 1;
    sg.imageSmoothingQuality = "high";
    src.frames.forEach((fr, i) => sg.drawImage(fr.canvas, box.x0, box.y0, bw, bh, (i % cols) * cw, Math.floor(i / cols) * ch, cw, ch));
    const file = "sprites/" + String(++si).padStart(2, "0") + (ascii(name) ? "_" + ascii(name) : "") + ".png";
    files.push({ name: root + "/" + file, data: new Uint8Array(await (await canvasToBlob(sheet)).arrayBuffer()) });
    parts.set(it.card, {
      kind: src.still ? "image" : "frames", name, file, w: src.w, h: src.h, box: { x: box.x0, y: box.y0, w: bw, h: bh }, cols, rows,
      // the sheet's scale (< 1: made smaller) and its cells' size
      f: cw / bw, cell: { w: cw, h: ch },
      durations: src.frames.map(() => 1000 / scene.fps), seconds: src.frames.length / scene.fps,
    });
  }
  const items = scene.items.filter((it) => parts.get(it.card));
  if (!items.length) throw new Error("场景里没有能导出的元素（卡片都还没有画面）。");
  const names = nodeNames(items.map((it) => it.name || parts.get(it.card).name));
  const fps = scene.fps;

  // ---- the .tscn ----
  const ext = [], subs = [], nodes = [];
  const extId = (type, path) => { const id = ext.length + 1 + "_" + type.toLowerCase(); ext.push(`[ext_resource type="${type}" path=${str(path)} id="${id}"]`); return id; };
  const script = extId("Script", "scene.gd");
  const packed = new Map(), textures = new Map(), atlases = new Map();
  for (const it of items) {
    const p = parts.get(it.card);
    if (p.kind === "actor" && !packed.has(it.card)) packed.set(it.card, extId("PackedScene", p.scene));
    if ((p.kind === "image" || p.kind === "frames") && !textures.has(it.card)) textures.set(it.card, extId("Texture2D", p.file));
  }
  const codeScript = [...parts.values()].some((p) => p && p.kind === "code") ? extId("Script", "vfx_code.gd") : null;
  nodes.push(`[node name=${str(nodeNames([title])[0])} type="Node2D"]` + (opts.nearest ? "\ntexture_filter = 1" : "") + `\nscript = ExtResource("${script}")\nlength = ${num(length / fps)}`);
  const bg = hexColor(scene.bg);
  if (bg) nodes.push(`[node name="Background" type="ColorRect" parent="."]\noffset_right = ${num(scene.w)}\noffset_bottom = ${num(scene.h)}\nmouse_filter = 2\ncolor = ${bg}`);
  const meta = [];
  items.forEach((it, k) => {
    const p = parts.get(it.card), name = names[k];
    // a sheet made smaller is scaled back up by as much
    const f = p.kind === "actor" || p.kind === "code" ? 1 : p.f, s = (it.scale || 1) / f, place = [
      `position = ${vec(it.x, it.y)}`,
      it.rot ? `rotation = ${num(it.rot * Math.PI / 180)}` : null,
      s !== 1 || it.flip ? `scale = ${vec(s * (it.flip ? -1 : 1), s)}` : null,
      (it.opacity ?? 100) < 100 ? `modulate = Color(1, 1, 1, ${num((it.opacity ?? 100) / 100)})` : null,
      // what starts later (or is switched off) starts hidden; scene.gd shows it
      it.start > 0 || it.visible === false ? "visible = false" : null,
      // shown smaller than its own pixels (a big painting scaled down): smooth
      // filtering, as the editor draws it, whatever the scene's own filter
      (p.kind === "image" || p.kind === "frames") && (s < 1 || f < 1) ? "texture_filter = 2" : null,
    ];
    const anchor = { x: Math.floor(p.w / 2), y: p.h };
    if (p.kind === "code") {
      // the item (where it stands, turned, scaled) and in it the effect, whose
      // position is its box's centre: half its height above the anchor
      nodes.push([`[node name=${str(name)} type="Node2D" parent="."]`, ...place].filter(Boolean).join("\n"));
      nodes.push([`[node name="Effect" type="Node2D" parent=${str(name)}]`, `position = ${vec(p.w / 2 - anchor.x, -p.h / 2)}`, `script = ExtResource("${codeScript}")`, "mode = 1", "autoplay = false", ...codeProps(p.params)].join("\n"));
    } else if (p.kind === "actor") {
      nodes.push([`[node name=${str(name)} parent="." instance=ExtResource("${packed.get(it.card)}")]`, ...place, "autoplay = false", `loop = ${!!it.loop}`].filter(Boolean).join("\n"));
    } else if (p.kind === "image") {
      nodes.push([`[node name=${str(name)} type="Sprite2D" parent="."]`, ...place, `texture = ExtResource("${textures.get(it.card)}")`, "centered = false", `offset = ${vec((p.box.x - anchor.x) * f, (p.box.y - anchor.y) * f)}`].filter(Boolean).join("\n"));
    } else {
      // the frames shared by every placement; the loop is the item's own
      if (!atlases.has(it.card)) {
        const ids = p.durations.map((_, i) => {
          const id = `AtlasTexture_${atlases.size}_${i}`;
          subs.push(`[sub_resource type="AtlasTexture" id="${id}"]\natlas = ExtResource("${textures.get(it.card)}")\nregion = Rect2(${(i % p.cols) * p.cell.w}, ${Math.floor(i / p.cols) * p.cell.h}, ${p.cell.w}, ${p.cell.h})`);
          return id;
        });
        atlases.set(it.card, ids);
      }
      const step = 1000 / fps, sf = `SpriteFrames_${k}`;
      const frames = atlases.get(it.card).map((id, i) => `{\n"duration": ${num((p.durations[i] || step) / step)},\n"texture": SubResource("${id}")\n}`);
      subs.push(`[sub_resource type="SpriteFrames" id="${sf}"]\nanimations = [{\n"frames": [${frames.join(", ")}],\n"loop": ${!!it.loop},\n"name": &"default",\n"speed": ${num(fps)}\n}]`);
      nodes.push([`[node name=${str(name)} type="AnimatedSprite2D" parent="."]`, ...place, `sprite_frames = SubResource("${sf}")`, `animation = &"default"`, "centered = false", `offset = ${vec((p.box.x - anchor.x) * f, (p.box.y - anchor.y) * f)}`].filter(Boolean).join("\n"));
    }
    const start = it.start / fps;
    meta.push({ node: name, kind: p.kind, start, loop: !!it.loop, shown: it.visible !== false, hideAt: !it.loop && it.after === "hide" && p.kind !== "image" ? start + p.seconds : -1 });
  });
  if (opts.camera !== false) nodes.push(`[node name="Camera2D" type="Camera2D" parent="."]\nposition = ${vec(scene.w / 2, scene.h / 2)}`);
  const tscn = [`[gd_scene load_steps=${ext.length + subs.length + 1} format=3]`, ext.join("\n"), ...subs, ...nodes].filter(Boolean).join("\n\n") + "\n";
  files.push({ name: root + "/" + root + ".tscn", data: enc.encode(tscn) });
  files.push({ name: root + "/scene.gd", data: enc.encode(sceneScript(title, meta)) });
  if (codeScript) files.push({ name: root + "/vfx_code.gd", data: enc.encode(codeGodot(null)) });

  // ---- the same, engine-neutral ----
  const json = {
    generator: "光台 · 序列帧工作室", type: "scene", version: 1,
    name: title, stage: { w: scene.w, h: scene.h, background: scene.bg || null }, fps, frames: length, seconds: length / fps,
    // bottom to top
    items: items.map((it, k) => {
      const p = parts.get(it.card);
      return {
        node: names[k], name: it.name || p.name, kind: p.kind === "code" ? "vfx-code" : p.kind, source: p.kind === "actor" ? p.scene : p.kind === "code" ? "vfx_code.gd" : p.file,
        x: it.x, y: it.y, scale: it.scale || 1, rotation: it.rot || 0, flip: !!it.flip, opacity: (it.opacity ?? 100) / 100,
        start: it.start, startSeconds: it.start / fps, loop: !!it.loop, afterOnce: it.after, visible: it.visible !== false,
        size: { w: p.w, h: p.h }, anchor: { x: Math.floor(p.w / 2), y: p.h },
        ...(p.kind === "code" ? { params: p.params } : {}),
        ...(p.kind === "actor" || p.kind === "code" ? {} : { box: p.box, sheetScale: +p.f.toFixed(4), cell: p.cell, columns: p.cols, rows: p.rows, durations: p.durations.map(Math.round) }),
      };
    }),
    notes: {
      place: "每个元素以图片底边中点（anchor，向下取整）为锚点：先缩放（flip 时 x 取负），再旋转 rotation 度，锚点放在舞台的 (x, y)。",
      sheet: "图片 / 序列帧的精灵图裁到画面出现过的范围（box，原图像素）；只被缩小显示的图按它在场景里最大的显示比例预先缩小（sheetScale），每格 cell 像素，摆放时缩放要除以 sheetScale。",
      time: "元素在第 start 帧（场景帧率）出现，按自己的帧时长播放；loop = false 时播完停在最后一帧，afterOnce = hide 时播完消失。",
      actor: "kind = actor 的元素是一段分层动画，source 指向它的子场景，里面的 *_layers.json 是它的分层说明。",
    },
  };
  files.push({ name: root + "/" + root + "_scene.json", data: enc.encode(JSON.stringify(json, null, 2)) });
  return { blob: makeZip(files), items: items.length, actors: ai, sprites: si, codes: [...parts.values()].filter((x) => x && x.kind === "code").length, skipped: scene.items.length - items.length };
}

// the root script: every item comes in at its start time and plays; the
// whole scene runs `length` seconds and then loops (or stops)
function sceneScript(title, meta) {
  const items = meta.map((m) => `\t{"node": ${str(m.node)}, "kind": ${str(m.kind)}, "start": ${num(m.start)}, "loop": ${m.loop}, "shown": ${m.shown}, "hide_at": ${num(m.hideAt)}},`).join("\n");
  return `# 场景 —— 由「光台 · 序列帧工作室」导出：${title}
# Godot 4.x。舞台左上角是原点，Camera2D 对着舞台中间。
#   动画元素是子场景（actors/ 里，单独打开也能播），图片是 Sprite2D，序列帧是 AnimatedSprite2D，
#   纯代码特效是挂着 vfx_code.gd 的 Effect 子节点（不用图片，实时画）。
#   play() 从头播放整个场景：每个元素到了自己的开始时间才出现并开始播放；stop() 全部停下。
#   播到 length 秒时发出 scene_finished；loop 为真就接着从头播。
#   想在游戏里单独控制某个元素，直接取子节点，比如 $Hero.play() / $Hero.visible = false。
extends Node2D

signal scene_finished

@export var autoplay := true
@export var loop := true
@export var length := 1.0

const ITEMS := [
${items}
]

var _time := 0.0
var _playing := false
var _started := {}


func _ready() -> void:
	if autoplay:
		play()


func play() -> void:
	_time = 0.0
	_started.clear()
	_playing = true
	for it in ITEMS:
		var n := get_node_or_null(NodePath(it.node)) as CanvasItem
		if n == null:
			continue
		_stop_node(n, it)
		n.visible = false
	_update()


func stop() -> void:
	_playing = false
	for it in ITEMS:
		var n := get_node_or_null(NodePath(it.node))
		if n:
			_stop_node(n, it)


func _process(delta: float) -> void:
	if not _playing:
		return
	_time += delta
	if _time >= length:
		scene_finished.emit()
		if loop:
			play()
			return
		_playing = false
	_update()


func _update() -> void:
	for it in ITEMS:
		var n := get_node_or_null(NodePath(it.node)) as CanvasItem
		if n == null or not it.shown:
			continue
		if not _started.has(it.node) and _time >= it.start:
			_started[it.node] = true
			n.visible = true
			_start_node(n, it)
		if it.hide_at >= 0.0 and _time >= it.hide_at:
			n.visible = false


func _start_node(n: Node, it: Dictionary) -> void:
	match it.kind:
		"actor":
			n.set("loop", it.loop)
			n.call("play")
		"frames":
			var s := n as AnimatedSprite2D
			s.stop()
			s.frame = 0
			s.play(&"default")
		"code":
			var fx := n.get_node("Effect")
			fx.call("play")
			# a one-shot effect in an item that loops: again each time it ends
			var again := Callable(fx, "play")
			if it.loop and not fx.get("loop") and not fx.is_connected("finished", again):
				fx.connect("finished", again)


func _stop_node(n: Node, it: Dictionary) -> void:
	match it.kind:
		"actor":
			n.call("stop")
		"frames":
			(n as AnimatedSprite2D).stop()
		"code":
			n.get_node("Effect").call("stop")
`;
}

// the dialog: pick the options, export, download
export function openSceneExport(app, cardId) {
  const card = app.store.cards[cardId];
  if (!card) return;
  const scene = normalizeScene(card.params);
  if (!scene.items.length) { app.toast("场景里还没有元素，先在场景编辑器里放一些进来。", "warn"); return; }
  const saved = (app.settings && app.settings.godotScene) || {};
  const o = { mode: saved.mode || "animated", trails: saved.trails || "baked", vfx: saved.vfx || "baked", fx: saved.fx || "code", nearest: saved.nearest ?? true, camera: saved.camera ?? true };
  const select = (key, options) => {
    const s = el("select", { class: "f-select" }, ...options.map(([v, label]) => el("option", { value: v, selected: o[key] === v }, label)));
    s.onchange = () => { o[key] = s.value; };
    return s;
  };
  const row = (label, ctl) => el("div", { class: "f-row", style: { display: "flex", gap: "10px", alignItems: "center", marginBottom: "8px" } }, el("label", { style: { flex: "0 0 92px" } }, label), ctl);
  const check = (key, label) => { const b = el("input", { type: "checkbox", checked: !!o[key], onchange: () => { o[key] = b.checked; } }); return el("label", { class: "ed-check", style: { display: "flex", gap: "6px", alignItems: "center", marginBottom: "6px" } }, b, label); };
  const kinds = {};
  for (const it of scene.items) { const c = app.store.cards[it.card]; const t = c ? nodeType(c.type).title : "已删除"; kinds[t] = (kinds[t] || 0) + 1; }
  const summary = Object.entries(kinds).map(([k, c]) => k + " " + c).join("、");

  const m = openModal("导出 Godot 场景", {
    buttons: [
      { label: "取消", action: () => {} },
      { label: "导出 zip", primary: true, action: async () => {
        app.saveSetting({ godotScene: { ...o } });
        const name = card.title || "scene";
        const t = app.toast("正在导出场景…");
        try {
          const r = await exportSceneZip(app, cardId, o);
          t.remove();
          downloadBlob(r.blob, safe(name) + "_godot.zip");
          app.toast("已导出 " + r.items + " 个元素（" + r.actors + " 个动画子场景、" + r.sprites + " 张图" + (r.codes ? "、" + r.codes + " 个纯代码特效" : "") + "，" + fmtBytes(r.blob.size) + "）" + (r.skipped ? "，跳过 " + r.skipped + " 个没有画面的元素" : "") + "。解压后把文件夹放进 Godot 项目，打开里面的 .tscn。", "ok");
        } catch (err) {
          console.error(err);
          t.remove();
          app.toast("导出失败：" + err.message, "error");
        }
      } },
    ],
  });
  m.body.append(
    el("p", { class: "f-hint", style: { marginTop: 0 } }, "整个场景导出成一个 Godot 4 场景：舞台 " + scene.w + "×" + scene.h + "，" + scene.items.length + " 个元素（" + summary + "）。每个动画导出成一个分层子场景，同一个动画放了几次也只导出一份；图片和特效按各自的位置、大小、旋转摆好，到了开始时间才出现。"),
    row("动画节点", select("mode", [["animated", "AnimatedSprite2D（SpriteFrames）"], ["sprite", "Sprite2D + AnimationPlayer"]])),
    row("攻击拖尾", select("trails", [["baked", "烘焙成图片"], ["runtime", "运行时脚本 attack_trail.gd"], ["code", "纯代码 attack_trail_code.gd"]])),
    row("动画里的特效", select("vfx", [["baked", "烘焙成图片"], ["runtime", "运行时脚本 vfx_effect.gd"], ["code", "纯代码 vfx_code.gd"]])),
    row("场景里的特效", select("fx", [["code", "纯代码 vfx_code.gd（不带图片，Godot 里实时画，清晰、参数可改）"], ["baked", "烘焙成序列帧图片"]])),
    check("nearest", "像素画：最近邻采样（不模糊）"),
    check("camera", "加一个对着舞台中间的 Camera2D"),
    el("p", { class: "f-hint" }, "「攻击拖尾」「动画里的特效」只影响动画卡片里的拖尾和特效图层（和分层导出一样）；「场景里的特效」管直接放进场景的特效卡片（纯代码不做像素化；魔法阵的边缘特效只画火焰，其他边缘在纯代码里没有）。Godot 项目的窗口大小设成舞台尺寸，画面就和编辑器里一样。"),
  );
}
