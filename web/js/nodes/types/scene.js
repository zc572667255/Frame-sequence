// A scene (场景): pictures, animations and effects from other cards put
// together on one stage, exported as one Godot scene. Double-click opens the
// scene editor; the card itself plays the scene. It only refers to its cards,
// so it plays them as they are now.
import { defineNode } from "../registry.js";
import { makeStage, onTick } from "../view.js";
import { createCanvas } from "../../core/util.js";
import { SCENE_DEFAULTS, normalizeScene, sources, sceneLength, drawScene } from "../../scene/model.js";
import { framesValue } from "../data.js";

const openExport = (ctx) => import("../../godot/scenepack.js").then((m) => m.openSceneExport(ctx.app, ctx.id));

defineNode({
  type: "scene",
  title: "场景",
  category: "输出",
  icon: "◫",
  help: "把画布上的图片、动画、特效摆进同一个场景：调位置、大小、旋转、前后层级和出场时间，再整体导出成 Godot 4 场景包（每个动画是一个子场景）；从右边的「序列帧」输出连一张「导出」卡片，就能把整个场景导出成 GIF / WebP / 序列图。双击打开场景编辑器。",
  outputs: [{ name: "out", label: "序列帧", kind: "frames" }],
  size: { w: 320, h: 240 },
  defaults: () => ({ ...SCENE_DEFAULTS, items: [] }),
  persist: ["paused"],

  // the cards it shows: worked out first, and the scene again when they change
  refs: (p) => [...new Set((p.items || []).map((it) => it.card))],
  // its frames are only put together while something takes them (导出 and the
  // like): moving things about in the editor doesn't redraw the whole scene
  whenUsed: true,

  // the whole scene, frame by frame, at the stage's size: a 序列帧 to export
  // as GIF / WebP / a sheet, or to process further
  async evaluate(p, _inputs, ctx) {
    const scene = normalizeScene(p);
    if (!scene.items.length) return { info: { waiting: "空场景 · 双击打开场景编辑器" } };
    if (!ctx.used) return { info: { text: "连一张「导出」卡片就能导出 GIF / WebP / 序列图" } };
    const srcs = sources({ store: ctx.store, engine: ctx.engine }, scene), n = sceneLength(scene, srcs);
    const frames = [];
    let t0 = performance.now();
    for (let fi = 0; fi < n; fi++) {
      const c = createCanvas(scene.w, scene.h), g = c.getContext("2d");
      drawScene(g, scene, srcs, fi, { zoom: 1, prescale: true });
      frames.push({ canvas: c, index: fi, duration: 1000 / scene.fps });
      // a breath now and then, so the page keeps going meanwhile
      if (performance.now() - t0 > 30) { await new Promise((r) => setTimeout(r, 0)); t0 = performance.now(); }
    }
    return {
      outputs: { out: framesValue(frames, scene.w, scene.h, { fps: scene.fps }) },
      info: { text: n + " 帧 · " + scene.w + "×" + scene.h + " · " + scene.fps + " fps" },
    };
  },

  mount(ctx) {
    const stage = makeStage();
    ctx.body.append(stage.el);
    // the scene drawn at most this big on the card
    const MAX = 480;
    const frame = createCanvas(1, 1), g = frame.getContext("2d");
    let scene = null, srcs = null, n = 1, fi = 0, last = 0;
    const draw = () => {
      if (!scene || !scene.items.length) { stage.message("双击打开场景编辑器"); return; }
      const k = Math.min(1, MAX / Math.max(scene.w, scene.h));
      const w = Math.max(1, Math.round(scene.w * k)), h = Math.max(1, Math.round(scene.h * k));
      if (frame.width !== w || frame.height !== h) { frame.width = w; frame.height = h; }
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, w, h);
      g.setTransform(k, 0, 0, k, 0, 0);
      g.imageSmoothingEnabled = k < 1;
      drawScene(g, scene, srcs, fi % n, { zoom: k });
      stage.invalidate();
      stage.show(frame);
    };
    const refresh = () => {
      scene = normalizeScene(ctx.params());
      srcs = sources(ctx.app, scene);
      n = sceneLength(scene, srcs);
      draw();
    };
    const offTick = onTick((t) => {
      if (ctx.local.paused || !scene || !scene.items.length || n < 2) return;
      if (t - last >= 1000 / scene.fps) { last = t; fi = (fi + 1) % n; draw(); }
    });
    // a card it holds has something new
    const offResult = ctx.app.engine.on("result", (id) => { if (scene && scene.items.some((it) => it.card === id)) refresh(); });
    return {
      render: refresh,
      destroy() { offTick(); offResult(); },
    };
  },

  open(ctx) { ctx.app.openScene(ctx.id); },

  inspector(ctx, f) {
    f.readout(() => {
      const s = normalizeScene(ctx.params());
      const n = sceneLength(s, sources(ctx.app, s));
      return [["舞台", s.w + " × " + s.h], ["帧率", s.fps + " fps"], ["时长", n + " 帧"], ["元素", s.items.length + " 个"]];
    });
    f.buttons(["打开场景编辑器", () => ctx.app.openScene(ctx.id), { primary: true }],
      ["导出 Godot 场景…", () => openExport(ctx), { title: "导出成 Godot 4 场景包：每个动画一个子场景，图片和特效按图放好" }]);
    f.hint("双击卡片也能打开编辑器。场景只记录引用：改了原卡片，场景里跟着变。从「序列帧」输出连一张「导出」卡片，可以把整个场景（舞台大小、带背景色）导出成 GIF / WebP / 序列图 / PNG 包。");
  },
});
