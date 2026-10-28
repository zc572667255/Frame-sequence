// 特效: a stand-alone effect (hit sparks, explosion, magic circle …) generated
// as frames from a few settings (vfx/effects.js). Bake it to an animation card
// to touch it up in the pixel editor, or export it like any sequence.
import { defineNode } from "../registry.js";
import { makeStage, makePlayer } from "../view.js";
import { framesValue } from "../data.js";
import { el } from "../../core/util.js";
import { VFX_KINDS, VFX_DEFAULTS, VFX_PALETTES, VFX_EDGES as EDGES, hasSide } from "../../vfx/effects.js";
import { renderVfxAsync } from "../../vfx/layer.js";
import { ACCENTS, ACC_MODES, autoAccents } from "../../vfx/accents.js";
import { GLOW_PRESETS } from "../../trails/glow.js";
import { GROUND_AURAS } from "../../vfx/kinds/auras.js";
import { PROJECTILES, SPINS } from "../../vfx/kinds/arrow.js";
import { pickCoreImage } from "../../vfx/coreimg.js";
import { spriteOf } from "../../vfx/projectiles.js";

const GROUND = new Set(["shock", "dust", "circle", "heal"]);

defineNode({
  type: "vfx",
  title: "特效",
  category: "素材",
  icon: "✦",
  help: "生成一段独立的特效序列帧：命中火花、爆炸、冲击波、烟尘、蓄力、魔法阵、治疗光圈、环绕光（斗气）、燃烧、流光、翅膀、箭矢（还有匕首、长枪、棍棒、飞斧、手里剑、球、透明核心）。"
    + "选类型和配色（与拖尾光效同一套），可出高清或像素风；右键「烘焙为动画卡片」后能在像素编辑器里继续修改。",
  outputs: [{ name: "out", label: "序列帧", kind: "frames" }],
  size: { w: 260, h: 300 },
  defaults: () => ({ ...VFX_DEFAULTS }),
  persist: ["paused"],

  // the frames rendered in the background, all at once
  async evaluate(p) {
    const s = { ...VFX_DEFAULTS, ...p };
    const n = Math.max(1, Math.min(64, s.frames | 0));
    const canvases = await Promise.all(Array.from({ length: n }, (_, i) => renderVfxAsync(s, i)));
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
      onChange: (id) => { const k = VFX_KINDS.find((x) => x.id === id); if (k) ctx.set({ ...k.defaults, ...(k.side ? {} : { view: "front" }) }); },
    });
    f.hint(() => (VFX_KINDS.find((k) => k.id === p().kind) || {}).help || "");
    f.select("配色", "palette", VFX_PALETTES, { wide: true });
    f.select("画风", "style", [["hd", "高清"], ["pixel", "像素"]], { wide: true });
    const px = f.pair(
      (s) => s.select("像素大小", "pxSize", [[1, "1 px"], [2, "2 px"], [3, "3 px"], [4, "4 px"]]),
      (s) => s.select("透明", "pxAlpha", [["steps", "4 级透明"], ["dither", "抖动（全实心）"], ["hard", "硬边"]]),
    );
    f.pair(
      (s) => s.number("宽", "w", { min: 16, max: 2048 }),
      (s) => s.number("高", "h", { min: 16, max: 1024 }),
    );
    f.pair(
      (s) => s.number("帧数", "frames", { min: 2, max: 64 }),
      (s) => s.number("帧率", "fps", { min: 1, max: 60 }),
    );
    f.check("循环（最后一帧接回第一帧）", "loop");
    f.slider("大小", "size", { min: 20, max: 100, unit: "%" });
    f.slider("粒子", "amount", { min: 0, max: 200, unit: "%" });
    f.slider("辉光", "glow", { min: 0, max: 150, unit: "%" });
    const view = f.select("视角", "view", [["front", "正面"], ["side", "侧面"]], { wide: true });
    f.slider("旋转", "rotate", { min: -180, max: 180, unit: "°" });
    const ground = f.slider("地面倾斜", "tilt", { min: 0, max: 80, unit: "°" });
    const pattern = f.select("法阵图案", "pattern", [["hex", "六芒星"], ["penta", "五芒星"], ["square", "双方形（八角）"], ["taiji", "太极八卦"], ...GROUND_AURAS], { wide: true });
    const edge = f.select("边缘特效", "edge", EDGES, { wide: true });
    const bolts = f.check("带闪电（超级赛亚人 2 那样在斗气上窜动）", "bolts");
    const root = f.slider("根部宽度", "root", { min: 10, max: 100, unit: "%" });
    const drift = f.check("横向飘动（循环时每朵云正好飘过一圈）", "drift");
    const shape = f.select("外观", "shape", PROJECTILES, { wide: true });
    const spin = f.select("自转", "spin", SPINS, { wide: true });
    const shift = f.slider("物体前后", "coreShift", { min: -50, max: 50, unit: "%" });
    const coreBtns = f.buttons(["导入核心图片…", () => pickCoreImage().then((r) => { if (r) ctx.set(r); })]);
    const coreName = f.hint(() => (p().coreImg ? "核心图片：" + (p().coreName || "已导入") : "还没导入图片：只有光往前飞"));
    const coreSize = f.slider("核心大小", "coreSize", { min: 10, max: 100, unit: "%" });
    const coreTurn = f.slider("朝向", "coreTurn", { min: -180, max: 180, unit: "°" });
    const coreScale = f.slider("核心大小", "coreScale", { min: 30, max: 200, unit: "%" });
    // 光效点缀: the trails' accents; 自定义 starts from the palette's own mix
    const presetOf = () => GLOW_PRESETS.find((x) => x.id === p().palette) || GLOW_PRESETS[0];
    f.select("光效点缀", "acc", ACC_MODES, { wide: true, onChange: (v) => { if (v === "custom") ctx.set(autoAccents(presetOf())); } });
    const accHint = f.hint(() => {
      const auto = autoAccents(presetOf()), names = ACCENTS.filter((a) => auto["acc_" + a.id] > 0).map((a) => a.name);
      return names.length ? "「" + presetOf().name + "」配色带：" + names.join("、") + "（和同名拖尾一样）" : "「" + presetOf().name + "」配色没有点缀，可以选「自定义」自己加";
    });
    const accSliders = ACCENTS.map((a) => f.slider(a.name, "acc_" + a.id, { min: 0, max: 100, unit: "%" }));
    f.custom(el("span"), () => {
      const k = p().kind, mode = p().acc || "auto";
      accHint.style.display = mode === "auto" ? "" : "none";
      for (const sl of accSliders) sl.style.display = mode === "custom" ? "" : "none";
      bolts.style.display = k === "aura" ? "" : "none";
      root.style.display = k === "burn" ? "" : "none";
      drift.style.display = k === "cloud" ? "" : "none";
      shape.style.display = k === "arrow" ? "" : "none";
      spin.style.display = k === "arrow" ? "" : "none";
      shift.style.display = k === "arrow" ? "" : "none";
      for (const e of [coreBtns, coreName, coreSize, coreTurn]) e.style.display = k === "arrow" && p().shape === "custom" ? "" : "none";
      coreScale.style.display = k === "arrow" && spriteOf(p().shape) ? "" : "none";
      px.style.display = p().style === "pixel" ? "" : "none";
      ground.style.display = GROUND.has(k) ? "" : "none";
      pattern.style.display = k === "circle" ? "" : "none";
      edge.style.display = k === "circle" ? "" : "none";
      view.style.display = hasSide(k) ? "" : "none";
    });
    f.buttons(["换一个随机样子", () => ctx.set({ seed: (p().seed % 9973) + 1 + Math.floor(Math.random() * 500) })]);
    f.hint("「地面倾斜」：0° 是从正上方看，越大越扁，像放在地上（冲击波为 0° 时是空中的圆环）；侧面视角时 0° 是正对着，越大越侧过去。「视角」（翅膀、冲击波、魔法阵）侧面：翅膀向后展开，冲击波和魔法阵竖起来侧对；「旋转」整体绕中心转动。想手修就右键卡片「烘焙为动画卡片」。");
  },
});
