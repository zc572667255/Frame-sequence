// A character: several animations tuned to one shared origin. Double-click opens
// the tuner (调帧台); the card itself plays the selected animation exactly as it
// will be exported.
import { defineNode } from "../registry.js";
import { makeStage, makePlayer, toolButton } from "../view.js";
import { framesValue } from "../data.js";
import { el, downloadBlob, fmtBytes } from "../../core/util.js";
import { defaultCharacter, normalizeCharacter, timeline, exportCanvas, renderExportFrame } from "../../tuner/model.js";
import { resolveSources, cardTitle } from "../../tuner/tuner.js";
import { exportCharacterZip } from "../../tuner/export.js";

function sourceVersions(srcs) {
  return [...srcs].map(([id, v]) => id + ":" + (v ? v.ver : "-")).join(",");
}

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
    + "再导出成共用画布和原点的角色包。双击打开调帧台。刀光等特效在像素编辑器里用「拖尾」笔画。",
  size: { w: 280, h: 320 },
  defaults: () => defaultCharacter(),
  persist: ["current"],

  mount(ctx) {
    const stage = makeStage({ fit: "integer" });
    const label = el("span", { class: "char-anim" });
    const pick = (d) => {
      const anims = ctx.params().anims || [];
      if (!anims.length) return;
      const k = Math.max(0, anims.findIndex((a) => a.id === ctx.local.current));
      ctx.setLocal({ current: anims[(k + d + anims.length) % anims.length].id });
    };
    const bar = el("div", { class: "transport" },
      toolButton("◀", "上一组动画", () => pick(-1)), label, toolButton("▶", "下一组动画", () => pick(1)),
      el("span", { class: "spacer" }),
      toolButton("调帧台", "打开调帧台", () => ctx.app.openTuner(ctx.id)));
    ctx.body.append(stage.el, bar);
    let cur = null;
    const player = makePlayer(stage, { fps: () => (cur && (cur.fps || 12)) || 12, emptyText: "双击打开调帧台添加动画" });

    // re-render when any animation this character uses gets a new result
    const off = ctx.engine.on("result", (id) => {
      const p = ctx.params();
      if ((p.anims || []).some((a) => a.source && a.source.card === id)) view.render();
    });

    let lastKey = null;
    const view = {
      render() {
        const char = normalizeCharacter(ctx.params());
        const srcs = resolveSources(ctx.app, char);
        const anim = char.anims.find((a) => a.id === ctx.local.current) || char.anims[0];
        cur = anim || null;
        label.textContent = anim ? anim.name + "（" + (char.anims.indexOf(anim) + 1) + "/" + char.anims.length + "）" : "还没有动画";
        const key = JSON.stringify(ctx.params()) + "|" + sourceVersions(srcs) + "|" + (anim && anim.id);
        if (key === lastKey) return;
        lastKey = key;
        if (!anim) { player.setValue(null); return; }
        const src = srcs.get(anim.source && anim.source.card);
        const tl = timeline(anim, src);
        if (!tl.length) { player.setValue(null); stage.message("来源卡片还没有帧"); return; }
        // exactly what the export will contain: shared canvas, origin, durations
        const canvas = exportCanvas(char, srcs);
        player.setValue(framesValue(tl.map((e) => ({ canvas: renderExportFrame(char, anim, e.i, srcs, canvas), index: e.i, duration: e.duration })), canvas.w, canvas.h));
      },
      destroy() { off(); player.destroy(); },
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
        const row = el("div", { class: "tn-row" + (a.id === ctx.local.current ? " on" : ""), title: "来源：" + cardTitle(ctx.app, a.source && a.source.card) },
          el("span", { class: "tn-row-name" }, a.name),
          el("span", { class: "tn-row-meta mono" }, (src ? timeline(a, src).length + " 帧" : "无来源") + (extras ? " · " + extras : "")));
        row.onclick = () => ctx.setLocal({ current: a.id });
        return row;
      }));
      if (!char.anims.length) list.append(el("p", { class: "f-hint" }, "还没有动画。双击卡片打开调帧台添加，或在动画卡片上右键选「加入角色」。"));
    });
    f.hint("导出：所有动画用同一块画布、同一个原点（脚底），每组一张序列图（或一组 PNG），附 character.json（尺寸、原点、逐帧时长、音效），音频文件一起打包。");
  },
});
