import { defineNode } from "../registry.js";
import { makeStage, toolButton } from "../view.js";
import { framesValue } from "../data.js";
import { computeAlignment } from "../../imaging/align.js";
import { createCanvas } from "../../core/util.js";

defineNode({
  type: "align",
  title: "主体对齐",
  category: "处理",
  icon: "⊥",
  help: "检测每帧主体的像素范围并平移对齐，消除抖动：垂直以最底部像素为基准，水平基准可选。"
    + "对齐目标取各帧中值，个别夸张的动作帧不会带偏整体；画布按需自动扩展，任何一帧都不会被裁掉。",
  inputs: [{ name: "src", label: "序列帧", accepts: ["frames"] }],
  outputs: [{ name: "out", label: "序列帧", kind: "frames" }],
  size: { w: 280, h: 280 },
  defaults: () => ({ xMode: "centroid", axis: "both", thr: 16 }),
  persist: ["onion"],

  evaluate(p, { src }) {
    const canvases = src.frames.map((f) => f.canvas);
    const a = computeAlignment(canvases, src.w, src.h, { thr: p.thr, xMode: p.xMode, axis: p.axis });
    const frames = src.frames.map((f, i) => {
      const c = createCanvas(a.outW, a.outH);
      c.getContext("2d").drawImage(f.canvas, a.offsets[i].dx, a.offsets[i].dy);
      return { ...f, canvas: c };
    });
    return {
      outputs: { out: framesValue(frames, a.outW, a.outH, { fps: src.fps }) },
      info: {
        text: a.empty ? "所有帧都是空的" : "对齐后 " + a.outW + "×" + a.outH + "（+" + (a.outW - src.w) + " / +" + (a.outH - src.h) + "）",
        outW: a.outW, outH: a.outH, padW: a.outW - src.w, padH: a.outH - src.h,
      },
      view: { baseline: a.targetY },
    };
  },

  mount(ctx) {
    const stage = makeStage();
    ctx.body.append(stage.el);
    if (ctx.local.onion === undefined) ctx.local.onion = true;
    const onionBtn = toolButton("叠影", "叠加显示所有帧，检查是否对齐", () => ctx.setLocal({ onion: !ctx.local.onion }));
    ctx.tools.append(onionBtn);
    let composite = null, compKey = null;

    return {
      render() {
        onionBtn.classList.toggle("active", !!ctx.local.onion);
        const r = ctx.result();
        const v = ctx.output("out");
        if (!v || !v.frames.length) { stage.message(ctx.input("src") ? "" : "连接序列帧"); return; }
        const key = v.ver + ":" + ctx.local.onion;
        if (key !== compKey) {
          compKey = key;
          composite = createCanvas(v.w, v.h);
          const c = composite.getContext("2d");
          if (ctx.local.onion) {
            // every frame at low opacity: aligned feet stack into one crisp silhouette,
            // leftover jitter shows up as a ghosted double edge
            c.globalAlpha = Math.max(0.12, Math.min(0.6, 1.6 / v.frames.length));
            for (const f of v.frames) c.drawImage(f.canvas, 0, 0);
          } else {
            c.drawImage(v.frames[0].canvas, 0, 0);
          }
        }
        const base = r && r.view ? r.view.baseline : null;
        stage.show(composite, base == null ? null : (c, w) => {
          c.fillStyle = "rgba(255, 92, 92, 0.85)";
          c.fillRect(0, base + 1, w, Math.max(1, Math.round(w / 160)));
        }, key);
      },
    };
  },

  inspector(ctx, f) {
    f.pair(
      (s) => s.select("水平基准", "xMode", [["centroid", "主体质心（推荐）"], ["bbox", "包围盒中心"], ["bottom", "最底部像素中心"]]),
      (s) => s.select("对齐方向", "axis", [["both", "水平 + 垂直"], ["y", "仅垂直"], ["x", "仅水平"]]),
    );
    f.slider("不透明阈值", "thr", { min: 0, max: 255 });
    f.readout(() => {
      const i = ctx.result() && ctx.result().info;
      if (!i || i.outW == null) return null;
      return [["对齐后单帧", i.outW + " × " + i.outH], ["较原尺寸扩展", "+" + i.padW + " / +" + i.padH]];
    });
    f.hint("卡片上的红线是对齐后的脚底基准线。想关掉对齐又不想删节点，可以点标题栏的「旁路」。");
  },
});
