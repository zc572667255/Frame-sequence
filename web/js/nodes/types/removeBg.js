import { defineNode } from "../registry.js";
import { makeStage, makePlayer, readPixel, toolButton } from "../view.js";
import { mapRaster, asFrames } from "../data.js";
import { removeBackground } from "../../imaging/background.js";
import { el, hexToRgb, rgbToHex } from "../../core/util.js";

function addSample(ctx, c) {
  if (!c) return false;
  const hex = rgbToHex(c);
  const list = ctx.params().samples || [];
  if (list.includes(hex)) return false;
  ctx.set({ samples: [...list, hex] });
  return true;
}

function toggleSampling(ctx, on) {
  ctx.setLocal({ mode: on ? "sample" : null });
  if (on) ctx.toast("在卡片的图上点击背景取色，可以连点多个位置；用卡片下方的 ◀ ▶（或 Alt + 滚轮）换到其他帧取色；按 Esc 结束。");
}

// the input frame the card is showing (ctx.local.fi), as a canvas: what is
// sampled is always the original colour there, also where it is cleared already
function shownInput(ctx) {
  const v = asFrames(ctx.input("src"));
  if (!v || !v.frames.length) return null;
  const i = Math.max(0, Math.min(v.frames.length - 1, ctx.local.fi | 0));
  return v.frames[i].canvas;
}

defineNode({
  type: "removeBg",
  title: "去背景",
  category: "处理",
  icon: "◌",
  help: "点图取样背景色，容差内的颜色全部变透明。可以取多个颜色，用来处理渐变背景或残留的杂边。",
  inputs: [{ name: "src", label: "输入", accepts: ["image", "frames"] }],
  outputs: [{ name: "out", label: "输出", kind: "same" }],
  size: { w: 300, h: 280 },
  defaults: () => ({ samples: [], tol: 18, connected: false }),

  evaluate(p, { src }) {
    const samples = (p.samples || []).map(hexToRgb);
    if (!samples.length) {
      return { outputs: { out: { ...src } }, info: { text: "未取样，原样输出" } };
    }
    const { value, stats } = mapRaster(src, (im) => removeBackground(im, samples, p.tol, p.connected));
    let cleared = 0, opaque = 0, total = 0;
    for (const s of stats) { cleared += s.cleared; opaque += s.opaque; total += s.out.width * s.out.height; }
    return {
      outputs: { out: value },
      info: {
        text: "清除 " + (cleared / total * 100).toFixed(1) + "% · 剩余 " + opaque.toLocaleString() + " px",
        cleared, opaque, total,
      },
    };
  },

  mount(ctx) {
    const stage = makeStage();
    const frameLabel = el("span", { class: "mono stage-badge" });
    ctx.body.append(stage.el);
    stage.el.append(frameLabel);
    const pick = toolButton("取样", "在图上点击取背景色（Esc 结束）", () => toggleSampling(ctx, ctx.local.mode !== "sample"));
    ctx.tools.append(pick);

    // the card shows one frame of the result at a time, paused: step through
    // them to sample the background where it shows on any frame
    const player = makePlayer(stage, {
      fps: () => 8,
      autoplay: false,
      emptyText: "连接图像或序列帧",
      onFrame: (i, n, playing) => {
        ctx.local.fi = i; // shared with the inspector (取四角颜色), not saved
        frameLabel.textContent = n > 1 ? (i + 1) + "/" + n : "";
        counter.textContent = n > 1 ? "第 " + (i + 1) + " / " + n + " 帧" : "";
        playBtn.textContent = playing ? "❚❚" : "▶";
        transport.style.display = n > 1 ? "" : "none";
      },
    });
    const counter = el("span", { class: "mono" });
    const playBtn = el("button", { class: "tool-btn", title: "播放 / 暂停", onclick: (e) => { e.stopPropagation(); player.toggle(); } }, "▶");
    const transport = el("div", { class: "transport" },
      el("button", { class: "tool-btn", title: "上一帧（Alt + 滚轮也可以）", onclick: (e) => { e.stopPropagation(); player.step(-1); } }, "◀"),
      playBtn,
      el("button", { class: "tool-btn", title: "下一帧（Alt + 滚轮也可以）", onclick: (e) => { e.stopPropagation(); player.step(1); } }, "▶"),
      counter);
    ctx.body.append(transport);
    stage.el.addEventListener("wheel", (e) => {
      if (!e.altKey) return;
      e.preventDefault(); e.stopPropagation();
      player.step(e.deltaY > 0 ? 1 : -1);
    }, { passive: false });

    stage.canvas.addEventListener("pointerdown", (e) => {
      if (ctx.local.mode !== "sample" || e.button !== 0) return;
      e.stopPropagation();
      if (player.playing) player.pause();
      const src = shownInput(ctx);
      if (!src) return;
      const { x, y } = stage.point(e);
      const c = readPixel(src, x, y);
      const n = (asFrames(ctx.input("src")) || { frames: [] }).frames.length, where = n > 1 ? "（第 " + ((ctx.local.fi | 0) + 1) + " 帧）" : "";
      if (!c) { ctx.toast("这里原本就是透明的，换个位置取样。"); return; }
      if (!addSample(ctx, c)) ctx.toast("这个颜色" + where + "已经取过了。");
      else if (n > 1) ctx.toast("取到 " + rgbToHex(c) + where + "：所有帧里容差内的这个颜色都会被清除。");
    });

    let lastKey = null;
    return {
      render() {
        const sampling = ctx.local.mode === "sample";
        pick.classList.toggle("active", sampling);
        stage.el.classList.toggle("picking", sampling);
        const v = ctx.output("out") || ctx.input("src");
        const key = (v ? v.ver : "-") + ":" + sampling;
        if (key === lastKey) return;
        lastKey = key;
        // stays on the frame it was on when the result changes (a new sample)
        player.setValue(asFrames(v));
        if (sampling && player.playing) player.pause(); else player.redraw();
      },
      destroy() { player.destroy(); },
    };
  },

  inspector(ctx, f) {
    f.buttons(
      ["在图上取样", () => toggleSampling(ctx, ctx.local.mode !== "sample"), {
        primary: true,
        sync: (b) => { b.textContent = ctx.local.mode === "sample" ? "取样中…点击结束" : "在图上取样"; },
      }],
      ["取四角颜色", () => {
        // the corners of the frame the card is showing
        const src = shownInput(ctx);
        if (!src) return;
        const w = src.width, h = src.height;
        let list = [...(ctx.params().samples || [])];
        let added = 0;
        for (const [x, y] of [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]]) {
          const c = readPixel(src, x, y);
          if (c && !list.includes(rgbToHex(c))) { list.push(rgbToHex(c)); added++; }
        }
        if (added) ctx.set({ samples: list });
        ctx.toast(added ? "已从四角取到 " + added + " 个新颜色。" : "四角的颜色都已取过（或已透明）。");
      }],
      ["清空取样", () => ctx.set({ samples: [] })],
    );

    const chips = el("div", { class: "chips" });
    f.custom(chips, () => {
      const list = ctx.params().samples || [];
      if (!list.length) { chips.replaceChildren(el("span", { class: "chips-empty" }, "还没有取样颜色")); return; }
      chips.replaceChildren(...list.map((hex) => el("span", { class: "chip" },
        el("span", { class: "chip-sw", style: { background: hex } }),
        el("span", { class: "mono" }, hex),
        el("button", { title: "移除这个取样色", onclick: () => ctx.set({ samples: list.filter((h) => h !== hex) }) }, "×"),
      )));
    });

    f.hint("取样色对所有帧都生效。序列帧可以用卡片下方的 ◀ ▶（或在图上 Alt + 滚轮）换到其他帧，在那一帧上取它残留的背景色；「取四角颜色」取的是当前显示这一帧的四角。");
    f.slider("容差", "tol", { min: 0, max: 120 });
    f.check("仅清除与画布边缘相连的区域", "connected", {
      hint: "只清掉从四边蔓延进来的背景，角色身上碰巧同色的像素会保留。人物身上被打出洞时勾上它。",
    });
    f.readout(() => {
      const r = ctx.result();
      const i = r && r.info;
      if (!i || i.cleared == null) return null;
      return [["将清除", i.cleared.toLocaleString() + " px（" + (i.cleared / i.total * 100).toFixed(1) + "%）"],
        ["剩余不透明", i.opaque.toLocaleString() + " px"]];
    });
  },
});
