// 场景编辑器: a scene card opened full screen. Cards from the board on the left
// (click one, or drag it onto the stage), the stage in the middle — drag an
// item to move it, its corners to scale it, the round handle to turn it — the
// selected item's settings (or the stage's) on the right, and below a
// timeline with a row per item: when it starts and how long it plays.
//
// Edits go straight into the card (like the tuner): they save themselves and
// undo with the board's own undo. The scene only refers to its cards, so it
// redraws whenever one of them changes.
import { el, uid, clamp, setPath } from "../core/util.js";
import { nodeType } from "../nodes/registry.js";
import { makeForm } from "../ui/form.js";
import { dockSplit } from "../ui/dock.js";
import { showMenu } from "../ui/menu.js";
import {
  ITEM_DEFAULTS, ENTERS, EXITS, normalizeScene, placeableCards, sourceOf, sources, itemFrame, itemEnd, sceneLength,
  itemCorners, hitItem, drawScene,
} from "./model.js";
import { loadPacks, spriteCard, groundCard, stripCard, groundSpec, groundOfWidth, exampleScale, askExample, whenReady } from "./presets.js";
import { VFX_KINDS, VFX_DEFAULTS } from "../vfx/effects.js";
import { renderVfxAsync } from "../vfx/layer.js";
import { putCanvasAsset } from "../core/assets.js";

const HANDLE = 6;      // corner handle half-size, screen px
const ROT_GAP = 26;    // the turn handle above the top edge, screen px

export function openSceneEditor(app, cardId) {
  const s = new SceneEditor(app, cardId);
  s.open();
  return s;
}

class SceneEditor {
  constructor(app, id) {
    this.app = app;
    this.store = app.store;
    this.id = id;
    this.sel = null;          // the selected item's id
    this.fi = 0;
    this.playing = false;
    this.zoom = 1; this.panX = 0; this.panY = 0;
    this.drag = null;
    this.space = false;
    this.thumbs = new Map();  // card id -> { ver, canvas }
  }

  get card() { return this.store.cards[this.id]; }
  get p() { return this.card.params; }
  scene() { return normalizeScene(this.p); }
  item(id = this.sel) { return id ? this.scene().items.find((x) => x.id === id) || null : null; }

  // write into the card's params; coalesced edits undo as one step
  set(fn, coalesce) {
    this.store.mutate((d) => {
      const c = d.board.cards[this.id];
      if (!c) return;
      c.params.items = c.params.items || [];
      fn(c.params);
    }, { coalesce: coalesce ? this.id + ":" + coalesce : null });
  }
  setItem(id, patch, coalesce) {
    this.set((pp) => { const it = pp.items.find((x) => x.id === id); if (it) Object.assign(it, patch); }, coalesce);
  }

  // ---------- lifecycle ----------
  open() {
    // older / partial params to the current shape once, silently; every item an id
    this.store.mutate((d) => {
      const c = d.board.cards[this.id];
      const n = normalizeScene(c.params);
      for (const it of n.items) if (!it.id) it.id = uid("I");
      c.params = { ...c.params, ...n, items: n.items };
    }, { history: false, silent: true });
    this.build();
    document.body.append(this.root);
    this.root.focus();
    this.offChange = this.store.on("change", () => this.refresh());
    this.offReset = this.store.on("reset", () => { if (!this.card) { this.close(); return; } this.refresh(true); });
    this.offResult = this.app.engine.on("result", (id) => {
      if (this.scene().items.some((it) => it.card === id) || this.store.cards[id]) this.refresh();
    });
    this.ro = new ResizeObserver(() => this.requestRender());
    this.ro.observe(this.stage);
    // items left behind by cards deleted before deleting took them along
    if (this.p.items && this.p.items.some((it) => !this.store.cards[it.card])) this.set((pp) => { pp.items = pp.items.filter((it) => this.store.cards[it.card]); });
    this.refresh(true);
    requestAnimationFrame(() => this.fit());
    this.buildPresets();
    this.buildFx();
  }

  close() {
    this.playing = false;
    cancelAnimationFrame(this.playRaf);
    this.offChange(); this.offReset(); this.offResult();
    this.ro.disconnect();
    this.root.remove();
    this.app.board.root.focus();
  }

  // ---------- DOM ----------
  build() {
    this.nameEl = el("span", { class: "ed-title" });
    this.sizeEl = el("span", { class: "ed-size mono" });
    const top = el("div", { class: "ed-top" },
      el("span", { class: "ed-badge" }, "场景编辑器"), this.nameEl, this.sizeEl,
      el("button", { class: "icon-btn", title: "撤销 (Ctrl+Z)", onclick: () => this.store.undo() }, "↶"),
      el("button", { class: "icon-btn", title: "重做 (Ctrl+Y)", onclick: () => this.store.redo() }, "↷"),
      el("button", { class: "btn small", title: "整个舞台放进窗口（F）", onclick: () => this.fit() }, "适合窗口"),
      el("span", { class: "spacer" }),
      el("span", { class: "ed-save mono" }, "改动自动保存"),
      el("button", { class: "icon-btn", title: "快捷键", onclick: () => this.showHelp() }, "?"),
      el("button", { class: "btn primary", onclick: () => this.exportGodot() }, "导出 Godot 场景…"),
      el("button", { class: "btn", onclick: () => this.close() }, "关闭"),
    );

    // the cards that can go in
    this.libEl = el("div", { class: "sc-lib" });
    this.presetEl = el("div", { class: "sc-presets" });
    this.fxEl = el("div", { class: "sc-pack" });
    const left = el("div", { class: "ed-side sc-left" },
      this.presetEl,
      this.fxEl,
      el("div", { class: "ed-panel-title" }, "画布上的卡片"),
      this.libEl,
      el("p", { class: "ed-hint" }, "画布上的动画、素材图、特效和处理结果都能放进来。点一下放到舞台中间，或者拖到舞台上的任意位置。场景里只记引用：改了原卡片，这里跟着变。"));

    this.canvas = el("canvas", { class: "ed-canvas" });
    this.g = this.canvas.getContext("2d");
    this.statusEl = el("div", { class: "ed-status mono" });
    this.stage = el("div", { class: "ed-stage sc-stage" }, this.canvas, this.statusEl);
    this.bindStage();

    this.props = el("div", { class: "ed-side sc-right" });

    // the timeline
    this.playBtn = el("button", { class: "tool-btn play", title: "播放 / 暂停（Enter）", onclick: () => this.togglePlay() }, "▶");
    this.posEl = el("span", { class: "mono tl-pos" });
    const bar = el("div", { class: "tl-bar" },
      el("button", { class: "tool-btn", title: "第一帧（Home）", onclick: () => this.goFrame(0) }, "⏮"),
      el("button", { class: "tool-btn", title: "上一帧（,）", onclick: () => this.step(-1) }, "◀"),
      this.playBtn,
      el("button", { class: "tool-btn", title: "下一帧（.）", onclick: () => this.step(1) }, "▶|"),
      this.posEl,
      el("span", { class: "tl-sep" }),
      el("span", { class: "dim" }, "每行一个元素，从上到下就是从顶层到底层：上下拖左边的名字调整层级。条从出现画到播完，斜纹 = 循环一直播；左右拖条改出现时间，点刻度跳到那一帧。"));
    this.tlEl = el("div", { class: "sc-tl" });
    const timeline = el("div", { class: "ed-timeline sc-timeline" }, bar, el("div", { class: "tl-scroll" }, this.tlEl));

    const leftBar = dockSplit(left, { key: "gt.sceneLayout", id: "lib", axis: "x", after: false, def: 210, min: 150, max: () => 360, label: "素材栏" });
    const rightBar = dockSplit(this.props, { key: "gt.sceneLayout", id: "props", axis: "x", after: true, def: 260, min: 210, max: () => Math.max(260, window.innerWidth * 0.4), label: "属性栏" });
    const tlBar = dockSplit(timeline, { key: "gt.sceneLayout", id: "timeline", axis: "y", after: true, def: 190, min: 90, max: () => Math.max(140, window.innerHeight * 0.55), label: "时间轴" });
    this.root = el("div", { class: "editor-root open scene-editor", tabindex: "-1" },
      top, el("div", { class: "ed-main" }, left, leftBar, this.stage, rightBar, this.props), tlBar, timeline);
    this.root.addEventListener("keydown", (e) => this.onKey(e, true));
    this.root.addEventListener("keyup", (e) => this.onKey(e, false));
  }

  // ---------- refresh ----------
  refresh(full) {
    if (!this.card) return;
    const s = this.scene();
    if (this.sel && !s.items.some((x) => x.id === this.sel)) this.sel = null;
    this.srcs = sources(this.app, s);
    this.length = sceneLength(s, this.srcs);
    this.fi = clamp(this.fi, 0, this.length - 1);
    this.nameEl.textContent = this.card.title || "场景";
    this.sizeEl.textContent = s.w + " × " + s.h + " · " + s.fps + " fps · " + this.length + " 帧 · " + s.items.length + " 个元素";
    const key = (this.sel || "") + "|" + s.items.length;
    if (full || key !== this.propsKey) { this.propsKey = key; this.buildProps(); }
    else if (this.form) this.form.sync();
    this.buildLib();
    this.buildTimeline();
    this.requestRender();
  }

  thumb(cardId) {
    const src = sourceOf(this.app, cardId), size = 40;
    const c = this.thumbs.get(cardId);
    if (c && c.ver === (src && src.ver)) return c.canvas;
    const cv = el("canvas", { class: "sc-thumb", width: size, height: size });
    if (src) {
      const f = src.frames[0].canvas, k = Math.min(size / src.w, size / src.h);
      const g = cv.getContext("2d");
      g.imageSmoothingEnabled = k < 1;
      g.drawImage(f, (size - src.w * k) / 2, (size - src.h * k) / 2, src.w * k, src.h * k);
    }
    this.thumbs.set(cardId, { ver: src && src.ver, canvas: cv });
    return cv;
  }

  buildLib() {
    const cards = placeableCards(this.app);
    const used = new Map();
    for (const it of this.scene().items) used.set(it.card, (used.get(it.card) || 0) + 1);
    // only when what it lists has changed (not on every drag)
    const key = cards.map((c) => { const s = sourceOf(this.app, c.id); return c.id + ":" + (c.title || "") + ":" + (s ? s.ver : "-") + ":" + (used.get(c.id) || 0); }).join(",");
    if (key === this.libKey) return;
    this.libKey = key;
    this.libEl.replaceChildren(...(cards.length ? cards.map((c) => {
      const def = nodeType(c.type), src = sourceOf(this.app, c.id);
      const row = el("button", {
        class: "sc-lib-item" + (src ? "" : " empty"), draggable: "true",
        title: src ? "点击放到舞台中间，或拖到舞台上" : "这张卡片现在还没有画面",
        onclick: () => { if (src) this.addItem(c.id); },
      }, this.thumb(c.id), el("span", { class: "sc-lib-name" }, c.title || def.title),
      el("span", { class: "sc-lib-kind" }, def.title + (src && !src.still ? " · " + src.frames.length + " 帧" : "") + (used.get(c.id) ? " · 已放 " + used.get(c.id) : "")));
      row.addEventListener("dragstart", (e) => { e.dataTransfer.setData("application/x-scene-card", c.id); e.dataTransfer.effectAllowed = "copy"; });
      return row;
    }) : [el("p", { class: "ed-hint" }, "画布上还没有能放的卡片：先添加图片、动画或特效。")]));
  }

  // ---------- items ----------
  // opts: { scale, index (where in the stack; default on top) }
  addItem(cardId, at, opts = {}) {
    const s = this.scene(), src = sourceOf(this.app, cardId);
    if (!src) return;
    // big pictures come in fitted to the stage; the anchor (feet) where asked, or low in the middle
    const scale = opts.scale || Math.min(1, (s.h * 0.8) / src.h, (s.w * 0.9) / src.w);
    const card = this.store.cards[cardId];
    const it = { ...ITEM_DEFAULTS, id: uid("I"), card: cardId, x: Math.round(at ? at.x : s.w / 2), y: Math.round(at ? at.y : s.h * 0.85), scale: +scale.toFixed(3), name: card.title || "" };
    this.set((pp) => { if (opts.index != null) pp.items.splice(opts.index, 0, it); else pp.items.push(it); });
    this.sel = it.id;
    this.refresh(true);
  }

  removeItem(id = this.sel) {
    if (!id) return;
    this.set((pp) => { pp.items = pp.items.filter((x) => x.id !== id); });
    if (this.sel === id) this.sel = null;
  }

  duplicate(id = this.sel) {
    const it = this.item(id);
    if (!it) return;
    const copy = { ...it, id: uid("I"), x: it.x + 16, y: it.y + 16 };
    // selected first: the panel built on the change is the copy's
    this.sel = copy.id;
    this.set((pp) => { const i = pp.items.findIndex((x) => x.id === id); pp.items.splice(i + 1, 0, copy); });
  }

  // to: "top" | "up" | "down" | "bottom"
  reorder(to, id = this.sel) {
    this.set((pp) => {
      const i = pp.items.findIndex((x) => x.id === id);
      if (i < 0) return;
      const [it] = pp.items.splice(i, 1);
      const j = to === "top" ? pp.items.length : to === "bottom" ? 0 : clamp(i + (to === "up" ? 1 : -1), 0, pp.items.length);
      pp.items.splice(j, 0, it);
    });
  }

  // the picture covering the whole stage (a backdrop), at the bottom
  fillStage(id = this.sel) {
    const it = this.item(id), src = it && this.srcs.get(it.card), s = this.scene();
    if (!src) return;
    const k = Math.max(s.w / src.w, s.h / src.h);
    this.set((pp) => {
      const i = pp.items.findIndex((x) => x.id === id);
      if (i < 0) return;
      Object.assign(pp.items[i], { x: s.w / 2, y: (s.h + src.h * k) / 2, scale: +k.toFixed(4), rot: 0 });
      const [x] = pp.items.splice(i, 1);
      pp.items.unshift(x);
    });
  }

  openSource(id = this.sel) {
    const it = this.item(id), card = it && this.store.cards[it.card];
    const def = card && nodeType(card.type);
    if (!def || !def.open) { this.app.toast("这种卡片没有单独的编辑器，在画布上选中它改右侧参数。"); return; }
    const ctx = this.app.board.ctxOf(it.card);
    if (ctx) def.open(ctx);
  }

  // ---------- presets (scene/presets.js) ----------
  async buildPresets() {
    let packs;
    try { packs = await loadPacks(); } catch (err) { this.presetEl.replaceChildren(el("p", { class: "ed-hint warn" }, err.message)); return; }
    this.packs = packs;
    this.presetEl.replaceChildren(...packs.map((pack) => {
      const groups = [...new Set(pack.sprites.map((s) => s.group))];
      const grassTop = el("input", { type: "checkbox" });
      return el("div", { class: "sc-pack" },
        el("div", { class: "ed-panel-title" }, "预设 · " + pack.name, el("span", { class: "spacer" }),
          el("button", { class: "tool-btn", title: "按素材包的示意图摆好一整个场景：远山、浮空遗迹、房屋、古树、祭坛、地面和天空色", onclick: () => this.applyExample(pack) }, "示例场景")),
        ...groups.map((gname) => el("div", { class: "sc-pgroup" },
          el("div", { class: "sc-pgroup-name" }, gname),
          el("div", { class: "sc-preset-grid" }, ...pack.sprites.filter((x) => x.group === gname).map((sp) => {
            const b = el("button", { class: "sc-preset", draggable: "true", title: sp.name + "：点击放到舞台中间，或拖到舞台上", onclick: () => this.addPreset(pack.id + "/" + sp.id) },
              el("img", { src: pack.base + sp.file, alt: sp.name, draggable: false }), el("span", null, sp.name));
            b.addEventListener("dragstart", (e) => { e.dataTransfer.setData("application/x-scene-preset", pack.id + "/" + sp.id); e.dataTransfer.effectAllowed = "copy"; });
            return b;
          })))),
        pack.tiles ? el("div", { class: "sc-pgroup" },
          el("div", { class: "sc-pgroup-name" }, "地面（铺满舞台宽度）"),
          el("div", { class: "sc-preset-grid" },
            // whole strips first (a picture repeated across), then the 16×16 tiles
            ...(pack.strips || []).map((st) => el("button", {
              class: "sc-preset", title: "在舞台底部横着铺一条「" + st.name + "」（整张地面图左右无缝重复，高度随舞台）", onclick: () => this.addStrip(pack, st),
            }, el("img", { src: pack.base + st.file, alt: st.name }), el("span", null, st.name))),
            ...pack.tiles.materials.map((m) => el("button", {
              class: "sc-preset tile", title: "在舞台底部铺一条" + m.name + "地面（16×16 图块，变体随机混排）", onclick: () => this.addGround(pack, m.id, grassTop.checked),
            }, el("img", { src: pack.base + m.files[0], alt: m.name }), el("span", null, m.name)))),
          pack.tiles.grassTop ? el("label", { class: "ed-check" }, grassTop, "顶上加一道草边") : null) : null);
    }));
  }

  // ---------- effects made right here ----------
  // Every kind of effect (vfx/effects.js) to click or drag in: a new 特效 card
  // is made for it next to the scene (so it can be exported, baked, reused
  // like any other), and its settings show on the right while it is selected.
  buildFx() {
    const grid = el("div", { class: "sc-preset-grid" });
    this.fxEl.replaceChildren(el("div", { class: "ed-panel-title" }, "特效"), grid,
      el("p", { class: "ed-hint" }, "点一下或拖到舞台上，就在这里新建一个特效（画布上同时多一张特效卡片）；选中它后右边直接改类型、配色、大小、粒子等。"));
    for (const k of VFX_KINDS) {
      const thumb = el("canvas", { width: 48, height: 40 });
      const b = el("button", { class: "sc-preset", draggable: "true", title: k.name + "：" + k.help, onclick: () => this.addFx(k.id) }, thumb, el("span", null, k.name));
      b.addEventListener("dragstart", (e) => { e.dataTransfer.setData("application/x-scene-fx", k.id); e.dataTransfer.effectAllowed = "copy"; });
      grid.append(b);
      // a little picture of it, from the middle of its run
      const p = { ...VFX_DEFAULTS, ...k.defaults, kind: k.id, w: 96, h: 80, style: "hd" };
      renderVfxAsync(p, Math.floor((p.frames || 8) * (p.loop ? 0.25 : 0.4))).then((c) => {
        const g = thumb.getContext("2d");
        g.clearRect(0, 0, 48, 40);
        g.drawImage(c, 0, 0, 48, 40);
      }).catch(() => {});
    }
  }

  // a new effect of kind into the scene: its box centred where asked (or on
  // the stage), unless at is where its bottom goes (dropped)
  async addFx(kind, at, dropped) {
    const k = VFX_KINDS.find((x) => x.id === kind);
    if (!k) return;
    const s = this.scene(), size = Math.round(Math.max(96, Math.min(320, Math.min(s.w, s.h) * 0.45)));
    // clouds: a band of sky as wide as the stage, over its upper part
    const sky = kind === "cloud", bw = sky ? Math.min(2048, s.w) : size, bh = sky ? Math.round(Math.max(64, Math.min(1024, s.h * 0.45))) : size;
    const params = { ...VFX_DEFAULTS, ...k.defaults, kind: k.id, w: bw, h: bh };
    const id = await this.busy("正在新建特效「" + k.name + "」…", async () => {
      const c = this.card, x = c ? c.x + c.w + 60 : 0, y = c ? c.y : 0, spot = this.app.freeSpot(x, y, 260, 300);
      const nid = this.app.addCard("vfx", spot.x, spot.y, params, { title: k.name, select: false });
      await whenReady(this.app, nid);
      return nid;
    });
    if (!id) return;
    const where = at ? { x: at.x, y: dropped ? at.y + bh / 2 : at.y } : sky ? { x: s.w / 2, y: bh + Math.round(s.h * 0.05) } : { x: s.w / 2, y: s.h / 2 + size / 2 };
    this.addItem(id, where, { scale: 1 });
  }

  findPreset(key) {
    const [pid, sid] = String(key).split("/");
    const pack = (this.packs || []).find((p) => p.id === pid), sprite = pack && pack.sprites.find((x) => x.id === sid);
    return pack && sprite ? { pack, sprite } : null;
  }

  // run fn with a message up meanwhile; its result, or null when it failed
  async busy(text, fn) {
    const t = this.app.toast(text);
    try { return await fn(); } catch (err) { console.error(err); this.app.toast("加入失败：" + err.message, "error"); return null; } finally { t.remove(); }
  }

  // a preset sprite into the scene, as big as in the pack's example scene
  async addPreset(key, at) {
    const f = this.findPreset(key);
    if (!f) return;
    const id = await this.busy("正在加入「" + f.sprite.name + "」…", () => spriteCard(this.app, f.pack, f.sprite, this.id));
    if (!id) return;
    const src = sourceOf(this.app, id);
    this.addItem(id, at, { scale: src ? exampleScale(f.pack, f.sprite.id, src.w) : null });
  }

  // a strip of ground along the bottom of the stage, above the distant layers
  async addGround(pack, material, grassTop) {
    const s = this.scene(), k = (pack.scene && pack.scene.ground && pack.scene.ground.scale) || 3, ts = pack.tiles.size * k;
    const tilesX = Math.ceil(s.w / ts), tilesY = Math.max(2, Math.ceil(s.h * 0.25 / ts));
    const id = await this.busy("正在铺地面…", () => groundCard(this.app, pack, material, tilesX, tilesY, grassTop, this.id));
    if (!id) return;
    const far = new Set(pack.sprites.filter((x) => x.group === "远景").map((x) => pack.id + "/" + x.id));
    const items = this.scene().items;
    let index = 0;
    while (index < items.length && far.has(((this.store.cards[items[index].card] || {}).params || {}).preset)) index++;
    this.addItem(id, { x: s.w / 2, y: s.h }, { scale: k, index });
  }

  // A ground item made another width (stage px), its height kept: its picture
  // made again that wide (presets.js groundOfWidth) — into its own card if
  // other layers show the same one (forkCard), into that card otherwise. fill:
  // also put it at the bottom middle of the stage.
  // A ground item made another width (stage px), its height kept: its picture
  // made again that wide (presets.js groundOfWidth) — into its own card if
  // other layers show the same one (forkCard), into that card otherwise. An
  // imported picture (not yet a ground) always gets a 地面 card of its own made
  // from it: the picture's card stays as it is. fill: also put it at the
  // bottom middle of the stage.
  async setGroundWidth(itemId, stageW, fill) {
    const it = this.item(itemId), card = it && this.store.cards[it.card], src = it && this.srcs.get(it.card);
    const spec = groundSpec(card) || this.pictureGround(card);
    if (!spec || !src) return;
    const pack = spec.kind === "image" ? null : (this.packs || []).find((p) => p.id === spec.pack);
    if (spec.kind !== "image" && !pack) { this.app.toast("素材包还没加载好，稍后再试", "warn"); return; }
    const k = Math.abs(it.scale || 1), width = Math.max(4, Math.round(Math.max(16, Math.min(20000, stageW || 0)) / k));
    if (width === src.w && !fill) return;
    const made = await this.busy("正在铺地面…", async () => {
      const canvas = await groundOfWidth(pack, spec, width, src.h, this.store.projectId);
      return { canvas, asset: await putCanvasAsset(this.store.projectId, canvas) };
    });
    if (!made) return;
    const ground = { ...spec, width: made.canvas.width };
    if (spec.kind === "image") {
      const patch = { asset: made.asset, ground, preset: "" };
      if (!groundSpec(card)) this.forkCard(itemId, { ...patch, name: "地面 · " + spec.name }, { title: "地面 · " + spec.name });
      else if (this.sharedCard(it.card, itemId)) this.forkCard(itemId, patch);
      else this.store.mutate((d) => { const c = d.board.cards[it.card]; if (c) Object.assign(c.params, patch); });
    } else {
      // its own key from now on: a new strip of the old width doesn't pick this one up
      const patch = { asset: made.asset, ground, preset: spec.pack + "/" + (spec.kind === "strip" ? "strip" : "ground") + ":" + spec.id + ":w" + made.canvas.width };
      if (this.sharedCard(it.card, itemId)) this.forkCard(itemId, patch);
      else this.store.mutate((d) => { const c = d.board.cards[it.card]; if (c) Object.assign(c.params, patch); });
    }
    if (fill) { const s = this.scene(); this.setItem(itemId, { x: s.w / 2, y: s.h }); }
  }

  // an imported picture as a ground to repeat across: { kind: "image", asset,
  // name } — not the presets' buildings and props (sprites), or null
  pictureGround(card) {
    if (!card || card.type !== "image" || !card.params || !card.params.asset) return null;
    const pr = card.params.preset || "";
    if (pr && !/\/(strip|ground):/.test(pr)) return null;
    return { kind: "image", asset: card.params.asset, name: card.title || card.params.name || "图片" };
  }

  // a whole strip of ground (pack.strips) along the bottom: as tall as its
  // share of the stage, repeated to cover its width, above the distant layers
  async addStrip(pack, strip) {
    const s = this.scene();
    const id = await this.busy("正在铺地面…", async () => {
      const img = await new Promise((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => no(new Error("地面图加载失败")); im.src = pack.base + strip.file; });
      const k = +((s.h * (strip.share || 0.27)) / img.height).toFixed(4), times = Math.max(1, Math.ceil(s.w / (img.width * k)));
      return { card: await stripCard(this.app, pack, strip, times, this.id), k };
    });
    if (!id) return;
    const far = new Set(pack.sprites.filter((x) => x.group === "远景").map((x) => pack.id + "/" + x.id));
    const items = this.scene().items;
    let index = 0;
    while (index < items.length && far.has(((this.store.cards[items[index].card] || {}).params || {}).preset)) index++;
    this.addItem(id.card, { x: s.w / 2, y: s.h }, { scale: id.k, index });
  }

  // the pack's example scene: every piece where its preview has it
  async applyExample(pack) {
    const ex = pack.scene;
    if (!ex) return;
    const how = await askExample(this.scene().items.length > 0, ex.name);
    if (!how) return;
    const made = await this.busy("正在摆放示例场景…", async () => {
      const out = [], cur = this.scene();
      const k = ex.ground.scale || 3, ts = pack.tiles.size * k, w = how === "replace" ? ex.w : cur.w, h = how === "replace" ? ex.h : cur.h;
      for (const it of ex.items) {
        if (it.ground) {
          const tilesX = Math.ceil(w / ts), tilesY = Math.max(1, Math.ceil((h - ex.ground.y) / ts));
          const id = await groundCard(this.app, pack, ex.ground.material, tilesX, tilesY, false, this.id);
          out.push({ id, x: w / 2, y: ex.ground.y + tilesY * ts, scale: k });
          continue;
        }
        const sp = pack.sprites.find((x) => x.id === it.sprite);
        if (!sp) continue;
        const id = await spriteCard(this.app, pack, sp, this.id), src = sourceOf(this.app, id);
        out.push({ id, x: it.x, y: it.y, scale: src ? +(it.w / src.w).toFixed(4) : 1 });
      }
      return out;
    });
    if (!made) return;
    this.set((pp) => {
      if (how === "replace") { pp.items = []; pp.w = ex.w; pp.h = ex.h; pp.bg = ex.bg; }
      for (const m of made) pp.items.push({ ...ITEM_DEFAULTS, id: uid("I"), card: m.id, x: m.x, y: m.y, scale: m.scale, name: (this.store.cards[m.id] || {}).title || "" });
    });
    this.sel = null;
    this.refresh(true);
    this.fit();
  }

  // ---------- the right side ----------
  buildProps() {
    const P = this.props;
    P.replaceChildren();
    const section = (title, hint) => {
      const body = el("div", { class: "f-section-body" });
      P.append(el("div", { class: "f-section" }, el("div", { class: "f-section-title" }, title), hint ? el("p", { class: "f-hint" }, hint) : null, body));
      return body;
    };
    const it = this.item();
    if (!it) {
      // the stage itself
      const f = this.form = makeForm({
        id: this.id + ":stage",
        params: () => this.scene(),
        set: (patch, opts = {}) => this.set((pp) => { for (const k in patch) setPath(pp, k, patch[k]); }, opts.coalesce),
      }, section("舞台", "舞台就是 Godot 里摄像机看到的范围。没选中元素时这里设置整个场景。"));
      f.pair((s) => s.number("宽", "w", { min: 16, max: 8192 }), (s) => s.number("高", "h", { min: 16, max: 8192 }));
      f.pair((s) => s.number("帧率", "fps", { min: 1, max: 60 }), (s) => s.number("时长（帧，0 = 自动）", "length", { min: 0, max: 100000 }));
      f.hint(() => "现在共 " + this.length + " 帧（" + (this.length / this.scene().fps).toFixed(2) + " 秒）" + (this.scene().length ? "。" : "：按帧数最多的元素（加上它的延迟帧数）算。每个元素在场景里一帧放它自己的一帧，快慢由场景帧率决定。"));
      const color = el("input", { type: "color", class: "sc-color" });
      const clear = el("input", { type: "checkbox" });
      color.addEventListener("input", () => this.set((pp) => { pp.bg = color.value; }, "bg"));
      clear.addEventListener("change", () => this.set((pp) => { pp.bg = clear.checked ? "" : color.value || "#1f2430"; }));
      f.custom(el("div", { class: "f-row sc-bg-row" }, el("span", { class: "f-label" }, "背景色"), color, el("label", { class: "f-check" }, clear, el("span", null, "透明"))), () => {
        const bg = this.scene().bg;
        if (document.activeElement !== color) color.value = bg || "#1f2430";
        clear.checked = !bg; color.disabled = !bg;
      });
      const g = section("使用");
      g.append(el("p", { class: "f-hint" }, "左边点素材放进来；在舞台上拖动元素移动，拖四角的方块缩放，拖上方的圆点旋转（按住 Shift 每 15° 一格）；双击元素打开它的源卡片编辑。背景图放进来后点「铺满舞台」。"),
        el("div", { class: "f-buttons" }, el("button", { class: "btn primary", onclick: () => this.exportGodot() }, "导出 Godot 场景…")));
      return;
    }
    const id = it.id;
    // the item's settings, in several sections synced together
    const ctx = {
      id: this.id + ":" + id,
      params: () => this.item(id) || {},
      set: (patch, opts = {}) => this.set((pp) => { const x = pp.items.find((y) => y.id === id); if (x) for (const k in patch) setPath(x, k, patch[k]); }, opts.coalesce),
    };
    const f = this.form = makeForm(ctx, section("元素"));
    const card = this.store.cards[it.card], def = card && nodeType(card.type);
    f.text("名称", "name", { placeholder: card ? card.title || def.title : "" });
    f.readout(() => {
      const src = this.srcs.get(it.card), c = this.store.cards[it.card];
      return [["来源", c ? (c.title || nodeType(c.type).title) + "（" + nodeType(c.type).title + "）" : "（卡片已删除）"], ["画面", src ? src.w + " × " + src.h + (src.still ? " · 静图" : " · " + src.frames.length + " 帧") : "没有画面"]];
    });
    f.buttons(["编辑源卡片", () => this.openSource(id), { title: "打开这张卡片的编辑器（双击元素也行）" }]);
    const t = makeForm(ctx, section("位置", "元素以图片底边中点（脚底）为锚点摆放、缩放和旋转。"), { syncers: f.syncers });
    t.pair((s) => s.number("X", "x", { integer: false }), (s) => s.number("Y", "y", { integer: false }));
    t.pair((s) => s.number("缩放", "scale", { min: 0.01, max: 50, step: 0.05, integer: false }), (s) => s.number("旋转 °", "rot", { min: -360, max: 360, integer: false }));
    t.check("水平翻转", "flip");
    t.slider("不透明度", "opacity", { min: 0, max: 100, unit: "%" });
    t.buttons(["铺满舞台", () => this.fillStage(id), { title: "放大到盖住整个舞台并放到最底层，适合背景图" }],
      ["底边居中", () => { const s = this.scene(); this.setItem(id, { x: s.w / 2, y: s.h }); }],
      ["重置变换", () => this.setItem(id, { scale: 1, rot: 0, flip: false, opacity: 100 })]);
    // a ground (from the presets): its width on its own, the height kept
    const isGround = !!groundSpec(this.store.cards[it.card]), asPicture = !isGround && this.pictureGround(this.store.cards[it.card]);
    if (isGround || asPicture) {
      const gb = isGround
        ? section("地面", "只改宽度、高度不变：整张地面左右无缝地重复、在宽度处截断，图块地面按格子铺。")
        : section("横向平铺（当地面用）", "把这张图当成可以左右重复的地面：改宽度时高度不变，图片横着重复、在宽度处截断（图的左右边缘能接上就看不出接缝）。第一次修改会另外生成一张「地面」卡片给这个图层，原来的图片卡片不变。");
      const shownW = () => { const x = this.item(id), src = x && this.srcs.get(x.card); return src ? Math.round(src.w * Math.abs(x.scale || 1)) : 0; };
      const wIn = el("input", { type: "number", class: "mono", min: 16, max: 20000, step: 10, value: shownW(),
        onchange: () => this.setGroundWidth(id, +wIn.value), onkeydown: (e) => { if (e.key === "Enter") wIn.blur(); } });
      f.syncers.push(() => { if (document.activeElement !== wIn) wIn.value = shownW(); });
      gb.append(el("label", { class: "f-field wide" }, el("span", { class: "f-label" }, "宽度（舞台像素）"), wIn),
        el("div", { class: "f-buttons" },
          el("button", { class: "btn", title: "和舞台一样宽，并放到底边正中", onclick: () => this.setGroundWidth(id, this.scene().w, true) }, "铺满舞台宽度"),
          el("button", { class: "btn", onclick: () => this.setGroundWidth(id, shownW() - 100) }, "−100"),
          el("button", { class: "btn", onclick: () => this.setGroundWidth(id, shownW() + 100) }, "+100")));
    }
    const pl = makeForm(ctx, section("播放"), { syncers: f.syncers });
    pl.number("延迟帧数（0 = 一开始就出现）", "start", { min: 0, max: 100000, wide: true });
    pl.hint(() => { const x = this.item(id); return x ? "在第 " + (x.start + 1) + " 帧出现（" + (x.start / this.scene().fps).toFixed(2) + " 秒）。" : ""; });
    pl.check("循环播放", "loop");
    pl.select("不循环时播完后", "after", [["hold", "停在最后一帧"], ["hide", "消失"]], { wide: true });
    // again and again, coming in and going out
    pl.number("重复出现：每隔几帧出现一次（0 = 只出现一次）", "every", { min: 0, max: 100000, wide: true });
    pl.hint(() => {
      const x = this.item(id);
      if (!x || !(x.every > 0)) return "";
      return "第 " + (x.start + 1) + " 帧起每隔 " + x.every + " 帧（" + (x.every / this.scene().fps).toFixed(2) + " 秒）出现一次，每次从第一帧播放；" +
        (x.loop ? "循环的元素每次显示到下一次出现前。" : x.after === "hide" ? "每次播完就消失。" : "每次播完停在最后一帧，直到下一次。");
    });
    pl.pair((s) => s.select("出现效果", "enter", ENTERS), (s) => s.number("帧数", "enterLen", { min: 1, max: 600 }));
    pl.pair((s) => s.select("消失效果", "exit", EXITS), (s) => s.number("帧数", "exitLen", { min: 1, max: 600 }));
    pl.hint("放大缩小都以图片中心为准。消失效果在每次显示的最后几帧：只出现一次又一直显示的元素没有「最后」，看不到消失效果——设了「重复出现」或「播完消失」才有。");
    pl.check("显示", "visible");
    const order = section("层级与操作");
    order.append(el("div", { class: "f-buttons" },
      el("button", { class: "btn", title: "放到最上面", onclick: () => this.reorder("top", id) }, "置顶"),
      el("button", { class: "btn", title: "上移一层", onclick: () => this.reorder("up", id) }, "上移"),
      el("button", { class: "btn", title: "下移一层", onclick: () => this.reorder("down", id) }, "下移"),
      el("button", { class: "btn", title: "放到最下面", onclick: () => this.reorder("bottom", id) }, "置底")),
    el("div", { class: "f-buttons" },
      el("button", { class: "btn", title: "复制一份（Ctrl+D）", onclick: () => this.duplicate(id) }, "复制"),
      el("button", { class: "btn danger", title: "从场景里删掉（Delete），原卡片不受影响", onclick: () => this.removeItem(id) }, "删除")));
    // a 特效 card: its own settings right here, below (the card's own inspector),
    // for this layer alone
    if (card && card.type === "vfx" && def.inspector) {
      const fctx = this.fxCtx(it.id);
      if (fctx) {
        const body = section("特效参数", "每个图层的特效单独调整：改这里只影响这个图层。和别的图层共用同一张特效卡片时，第一次修改会自动给这个图层复制一张（画布上多一张特效卡片），其他图层不变。");
        def.inspector(fctx, makeForm(fctx, body, { syncers: f.syncers }));
      }
    }
  }

  // ---------- an effect's settings, per layer ----------
  // Is the card shown by another layer (here or in another scene), or wired
  // into other cards on the board?
  sharedCard(cardId, itemId) {
    for (const c of Object.values(this.store.cards)) {
      if (c.type !== "scene") continue;
      for (const x of (c.params && c.params.items) || []) if (x.card === cardId && !(c.id === this.id && x.id === itemId)) return true;
    }
    return Object.values(this.store.edges).some((e) => e.from.card === cardId || e.to.card === cardId);
  }

  // The card's own context, except that a change to a card other layers share
  // first makes this layer its own copy (with the change in it, one step) and
  // goes on with that one — the form keeps going, mid-drag too.
  fxCtx(itemId) {
    const it = this.item(itemId);
    let cur = it && this.app.board.ctxOf(it.card);
    if (!cur) return null;
    return new Proxy({}, {
      has: (_, k) => k in cur,
      get: (_, k) => {
        if (k !== "set") return cur[k];
        return (patch, opts = {}) => {
          const x = this.item(itemId);
          if (!x || !this.sharedCard(x.card, itemId)) return cur.set(patch, opts);
          const nid = this.forkCard(itemId, patch, opts);
          cur = (nid && this.app.board.ctxOf(nid)) || cur;
        };
      },
    });
  }

  // a copy of the item's card next to it on the board, the patch applied,
  // the item showing it
  forkCard(itemId, patch, opts = {}) {
    const it = this.item(itemId), src = it && this.store.cards[it.card];
    if (!src) return null;
    // (opts.title: its title, numbered when taken)
    const base = opts.title || src.title || nodeType(src.type).title, titles = new Set(Object.values(this.store.cards).map((c) => c.title));
    let n = opts.title ? 1 : 2;
    while (titles.has(n === 1 ? base : base + " " + n)) n++;
    const spot = this.app.freeSpot(src.x + src.w + 40, src.y, src.w, src.h);
    const card = this.app.makeCard(src.type, spot.x, spot.y, JSON.parse(JSON.stringify(src.params)), { title: n === 1 ? base : base + " " + n, size: { w: src.w, h: src.h } });
    if (typeof patch === "function") patch(card.params, card);
    else for (const k in patch) setPath(card.params, k, patch[k]);
    this.store.mutate((d) => {
      d.board.cards[card.id] = card;
      const x = ((d.board.cards[this.id].params.items) || []).find((y) => y.id === itemId);
      if (x) x.card = card.id;
    }, { coalesce: opts.coalesce, history: opts.history });
    return card.id;
  }

  // ---------- the timeline ----------
  // Built again only when its rows change (items added, removed, reordered, the
  // length); otherwise the bars are moved in place — so a bar being dragged
  // stays under the pointer.
  buildTimeline() {
    const s = this.scene(), n = this.length;
    const pct = (f) => (100 * f / n) + "%";
    const key = n + "|" + s.items.map((it) => it.id).join(",");
    if (key !== this.tlKey) {
      this.tlKey = key;
      this.tlRows = new Map();
      const ruler = el("div", { class: "sc-ruler" });
      const step = n <= 24 ? 1 : n <= 60 ? 5 : n <= 240 ? 10 : 50;
      for (let f = 0; f < n; f += step) ruler.append(el("span", { class: "sc-tick mono", style: { left: pct(f) } }, String(f + 1)));
      const seek = (e) => {
        const r = ruler.getBoundingClientRect();
        if (this.playing) this.togglePlay();
        this.goFrame(clamp(Math.floor((e.clientX - r.left) / r.width * this.length), 0, this.length - 1));
      };
      ruler.addEventListener("pointerdown", (e) => {
        ruler.setPointerCapture(e.pointerId); seek(e);
        const mv = (ev) => seek(ev), up = () => { ruler.removeEventListener("pointermove", mv); ruler.removeEventListener("pointerup", up); };
        ruler.addEventListener("pointermove", mv); ruler.addEventListener("pointerup", up);
      });
      const rows = [...s.items].reverse().map((it) => {
        const id = it.id;
        const bar = el("div", { class: "sc-bar", title: "左右拖动改开始帧" });
        bar.addEventListener("pointerdown", (e) => {
          e.stopPropagation();
          const cur = this.item(id);
          if (!cur) return;
          if (this.sel !== id) { this.sel = id; this.refresh(); }
          const track = bar.parentElement.getBoundingClientRect(), x0 = e.clientX, s0 = cur.start, k = "start" + Math.random();
          bar.setPointerCapture(e.pointerId);
          const mv = (ev) => this.setItem(id, { start: Math.max(0, s0 + Math.round((ev.clientX - x0) / track.width * this.length)) }, k);
          const up = () => { bar.removeEventListener("pointermove", mv); bar.removeEventListener("pointerup", up); };
          bar.addEventListener("pointermove", mv); bar.addEventListener("pointerup", up);
        });
        const name = el("span", { class: "sc-row-name", title: "上下拖动调整层级" });
        name.addEventListener("pointerdown", (e) => this.dragRow(e, id, name));
        // 删除: out of the scene (the card on the board stays)
        const del = el("button", { class: "sc-row-del", title: "从场景里删掉这个元素（原卡片不受影响）", onclick: (e) => { e.stopPropagation(); this.removeItem(id); } }, "×");
        del.addEventListener("pointerdown", (e) => e.stopPropagation());
        const row = el("div", { class: "sc-row", onclick: () => { if (this.sel !== id) { this.sel = id; this.refresh(); } } },
          el("div", { class: "sc-row-head" }, name, del), el("div", { class: "sc-track" }, bar));
        this.tlRows.set(id, { row, bar, name });
        return row;
      });
      this.head = el("div", { class: "sc-head" });
      this.tlEl.replaceChildren(
        el("div", { class: "sc-row sc-ruler-row" }, el("span", { class: "sc-row-name dim" }, "帧"), el("div", { class: "sc-track" }, ruler, this.head)),
        ...rows,
        ...(s.items.length ? [] : [el("p", { class: "ed-hint sc-empty" }, "还没有元素：从左边把素材放进来。")]));
    }
    for (const it of s.items) {
      const r = this.tlRows.get(it.id);
      if (!r) continue;
      const src = this.srcs.get(it.card), card = this.store.cards[it.card];
      const end = Math.min(n, itemEnd(it, src, s.fps));
      r.bar.style.left = pct(it.start);
      r.bar.style.width = pct(Math.max(0.5, end - it.start));
      r.bar.className = "sc-bar" + (src && !src.still && it.loop ? " loop" : "") + (src && src.still ? " still" : "") + (it.visible === false ? " off" : "") + (src ? "" : " missing");
      const every = Math.max(0, it.every | 0);
      r.bar.title = "第 " + (it.start + 1) + " 帧出现" + (end < n ? "，到第 " + end + " 帧" : "") + (every ? "，每隔 " + every + " 帧再出现" : "") + "；左右拖动改出现时间";
      // its later showings (repeating), fainter: they follow the first
      const later = [];
      if (every > 0 && src) for (let st = it.start + every; st < n && later.length < 400; st += every) later.push(st);
      r.ghosts = r.ghosts || [];
      while (r.ghosts.length > later.length) r.ghosts.pop().remove();
      while (r.ghosts.length < later.length) { const gh = el("div", { class: "sc-bar ghost" }); r.bar.parentElement.append(gh); r.ghosts.push(gh); }
      later.forEach((st, j) => {
        const gh = r.ghosts[j];
        gh.className = r.bar.className + " ghost";
        gh.style.left = pct(st);
        gh.style.width = pct(Math.max(0.5, Math.min(n, st + (end - it.start)) - st));
      });
      r.name.textContent = it.name || (card && card.title) || "元素";
      r.name.title = card ? card.title || "" : "卡片已删除";
      r.row.classList.toggle("on", it.id === this.sel);
    }
    this.syncHead();
  }

  // Dragging a row's name up or down restacks its item: the rows run from the
  // top of the stack down, so where it is let go is where it goes.
  dragRow(e, id, handle) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (this.sel !== id) { this.sel = id; this.refresh(); }
    const rows = [...this.tlEl.querySelectorAll(".sc-row:not(.sc-ruler-row)")];
    const from = rows.findIndex((r) => r === (this.tlRows.get(id) || {}).row);
    if (from < 0) return;
    handle.setPointerCapture(e.pointerId);
    let to = from;
    const mark = () => rows.forEach((r, k) => {
      r.classList.toggle("drop-above", k === to && to < from);
      r.classList.toggle("drop-below", k === to && to > from);
      r.classList.toggle("dragging", k === from);
    });
    const mv = (ev) => {
      // the row under the pointer (above the first: the first; below the last: the last)
      let k = rows.length - 1;
      for (let i = 0; i < rows.length; i++) { const b = rows[i].getBoundingClientRect(); if (ev.clientY < b.bottom) { k = i; break; } }
      to = k;
      mark();
    };
    const up = () => {
      handle.removeEventListener("pointermove", mv); handle.removeEventListener("pointerup", up); handle.removeEventListener("pointercancel", up);
      rows.forEach((r) => r.classList.remove("drop-above", "drop-below", "dragging"));
      if (to !== from) this.moveTo(id, rows.length - 1 - to);
    };
    handle.addEventListener("pointermove", mv); handle.addEventListener("pointerup", up); handle.addEventListener("pointercancel", up);
    mark();
  }

  // the item to place index in the stack (0 = the bottom)
  moveTo(id, index) {
    this.set((pp) => {
      const i = pp.items.findIndex((x) => x.id === id);
      if (i < 0) return;
      const [it] = pp.items.splice(i, 1);
      pp.items.splice(clamp(index, 0, pp.items.length), 0, it);
    });
  }

  syncHead() {
    if (this.head) this.head.style.left = (100 * (this.fi + 0.5) / this.length) + "%";
    this.posEl.textContent = (this.fi + 1) + " / " + this.length;
    this.playBtn.textContent = this.playing ? "❚❚" : "▶";
  }

  goFrame(i) { this.fi = clamp(i, 0, this.length - 1); this.syncHead(); this.requestRender(); }
  step(d) { if (this.playing) this.togglePlay(); this.goFrame((this.fi + d + this.length) % this.length); }

  togglePlay() {
    this.playing = !this.playing;
    cancelAnimationFrame(this.playRaf);
    if (this.playing) {
      let last = performance.now();
      const tick = (t) => {
        if (!this.playing) return;
        const dur = 1000 / this.scene().fps;
        if (t - last >= dur) {
          last = t - Math.min(dur, t - last - dur);
          this.fi = (this.fi + 1) % this.length;
          this.syncHead();
          this.render();
        }
        this.playRaf = requestAnimationFrame(tick);
      };
      this.playRaf = requestAnimationFrame(tick);
    }
    this.syncHead();
  }

  // ---------- the stage ----------
  toWorld(e) {
    const r = this.canvas.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    return { x: (sx - this.panX) / this.zoom, y: (sy - this.panY) / this.zoom, sx, sy };
  }
  toScreen(x, y) { return [this.panX + x * this.zoom, this.panY + y * this.zoom]; }

  fit() {
    const s = this.scene(), r = this.stage.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.zoom = Math.min((r.width - 60) / s.w, (r.height - 60) / s.h);
    this.panX = (r.width - s.w * this.zoom) / 2;
    this.panY = (r.height - s.h * this.zoom) / 2;
    this.requestRender();
  }

  // what of the selected item is under the screen point: "rot", "scale" or null
  handleAt(sx, sy) {
    const it = this.item(), src = it && this.srcs.get(it.card);
    if (!src) return null;
    const cs = itemCorners(it, src).map((p) => this.toScreen(p.x, p.y));
    const rh = this.rotHandle(cs);
    if (Math.hypot(sx - rh[0], sy - rh[1]) <= HANDLE + 3) return "rot";
    if (cs.some(([x, y]) => Math.abs(sx - x) <= HANDLE + 2 && Math.abs(sy - y) <= HANDLE + 2)) return "scale";
    return null;
  }
  // the turn handle: above the middle of the picture's top edge (as it is turned)
  rotHandle(cs) {
    const mx = (cs[0][0] + cs[1][0]) / 2, my = (cs[0][1] + cs[1][1]) / 2;
    const bx = (cs[3][0] + cs[2][0]) / 2, by = (cs[3][1] + cs[2][1]) / 2;
    const l = Math.hypot(mx - bx, my - by) || 1;
    return [mx + (mx - bx) / l * ROT_GAP, my + (my - by) / l * ROT_GAP];
  }

  // the topmost item under a world point
  pick(w) {
    const s = this.scene();
    for (let i = s.items.length - 1; i >= 0; i--) {
      const it = s.items[i];
      if (itemFrame(it, this.srcs.get(it.card), this.fi, s.fps) < 0) continue;
      if (hitItem(it, this.srcs.get(it.card), this.fi, s.fps, w.x, w.y)) return it;
    }
    return null;
  }

  bindStage() {
    const c = this.canvas;
    c.addEventListener("pointerdown", (e) => {
      this.root.focus();
      if (e.button === 1 || (e.button === 0 && this.space)) {
        e.preventDefault();
        this.drag = { type: "pan", sx: e.clientX, sy: e.clientY, px: this.panX, py: this.panY };
        c.setPointerCapture(e.pointerId);
        return;
      }
      if (e.button !== 0) return;
      if (this.playing) this.togglePlay();
      const w = this.toWorld(e), key = Math.random();
      const h = this.handleAt(w.sx, w.sy), it = this.item();
      if (h && it) {
        c.setPointerCapture(e.pointerId);
        this.drag = h === "rot"
          ? { type: "rot", id: it.id, a0: Math.atan2(w.y - it.y, w.x - it.x), rot0: it.rot || 0, key }
          : { type: "scale", id: it.id, d0: Math.hypot(w.x - it.x, w.y - it.y) || 1, s0: it.scale || 1, key };
        return;
      }
      const hit = this.pick(w);
      if (!hit) { if (this.sel) { this.sel = null; this.refresh(true); } return; }
      if (hit.id !== this.sel) { this.sel = hit.id; this.refresh(true); }
      c.setPointerCapture(e.pointerId);
      this.drag = { type: "move", id: hit.id, sx: w.x, sy: w.y, x0: hit.x, y0: hit.y, key };
    });
    c.addEventListener("pointermove", (e) => {
      const d = this.drag, w = this.toWorld(e);
      this.hover = w;
      if (d && d.type === "pan") {
        this.panX = d.px + e.clientX - d.sx;
        this.panY = d.py + e.clientY - d.sy;
      } else if (d && d.type === "move") {
        // whole stage pixels, so pixel art stays on the grid
        this.setItem(d.id, { x: Math.round(d.x0 + w.x - d.sx), y: Math.round(d.y0 + w.y - d.sy) }, "move" + d.key);
      } else if (d && d.type === "scale") {
        const it = this.item(d.id);
        if (it) this.setItem(d.id, { scale: +clamp(d.s0 * Math.hypot(w.x - it.x, w.y - it.y) / d.d0, 0.01, 50).toFixed(3) }, "scale" + d.key);
      } else if (d && d.type === "rot") {
        const it = this.item(d.id);
        if (it) {
          let r = d.rot0 + (Math.atan2(w.y - it.y, w.x - it.x) - d.a0) * 180 / Math.PI;
          r = ((r + 540) % 360) - 180;
          r = e.shiftKey ? Math.round(r / 15) * 15 : Math.round(r * 10) / 10;
          this.setItem(d.id, { rot: r }, "rot" + d.key);
        }
      } else {
        const h = this.handleAt(w.sx, w.sy);
        c.style.cursor = this.space ? "grab" : h === "rot" ? "grab" : h === "scale" ? "nwse-resize" : this.pick(w) ? "move" : "";
      }
      this.updateStatus();
      this.requestRender();
    });
    const up = () => { this.drag = null; };
    c.addEventListener("pointerup", up);
    c.addEventListener("pointercancel", up);
    c.addEventListener("dblclick", (e) => { const hit = this.pick(this.toWorld(e)); if (hit) { this.sel = hit.id; this.openSource(hit.id); } });
    c.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const hit = this.pick(this.toWorld(e));
      if (!hit) return;
      if (hit.id !== this.sel) { this.sel = hit.id; this.refresh(true); }
      const items = this.scene().items, i = items.findIndex((x) => x.id === hit.id), id = hit.id;
      showMenu(e.clientX, e.clientY, [
        { heading: hit.name || "元素" },
        { label: "置顶", hint: "Ctrl+Shift+]", disabled: i === items.length - 1, action: () => this.reorder("top", id) },
        { label: "上移一层", hint: "Ctrl+]", disabled: i === items.length - 1, action: () => this.reorder("up", id) },
        { label: "下移一层", hint: "Ctrl+[", disabled: i === 0, action: () => this.reorder("down", id) },
        { label: "置底", hint: "Ctrl+Shift+[", disabled: i === 0, action: () => this.reorder("bottom", id) },
        "-",
        { label: "复制", hint: "Ctrl+D", action: () => this.duplicate(id) },
        { label: "编辑源卡片", action: () => this.openSource(id) },
        { label: "删除", hint: "Delete", danger: true, action: () => this.removeItem(id) },
      ]);
    });
    this.stage.addEventListener("wheel", (e) => {
      e.preventDefault();
      const w = this.toWorld(e);
      const z = clamp(this.zoom * (e.deltaY < 0 ? 1.2 : 1 / 1.2), 0.05, 32);
      this.panX = w.sx - w.x * z;
      this.panY = w.sy - w.y * z;
      this.zoom = z;
      this.updateStatus();
      this.requestRender();
    }, { passive: false });
    // cards dragged in from the list
    this.stage.addEventListener("dragover", (e) => {
      const ts = [...e.dataTransfer.types];
      if (ts.includes("application/x-scene-card") || ts.includes("application/x-scene-preset") || ts.includes("application/x-scene-fx")) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }
    });
    this.stage.addEventListener("drop", (e) => {
      const id = e.dataTransfer.getData("application/x-scene-card"), pre = e.dataTransfer.getData("application/x-scene-preset"), fx = e.dataTransfer.getData("application/x-scene-fx");
      if (!id && !pre && !fx) return;
      e.preventDefault();
      const w = this.toWorld(e);
      if (id) this.addItem(id, { x: w.x, y: w.y });
      else if (fx) this.addFx(fx, { x: w.x, y: w.y }, true);
      else this.addPreset(pre, { x: w.x, y: w.y });
    });
  }

  updateStatus() {
    const h = this.hover, parts = [];
    if (h) parts.push("舞台坐标 " + Math.round(h.x) + ", " + Math.round(h.y));
    parts.push(Math.round(this.zoom * 100) + "%");
    const it = this.item();
    if (it) parts.push((it.name || "元素") + "：" + Math.round(it.x) + ", " + Math.round(it.y) + " · " + Math.round((it.scale || 1) * 100) + "% · " + (it.rot || 0) + "°");
    this.statusEl.textContent = parts.join("  ·  ");
  }

  onKey(e, down) {
    const t = e.target;
    const typing = t && t.closest && t.closest("input, textarea, select") && t.type !== "checkbox" && t.type !== "range";
    if (e.code === "Space" && !typing) {
      this.space = down;
      this.stage.classList.toggle("can-pan", down);
      e.preventDefault(); e.stopPropagation();
      return;
    }
    if (!down || typing) return;
    if (document.querySelector(".modal-root.open")) return;
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    let handled = true;
    if (mod && k === "z" && !e.shiftKey) this.store.undo();
    else if (mod && (k === "y" || (k === "z" && e.shiftKey))) this.store.redo();
    else if (mod && k === "d") this.duplicate();
    else if (mod && (e.code === "BracketRight" || e.code === "BracketLeft") && this.sel) {
      const upwards = e.code === "BracketRight";
      this.reorder(e.shiftKey ? (upwards ? "top" : "bottom") : (upwards ? "up" : "down"));
    }
    else if (mod) handled = false;
    else if (k === "delete" || k === "backspace") this.removeItem();
    else if (k === "escape") { if (this.sel) { this.sel = null; this.refresh(true); } else this.close(); }
    else if (k === "enter") this.togglePlay();
    else if (k === ",") this.step(-1);
    else if (k === ".") this.step(1);
    else if (k === "home") this.goFrame(0);
    else if (k === "f") this.fit();
    else if (k.startsWith("arrow") && this.sel) {
      const n = e.shiftKey ? 10 : 1, it = this.item();
      const dx = k === "arrowleft" ? -n : k === "arrowright" ? n : 0, dy = k === "arrowup" ? -n : k === "arrowdown" ? n : 0;
      this.setItem(it.id, { x: it.x + dx, y: it.y + dy }, "nudge");
    } else handled = false;
    if (handled) { e.preventDefault(); e.stopPropagation(); }
  }

  requestRender() {
    if (this.renderPending) return;
    this.renderPending = true;
    requestAnimationFrame(() => { this.renderPending = false; this.render(); });
  }

  render() {
    const c = this.canvas, r = this.stage.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    const W = Math.max(1, Math.round(r.width)), H = Math.max(1, Math.round(r.height));
    if (c.width !== W * dpr || c.height !== H * dpr) { c.width = W * dpr; c.height = H * dpr; c.style.width = W + "px"; c.style.height = H + "px"; }
    const g = this.g, s = this.scene(), z = this.zoom;
    if (!this.srcs) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    // the stage: its colour, or a checkerboard when see-through
    const [sx, sy] = this.toScreen(0, 0), sw = s.w * z, sh = s.h * z;
    if (s.bg) { g.fillStyle = s.bg; g.fillRect(sx, sy, sw, sh); }
    else {
      g.save(); g.beginPath(); g.rect(sx, sy, sw, sh); g.clip();
      const cell = 12;
      g.fillStyle = "#8e8f97"; g.fillRect(sx, sy, sw, sh); g.fillStyle = "#a9aab2";
      for (let y = Math.floor(sy / cell) * cell; y < sy + sh; y += cell) for (let x = Math.floor(sx / cell) * cell + ((y / cell) % 2 ? cell : 0); x < sx + sw; x += cell * 2) g.fillRect(x, y, cell, cell);
      g.restore();
    }
    // the items (pixel art stays crisp when zoomed in)
    g.save();
    g.translate(this.panX, this.panY); g.scale(z, z);
    g.imageSmoothingEnabled = z < 1;
    g.imageSmoothingQuality = "high";
    drawScene(g, s, this.srcs, this.fi, { noBg: true, zoom: z });
    g.restore();
    // what lies outside the stage, dimmed; the stage's edge
    g.fillStyle = "rgba(10, 12, 16, 0.55)";
    g.fillRect(0, 0, W, sy); g.fillRect(0, sy + sh, W, H - sy - sh); g.fillRect(0, sy, sx, sh); g.fillRect(sx + sw, sy, W - sx - sw, sh);
    g.strokeStyle = "rgba(255,255,255,0.35)"; g.lineWidth = 1; g.setLineDash([]);
    g.strokeRect(Math.round(sx) + 0.5, Math.round(sy) + 0.5, Math.round(sw), Math.round(sh));
    // the selected item: its outline, anchor, corners and turn handle
    const it = this.item(), src = it && this.srcs.get(it.card);
    if (src) {
      const cs = itemCorners(it, src).map((p) => this.toScreen(p.x, p.y));
      g.strokeStyle = "#7c6cff"; g.lineWidth = 1.5;
      g.beginPath(); cs.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.stroke();
      const rh = this.rotHandle(cs), tm = [(cs[0][0] + cs[1][0]) / 2, (cs[0][1] + cs[1][1]) / 2];
      g.beginPath(); g.moveTo(tm[0], tm[1]); g.lineTo(rh[0], rh[1]); g.stroke();
      g.fillStyle = "#fff";
      for (const [x, y] of cs) { g.fillRect(x - HANDLE / 2 - 1, y - HANDLE / 2 - 1, HANDLE + 2, HANDLE + 2); g.strokeRect(x - HANDLE / 2 - 1, y - HANDLE / 2 - 1, HANDLE + 2, HANDLE + 2); }
      g.beginPath(); g.arc(rh[0], rh[1], HANDLE, 0, Math.PI * 2); g.fill(); g.stroke();
      const [ax, ay] = this.toScreen(it.x, it.y);
      g.strokeStyle = "#ffd25c"; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(ax - 7, ay); g.lineTo(ax + 7, ay); g.moveTo(ax, ay - 7); g.lineTo(ax, ay + 7); g.stroke();
    }
    this.updateStatus();
  }

  async exportGodot() {
    const m = await import("../godot/scenepack.js");
    m.openSceneExport(this.app, this.id);
  }

  showHelp() {
    this.app.toast("拖动元素移动 · 拖四角缩放 · 拖上方圆点旋转（Shift 每 15°）· 方向键微调（Shift ×10）· Delete 删除 · Ctrl+D 复制 · Ctrl+] / Ctrl+[ 上移 / 下移一层（加 Shift 置顶 / 置底），也能在时间轴上下拖名字、右键元素 · 双击编辑源卡片 · 空格+拖动 / 中键平移 · 滚轮缩放 · F 适合窗口 · Enter 播放 · , . 逐帧 · Esc 取消选择", "ok");
  }
}
