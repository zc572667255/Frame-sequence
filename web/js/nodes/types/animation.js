// An animation document: layers × frames of cels stored as project assets, so they
// can be edited in the pixel editor and survive independently of the pipeline that
// produced them. The card outputs every frame with its visible layers composited.
import { defineNode } from "../registry.js";
import { makeStage, makePlayer, makeFilmstrip } from "../view.js";
import { framesValue } from "../data.js";
import { normalizeAnim } from "../../editor/doc.js";
import { createCanvas } from "../../core/util.js";
import { loadTextures, drawFrameStack } from "../../trails/composite.js";
import { prefetchVfxLayer, layerBBox } from "../../vfx/layer.js";

defineNode({
  type: "animation",
  title: "动画",
  category: "素材",
  icon: "❖",
  help: "保存在项目里的一段动画，可以有多个图层。由处理结果「烘焙」得到，或者新建一张空的从头画；双击打开像素编辑器。",
  outputs: [{ name: "out", label: "序列帧", kind: "frames" }],
  size: { w: 260, h: 280 },
  defaults: () => ({ w: 32, h: 32, fps: 12, layers: [], frames: [], palette: [] }),

  async evaluate(p, _inputs, ctx) {
    const n = normalizeAnim(p);
    if (!n.frames.length) return { info: { waiting: "空动画 · 双击开始绘制（" + n.w + "×" + n.h + "）" } };
    const ids = new Set();
    for (const f of n.frames) for (const k in f.cels) ids.add(f.cels[k]);
    const loaded = new Map(await Promise.all([...ids].map(async (id) => [id, await ctx.asset(id)])));
    await loadTextures(n.trails, ctx.asset);
    const frameIds = n.frames.map((f) => f.id);
    // effect layers' frames rendered in the background first, all at once, so
    // putting the frames together below only draws them
    const drawCel = (l, j, into) => { const aid = n.frames[j].cels[l.id]; if (aid) into.drawImage(loaded.get(aid), 0, 0); };
    const vfxCtx = { bbox: (id, j) => layerBBox(n.layers, id, j, n.w, n.h, drawCel) };
    await Promise.all(n.layers.filter((l) => l.vfx && l.visible !== false).map((l) => prefetchVfxLayer(l, frameIds, vfxCtx)));
    const frames = n.frames.map((f, i) => {
      const c = createCanvas(n.w, n.h);
      const g = c.getContext("2d");
      // pixel, trail, ghost and effect layers in stack order (trails/composite.js)
      drawFrameStack(g, n.layers, n.trails, frameIds, i, n.w, n.h, (l, j, into) => {
        const aid = n.frames[j].cels[l.id];
        if (aid) into.drawImage(loaded.get(aid), 0, 0);
      });
      return { canvas: c, index: i, duration: f.duration || null };
    });
    return {
      outputs: { out: framesValue(frames, n.w, n.h, { fps: n.fps }) },
      info: { text: frames.length + " 帧 · " + n.layers.length + " 图层" + (n.trails.length ? "（含 " + n.trails.length + " 拖尾）" : "") + (n.layers.some((l) => l.ghost) ? "（含残影）" : "") + (n.layers.some((l) => l.vfx) ? "（含特效）" : "") + " · " + n.w + "×" + n.h },
    };
  },

  mount(ctx) {
    const stage = makeStage({ fit: "integer" });
    ctx.body.append(stage.el);
    const player = makePlayer(stage, { fps: () => ctx.params().fps || 12, emptyText: "双击打开像素编辑器" });
    return {
      render() { player.setValue(ctx.output("out")); },
      destroy() { player.destroy(); },
    };
  },

  open(ctx) { ctx.app.openEditor(ctx.id); },

  inspector(ctx, f) {
    f.slider("帧率", "fps", { min: 1, max: 60, unit: "fps" });
    f.readout(() => {
      const n = normalizeAnim(ctx.params());
      return [["尺寸", n.w + " × " + n.h], ["帧数", String(n.frames.length)], ["图层", String(n.layers.length)], ["色板", n.palette.length + " 色"]];
    });
    f.buttons(["打开像素编辑器", () => ctx.app.openEditor(ctx.id), { primary: true }]);
    const strip = makeFilmstrip();
    let key = null;
    f.section("帧").custom(strip.el, () => {
      const v = ctx.output("out");
      if (!v) { strip.set([]); key = null; return; }
      if (v.ver === key) return;
      key = v.ver;
      strip.set(v.frames.map((fr, i) => ({ src: fr.canvas, label: i + 1 + (fr.duration ? " · " + fr.duration + "ms" : "") })));
    });
    f.hint("双击卡片也能打开编辑器。新建的空动画默认 32×32，可以在编辑器里用「画布尺寸」修改。");
  },
});
