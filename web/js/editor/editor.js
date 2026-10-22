// Pixel editor: a full-screen overlay that edits one animation card.
//
// Layout: tools (left) · canvas (centre) · colours + palette (right) · timeline
// (bottom: layers are rows, frames are columns, like Aseprite). Edits stay local
// until 保存, which uploads the changed cels and updates the card as one undo step
// on the board.
import { el, clamp, createCanvas, canvasFromImageData, blobToCanvas } from "../core/util.js";
import { getAssetCanvas, putCanvasAsset } from "../core/assets.js";
import { EditorDoc } from "./doc.js";
import * as R from "./raster.js";
import { PALETTES, colorCounts, unpackRGB } from "../imaging/color.js";
import { openModal } from "../ui/modal.js";
import { showMenu } from "../ui/menu.js";
import { TRAIL_PRESETS, TRAIL_DEFAULTS, BAND_LOOK, rasterizeTrail } from "./trailbrush.js";
import { GLOW_PRESETS } from "../trails/glow.js";
import { styleThumb } from "./thumbs.js";
import { TrailMode } from "./trailmode.js";
import { drawFrameStack } from "../trails/composite.js";
import { BUILTIN_BRUSHES, builtinBrush } from "../trails/model.js";

const TOOLS = [
  { id: "pencil", label: "铅笔", key: "B", icon: "✎" },
  { id: "eraser", label: "橡皮", key: "E", icon: "⌫" },
  { id: "fill", label: "填充", key: "G", icon: "◩" },
  { id: "picker", label: "吸管", key: "I", icon: "⊙" },
  { id: "line", label: "直线", key: "L", icon: "╱" },
  { id: "rect", label: "矩形", key: "U", icon: "▭" },
  { id: "ellipse", label: "椭圆", key: "Shift+U", icon: "◯" },
  { id: "select", label: "选区", key: "M", icon: "⬚" },
  { id: "move", label: "移动", key: "V", icon: "✥" },
  { id: "trail", label: "拖尾", key: "T", icon: "☄" },
];
const KEY_TOOL = { b: "pencil", e: "eraser", g: "fill", i: "picker", l: "line", u: "rect", m: "select", v: "move", t: "trail" };
const FX_LAYER = "特效";
const TRAIL_KEY = "gt.trailBrush";
const ZOOMS = [0.25, 0.5, 1, 2, 3, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64];
const BRUSH_TOOLS = new Set(["pencil", "eraser", "line", "rect", "ellipse"]);

export const EDITOR_SHORTCUTS = [
  ["B / E / G / I", "铅笔 / 橡皮 / 填充 / 吸管"],
  ["L / U / Shift+U", "直线 / 矩形 / 椭圆（按住 Shift 约束角度或正方形）"],
  ["M / V", "选区 / 移动（没有选区时移动整层）"],
  ["Alt + 点击", "临时吸管"],
  ["T", "拖尾笔：按住拖出一道刀光，松手落笔；样式在左侧选"],
  ["Shift + 点击（铅笔）", "从上一点画直线"],
  ["右键", "用副色画"],
  ["X", "交换主色 / 副色"],
  ["[ / ]", "笔刷变小 / 变大"],
  [", / .  或 ← / →", "上一帧 / 下一帧"],
  ["Enter", "播放 / 暂停（有浮动选区时为确认放下）"],
  ["Ctrl+A / Ctrl+D", "全选 / 取消选区"],
  ["Ctrl+C / X / V", "复制 / 剪切 / 粘贴（也能粘贴系统剪贴板里的图片）"],
  ["Delete", "删除选区内容"],
  ["Shift+H / Shift+V", "水平 / 垂直翻转（选区或整层）"],
  ["方向键（移动工具）", "微调 1px，Shift 10px"],
  ["滚轮 / 空格拖动", "缩放 / 平移；Ctrl+0 适应窗口"],
  ["Ctrl+Z / Ctrl+Y", "撤销 / 重做"],
  ["Ctrl+S", "保存到动画卡片"],
];

const celCache = new WeakMap();
function celCanvas(img) {
  let e = celCache.get(img);
  if (!e) { e = { c: createCanvas(img.width, img.height), v: -1 }; celCache.set(img, e); }
  const v = img.__v || 0;
  if (e.v !== v) { e.c.getContext("2d").putImageData(img, 0, 0); e.v = v; }
  return e.c;
}

// colours actually painted, most used first
function usedColors(doc, limit = 64) {
  const imgs = [...new Set(doc.cels.values())];
  if (!imgs.length) return [];
  return [...colorCounts(imgs).entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([k]) => R.hex(unpackRGB(k)));
}

const DEFAULT_PALETTE = () => PALETTES.endesga32.colors.map((c) => R.hex(c));

export async function openEditor(app, cardId) {
  const card = app.store.cards[cardId];
  if (!card) return null;
  const pid = app.store.projectId;
  const doc = await EditorDoc.fromParams(card.params, (aid) => getAssetCanvas(pid, aid));
  // The palette is the artist's set of colours; the colours already in the picture
  // are shown separately ("画面中的颜色"). Older documents saved just the handful of
  // extracted colours as their palette — top those up with a full default set.
  if (doc.palette.length < 8) {
    const have = new Set(doc.palette.map((h) => h.toLowerCase()));
    doc.palette = [...doc.palette, ...DEFAULT_PALETTE().filter((h) => !have.has(h))];
  }
  const ed = new Editor(app, cardId, doc);
  ed.open();
  return ed;
}

class Editor {
  constructor(app, cardId, doc) {
    this.app = app;
    this.cardId = cardId;
    this.doc = doc;
    this.fi = 0;
    this.li = doc.layers.length - 1;
    this.tool = "pencil";
    this.primary = R.fromHex(doc.palette[0] || "#000000");
    this.secondary = [255, 255, 255, 255];
    this.brush = 1;
    this.pixelPerfect = true;
    this.contiguous = true;
    this.filled = false;
    this.grid = true;
    this.onion = { on: true, prev: 1, next: 1 };
    // trail brush settings follow the user across documents
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(TRAIL_KEY) || "{}"); } catch { /* none */ }
    this.trail = { ...TRAIL_DEFAULTS, ...saved };
    this.trailPreview = null;
    this.tm = new TrailMode(this); // 攻击拖尾模式
    this.zoom = 8; this.panX = 0; this.panY = 0;
    this.sel = null;       // { x, y, w, h }
    this.float = null;     // { img, x, y, whole }
    this.preview = null;   // { pts, color }
    this.hover = null;
    this.drag = null;
    this.space = false;
    this.playing = false;
    this.dirty = false;
    this.clip = null;
    this.onionCache = new Map();
    this.raf = 0;
  }

  // ---------- lifecycle ----------
  open() {
    this.build();
    document.body.append(this.root);
    this.root.focus();
    this.fit();
    this.rebuildTimeline();
    this.renderPalette();
    this.renderUsed();
    this.syncColors();
    this.syncToolUI();
    this.updateTitle();
    this.onPaste = (e) => this.handlePaste(e);
    window.addEventListener("paste", this.onPaste);
    this.ro = new ResizeObserver(() => this.requestRender());
    this.ro.observe(this.stage);
  }

  close(force) {
    if (this.dirty && !force) {
      const m = openModal("还有没保存的修改", {
        buttons: [
          { label: "取消", action: () => {} },
          { label: "不保存", danger: true, action: () => this.close(true) },
          { label: "保存并关闭", primary: true, action: async () => { if (await this.save()) this.close(true); } },
        ],
      });
      m.body.append(el("p", null, "关闭前要把修改保存到动画卡片吗？"));
      return;
    }
    this.playing = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("paste", this.onPaste);
    this.ro.disconnect();
    this.root.remove();
    this.app.board.root.focus();
  }

  markDirty() {
    this.dirty = true;
    this.saveState.textContent = "● 未保存";
    this.saveState.dataset.state = "dirty";
  }

  async save() {
    this.commitFloat();
    const store = this.app.store;
    if (!store.cards[this.cardId]) { this.app.toast("动画卡片已被删除，无法保存。", "error"); return false; }
    this.saveState.textContent = "保存中…";
    try {
      const pid = store.projectId;
      const params = await this.doc.toParams((img) => putCanvasAsset(pid, canvasFromImageData(img)));
      store.mutate((d) => {
        const c = d.board.cards[this.cardId];
        if (c) c.params = { ...c.params, ...params };
      });
      this.dirty = false;
      this.saveState.textContent = "已保存";
      this.saveState.dataset.state = "saved";
      return true;
    } catch (err) {
      this.saveState.textContent = "保存失败";
      this.app.toast("保存失败：" + err.message, "error");
      return false;
    }
  }

  // ---------- DOM ----------
  build() {
    const card = this.app.store.cards[this.cardId];
    this.titleEl = el("span", { class: "ed-title" }, (card && card.title) || "动画");
    this.sizeEl = el("span", { class: "ed-size mono" });
    this.saveState = el("span", { class: "ed-save mono", dataset: { state: "saved" } }, "已保存");
    this.undoBtn = el("button", { class: "icon-btn", title: "撤销 (Ctrl+Z)", onclick: () => this.undo() }, "↶");
    this.redoBtn = el("button", { class: "icon-btn", title: "重做 (Ctrl+Y)", onclick: () => this.redo() }, "↷");
    const top = el("div", { class: "ed-top" },
      el("span", { class: "ed-badge" }, "像素编辑器"), this.titleEl, this.sizeEl,
      el("button", { class: "btn small", onclick: () => this.resizeDialog() }, "画布尺寸…"),
      this.trailBtn = el("button", { class: "btn small", title: "攻击拖尾模式：在开始帧画一根棍子，逐帧移动 / 拉伸它，自动生成每帧的拖尾", onclick: () => this.tm.toggle() }, "攻击拖尾"),
      this.undoBtn, this.redoBtn,
      el("span", { class: "spacer" }),
      this.saveState,
      el("button", { class: "icon-btn", title: "快捷键", onclick: () => this.showHelp() }, "?"),
      el("button", { class: "btn primary", onclick: () => this.save() }, "保存"),
      el("button", { class: "btn", onclick: () => this.close() }, "关闭"),
    );

    // tools
    this.toolBtns = {};
    const tools = el("div", { class: "ed-tools" });
    for (const t of TOOLS) {
      const b = el("button", { class: "ed-tool", title: t.label + "（" + t.key + "）", onclick: () => this.setTool(t.id) },
        el("span", { class: "ed-tool-ico" }, t.icon), el("span", { class: "ed-tool-label" }, t.label));
      this.toolBtns[t.id] = b;
      tools.append(b);
    }
    this.optsEl = el("div", { class: "ed-opts" });
    tools.append(this.optsEl);

    // stage
    this.canvas = el("canvas", { class: "ed-canvas" });
    this.statusEl = el("div", { class: "ed-status mono" });
    this.stage = el("div", { class: "ed-stage" }, this.canvas, this.statusEl, this.tm.toggles);
    this.g = this.canvas.getContext("2d");
    this.bindStage();

    // colours + palette
    this.primEl = el("button", { class: "ed-swatch prim", title: "主色（左键）· 点击选色" });
    this.secEl = el("button", { class: "ed-swatch sec", title: "副色（右键）· 点击选色" });
    this.colorIn = el("input", { type: "color", class: "ed-color-in" });
    let picking = "primary";
    this.primEl.onclick = () => { picking = "primary"; this.colorIn.value = R.hex(this.primary); this.colorIn.click(); };
    this.secEl.onclick = () => { picking = "secondary"; this.colorIn.value = R.hex(this.secondary); this.colorIn.click(); };
    this.colorIn.addEventListener("input", () => { this[picking] = R.fromHex(this.colorIn.value); this.syncColors(); });
    this.hexIn = el("input", { type: "text", class: "mono ed-hex", maxlength: 7, title: "主色十六进制" });
    this.hexIn.addEventListener("change", () => {
      const v = this.hexIn.value.trim();
      if (/^#?[0-9a-f]{6}$/i.test(v)) { this.primary = R.fromHex(v.startsWith("#") ? v : "#" + v); this.syncColors(); }
      else this.syncColors();
    });
    this.palEl = el("div", { class: "ed-palette" });
    this.usedEl = el("div", { class: "ed-palette used" });
    this.usedTitle = el("span");
    // the right side shows colours, or the trail panel while 攻击拖尾模式 is on
    this.colorPanel = el("div", null,
      el("div", { class: "ed-panel-title" }, "颜色"),
      el("div", { class: "ed-colors" },
        el("div", { class: "ed-swatches" }, this.secEl, this.primEl),
        el("div", { class: "ed-color-col" },
          this.hexIn,
          el("button", { class: "btn small", title: "交换主色 / 副色（X）", onclick: () => this.swapColors() }, "⇄ 交换"),
          el("button", { class: "btn small", title: "副色设为透明（右键即擦除）", onclick: () => { this.secondary = [0, 0, 0, 0]; this.syncColors(); } }, "副色透明"),
          el("button", { class: "btn small", title: "打开系统取色器，任选主色", onclick: () => this.primEl.click() }, "取色器…")),
        this.colorIn),
      el("div", { class: "ed-panel-title" }, "调色板",
        el("span", { class: "spacer" }),
        el("button", { class: "tool-btn", title: "把主色加入调色板", onclick: () => this.paletteAdd() }, "＋"),
        el("button", { class: "tool-btn", title: "从调色板删除主色", onclick: () => this.paletteRemove() }, "－"),
        el("button", { class: "tool-btn", title: "载入色板", onclick: (e) => this.paletteMenu(e) }, "色板 ▾")),
      this.palEl,
      el("div", { class: "ed-panel-title used-title" }, this.usedTitle,
        el("span", { class: "spacer" }),
        el("button", { class: "tool-btn", title: "把画面里的颜色全部加入调色板", onclick: () => this.paletteAddUsed() }, "全部加入")),
      this.usedEl,
      el("p", { class: "ed-hint" }, "左键选主色，右键选副色。点主色色块或「取色器…」可以任选颜色。"),
    );
    this.tm.panel.style.display = "none";
    const side = el("div", { class: "ed-side" }, this.colorPanel, this.tm.panel);

    // timeline
    this.tlBar = el("div", { class: "tl-bar" });
    this.tlGrid = el("div", { class: "tl-grid" });
    this.buildTimelineBar();
    const timeline = el("div", { class: "ed-timeline" }, this.tlBar, el("div", { class: "tl-scroll" }, this.tlGrid));

    this.root = el("div", { class: "editor-root open", tabindex: "-1" },
      top, el("div", { class: "ed-main" }, tools, this.stage, side), timeline);
    this.root.addEventListener("keydown", (e) => this.onKey(e, true));
    this.root.addEventListener("keyup", (e) => this.onKey(e, false));
    this.root.addEventListener("contextmenu", (e) => { if (e.target === this.canvas) e.preventDefault(); });
  }

  updateTitle() {
    this.sizeEl.textContent = this.doc.w + " × " + this.doc.h + " · " + this.doc.frames.length + " 帧 · " + this.doc.layers.length + " 图层";
    this.undoBtn.disabled = !this.doc.undoStack.length;
    this.redoBtn.disabled = !this.doc.redoStack.length;
  }

  // ---------- tools & options ----------
  setTool(t) {
    if (this.tm.active) this.tm.toggle(false); // picking a drawing tool leaves trail mode
    if (t !== "move" && t !== "select") this.commitFloat();
    this.tool = t;
    this.preview = null;
    this.syncToolUI();
    this.requestRender();
  }

  syncToolUI() {
    for (const id in this.toolBtns) this.toolBtns[id].classList.toggle("active", id === this.tool);
    const o = this.optsEl;
    o.replaceChildren();
    const check = (label, get, set) => {
      const box = el("input", { type: "checkbox", checked: get(), onchange: () => { set(box.checked); this.requestRender(); } });
      o.append(el("label", { class: "ed-check" }, box, label));
    };
    if (BRUSH_TOOLS.has(this.tool)) {
      const val = el("span", { class: "mono" }, this.brush + "px");
      const range = el("input", { type: "range", min: 1, max: 16, value: this.brush, oninput: () => { this.brush = +range.value; val.textContent = this.brush + "px"; } });
      o.append(el("div", { class: "ed-opt-title" }, "笔刷 ", val), range);
      this.brushRange = range; this.brushVal = val;
    }
    if (this.tool === "pencil") check("像素完美", () => this.pixelPerfect, (v) => { this.pixelPerfect = v; });
    if (this.tool === "fill") check("只填相连区域", () => this.contiguous, (v) => { this.contiguous = v; });
    if (this.tool === "rect" || this.tool === "ellipse") check("实心", () => this.filled, (v) => { this.filled = v; });
    if (this.tool === "trail") this.trailOptions(o);
    if (this.tool === "select" || this.tool === "move") {
      const b = (label, fn, title) => o.append(el("button", { class: "btn small block", title: title || "", onclick: fn }, label));
      b("全选", () => this.selectAll(), "Ctrl+A");
      b("取消选区", () => this.deselect(), "Ctrl+D");
      b("水平翻转", () => this.flip(true), "Shift+H");
      b("垂直翻转", () => this.flip(false), "Shift+V");
      b("删除内容", () => this.deleteSelection(), "Delete");
    }
    o.append(el("div", { class: "ed-opt-sep" }));
    check("像素网格", () => this.grid, (v) => { this.grid = v; });
  }

  // ---------- trail brush ----------
  saveTrail() {
    try { localStorage.setItem(TRAIL_KEY, JSON.stringify(this.trail)); } catch { /* private mode */ }
  }

  // the 拖尾笔's tail brush: built-in by id, or the user's imported image (kept
  // in the tool settings as a small data URL, so it follows them across projects)
  toolBrush() {
    const t = this.trail;
    if (t.brushData) {
      if (this._brushData !== t.brushData) {
        this._brushData = t.brushData;
        this._brushCanvas = null;
        const im = new Image();
        im.onload = () => {
          const c = createCanvas(im.naturalWidth, im.naturalHeight);
          c.getContext("2d").drawImage(im, 0, 0);
          if (this._brushData === t.brushData) { this._brushCanvas = c; this.syncToolUI(); }
        };
        im.src = t.brushData;
      }
      if (this._brushCanvas) return this._brushCanvas;
    }
    return builtinBrush(t.brushId || "bristle");
  }

  async importToolBrush() {
    const files = await this.app.pickFiles("image/png,image/webp,image/*");
    if (!files[0]) return;
    const src = await blobToCanvas(files[0]);
    // brushes only need coarse detail; keep the stored copy small
    const s = Math.min(1, 256 / src.width, 64 / src.height);
    const c = createCanvas(Math.max(1, Math.round(src.width * s)), Math.max(1, Math.round(src.height * s)));
    const g = c.getContext("2d");
    g.imageSmoothingEnabled = true;
    g.drawImage(src, 0, 0, c.width, c.height);
    this.trail.brushData = c.toDataURL("image/png");
    this.trail.brushName = files[0].name;
    this.trail.tailMode = "brush";
    this.saveTrail();
    this.syncToolUI();
  }

  trailOptions(o) {
    const t = this.trail;
    o.append(el("div", { class: "ed-opt-title" }, "样式"));
    const grid = el("div", { class: "trail-presets" });
    for (const p of TRAIL_PRESETS) {
      const b = el("button", { class: "trail-preset" + (t.preset === p.id ? " on" : ""), title: p.name, onclick: () => {
        t.preset = p.id;
        t.bandPick = p.id;
        t.pixelGlow = false;
        if (p.fade != null) t.fade = p.fade;
        if (p.look && p.look.shape) t.shape = p.look.shape;
        t.edgeBreak = Math.round(((p.look && p.look.edgeBreak) ?? BAND_LOOK.edgeBreak) * 100);
        this.saveTrail();
        this.syncToolUI();
      } }, styleThumb("band", p, this.primary), el("span", null, p.name));
      grid.append(b);
    }
    // smooth 光效 styles, stored as "glow:<id>"
    const glowGrid = el("div", { class: "trail-presets" });
    // 高清 or 像素 first. 像素 lists the glow styles drawn as pixel art, then the
    // classic bands; switching keeps the glow style and only toggles pixel art
    const glow = String(t.preset).startsWith("glow:"), hd = glow && !t.pixelGlow;
    for (const p of GLOW_PRESETS) {
      glowGrid.append(el("button", { class: "trail-preset" + (t.preset === "glow:" + p.id ? " on" : ""), title: p.name, onclick: () => {
        t.preset = "glow:" + p.id;
        t.glowPick = p.id;
        t.pixelGlow = !hd;
        this.saveTrail();
        this.syncToolUI();
      } }, styleThumb(hd ? "hd" : "pixel", p), el("span", null, p.name)));
    }
    const kind = el("div", { class: "trail-kind" },
      el("button", { class: hd ? "on" : "", title: "平滑发光的高清特效", onclick: () => { if (!hd) { if (!glow) t.preset = "glow:" + (t.glowPick || GLOW_PRESETS[0].id); t.pixelGlow = false; this.saveTrail(); this.syncToolUI(); } } }, "高清"),
      el("button", { class: hd ? "" : "on", title: "像素画：同样的光效画成像素，或经典分层色带", onclick: () => { if (hd) { t.pixelGlow = true; this.saveTrail(); this.syncToolUI(); } } }, "像素"));
    o.append(kind);
    if (hd) o.append(glowGrid);
    else o.append(el("div", { class: "ed-opt-sub" }, "像素光效"), glowGrid, el("div", { class: "ed-opt-sub" }, "经典色带"), grid);
    const slider = (label, key, min, max, unit) => {
      const val = el("span", { class: "mono" }, t[key] + unit);
      const r = el("input", { type: "range", min, max, value: t[key], oninput: () => { t[key] = +r.value; val.textContent = r.value + unit; this.saveTrail(); } });
      o.append(el("div", { class: "ed-opt-title" }, label, val), r);
    };
    slider("宽度", "width", 1, glow ? 240 : 64, "px");
    slider("尾部渐隐", "fade", 0, 100, "%");
    if (glow && t.pixelGlow) {
      slider("像素大小", "pxSize", 1, 8, "px");
      const pa = el("select", { class: "ed-select" },
        ...[["steps", "4 级透明"], ["dither", "抖动（全实心）"], ["hard", "硬边"]].map(([v, n]) => el("option", { value: v, selected: (t.pxAlpha || "steps") === v }, n)));
      pa.onchange = () => { t.pxAlpha = pa.value; this.saveTrail(); };
      o.append(el("div", { class: "ed-opt-title" }, "透明方式"), pa);
    }
    if (!glow) {
      // how neighbouring colour bands meet (no partial alpha either way)
      const bb = el("select", { class: "ed-select" },
        ...[["steps", "色阶（插入中间色）"], ["dither", "抖动（网点过渡）"], ["smooth", "平滑渐变"], ["hard", "硬边"]].map(([v, n]) => el("option", { value: v, selected: (t.bandBlend || "steps") === v }, n)));
      bb.onchange = () => { t.bandBlend = bb.value; this.saveTrail(); this.syncToolUI(); };
      o.append(el("div", { class: "ed-opt-title" }, "色带过渡"), bb);
      if ((t.bandBlend || "steps") !== "hard") slider("过渡宽度", "bandSoft", 0, 100, "%");
      slider("尾部变暗", "bandShade", 0, 100, "%");
      slider("破碎", "edgeBreak", 0, 100, "%");
    }
    const shape = el("select", { class: "ed-select" },
      ...[["head", "尾细头粗"], ["crescent", "两头尖（月牙）"], ["even", "均匀"]].map(([v, n]) => el("option", { value: v, selected: t.shape === v }, n)));
    shape.onchange = () => { t.shape = shape.value; this.saveTrail(); };
    o.append(el("div", { class: "ed-opt-title" }, "形状"), shape);
    const check = (label, key) => {
      const box = el("input", { type: "checkbox", checked: !!t[key], onchange: () => { t[key] = box.checked; this.saveTrail(); } });
      o.append(el("label", { class: "ed-check" }, box, label));
    };
    // tail: brush streaks along the stroke (same brushes as the attack trail) or
    // dither; 光效 strokes are smooth light and skip all of this
    if (!glow) {
      const tm = el("select", { class: "ed-select" },
        ...[["brush", "笔刷刷痕"], ["dither", "颗粒抖动"]].map(([v, n]) => el("option", { value: v, selected: (t.tailMode || "brush") === v }, n)));
      tm.onchange = () => { t.tailMode = tm.value; this.saveTrail(); this.syncToolUI(); };
      o.append(el("div", { class: "ed-opt-title" }, "尾部质感"), tm);
      if ((t.tailMode || "brush") === "brush") {
        const bs = el("select", { class: "ed-select" },
          ...BUILTIN_BRUSHES.map((b) => el("option", { value: b.id, selected: !t.brushData && (t.brushId || "bristle") === b.id }, b.name.replace(/（.*）/, ""))),
          ...(t.brushData ? [el("option", { value: "__custom", selected: true }, "自定义：" + (t.brushName || "笔刷图"))] : []));
        bs.onchange = () => { if (bs.value !== "__custom") { t.brushId = bs.value; t.brushData = null; t.brushName = null; this.saveTrail(); this.syncToolUI(); } };
        const pv = el("canvas", { class: "tm-brush-pv", width: 70, height: 20, title: "左边是拖尾末端，越亮的刷痕伸得越远" });
        pv.style.width = "100%";
        pv.getContext("2d").drawImage(this.toolBrush(), 0, 0, 70, 20);
        o.append(bs, pv, el("button", { class: "btn small block", title: "导入灰度图作为笔刷：横向 = 拖尾方向，纵向 = 宽度方向", onclick: () => this.importToolBrush() }, "导入笔刷…"));
      }
      check("火花点", "sparks");
    }
    check("画到「特效」图层", "toFxLayer");
    o.append(el("p", { class: "ed-hint" }, "顺着挥砍方向拖：起点是尾、终点是头。打开洋葱皮逐帧画。"));
  }

  updateTrailPreview() {
    const d = this.drag;
    const img = rasterizeTrail(d.pts, this.trail, this.doc.w, this.doc.h, this.primary, this.toolBrush());
    this.trailPreview = img ? canvasFromImageData(img) : null;
    d.img = img;
  }

  commitTrail(d) {
    this.trailPreview = null;
    if (d.img) this.stampOnFxLayer(d.img, !this.trail.toFxLayer);
  }

  // paint `img` (document-sized) onto the 特效 layer (or the current layer)
  stampOnFxLayer(img, onCurrent) {
    const target = onCurrent ? (this.editableLayer() ? { li: this.li, created: false } : null) : (() => {
      const at = this.doc.layers.findIndex((l) => l.name === FX_LAYER);
      if (at < 0) return { li: null, created: true };
      if (this.doc.layers[at].locked) { this.app.toast("「特效」图层已锁定。", "warn"); return null; }
      this.doc.layers[at].visible = true;
      return { li: at, created: false };
    })();
    if (!target) return;
    this.commitFloat();
    this.doc.checkpoint();
    this.li = target.created ? this.doc.addLayer(this.li + 1, FX_LAYER) : target.li;
    const cel = this.doc.editableCel(this.fi, this.li);
    R.blit(cel, img, 0, 0);
    R.touch(cel);
    this.afterChange(target.created);
    if (target.created) this.app.toast("已新建「特效」图层，特效都画在这一层上，不会弄脏角色。");
  }

  setBrush(n) {
    this.brush = clamp(n, 1, 16);
    if (this.brushRange) { this.brushRange.value = this.brush; this.brushVal.textContent = this.brush + "px"; }
    this.requestRender();
  }

  // ---------- colours & palette ----------
  syncColors() {
    const bg = (c) => (c[3] ? R.hex(c) : "transparent");
    this.primEl.style.background = bg(this.primary);
    this.secEl.style.background = bg(this.secondary);
    this.secEl.classList.toggle("clear", !this.secondary[3]);
    if (document.activeElement !== this.hexIn) this.hexIn.value = R.hex(this.primary);
    const h = R.hex(this.primary);
    for (const s of this.palEl.children) s.classList.toggle("on", s.dataset.c === h);
  }

  swapColors() {
    [this.primary, this.secondary] = [this.secondary, this.primary];
    if (!this.primary[3]) this.primary = [0, 0, 0, 255];
    this.syncColors();
  }

  renderPalette() {
    this.palEl.replaceChildren(...this.doc.palette.map((h) => {
      const s = el("button", { class: "ed-pal-cell", title: h, dataset: { c: h.toLowerCase() } });
      s.style.background = h;
      s.addEventListener("click", () => { this.primary = R.fromHex(h); this.syncColors(); });
      s.addEventListener("contextmenu", (e) => { e.preventDefault(); this.secondary = R.fromHex(h); this.syncColors(); });
      return s;
    }));
    this.syncColors();
  }

  renderUsed() {
    const list = usedColors(this.doc);
    this.usedTitle.textContent = "画面中的颜色（" + list.length + (list.length >= 64 ? "+" : "") + "）";
    this.usedEl.replaceChildren(...list.map((h) => this.swatch(h)));
    if (!list.length) this.usedEl.append(el("span", { class: "chips-empty" }, "画面还是空的"));
    this.syncColors();
  }

  // counting colours walks every cel, so after a stroke wait for a quiet moment
  scheduleUsed() {
    clearTimeout(this.usedTimer);
    this.usedTimer = setTimeout(() => this.renderUsed(), 250);
  }

  swatch(h) {
    const s = el("button", { class: "ed-pal-cell", title: h, dataset: { c: h.toLowerCase() } });
    s.style.background = h;
    s.addEventListener("click", () => { this.primary = R.fromHex(h); this.syncColors(); });
    s.addEventListener("contextmenu", (e) => { e.preventDefault(); this.secondary = R.fromHex(h); this.syncColors(); });
    return s;
  }

  paletteAddUsed() {
    const have = new Set(this.doc.palette.map((h) => h.toLowerCase()));
    const add = usedColors(this.doc, 256).filter((h) => !have.has(h));
    if (!add.length) { this.app.toast("画面里的颜色都已经在调色板里了。"); return; }
    this.change(() => { this.doc.palette = [...this.doc.palette, ...add]; });
    this.renderPalette();
  }

  paletteAdd() {
    const h = R.hex(this.primary);
    if (!this.primary[3] || this.doc.palette.includes(h)) return;
    this.change(() => { this.doc.palette.push(h); });
    this.renderPalette();
  }

  paletteRemove() {
    const h = R.hex(this.primary);
    if (!this.doc.palette.includes(h)) return;
    this.change(() => { this.doc.palette = this.doc.palette.filter((x) => x !== h); });
    this.renderPalette();
  }

  paletteMenu(e) {
    const r = e.currentTarget.getBoundingClientRect();
    const set = (list) => { this.change(() => { this.doc.palette = list; }); this.renderPalette(); };
    showMenu(r.left, r.bottom + 4, [
      { label: "换成画面中的颜色（最多 64 色）", action: () => set(usedColors(this.doc)) },
      "-",
      ...Object.values(PALETTES).map((p) => ({ label: p.label, hint: p.colors.length + " 色", action: () => set(p.colors.map((c) => R.hex(c))) })),
      "-",
      { label: "清空调色板", danger: true, action: () => set([]) },
    ]);
  }

  // ---------- history ----------
  // every structural edit: settle a floating selection first, then checkpoint
  change(fn) {
    this.commitFloat();
    this.doc.checkpoint();
    fn();
    this.afterChange();
  }

  afterChange(structural = true) {
    this.markDirty();
    this.scheduleUsed();
    this.fi = clamp(this.fi, 0, this.doc.frames.length - 1);
    this.li = clamp(this.li, 0, this.doc.layers.length - 1);
    this.updateTitle();
    if (structural) this.rebuildTimeline(); else this.refreshThumb(this.fi);
    this.requestRender();
  }

  undo() {
    // a floating selection is the tail end of the last step: dropping it and
    // undoing restores the pixels it was lifted from
    this.float = null;
    this.drag = null;
    if (this.doc.undo()) { this.sel = null; this.renderPalette(); this.afterChange(); this.tm.refresh(); }
  }

  redo() {
    this.commitFloat();
    if (this.doc.redo()) { this.renderPalette(); this.afterChange(); this.tm.refresh(); }
  }

  // ---------- floating selection ----------
  lift() {
    if (this.float) return true;
    if (!this.editableLayer()) return false;
    const rect = this.sel || { x: 0, y: 0, w: this.doc.w, h: this.doc.h };
    this.doc.checkpoint();
    const cel = this.doc.editableCel(this.fi, this.li);
    const img = R.extract(cel, rect);
    R.clearRect(cel, rect);
    R.touch(cel);
    this.float = { img, x: rect.x, y: rect.y, whole: !this.sel };
    this.sel = { ...rect };
    this.markDirty();
    return true;
  }

  commitFloat() {
    const f = this.float;
    if (!f) return;
    this.float = null;
    // the cel was made editable by lift()/paste() after the last checkpoint
    const cel = this.doc.cel(this.fi, this.li) || this.doc.editableCel(this.fi, this.li);
    R.blit(cel, f.img, f.x, f.y);
    R.touch(cel);
    if (f.whole) this.sel = null;
    else this.sel = this.clampRect({ x: f.x, y: f.y, w: f.img.width, h: f.img.height });
    this.markDirty();
    this.refreshThumb(this.fi);
    this.requestRender();
  }

  clampRect(r) {
    const x0 = clamp(r.x, 0, this.doc.w), y0 = clamp(r.y, 0, this.doc.h);
    const x1 = clamp(r.x + r.w, 0, this.doc.w), y1 = clamp(r.y + r.h, 0, this.doc.h);
    return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
  }

  selectAll() { this.commitFloat(); this.sel = { x: 0, y: 0, w: this.doc.w, h: this.doc.h }; this.requestRender(); }
  deselect() { this.commitFloat(); this.sel = null; this.requestRender(); }

  deleteSelection() {
    if (this.float) { this.float = null; this.sel = null; this.markDirty(); this.refreshThumb(this.fi); this.requestRender(); return; }
    if (!this.sel || !this.editableLayer()) return;
    this.doc.checkpoint();
    const cel = this.doc.editableCel(this.fi, this.li);
    R.clearRect(cel, this.sel);
    this.afterChange(false);
  }

  flip(horizontal) {
    if (this.float) { this.float.img = R.flip(this.float.img, horizontal); this.requestRender(); return; }
    if (!this.editableLayer()) return;
    this.doc.checkpoint();
    const cel = this.doc.editableCel(this.fi, this.li);
    if (this.sel) {
      const part = R.extract(cel, this.sel);
      R.clearRect(cel, this.sel);
      R.blit(cel, R.flip(part, horizontal), this.sel.x, this.sel.y);
      R.touch(cel);
    } else {
      this.doc.setCel(this.fi, this.li, R.flip(cel, horizontal));
    }
    this.afterChange(false);
  }

  copy(cut) {
    let img;
    if (this.float) img = R.cloneImg(this.float.img);
    else {
      const cel = this.doc.cel(this.fi, this.li);
      const rect = this.sel || { x: 0, y: 0, w: this.doc.w, h: this.doc.h };
      img = cel ? R.extract(cel, rect) : R.blank(rect.w, rect.h);
    }
    this.clip = { img, x: this.sel ? this.sel.x : 0, y: this.sel ? this.sel.y : 0 };
    if (cut) this.deleteSelection();
  }

  paste(img, x, y) {
    if (!this.editableLayer()) return;
    this.commitFloat();
    this.doc.checkpoint();
    this.doc.editableCel(this.fi, this.li);
    this.float = { img: R.cloneImg(img), x, y, whole: false };
    this.sel = { x, y, w: img.width, h: img.height };
    this.setTool("move");
    this.markDirty();
    this.requestRender();
  }

  async handlePaste(e) {
    const t = e.target;
    if (t && t.closest && t.closest("input, textarea")) return;
    const items = [...(e.clipboardData ? e.clipboardData.items : [])];
    const file = items.find((i) => i.kind === "file" && i.type.startsWith("image/"));
    e.preventDefault();
    if (file) {
      const c = await blobToCanvas(file.getAsFile());
      const img = c.getContext("2d").getImageData(0, 0, c.width, c.height);
      if (c.width > this.doc.w || c.height > this.doc.h) this.app.toast("粘贴的图片比画布大，超出部分放下时会被裁掉。可以先改画布尺寸。", "warn");
      this.paste(img, 0, 0);
      return;
    }
    if (this.clip) this.paste(this.clip.img, this.clip.x, this.clip.y);
  }

  editableLayer() {
    const l = this.doc.layers[this.li];
    if (!l) return false;
    if (l.locked) { this.app.toast("图层「" + l.name + "」已锁定。", "warn"); return false; }
    if (l.visible === false) { this.app.toast("图层「" + l.name + "」是隐藏的，先显示它再画。", "warn"); return false; }
    if (l.trail) { this.app.toast("「" + l.name + "」是拖尾图层：在攻击拖尾模式里调棍子；想手修像素，先「栅格化本帧到特效图层」。", "warn"); return false; }
    return true;
  }

  // does layer li have content on frame fi (pixels, or a trail stick)?
  hasContent(fi, li) {
    const l = this.doc.layers[li];
    if (l && l.trail) {
      const t = this.doc.trails.find((x) => x.id === l.trail);
      return !!(t && t.keys && t.keys[this.doc.frames[fi].id]);
    }
    const img = this.doc.cel(fi, li);
    return !!img && !R.isEmpty(img);
  }

  // ---------- frames / layers ----------
  goFrame(fi) {
    if (fi === this.fi && !this.float) return;
    this.commitFloat();
    const prev = this.fi;
    this.fi = (fi + this.doc.frames.length) % this.doc.frames.length;
    this.syncTimelineSel();
    this.tm.onFrameChange(prev); // trail mode: carry the stick to the next frame
    this.tm.refresh();
    this.requestRender();
  }

  goLayer(li) {
    if (li !== this.li) {
      this.commitFloat();
      this.li = li;
      this.syncTimelineSel();
    }
    // a trail layer is edited in trail mode; a pixel layer with the drawing tools
    const l = this.doc.layers[li];
    if (l && l.trail) {
      this.tm.selId = l.trail;
      if (!this.tm.active) this.tm.toggle(true); else this.tm.refresh();
    } else if (this.tm.active) this.tm.toggle(false);
    this.requestRender();
  }

  // ---------- stage input ----------
  toPixel(e) {
    const r = this.canvas.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    return { x: Math.floor((sx - this.panX) / this.zoom), y: Math.floor((sy - this.panY) / this.zoom), sx, sy };
  }

  bindStage() {
    const c = this.canvas;
    c.addEventListener("pointerdown", (e) => this.onDown(e));
    c.addEventListener("pointermove", (e) => this.onMove(e));
    c.addEventListener("pointerup", (e) => this.onUp(e));
    c.addEventListener("pointercancel", (e) => this.onUp(e));
    c.addEventListener("pointerleave", () => { this.hover = null; this.requestRender(); this.updateStatus(); });
    this.stage.addEventListener("wheel", (e) => {
      e.preventDefault();
      const p = this.toPixel(e);
      const dir = e.deltaY < 0 ? 1 : -1;
      let i = ZOOMS.findIndex((z) => z >= this.zoom - 1e-9);
      if (i < 0) i = ZOOMS.length - 1;
      if (ZOOMS[i] !== this.zoom && dir < 0) i++;
      this.setZoom(ZOOMS[clamp(i + dir, 0, ZOOMS.length - 1)], p.sx, p.sy);
    }, { passive: false });
  }

  setZoom(z, sx, sy) {
    if (sx == null) { sx = this.canvas.clientWidth / 2; sy = this.canvas.clientHeight / 2; }
    this.panX = sx - (sx - this.panX) * z / this.zoom;
    this.panY = sy - (sy - this.panY) * z / this.zoom;
    this.zoom = z;
    this.requestRender();
    this.updateStatus();
  }

  fit() {
    const W = this.stage.clientWidth - 48, H = this.stage.clientHeight - 48;
    let z = ZOOMS[0];
    for (const v of ZOOMS) if (this.doc.w * v <= W && this.doc.h * v <= H) z = v;
    this.zoom = z;
    this.panX = Math.round((this.stage.clientWidth - this.doc.w * z) / 2);
    this.panY = Math.round((this.stage.clientHeight - this.doc.h * z) / 2);
    this.requestRender();
    this.updateStatus();
  }

  colorFor(e) {
    if (this.tool === "eraser") return R.TRANSPARENT;
    return e.button === 2 || (e.buttons & 2) ? this.secondary : this.primary;
  }

  pickColor(x, y, secondary) {
    // the colour you see: topmost visible layer with paint at this pixel
    for (let li = this.doc.layers.length - 1; li >= 0; li--) {
      if (this.doc.layers[li].visible === false) continue;
      const img = this.doc.cel(this.fi, li);
      const c = img && R.getPx(img, x, y);
      if (c && c[3]) {
        if (secondary) this.secondary = [c[0], c[1], c[2], 255];
        else this.primary = [c[0], c[1], c[2], 255];
        this.syncColors();
        return;
      }
    }
  }

  onDown(e) {
    this.root.focus();
    const p = this.toPixel(e);
    if (e.button === 1 || (e.button === 0 && this.space)) {
      e.preventDefault();
      this.drag = { type: "pan", sx: e.clientX, sy: e.clientY, px: this.panX, py: this.panY };
      this.canvas.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0 && e.button !== 2) return;
    if (this.playing) this.togglePlay();
    this.canvas.setPointerCapture(e.pointerId);
    if (this.tm.active) {
      // in 攻击拖尾模式 the canvas edits the trail, never the pixels
      if (e.button === 0) this.tm.onDown(e, this.toFloat(e));
      this.requestRender();
      return;
    }
    const secondary = e.button === 2;
    const tool = e.altKey && this.tool !== "select" && this.tool !== "move" ? "picker" : this.tool;

    if (tool === "picker") { this.pickColor(p.x, p.y, secondary); this.drag = { type: "picker", secondary }; return; }

    if (tool === "pencil" || tool === "eraser") {
      if (!this.editableLayer()) return;
      this.commitFloat();
      this.doc.checkpoint();
      const cel = this.doc.editableCel(this.fi, this.li);
      const color = this.colorFor(e);
      this.drag = { type: "paint", cel, color, pts: [], last: null };
      if (e.shiftKey && this.lastPaint) this.paintLine(this.lastPaint.x, this.lastPaint.y, p.x, p.y);
      else this.paintLine(p.x, p.y, p.x, p.y);
      this.afterPaint();
      return;
    }

    if (tool === "fill") {
      if (!this.editableLayer()) return;
      this.commitFloat();
      this.doc.checkpoint();
      const cel = this.doc.editableCel(this.fi, this.li);
      if (R.floodFill(cel, p.x, p.y, this.colorFor(e), this.contiguous, this.sel)) { R.touch(cel); this.afterChange(false); }
      else this.doc.discardCheckpoint();
      return;
    }

    if (tool === "line" || tool === "rect" || tool === "ellipse") {
      if (!this.editableLayer()) return;
      this.commitFloat();
      this.drag = { type: "shape", tool, x0: p.x, y0: p.y, color: this.colorFor(e) };
      this.updateShape(p, e.shiftKey);
      return;
    }

    if (tool === "trail") {
      this.commitFloat();
      const r = this.canvas.getBoundingClientRect();
      const fx = (e.clientX - r.left - this.panX) / this.zoom, fy = (e.clientY - r.top - this.panY) / this.zoom;
      this.drag = { type: "trail", pts: [{ x: fx, y: fy }] };
      return;
    }

    if (tool === "select") {
      this.commitFloat();
      this.drag = { type: "select", x0: clamp(p.x, 0, this.doc.w - 1), y0: clamp(p.y, 0, this.doc.h - 1), moved: false };
      return;
    }

    if (tool === "move") {
      if (!this.float && !this.lift()) return;
      this.drag = { type: "move", sx: p.x, sy: p.y, fx: this.float.x, fy: this.float.y };
      this.requestRender();
    }
  }

  toFloat(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left - this.panX) / this.zoom, y: (e.clientY - r.top - this.panY) / this.zoom };
  }

  onMove(e) {
    const p = this.toPixel(e);
    this.hover = p;
    if (this.tm.drag) {
      this.tm.onMove(e, this.toFloat(e));
      this.requestRender();
      this.updateStatus();
      return;
    }
    const d = this.drag;
    if (d) {
      if (d.type === "pan") {
        this.panX = d.px + e.clientX - d.sx;
        this.panY = d.py + e.clientY - d.sy;
      } else if (d.type === "picker") {
        this.pickColor(p.x, p.y, d.secondary);
      } else if (d.type === "paint") {
        const l = d.last;
        this.paintLine(l.x, l.y, p.x, p.y);
        this.afterPaint();
      } else if (d.type === "shape") {
        this.updateShape(p, e.shiftKey);
      } else if (d.type === "trail") {
        // sub-pixel positions: the stroke's curvature comes from these
        const r = this.canvas.getBoundingClientRect();
        d.pts.push({ x: (e.clientX - r.left - this.panX) / this.zoom, y: (e.clientY - r.top - this.panY) / this.zoom });
        this.updateTrailPreview();
      } else if (d.type === "select") {
        const x1 = clamp(p.x, 0, this.doc.w - 1), y1 = clamp(p.y, 0, this.doc.h - 1);
        d.moved = d.moved || x1 !== d.x0 || y1 !== d.y0;
        this.sel = { x: Math.min(d.x0, x1), y: Math.min(d.y0, y1), w: Math.abs(x1 - d.x0) + 1, h: Math.abs(y1 - d.y0) + 1 };
      } else if (d.type === "move" && this.float) {
        this.float.x = d.fx + p.x - d.sx;
        this.float.y = d.fy + p.y - d.sy;
        this.sel = { x: this.float.x, y: this.float.y, w: this.float.img.width, h: this.float.img.height };
      }
    }
    this.requestRender();
    this.updateStatus();
  }

  onUp() {
    if (this.tm.drag) { this.tm.onUp(); this.requestRender(); return; }
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (d.type === "paint") {
      this.lastPaint = d.last;
      this.afterChange(false);
    } else if (d.type === "shape") {
      const pv = this.preview;
      this.preview = null;
      if (pv && pv.pts.length) {
        this.doc.checkpoint();
        const cel = this.doc.editableCel(this.fi, this.li);
        for (const [x, y] of pv.pts) R.stamp(cel, x, y, this.brush, d.color, this.sel);
        R.touch(cel);
        this.afterChange(false);
      }
    } else if (d.type === "select") {
      if (!d.moved) this.sel = null;
    } else if (d.type === "trail") {
      this.commitTrail(d);
    }
    this.requestRender();
  }

  // Bresenham between two points, stamping the brush. With a 1px pencil and
  // "pixel perfect" on, L-shaped corners are removed as you draw — the stair-step
  // a freehand stroke otherwise leaves on every diagonal.
  paintLine(x0, y0, x1, y1) {
    const d = this.drag;
    const pp = this.pixelPerfect && this.brush === 1 && this.tool === "pencil";
    R.line(x0, y0, x1, y1, (x, y) => {
      const last = d.pts[d.pts.length - 1];
      if (last && last.x === x && last.y === y) return;
      const before = R.getPx(d.cel, x, y) || R.TRANSPARENT;
      R.stamp(d.cel, x, y, this.brush, d.color, this.sel);
      d.pts.push({ x, y, before });
      if (pp && d.pts.length >= 3) {
        const n = d.pts.length, a = d.pts[n - 3], b = d.pts[n - 2], c = d.pts[n - 1];
        if ((a.x === b.x || a.y === b.y) && (c.x === b.x || c.y === b.y) && a.x !== c.x && a.y !== c.y) {
          R.setPx(d.cel, b.x, b.y, b.before, this.sel);
          d.pts.splice(n - 2, 1);
        }
      }
      if (d.pts.length > 64) d.pts.splice(0, d.pts.length - 8);
    });
    d.last = { x: x1, y: y1 };
  }

  afterPaint() {
    R.touch(this.drag.cel);
    this.markDirty();
    this.requestRender();
  }

  updateShape(p, constrain) {
    const d = this.drag;
    let x1 = p.x, y1 = p.y;
    let dx = x1 - d.x0, dy = y1 - d.y0;
    if (constrain) {
      if (d.tool === "line") {
        const ax = Math.abs(dx), ay = Math.abs(dy);
        if (ax > 2 * ay) dy = 0;
        else if (ay > 2 * ax) dx = 0;
        else { const m = Math.max(ax, ay); dx = Math.sign(dx) * m; dy = Math.sign(dy) * m; }
      } else {
        const m = Math.max(Math.abs(dx), Math.abs(dy));
        dx = (Math.sign(dx) || 1) * m; dy = (Math.sign(dy) || 1) * m;
      }
      x1 = d.x0 + dx; y1 = d.y0 + dy;
    }
    const pts = [];
    const add = (x, y) => pts.push([x, y]);
    if (d.tool === "line") R.line(d.x0, d.y0, x1, y1, add);
    else if (d.tool === "rect") R.rectPoints(d.x0, d.y0, x1, y1, this.filled, add);
    else R.ellipsePoints(d.x0, d.y0, x1, y1, this.filled, add);
    this.preview = { pts, color: d.color, size: Math.abs(x1 - d.x0) + 1 + " × " + (Math.abs(y1 - d.y0) + 1) };
  }

  // ---------- keyboard ----------
  onKey(e, down) {
    const t = e.target;
    const typing = t && t.closest && t.closest("input, textarea, select") && t.type !== "checkbox" && t.type !== "range";
    if (e.code === "Space" && !typing) {
      this.space = down;
      this.stage.classList.toggle("can-pan", down);
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (!down) return;
    if (typing && e.key !== "Escape") return;
    if (document.querySelector(".modal-root.open")) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    let handled = true;

    if (mod && k === "z" && !e.shiftKey) this.undo();
    else if (mod && (k === "y" || (k === "z" && e.shiftKey))) this.redo();
    else if (mod && k === "s") this.save();
    else if (mod && k === "a") this.selectAll();
    else if (mod && k === "d") this.deselect();
    else if (mod && k === "c") this.copy(false);
    else if (mod && k === "x") this.copy(true);
    else if (mod && k === "v") handled = false; // the paste event handles it (system images too)
    else if (mod && k === "0") this.fit();
    else if (mod) handled = false;
    else if (this.tm.onKey(k)) handled = true;
    else if (e.shiftKey && k === "h") this.flip(true);
    else if (e.shiftKey && k === "v") this.flip(false);
    else if (e.shiftKey && k === "u") this.setTool("ellipse");
    else if (KEY_TOOL[k] && !e.shiftKey) this.setTool(KEY_TOOL[k]);
    else if (k === "x") this.swapColors();
    else if (k === "[") this.setBrush(this.brush - 1);
    else if (k === "]") this.setBrush(this.brush + 1);
    else if (k === "delete" || k === "backspace") this.deleteSelection();
    else if (k === "escape") { if (this.float || this.sel) this.deselect(); else handled = false; }
    else if (k === "enter") { if (this.float) this.commitFloat(); else this.togglePlay(); }
    else if (k === "," ) this.goFrame(this.fi - 1);
    else if (k === ".") this.goFrame(this.fi + 1);
    else if (k.startsWith("arrow")) {
      const step = e.shiftKey ? 10 : 1;
      const dv = { arrowleft: [-step, 0], arrowright: [step, 0], arrowup: [0, -step], arrowdown: [0, step] }[k];
      if (this.tool === "move" || this.float) {
        if (this.lift()) {
          this.float.x += dv[0]; this.float.y += dv[1];
          this.sel = { x: this.float.x, y: this.float.y, w: this.float.img.width, h: this.float.img.height };
          this.requestRender();
        }
      } else if (k === "arrowleft" || k === "arrowright") this.goFrame(this.fi + (k === "arrowright" ? 1 : -1));
      else if (k === "arrowup" || k === "arrowdown") this.goLayer(clamp(this.li + (k === "arrowup" ? 1 : -1), 0, this.doc.layers.length - 1));
    }
    else if (k === "=" || k === "+") this.setZoom(ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.findIndex((z) => z > this.zoom))] || this.zoom);
    else if (k === "-") { const i = ZOOMS.findIndex((z) => z >= this.zoom); this.setZoom(ZOOMS[Math.max(0, i - 1)]); }
    else handled = false;

    if (handled) { e.preventDefault(); e.stopPropagation(); }
  }

  // ---------- playback ----------
  togglePlay() {
    this.playing = !this.playing;
    this.playBtn.textContent = this.playing ? "❚❚" : "▶";
    if (!this.playing) return;
    this.commitFloat();
    let last = performance.now();
    const step = (t) => {
      if (!this.playing) return;
      const f = this.doc.frames[this.fi];
      const dur = (f && f.duration) || 1000 / Math.max(1, this.doc.fps);
      if (t - last >= dur) {
        last = t;
        this.fi = (this.fi + 1) % this.doc.frames.length;
        this.syncTimelineSel();
        this.requestRender();
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // ---------- rendering ----------
  requestRender() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.render(); });
  }

  composite(fi) {
    const c = createCanvas(this.doc.w, this.doc.h);
    const g = c.getContext("2d");
    const doc = this.doc;
    drawFrameStack(g, doc.layers, doc.trails, doc.frames.map((f) => f.id), fi, doc.w, doc.h, (l) => {
      const img = doc.cel(fi, doc.layers.indexOf(l));
      if (img) g.drawImage(celCanvas(img), 0, 0);
    });
    return c;
  }

  onionLayer(fi, tint) {
    const key = fi + ":" + tint + ":" + this.doc.version;
    let c = this.onionCache.get(key);
    if (!c) {
      if (this.onionCache.size > 32) this.onionCache.clear();
      c = this.composite(fi);
      const g = c.getContext("2d");
      g.globalCompositeOperation = "source-atop";
      g.fillStyle = tint;
      g.globalAlpha = 0.45;
      g.fillRect(0, 0, c.width, c.height);
      this.onionCache.set(key, c);
    }
    return c;
  }

  checker(g) {
    if (!this.checkerPat) {
      const t = createCanvas(16, 16);
      const x = t.getContext("2d");
      x.fillStyle = "#8e8f97"; x.fillRect(0, 0, 16, 16);
      x.fillStyle = "#6b6c73"; x.fillRect(0, 0, 8, 8); x.fillRect(8, 8, 8, 8);
      this.checkerPat = g.createPattern(t, "repeat");
    }
    this.checkerPat.setTransform(new DOMMatrix().translate(this.panX, this.panY));
    return this.checkerPat;
  }

  render() {
    const c = this.canvas, g = this.g, doc = this.doc;
    const dpr = window.devicePixelRatio || 1;
    const W = this.stage.clientWidth, H = this.stage.clientHeight;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
      c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
      c.style.width = W + "px"; c.style.height = H + "px";
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    g.imageSmoothingEnabled = false;
    const z = this.zoom, ox = this.panX, oy = this.panY, iw = doc.w * z, ih = doc.h * z;

    g.save();
    g.beginPath();
    g.rect(ox, oy, iw, ih);
    g.clip();
    g.fillStyle = this.checker(g);
    g.fillRect(ox, oy, iw, ih);

    if (this.onion.on && !this.playing && doc.frames.length > 1) {
      for (let k = this.onion.prev; k >= 1; k--) {
        const f = this.fi - k;
        if (f < 0) continue;
        g.globalAlpha = 0.5 / k;
        g.drawImage(this.onionLayer(f, "#ff4d6d"), ox, oy, iw, ih);
      }
      for (let k = this.onion.next; k >= 1; k--) {
        const f = this.fi + k;
        if (f >= doc.frames.length) continue;
        g.globalAlpha = 0.5 / k;
        g.drawImage(this.onionLayer(f, "#4da3ff"), ox, oy, iw, ih);
      }
      g.globalAlpha = 1;
    }

    // attack trails are layers: sticks marked 角色后方 go under every layer, the
    // rest is drawn at the trail layer's place in the stack
    this.tm.drawBack(g, ox, oy, iw, ih);
    doc.layers.forEach((l, li) => {
      if (l.visible === false) return;
      g.globalAlpha = (l.opacity ?? 100) / 100;
      if (l.trail) { this.tm.drawLayer(g, l, ox, oy, iw, ih); g.globalAlpha = 1; return; }
      const img = doc.cel(this.fi, li);
      if (img) g.drawImage(celCanvas(img), ox, oy, iw, ih);
      if (li !== this.li) return;
      if (this.float) {
        if (!this.float.c || this.float.cImg !== this.float.img) {
          this.float.c = canvasFromImageData(this.float.img);
          this.float.cImg = this.float.img;
        }
        g.drawImage(this.float.c, ox + this.float.x * z, oy + this.float.y * z, this.float.img.width * z, this.float.img.height * z);
      }
      if (this.preview) {
        const pc = this.preview.color;
        g.fillStyle = pc[3] ? R.hex(pc) : "rgba(255,255,255,0.6)";
        const s = this.brush, o = Math.floor((s - 1) / 2);
        for (const [x, y] of this.preview.pts) g.fillRect(ox + (x - o) * z, oy + (y - o) * z, s * z, s * z);
      }
    });
    g.globalAlpha = 1;
    // the trail being drawn shows on top until it is committed to its layer
    if (this.trailPreview) g.drawImage(this.trailPreview, ox, oy, iw, ih);
    g.restore();
    this.tm.drawOverlay(g, ox, oy, z);

    // pixel grid
    if (this.grid && z >= 6) {
      g.strokeStyle = "rgba(255,255,255,0.08)";
      g.lineWidth = 1;
      g.beginPath();
      for (let x = 1; x < doc.w; x++) { const sx = Math.round(ox + x * z) + 0.5; g.moveTo(sx, oy); g.lineTo(sx, oy + ih); }
      for (let y = 1; y < doc.h; y++) { const sy = Math.round(oy + y * z) + 0.5; g.moveTo(ox, sy); g.lineTo(ox + iw, sy); }
      g.stroke();
    }
    // frame of the canvas
    g.strokeStyle = "rgba(255,255,255,0.35)";
    g.strokeRect(Math.round(ox) - 0.5, Math.round(oy) - 0.5, Math.round(iw) + 1, Math.round(ih) + 1);

    // selection: two-tone dashes read on any colour
    if (this.sel) {
      const r = this.sel;
      const x = Math.round(ox + r.x * z) + 0.5, y = Math.round(oy + r.y * z) + 0.5;
      const w = Math.round(r.w * z) - 1, h = Math.round(r.h * z) - 1;
      g.setLineDash([4, 4]);
      g.strokeStyle = "#000"; g.lineDashOffset = 0; g.strokeRect(x, y, w, h);
      g.strokeStyle = "#fff"; g.lineDashOffset = 4; g.strokeRect(x, y, w, h);
      g.setLineDash([]);
    }

    // brush outline under the cursor
    const hv = this.hover;
    if (hv && !this.drag && !this.tm.active && BRUSH_TOOLS.has(this.tool) && hv.x >= 0 && hv.y >= 0 && hv.x < doc.w && hv.y < doc.h) {
      const b = R.brushCells(hv.x, hv.y, this.brush);
      g.strokeStyle = "rgba(255,255,255,0.9)";
      g.strokeRect(Math.round(ox + b.x * z) + 0.5, Math.round(oy + b.y * z) + 0.5, b.size * z - 1, b.size * z - 1);
      g.strokeStyle = "rgba(0,0,0,0.6)";
      g.strokeRect(Math.round(ox + b.x * z) - 0.5, Math.round(oy + b.y * z) - 0.5, b.size * z + 1, b.size * z + 1);
    }
  }

  updateStatus() {
    const hv = this.hover, doc = this.doc;
    const parts = [];
    if (hv && hv.x >= 0 && hv.y >= 0 && hv.x < doc.w && hv.y < doc.h) {
      parts.push(hv.x + ", " + hv.y);
      const img = doc.cel(this.fi, this.li);
      const c = img && R.getPx(img, hv.x, hv.y);
      parts.push(c && c[3] ? R.hex(c) : "透明");
    }
    parts.push(Math.round(this.zoom * 100) + "%");
    if (this.sel) parts.push("选区 " + this.sel.w + "×" + this.sel.h);
    if (this.preview) parts.push(this.preview.size);
    this.statusEl.textContent = parts.join("  ·  ");
  }

  // ---------- timeline ----------
  buildTimelineBar() {
    const b = (label, title, fn, cls) => el("button", { class: "tool-btn" + (cls ? " " + cls : ""), title, onclick: fn }, label);
    this.playBtn = b("▶", "播放 / 暂停（Enter）", () => this.togglePlay(), "play");
    this.frameLabel = el("span", { class: "mono tl-pos" });
    this.fpsIn = el("input", { type: "number", class: "mini mono", min: 1, max: 60, title: "帧率" });
    this.fpsIn.addEventListener("change", () => { this.doc.fps = clamp(+this.fpsIn.value || 12, 1, 60); this.fpsIn.value = this.doc.fps; this.markDirty(); });
    this.durIn = el("input", { type: "number", class: "mini mono", min: 0, max: 10000, title: "这一帧的时长（毫秒）；留空 = 按帧率" });
    this.durIn.addEventListener("change", () => {
      const v = Math.round(+this.durIn.value);
      this.change(() => { this.doc.frames[this.fi].duration = v > 0 ? v : null; });
    });
    const onionBox = el("input", { type: "checkbox", checked: this.onion.on, onchange: () => { this.onion.on = onionBox.checked; this.requestRender(); } });
    const num = (key) => {
      const i = el("input", { type: "number", class: "mini mono", min: 0, max: 5, value: this.onion[key] });
      i.addEventListener("input", () => { this.onion[key] = clamp(+i.value || 0, 0, 5); this.requestRender(); });
      return i;
    };
    this.opacityIn = el("input", { type: "range", min: 0, max: 100, title: "当前图层不透明度" });
    this.opacityIn.addEventListener("input", () => {
      const l = this.doc.layers[this.li];
      l.opacity = +this.opacityIn.value;
      this.opacityVal.textContent = l.opacity + "%";
      this.markDirty();
      this.requestRender();
    });
    this.opacityVal = el("span", { class: "mono dim" });
    this.tlBar.append(
      b("⏮", "第一帧", () => this.goFrame(0)), b("◀", "上一帧（,）", () => this.goFrame(this.fi - 1)), this.playBtn,      b("▶|", "下一帧（.）", () => this.goFrame(this.fi + 1)), b("⏭", "最后一帧", () => this.goFrame(this.doc.frames.length - 1)),
      this.frameLabel,
      el("span", { class: "tl-sep" }),
      el("label", { class: "tl-field" }, "帧率", this.fpsIn),
      el("label", { class: "tl-field" }, "本帧时长", this.durIn, "ms"),
      el("span", { class: "tl-sep" }),
      el("label", { class: "tl-field" }, onionBox, "洋葱皮 前", num("prev"), "后", num("next")),
      el("span", { class: "tl-sep" }),
      el("span", { class: "tl-group" }, "帧",
        b("＋", "在后面新建空白帧", () => this.change(() => { this.fi = this.doc.addFrame(this.fi + 1, null); })),
        b("⧉", "复制当前帧", () => this.change(() => { this.fi = this.doc.addFrame(this.fi + 1, this.fi); })),
        b("✕", "删除当前帧", () => { if (this.doc.frames.length > 1) this.change(() => { this.doc.deleteFrame(this.fi); }); }),
        b("←", "当前帧左移", () => this.change(() => { this.fi = this.doc.moveFrame(this.fi, -1); })),
        b("→", "当前帧右移", () => this.change(() => { this.fi = this.doc.moveFrame(this.fi, 1); }))),
      el("span", { class: "tl-sep" }),
      el("span", { class: "tl-group" }, "图层",
        b("＋", "新建图层（在当前图层上方）", () => this.change(() => { this.li = this.doc.addLayer(this.li + 1); })),
        b("⧉", "复制当前图层", () => this.change(() => { this.li = this.doc.duplicateLayer(this.li); })),
        b("✕", "删除当前图层", () => { if (this.doc.layers.length > 1) this.change(() => { this.doc.deleteLayer(this.li); this.li = Math.max(0, this.li - 1); }); }),
        b("↑", "上移图层", () => this.change(() => { this.li = this.doc.moveLayer(this.li, 1); })),
        b("↓", "下移图层", () => this.change(() => { this.li = this.doc.moveLayer(this.li, -1); })),
        b("⤓", "向下合并", () => {
          if (this.li < 1) return;
          if (this.doc.layers[this.li].trail || this.doc.layers[this.li - 1].trail) { this.app.toast("拖尾图层不能合并：先「栅格化本帧到特效图层」，再合并特效图层。", "warn"); return; }
          this.change(() => { this.doc.mergeDown(this.li); this.li--; });
        })),
      el("label", { class: "tl-field" }, "不透明度", this.opacityIn, this.opacityVal),
    );
  }

  rebuildTimeline() {
    const doc = this.doc;
    const g = this.tlGrid;
    g.replaceChildren();
    g.style.gridTemplateColumns = "200px repeat(" + doc.frames.length + ", 40px)";
    g.append(el("div", { class: "tl-corner" }, "图层 \\ 帧"));
    this.thumbs = [];
    doc.frames.forEach((f, fi) => {
      const th = el("canvas", { class: "tl-thumb", width: 32, height: 32 });
      this.thumbs.push(th);
      const head = el("div", { class: "tl-fhead", dataset: { fi }, title: "第 " + (fi + 1) + " 帧" + (f.duration ? " · " + f.duration + "ms" : "") },
        th, el("span", { class: "mono" }, String(fi + 1)), f.duration ? el("span", { class: "tl-dur mono" }, f.duration) : null);
      head.addEventListener("click", () => this.goFrame(fi));
      g.append(head);
    });
    for (let li = doc.layers.length - 1; li >= 0; li--) {
      const l = doc.layers[li];
      const eye = el("button", { class: "tl-ico" + (l.visible === false ? " off" : ""), title: "显示 / 隐藏" }, l.visible === false ? "◌" : "◉");
      eye.onclick = (e) => { e.stopPropagation(); l.visible = l.visible === false; this.markDirty(); this.rebuildTimeline(); this.requestRender(); };
      const lock = el("button", { class: "tl-ico lock" + (l.locked ? " on" : ""), title: l.locked ? "已锁定 · 点击解锁" : "点击锁定（锁定后不能画）" }, "锁");
      lock.onclick = (e) => { e.stopPropagation(); l.locked = !l.locked; this.markDirty(); this.rebuildTimeline(); };
      const name = el("span", { class: "tl-name" + (l.trail ? " trail" : "") }, (l.trail ? "☄ " : "") + l.name);
      const head = el("div", { class: "tl-lhead", dataset: { li } }, eye, lock, name);
      head.addEventListener("click", () => this.goLayer(li));
      head.addEventListener("dblclick", () => {
        const n = prompt("图层名称", l.name);
        if (n && n.trim()) this.change(() => { this.doc.layers[li].name = n.trim(); });
      });
      g.append(head);
      doc.frames.forEach((f, fi) => {
        const cell = el("div", { class: "tl-cel" + (this.hasContent(fi, li) ? " has" : "") + (l.trail ? " trail" : ""), dataset: { fi, li } }, el("i"));
        cell.addEventListener("click", () => { this.goLayer(li); this.goFrame(fi); });
        g.append(cell);
      });
    }
    for (let fi = 0; fi < doc.frames.length; fi++) this.refreshThumb(fi, true);
    this.syncTimelineSel();
  }

  refreshThumb(fi, noCelUpdate) {
    const th = this.thumbs && this.thumbs[fi];
    if (!th) return;
    const g = th.getContext("2d");
    g.clearRect(0, 0, 32, 32);
    g.imageSmoothingEnabled = false;
    const s = Math.min(32 / this.doc.w, 32 / this.doc.h);
    const w = this.doc.w * s, h = this.doc.h * s;
    g.drawImage(this.composite(fi), (32 - w) / 2, (32 - h) / 2, w, h);
    if (!noCelUpdate) {
      // the dot for "this cel has paint" can change with any stroke
      for (const cell of this.tlGrid.querySelectorAll('.tl-cel[data-fi="' + fi + '"]')) {
        cell.classList.toggle("has", this.hasContent(fi, +cell.dataset.li));
      }
    }
  }

  syncTimelineSel() {
    for (const n of this.tlGrid.querySelectorAll(".tl-fhead")) n.classList.toggle("on", +n.dataset.fi === this.fi);
    for (const n of this.tlGrid.querySelectorAll(".tl-lhead")) n.classList.toggle("on", +n.dataset.li === this.li);
    for (const n of this.tlGrid.querySelectorAll(".tl-cel")) {
      n.classList.toggle("col", +n.dataset.fi === this.fi);
      n.classList.toggle("on", +n.dataset.fi === this.fi && +n.dataset.li === this.li);
    }
    const f = this.doc.frames[this.fi];
    this.frameLabel.textContent = (this.fi + 1) + " / " + this.doc.frames.length;
    if (document.activeElement !== this.fpsIn) this.fpsIn.value = this.doc.fps;
    if (document.activeElement !== this.durIn) { this.durIn.value = f && f.duration ? f.duration : ""; this.durIn.placeholder = String(Math.round(1000 / this.doc.fps)); }
    const l = this.doc.layers[this.li];
    if (l) { this.opacityIn.value = l.opacity ?? 100; this.opacityVal.textContent = (l.opacity ?? 100) + "%"; }
    const cur = this.tlGrid.querySelector(".tl-fhead.on");
    if (cur && this.playing) cur.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  // ---------- dialogs ----------
  resizeDialog() {
    this.commitFloat();
    const w = el("input", { type: "number", class: "mono", min: 1, max: 1024, value: this.doc.w });
    const h = el("input", { type: "number", class: "mono", min: 1, max: 1024, value: this.doc.h });
    let anchor = [1, 1];
    const grid = el("div", { class: "anchor-grid" });
    const cells = [];
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
      const c = el("button", { type: "button", class: "anchor-cell" + (x === 1 && y === 1 ? " on" : ""), onclick: () => {
        anchor = [x, y];
        cells.forEach((k) => k.classList.toggle("on", k === c));
      } });
      cells.push(c);
      grid.append(c);
    }
    const m = openModal("画布尺寸", {
      buttons: [
        { label: "取消", action: () => {} },
        { label: "确定", primary: true, action: () => {
          const nw = clamp(Math.round(+w.value), 1, 1024), nh = clamp(Math.round(+h.value), 1, 1024);
          if (nw === this.doc.w && nh === this.doc.h) return;
          this.change(() => { this.doc.resize(nw, nh, anchor[0], anchor[1]); });
          this.sel = null;
          this.fit();
        } },
      ],
    });
    m.body.append(
      el("div", { class: "f-pair" },
        el("label", { class: "f-field" }, el("span", { class: "f-label" }, "宽"), w),
        el("label", { class: "f-field" }, el("span", { class: "f-label" }, "高"), h)),
      el("div", { class: "f-field" }, el("span", { class: "f-label" }, "原画面放在"), grid),
      el("p", { class: "f-hint" }, "改的是画布大小，画面本身不缩放：变大时四周留透明，变小时超出的部分会被裁掉。所有帧和图层一起改。"),
    );
    w.focus();
  }

  showHelp() {
    const m = openModal("像素编辑器快捷键");
    m.body.append(el("dl", { class: "shortcuts" }, ...EDITOR_SHORTCUTS.flatMap(([k, v]) => [el("dt", { class: "mono" }, k), el("dd", null, v)])));
  }
}
