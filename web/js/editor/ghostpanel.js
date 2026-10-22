// The 残影 panel: settings of the selected ghost layer (trails/ghost.js), shown
// on the right in place of the colours while a ghost layer is the current layer.
import { el, downloadBlob } from "../core/util.js";
import { GHOST_DEFAULTS, ghostSettings, ghostSources, ghostOn } from "../trails/ghost.js";
import { ghostParams, ghostGodot, ghostJSON } from "../trails/ghostexport.js";

// one-click looks; the rest of the settings stay as they are
const LOOKS = [
  { id: "dash", name: "冲刺蓝影", set: { tint: "color", color: "#58c8ff", color2: "#7a5cff", alpha: "soft", blend: "add", fade: 70 } },
  { id: "shadow", name: "暗影", set: { tint: "color", color: "#3a2a5c", color2: "#120a20", alpha: "soft", blend: "normal", fade: 70 } },
  { id: "fire", name: "炎影", set: { tint: "color", color: "#ffd060", color2: "#ff3b1f", alpha: "soft", blend: "add", fade: 75 } },
  { id: "plain", name: "原色淡影", set: { tint: "none", alpha: "soft", blend: "normal", fade: 55 } },
  { id: "pixel", name: "像素残影", set: { tint: "color", color: "#8fe3ff", color2: "#4a5cff", alpha: "dither", blend: "normal", fade: 85 } },
];

export class GhostPanel {
  constructor(ed) {
    this.ed = ed;
    this.panel = el("div", { class: "tm-panel", style: { display: "none" } });
    this.shown = false;
    this.live = false; // a slider drag already took its undo checkpoint
  }

  get doc() { return this.ed.doc; }
  layer() { const l = this.doc.layers[this.ed.li]; return l && l.ghost ? l : null; }

  // show the panel when the current layer is a ghost layer, and rebuild it
  // (the editor's syncSide decides whether the colours show)
  sync() {
    const on = !!this.layer();
    if (on !== this.shown) {
      this.shown = on;
      this.panel.style.display = on ? "" : "none";
    }
    if (on) this.refresh();
  }

  edit(fn) {
    this.ed.commitFloat();
    this.doc.checkpoint();
    fn(this.layer().ghost);
    this.ed.afterChange(false);
    this.refresh();
  }

  liveEdit(fn) {
    if (!this.live) { this.ed.commitFloat(); this.doc.checkpoint(); this.live = true; }
    fn(this.layer().ghost);
    this.ed.markDirty();
    this.ed.requestRender();
  }

  endLive() {
    if (!this.live) return;
    this.live = false;
    this.ed.afterChange(false);
  }

  exportFor(kind) {
    const l = this.layer();
    if (!l) return;
    const card = this.ed.app.store.cards[this.ed.cardId];
    const p = ghostParams(l, this.doc.fps, this.doc.frames.map((f) => f.id), card && card.title);
    if (kind === "godot") downloadBlob(new Blob([ghostGodot(p)], { type: "text/plain" }), "afterimage.gd");
    else downloadBlob(new Blob([ghostJSON(p)], { type: "application/json" }), "afterimage.json");
    this.ed.app.toast(kind === "godot"
      ? "已导出 afterimage.gd：在 Godot 里新建 Node2D 放到角色精灵下面，挂上这个脚本即可。"
      : "已导出 afterimage.json：参数和计算公式都在里面（notes 字段）。");
  }

  refresh() {
    const l = this.layer();
    const P = this.panel;
    P.replaceChildren();
    if (!l) return;
    const s = ghostSettings(l);
    const row = (label, ...kids) => { const r = el("div", { class: "tm-row" }, el("span", { class: "tm-label" }, label), ...kids); P.append(r); return r; };
    const slider = (label, key, min, max, unit, title) => {
      const val = el("span", { class: "mono tm-num" }, s[key] + unit);
      const r = el("input", { type: "range", min, max, value: s[key] });
      r.oninput = () => this.liveEdit((gh) => { gh[key] = +r.value; val.textContent = r.value + unit; });
      r.onchange = () => this.endLive();
      row(label, r, val).title = title || "";
    };
    const choose = (label, key, options, title) => {
      const sel = el("select", { class: "ed-select", title: title || "" }, ...options.map(([v, n]) => el("option", { value: v, selected: String(s[key]) === v }, n)));
      sel.onchange = () => this.edit((gh) => { gh[key] = sel.value; });
      row(label, sel, el("span"));
    };

    P.append(el("div", { class: "ed-panel-title" }, l.name.startsWith("残影") ? "残影设置" : "残影设置 · " + l.name));
    // which frames show ghosts: picked one by one (残影 ＋ / － on the timeline bar, or here)
    const ids = this.doc.frames.map((f) => f.id);
    const on = ids.filter((id) => ghostOn(s, id));
    const here = on.includes(ids[this.ed.fi]);
    row("加入帧", el("div", { class: "tm-colors" },
      el("button", { class: "btn small" + (here ? " primary" : ""), title: "当前帧加入 / 去掉残影", onclick: () => this.edit(() => this.ed.setGhostFrame(l, ids[this.ed.fi], !here)) }, here ? "✓ 本帧" : "＋ 本帧"),
      el("button", { class: "btn small", onclick: () => this.edit((gh) => { gh.frames = [...ids]; }) }, "全部帧"),
      el("button", { class: "btn small", onclick: () => this.edit((gh) => { gh.frames = []; }) }, "清空")));
    P.append(el("p", { class: "ed-hint" }, on.length
      ? "已在第 " + on.map((id) => ids.indexOf(id) + 1).sort((a, b) => a - b).join("、") + " 帧加入残影。"
      : "还没有帧加入残影。"));

    const looks = el("div", { class: "tm-colors" });
    for (const k of LOOKS) looks.append(el("button", { class: "btn small", onclick: () => this.edit((gh) => Object.assign(gh, k.set)) }, k.name));
    row("预设", looks);

    // what it copies
    const pixelLayers = this.doc.layers.filter((o) => !o.trail && !o.ghost && !o.vfx);
    choose("来源", "source", [["all", "所有像素图层"], ...pixelLayers.map((o) => [o.id, o.name])], "残影复制哪些图层的前几帧（拖尾图层和其他残影不算）");
    slider("数量", "count", 1, 8, " 个", "身后留几个残影");
    slider("间隔", "spacing", 1, 4, " 帧", "两个残影之间隔几帧：越大拉得越开");
    slider("浓度", "fade", 10, 100, "%", "最近一个残影的不透明度，越远越淡");

    // how it looks
    choose("颜色", "tint", [["color", "纯色剪影"], ["mix", "原图 + 染色"], ["none", "原图颜色"]]);
    if (s.tint === "mix") slider("染色", "mix", 0, 100, "%", "颜色盖住原图的程度");
    if (s.tint !== "none") {
      const pick = (key) => {
        const c = el("input", { type: "color", value: s[key] || GHOST_DEFAULTS[key] });
        c.oninput = () => this.liveEdit((gh) => { gh[key] = c.value; });
        c.onchange = () => this.endLive();
        return c;
      };
      row("近 → 远", el("div", { class: "tm-colors" }, pick("color"), pick("color2")), el("span"));
    }
    choose("透明", "alpha", [["soft", "半透明"], ["dither", "像素抖动"]], "像素画选「像素抖动」：越淡的残影像素越稀疏，没有半透明像素");
    choose("混合", "blend", [["normal", "正常"], ["add", "发光（叠加变亮）"]]);

    // motion
    slider("偏移 X", "dx", -12, 12, "px", "每个残影再往这个方向挪一点：原地跑的冲刺动画也能拉出残影");
    slider("偏移 Y", "dy", -12, 12, "px");
    const loop = el("input", { type: "checkbox", checked: !!s.loop, onchange: () => this.edit((gh) => { gh.loop = loop.checked; }) });
    P.append(el("label", { class: "ed-check" }, loop, "循环动画：开头几帧用结尾的帧做残影"));

    // the same afterimage done by the game at run time (trails/ghostexport.js)
    P.append(el("div", { class: "ed-panel-title" }, "导出给程序"));
    row("参数", el("div", { class: "tm-colors" },
      el("button", { class: "btn small", title: "Godot 4 脚本：挂到角色精灵下的 Node2D 上，运行时自动留残影，设置已填好", onclick: () => this.exportFor("godot") }, "Godot 脚本"),
      el("button", { class: "btn small", title: "通用 JSON：参数 + 计算公式，Unity / Cocos / 自研引擎照着实现", onclick: () => this.exportFor("json") }, "JSON 参数")));

    const src = ghostSources(this.doc.layers, l);
    const hint = !src.length
      ? "没有可复制的图层：来源图层被隐藏了，或者还没有像素图层。"
      : "残影是前几帧画面的副本，自动跟着动画变化，不用手画。到要加残影的帧点时间轴上的「残影 ＋」，「－」去掉（残影图层那一行紫点 = 已加入）。图层放在角色下面，残影就在角色身后；用 ↑ ↓ 调整前后。";
    P.append(el("p", { class: "ed-hint" }, hint));
  }
}
