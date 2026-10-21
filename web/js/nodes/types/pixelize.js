import { defineNode } from "../registry.js";
import { makeStage, makePlayer } from "../view.js";
import { framesValue, imageValue } from "../data.js";
import { pixelizeAll, outputSize } from "../../imaging/pixelize.js";
import { PALETTES } from "../../imaging/color.js";
import { imageDataOf, canvasFromImageData } from "../../core/util.js";

defineNode({
  type: "pixelize",
  title: "高清转像素",
  category: "处理",
  icon: "▩",
  help: "把高清图（照片、插画、3D 渲染）重新画成指定尺寸的像素图：每个像素取所在区域的代表色，"
    + "再统一到一套色板。序列帧共用同一套色板，颜色不会逐帧跳动。"
    + "（AI 出的「像素风」图已经有网格，用「完美像素」更合适。）",
  inputs: [{ name: "src", label: "输入", accepts: ["image", "frames"] }],
  outputs: [{ name: "out", label: "输出", kind: "same" }],
  size: { w: 280, h: 300 },
  defaults: () => ({
    width: 64, height: 0, sample: "dominant", sat: 115, contrast: 105, alpha: 128,
    palette: "adaptive", colors: 24, dither: "none", despeckle: 1, outline: "none",
  }),

  evaluate(p, { src }) {
    const canvases = src.kind === "frames" ? src.frames.map((f) => f.canvas) : [src.canvas];
    const { outs, info } = pixelizeAll(canvases.map(imageDataOf), p);
    const cs = outs.map(canvasFromImageData);
    const value = src.kind === "frames"
      ? framesValue(src.frames.map((f, i) => ({ ...f, canvas: cs[i] })), info.w, info.h, { fps: src.fps })
      : imageValue(cs[0]);
    return {
      outputs: { out: value },
      info: {
        ...info,
        text: info.srcW + "×" + info.srcH + " → " + info.w + "×" + info.h + " · " + info.colors + " 色",
        warn: info.w > info.srcW ? "目标尺寸比原图还大，这一步只会放大，不会变得更像像素画。" : null,
      },
    };
  },

  mount(ctx) {
    const stage = makeStage({ fit: "integer" });
    ctx.body.append(stage.el);
    const player = makePlayer(stage, { fps: () => 8, emptyText: "连接高清图像或序列帧" });
    return {
      render() {
        const v = ctx.output("out");
        if (!v) { player.setValue(null); return; }
        player.setValue(v.kind === "frames" ? v : framesValue([{ canvas: v.canvas, index: 0 }], v.canvas.width, v.canvas.height));
      },
      destroy() { player.destroy(); },
    };
  },

  inspector(ctx, f) {
    const size = f.section("目标尺寸");
    size.pair(
      (s) => s.number("宽（像素）", "width", { min: 1, max: 1024 }),
      (s) => s.number("高（0 = 按比例）", "height", { min: 0, max: 1024 }),
    );
    size.custom((() => {
      const row = document.createElement("div");
      row.className = "f-buttons";
      for (const n of [16, 24, 32, 48, 64, 96, 128]) {
        const b = document.createElement("button");
        b.className = "btn small";
        b.textContent = String(n);
        b.title = "宽 " + n + " px，高按比例";
        b.onclick = () => ctx.set({ width: n, height: 0 });
        row.append(b);
      }
      return row;
    })());
    size.hint(() => {
      const v = ctx.input("src");
      if (!v) return "";
      const w = v.kind === "frames" ? v.w : v.canvas.width, h = v.kind === "frames" ? v.h : v.canvas.height;
      const o = outputSize(w, h, ctx.params());
      return "原图 " + w + "×" + h + " → " + o.w + "×" + o.h + "，每个像素对应原图约 " + (w / o.w).toFixed(1) + " × " + (h / o.h).toFixed(1) + " 的区域。";
    });

    const col = f.section("颜色");
    col.select("色板", "palette", [["adaptive", "自适应（本图配色）"], ...Object.entries(PALETTES).map(([k, v]) => [k, v.label + "（" + v.colors.length + " 色）"])], { wide: true });
    col.select("色数（自适应时）", "colors", [[8, "8 色"], [12, "12 色"], [16, "16 色"], [24, "24 色"], [32, "32 色"], [48, "48 色"], [64, "64 色"]]);
    col.select("抖动", "dither", [["none", "无（干净色块）"], ["bayer", "规则网格（经典像素风）"], ["fs", "误差扩散（细腻，偏噪）"]], { wide: true });
    col.slider("饱和度", "sat", { min: 0, max: 200, unit: "%" });
    col.slider("对比度", "contrast", { min: 50, max: 200, unit: "%" });

    const adv = f.section("取色与收尾");
    adv.select("取色方式", "sample", [["dominant", "主色（边缘干净，推荐）"], ["average", "平均色（过渡柔和）"]], { wide: true });
    adv.slider("透明阈值", "alpha", { min: 1, max: 255 });
    adv.select("去杂点", "despeckle", [[0, "关"], [1, "弱（孤立点）"], [2, "强"]]);
    adv.select("描边", "outline", [["none", "不描边"], ["dark", "色板最深色"], ["black", "纯黑"]]);

    f.readout(() => {
      const i = ctx.result() && ctx.result().info;
      if (!i || i.w == null) return null;
      return [["原图", i.srcW + " × " + i.srcH], ["像素图", i.w + " × " + i.h], ["实际颜色", i.colors + " 色"], ["清掉杂点", i.specks + " px"]];
    });
    f.status(() => {
      const r = ctx.result();
      if (r && r.error) return { text: r.error, tone: "error" };
      if (r && r.info && r.info.warn) return { text: r.info.warn, tone: "warn" };
      return null;
    });
    f.hint("出来的是 1:1 的小图，卡片上按整数倍放大显示。很小的尺寸（16–32）通常还需要手修几个像素；后面接「导出」时可以在输出尺寸里放大。");
  },
});
