// 调帧台: full-screen tuner for one character card.
//
// Left: animations. Centre: the stage, with the shared origin and the export
// canvas. Right: transforms at three levels (frame / animation / character),
// sounds, export settings. Effects (trails, glows) are painted on a layer in the
// pixel editor, so they arrive here already inside the frames.
// Bottom: the frame strip. Every edit goes straight into the card's params
// through the store, so it autosaves and undoes like any board edit.
import { el, uid, clamp, setPath, downloadBlob, fmtBytes } from "../core/util.js";
import { putBlobAsset, assetUrl } from "../core/assets.js";
import { makeForm } from "../ui/form.js";
import { showMenu } from "../ui/menu.js";
import { openModal } from "../ui/modal.js";
import { nodeType } from "../nodes/registry.js";
import {
  IDENTITY, normalizeCharacter, newAnim, toMatrix, animMatrix, frameTransform, timeline,
  drawAnimFrame, exportCanvas, calibrate,
} from "./model.js";
import { exportCharacterZip, bakeAnimation } from "./export.js";
import { SHEET_LAYOUTS } from "../nodes/exporters.js";

const TOOLS = [
  { id: "frame", label: "拖单帧", key: "1", tip: "拖动只移动当前这一帧" },
  { id: "group", label: "拖整组", key: "2", tip: "拖动移动整组动画（所有帧）" },
  { id: "char", label: "拖角色", key: "3", tip: "拖动移动整个角色（所有动画）" },
];

export function resolveSources(app, p) {
  const m = new Map();
  const add = (s) => { if (s && s.card && !m.has(s.card)) m.set(s.card, app.framesToBake(s.card)); };
  for (const a of p.anims || []) {
    add(a.source);
  }
  return m;
}

export function frameSourceCards(app) {
  return Object.values(app.store.cards).filter((c) => c.type === "animation" || app.canBake(c.id));
}

export function cardTitle(app, id) {
  const c = app.store.cards[id];
  return c ? (c.title || (nodeType(c.type) || {}).title || c.type) : "（已删除）";
}

export function openTuner(app, cardId) {
  const t = new Tuner(app, cardId);
  t.open();
  return t;
}

class Tuner {
  constructor(app, id) {
    this.app = app;
    this.store = app.store;
    this.id = id;
    const ui = (this.card && this.card.ui) || {};
    this.curId = ui.current || null;
    this.fi = 0;
    this.tool = "frame";
    this.zoom = 3; this.panX = 0; this.panY = 0;
    this.playing = false;
    this.sound = true;
    this.onion = true;
    this.bounds = null;
    this.drag = null;
    this.space = false;
    this.raf = 0;
  }

  get card() { return this.store.cards[this.id]; }
  get p() { return this.card.params; }

  anim() {
    const list = this.p.anims;
    return list.find((a) => a.id === this.curId) || list[0] || null;
  }

  src(a = this.anim()) {
    return a && a.source ? this.app.framesToBake(a.source.card) : null;
  }

  sources() { return resolveSources(this.app, this.p); }

  // write into the card's params; coalesced edits undo as one step
  set(fn, coalesce) {
    this.store.mutate((d) => {
      const c = d.board.cards[this.id];
      if (c) fn(c.params);
    }, { coalesce: coalesce ? this.id + ":" + coalesce : null });
  }

  findAnim(p) { return p.anims.find((a) => a.id === (this.anim() || {}).id); }

  // ---------- lifecycle ----------
  open() {
    // bring old / partial params up to the current shape once, silently
    const norm = normalizeCharacter(this.p);
    this.store.mutate((d) => { Object.assign(d.board.cards[this.id].params, norm); }, { history: false, silent: true });
    this.build();
    document.body.append(this.root);
    this.root.focus();
    this.offChange = this.store.on("change", () => this.refresh());
    this.offReset = this.store.on("reset", () => { if (!this.card) { this.close(); return; } this.refresh(true); });
    this.offResult = this.app.engine.on("result", (id) => {
      const srcs = this.sources();
      if (srcs.has(id)) this.refresh();
    });
    this.ro = new ResizeObserver(() => this.requestRender());
    this.ro.observe(this.stage);
    this.refresh(true);
    this.fit();
  }

  close() {
    this.playing = false;
    this.offChange(); this.offReset(); this.offResult();
    this.ro.disconnect();
    this.root.remove();
    this.app.board.root.focus();
  }

  remember() {
    const c = this.card;
    if (!c) return;
    c.ui = c.ui || {};
    const a = this.anim();
    if (a && c.ui.current !== a.id) { c.ui.current = a.id; this.store.scheduleSave(); }
  }

  // ---------- DOM ----------
  build() {
    this.nameEl = el("span", { class: "ed-title" });
    this.boundsEl = el("span", { class: "ed-size mono" });
    const top = el("div", { class: "ed-top" },
      el("span", { class: "ed-badge" }, "调帧台"), this.nameEl, this.boundsEl,
      el("button", { class: "btn small", title: "把每组动画的脚底对到原点", onclick: () => this.calibrateAll() }, "自动校准原点"),
      el("button", { class: "icon-btn", title: "撤销 (Ctrl+Z)", onclick: () => this.store.undo() }, "↶"),
      el("button", { class: "icon-btn", title: "重做 (Ctrl+Y)", onclick: () => this.store.redo() }, "↷"),
      el("span", { class: "spacer" }),
      el("span", { class: "ed-save mono" }, "改动自动保存"),
      el("button", { class: "icon-btn", title: "快捷键", onclick: () => this.showHelp() }, "?"),
      el("button", { class: "btn", title: "把当前动画（含偏移、时长）烘焙成画布上的动画卡片", onclick: () => this.bakeCurrent() }, "烘焙当前动画"),
      el("button", { class: "btn primary", onclick: () => this.exportZip() }, "导出角色包"),
      el("button", { class: "btn", onclick: () => this.close() }, "关闭"),
    );

    this.animList = el("div", { class: "tn-list" });
    const head = (title, ...btns) => el("div", { class: "ed-panel-title" }, title, el("span", { class: "spacer" }), ...btns);
    const left = el("div", { class: "ed-side tn-left" },
      head("动画组",
        el("button", { class: "tool-btn", title: "从画布上的卡片添加一组动画", onclick: (e) => this.addAnimMenu(e) }, "＋ 添加")),
      this.animList,
      el("p", { class: "ed-hint" }, "动画来自画布上的卡片（动画、处理结果都行），这里只记录引用：源卡片更新后这里自动跟着变。刀光、特效请在像素编辑器里用「拖尾」笔画在特效图层上。"),
    );

    this.canvas = el("canvas", { class: "ed-canvas" });
    this.g = this.canvas.getContext("2d");
    this.statusEl = el("div", { class: "ed-status mono" });
    this.toolBar = el("div", { class: "tn-tools" });
    for (const t of TOOLS) {
      const b = el("button", { class: "tool-btn", title: t.tip + "（" + t.key + "）", onclick: () => this.setTool(t.id) }, t.label);
      b.dataset.tool = t.id;
      this.toolBar.append(b);
    }
    const onionBox = el("input", { type: "checkbox", checked: this.onion, onchange: () => { this.onion = onionBox.checked; this.requestRender(); } });
    this.toolBar.append(el("label", { class: "tn-check" }, onionBox, "上一帧虚影"));
    this.stage = el("div", { class: "ed-stage tn-stage" }, this.canvas, this.toolBar, this.statusEl);
    this.bindStage();

    this.props = el("div", { class: "ed-side tn-right" });

    this.playBtn = el("button", { class: "tool-btn play", title: "播放 / 暂停（Enter）", onclick: () => this.togglePlay() }, "▶");
    const soundBox = el("input", { type: "checkbox", checked: this.sound, onchange: () => { this.sound = soundBox.checked; } });
    this.posEl = el("span", { class: "mono tl-pos" });
    this.strip = el("div", { class: "tn-strip" });
    const bar = el("div", { class: "tl-bar" },
      el("button", { class: "tool-btn", title: "上一帧（,）", onclick: () => this.step(-1) }, "◀"),
      this.playBtn,
      el("button", { class: "tool-btn", title: "下一帧（.）", onclick: () => this.step(1) }, "▶|"),
      this.posEl,
      el("span", { class: "tl-sep" }),
      el("label", { class: "tl-field" }, soundBox, "播放音效"),
      el("span", { class: "tl-sep" }),
      el("span", { class: "dim" }, "点帧切换；把音频文件拖到帧上即可绑定音效；灰色斜纹 = 已禁用的帧"),
    );
    const timelineEl = el("div", { class: "ed-timeline tn-timeline" }, bar, el("div", { class: "tl-scroll" }, this.strip));

    this.root = el("div", { class: "editor-root open tuner", tabindex: "-1" },
      top, el("div", { class: "ed-main" }, left, this.stage, this.props), timelineEl);
    this.root.addEventListener("keydown", (e) => this.onKey(e, true));
    this.root.addEventListener("keyup", (e) => this.onKey(e, false));
  }

  // ---------- refresh ----------
  refresh(full) {
    if (!this.card) return;
    const a = this.anim();
    if (a && this.curId !== a.id) this.curId = a.id;
    const src = this.src();
    if (src) this.fi = clamp(this.fi, 0, src.frames.length - 1); else this.fi = 0;
    this.nameEl.textContent = this.card.title || "角色";
    const sel = (a ? a.id : "") + "|" + this.fi + "|" + (src ? src.ver : "");
    if (full || sel !== this.lastSel) { this.lastSel = sel; this.buildLists(); this.buildProps(); }
    else { this.syncLists(); if (this.forms) for (const f of this.forms) f.sync(); }
    this.buildStrip();
    this.scheduleBounds();
    this.syncTools();
    this.requestRender();
  }

  buildLists() {
    const p = this.p, a = this.anim();
    this.animList.replaceChildren(...p.anims.map((x) => {
      const s = this.src(x);
      const row = el("div", { class: "tn-row" + (a && x.id === a.id ? " on" : ""), title: "来源：" + cardTitle(this.app, x.source && x.source.card) },
        el("span", { class: "tn-row-name" }, x.name),
        el("span", { class: "tn-row-meta mono" }, s ? s.frames.length + " 帧" : "无来源"));
      row.onclick = () => { this.curId = x.id; this.fi = 0; this.remember(); this.refresh(true); this.fit(); };
      row.ondblclick = () => { const n = prompt("动画名称（导出时用作文件名）", x.name); if (n && n.trim()) this.set((pp) => { pp.anims.find((y) => y.id === x.id).name = n.trim(); }); };
      row.oncontextmenu = (e) => {
        e.preventDefault();
        const idx = p.anims.indexOf(x);
        showMenu(e.clientX, e.clientY, [
          { label: "重命名…", action: () => row.ondblclick() },
          { label: "上移", disabled: idx === 0, action: () => this.set((pp) => { const [m] = pp.anims.splice(idx, 1); pp.anims.splice(idx - 1, 0, m); }) },
          { label: "下移", disabled: idx === p.anims.length - 1, action: () => this.set((pp) => { const [m] = pp.anims.splice(idx, 1); pp.anims.splice(idx + 1, 0, m); }) },
          { label: "换来源…", action: () => this.addAnimMenu(e, x.id) },
          "-",
          { label: "移除这组动画", danger: true, action: () => this.set((pp) => { pp.anims.splice(idx, 1); }) },
        ]);
      };
      return row;
    }));
    if (!p.anims.length) this.animList.append(el("p", { class: "ed-hint" }, "还没有动画。点「＋ 添加」，从画布上选一张动画卡片。"));
  }

  syncLists() {
    // cheap path while dragging: only names / counts can change
    this.buildLists();
  }

  // a form bound to some object inside the params, located fresh on every access
  formFor(container, locate, ensure, key) {
    const ctx = {
      id: this.id + ":" + key,
      params: () => locate(this.p) || {},
      set: (patch, opts = {}) => this.set((pp) => {
        const target = ensure(pp);
        if (!target) return;
        for (const k in patch) setPath(target, k, patch[k]);
      }, opts.coalesce),
    };
    const f = makeForm(ctx, container);
    this.forms.push(f);
    return f;
  }

  buildProps() {
    const P = this.props;
    P.replaceChildren();
    this.forms = [];
    const a = this.anim();
    if (!a) {
      P.append(el("p", { class: "ed-hint" }, "先在左边添加一组动画。"));
      return;
    }
    const aid = a.id, fi = this.fi;
    const findA = (pp) => pp.anims.find((x) => x.id === aid);
    const section = (title, hint) => {
      const body = el("div", { class: "f-section-body" });
      P.append(el("div", { class: "f-section" }, el("div", { class: "f-section-title" }, title), hint ? el("p", { class: "f-hint" }, hint) : null, body));
      return body;
    };
    const transform = (f) => {
      f.pair((s) => s.number("X", "x", { integer: false, step: 1 }), (s) => s.number("Y", "y", { integer: false, step: 1 }));
      f.pair((s) => s.number("缩放", "scale", { min: 0.05, max: 20, step: 0.05, integer: false }), (s) => s.number("旋转 °", "rot", { min: -360, max: 360, step: 1, integer: false }));
      f.check("水平翻转", "flip");
    };

    // frame
    const ff = this.formFor(section("第 " + (fi + 1) + " 帧", "只影响这一帧，叠加在整组和角色之上。"),
      (pp) => { const x = findA(pp); return x ? { ...IDENTITY, ...(x.frames[fi] || {}) } : null; },
      (pp) => { const x = findA(pp); if (!x) return null; x.frames[fi] = x.frames[fi] || {}; return x.frames[fi]; }, "frame" + fi);
    transform(ff);
    const src = this.src();
    const defDur = src ? Math.round(src.frames[fi] && src.frames[fi].duration || 1000 / (a.fps || src.fps || 12)) : 83;
    ff.pair(
      (s) => s.number("时长 ms（空 = 默认 " + defDur + "）", "duration", { min: 0, max: 10000, allowEmpty: true, placeholder: String(defDur) }),
      (s) => s.check("禁用这一帧", "disabled"),
    );
    ff.buttons(
      ["本帧清零", () => this.set((pp) => { const x = findA(pp); if (x && x.frames[fi]) { const d = x.frames[fi]; for (const k of ["x", "y", "scale", "rot", "flip"]) delete d[k]; } })],
      ["偏移套用到后面所有帧", () => this.set((pp) => {
        const x = findA(pp), s2 = this.src(); if (!x || !s2) return;
        const cur = x.frames[fi] || {};
        for (let i = fi + 1; i < s2.frames.length; i++) x.frames[i] = { ...(x.frames[i] || {}), x: cur.x || 0, y: cur.y || 0 };
      })],
    );

    // animation group
    const fa = this.formFor(section("动画组 · " + a.name, "整组所有帧一起变换。"), findA, findA, "anim");
    fa.pair((s) => s.number("X", "transform.x", { integer: false }), (s) => s.number("Y", "transform.y", { integer: false }));
    fa.pair((s) => s.number("缩放", "transform.scale", { min: 0.05, max: 20, step: 0.05, integer: false }), (s) => s.number("旋转 °", "transform.rot", { min: -360, max: 360, integer: false }));
    fa.check("水平翻转", "transform.flip");
    fa.pair(
      (s) => s.number("帧率（空 = 跟随来源）", "fps", { min: 1, max: 60, allowEmpty: true, placeholder: String((src && src.fps) || 12) }),
      (s) => s.check("循环播放", "loop"),
    );
    fa.buttons(
      ["自动校准这组", () => this.calibrateOne(aid)],
      ["整组清零", () => this.set((pp) => { const x = findA(pp); if (x) x.transform = { ...IDENTITY }; })],
    );

    // character
    const fc = this.formFor(section("角色", "所有动画一起变换。"), (pp) => pp.transform, (pp) => pp.transform, "char");
    transform(fc);

    // sounds on this frame
    const sb = section("第 " + (fi + 1) + " 帧的音效", "播放到这一帧时触发；导出时写进 JSON，音频文件一起打包。");
    const sounds = (a.sounds && a.sounds[fi]) || [];
    for (const [k, s] of sounds.entries()) {
      sb.append(el("div", { class: "tn-row" },
        el("span", { class: "tn-row-name" }, "♪ " + s.name),
        el("button", { class: "tool-btn", title: "试听", onclick: () => this.playSound(s) }, "▶"),
        el("button", { class: "tool-btn", title: "解除绑定", onclick: () => this.set((pp) => { const x = findA(pp); x.sounds[fi].splice(k, 1); if (!x.sounds[fi].length) delete x.sounds[fi]; }) }, "×")));
    }
    sb.append(el("button", { class: "btn small", onclick: () => this.pickSound(fi) }, "绑定音效…"));

    // export
    const fe = this.formFor(section("导出设置", "所有动画共用一块画布和同一个原点。"), (pp) => pp.export, (pp) => pp.export, "export");
    fe.pair((s) => s.number("四周留边", "margin", { min: 0, max: 256 }), (s) => s.select("尺寸取整", "roundTo", [[1, "不取整"], [2, "2 的倍数"], [4, "4 的倍数"], [8, "8 的倍数"], [16, "16 的倍数"]]));
    fe.select("格式", "format", [["sheet", "序列图 + JSON"], ["png", "PNG 序列"]]);
    fe.pair((s) => s.select("序列图排列", "layout", SHEET_LAYOUTS), (s) => s.number("列数", "perRow", { min: 1, extra: { layout: "cols" } }));
    fe.hint("每个动画一张序列图。「一行」「一列」「接近正方形」按各动画的帧数自动排；「自定列数」所有动画都用同一个列数。");
  }

  // ---------- adding things ----------
  addAnimMenu(e, replaceId) {
    const r = e.currentTarget && e.currentTarget.getBoundingClientRect ? e.currentTarget.getBoundingClientRect() : { left: e.clientX, bottom: e.clientY };
    const cards = frameSourceCards(this.app);
    if (!cards.length) { this.app.toast("画布上还没有能输出序列帧的卡片。先导入或烘焙一个动画。", "warn"); return; }
    showMenu(r.left, r.bottom + 4, [
      { heading: replaceId ? "换成哪张卡片的帧" : "选一张卡片作为这组动画的来源" },
      ...cards.map((c) => ({
        label: cardTitle(this.app, c.id),
        hint: (this.app.framesToBake(c.id) || { frames: [] }).frames.length + " 帧",
        action: () => replaceId ? this.set((pp) => { pp.anims.find((x) => x.id === replaceId).source = { card: c.id }; }) : this.addAnim(c.id),
      })),
    ]);
  }

  addAnim(cardId) {
    const a = newAnim(uid("A"), cardTitle(this.app, cardId), { card: cardId });
    const pos = calibrate(normalizeCharacter(this.p), a, resolveSources(this.app, { anims: [a] }));
    if (pos) { a.transform.x = pos.x; a.transform.y = pos.y; }
    this.set((pp) => { pp.anims.push(a); });
    this.curId = a.id;
    this.fi = 0;
    this.remember();
    this.refresh(true);
    this.fit();
  }

  calibrateOne(aid) {
    const char = normalizeCharacter(this.p);
    const a = char.anims.find((x) => x.id === aid);
    const pos = a && calibrate(char, a, this.sources());
    if (!pos) { this.app.toast("这组动画没有可见像素，无法校准。", "warn"); return; }
    this.set((pp) => { const x = pp.anims.find((y) => y.id === aid); x.transform.x = pos.x; x.transform.y = pos.y; });
  }

  calibrateAll() {
    const char = normalizeCharacter(this.p);
    const srcs = this.sources();
    const res = char.anims.map((a) => [a.id, calibrate(char, a, srcs)]);
    this.set((pp) => {
      for (const [id, pos] of res) {
        if (!pos) continue;
        const x = pp.anims.find((y) => y.id === id);
        x.transform.x = pos.x; x.transform.y = pos.y;
      }
    });
    this.app.toast("已把每组动画的脚底（所有帧可见像素的底部中心）对到原点。", "ok");
  }

  // ---------- sounds ----------
  async pickSound(fi) {
    const files = await this.app.pickFiles("audio/*");
    if (files[0]) this.bindSound(fi, files[0]);
  }

  async bindSound(fi, file) {
    const a = this.anim();
    if (!a) return;
    try {
      const asset = await putBlobAsset(this.store.projectId, file);
      const s = { asset, name: file.name, volume: 100 };
      this.set((pp) => {
        const x = pp.anims.find((y) => y.id === a.id);
        x.sounds = x.sounds || {};
        (x.sounds[fi] = x.sounds[fi] || []).push(s);
      });
      this.app.toast("已把「" + file.name + "」绑定到第 " + (fi + 1) + " 帧。", "ok");
    } catch (err) {
      this.app.toast("音频保存失败：" + err.message + "（支持 WAV / MP3 / OGG）", "error");
    }
  }

  playSound(s) {
    try {
      const au = new Audio(assetUrl(this.store.projectId, s.asset));
      au.volume = clamp((s.volume ?? 100) / 100, 0, 1);
      au.play().catch(() => {});
    } catch { /* no audio device */ }
  }

  // ---------- frames & playback ----------
  goFrame(i) {
    const src = this.src();
    if (!src) return;
    this.fi = (i + src.frames.length) % src.frames.length;
    this.refresh(true);
  }

  step(d) {
    if (this.playing) this.togglePlay();
    const src = this.src();
    if (!src) return;
    const order = timeline(this.anim(), src).map((e) => e.i);
    if (!order.length) { this.goFrame(this.fi + d); return; }
    let k = order.indexOf(this.fi);
    if (k < 0) k = 0; else k = (k + d + order.length) % order.length;
    this.goFrame(order[k]);
  }

  togglePlay() {
    this.playing = !this.playing;
    this.playBtn.textContent = this.playing ? "❚❚" : "▶";
    if (!this.playing) { this.refresh(true); return; }
    let last = performance.now();
    let k = -1;
    const tick = (t) => {
      if (!this.playing || !this.root.isConnected) return;
      const a = this.anim(), src = this.src();
      const tl = timeline(a, src);
      if (!tl.length) { this.togglePlay(); return; }
      if (k < 0) { k = Math.max(0, tl.findIndex((e) => e.i === this.fi)); this.enterFrame(a, tl[k].i); }
      if (t - last >= tl[k].duration) {
        last = t;
        k++;
        if (k >= tl.length) {
          if (a.loop === false) { this.togglePlay(); return; }
          k = 0;
        }
        this.enterFrame(a, tl[k].i);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  enterFrame(a, i) {
    this.fi = i;
    if (this.sound && a.sounds && a.sounds[i]) for (const s of a.sounds[i]) this.playSound(s);
    this.syncStrip();
    this.requestRender();
  }

  buildStrip() {
    const a = this.anim(), src = this.src();
    this.strip.replaceChildren();
    this.thumbs = [];
    if (!a || !src) { this.posEl.textContent = "–"; return; }
    const char = normalizeCharacter(this.p);
    const srcs = this.sources();
    src.frames.forEach((_f, i) => {
      const th = el("canvas", { width: 48, height: 48 });
      const ft = a.frames[i] || {};
      const flags = el("span", { class: "tn-flags" },
        a.sounds && a.sounds[i] ? "♪" : "",
        ft.x || ft.y || ft.rot || (ft.scale && ft.scale !== 1) || ft.flip ? "↔" : "");
      const cell = el("div", { class: "tn-cell" + (ft.disabled ? " off" : ""), title: "第 " + (i + 1) + " 帧" + (ft.duration ? " · " + ft.duration + "ms" : "") },
        th, el("span", { class: "mono tn-idx" }, String(i + 1)), flags);
      cell.onclick = () => { if (this.playing) this.togglePlay(); this.goFrame(i); };
      cell.addEventListener("dragover", (e) => { if ([...e.dataTransfer.types].includes("Files")) { e.preventDefault(); cell.classList.add("drop"); } });
      cell.addEventListener("dragleave", () => cell.classList.remove("drop"));
      cell.addEventListener("drop", (e) => {
        e.preventDefault(); e.stopPropagation();
        cell.classList.remove("drop");
        const f = [...e.dataTransfer.files].find((x) => x.type.startsWith("audio/") || /\.(wav|mp3|ogg)$/i.test(x.name));
        if (f) this.bindSound(i, f); else this.app.toast("只能拖入音频文件（WAV / MP3 / OGG）。", "warn");
      });
      this.strip.append(cell);
      this.thumbs.push(th);
    });
    // thumbnails are rendered after the DOM is up, without blocking it
    clearTimeout(this.thumbTimer);
    this.thumbTimer = setTimeout(() => {
      this.thumbs.forEach((th, i) => {
        const g = th.getContext("2d");
        const s = Math.min(1, 40 / Math.max(src.w, src.h));
        g.imageSmoothingEnabled = false;
        g.setTransform(new DOMMatrix().translateSelf(24, 44).scaleSelf(s, s));
        drawAnimFrame(g, char, char.anims.find((x) => x.id === a.id), i, srcs);
      });
    }, 60);
    this.syncStrip();
  }

  syncStrip() {
    const src = this.src();
    [...this.strip.children].forEach((c, i) => c.classList.toggle("on", i === this.fi));
    const cur = this.strip.children[this.fi];
    if (cur) cur.scrollIntoView({ block: "nearest", inline: "nearest" });
    this.posEl.textContent = src ? (this.fi + 1) + " / " + src.frames.length : "–";
  }

  // ---------- export bounds ----------
  scheduleBounds() {
    clearTimeout(this.boundsTimer);
    this.boundsTimer = setTimeout(() => {
      if (!this.card) return;
      const char = normalizeCharacter(this.p);
      if (!char.anims.length) { this.bounds = null; this.boundsEl.textContent = ""; this.requestRender(); return; }
      this.bounds = exportCanvas(char, this.sources());
      this.boundsEl.textContent = "导出画布 " + this.bounds.w + " × " + this.bounds.h + " · 原点 (" + this.bounds.ox + ", " + this.bounds.oy + ")";
      this.requestRender();
    }, 250);
  }

  // ---------- tools & stage input ----------
  setTool(t) {
    this.tool = t;
    this.syncTools();
  }

  syncTools() {
    for (const b of this.toolBar.querySelectorAll("[data-tool]")) b.classList.toggle("active", b.dataset.tool === this.tool);
  }

  view() {
    return new DOMMatrix().translateSelf(this.panX, this.panY).scaleSelf(this.zoom, this.zoom);
  }

  toWorld(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left - this.panX) / this.zoom, y: (e.clientY - r.top - this.panY) / this.zoom, sx: e.clientX - r.left, sy: e.clientY - r.top };
  }

  fit() {
    const W = this.stage.clientWidth, H = this.stage.clientHeight;
    const src = this.src();
    const size = this.bounds ? Math.max(this.bounds.w, this.bounds.h) : src ? Math.max(src.w, src.h) * 1.4 : 64;
    this.zoom = clamp(Math.floor(Math.min(W, H) * 0.7 / size) || 1, 1, 16);
    this.panX = Math.round(W / 2);
    this.panY = Math.round(H * 0.72);
    this.requestRender();
  }

  // vector (dx, dy) in world space -> the same vector in the space of matrix M
  toSpace(M, dx, dy) {
    const inv = M.inverse();
    const a = inv.transformPoint(new DOMPoint(0, 0)), b = inv.transformPoint(new DOMPoint(dx, dy));
    return { x: b.x - a.x, y: b.y - a.y };
  }

  nudge(dx, dy, coalesce) {
    const a = this.anim();
    if (!a) return;
    const char = normalizeCharacter(this.p);
    const na = char.anims.find((x) => x.id === a.id);
    if (this.tool === "char") {
      this.set((pp) => { pp.transform.x = (pp.transform.x || 0) + dx; pp.transform.y = (pp.transform.y || 0) + dy; }, coalesce);
    } else if (this.tool === "group") {
      const v = this.toSpace(toMatrix(char.transform), dx, dy);
      this.set((pp) => { const x = pp.anims.find((y) => y.id === a.id); x.transform.x = round2((x.transform.x || 0) + v.x); x.transform.y = round2((x.transform.y || 0) + v.y); }, coalesce);
    } else if (this.tool === "frame") {
      const v = this.toSpace(animMatrix(char, na), dx, dy);
      const fi = this.fi;
      this.set((pp) => { const x = pp.anims.find((y) => y.id === a.id); const f = x.frames[fi] = x.frames[fi] || {}; f.x = round2((f.x || 0) + v.x); f.y = round2((f.y || 0) + v.y); }, coalesce);
    }
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
      if (e.button !== 0 || !this.anim()) return;
      if (this.playing) this.togglePlay();
      c.setPointerCapture(e.pointerId);
      const w = this.toWorld(e);
      this.drag = { type: "move", last: w, n: Math.random() };
    });
    c.addEventListener("pointermove", (e) => {
      const d = this.drag;
      this.hover = this.toWorld(e);
      if (d && d.type === "pan") {
        this.panX = d.px + e.clientX - d.sx;
        this.panY = d.py + e.clientY - d.sy;
      } else if (d && d.type === "move") {
        const w = this.toWorld(e);
        const dx = w.x - d.last.x, dy = w.y - d.last.y;
        // whole world pixels only, so pixel art stays on the grid
        const ix = Math.trunc(dx), iy = Math.trunc(dy);
        if (ix || iy) {
          d.last = { x: d.last.x + ix, y: d.last.y + iy };
          this.nudge(ix, iy, "drag" + d.n);
        }
      }
      this.updateStatus();
      this.requestRender();
    });
    const up = () => { this.drag = null; };
    c.addEventListener("pointerup", up);
    c.addEventListener("pointercancel", up);
    this.stage.addEventListener("wheel", (e) => {
      e.preventDefault();
      const w = this.toWorld(e);
      const z = clamp(this.zoom * (e.deltaY < 0 ? 1.25 : 0.8), 0.25, 32);
      this.panX = w.sx - w.x * z;
      this.panY = w.sy - w.y * z;
      this.zoom = z;
      this.updateStatus();
      this.requestRender();
    }, { passive: false });
  }

  updateStatus() {
    const h = this.hover;
    const parts = [];
    if (h) parts.push("世界坐标 " + Math.floor(h.x) + ", " + Math.floor(h.y));
    parts.push(Math.round(this.zoom * 100) + "%");
    const a = this.anim(), ft = a && a.frames[this.fi];
    if (ft && (ft.x || ft.y)) parts.push("本帧偏移 " + (ft.x || 0) + ", " + (ft.y || 0));
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
    else if (mod) handled = false;
    else if (k === "," ) this.step(-1);
    else if (k === ".") this.step(1);
    else if (k === "enter") this.togglePlay();
    else if (k === "f") this.fit();
    else if (["1", "2", "3"].includes(k)) this.setTool(TOOLS[+k - 1].id);
    else if (k.startsWith("arrow")) {
      const s = e.shiftKey ? 10 : 1;
      const v = { arrowleft: [-s, 0], arrowright: [s, 0], arrowup: [0, -s], arrowdown: [0, s] }[k];
      this.nudge(v[0], v[1], "nudge");
    } else handled = false;
    if (handled) { e.preventDefault(); e.stopPropagation(); }
  }

  // ---------- render ----------
  requestRender() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.render(); });
  }

  render() {
    if (!this.card || !this.root.isConnected) return;
    const c = this.canvas, g = this.g;
    const dpr = window.devicePixelRatio || 1;
    const W = this.stage.clientWidth, H = this.stage.clientHeight;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
      c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
      c.style.width = W + "px"; c.style.height = H + "px";
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    g.imageSmoothingEnabled = false;
    const V = new DOMMatrix([dpr, 0, 0, dpr, 0, 0]).multiply(this.view());
    const z = this.zoom;
    const char = normalizeCharacter(this.p);
    const a = char.anims.find((x) => x.id === (this.anim() || {}).id);
    const srcs = this.sources();

    // export canvas: checkerboard inside, dashed edge
    if (this.bounds) {
      const b = this.bounds;
      const x = this.panX - b.ox * z, y = this.panY - b.oy * z;
      g.fillStyle = "rgba(255,255,255,0.05)";
      g.fillRect(x, y, b.w * z, b.h * z);
      g.setLineDash([5, 4]);
      g.strokeStyle = "rgba(242,165,65,0.8)";
      g.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(b.w * z) - 1, Math.round(b.h * z) - 1);
      g.setLineDash([]);
    }
    // origin
    g.strokeStyle = "rgba(255,90,110,0.55)";
    g.beginPath();
    g.moveTo(0, Math.round(this.panY) + 0.5); g.lineTo(W, Math.round(this.panY) + 0.5);
    g.moveTo(Math.round(this.panX) + 0.5, 0); g.lineTo(Math.round(this.panX) + 0.5, H);
    g.stroke();

    if (a) {
      const src = srcs.get(a.source && a.source.card);
      if (!src) {
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.fillStyle = "rgba(255,107,107,0.9)";
        g.fillText("来源卡片没有输出（被删除或还没算完）", 16, 24);
      } else {
        if (this.onion && !this.playing) {
          const order = timeline(a, src).map((e) => e.i);
          const k = order.indexOf(this.fi);
          const prev = k > 0 ? order[k - 1] : order.length > 1 && a.loop !== false ? order[order.length - 1] : null;
          if (prev != null && prev !== this.fi) {
            g.globalAlpha = 0.28;
            g.setTransform(V);
            drawAnimFrame(g, char, a, prev, srcs);
            g.globalAlpha = 1;
          }
        }
        g.setTransform(V);
        drawAnimFrame(g, char, a, this.fi, srcs);
        if ((a.frames[this.fi] || {}).disabled) {
          g.setTransform(dpr, 0, 0, dpr, 0, 0);
          g.fillStyle = "rgba(255,193,78,0.9)";
          g.fillText("这一帧已禁用（导出和播放会跳过）", 16, 24);
        }
      }
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
  }

  // ---------- output ----------
  async exportZip() {
    const char = normalizeCharacter(this.p);
    if (!char.anims.length) { this.app.toast("还没有动画可导出。", "warn"); return; }
    const t = this.app.toast("正在导出角色包…");
    try {
      const name = this.card.title || "character";
      const blob = await exportCharacterZip(this.app, char, this.sources(), name);
      t.remove();
      downloadBlob(blob, name + ".zip");
      this.app.toast("已导出角色包（" + fmtBytes(blob.size) + "）：每组动画一份，外加 character.json 和音效。", "ok");
    } catch (err) {
      t.remove();
      this.app.toast("导出失败：" + err.message, "error");
    }
  }

  async bakeCurrent() {
    const a = this.anim();
    if (!a) return;
    const char = normalizeCharacter(this.p);
    try {
      await bakeAnimation(this.app, this.id, char, char.anims.find((x) => x.id === a.id), this.sources());
    } catch (err) {
      this.app.toast("烘焙失败：" + err.message, "error");
    }
  }

  showHelp() {
    const m = openModal("调帧台快捷键");
    m.body.append(el("dl", { class: "shortcuts" }, ...[
      ["1 / 2 / 3", "拖单帧 / 拖整组 / 拖角色"],
      ["方向键", "按当前工具微调 1px，Shift 10px"],
      [", / .", "上一帧 / 下一帧（跳过禁用的帧）"],
      ["Enter", "播放 / 暂停"],
      ["滚轮 / 空格拖动", "缩放 / 平移；F 适应"],
      ["Ctrl+Z / Ctrl+Y", "撤销 / 重做（和画布共用历史）"],
      ["把音频拖到帧上", "绑定音效"],
    ].flatMap(([k, v]) => [el("dt", { class: "mono" }, k), el("dd", null, v)])));
  }
}

const round2 = (v) => Math.round(v * 100) / 100;
