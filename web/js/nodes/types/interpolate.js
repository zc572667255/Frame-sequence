import { defineNode } from "../registry.js";
import { makeStage, makePlayer } from "../view.js";
import { framesValue } from "../data.js";
import { createCanvas, el } from "../../core/util.js";
import { preparePair, inbetween, crossfade } from "../../imaging/interpolate.js";

// the largest frames it works on: bigger pictures move too far between frames
// for the motion estimate to follow, and the in-betweens tear
const MAX_SIZE = 128;

// a frame's canvas at the sequence size (frames are normally that size already)
function sized(c, w, h) {
  if (c.width === w && c.height === h) return c;
  const o = createCanvas(w, h);
  o.getContext("2d").drawImage(c, 0, 0);
  return o;
}

defineNode({
  type: "interpolate",
  title: "补帧",
  category: "处理",
  icon: "⋯",
  help: "在每两帧之间插入中间帧，让动作更顺滑（×2 / ×3 / ×4）。「运动估计」分析画面往哪里移动再推到中间位置，"
    + "适合平移、小幅动作；大幅挥动、快速旋转、肢体交叉会出现扭曲。原帧的时长平均分给插入的帧，动画总时长不变。"
    + "只处理 " + MAX_SIZE + "×" + MAX_SIZE + " 以内的序列帧（像素小图），更大的原样输出。",
  inputs: [{ name: "src", label: "序列帧", accepts: ["frames"] }],
  outputs: [{ name: "out", label: "序列帧", kind: "frames" }],
  size: { w: 280, h: 300 },
  defaults: () => ({ mult: 2, method: "motion", range: "medium", loop: false, keepPixel: true }),
  persist: ["paused"],

  evaluate(p, { src }) {
    const n = src.frames.length;
    const m = Math.max(2, Math.min(4, p.mult | 0 || 2));
    if (n < 2) return { outputs: { out: src }, info: { text: "至少要 2 帧" } };
    const w = src.w, h = src.h;
    if (w > MAX_SIZE || h > MAX_SIZE) {
      return { outputs: { out: src }, info: {
        text: "超出 " + MAX_SIZE + "×" + MAX_SIZE + "，未补帧",
        warn: "补帧只处理 " + MAX_SIZE + "×" + MAX_SIZE + " 以内的序列帧（现在是 " + w + "×" + h + "），原样输出。大图帧与帧之间移动太大，插出来容易撕裂；可以先用「高清转像素」或「画框调整」缩小。",
      } };
    }
    const base = 1000 / Math.max(1, src.fps || 12);
    const out = [];
    for (let i = 0; i < n; i++) {
      const f = src.frames[i];
      const next = i + 1 < n ? src.frames[i + 1] : p.loop ? src.frames[0] : null;
      // the frame's time is shared by it and the frames put after it
      const dur = Math.round((f.duration || base) / (next ? m : 1));
      out.push({ ...f, duration: dur });
      if (!next) continue;
      const a = sized(f.canvas, w, h), b = sized(next.canvas, w, h);
      const pair = p.method === "blend" ? null : preparePair(a, b, w, h, p.range);
      for (let s = 1; s < m; s++) {
        const t = s / m;
        out.push({ canvas: pair ? inbetween(pair, t, !!p.keepPixel) : crossfade(a, b, w, h, t), duration: dur, index: f.index, inserted: true });
      }
    }
    return {
      outputs: { out: framesValue(out, w, h, { fps: (src.fps || 12) * m }) },
      info: { text: n + " 帧 → " + out.length + " 帧", from: n, to: out.length },
    };
  },

  mount(ctx) {
    const stage = makeStage({ fit: "integer" });
    const counter = el("span", { class: "mono" });
    const playBtn = el("button", { class: "tool-btn", onclick: () => { player.toggle(); ctx.setLocal({ paused: !player.playing }); } }, "❚❚");
    const bar = el("div", { class: "transport" },
      el("button", { class: "tool-btn", title: "上一帧", onclick: () => player.step(-1) }, "◀"),
      playBtn,
      el("button", { class: "tool-btn", title: "下一帧", onclick: () => player.step(1) }, "▶"),
      counter);
    ctx.body.append(stage.el, bar);
    const player = makePlayer(stage, {
      autoplay: !ctx.local.paused,
      fps: () => 12,
      emptyText: "连接序列帧",
      onFrame: (i, n, playing) => {
        const v = player.value;
        const ins = v && v.frames[i] && v.frames[i].inserted;
        counter.textContent = (i + 1) + " / " + n + (ins ? " · 补" : "");
        playBtn.textContent = playing ? "❚❚" : "▶";
      },
    });
    return {
      render() { player.setValue(ctx.output("out")); },
      destroy() { player.destroy(); },
    };
  },

  inspector(ctx, f) {
    f.pair(
      (s) => s.select("倍数", "mult", [[2, "×2（每两帧插 1 帧）"], [3, "×3（插 2 帧）"], [4, "×4（插 3 帧）"]]),
      (s) => s.select("方法", "method", [["motion", "运动估计"], ["blend", "淡入淡出混合"]]),
    );
    f.select("动作幅度", "range", [["small", "小（细微动作，最稳）"], ["medium", "中"], ["large", "大（大幅挥动，可能更扭曲）"]], { wide: true });
    f.check("首尾也补帧（循环动画）", "loop");
    f.check("保持像素（像素画：不留半透明，颜色吸附回原画用色）", "keepPixel");
    f.status(() => {
      const r = ctx.result();
      if (r && r.error) return { text: r.error, tone: "error" };
      if (r && r.info && r.info.warn) return { text: r.info.warn, tone: "warn" };
      return null;
    });
    f.readout(() => {
      const i = ctx.result() && ctx.result().info;
      return i && i.from ? [["帧数", i.from + " → " + i.to]] : null;
    });
    f.hint("播放时计数后面带「补」的是插出来的帧。效果不理想时：动作很大就把「动作幅度」调大或改用 ×2；像素画勾上「保持像素」；只是闪光、渐变这类不怎么移动的特效，用「淡入淡出混合」更干净。");
  },
});
