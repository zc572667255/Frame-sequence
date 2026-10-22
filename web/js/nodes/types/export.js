import { defineNode } from "../registry.js";
import { makeStage } from "../view.js";
import { el, downloadBlob, fmtBytes } from "../../core/util.js";
import { describeOutput } from "../../imaging/output.js";
import { outputSize, renderSheet, sheetGrid, SHEET_LAYOUTS, exportGif, exportWebp, exportSheet, exportPngZip, softAlphaShare } from "../exporters.js";
import { openModal } from "../../ui/modal.js";

async function run(ctx, label, fn) {
  const v = ctx.input("src");
  if (!v || !v.frames.length) { ctx.toast("没有可导出的帧。", "warn"); return; }
  ctx.toast("正在生成 " + label + "…");
  await new Promise((r) => setTimeout(r, 30));
  try {
    await fn(v, ctx.params());
  } catch (err) {
    console.error(err);
    ctx.toast("导出失败：" + err.message, "error");
  }
}

const actions = {
  gif: (ctx, matte) => run(ctx, "GIF", (v, p) => {
    const blob = exportGif(v, { ...p, gifMatte: matte || null });
    downloadBlob(blob, (p.name || "animation") + ".gif");
    ctx.toast("已生成 " + v.frames.length + " 帧的 GIF（" + fmtBytes(blob.size) + "）" + (matte ? "，底色 " + matte : "") + "。", "ok");
  }),
  webp: (ctx) => run(ctx, "WebP", async (v, p) => {
    const blob = await exportWebp(v, p);
    downloadBlob(blob, (p.name || "animation") + ".webp");
    const q = p.webpQuality ?? 1;
    ctx.toast("已生成 " + v.frames.length + " 帧的" + (q >= 1 ? "无损" : "有损（质量 " + Math.round(q * 100) + "）") + " WebP 动画（" + fmtBytes(blob.size) + "）。", "ok");
  }),
  sheet: (ctx) => run(ctx, "序列帧图", async (v, p) => {
    const r = await exportSheet(v, p);
    const name = p.name || "animation";
    downloadBlob(r.png, name + ".png");
    downloadBlob(new Blob([JSON.stringify(r.json, null, 2)], { type: "application/json" }), name + ".json");
    ctx.toast("已导出序列帧图：" + r.info.perRow + " × " + r.info.rows + " 帧，单帧 " + r.info.w + "×" + r.info.h + "，附带 JSON 描述。", "ok");
  }),
  zip: (ctx) => run(ctx, "PNG 序列", async (v, p) => {
    const blob = await exportPngZip(v, p);
    downloadBlob(blob, (p.name || "animation") + "_frames.zip");
    ctx.toast("已打包 " + v.frames.length + " 张 PNG（" + fmtBytes(blob.size) + "）。", "ok");
  }),
};

// GIF from the card: GIF transparency is all or nothing, so frames with a lot
// of see-through (glows, soft fades) are checked first and the choice offered:
// WebP instead, a background colour to lay them on, or GIF as it is
function gifDialog(ctx) {
  const v = ctx.input("src");
  if (!v || !v.frames.length) { ctx.toast("没有可导出的帧。", "warn"); return; }
  const share = softAlphaShare(v);
  if (share < 0.03) { actions.gif(ctx); return; }
  const matte = el("input", { type: "color", value: ctx.params().gifMatteColor || "#000000", style: { width: "48px", height: "26px", verticalAlign: "middle" } });
  const m = openModal("导出 GIF", {
    buttons: [
      { label: "改导出 WebP", primary: true, action: () => { actions.webp(ctx); } },
      { label: "垫底色导出 GIF", action: () => { ctx.set({ gifMatteColor: matte.value }); actions.gif(ctx, matte.value); } },
      { label: "仍然导出 GIF", action: () => { actions.gif(ctx); } },
    ],
  });
  m.body.append(
    el("p", null, "这段动画有 " + Math.round(share * 100) + "% 的可见像素是半透明的（光效、辉光、渐隐）。"),
    el("p", { class: "f-hint" }, "GIF 只有全透明和不透明两种，半透明的部分会变成硬边和杂色。WebP 动画支持半透明，大多数游戏引擎和浏览器都能用。"),
    el("p", null, "或者把每帧垫在一个底色上再导出 GIF（适合背景固定的场合）：", matte),
  );
}

// 序列图 from the card: choose the layout first, with the result in numbers and
// a preview; the choice is kept on the node
function sheetDialog(ctx) {
  const v = ctx.input("src");
  if (!v || !v.frames.length) { ctx.toast("没有可导出的帧。", "warn"); return; }
  const n = v.frames.length, p0 = ctx.params(), g0 = sheetGrid(n, p0);
  let layout = g0.layout, cols = g0.cols;
  const sel = el("select", { class: "f-select" }, ...SHEET_LAYOUTS.map(([k, label]) => el("option", { value: k, selected: k === layout }, label)));
  const num = el("input", { type: "number", class: "f-input", min: 1, max: n, value: cols, style: { width: "80px", flex: "0 0 80px" } });
  const info = el("div", { class: "f-hint" });
  const pv = el("canvas", { style: { maxWidth: "100%", maxHeight: "260px", background: "repeating-conic-gradient(#3a3d46 0% 25%, #2c2f37 0% 50%) 0 0 / 16px 16px", imageRendering: "pixelated", display: "block", margin: "8px auto 0" } });
  const params = () => ({ ...ctx.params(), layout, perRow: cols });
  const update = () => {
    const g = sheetGrid(n, params());
    num.value = g.cols;
    const s = outputSize(ctx.params(), v);
    info.textContent = "共 " + n + " 帧 → " + g.cols + " 列 × " + g.rows + " 行" + (g.cols * g.rows > n ? "（最后一行空 " + (g.cols * g.rows - n) + " 格）" : "") + "，单帧 " + s.w + "×" + s.h + "，整图 " + s.w * g.cols + "×" + s.h * g.rows;
    const r = renderSheet(v, params());
    pv.width = r.sheet.width; pv.height = r.sheet.height;
    pv.getContext("2d").drawImage(r.sheet, 0, 0);
  };
  sel.onchange = () => { layout = sel.value; if (layout === "cols") cols = Math.max(1, +num.value || 1); else cols = sheetGrid(n, { layout }).cols; update(); };
  num.oninput = () => { const c = Math.round(+num.value); if (c >= 1) { layout = "cols"; sel.value = "cols"; cols = Math.min(c, n); update(); } };
  const m = openModal("导出序列帧图", {
    buttons: [
      { label: "取消", action: () => {} },
      { label: "导出 PNG + JSON", primary: true, action: () => { ctx.set({ layout, perRow: cols }); actions.sheet(ctx); } },
    ],
  });
  m.body.append(
    el("div", { class: "f-row", style: { display: "flex", gap: "10px", alignItems: "center" } },
      el("label", null, "排列 "), sel, el("label", null, "列数 "), num),
    info, pv);
  update();
}

defineNode({
  type: "export",
  title: "导出",
  category: "输出",
  icon: "⇩",
  help: "把序列帧导出为 GIF、动画 WebP（可无损、支持半透明）、新的序列帧整图（附 JSON）或逐帧 PNG 压缩包。可以设定输出单帧尺寸，按等比缩放、裁切填满、拉伸或 1:1 裁切。",
  inputs: [{ name: "src", label: "序列帧", accepts: ["frames"] }],
  size: { w: 300, h: 280 },
  defaults: () => ({ name: "animation", custom: false, w: 0, h: 0, mode: "contain", anchor: "1,1", layout: "row", perRow: 0, fps: 12, webpQuality: 1 }),

  mount(ctx) {
    const stage = makeStage();
    const bar = el("div", { class: "transport" },
      el("button", { class: "btn small primary", onclick: () => gifDialog(ctx) }, "GIF"),
      el("button", { class: "btn small primary", onclick: () => actions.webp(ctx) }, "WebP"),
      el("button", { class: "btn small", onclick: () => sheetDialog(ctx) }, "序列图"),
      el("button", { class: "btn small", onclick: () => actions.zip(ctx) }, "PNG 包"),
    );
    ctx.body.append(stage.el, bar);
    let lastKey = null;
    return {
      render() {
        const v = ctx.input("src");
        if (!v || !v.frames.length) { lastKey = null; stage.message("连接序列帧"); return; }
        const p = ctx.params();
        const key = v.ver + JSON.stringify(p);
        if (key === lastKey) return;
        lastKey = key;
        // the sheet preview is the real export layout, so what you see is what you get
        stage.show(renderSheet(v, p).sheet);
      },
    };
  },

  inspector(ctx, f) {
    f.text("文件名", "name");
    const size = f.section("输出单帧尺寸");
    size.check("自定义输出尺寸", "custom");
    // until a size is typed, the fields show the incoming frame size
    const shown = (axis) => (val) => {
      const v = ctx.input("src");
      return ctx.params().custom || !v ? val : v[axis];
    };
    size.pair(
      (s) => s.number("宽", "w", { min: 1, extra: { custom: true }, format: shown("w") }),
      (s) => s.number("高", "h", { min: 1, extra: { custom: true }, format: shown("h") }),
    );
    size.select("尺寸模式", "mode", [
      ["contain", "等比缩放 · 完整显示（留透明边）"],
      ["cover", "等比缩放 · 裁切填满"],
      ["scale", "拉伸填充（可能变形）"],
      ["crop", "裁切 / 扩画布（1:1，不缩放）"],
    ], { wide: true });
    size.select("锚点", "anchor", [
      ["0,0", "左上"], ["1,0", "上中"], ["2,0", "右上"], ["0,1", "左中"], ["1,1", "居中"],
      ["2,1", "右中"], ["0,2", "左下"], ["1,2", "下中"], ["2,2", "右下"],
    ]);
    size.hint(() => {
      const v = ctx.input("src");
      if (!v) return "";
      const p = ctx.params();
      const o = outputSize(p, v);
      return "原始单帧 " + v.w + "×" + v.h + " → 输出 " + o.w + "×" + o.h + "（" + describeOutput(v.w, v.h, o.w, o.h, p.mode) + "）";
    });
    size.buttons(["重置为原始尺寸", () => {
      const v = ctx.input("src");
      ctx.set({ custom: false, w: v ? v.w : 0, h: v ? v.h : 0 });
    }]);

    const out = f.section("排版与时间");
    // sheet layout: the column count always shows what the layout comes to;
    // typing one switches to 自定列数
    const frames = () => { const v = ctx.input("src"); return v ? v.frames.length : 0; };
    out.pair(
      (s) => s.select("序列图排列", "layout", SHEET_LAYOUTS),
      (s) => s.number("列数", "perRow", { min: 1, extra: { layout: "cols" }, format: () => sheetGrid(frames() || 1, ctx.params()).cols }),
    );
    out.hint(() => {
      const n = frames();
      if (!n) return "";
      const g = sheetGrid(n, ctx.params());
      return "序列图：" + g.cols + " 列 × " + g.rows + " 行";
    });
    out.number("帧率 fps", "fps", { min: 1, max: 60 });
    out.hint("上游帧带有逐帧时长时（比如来自动画卡片），GIF、WebP 和 JSON 用逐帧时长，否则按这里的帧率。");
    out.select("WebP 质量", "webpQuality", [[1, "无损（推荐）"], [0.95, "有损 · 95"], [0.9, "有损 · 90"], [0.8, "有损 · 80"], [0.7, "有损 · 70"]], { wide: true });
    out.hint("WebP 和 GIF 的区别：WebP 是全彩、支持半透明边缘、文件更小；GIF 每帧最多 256 色、透明只有开 / 关两档，但几乎所有软件都能播。纯像素画两者画质一样。");
    f.buttons(
      ["生成 GIF", () => gifDialog(ctx), { primary: true }],
      ["生成 WebP", () => actions.webp(ctx), { primary: true }],
      ["序列帧图 + JSON", () => sheetDialog(ctx)],
      ["PNG 序列（zip）", () => actions.zip(ctx)],
    );
  },
});
