import { defineNode } from "../registry.js";
import { makeStage, readPixel, toolButton } from "../view.js";
import { mapRaster, stillOf } from "../data.js";
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
  if (on) ctx.toast("在卡片的图上点击背景取色，可以连点多个位置；按 Esc 结束。");
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
    ctx.body.append(stage.el);
    const pick = toolButton("取样", "在图上点击取背景色（Esc 结束）", () => toggleSampling(ctx, ctx.local.mode !== "sample"));
    ctx.tools.append(pick);

    stage.canvas.addEventListener("pointerdown", (e) => {
      if (ctx.local.mode !== "sample" || e.button !== 0) return;
      e.stopPropagation();
      const src = stillOf(ctx.input("src"));
      if (!src) return;
      const { x, y } = stage.point(e);
      const c = readPixel(src, x, y);
      if (!c) { ctx.toast("这里已经是透明的，换个位置取样。"); return; }
      if (!addSample(ctx, c)) ctx.toast("这个颜色已经取过了。");
    });

    return {
      render() {
        const sampling = ctx.local.mode === "sample";
        pick.classList.toggle("active", sampling);
        stage.el.classList.toggle("picking", sampling);
        const v = ctx.output("out") || ctx.input("src");
        const still = stillOf(v);
        if (still) stage.show(still, null, v.ver); else stage.message("连接图像或序列帧");
      },
    };
  },

  inspector(ctx, f) {
    f.buttons(
      ["在图上取样", () => toggleSampling(ctx, ctx.local.mode !== "sample"), {
        primary: true,
        sync: (b) => { b.textContent = ctx.local.mode === "sample" ? "取样中…点击结束" : "在图上取样"; },
      }],
      ["取四角颜色", () => {
        const src = stillOf(ctx.input("src"));
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
