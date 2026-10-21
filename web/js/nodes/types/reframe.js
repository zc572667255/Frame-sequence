import { defineNode } from "../registry.js";
import { makeStage, toolButton } from "../view.js";
import { framesValue, imageValue } from "../data.js";
import { bboxOf, planReframe, renderReframe } from "../../imaging/reframe.js";
import { imageDataOf, createCanvas } from "../../core/util.js";

const SIZE_PRESETS = [16, 24, 32, 48, 64, 96, 128, 256];

// Subject boxes depend only on the incoming frames and the threshold, never on
// size / anchor / offset — so they are measured once per input and reused while
// the subject is being positioned. (Measuring means reading every frame back from
// the GPU, which is what made dragging stutter.)
const boxCache = new WeakMap(); // input value -> { thr, boxes }
function subjectBoxes(src, canvases, thr) {
  const hit = boxCache.get(src);
  if (hit && hit.thr === thr) return hit.boxes;
  const boxes = canvases.map((c) => bboxOf(imageDataOf(c), thr));
  boxCache.set(src, { thr, boxes });
  return boxes;
}

// One click: frame = the smallest box holding every visible pixel of every frame.
// Threshold 0 so faint glow / shadow edges count as content and survive the crop.
export const TRIM = { size: "fit", offX: 0, offY: 0, thr: 0, perFrame: false };
export function trimBlank(ctx) {
  ctx.set(TRIM);
  ctx.toast("已裁到所有帧的共同内容范围（只要不是全透明就保留）。需要留边或取整，在右侧面板调。");
}

function sourcesOf(v) {
  return v.kind === "frames" ? v.frames.map((f) => f.canvas) : [v.canvas];
}

defineNode({
  type: "reframe",
  title: "画框调整",
  category: "处理",
  icon: "⛶",
  help: "调整 PNG 的画框（画布尺寸），以及主体在画框里的位置：保持原尺寸 / 自定义尺寸 / 裁到主体加留边；"
    + "主体按九宫格锚点和边距摆放，也可以在卡片上直接拖动微调。序列帧整体移动，动作幅度不变。",
  inputs: [{ name: "src", label: "输入", accepts: ["image", "frames"] }],
  outputs: [{ name: "out", label: "输出", kind: "same" }],
  size: { w: 280, h: 300 },
  defaults: () => ({
    size: "keep", w: 64, h: 64, pad: 0,
    place: "subject", anchor: "1,2", margin: 0, offX: 0, offY: 0,
    shrink: false, perFrame: false, thr: 16, roundTo: 1,
  }),
  persist: ["onion"],

  evaluate(p, { src }) {
    const canvases = sourcesOf(src);
    const boxes = subjectBoxes(src, canvases, p.thr ?? 16);
    const plan = planReframe(canvases[0].width, canvases[0].height, boxes, p);
    const outs = canvases.map((c, i) => renderReframe(c, plan, i));
    const value = src.kind === "frames"
      ? framesValue(src.frames.map((f, i) => ({ ...f, canvas: outs[i] })), plan.W, plan.H, { fps: src.fps })
      : imageValue(outs[0]);
    const pl = plan.placed;
    return {
      outputs: { out: value },
      info: {
        text: plan.W + "×" + plan.H + " · 主体 " + pl.w + "×" + pl.h + " @ " + pl.x + "," + pl.y + (plan.s < 1 ? " · 缩小到 " + Math.round(plan.s * 100) + "%" : ""),
        W: plan.W, H: plan.H, srcW: canvases[0].width, srcH: canvases[0].height, placed: pl, union: plan.union, s: plan.s, blank: plan.blank,
        warn: plan.empty ? "没有检测到主体（全透明？），按整张图处理。"
          : plan.overflow ? "主体超出画框，超出部分会被裁掉。可以加大画框、减小边距，或勾选「主体太大时缩小」。" : null,
      },
      view: { placed: pl },
    };
  },

  mount(ctx) {
    const stage = makeStage({ fit: "integer", className: "framing" });
    ctx.body.append(stage.el);
    if (ctx.local.onion === undefined) ctx.local.onion = true;
    const moveBtn = toolButton("拖动主体", "在图上拖动主体位置，方向键 1px 微调（Shift 10px）", () => ctx.setLocal({ mode: ctx.local.mode === "move" ? null : "move" }));
    const onionBtn = toolButton("叠影", "叠加显示所有帧", () => ctx.setLocal({ onion: !ctx.local.onion }));
    const trimBtn = toolButton("裁空白", "一键裁掉所有帧四周的透明空白", () => trimBlank(ctx));
    ctx.tools.append(trimBtn, moveBtn, onionBtn);

    let drag = null;
    stage.canvas.addEventListener("pointerdown", (e) => {
      if (ctx.local.mode !== "move" || e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      const p = ctx.params();
      drag = { start: stage.point(e), offX: p.offX | 0, offY: p.offY | 0, n: Math.random() };
      stage.canvas.setPointerCapture(e.pointerId);
    });
    // pointer events can arrive far faster than frames; commit at most once per frame
    let pending = null, raf = 0;
    const flush = () => {
      raf = 0;
      if (!pending) return;
      const { offX, offY, n } = pending;
      pending = null;
      const p = ctx.params();
      if (offX !== p.offX || offY !== p.offY) ctx.set({ offX, offY }, { coalesce: ctx.id + ":drag" + n });
    };
    stage.canvas.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const pt = stage.point(e);
      pending = { offX: drag.offX + pt.x - drag.start.x, offY: drag.offY + pt.y - drag.start.y, n: drag.n };
      if (!raf) raf = requestAnimationFrame(flush);
    });
    const end = () => {
      if (raf) { cancelAnimationFrame(raf); flush(); }
      drag = null;
    };
    stage.canvas.addEventListener("pointerup", end);
    stage.canvas.addEventListener("pointercancel", end);

    // arrow keys nudge while the move tool is on and this card is selected
    const onKey = (e) => {
      if (ctx.local.mode !== "move" || !ctx.board.selection.has(ctx.id) || ctx.app.modalOpen()) return;
      if (e.target.closest && e.target.closest("input, textarea, select")) return;
      const step = e.shiftKey ? 10 : 1;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (!d) return;
      e.preventDefault();
      const p = ctx.params();
      ctx.set({ offX: (p.offX | 0) + d[0], offY: (p.offY | 0) + d[1] }, { coalesce: ctx.id + ":nudge" });
    };
    window.addEventListener("keydown", onKey);

    let composite = null, compKey = null;
    return {
      render() {
        moveBtn.classList.toggle("active", ctx.local.mode === "move");
        stage.el.classList.toggle("moving", ctx.local.mode === "move");
        const v = ctx.output("out");
        onionBtn.style.display = v && v.kind === "frames" && v.frames.length > 1 ? "" : "none";
        if (!v) { stage.message(ctx.input("src") ? "" : "连接图像或序列帧"); return; }
        const list = v.kind === "frames" ? v.frames.map((f) => f.canvas) : [v.canvas];
        const key = v.ver + ":" + !!ctx.local.onion + ":" + ctx.local.mode;
        if (key !== compKey) {
          compKey = key;
          composite = createCanvas(list[0].width, list[0].height);
          const c = composite.getContext("2d");
          if (ctx.local.onion && list.length > 1) {
            c.globalAlpha = Math.max(0.12, Math.min(0.6, 1.6 / list.length));
            for (const f of list) c.drawImage(f, 0, 0);
          } else {
            c.drawImage(list[0], 0, 0);
          }
        }
        const r = ctx.result();
        const pl = r && r.view ? r.view.placed : null;
        stage.show(composite, pl ? (c, w, h) => {
          // subject box, drawn on the pixel grid so it reads at any zoom
          const lw = Math.max(1, Math.round(Math.max(w, h) / 160));
          c.save();
          c.strokeStyle = "rgba(124, 108, 255, 0.95)";
          c.lineWidth = lw;
          c.setLineDash([lw * 2, lw * 2]);
          c.strokeRect(pl.x - lw / 2, pl.y - lw / 2, pl.w + lw, pl.h + lw);
          c.restore();
        } : null, key);
      },
      destroy() { window.removeEventListener("keydown", onKey); },
    };
  },

  inspector(ctx, f) {
    f.buttons(["一键裁掉空白", () => trimBlank(ctx), { primary: true, title: "分析每一帧上下左右最外侧的像素，取所有帧的共同范围作为画框" }]);
    f.readout(() => {
      const i = ctx.result() && ctx.result().info;
      if (!i || !i.blank) return null;
      const b = i.blank, u = i.union;
      return [["四边空白（上 / 下）", b.top + " / " + b.bottom], ["四边空白（左 / 右）", b.left + " / " + b.right],
        ["内容范围", u.w + " × " + u.h], ["裁空白后最小画框", (u.w + 2 * (ctx.params().pad | 0)) + " × " + (u.h + 2 * (ctx.params().pad | 0))]];
    });
    const frame = f.section("画框尺寸");
    frame.select("尺寸", "size", [["keep", "保持原尺寸"], ["custom", "自定义尺寸"], ["fit", "裁到主体 + 留边"]], { wide: true });
    frame.pair(
      (s) => s.number("宽", "w", { min: 1, max: 8192, extra: { size: "custom" } }),
      (s) => s.number("高", "h", { min: 1, max: 8192, extra: { size: "custom" } }),
    );
    frame.custom((() => {
      const row = document.createElement("div");
      row.className = "f-buttons";
      for (const n of SIZE_PRESETS) {
        const b = document.createElement("button");
        b.className = "btn small";
        b.textContent = n + "²";
        b.title = n + " × " + n;
        b.onclick = () => ctx.set({ size: "custom", w: n, h: n });
        row.append(b);
      }
      return row;
    })());
    frame.pair(
      (s) => s.number("留边（裁到主体时四周各留）", "pad", { min: 0, max: 1024 }),
      (s) => s.select("尺寸取整（裁到主体时）", "roundTo", [[1, "不取整"], [2, "2 的倍数"], [4, "4 的倍数"], [8, "8 的倍数"], [16, "16 的倍数"], [32, "32 的倍数"]]),
    );
    frame.hint("取整多出来的空间按下面的锚点分配：比如锚点在「下中」，多出的高度补在上方，宽度左右平分，脚底位置不变。");

    const pos = f.section("主体位置");
    pos.select("摆放方式", "place", [["subject", "按主体摆放（推荐）"], ["canvas", "整张图按锚点摆放"]], { wide: true });
    pos.anchor("锚点", "anchor");
    pos.number("距锚定边的边距", "margin", { min: 0, max: 4096 });
    pos.pair(
      (s) => s.number("偏移 X", "offX", {}),
      (s) => s.number("偏移 Y", "offY", {}),
    );
    pos.buttons(
      ["拖动主体", () => ctx.setLocal({ mode: ctx.local.mode === "move" ? null : "move" }), {
        sync: (b) => b.classList.toggle("primary", ctx.local.mode === "move"),
      }],
      ["偏移清零", () => ctx.set({ offX: 0, offY: 0 })],
    );
    pos.check("主体太大时等比缩小装进画框", "shrink", { hint: "只缩不放；像素画非整数倍缩小会丢像素，最好先选够大的画框。" });
    pos.check("逐帧各自摆放", "perFrame", { hint: "默认所有帧按整体范围一起移动，动作幅度不变；勾上后每一帧单独居中 / 贴底，会抹掉位移动作。" });
    pos.slider("不透明阈值", "thr", { min: 0, max: 254 });

    f.readout(() => {
      const i = ctx.result() && ctx.result().info;
      if (!i || i.W == null) return null;
      return [["原尺寸", i.srcW + " × " + i.srcH], ["画框", i.W + " × " + i.H],
        ["主体", i.placed.w + " × " + i.placed.h], ["主体左上角", i.placed.x + ", " + i.placed.y],
        ["距右 / 下", (i.W - i.placed.x - i.placed.w) + ", " + (i.H - i.placed.y - i.placed.h)], ["缩放", Math.round(i.s * 100) + "%"]];
    });
    f.status(() => {
      const r = ctx.result();
      if (r && r.error) return { text: r.error, tone: "error" };
      if (r && r.info && r.info.warn) return { text: r.info.warn, tone: "warn" };
      return null;
    });
  },
});
