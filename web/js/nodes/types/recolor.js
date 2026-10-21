import { defineNode } from "../registry.js";
import { makeStage, readPixel, toolButton, makePlayer } from "../view.js";
import { framesValue } from "../data.js";
import { applyRecolor, buildConvertMap, encodeMask, decodeMask } from "../../imaging/recolor.js";
import { countColors } from "../../imaging/color.js";
import { el, imageDataOf, canvasFromImageData, rgbToHex } from "../../core/util.js";

const TOOLS = { brush: "画笔", erase: "橡皮", wand: "魔棒" };

function asFrames(v) {
  if (!v) return null;
  if (v.kind === "frames") return v;
  return framesValue([{ canvas: v.canvas, index: 0 }], v.canvas.width, v.canvas.height);
}

defineNode({
  type: "recolor",
  title: "调色",
  category: "处理",
  icon: "◐",
  help: "两层调色：①把整段动画就近转成 64 色；②在卡片上用画笔涂出局部（例如服饰），只调整涂中的像素。"
    + "选区按帧内位置同步到所有帧，魔棒会选中所有帧里的同一种颜色。",
  inputs: [{ name: "src", label: "序列帧", accepts: ["frames", "image"] }],
  outputs: [{ name: "out", label: "序列帧", kind: "frames" }],
  size: { w: 300, h: 300 },
  defaults: () => ({ convert: "none", mask: null, wand: [], hue: 0, sat: 100, lit: 0, contrast: 100 }),
  persist: ["brush", "showMask"],

  evaluate(p, inputs) {
    const src = asFrames(inputs.src);
    if (!src.frames.length) return { outputs: { out: src }, info: { text: "没有帧" } };
    const images = src.frames.map((f) => imageDataOf(f.canvas));
    const original = images.map((im) => new ImageData(new Uint8ClampedArray(im.data), im.width, im.height));
    const map = buildConvertMap(images, p.convert);
    const r = applyRecolor(images, original, map, p);
    const frames = src.frames.map((f, i) => ({ ...f, canvas: canvasFromImageData(images[i]) }));
    const colors = countColors(images);
    return {
      outputs: { out: framesValue(frames, src.w, src.h, { fps: src.fps }) },
      info: {
        text: colors + " 色" + (r.selected ? " · 选区 " + r.selected + " px" : ""),
        colors, selected: r.selected,
        warn: r.maskMismatch ? "帧尺寸变了，之前涂的选区已失效，请清除后重新涂。" : null,
      },
      view: { selections: r.selections || null },
    };
  },

  mount(ctx) {
    const stage = makeStage({ className: "paintable" });
    const frameLabel = el("span", { class: "mono stage-badge" });
    ctx.body.append(stage.el);
    stage.el.append(frameLabel);
    ctx.local.brush = ctx.local.brush || 1;

    const btns = {};
    for (const t in TOOLS) {
      btns[t] = toolButton(TOOLS[t], TOOLS[t] + "（再点一次退出）", () => ctx.setLocal({ mode: ctx.local.mode === t ? null : t }));
      ctx.tools.append(btns[t]);
    }

    // live mask during a stroke; committed to params on every frame of the drag so
    // the recolour updates as you paint, and coalesced so the stroke undoes as one
    let live = null, stroke = 0, lastPt = null, raf = 0;

    const maskFor = (w, h) => {
      const m = decodeMask(ctx.params().mask);
      return m && m.w === w && m.h === h ? m.mask : new Uint8Array(w * h);
    };

    const commit = () => {
      raf = 0;
      if (!live) return;
      ctx.set({ mask: encodeMask(live.mask, live.w, live.h) }, { coalesce: ctx.id + ":stroke" + stroke });
    };

    const dab = (x, y, erase) => {
      const { mask, w, h } = live;
      const r = ctx.local.brush - 1;
      const hasWand = (ctx.params().wand || []).length > 0;
      // erasing writes 2 ("explicitly out") only when a wand selection could
      // otherwise pull the pixel back in
      const v = erase ? (hasWand ? 2 : 0) : 1;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy > r * r + r) continue;
          const px = x + dx, py = y + dy;
          if (px < 0 || py < 0 || px >= w || py >= h) continue;
          mask[py * w + px] = v;
        }
      }
    };

    const line = (a, b, erase) => {
      const n = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y), 1);
      for (let i = 0; i <= n; i++) dab(Math.round(a.x + (b.x - a.x) * i / n), Math.round(a.y + (b.y - a.y) * i / n), erase);
    };

    const currentFrame = () => {
      const v = asFrames(ctx.input("src"));
      return v && v.frames.length ? v : null;
    };

    stage.canvas.addEventListener("pointerdown", (e) => {
      const mode = ctx.local.mode;
      if (!mode || e.button !== 0) return;
      const v = currentFrame();
      if (!v) return;
      e.stopPropagation();
      e.preventDefault();
      const pt = stage.point(e);
      if (mode === "wand") {
        const src = v.frames[Math.min(player.index, v.frames.length - 1)].canvas;
        const c = readPixel(src, pt.x, pt.y);
        if (!c) { ctx.toast("点到透明处了，请点主体部分。"); return; }
        const hex = rgbToHex(c);
        const wand = ctx.params().wand || [];
        if (wand.includes(hex)) { ctx.toast(hex + " 已经在选区里了。"); return; }
        ctx.set({ wand: [...wand, hex] });
        ctx.toast("魔棒选中 " + hex + "：所有帧里的这个颜色都会被调整。");
        return;
      }
      stroke++;
      live = { mask: maskFor(v.w, v.h), w: v.w, h: v.h };
      lastPt = pt;
      dab(pt.x, pt.y, mode === "erase");
      stage.canvas.setPointerCapture(e.pointerId);
      commit();
    });
    stage.canvas.addEventListener("pointermove", (e) => {
      if (!live || !lastPt) return;
      const pt = stage.point(e);
      line(lastPt, pt, ctx.local.mode === "erase");
      lastPt = pt;
      if (!raf) raf = requestAnimationFrame(commit);
    });
    const end = () => {
      if (!live) return;
      if (raf) { cancelAnimationFrame(raf); commit(); }
      live = null; lastPt = null;
    };
    stage.canvas.addEventListener("pointerup", end);
    stage.canvas.addEventListener("pointercancel", end);

    const overlay = (c, w, h, idx) => {
      const r = ctx.result();
      const sels = r && r.view && r.view.selections;
      const sel = sels && sels[Math.min(idx, sels.length - 1)];
      if (!sel || sel.length !== w * h) return;
      const od = c.createImageData(w, h);
      for (let i = 0; i < w * h; i++) {
        if (!sel[i]) continue;
        od.data[i * 4] = 124; od.data[i * 4 + 1] = 108; od.data[i * 4 + 2] = 255; od.data[i * 4 + 3] = 120;
      }
      const tmp = document.createElement("canvas");
      tmp.width = w; tmp.height = h;
      tmp.getContext("2d").putImageData(od, 0, 0);
      c.drawImage(tmp, 0, 0);
    };

    // the card shows a still frame while a tool is active (you paint on frame 1's
    // coordinates) and plays the result otherwise
    const player = makePlayer(stage, {
      fps: () => 8,
      autoplay: false,
      emptyText: "连接序列帧",
      overlay: (c, w, h, idx) => { if (ctx.local.mode || ctx.local.showMask) overlay(c, w, h, idx); },
      onFrame: (i, n) => { frameLabel.textContent = n > 1 ? (i + 1) + "/" + n : ""; },
    });
    stage.el.addEventListener("wheel", (e) => {
      // alt+wheel flips through frames to check the selection on each pose
      if (!e.altKey) return;
      e.preventDefault(); e.stopPropagation();
      player.step(e.deltaY > 0 ? 1 : -1);
    }, { passive: false });

    let lastKey = null;
    return {
      render() {
        for (const t in btns) btns[t].classList.toggle("active", ctx.local.mode === t);
        stage.el.classList.toggle("painting", !!ctx.local.mode);
        const v = ctx.output("out");
        const key = (v ? v.ver : "-") + ":" + (ctx.local.mode || "") + ":" + !!ctx.local.showMask;
        if (key === lastKey) return;
        lastKey = key;
        player.setValue(v || null);
        // paint on a still pose; play the result whenever no tool is active
        if (ctx.local.mode) { if (player.playing) player.pause(); else player.redraw(); }
        else if (!player.playing) player.play();
        else player.redraw();
      },
      destroy() { player.destroy(); },
    };
  },

  inspector(ctx, f) {
    f.select("整体转 64 色", "convert", [["none", "不转换"], ["resurrect", "Resurrect 64（就近映射）"], ["adaptive", "自适应 64 色（本图配色）"]], { wide: true });

    const sel = f.section("局部调色 · 在卡片上涂选区");
    sel.hint("点卡片标题栏的「画笔 / 橡皮 / 魔棒」，直接在卡片的图上涂。选区按帧内位置同步到所有帧；按住 Alt 滚动滚轮可以逐帧检查。");
    sel.buttons(
      ...Object.keys(TOOLS).map((t) => [TOOLS[t], () => ctx.setLocal({ mode: ctx.local.mode === t ? null : t }), {
        sync: (b) => b.classList.toggle("primary", ctx.local.mode === t),
      }]),
      ["清除选区", () => ctx.set({ mask: null, wand: [] })],
    );
    const brush = el("input", { type: "range", min: 1, max: 24, value: ctx.local.brush || 1 });
    const brushVal = el("span", { class: "f-unit mono" });
    brush.addEventListener("input", () => { ctx.setLocal({ brush: +brush.value }); brushVal.textContent = brush.value + " px"; });
    sel.custom(el("div", { class: "f-slider" }, el("span", { class: "f-label" }, "笔刷"), brush, brushVal),
      () => { brush.value = ctx.local.brush || 1; brushVal.textContent = (ctx.local.brush || 1) + " px"; });
    // a view toggle, not a param: it lives in local state and isn't saved or undone
    const showBox = el("input", { type: "checkbox", onchange: () => ctx.setLocal({ showMask: showBox.checked }) });
    sel.custom(el("label", { class: "f-check" }, showBox, el("span", null, "没选工具时也显示选区")),
      () => { showBox.checked = !!ctx.local.showMask; });

    const chips = el("div", { class: "chips" });
    sel.custom(chips, () => {
      const list = ctx.params().wand || [];
      chips.replaceChildren(...(list.length ? list.map((hex) => el("span", { class: "chip" },
        el("span", { class: "chip-sw", style: { background: hex } }),
        el("span", { class: "mono" }, hex),
        el("button", { title: "从魔棒选区移除", onclick: () => ctx.set({ wand: list.filter((h) => h !== hex) }) }, "×"),
      )) : [el("span", { class: "chips-empty" }, "魔棒还没选颜色")]));
    });

    sel.slider("色相", "hue", { min: -180, max: 180, unit: "°" });
    sel.slider("饱和度", "sat", { min: 0, max: 200, unit: "%" });
    sel.slider("明度", "lit", { min: -100, max: 100 });
    sel.slider("色阶", "contrast", { min: 0, max: 200, unit: "%" });
    sel.buttons(["复位滑块", () => ctx.set({ hue: 0, sat: 100, lit: 0, contrast: 100 })]);
    f.status(() => {
      const r = ctx.result();
      if (r && r.info && r.info.warn) return { text: r.info.warn, tone: "warn" };
      if (r && r.info && r.info.selected != null) {
        const p = ctx.params();
        const moved = p.hue || p.sat !== 100 || p.lit || p.contrast !== 100;
        if (!r.info.selected) return { text: "还没有选区。整体转色不需要选区；局部调色先用画笔或魔棒选出部位。" };
        return { text: "选区 " + r.info.selected + " px（第 1 帧）" + (moved ? "，已应用调整，所有帧同步。" : "，拖动滑块开始调整。"), tone: "ok" };
      }
      return null;
    });
  },
});
