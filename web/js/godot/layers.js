// 分层导出: an animation card's layers rendered one by one instead of flattened —
// a sheet per layer on the shared canvas and origin, plus a Godot 4 scene that
// stacks them (godot/scene.js) and a JSON description for other engines. Attack
// trails can instead go out as data drawn by the game (godot/trail.js).
//
// Stacked back up the layers give the card's own frames (trails/composite.js
// drawFrameStack): the parts that go under everything — trails' "back" sticks,
// 拖尾笔 strokes going round — come first, then the stack bottom to top. Layer
// opacity is baked in. A ghost layer's 遮挡 cuts its outline out of the layers
// below it, as the card does; 发光 ghosts get an additive material. Effect
// layers too can go out played by the game (godot/vfx.js).
import { normalizeAnim } from "../editor/doc.js";
import { getAssetCanvas } from "../core/assets.js";
import { el, createCanvas, canvasToBlob, downloadBlob, fmtBytes } from "../core/util.js";
import { openModal } from "../ui/modal.js";
import { loadTextures, drawTrail } from "../trails/composite.js";
import { renderGhost, ghostSettings } from "../trails/ghost.js";
import { drawStrokeLayer, strokeWraps, prefetchStrokeLayer } from "../trails/stroke.js";
import { drawVfxLayer, prefetchVfxLayer, layerBBox } from "../vfx/layer.js";
import { sheetGrid } from "../nodes/exporters.js";
import { makeZip } from "../imaging/zip.js";
import { trailData, trailGodot, attachStrips } from "./trail.js";
import { trailCodeData, strokeCodeData, trailCodeGodot } from "./trailcode.js";
import { vfxData, vfxGodot, attachVfxSheet } from "./vfx.js";
import { codeSupported, codeParams, codeGodot } from "./code.js";
import { prepareVfxCore } from "../vfx/effects.js";
import { godotScene, layeredScript, nodeNames } from "./scene.js";

const safe = (s) => String(s || "layer").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim() || "layer";
const enc = new TextEncoder();

const KINDS = { pixel: "像素", trail: "攻击拖尾", stroke: "拖尾笔", ghost: "残影", vfx: "特效" };

// the part of a canvas with anything in it, or null
export function alphaBox(c) {
  const { width: w, height: h } = c;
  const d = c.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!d[(y * w + x) * 4 + 3]) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

// Every layer of an animation card as frames: { w, h, fps, durations, entries },
// entries bottom to top as { name, kind, blend, canvases } or, for a trail drawn
// at run time, { name, kind: "trail", runtime: true, trail }.
export async function renderLayers(app, cardId, opts = {}) {
  const n = normalizeAnim(app.store.cards[cardId].params);
  if (!n.frames.length) throw new Error("空动画，没有可导出的帧。");
  const pid = app.store.projectId;
  const ids = new Set();
  for (const f of n.frames) for (const k in f.cels) ids.add(f.cels[k]);
  const loaded = new Map(await Promise.all([...ids].map(async (id) => [id, await getAssetCanvas(pid, id)])));
  await loadTextures(n.trails, (aid) => getAssetCanvas(pid, aid));
  const { w, h } = n;
  const frameIds = n.frames.map((f) => f.id);
  const drawCel = (l, j, into) => { const aid = n.frames[j].cels[l.id]; if (aid) into.drawImage(loaded.get(aid), 0, 0); };
  const bbox = (id, j) => layerBBox(n.layers, id, j, w, h, drawCel);
  const shown = n.layers.filter((l) => l.visible !== false);
  await Promise.all([
    ...shown.filter((l) => l.vfx).map((l) => prefetchVfxLayer(l, frameIds, { w, h, bbox })),
    ...shown.filter((l) => l.stroke).map((l) => prefetchStrokeLayer(l, frameIds, w, h)),
  ]);
  const byId = new Map(n.trails.map((t) => [t.id, t]));
  const runtime = opts.trails === "runtime" || opts.trails === "code", vfxRuntime = opts.vfx === "runtime" || opts.vfx === "code";

  const entries = [];
  for (const l of shown) {
    if (l.trail && !runtime) entries.push({ layer: l, part: "back", name: l.name + "（后方）", kind: "trail" });
    else if (l.stroke && strokeWraps(l.stroke) && opts.trails !== "code") entries.push({ layer: l, part: "back", name: l.name + "（后半圈）", kind: "stroke" });
  }
  for (const l of shown) {
    if (l.trail && runtime) { entries.push({ layer: l, name: l.name, kind: "trail", runtime: true, trail: byId.get(l.trail) }); continue; }
    if (l.vfx && vfxRuntime) { entries.push({ layer: l, name: l.name, kind: "vfx", runtime: true }); continue; }
    if (l.stroke && opts.trails === "code") { entries.push({ layer: l, name: l.name, kind: "stroke", runtime: true }); continue; }
    const kind = l.trail ? "trail" : l.ghost ? "ghost" : l.stroke ? "stroke" : l.vfx ? "vfx" : "pixel";
    entries.push({ layer: l, part: "front", name: l.name, kind, blend: l.ghost && ghostSettings(l).blend === "add" ? "add" : "normal" });
  }
  for (const e of entries) if (!e.runtime) e.canvases = [];

  for (let i = 0; i < n.frames.length; i++) {
    const below = [];
    for (const e of entries) {
      if (e.runtime) continue;
      const l = e.layer, c = createCanvas(w, h), g = c.getContext("2d");
      const op = (l.opacity ?? 100) / 100;
      g.globalAlpha = op;
      if (e.kind === "trail") drawTrail(g, byId.get(l.trail), frameIds, i, e.part, w, h);
      else if (e.kind === "stroke") drawStrokeLayer(g, l, frameIds, i, w, h, 0, 0, 1, "sync", e.part);
      else if (e.kind === "vfx") drawVfxLayer(g, l, frameIds, i, 0, 0, 1, { w, h, bbox });
      else if (e.kind === "ghost") {
        const gc = renderGhost(l, n.layers, frameIds, i, w, h, drawCel);
        if (gc) {
          g.drawImage(gc, 0, 0);
          const cover = Math.max(0, Math.min(1, (ghostSettings(l).cover ?? 0) / 100));
          if (gc.mask && cover > 0) for (const b of below) {
            const bg = b.getContext("2d");
            bg.globalCompositeOperation = "destination-out";
            bg.globalAlpha = op * cover;
            bg.drawImage(gc.mask, 0, 0);
            bg.globalCompositeOperation = "source-over";
            bg.globalAlpha = 1;
          }
        }
      } else drawCel(l, i, g);
      g.globalAlpha = 1;
      e.canvases.push(c);
      below.push(c);
    }
  }
  return {
    w, h, fps: n.fps, frameIds, trails: n.trails, bbox,
    durations: n.frames.map((f) => f.duration || 1000 / n.fps),
    entries,
  };
}

// origin choices: where (0, 0) of the scene sits on the canvas
export const ORIGINS = [["feet", "底部中心（脚底）"], ["center", "画布中心"], ["topleft", "左上角"]];
const originOf = (k, w, h) => (k === "topleft" ? { x: 0, y: 0 } : k === "center" ? { x: Math.floor(w / 2), y: Math.floor(h / 2) } : { x: Math.floor(w / 2), y: h });

// opts: { mode: "animated" | "sprite", origin, trails: "baked" | "runtime", nearest }
export async function exportLayeredZip(app, cardId, name, opts) {
  const r = await layeredFiles(app, cardId, name, opts);
  return { blob: makeZip(r.files), layers: r.layers };
}

// The files of a layered export, all under the folder dir (default: the
// name): { files: [{ name, data }], layers, scene (its .tscn's path), w, h,
// origin, fps, durations }. The scene export (godot/scenepack.js) puts each
// animation it holds in a folder of its own this way.
export async function layeredFiles(app, cardId, name, opts, dir) {
  const r = await renderLayers(app, cardId, opts);
  // opts.frameMs: every frame that long (in a scene, items step one frame per
  // scene frame, at the scene's rate)
  if (opts.frameMs) { r.durations = r.durations.map(() => opts.frameMs); r.fps = 1000 / opts.frameMs; }
  const root = safe(name);
  dir = dir || root;
  // its own files' names: the title, or (opts.fileName) something plain to refer to
  const base = opts.fileName ? safe(opts.fileName) : root;
  const files = [];
  const origin = originOf(opts.origin, r.w, r.h);
  const layers = [];
  for (const e of r.entries) {
    if (e.runtime && e.kind === "vfx" && opts.vfx === "code" && codeSupported(e.layer)) {
      // an effect drawn by the game itself: no pictures
      await prepareVfxCore(e.layer.vfx);
      const p = codeParams(e.layer, r.frameIds, r.w, r.h, r.fps, { bbox: r.bbox }, e.name);
      if (!p.follow.timeline.some(Boolean)) continue;
      layers.push({ name: e.name, kind: "code", params: p });
      continue;
    }
    if (e.runtime && e.kind === "vfx") {
      // the effect's frames as a sheet next to the script; when and where, as data
      const data = vfxData(e.layer, r.frameIds, r.w, r.h, r.fps, { bbox: r.bbox }, e.name);
      if (!data.timeline.some(Boolean)) continue;
      const n = String(layers.length + 1).padStart(2, "0");
      for (const x of await attachVfxSheet(data, e.layer, "files", "vfx/" + n + "_")) {
        files.push({ name: dir + "/" + x.file, data: new Uint8Array(await x.blob.arrayBuffer()) });
      }
      layers.push({ name: e.name, kind: "vfx", data });
      continue;
    }
    if (e.runtime && e.kind === "stroke") {
      // a 拖尾笔 stroke drawn by the game, with the same script
      const data = await strokeCodeData(e.layer, r.frameIds, r.w, r.h, r.fps, e.name);
      if (!data.trails[0].skeys.some(Boolean)) continue;
      layers.push({ name: e.name, kind: "trailcode", data });
      continue;
    }
    if (e.runtime && opts.trails === "code") {
      // a trail drawn by the game itself: no pictures (an imported texture or brush goes in the data)
      const data = e.trail && await trailCodeData([e.trail], r.frameIds, r.w, r.h, r.fps, e.name);
      if (!data || !data.trails.length) continue;
      layers.push({ name: e.name, kind: "trailcode", data });
      continue;
    }
    if (e.runtime) {
      const data = e.trail && trailData([e.trail], r.frameIds, r.w, r.h, r.fps, e.name);
      if (!data || !data.trails.length) continue;
      // its look (strip) and what flies off it (fx frames) as images next to the script
      const n = String(layers.length + 1).padStart(2, "0");
      for (const x of await attachStrips(data, [e.trail], r.frameIds, "files", "trails/" + n + "_")) {
        files.push({ name: dir + "/" + x.file, data: new Uint8Array(await x.blob.arrayBuffer()) });
      }
      layers.push({ name: e.name, kind: "trail", data });
      continue;
    }
    // trimmed to what the layer ever covers, the same box on every frame
    let box = null;
    for (const c of e.canvases) {
      const b = alphaBox(c);
      if (!b) continue;
      box = box ? { x0: Math.min(box.x0, b.x0), y0: Math.min(box.y0, b.y0), x1: Math.max(box.x1, b.x1), y1: Math.max(box.y1, b.y1) } : b;
    }
    if (!box) continue;
    const bw = box.x1 - box.x0 + 1, bh = box.y1 - box.y0 + 1;
    const { cols, rows } = sheetGrid(e.canvases.length, { layout: "square" });
    const sheet = createCanvas(bw * cols, bh * rows), sg = sheet.getContext("2d");
    e.canvases.forEach((c, i) => sg.drawImage(c, box.x0, box.y0, bw, bh, (i % cols) * bw, Math.floor(i / cols) * bh, bw, bh));
    // ASCII file names: some unzip tools still garble UTF-8 ones (the names stay on the nodes and in the JSON)
    const file = "layers/" + String(layers.length + 1).padStart(2, "0") + "_" + e.kind + (e.part === "back" ? "_back" : "") + ".png";
    files.push({ name: dir + "/" + file, data: new Uint8Array(await (await canvasToBlob(sheet)).arrayBuffer()) });
    layers.push({ name: e.name, kind: "sprite", layerKind: e.kind, file, blend: e.blend || "normal", box: { x: box.x0, y: box.y0, w: bw, h: bh }, cols, rows });
  }
  if (!layers.length) throw new Error("所有图层都是空的，没有可导出的内容。");
  if (!layers.some((l) => l.kind === "sprite")) throw new Error("没有图片图层：运行时的拖尾和特效需要跟着一个图层的帧走。");
  nodeNames(layers.map((l) => l.name)).forEach((nn, i) => { layers[i].node = nn; });

  const pack = { rootName: nodeNames([name])[0], fps: r.fps, durations: r.durations, origin, layers };
  files.push({ name: dir + "/" + base + ".tscn", data: enc.encode(godotScene(pack, { mode: opts.mode, nearest: opts.nearest, rootScript: "layered_animation.gd", trailScript: "attack_trail.gd", trailCodeScript: "attack_trail_code.gd", vfxScript: "vfx_effect.gd", codeScript: "vfx_code.gd" })) });
  files.push({ name: dir + "/layered_animation.gd", data: enc.encode(layeredScript(name)) });
  if (layers.some((l) => l.kind === "trail")) files.push({ name: dir + "/attack_trail.gd", data: enc.encode(trailGodot(null)) });
  if (layers.some((l) => l.kind === "trailcode")) files.push({ name: dir + "/attack_trail_code.gd", data: enc.encode(trailCodeGodot(null)) });
  if (layers.some((l) => l.kind === "vfx")) files.push({ name: dir + "/vfx_effect.gd", data: enc.encode(vfxGodot(null)) });
  if (layers.some((l) => l.kind === "code")) files.push({ name: dir + "/vfx_code.gd", data: enc.encode(codeGodot(null)) });

  // the same, engine-neutral
  const json = {
    generator: "光台 · 序列帧工作室", type: "layered-animation", version: 1,
    name, canvas: { w: r.w, h: r.h }, origin, fps: r.fps,
    frames: r.durations.map((d) => ({ duration: Math.round(d) })),
    // bottom to top; draw them in this order, every one at (box.x − origin.x, box.y − origin.y)
    layers: layers.map((l) => (l.kind === "code"
      ? { name: l.name, node: l.node, kind: "vfx-code", params: { ...l.params, follow: undefined }, timeline: l.params.follow.timeline }
      : l.kind === "trailcode"
      ? { name: l.name, node: l.node, kind: "attack-trail-code", data: l.data }
      : l.kind === "trail" || l.kind === "vfx"
      ? { name: l.name, node: l.node, kind: l.kind === "trail" ? "attack-trail-runtime" : "vfx-runtime", data: l.data }
      : { name: l.name, node: l.node, kind: l.layerKind, sheet: l.file, blend: l.blend, box: l.box, columns: l.cols, rows: l.rows,
        frames: r.durations.map((_, i) => ({ x: (i % l.cols) * l.box.w, y: Math.floor(i / l.cols) * l.box.h, w: l.box.w, h: l.box.h })) })),
    notes: {
      layers: "从下往上叠。每层每帧一格，所有帧的格子一样大（这一层在整段动画里出现过的范围），格子左上角对应画布上的 box.x, box.y。没出现的帧是透明格子。",
      blend: "normal = 普通透明混合；add = 叠加（发光的残影）。图层不透明度已经画进图片里。",
      runtime: "kind = attack-trail-runtime 的层是运行时画的攻击拖尾，vfx-runtime 的层是运行时播放的特效；data 的格式见 attack_trail.gd / vfx_effect.gd，或从像素编辑器导出的 JSON（notes 字段）。",
    },
  };
  files.push({ name: dir + "/" + base + "_layers.json", data: enc.encode(JSON.stringify(json, null, 2)) });
  return { files, layers, scene: dir + "/" + base + ".tscn", w: r.w, h: r.h, origin, fps: r.fps, durations: r.durations };
}

// the dialog on an animation card: pick the options, export, download
export function openLayeredExport(app, cardId) {
  const card = app.store.cards[cardId];
  if (!card) return;
  const n = normalizeAnim(card.params);
  if (!n.frames.length) { app.toast("空动画，没有可导出的帧。", "warn"); return; }
  const saved = (app.settings && app.settings.godotExport) || {};
  const o = { mode: saved.mode || "animated", origin: saved.origin || "feet", trails: saved.trails || "baked", vfx: saved.vfx || "baked", nearest: saved.nearest ?? (n.w <= 256 && n.h <= 256) };
  const select = (key, options) => {
    const s = el("select", { class: "f-select" }, ...options.map(([v, label]) => el("option", { value: v, selected: o[key] === v }, label)));
    s.onchange = () => { o[key] = s.value; };
    return s;
  };
  const row = (label, ctl) => el("div", { class: "f-row", style: { display: "flex", gap: "10px", alignItems: "center", marginBottom: "8px" } }, el("label", { style: { flex: "0 0 92px" } }, label), ctl);
  const near = el("input", { type: "checkbox", checked: o.nearest, onchange: () => { o.nearest = near.checked; } });
  const kinds = {};
  for (const l of n.layers) if (l.visible !== false) { const k = l.trail ? "trail" : l.ghost ? "ghost" : l.stroke ? "stroke" : l.vfx ? "vfx" : "pixel"; kinds[k] = (kinds[k] || 0) + 1; }
  const summary = Object.entries(kinds).map(([k, c]) => KINDS[k] + " " + c).join("、");

  const m = openModal("分层导出（Godot）", {
    buttons: [
      { label: "取消", action: () => {} },
      { label: "导出 zip", primary: true, action: async () => {
        app.saveSetting({ godotExport: { ...o } });
        const name = card.title || "animation";
        const t = app.toast("正在分层导出…");
        try {
          const { blob, layers } = await exportLayeredZip(app, cardId, name, o);
          t.remove();
          downloadBlob(blob, safe(name) + "_godot.zip");
          app.toast("已导出 " + layers.length + " 个图层（" + fmtBytes(blob.size) + "）。解压后把文件夹放进 Godot 项目，打开里面的 .tscn。", "ok");
        } catch (err) {
          t.remove();
          app.toast("导出失败：" + err.message, "error");
        }
      } },
    ],
  });
  m.body.append(
    el("p", { class: "f-hint", style: { marginTop: 0 } }, "每个可见图层单独导出成一张序列图（裁到它出现过的范围），再生成一个叠好的 Godot 4 场景。共 " + n.frames.length + " 帧，可见图层：" + (summary || "无") + "。"),
    row("场景节点", select("mode", [["animated", "AnimatedSprite2D（SpriteFrames）"], ["sprite", "Sprite2D + AnimationPlayer"]])),
    row("原点", select("origin", ORIGINS)),
    row("攻击拖尾", select("trails", [["baked", "烘焙成图片（和编辑器里完全一样）"], ["runtime", "运行时脚本 attack_trail.gd（可改色、清晰）"], ["code", "纯代码 attack_trail_code.gd（攻击拖尾和拖尾笔都不带图片，Godot 里实时画）"]])),
    row("特效", select("vfx", [["baked", "烘焙成图片"], ["runtime", "运行时脚本 vfx_effect.gd（可单独播放、改色、缩放）"], ["code", "纯代码 vfx_code.gd（不带图片，Godot 里实时画）"]])),
    el("label", { class: "ed-check", style: { display: "flex", gap: "6px", alignItems: "center" } }, near, "像素画：最近邻采样（不模糊）"),
    el("p", { class: "f-hint" }, "运行时拖尾：形状按棍子实时计算，带子上的火焰、光丝、流光是烘焙的贴图，飞出去的火星、闪光是烘焙的逐帧图；想要逐像素和编辑器一样，选「烘焙成图片」。拖尾笔、特效、残影都按图片导出，发光残影自动用叠加混合。"),
  );
}
