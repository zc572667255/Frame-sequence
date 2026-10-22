// 特效: a stand-alone effect (hit sparks, explosion, magic circle …) generated
// as frames from a few settings (vfx/effects.js). Bake it to an animation card
// to touch it up in the pixel editor, or export it like any sequence.
import { defineNode } from "../registry.js";
import { makeStage, makePlayer } from "../view.js";
import { framesValue } from "../data.js";
import { el } from "../../core/util.js";
import { VFX_KINDS, VFX_DEFAULTS, VFX_PALETTES, renderVfxFrames } from "../../vfx/effects.js";

const GROUND = new Set(["shock", "dust", "circle", "heal"]);

defineNode({
  type: "vfx",
  title: "特效",
  category: "素材",
  icon: "✦",
  help: "生成一段独立的特效序列帧：命中火花、爆炸、冲击波、烟尘、蓄力、魔法阵、治疗光圈、环绕光（斗气）、燃烧。"
    + "选类型和配色（与拖尾光效同一套），可出高清或像素风；右键「烘焙为动画卡片」后能在像素编辑器里继续修改。",
  outputs: [{ name: "out", label: "序列帧", kind: "frames" }],
  size: { w: 260, h: 300 },
  defaults: () => ({ ...VFX_DEFAULTS }),
  persist: ["paused"],

  evaluate(p) {
    const s = { ...VFX_DEFAULTS, ...p };
    const canvases = renderVfxFrames(s);
    const frames = canvases.map((canvas, i) => ({ canvas, index: i, duration: null }));
    const kind = VFX_KINDS.find((k) => k.id === s.kind);
    return {
      outputs: { out: framesValue(frames, s.w, s.h, { fps: s.fps }) },
      info: { text: (kind ? kind.name : "特效") + " · " + frames.length + " 帧 · " + s.w + "×" + s.h + (s.loop ? " · 循环" : "") },
    };
  },

  mount(ctx) {
    const stage = makeStage({ fit: "integer" });
    const counter = el("span", { class: "mono" });
    const playBtn = el("button", { class: "tool-btn", onclick: () => { player.toggle(); ctx.setLocal({ paused: !player.playing }); } }, "❚❚");
    ctx.body.append(stage.el, el("div", { class: "transport" },
      el("button", { class: "tool-btn", title: "上一帧", onclick: () => player.step(-1) }, "◀"),
      playBtn,
      el("button", { class: "tool-btn", title: "下一帧", onclick: () => player.step(1) }, "▶"),
      counter));
    const player = makePlayer(stage, {
      autoplay: !ctx.local.paused,
      fps: () => ctx.params().fps || 12,
      onFrame: (i, n, playing) => { counter.textContent = (i + 1) + " / " + n; playBtn.textContent = playing ? "❚❚" : "▶"; },
    });
    return {
      render() { player.setValue(ctx.output("out")); },
      destroy() { player.destroy(); },
    };
  },

  inspector(ctx, f) {
    const p = () => ({ ...VFX_DEFAULTS, ...ctx.params() });
    // a new kind starts from its own colours, length and looping
    f.select("类型", "kind", VFX_KINDS.map((k) => [k.id, k.name]), {
      wide: true,
      onChange: (id) => { const k = VFX_KINDS.find((x) => x.id === id); if (k) ctx.set({ ...k.defaults }); },
    });
    f.hint(() => (VFX_KINDS.find((k) => k.id === p().kind) || {}).help || "");
    f.select("配色", "palette", VFX_PALETTES, { wide: true });
    f.select("画风", "style", [["hd", "高清"], ["pixel", "像素"]], { wide: true });
    const px = f.pair(
      (s) => s.select("像素大小", "pxSize", [[1, "1 px"], [2, "2 px"], [3, "3 px"], [4, "4 px"]]),
      (s) => s.select("透明", "pxAlpha", [["steps", "4 级透明"], ["dither", "抖动（全实心）"], ["hard", "硬边"]]),
    );
    f.pair(
      (s) => s.number("宽", "w", { min: 16, max: 512 }),
      (s) => s.number("高", "h", { min: 16, max: 512 }),
    );
    f.pair(
      (s) => s.number("帧数", "frames", { min: 2, max: 48 }),
      (s) => s.number("帧率", "fps", { min: 1, max: 60 }),
    );
    f.check("循环（最后一帧接回第一帧）", "loop");
    f.slider("大小", "size", { min: 20, max: 100, unit: "%" });
    f.slider("粒子", "amount", { min: 0, max: 200, unit: "%" });
    f.slider("辉光", "glow", { min: 0, max: 150, unit: "%" });
    const ground = f.slider("地面倾斜", "tilt", { min: 0, max: 80, unit: "°" });
    const pattern = f.select("法阵图案", "pattern", [["hex", "六芒星"], ["penta", "五芒星"], ["square", "双方形（八角）"]], { wide: true });
    const bolts = f.check("带闪电（超级赛亚人 2 那样在斗气上窜动）", "bolts");
    f.custom(el("span"), () => {
      const k = p().kind;
      bolts.style.display = k === "aura" ? "" : "none";
      px.style.display = p().style === "pixel" ? "" : "none";
      ground.style.display = GROUND.has(k) ? "" : "none";
      pattern.style.display = k === "circle" ? "" : "none";
    });
    f.buttons(["换一个随机样子", () => ctx.set({ seed: (p().seed % 9973) + 1 + Math.floor(Math.random() * 500) })]);
    f.hint("「地面倾斜」：0° 是从正上方看，越大越扁，像放在地上（冲击波为 0° 时是空中的圆环）。想手修就右键卡片「烘焙为动画卡片」。");
  },
});
