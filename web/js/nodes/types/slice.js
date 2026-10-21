import { defineNode } from "../registry.js";
import { makeStage, makeFilmstrip } from "../view.js";
import { framesValue } from "../data.js";
import { computeGrid, cutFrames, guessFrameSize, MAX_FRAMES } from "../../imaging/slice.js";
import { planFrameFit, fitBlocker, applyFrameFit } from "../../imaging/fit.js";
import { imageDataOf } from "../../core/util.js";

function autoDetect(ctx, quiet) {
  const src = ctx.input("src");
  if (!src) return;
  const g = guessFrameSize(imageDataOf(src.canvas));
  ctx.set({ fw: g.fw, fh: g.fh, mx: 0, my: 0, sx: 0, sy: 0, excluded: [] });
  if (!quiet) ctx.toast("识别为 " + g.cols + " × " + g.rows + " 帧，单帧 " + g.fw + " × " + g.fh + "。不对的话直接改数字。");
}

defineNode({
  type: "slice",
  title: "切片",
  category: "处理",
  icon: "▤",
  help: "按单帧尺寸把整张序列帧图切成帧。点卡片上的格子可以排除 / 恢复某一帧（比如末尾的空白格）。"
    + "「帧内归位」能把越过格子边界的主体拉回自己的格子。",
  inputs: [{ name: "src", label: "序列帧图", accepts: ["image"] }],
  outputs: [{ name: "out", label: "序列帧", kind: "frames" }],
  size: { w: 340, h: 300 },
  defaults: () => ({
    fw: 0, fh: 0, mx: 0, my: 0, sx: 0, sy: 0, excluded: [],
    fit: { enabled: false, thr: 16, minArea: 4, margin: 0, smooth: false },
  }),

  evaluate(p, { src }) {
    const sheet0 = src.canvas;
    const W = sheet0.width, H = sheet0.height;
    const g = computeGrid(W, H, p);
    if (g.tooMany) throw new Error("检测到 " + g.total.toLocaleString() + " 帧，超过 " + MAX_FRAMES + " 帧上限，请调大单帧尺寸或帧间距。");

    let sheet = sheet0;
    let fit = null;
    const fo = p.fit || {};
    if (fo.enabled) {
      const plan = planFrameFit(imageDataOf(sheet0), g.cells, g.fw, g.fh, fo);
      const blocked = fitBlocker(plan, W, H);
      fit = { moved: plan.moved, squashed: plan.squashed, worst: plan.worst, tall: plan.tall, widest: plan.widest, total: plan.total, blocked };
      if (!blocked) sheet = applyFrameFit(sheet0, plan, g.fw, g.fh, fo.smooth);
    }

    const excluded = new Set(p.excluded || []);
    const active = g.cells.filter((c) => !excluded.has(c.index));
    const canvases = cutFrames(sheet, active, g.fw, g.fh);
    const frames = active.map((c, i) => ({ canvas: canvases[i], index: c.index }));
    return {
      outputs: { out: framesValue(frames, g.fw, g.fh) },
      info: {
        text: g.cols + "×" + g.rows + " · " + active.length + "/" + g.total + " 帧 · " + g.fw + "×" + g.fh,
        cols: g.cols, rows: g.rows, total: g.total, active: active.length, fw: g.fw, fh: g.fh, W, H, fit,
        warn: fit && fit.blocked ? fit.blocked
          : fit && fit.tall ? fit.tall + " 帧主体高度超出帧高：高度不做缩放，会从顶部对齐并裁掉底部，建议调大帧高。" : null,
      },
      view: { sheet, grid: g },
    };
  },

  mount(ctx) {
    const stage = makeStage();
    ctx.body.append(stage.el);
    stage.el.title = "点击格子：排除 / 恢复这一帧";

    // A fresh slice card connected to a sheet guesses the frame size once, instead
    // of starting at "the whole image is one frame".
    let guessedFor = null;

    stage.canvas.addEventListener("click", (e) => {
      const r = ctx.result();
      if (!r || !r.view) return;
      const { x, y } = stage.point(e);
      const g = r.view.grid;
      const cell = g.cells.find((c) => x >= c.x && x < c.x + g.fw && y >= c.y && y < c.y + g.fh);
      if (!cell) return;
      const ex = new Set(ctx.params().excluded || []);
      if (ex.has(cell.index)) ex.delete(cell.index); else ex.add(cell.index);
      ctx.set({ excluded: [...ex].sort((a, b) => a - b) });
    });

    return {
      render() {
        const src = ctx.input("src");
        const p = ctx.params();
        if (src && !p.fw && guessedFor !== src.ver) {
          guessedFor = src.ver;
          setTimeout(() => autoDetect(ctx, true), 0);
        }
        const r = ctx.result();
        if (!r || !r.view) { stage.message(src ? "" : "连接一张序列帧图"); return; }
        const { sheet, grid: g } = r.view;
        const excluded = new Set(p.excluded || []);
        stage.show(sheet, (c, w, h) => {
          const lw = Math.max(1, Math.round(Math.min(w, h) / 200));
          c.save();
          c.fillStyle = "rgba(10, 10, 14, 0.62)";
          for (const cell of g.cells) if (excluded.has(cell.index)) c.fillRect(cell.x, cell.y, g.fw, g.fh);
          c.strokeStyle = "rgba(242, 165, 65, 0.95)";
          c.lineWidth = lw;
          c.setLineDash([lw * 3, lw * 2]);
          for (const cell of g.cells) c.strokeRect(cell.x + lw / 2, cell.y + lw / 2, g.fw - lw, g.fh - lw);
          c.restore();
        }, r.key);
      },
    };
  },

  inspector(ctx, f) {
    f.pair((s) => s.number("单帧宽", "fw", { min: 1 }), (s) => s.number("单帧高", "fh", { min: 1 }));
    f.pair((s) => s.number("起始边距 X", "mx", { min: 0 }), (s) => s.number("起始边距 Y", "my", { min: 0 }));
    f.pair((s) => s.number("帧间距 X", "sx", { min: 0 }), (s) => s.number("帧间距 Y", "sy", { min: 0 }));
    f.buttons(
      ["自动识别帧尺寸", () => autoDetect(ctx, false), { primary: true }],
      ["全部启用", () => ctx.set({ excluded: [] })],
    );
    f.readout(() => {
      const i = ctx.result() && ctx.result().info;
      if (!i || i.cols == null) return null;
      return [["图片", i.W + " × " + i.H], ["列×行", i.cols + " × " + i.rows], ["总帧数", String(i.total)], ["已启用", String(i.active)]];
    });
    f.status(() => {
      const r = ctx.result();
      return r && r.error ? { text: r.error, tone: "error" } : null;
    });

    const strip = makeFilmstrip({
      onClick: (_i, it) => {
        const ex = new Set(ctx.params().excluded || []);
        if (ex.has(it.index)) ex.delete(it.index); else ex.add(it.index);
        ctx.set({ excluded: [...ex].sort((a, b) => a - b) });
      },
    });
    const filmSec = f.section("逐帧核对 · 点击排除");
    let filmKey = null;
    filmSec.custom(strip.el, () => {
      const r = ctx.result();
      const key = r ? r.key : null;
      if (key === filmKey) return;
      filmKey = key;
      if (!r || !r.view) { strip.set([]); return; }
      const { sheet, grid: g } = r.view;
      const ex = new Set(ctx.params().excluded || []);
      strip.set(g.cells.slice(0, 512).map((c) => ({
        src: sheet, sx: c.x, sy: c.y, sw: g.fw, sh: g.fh, label: c.index, index: c.index, dim: ex.has(c.index),
      })));
    });

    const fit = f.section("帧内归位 · 溢出修正", { collapsible: true, open: !!(ctx.params().fit || {}).enabled });
    fit.hint("去背景之后，有些帧的主体会越过格子边界，甚至骑在相邻帧上。开启后按连通块的重心把主体归到所属的帧，只平移必要的距离；宽度实在装不下才横向压缩，高度从不缩放。");
    fit.check("启用帧内归位", "fit.enabled");
    fit.pair((s) => s.number("不透明阈值", "fit.thr", { min: 0, max: 255 }), (s) => s.number("忽略碎片 (px)", "fit.minArea", { min: 0 }));
    fit.pair(
      (s) => s.number("帧内留白 (px)", "fit.margin", { min: 0 }),
      (s) => s.select("压缩采样", "fit.smooth", [[false, "邻近（硬边）"], [true, "平滑"]]),
    );
    fit.readout(() => {
      const i = ctx.result() && ctx.result().info;
      const r = i && i.fit;
      if (!r) return null;
      return [["帧数", String(r.total)], ["需平移", String(r.moved)], ["需压缩", String(r.squashed)],
        ["最强压缩", r.squashed ? Math.round(r.worst * 100) + "%" : "–"], ["高度超出", String(r.tall)]];
    });
    fit.status(() => {
      const i = ctx.result() && ctx.result().info;
      if (!i || !i.warn) return null;
      return { text: i.warn, tone: i.fit && i.fit.blocked ? "error" : "warn" };
    });
  },
});
