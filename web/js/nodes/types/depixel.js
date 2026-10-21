import { defineNode } from "../registry.js";
import { makeStage } from "../view.js";
import { mapRaster, stillOf } from "../data.js";
import { depixel } from "../../imaging/depixel.js";

defineNode({
  type: "depixel",
  title: "完美像素",
  category: "处理",
  icon: "▦",
  help: "把 AI 出的「像素风」图收拾成真像素画：默认只归并杂色（尺寸和位置一个像素都不动）；"
    + "进阶模式会检测像素网格，把每个像素块压成一格纯色，或直接缩成 1:1 真像素。",
  inputs: [{ name: "src", label: "输入", accepts: ["image", "frames"] }],
  outputs: [{ name: "out", label: "输出", kind: "same" }],
  size: { w: 300, h: 280 },
  defaults: () => ({ mode: "color", colors: 64, palette: "adaptive", despeckle: 1, blockW: 0, blockH: 0, phaseX: "", phaseY: "" }),

  evaluate(p, { src }) {
    const { value, stats } = mapRaster(src, (im) => depixel(im, p));
    const i = stats[0].info;
    const frames = stats.length;
    let text;
    if (i.mode === "color") {
      text = i.before + " → " + i.after + " 色" + (i.specks ? " · 清噪点 " + i.specks : "");
    } else {
      text = "块 " + i.blockW.toFixed(2) + "×" + i.blockH.toFixed(2) + " · " + i.gridW + "×" + i.gridH + " 格 · " + i.after + " 色";
    }
    if (frames > 1) text += " · 首帧";
    return {
      outputs: { out: value },
      info: {
        ...i, text, frames,
        warn: i.weak ? "周期性较弱，可能本来就是 1:1 真像素，或网格被打散了，建议手动指定块大小。" : null,
      },
    };
  },

  mount(ctx) {
    const stage = makeStage();
    ctx.body.append(stage.el);
    return {
      render() {
        const v = ctx.output("out") || ctx.input("src");
        const still = stillOf(v);
        if (still) stage.show(still, null, v.ver); else stage.message("连接图像或序列帧");
      },
    };
  },

  inspector(ctx, f) {
    f.select("方式", "mode", [
      ["color", "只去杂色（不动几何）"],
      ["same", "对齐像素网格（原尺寸）"],
      ["down", "缩到 1:1 真像素（改尺寸）"],
    ], { wide: true });
    f.pair(
      (s) => s.select("目标色数", "colors", [[16, "16 色"], [24, "24 色"], [32, "32 色"], [48, "48 色"], [64, "64 色"], [96, "96 色"], [128, "128 色"], [256, "256 色"], [0, "不限"]]),
      (s) => s.select("配色", "palette", [["adaptive", "自适应（本图配色）"], ["resurrect", "Resurrect 64"]]),
    );
    f.select("去噪点", "despeckle", [[0, "关"], [1, "弱（清孤立点）"], [2, "强"]]);

    f.readout(() => {
      const i = ctx.result() && ctx.result().info;
      if (!i || i.before == null) return null;
      const rows = [["尺寸", i.w + " × " + i.h], ["颜色", i.before + " → " + i.after], ["清掉噪点", (i.specks || 0) + " px"]];
      if (i.mode !== "color") {
        rows.push(["像素块", i.blockW.toFixed(2) + " × " + i.blockH.toFixed(2)], ["像素点网格", i.gridW + " × " + i.gridH],
          ["相位", i.phaseX.toFixed(2) + " / " + i.phaseY.toFixed(2)], ["周期强度", i.confidence + "%"]);
      }
      if (i.frames > 1) rows.push(["说明", "以上为第 1 帧；共 " + i.frames + " 帧逐帧处理"]);
      return rows;
    });
    f.status(() => {
      const r = ctx.result();
      if (r && r.error) return { text: r.error, tone: "error" };
      if (r && r.info && r.info.warn) return { text: r.info.warn, tone: "warn" };
      return null;
    });

    const adv = f.section("进阶：网格参数", { collapsible: true });
    adv.hint("块大小允许小数，0 表示自动检测。相位 = 第一条格线距左 / 上边缘的像素数，留空表示自动。只在「对齐像素网格」和「缩到 1:1」方式下生效。");
    adv.pair(
      (s) => s.number("块宽", "blockW", { min: 0, step: 0.01, integer: false }),
      (s) => s.number("块高", "blockH", { min: 0, step: 0.01, integer: false }),
    );
    adv.pair(
      (s) => s.number("相位 X", "phaseX", { step: 0.1, integer: false, allowEmpty: true, placeholder: "自动" }),
      (s) => s.number("相位 Y", "phaseY", { step: 0.1, integer: false, allowEmpty: true, placeholder: "自动" }),
    );
    adv.buttons(
      ["填入检测值", () => {
        const i = ctx.result() && ctx.result().info;
        if (!i || i.blockW == null) { ctx.toast("先切换到网格方式，检测完成后再填入。"); return; }
        ctx.set({ blockW: +i.blockW.toFixed(3), blockH: +i.blockH.toFixed(3), phaseX: +i.phaseX.toFixed(2), phaseY: +i.phaseY.toFixed(2) });
      }],
      ["恢复自动", () => ctx.set({ blockW: 0, blockH: 0, phaseX: "", phaseY: "" })],
    );
  },
});
