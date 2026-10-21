import { defineNode } from "../registry.js";
import { makeStage, makePlayer } from "../view.js";
import { el } from "../../core/util.js";

const BGS = [["checker", "棋盘格"], ["#0d0d0f", "黑"], ["#ffffff", "白"], ["#6f9a5b", "草地绿"], ["#4a6fa5", "天空蓝"]];

defineNode({
  type: "preview",
  title: "播放预览",
  category: "输出",
  icon: "▶",
  help: "循环播放接入的序列帧。可以同时放好几个预览，对比不同处理参数的效果。",
  inputs: [{ name: "src", label: "序列帧", accepts: ["frames"] }],
  size: { w: 260, h: 300 },
  defaults: () => ({ fps: 12, bg: "checker", fit: "integer" }),
  persist: ["paused"],

  mount(ctx) {
    const p0 = ctx.params();
    const stage = makeStage({ fit: p0.fit || "integer" });
    const counter = el("span", { class: "mono" });
    const playBtn = el("button", { class: "tool-btn", onclick: () => {
      player.toggle();
      ctx.setLocal({ paused: !player.playing });
    } }, "❚❚");
    const fpsIn = el("input", { type: "number", class: "mono mini", min: 1, max: 60, title: "帧率" });
    fpsIn.addEventListener("input", () => { const n = +fpsIn.value; if (n >= 1 && n <= 60) ctx.set({ fps: n }, { coalesce: ctx.id + ":fps" }); });
    const bar = el("div", { class: "transport" },
      el("button", { class: "tool-btn", title: "上一帧", onclick: () => player.step(-1) }, "◀"),
      playBtn,
      el("button", { class: "tool-btn", title: "下一帧", onclick: () => player.step(1) }, "▶"),
      counter,
      el("span", { class: "spacer" }),
      fpsIn, el("span", { class: "dim" }, "fps"),
    );
    ctx.body.append(stage.el, bar);

    const player = makePlayer(stage, {
      autoplay: !ctx.local.paused,
      fps: () => ctx.params().fps || 12,
      onFrame: (i, n, playing) => {
        counter.textContent = (i + 1) + " / " + n;
        playBtn.textContent = playing ? "❚❚" : "▶";
      },
    });

    return {
      render() {
        const p = ctx.params();
        stage.setBg(p.bg);
        stage.setFit(p.fit || "integer");
        if (document.activeElement !== fpsIn) fpsIn.value = p.fps || 12;
        player.setValue(ctx.input("src"));
      },
      destroy() { player.destroy(); },
    };
  },

  inspector(ctx, f) {
    f.slider("帧率", "fps", { min: 1, max: 60, unit: "fps" });
    f.select("背景", "bg", BGS);
    f.select("缩放", "fit", [["integer", "整数倍（像素清晰）"], ["contain", "填满卡片"]]);
    f.readout(() => {
      const v = ctx.input("src");
      if (!v) return null;
      const timed = v.frames.some((x) => x.duration);
      return [["帧数", String(v.frames.length)], ["单帧", v.w + " × " + v.h], ["时长", timed ? "逐帧时长" : "按帧率"]];
    });
  },
});
