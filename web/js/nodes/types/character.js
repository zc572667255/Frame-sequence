// A character: several animations tuned to one shared origin. Double-click opens
// the tuner (调帧台); the card itself plays the selected animation exactly as it
// will be exported.
import { defineNode } from "../registry.js";
import { makeStage, makePlayer, toolButton } from "../view.js";
import { framesValue } from "../data.js";
import { el, downloadBlob, fmtBytes } from "../../core/util.js";
import { defaultCharacter, normalizeCharacter, currentAnimation, resolveSources, timeline, exportCanvas, renderExportFrame } from "../../tuner/model.js";
import { cardTitle } from "../../tuner/tuner.js";
import { exportCharacterZip } from "../../tuner/export.js";

async function exportZip(ctx) {
  const char = normalizeCharacter(ctx.params());
  if (!char.anims.length) { ctx.toast("还没有动画可导出，先双击卡片打开调帧台添加。", "warn"); return; }
  const t = ctx.toast("正在导出角色包…");
  try {
    const name = ctx.card().title || "character";
    const blob = await exportCharacterZip(ctx.app, char, resolveSources(ctx.app, char), name);
    t.remove();
    downloadBlob(blob, name + ".zip");
    ctx.toast("已导出角色包（" + fmtBytes(blob.size) + "）。", "ok");
  } catch (err) {
    t.remove();
    ctx.toast("导出失败：" + err.message, "error");
  }
}

defineNode({
  type: "character",
  title: "角色",
  category: "输出",
  icon: "♞",
  help: "把多组动画（待机、跑、攻击…）对齐到同一个原点，逐帧调偏移 / 缩放 / 旋转 / 时长、绑定音效，"
    + "再导出成共用画布和原点的角色包。右侧「序列帧」输出当前动画，可连接预览或导出卡片。双击打开调帧台。",
  outputs: [{ name: "out", label: "序列帧", kind: "frames" }],
  size: { w: 280, h: 320 },
  defaults: () => defaultCharacter(),
  refs: (p) => [...new Set((p.anims || []).map((a) => a.source && a.source.card).filter(Boolean))],

  evaluate(p, _inputs, ctx) {
    const char = normalizeCharacter(p), anim = currentAnimation(char);
    if (!anim) return { info: { waiting: "双击打开调帧台添加动画" } };
    const srcs = resolveSources(ctx, char), src = srcs.get(anim.source && anim.source.card);
    if (!src) return { info: { waiting: "来源卡片还没有帧" } };
    const tl = timeline(anim, src);
    if (!tl.length) return { info: { waiting: "当前动画没有启用的帧" } };
    const canvas = exportCanvas(char, srcs, [anim]);
    return {
      outputs: { out: framesValue(tl.map((e) => ({ canvas: renderExportFrame(char, anim, e.i, srcs, canvas), index: e.i, duration: e.duration })), canvas.w, canvas.h, { fps: anim.fps || src.fps || 12 }) },
      info: { text: anim.name + " · " + tl.length + " 帧 · " + canvas.w + "×" + canvas.h },
    };
  },

  mount(ctx) {
    const stage = makeStage({ fit: "integer" });
    const label = el("span", { class: "char-anim" });
    const pick = (d) => {
      const anims = ctx.params().anims || [];
      if (!anims.length) return;
      const k = Math.max(0, anims.findIndex((a) => a.id === ctx.params().outputAnim));
      ctx.set({ outputAnim: anims[(k + d + anims.length) % anims.length].id });
    };
    const bar = el("div", { class: "transport" },
      toolButton("◀", "上一组动画", () => pick(-1)), label, toolButton("▶", "下一组动画", () => pick(1)),
      el("span", { class: "spacer" }),
      toolButton("调帧台", "打开调帧台", () => ctx.app.openTuner(ctx.id)));
    ctx.body.append(stage.el, bar);
    const player = makePlayer(stage, { fps: () => (ctx.output("out") || {}).fps || 12, emptyText: "双击打开调帧台添加动画" });
    const view = {
      render() {
        const char = normalizeCharacter(ctx.params());
        const anim = currentAnimation(char);
        label.textContent = anim ? anim.name + "（" + (char.anims.indexOf(anim) + 1) + "/" + char.anims.length + "）" : "还没有动画";
        player.setValue(ctx.output("out"));
        const result = ctx.result();
        if (!ctx.output("out") && result && result.info && result.info.waiting) stage.message(result.info.waiting);
      },
      destroy() { player.destroy(); },
    };
    return view;
  },

  open(ctx) { ctx.app.openTuner(ctx.id); },

  inspector(ctx, f) {
    f.buttons(
      ["打开调帧台", () => ctx.app.openTuner(ctx.id), { primary: true }],
      ["导出角色包", () => exportZip(ctx)],
    );
    const list = el("div", { class: "tn-list" });
    f.section("动画组").custom(list, () => {
      const char = normalizeCharacter(ctx.params());
      const srcs = resolveSources(ctx.app, char);
      list.replaceChildren(...char.anims.map((a) => {
        const src = srcs.get(a.source && a.source.card);
        const extras = Object.keys(a.sounds || {}).length ? Object.keys(a.sounds).length + " 处音效" : "";
        const row = el("div", { class: "tn-row" + (a === currentAnimation(char) ? " on" : ""), title: "来源：" + cardTitle(ctx.app, a.source && a.source.card) },
          el("span", { class: "tn-row-name" }, a.name),
          el("span", { class: "tn-row-meta mono" }, (src ? timeline(a, src).length + " 帧" : "无来源") + (extras ? " · " + extras : "")));
        row.onclick = () => ctx.set({ outputAnim: a.id });
        return row;
      }));
      if (!char.anims.length) list.append(el("p", { class: "f-hint" }, "还没有动画。双击卡片打开调帧台添加，或在动画卡片上右键选「加入角色」。"));
    });
    f.hint("连线导出：从右侧「序列帧」端口连接「导出」卡片，可导出当前动画的 GIF / WebP / 序列图 / PNG 包。点击动画组切换输出；保留调帧后的缩放、位置、逐帧时长，并跳过禁用帧。");
    f.hint("输出按每帧缩放、旋转后的实际像素范围计算，不沿用原图画布尺寸。透明边裁切；有像素超出时增加透明边缘，保留比例和帧间偏移。");
    f.hint("导出：所有动画用同一块画布、同一个原点（脚底），每组一张序列图（或一组 PNG），附 character.json（尺寸、原点、逐帧时长、音效），音频文件一起打包。");
  },
});
