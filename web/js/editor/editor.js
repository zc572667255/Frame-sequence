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
import { GLOW_PRESETS, glowStyle } from "../trails/glow.js";
import { controlKit, headTailControls, glowControls } from "./effectpanel.js";
import { styleThumb } from "./thumbs.js";
import { TrailMode } from "./trailmode.js";
import { drawFrameStack } from "../trails/composite.js";
import { BUILTIN_BRUSHES, builtinBrush } from "../trails/model.js";
import { GHOST_DEFAULTS, renderGhost, drawGhostCanvas, ghostSettings, ghostOn, ghostCovers } from "../trails/ghost.js";
import { GhostPanel } from "./ghostpanel.js";
import { strokePath, strokeMid, bendAt, strokeLen, strokePlane, strokeCircle, slideOnCircle, strokeEllipsePath, strokeEllipseHandles, scaleKey, replaneKeys, keyWidth, strokeWraps, clipStrokePart, fitStroke, strokeAt, strokeShows, drawStrokeLayer, drawStrokeDraft, strokePreview, warmStrokePreview, onStrokeBrush, onStrokeReady, prefetchStrokeLayer, strokeFrameReady } from "../trails/stroke.js";
import { VfxPanel } from "./vfxpanel.js";
import { VFX_KINDS } from "../vfx/effects.js";
import { VFX_LAYER_DEFAULTS, vfxSettings, vfxFrame, vfxRegion, vfxRect, drawVfxLayer, layerBBox, prefetchVfxLayer, onVfxReady, vfxFrameReady } from "../vfx/layer.js";

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
  { id: "vfx", label: "特效", key: "F", icon: "✦" },
];
const KEY_TOOL = { b: "pencil", e: "eraser", g: "fill", i: "picker", l: "line", u: "rect", m: "select", v: "move", t: "trail", f: "vfx" };
const FX_LAYER = "特效";
const TRAIL_KEY = "gt.trailBrush";
const LOCK_BEND_KEY = "gt.strokeLockBend";
const VFX_KEY = "gt.vfxTool.2"; // .2: 高清 became the default (the first key saved 像素 as the old default)
const ZOOMS = [0.25, 0.5, 1, 2, 3, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64];
const BRUSH_TOOLS = new Set(["pencil", "eraser", "line", "rect", "ellipse"]);

export const EDITOR_SHORTCUTS = [
  ["B / E / G / I", "铅笔 / 橡皮 / 填充 / 吸管"],
  ["L / U / Shift+U", "直线 / 矩形 / 椭圆（按住 Shift 约束角度或正方形）"],
  ["M / V", "选区 / 移动（没有选区时移动整层）"],
  ["Alt + 点击", "临时吸管"],
  ["T", "拖尾笔：按住拖出一道刀光，画成可调整的笔触；拖头、尾、弧度的点调整，下一帧接着调；样式在右侧"],
  ["F", "特效：在当前帧新建一个特效图层，参数在右侧；选中特效图层时在画布上拖动移动、拖四角改大小"],
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

// the cursor over each handle of an effect's box (see vfxHandle)
const HANDLE_CURSOR = {
  "-1,-1": "nwse-resize", "1,1": "nwse-resize", "1,-1": "nesw-resize", "-1,1": "nesw-resize",
  "-1,0": "ew-resize", "1,0": "ew-resize", "0,-1": "ns-resize", "0,1": "ns-resize",
};

// An effect's box dragged by a handle hd ({ x, y }: the sides that move) to
// point q: the opposite side stays put; Shift keeps the shape (corners), Alt
// resizes round the centre. Region in, region out ({ x, y, w, h }, centre).
function resizeBox(r, hd, q, keepShape, fromCentre) {
  let x0 = r.x - r.w / 2, x1 = r.x + r.w / 2, y0 = r.y - r.h / 2, y1 = r.y + r.h / 2;
  if (fromCentre) {
    if (hd.x) { const hw = Math.max(2, Math.abs(q.x - r.x)); x0 = r.x - hw; x1 = r.x + hw; }
    if (hd.y) { const hh = Math.max(2, Math.abs(q.y - r.y)); y0 = r.y - hh; y1 = r.y + hh; }
  } else {
    if (hd.x < 0) x0 = Math.min(q.x, x1 - 4); else if (hd.x > 0) x1 = Math.max(q.x, x0 + 4);
    if (hd.y < 0) y0 = Math.min(q.y, y1 - 4); else if (hd.y > 0) y1 = Math.max(q.y, y0 + 4);
  }
  if (keepShape && hd.x && hd.y) {
    // the larger change wins; the corner opposite the handle (or the centre) stays
    const k = Math.max((x1 - x0) / r.w, (y1 - y0) / r.h), w = r.w * k, h = r.h * k;
    if (fromCentre) { x0 = r.x - w / 2; x1 = r.x + w / 2; y0 = r.y - h / 2; y1 = r.y + h / 2; }
    else {
      if (hd.x < 0) x0 = x1 - w; else x1 = x0 + w;
      if (hd.y < 0) y0 = y1 - h; else y1 = y0 + h;
    }
  }
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
}

const emptyCache = new WeakMap(); // ImageData -> { v, empty } (hasContent)
const celCache = new WeakMap();
function celCanvas(img) {
  let e = celCache.get(img);
  if (!e) { e = { c: createCanvas(img.width, img.height), v: -1 }; celCache.set(img, e); }
  const v = img.__v || 0;
  if (e.v !== v) { e.c.getContext("2d").putImageData(img, 0, 0); e.v = v; }
  return e.c;
}

// what a cel looks like, as a short string (for the ghost cache): cels are
// copy-on-write and R.touch counts in-place edits, so object + count says it
const celTokens = new WeakMap();
let celTokenN = 0;
function celToken(img) {
  if (!img) return "-";
  let t = celTokens.get(img);
  if (!t) { t = ++celTokenN; celTokens.set(img, t); }
  return t + "." + (img.__v || 0);
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
    // 固定弧度: a stroke's bow keeps its shape, only its head and tail move
    try { this.strokeLockBend = localStorage.getItem(LOCK_BEND_KEY) === "1"; } catch { this.strokeLockBend = false; }
    this.trailPreview = null;
    this.tm = new TrailMode(this); // 攻击拖尾模式
    this.gp = new GhostPanel(this); // 残影图层的设置
    this.vp = new VfxPanel(this);   // 特效图层的设置
    // the 特效 tool's choices follow the user across documents
    let vsaved = {};
    try { vsaved = JSON.parse(localStorage.getItem(VFX_KEY) || "{}"); } catch { /* none */ }
    this.vfxTool = { kind: "hit", palette: "radiant", style: "hd", box: 0, ...vsaved };
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
    // effect frames rendered in the background: show them as they come, and
    // draw the thumbnails that were waiting for them
    const back = () => {
      this.requestRender();
      clearTimeout(this.vfxWaitTimer);
      this.vfxWaitTimer = setTimeout(() => {
        const w = [...(this.thumbWait || [])];
        this.thumbWait = new Set();
        this.queueThumbs(w);
      }, 40);
    };
    this.offVfxReady = onVfxReady(back);
    this.offStrokeReady = onStrokeReady(back);
    this.prefetchVfx();
    this.offStrokeBrush = onStrokeBrush(() => { this.requestRender(); this.queueThumbs(this.doc.frames.map((_, fi) => fi)); });
    // the stage's size as the observer reports it: render reads this rather
    // than clientWidth, which would force a fresh layout of the whole editor
    // right after the timeline or a panel was rebuilt
    this.ro = new ResizeObserver((es) => {
      const r = es[es.length - 1].contentRect;
      this.stageSize = { w: Math.round(r.width), h: Math.round(r.height) };
      this.requestRender();
    });
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
    if (this.offVfxReady) this.offVfxReady();
    if (this.offStrokeReady) this.offStrokeReady();
    if (this.offStrokeBrush) this.offStrokeBrush();
    clearTimeout(this.vfxWaitTimer);
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
    // the trail brush's settings sit on the right, over the colours (its 主色
    // style paints in the main colour)
    this.trailPanel = el("div", { class: "ed-opts ed-tool-panel", style: { display: "none" } });
    const side = el("div", { class: "ed-side" }, this.trailPanel, this.colorPanel, this.tm.panel, this.gp.panel, this.vp.panel);

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
    // 特效, like 攻击拖尾: a new effect layer on this frame straight away, its
    // settings on the right (unless an effect layer is already the current one)
    const cur = this.doc.layers[this.li];
    if (t === "vfx" && !(cur && cur.vfx)) this.newVfx();
    if (t === "trail") warmStrokePreview(); // ready before the first drag
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
    if (this.tool === "trail" && this.trailPanel) {
      o.append(el("p", { class: "ed-hint" }, "拖尾笔的参数在右侧。"));
      this.buildTrailPanel();
    } else if (this.trailPanel) { this.trailPanel.replaceChildren(); this.trailPanelFor = null; }
    this.syncToolPanel();
    if (this.tool === "vfx") this.vfxOptions(o);
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
  toolBrush(t = this.trail) {
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
    const t = this.trailTarget();
    t.brushData = c.toDataURL("image/png");
    t.brushName = files[0].name;
    t.tailMode = "brush";
    this.trailChanged();
    this.syncToolUI();
  }

  // 效果调整, as the attack trail has it (editor/effectpanel.js): 头部弧度, 尾部,
  // and for glow styles the controls by place with their layers under ▸. The
  // brush keeps fade in %, headArc and taper as 0..1, the mixes as they are, and
  // a layer set under 细节 in look (over the preset's own)
  trailEffectControls(o, t, glow) {
    const preset = glow && (GLOW_PRESETS.find((p) => "glow:" + p.id === t.preset) || GLOW_PRESETS[0]);
    const base = preset ? glowStyle(preset) : {}, own = new Set(["fade", "taper", "headArc", "mixEdge", "mixBody", "mixGlow", "mixFx", "mixBurst"]);
    const groups = this.trailGroups || (this.trailGroups = new Set());
    const ui = {
      P: o,
      get: (key) => key === "fade" ? (t.fade ?? 45) / 100
        : own.has(key) ? t[key] ?? TRAIL_DEFAULTS[key]
        : (t.look && t.look[key] != null ? t.look[key] : base[key]),
      live: (vals) => {
        for (const [k, v] of Object.entries(vals)) {
          if (k === "fade") t.fade = Math.round(v * 100);
          else if (own.has(k)) t[k] = v;
          else t.look = { ...(t.look || {}), [k]: v };
        }
        this.trailChanged();
      },
      end: () => {},
      refresh: () => this.buildTrailPanel(),
      isOpen: (id) => groups.has(id),
      toggle: (id) => { if (groups.has(id)) groups.delete(id); else groups.add(id); this.buildTrailPanel(); },
    };
    const kit = controlKit(ui);
    o.append(el("div", { class: "ed-opt-title" }, "效果调整"), el("p", { class: "ed-hint" }, "每项右边的「细节 ▸」展开这个位置的每一层单独调。"));
    headTailControls(kit, ui, t.shape || "head");
    if (glow) glowControls(kit, ui, !!t.pixelGlow);
  }

  trailOptions(o) {
    // the selected stroke layer's look, or the brush's own for the next stroke
    const t = this.trailTarget(), sl = this.strokeLayer();
    if (sl) this.strokeSection(o, sl);
    o.append(el("div", { class: "ed-opt-title" }, "样式"));
    const grid = el("div", { class: "trail-presets" });
    for (const p of TRAIL_PRESETS) {
      const b = el("button", { class: "trail-preset" + (t.preset === p.id ? " on" : ""), title: p.name, onclick: () => {
        t.preset = p.id;
        t.look = null;
        t.bandPick = p.id;
        t.pixelGlow = false;
        if (p.fade != null) t.fade = p.fade;
        if (p.look && p.look.shape) t.shape = p.look.shape;
        t.edgeBreak = Math.round(((p.look && p.look.edgeBreak) ?? BAND_LOOK.edgeBreak) * 100);
        this.trailChanged();
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
        t.look = null; // its layers as set under 细节 belong to the old preset
        t.glowPick = p.id;
        t.pixelGlow = !hd;
        this.trailChanged();
        this.syncToolUI();
      } }, styleThumb(hd ? "hd" : "pixel", p), el("span", null, p.name)));
    }
    const kind = el("div", { class: "trail-kind" },
      el("button", { class: hd ? "on" : "", title: "平滑发光的高清特效", onclick: () => { if (!hd) { if (!glow) t.preset = "glow:" + (t.glowPick || GLOW_PRESETS[0].id); t.pixelGlow = false; this.trailChanged(); this.syncToolUI(); } } }, "高清"),
      el("button", { class: hd ? "" : "on", title: "像素画：同样的光效画成像素，或经典分层色带", onclick: () => { if (hd) { t.pixelGlow = true; this.trailChanged(); this.syncToolUI(); } } }, "像素"));
    o.append(kind);
    if (hd) o.append(glowGrid);
    else o.append(el("div", { class: "ed-opt-sub" }, "像素光效"), glowGrid, el("div", { class: "ed-opt-sub" }, "经典色带"), grid);
    const slider = (label, key, min, max, unit) => {
      const val = el("span", { class: "mono" }, t[key] + unit);
      const r = el("input", { type: "range", min, max, value: t[key], oninput: () => { t[key] = +r.value; val.textContent = r.value + unit; this.trailChanged(); } });
      o.append(el("div", { class: "ed-opt-title" }, label, val), r);
    };
    slider("宽度", "width", 1, glow ? 240 : 64, "px");
    if (glow && t.pixelGlow) {
      slider("像素大小", "pxSize", 1, 8, "px");
      const pa = el("select", { class: "ed-select" },
        ...[["steps", "4 级透明"], ["dither", "抖动（全实心）"], ["hard", "硬边"]].map(([v, n]) => el("option", { value: v, selected: (t.pxAlpha || "steps") === v }, n)));
      pa.onchange = () => { t.pxAlpha = pa.value; this.trailChanged(); };
      o.append(el("div", { class: "ed-opt-title" }, "透明方式"), pa);
    }
    if (!glow) {
      // how neighbouring colour bands meet (no partial alpha either way)
      const bb = el("select", { class: "ed-select" },
        ...[["steps", "色阶（插入中间色）"], ["dither", "抖动（网点过渡）"], ["smooth", "平滑渐变"], ["hard", "硬边"]].map(([v, n]) => el("option", { value: v, selected: (t.bandBlend || "steps") === v }, n)));
      bb.onchange = () => { t.bandBlend = bb.value; this.trailChanged(); this.syncToolUI(); };
      o.append(el("div", { class: "ed-opt-title" }, "色带过渡"), bb);
      if ((t.bandBlend || "steps") !== "hard") slider("过渡宽度", "bandSoft", 0, 100, "%");
      slider("尾部变暗", "bandShade", 0, 100, "%");
      slider("破碎", "edgeBreak", 0, 100, "%");
    }
    const shape = el("select", { class: "ed-select" },
      ...[["head", "尾细头粗"], ["crescent", "两头尖（月牙）"], ["even", "均匀"]].map(([v, n]) => el("option", { value: v, selected: t.shape === v }, n)));
    shape.onchange = () => { t.shape = shape.value; this.trailChanged(); this.syncToolUI(); };
    o.append(el("div", { class: "ed-opt-title" }, "形状"), shape);
    if (!t.toPixels || sl) {
      // 拖尾平面: the bow as a circle on a level or upright plane, seen at a slant
      const plane = el("select", { class: "ed-select" },
        ...[["flat", "画面（不压扁）"], ["h", "横向（横斩，上下压扁）"], ["v", "纵向（竖劈，左右压扁）"]].map(([v, n]) => el("option", { value: v, selected: (t.plane || "flat") === v }, n)));
      plane.onchange = () => { t.plane = plane.value; this.trailChanged(); this.syncToolUI(); };
      o.append(el("div", { class: "ed-opt-title", title: "笔触是挥刀平面上的一段圆弧，按透视压扁；补间时头绕着这个平面转" }, "拖尾平面"), plane);
      if (t.plane === "h" || t.plane === "v") {
        slider("透视压扁", "planeSquash", 0, 90, "%"); slider("倾斜角", "planeTilt", -180, 180, "°");
        // 环绕: the far half of the ellipse goes behind every layer
        const wrapBox = (label, key, title) => {
          const b = el("input", { type: "checkbox", checked: !!t[key], onchange: () => { t[key] = b.checked; this.trailChanged(); this.syncToolUI(); } });
          o.append(el("label", { class: "ed-check", title }, b, label));
        };
        wrapBox("环绕（远的半圈被挡住）", "wrap", "椭圆沿长轴分成两半：离镜头远的半圈垫到所有图层下面，被角色挡住；近的半圈在本图层的位置，挡在角色前面");
        if (t.wrap) wrapBox(t.plane === "h" ? "反过来（下半圈在后）" : "反过来（右半圈在后）", "wrapFlip", "默认横向上半圈、纵向左半圈离镜头远；勾上则对调");
      }
    }
    this.trailEffectControls(o, t, glow);
    const check = (label, key) => {
      const box = el("input", { type: "checkbox", checked: !!t[key], onchange: () => { t[key] = box.checked; this.trailChanged(); } });
      o.append(el("label", { class: "ed-check" }, box, label));
    };
    // tail: brush streaks along the stroke (same brushes as the attack trail) or
    // dither; 光效 strokes are smooth light and skip all of this
    if (!glow) {
      const tm = el("select", { class: "ed-select" },
        ...[["brush", "笔刷刷痕"], ["dither", "颗粒抖动"]].map(([v, n]) => el("option", { value: v, selected: (t.tailMode || "brush") === v }, n)));
      tm.onchange = () => { t.tailMode = tm.value; this.trailChanged(); this.syncToolUI(); };
      o.append(el("div", { class: "ed-opt-title" }, "尾部质感"), tm);
      if ((t.tailMode || "brush") === "brush") {
        const bs = el("select", { class: "ed-select" },
          ...BUILTIN_BRUSHES.map((b) => el("option", { value: b.id, selected: !t.brushData && (t.brushId || "bristle") === b.id }, b.name.replace(/（.*）/, ""))),
          ...(t.brushData ? [el("option", { value: "__custom", selected: true }, "自定义：" + (t.brushName || "笔刷图"))] : []));
        bs.onchange = () => { if (bs.value !== "__custom") { t.brushId = bs.value; t.brushData = null; t.brushName = null; this.trailChanged(); this.syncToolUI(); } };
        const pv = el("canvas", { class: "tm-brush-pv", width: 70, height: 20, title: "左边是拖尾末端，越亮的刷痕伸得越远" });
        pv.style.width = "100%";
        pv.getContext("2d").drawImage(this.toolBrush(t), 0, 0, 70, 20);
        o.append(bs, pv, el("button", { class: "btn small block", title: "导入灰度图作为笔刷：横向 = 拖尾方向，纵向 = 宽度方向", onclick: () => this.importToolBrush() }, "导入笔刷…"));
      }
      check("火花点", "sparks");
    }
    if (!sl) {
      // the old way: straight into pixels, not to be adjusted afterwards
      check("直接画成像素（不能再调）", "toPixels");
      if (t.toPixels) check("画到「特效」图层", "toFxLayer");
    }
    o.append(el("p", { class: "ed-hint" }, t.toPixels || sl
      ? "顺着挥砍方向拖：起点是尾、终点是头。打开洋葱皮逐帧画。"
      : "顺着挥砍方向拖：起点是尾、终点是头。画好的笔触可以再拖它的点改长度、方向和弧度，下一帧接着调。"));
  }

  updateTrailPreview() {
    const d = this.drag;
    if (this.trail.toPixels) {
      const img = rasterizeTrail(d.pts, this.trail, this.doc.w, this.doc.h, this.primary, this.toolBrush());
      this.trailPreview = img ? canvasFromImageData(img) : null;
      d.img = img;
      return;
    }
    // the stroke as it will be kept — a bow from where it started to here —
    // drawn as its stand-in while the pointer moves (render draws it)
    this.trailPreview = null;
    d.key = fitStroke(d.pts, strokePlane(this.strokeDrawTarget().style));
  }

  // A drawn stroke becomes an editable stroke layer (trails/stroke.js): this
  // frame of the selected one when it has none here yet, else a new layer. As
  // 直接画成像素 it is painted onto the 特效 layer, as before.
  commitTrail(d) {
    this.trailPreview = null;
    if (this.trail.toPixels) { if (d.img) this.stampOnFxLayer(d.img, !this.trail.toFxLayer); return; }
    if (!d.key) return;
    const tgt = this.strokeDrawTarget();
    if (tgt.layer) { this.change(() => this.setStrokeKey(tgt.layer, d.key)); return; }
    if (this.tm.active) this.tm.toggle(false);
    const fid = this.doc.frames[this.fi].id;
    this.change(() => { this.li = this.doc.addStrokeLayer(this.li, { style: { ...this.trail }, color: [...this.primary], dissolve: 3, keys: { [fid]: d.key } }); });
    this.newStrokeNext = false;
    this.goLayer(this.li);
    this.app.toast("已画成可调整的笔触「" + this.doc.layers[this.li].name + "」：拖它的点改长度、方向和弧度；到下一帧可以接着调。");
  }

  // What the 拖尾笔 panel edits: the selected stroke layer's look (a copy made
  // when the panel is built, put back by trailChanged), or the brush's own.
  trailTarget() {
    const l = this.strokeLayer();
    if (!l) { this.strokeWork = null; return this.trail; }
    this.strokeWork = { id: l.id, style: { ...TRAIL_DEFAULTS, ...l.stroke.style } };
    return this.strokeWork.style;
  }

  // A change made in the panel: on a stroke layer it goes into the layer (one
  // undo step for a run of changes, like dragging a slider) and becomes the
  // brush's look for the next stroke too; otherwise only the brush's.
  trailChanged() {
    const l = this.strokeLayer(), w = this.strokeWork;
    if (!l || !w || w.id !== l.id) { this.saveTrail(); return; }
    const now = performance.now();
    if (!(this.strokeEditId === l.id && now - (this.strokeEditAt || 0) < 700)) { this.commitFloat(); this.doc.checkpoint(); }
    this.strokeEditAt = now; this.strokeEditId = l.id;
    this.strokeDraftUntil = now + 350;
    clearTimeout(this.strokeSettleTimer);
    this.strokeSettleTimer = setTimeout(() => { this.prefetchVfx(); this.requestRender(); }, 400);
    // squashed or tilted differently, each key's ellipse goes with it
    const p0 = strokePlane(l.stroke.style), p1 = strokePlane(w.style);
    const keys = p0 && p1 && p0.h === p1.h && (p0.s !== p1.s || p0.sin !== p1.sin || p0.cos !== p1.cos) ? replaneKeys(l.stroke.keys || {}, p0, p1) : l.stroke.keys;
    l.stroke = { ...l.stroke, style: { ...w.style }, keys };
    Object.assign(this.trail, w.style);
    this.trail.toPixels = false;
    this.saveTrail();
    this.markDirty();
    this.requestRender();
    clearTimeout(this.strokeThumbTimer);
    this.strokeThumbTimer = setTimeout(() => this.queueThumbs(this.doc.frames.map((_, fi) => fi)), 250);
  }

  // the panel's top on a stroke layer: this frame's state, its bend, length
  // and direction, and what can be done with it
  strokeSection(o, l) {
    const sh = this.strokeShown(l), own = !!(sh && sh.own), lock = this.strokeLockBend;
    o.append(el("div", { class: "ed-opt-title" }, "笔触 · " + l.name));
    const what = !sh ? "这条笔触还没有画过：在画布上画一笔。"
      : own && lock ? "本帧是关键帧：弧度固定在虚线圆上，拖黄点（头）、蓝点（尾）只能沿着这个圆走；拖笔触本身整体移动。"
      : own ? "本帧是关键帧：拖黄点（头）、蓝点（尾）改长度和方向，拖粉点改弧度，拖笔触本身整体移动。"
      : sh.kind === "orbit" ? "本帧由第 " + (sh.from + 1) + " 帧的笔触沿圆转过来（每 " + l.stroke.orbit + " 帧转一圈）。拖它的点就把本帧变成关键帧，之后的帧从这里接着转。"
      : sh.kind === "tween" ? "本帧在第 " + (sh.from + 1) + " 帧和第 " + (sh.to + 1) + " 帧之间，自动过渡。拖它的点就把本帧变成关键帧。"
      : sh.kind === "fade" ? "第 " + (sh.from + 1) + " 帧之后正在消失（" + sh.step + " / " + sh.of + "）。拖虚线的点，本帧就成为关键帧，挥动接着往下。"
      : sh.kind === "gone" ? "已经消失。拖虚线（第 " + (sh.from + 1) + " 帧的样子）的点，本帧就成为关键帧；也可以直接重画。"
      : "还没开始（第 " + (sh.from + 1) + " 帧才出现）。拖虚线的点，本帧就成为关键帧，从这里开始。";
    o.append(el("p", { class: "ed-hint" }, what));
    if (sh) {
      const box = el("input", { type: "checkbox", checked: lock, onchange: () => {
        this.strokeLockBend = box.checked;
        try { localStorage.setItem(LOCK_BEND_KEY, box.checked ? "1" : "0"); } catch { /* private mode */ }
        this.buildTrailPanel(); this.requestRender();
      } });
      o.append(el("label", { class: "ed-check", title: "用当前的弧画一个圆，头尾只能沿着这个圆移动；粉点和弧度、长度、方向滑块不可用" }, box, "固定弧度（头尾沿圆弧移动）"));
    }
    if (sh && (lock || (l.stroke.orbit | 0) >= 2)) this.strokeOrbitSection(o, l, sh);
    if (sh) {
      const r1 = (v) => Math.round(v * 10) / 10, len = (k) => Math.hypot(k.b[0] - k.a[0], k.b[1] - k.a[1]) || 1;
      // the bow as a share of the length it is measured along (the plane's, 拖尾平面)
      const pl = strokePlane(l.stroke.style), blen = (k) => strokeLen(k, pl);
      const k0 = sh.key, L0 = len(k0), A0 = Math.atan2(k0.b[1] - k0.a[1], k0.b[0] - k0.a[0]) * 180 / Math.PI;
      // a slider drag is one undo step; the key starts from the shown one
      const live = (fn) => {
        if (!this.strokeLive) { this.commitFloat(); this.doc.checkpoint(); this.strokeLive = true; }
        this.setStrokeKey(l, fn(this.strokeShown(l).key));
        this.markDirty(); this.requestRender();
      };
      const end = () => { if (this.strokeLive) { this.strokeLive = false; this.afterChange(true); } };
      const slider = (label, min, max, value, unit, apply, off = false) => {
        const val = el("span", { class: "mono" }, Math.round(value) + unit);
        const r = el("input", { type: "range", min, max, value: Math.round(value), disabled: off });
        r.oninput = () => { val.textContent = r.value + unit; live((k) => apply(k, +r.value)); };
        r.onchange = end;
        o.append(el("div", { class: "ed-opt-title" }, label, val), r);
      };
      // past a half circle (100%) in a plane, the bow wraps further round
      slider("弧度", pl ? -200 : -100, pl ? 200 : 100, (k0.bend || 0) / blen(k0) * 100, "%", (k, v) => ({ ...k, bend: r1(v / 100 * blen(k)) }), lock);
      // the tail stays; the head moves out or in (the bow grows with it)
      slider("长度", 2, Math.round(Math.max(this.doc.w, this.doc.h) * 1.5), L0, "px", (k, v) => {
        const sc = v / len(k);
        return { ...k, b: [r1(k.a[0] + (k.b[0] - k.a[0]) * sc), r1(k.a[1] + (k.b[1] - k.a[1]) * sc)], bend: r1((k.bend || 0) * sc) };
      }, lock);
      // the head turns round the tail
      slider("方向", -180, 180, A0, "°", (k, v) => {
        const t = v * Math.PI / 180, L = len(k);
        const nk = { ...k, b: [r1(k.a[0] + Math.cos(t) * L), r1(k.a[1] + Math.sin(t) * L)] };
        // in a plane, turned it is longer or shorter there: the bow keeps its share
        if (pl) nk.bend = r1((k.bend || 0) / blen(k) * blen(nk));
        return nk;
      }, lock);
      // this frame's width, % of the style's 宽度 (in between frames it goes evenly)
      slider("本帧宽度", 10, 300, k0.ws ?? 100, "%", (k, v) => ({ ...k, ws: v }));
    }
    // after its last key: the head stops and the tail catches up, fading
    {
      const d0 = Math.max(0, l.stroke.dissolve | 0);
      const val = el("span", { class: "mono" }, d0 ? d0 + " 帧" : "立即");
      const r = el("input", { type: "range", min: 0, max: 12, value: d0 });
      r.oninput = () => {
        val.textContent = +r.value ? r.value + " 帧" : "立即";
        if (!this.strokeLive) { this.commitFloat(); this.doc.checkpoint(); this.strokeLive = true; }
        l.stroke = { ...l.stroke, dissolve: +r.value };
        this.markDirty(); this.requestRender();
      };
      r.onchange = () => { if (this.strokeLive) { this.strokeLive = false; this.afterChange(true); } };
      o.append(el("div", { class: "ed-opt-title", title: "最后一个关键帧之后，笔触再用几帧消失：头停住、尾巴追上去，同时变淡" }, "消失帧数", val), r);
    }
    const ids = this.doc.frames.map((f) => f.id), fid = ids[this.fi];
    const btn = (label, title, fn) => el("button", { class: "btn small", title, onclick: fn }, label);
    o.append(el("div", { class: "f-buttons" },
      sh && !own ? btn("设为关键帧", sh.kind === "tween" || sh.kind === "orbit" ? "把本帧自动算出的样子定下来，作为关键帧" : "把第 " + (sh.from + 1) + " 帧的样子照搬到本帧，作为关键帧", () => this.change(() => this.setStrokeKey(l, sh.key))) : null,
      own ? btn("删除关键帧", "本帧改回自动：在两个关键帧之间就自动过渡，在最后之后就消失", () => this.change(() => { const keys = { ...l.stroke.keys }; delete keys[fid]; l.stroke = { ...l.stroke, keys }; })) : null,
      btn("用当前主色", "「主色」样式用右下角的主色来画", () => this.change(() => { l.stroke = { ...l.stroke, color: [...this.primary] }; })),
      btn("＋ 新笔触", "下一笔画成一条新的笔触（新图层），而不是改这一条", () => { this.newStrokeNext = true; this.app.toast("下一笔会画成新的笔触。"); }),
      btn("转为像素图层", "把每一帧的笔触画进普通图层，之后可以用画笔手修（不能再调）", () => this.rasterizeStroke())));
    o.append(el("div", { class: "ed-opt-sep" }));
  }

  // 循环旋转: the stroke goes round its circle (an ellipse in a 拖尾平面), a
  // whole turn every so many frames, on every frame without a key of its own
  strokeOrbitSection(o, l, sh) {
    const N = l.stroke.orbit | 0, on = N >= 2, frames = this.doc.frames.length;
    const box = el("input", { type: "checkbox", checked: on, onchange: () => {
      this.change(() => { l.stroke = { ...l.stroke, orbit: box.checked ? Math.max(2, frames) : 0 }; });
      this.buildTrailPanel();
    } });
    o.append(el("label", { class: "ed-check", title: "笔触保持现在的弧，沿着它的圆一直转：每隔「转一圈」帧转完一整圈，没有关键帧的帧都按这个转" }, box, "循环旋转（沿圆一直转）"));
    if (!on) return;
    const val = el("span", { class: "mono" }, N + " 帧");
    const r = el("input", { type: "range", min: 2, max: Math.max(60, frames * 2), value: N });
    r.oninput = () => {
      val.textContent = r.value + " 帧";
      if (!this.strokeLive) { this.commitFloat(); this.doc.checkpoint(); this.strokeLive = true; }
      l.stroke = { ...l.stroke, orbit: +r.value };
      this.markDirty(); this.requestRender();
    };
    r.onchange = () => { if (this.strokeLive) { this.strokeLive = false; this.afterChange(true); this.buildTrailPanel(); } };
    o.append(el("div", { class: "ed-opt-title", title: "转完一整圈用几帧" }, "转一圈", val), r);
    const rev = el("input", { type: "checkbox", checked: !!l.stroke.orbitReverse, onchange: () => this.change(() => { l.stroke = { ...l.stroke, orbitReverse: rev.checked }; }) });
    o.append(el("label", { class: "ed-check", title: "默认顺着尾 → 头的方向转" }, rev, "反向旋转"));
    const straight = !strokeCircle(sh.key, strokePlane(l.stroke.style));
    o.append(el("p", { class: "ed-hint" + (straight ? " warn" : "") }, straight ? "这一帧的笔触是直的，没有圆可转：先让它弯一点。"
      : frames % N === 0 ? "动画 " + frames + " 帧正好转 " + (frames / N) + " 圈，循环播放首尾接得上。"
      : "动画 " + frames + " 帧不是 " + N + " 的整数倍，循环播放时首尾会跳一下；转一圈设成 " + frames + " 帧（或它的约数）就接得上。"));
  }

  // ---------- 拖尾笔 strokes (trails/stroke.js) ----------
  strokeLayer() { const l = this.doc.layers[this.li]; return l && l.stroke ? l : null; }

  // the stroke its handles show on this frame (trails/stroke.js strokeAt): its
  // own key, or the one worked out here — an edit makes that this frame's key
  strokeShown(l) {
    return strokeAt(l.stroke, this.doc.frames.map((f) => f.id), this.fi);
  }

  // this frame's key (inside a checkpoint), rounded to tenths of a pixel; the
  // stroke is replaced, never edited in place (history snapshots share it)
  setStrokeKey(l, k) {
    const r = (v) => Math.round(v * 10) / 10;
    const key = { a: [r(k.a[0]), r(k.a[1])], b: [r(k.b[0]), r(k.b[1])], bend: r(k.bend || 0) };
    if (k.ws != null && Math.round(k.ws) !== 100) key.ws = Math.round(k.ws);
    l.stroke = { ...l.stroke, keys: { ...(l.stroke.keys || {}), [this.doc.frames[this.fi].id]: key } };
  }

  // where a stroke drawn now goes: the selected stroke layer when this frame of
  // it is empty (with its own look), else a new layer with the brush's settings
  strokeDrawTarget() {
    const l = this.strokeLayer(), fid = this.doc.frames[this.fi].id;
    if (l && !this.newStrokeNext && !(l.stroke.keys || {})[fid]) return { layer: l, style: { ...TRAIL_DEFAULTS, ...l.stroke.style }, color: l.stroke.color };
    return { layer: null, style: this.trail, color: [...this.primary] };
  }

  // what of the shown stroke is under q: "a" (tail), "b" (head), "mid" (bend),
  // "all" (the stroke itself) or null
  strokeHit(l, q) {
    const sh = this.strokeShown(l);
    if (!sh) return null;
    const k = sh.key, z = this.zoom, near = (x, y, r) => Math.hypot(q.x - x, q.y - y) * z < r;
    if (near(k.b[0], k.b[1], 10)) return "b";
    if (near(k.a[0], k.a[1], 9)) return "a";
    const pl = strokePlane(l.stroke.style), m = strokeMid(k, pl);
    if (!this.strokeLockBend && near(m.x, m.y, 9)) return "mid";
    const E = this.strokeLockBend && this.strokeEllipseGrips(k, pl);
    if (E) {
      if (near(E.long.x, E.long.y, 8)) return "e-long";
      if (E.short && near(E.short.x, E.short.y, 8)) return "e-short";
      if (near(E.centre.x, E.centre.y, 8)) return "all";
    }
    const w = Math.max(6 / z, keyWidth(l.stroke.style, k) / 2);
    for (const pt of strokePath(k, 24, pl)) if (Math.hypot(q.x - pt.x, q.y - pt.y) < w) return "all";
    return null;
  }

  // the 固定弧度 ellipse's handles as shown: a little way out past its edge,
  // clear of the head and tail (which often sit at the long axis's ends)
  strokeEllipseGrips(k, pl) {
    const E = strokeEllipseHandles(k, pl);
    if (!E) return null;
    const out = (h) => {
      if (!h) return null;
      const dx = h.x - E.centre.x, dy = h.y - E.centre.y, d = Math.hypot(dx, dy) || 1, o = 16 / this.zoom;
      return { x: h.x + dx / d * o, y: h.y + dy / d * o, edge: h };
    };
    return { centre: E.centre, long: out(E.long), short: out(E.short), off: 16 / this.zoom };
  }

  // Dragging the 固定弧度 ellipse's handles (d.base: the key shown when the drag
  // began, d.stroke: the stroke then). The long axis's end: the ellipse that
  // much bigger, and in a plane turned to point at q; the short axis's end: the
  // plane squashed to reach q.
  dragStrokeEllipse(l, d, q) {
    const s0 = d.stroke || (d.stroke = l.stroke), p0 = strokePlane(s0.style), k = d.base;
    const E = this.strokeEllipseGrips(k, p0), C = strokeCircle(k, p0);
    if (!E || !C) return;
    const dx = q.x - E.centre.x, dy = q.y - E.centre.y;
    let style = s0.style;
    if (d.hit === "e-long" && p0) {
      // the long axis is the plane's x (横向) or its y (纵向, pointing up)
      let tilt = Math.atan2(dy, dx) * 180 / Math.PI + (p0.h ? 0 : 90);
      while (tilt > 180) tilt -= 360;
      while (tilt <= -180) tilt += 360;
      style = { ...style, planeTilt: Math.round(tilt) };
    } else if (d.hit === "e-short") {
      // how far along the short axis q is, of the circle's size
      const ax = E.short.x - E.centre.x, ay = E.short.y - E.centre.y, al = Math.hypot(ax, ay) || 1;
      const s = Math.min(1, Math.max(0.05, (Math.abs((dx * ax + dy * ay) / al) - E.off) / C.R));
      style = { ...style, planeSquash: Math.round((1 - s) * 100) };
    }
    const p1 = strokePlane(style);
    const keys = p0 && p1 ? replaneKeys(s0.keys || {}, p0, p1) : { ...(s0.keys || {}) };
    let nk = p0 && p1 ? replaneKeys({ k }, p0, p1).k : k;
    if (d.hit === "e-long") nk = scaleKey(nk, Math.max(2, Math.hypot(dx, dy) - E.off) / C.R, p1);
    l.stroke = { ...s0, style, keys };
    this.setStrokeKey(l, nk);
    Object.assign(this.trail, style);
    this.saveTrail();
  }

  // its path and handles: the head yellow, the tail blue, the bend pink; faint
  // and dashed when they are the last frame's (this one has none yet)
  drawStrokeHandles(g, sh, ox, oy, z, pl = null) {
    const k = sh.key, P = (x, y) => [ox + x * z, oy + y * z];
    g.save();
    g.globalAlpha = sh.own ? 1 : 0.6;
    const path = strokePath(k, pl ? 48 : 32, pl).map((q) => P(q.x, q.y));
    // 固定弧度: the circle the ends move round, faint (squashed in a plane)
    // and its handles: the long axis's end (size, tilt), the short one's
    // (squash), the centre (moves it)
    const ring = this.strokeLockBend && strokeEllipsePath(k, pl);
    if (ring) {
      const E = this.strokeEllipseGrips(k, pl), [ex, ey] = P(E.centre.x, E.centre.y);
      g.save();
      g.globalAlpha = 1;
      g.beginPath(); ring.forEach((q, i) => { const [x, y] = P(q.x, q.y); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
      g.strokeStyle = "rgba(0,0,0,0.45)"; g.lineWidth = 3; g.stroke();
      g.strokeStyle = "rgba(255,255,255,0.75)"; g.lineWidth = 1; g.setLineDash([5, 4]); g.stroke();
      g.setLineDash([2, 3]); g.strokeStyle = "rgba(255,255,255,0.3)";
      for (const h of [E.long, E.short]) if (h) { const [x, y] = P(h.x, h.y); g.beginPath(); g.moveTo(ex, ey); g.lineTo(x, y); g.stroke(); }
      g.setLineDash([]); g.lineWidth = 1.5;
      for (const h of [E.long, E.short]) if (h) { const [x, y] = P(h.x, h.y); g.fillStyle = "#fff"; g.strokeStyle = "#000"; g.fillRect(x - 4, y - 4, 8, 8); g.strokeRect(x - 4, y - 4, 8, 8); }
      g.strokeStyle = "#fff"; g.beginPath(); g.moveTo(ex - 6, ey); g.lineTo(ex + 6, ey); g.moveTo(ex, ey - 6); g.lineTo(ex, ey + 6); g.stroke();
      g.restore();
    }
    for (const [col, lw] of [["rgba(0,0,0,0.7)", 3], ["#fff", 1]]) {
      g.strokeStyle = col; g.lineWidth = lw; g.setLineDash(sh.own ? [] : [5, 4]);
      g.beginPath(); path.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
    }
    const dot = ([x, y], r, fill) => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fillStyle = fill; g.fill(); g.lineWidth = 1.5; g.strokeStyle = "#000"; g.stroke(); };
    dot(P(k.a[0], k.a[1]), 5, "#7fe9ff");
    dot(P(k.b[0], k.b[1]), 7, "#ffd25c");
    // the bend handle, unless 固定弧度
    if (!this.strokeLockBend) {
      g.setLineDash([3, 3]);
      const m = strokeMid(k, pl), [mx, my] = P(m.x, m.y), [cx, cy] = P((k.a[0] + k.b[0]) / 2, (k.a[1] + k.b[1]) / 2);
      g.strokeStyle = "rgba(255,106,213,0.8)"; g.lineWidth = 1;
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(mx, my); g.stroke();
      g.setLineDash([]);
      g.beginPath(); g.moveTo(mx, my - 6); g.lineTo(mx + 6, my); g.lineTo(mx, my + 6); g.lineTo(mx - 6, my); g.closePath();
      g.fillStyle = "#ff6ad5"; g.fill(); g.strokeStyle = "#000"; g.stroke();
    }
    g.restore();
  }

  // 转为像素图层: the stroke drawn into an ordinary layer in its place, every frame
  rasterizeStroke() {
    const l = this.strokeLayer();
    if (!l) return;
    const ids = this.doc.frames.map((f) => f.id), wraps = strokeWraps(l.stroke);
    // every frame of a part of it into the layer at index at
    const paint = (at, part) => {
      for (let fi = 0; fi < ids.length; fi++) {
        const c = createCanvas(this.doc.w, this.doc.h), g = c.getContext("2d");
        drawStrokeLayer(g, l, ids, fi, this.doc.w, this.doc.h, 0, 0, 1, "sync", part);
        const img = g.getImageData(0, 0, this.doc.w, this.doc.h);
        if (!R.isEmpty(img)) this.doc.setCel(fi, at, img);
      }
      this.doc.layers[at].opacity = l.opacity ?? 100;
    };
    this.change(() => {
      let li = this.li;
      this.doc.addLayer(li, l.name);
      paint(li, wraps ? "front" : "all");
      this.doc.deleteLayer(li + 1);
      // 环绕: its far half as a layer of its own at the bottom, as it was drawn
      if (wraps) { this.doc.addLayer(0, l.name + "（后半圈）"); paint(0, "back"); li += 1; }
      this.li = li;
    });
    this.goLayer(this.li);
    this.app.toast("已把笔触画进普通图层「" + l.name + "」" + (wraps ? "（后半圈在最底下的「" + l.name + "（后半圈）」）" : "") + "，现在可以用画笔修改。");
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
    if (structural) this.rebuildTimeline();
    else if (this.doc.layers.some((l) => l.ghost || l.vfx || l.stroke)) {
      // later frames show this one as their ghost; an effect spans several frames
      this.refreshThumb(this.fi);
      this.queueThumbs(this.doc.frames.map((_, fi) => fi).filter((fi) => fi !== this.fi));
    } else this.refreshThumb(this.fi);
    this.syncSide();
    this.prefetchVfx();
    this.requestRender();
  }

  // every frame the effect layers show, rendered ahead in the background (from
  // this frame on), so stepping, playing and the thumbnails find them ready
  prefetchVfx() {
    const ids = this.doc.frames.map((f) => f.id), ctx = this.vfxCtx();
    for (const l of this.doc.layers) if (l.vfx && l.visible !== false) prefetchVfxLayer(l, ids, ctx, this.fi);
    for (const l of this.doc.layers) if (l.stroke && l.visible !== false) prefetchStrokeLayer(l, ids, this.doc.w, this.doc.h, this.fi);
    if (this.doc.layers.some((l) => l.stroke) || this.tool === "trail") warmStrokePreview();
  }

  // is everything the background renders for frame fi (effects, strokes) there?
  frameReady(fi, ids = this.doc.frames.map((f) => f.id), ctx = this.vfxCtx()) {
    return vfxFrameReady(this.doc.layers, ids, fi, ctx) && strokeFrameReady(this.doc.layers, ids, fi, this.doc.w, this.doc.h);
  }

  // a stroke layer's part ("back" / "front", trails/stroke.js 环绕) on this
  // frame: being dragged, its styled preview a moment behind (the plain
  // stand-in before the first); otherwise its frame, or the stand-in for it
  drawStrokeIn(g, l, li, part, frameIds, ox, oy, z, iw, ih) {
    const doc = this.doc;
    if (!this.strokeDrafting(l, li)) { drawStrokeLayer(g, l, frameIds, this.fi, doc.w, doc.h, ox, oy, z, "draft", part); return; }
    const st = strokeAt(l.stroke, frameIds, this.fi);
    if (!strokeShows(st)) return;
    g.save();
    if (!clipStrokePart(g, l.stroke, st.key, part, ox, oy, z, doc.w, doc.h)) { g.restore(); return; }
    if (st.kind === "fade") g.globalAlpha *= Math.pow(1 - st.fade, 0.8);
    const gone = st.kind === "fade" ? st.fade * 0.85 : 0;
    const pv = strokePreview(l.id, l.stroke, st.key, doc.w, doc.h, gone);
    if (pv) g.drawImage(pv, ox, oy, iw, ih); else drawStrokeDraft(g, l.stroke, st.key, ox, oy, z, gone);
    g.restore();
  }

  // a stroke being dragged, or its look changed a moment ago: a stand-in
  // stands for it (the full render follows when it settles)
  strokeDrafting(l, li) {
    if (li !== this.li) return false;
    const d = this.drag;
    return !!((d && d.type === "stroke") || this.strokeLive || performance.now() < (this.strokeDraftUntil || 0));
  }

  undo() {
    // a floating selection is the tail end of the last step: dropping it and
    // undoing restores the pixels it was lifted from
    this.float = null;
    this.drag = null;
    const id = this.layerId();
    if (this.doc.undo()) { this.sel = null; this.keepLayer(id); this.renderPalette(); this.afterChange(); this.tm.refresh(); }
  }

  redo() {
    this.commitFloat();
    const id = this.layerId();
    if (this.doc.redo()) { this.keepLayer(id); this.renderPalette(); this.afterChange(); this.tm.refresh(); }
  }

  // the current layer stays current across undo / redo when it still exists,
  // wherever the step moved it in the stack
  layerId() { const l = this.doc.layers[this.li]; return l ? l.id : null; }
  keepLayer(id) {
    const i = this.doc.layers.findIndex((l) => l.id === id);
    if (i >= 0) this.li = i;
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
    if (l.ghost) { this.app.toast("「" + l.name + "」是残影图层：内容自动来自前几帧，在右侧调设置；要画画请选别的图层。", "warn"); return false; }
    if (l.stroke) { this.app.toast("「" + l.name + "」是拖尾笔笔触：用拖尾笔拖它的点改长度、方向和弧度，设置在右侧；想手修先点右侧「转为像素图层」。", "warn"); return false; }
    if (l.vfx) { this.app.toast("「" + l.name + "」是特效图层：拖动移动、拖四角改大小，设置在右侧；想手修先点右侧「转为像素图层」。", "warn"); return false; }
    return true;
  }

  // does layer li have content on frame fi (pixels, or a trail stick)?
  hasContent(fi, li) {
    const l = this.doc.layers[li];
    if (l && l.trail) {
      const t = this.doc.trails.find((x) => x.id === l.trail);
      return !!(t && t.keys && t.keys[this.doc.frames[fi].id]);
    }
    if (l && l.ghost) return ghostOn(ghostSettings(l), this.doc.frames[fi].id);
    if (l && l.vfx) return vfxFrame(vfxSettings(l), this.doc.frames.map((f) => f.id), fi) >= 0;
    if (l && l.stroke) return strokeShows(strokeAt(l.stroke, this.doc.frames.map((f) => f.id), fi));
    const img = this.doc.cel(fi, li);
    if (!img) return false;
    // remembered per picture and its edit count (R.touch): a long timeline
    // otherwise scans every cel of every frame on every rebuild
    const v = img.__v || 0, hit = emptyCache.get(img);
    if (hit && hit.v === v) return !hit.empty;
    const empty = R.isEmpty(img);
    emptyCache.set(img, { v, empty });
    return !empty;
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
    // the side panel shows this frame's 「本帧」 state: rebuilt once stepping
    // pauses, not on every step of a held key
    if (!this.playing) { clearTimeout(this.sideTimer); this.sideTimer = setTimeout(() => this.syncSide(), 60); }
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
    if (l && l.stroke && this.tool !== "trail") this.setTool("trail");
    this.syncSide(); // a ghost layer shows its settings on the right
    this.requestRender();
  }

  // the right side: the trail panel in trail mode, a ghost or effect layer's
  // settings while one is the current layer, else the colours
  syncSide() {
    this.gp.sync();
    this.vp.sync();
    const l = this.doc.layers[this.li];
    this.colorPanel.style.display = this.tm.active || (l && (l.ghost || l.vfx)) ? "none" : "";
    this.syncToolPanel();
  }

  buildTrailPanel() {
    const l = this.strokeLayer();
    this.trailPanelFor = l ? l.id : "brush";
    this.trailPanel.replaceChildren(el("div", { class: "ed-panel-title" }, l ? "拖尾笔 · 修改「" + l.name + "」" : "拖尾笔"));
    this.trailOptions(this.trailPanel);
  }

  // the trail brush's block shows with the colours: not over the trail mode's
  // panel or a ghost or effect layer's settings
  syncToolPanel() {
    if (!this.trailPanel) return;
    const l = this.doc.layers[this.li];
    const on = this.tool === "trail" && !this.tm.active && !(l && (l.ghost || l.vfx));
    this.trailPanel.style.display = on ? "" : "none";
    const target = l && l.stroke ? l.id : "brush";
    if (on && !this.strokeLive && (target !== "brush" || this.trailPanelFor !== target)) this.buildTrailPanel();
  }

  // ---------- 特效 tool ----------
  saveVfxTool() {
    try { localStorage.setItem(VFX_KEY, JSON.stringify(this.vfxTool)); } catch { /* private mode */ }
  }

  // the left side under the tool: what to do (the settings are on the right)
  vfxOptions(o) {
    o.append(el("button", { class: "btn small block", title: "在当前帧再加一个特效图层", onclick: () => this.newVfx() }, "＋ 新建特效"));
    o.append(el("p", { class: "ed-hint" }, "特效从当前帧开始，参数在右侧：类型、配色、持续帧数等。在画布上拖动特效移动，拖方框四角改大小。"));
  }

  // a new effect on this frame in the middle of the canvas, of the kind and
  // colours used last
  newVfx() {
    const s = Math.max(8, Math.round(Math.min(this.doc.w, this.doc.h) * 0.75));
    this.placeVfx(this.doc.w / 2, this.doc.h / 2, s, s);
  }

  // a new effect layer above the current layer, centred at (x, y), starting on
  // this frame. An aura (环绕光) goes behind the current layer and follows it
  // when that layer has something on this frame.
  placeVfx(x, y, w, h) {
    const v = this.vfxTool;
    const k = VFX_KINDS.find((q) => q.id === v.kind) || VFX_KINDS[0];
    const cur = this.doc.layers[this.li];
    const follow = k.around && cur && !cur.trail && !cur.ghost && !cur.vfx && !cur.stroke && this.hasContent(this.fi, this.li) ? cur.id : null;
    const vfx = {
      ...VFX_LAYER_DEFAULTS, ...k.defaults, kind: k.id, palette: v.palette || k.defaults.palette, style: v.style,
      w: Math.round(w), h: Math.round(h), x: Math.round(x), y: Math.round(y), start: this.doc.frames[this.fi].id,
      follow, seed: 1 + Math.floor(Math.random() * 9973),
    };
    if (this.tm.active) this.tm.toggle(false);
    this.change(() => { this.li = this.doc.addVfxLayer(this.li, vfx, k.name, !!follow); });
    this.goLayer(this.li);
    const n = vfx.loop ? this.doc.frames.length - this.fi : vfx.frames;
    if (!vfx.loop && this.fi + vfx.frames > this.doc.frames.length) {
      this.app.toast("「" + k.name + "」有 " + vfx.frames + " 帧，从第 " + (this.fi + 1) + " 帧开始会超出动画末尾：可以在右侧减少「特效帧数」，或给动画加帧。", "warn");
    } else this.app.toast("已在第 " + (this.fi + 1) + " 帧新建「" + k.name + "」，持续 " + n + " 帧。参数在右侧；在画布上拖动移动，拖四角改大小。");
  }

  // what an effect layer needs to follow another layer: its outline per frame
  vfxCtx(draft = false) {
    return { draft, bbox: (id, j) => layerBBox(this.doc.layers, id, j, this.doc.w, this.doc.h, this.drawCelAt, this.celKey, this.celImage) };
  }

  // the handle of an effect's box under a canvas point: { x, y } with -1 / 1 for
  // the side that moves and 0 for one that doesn't (corners move both), or null
  vfxHandle(l, q) {
    const r = this.vfxRegionNow(l);
    if (r.followed) return null;
    const b = vfxRect(r), z = this.zoom;
    const xs = [[b.x, -1], [b.x + b.w / 2, 0], [b.x + b.w, 1]], ys = [[b.y, -1], [b.y + b.h / 2, 0], [b.y + b.h, 1]];
    for (const [hy, sy] of ys) for (const [hx, sx] of xs) {
      if ((sx || sy) && Math.abs(q.x - hx) * z < 8 && Math.abs(q.y - hy) * z < 8) return { x: sx, y: sy };
    }
    // anywhere along an edge works too
    const inX = q.x > b.x && q.x < b.x + b.w, inY = q.y > b.y && q.y < b.y + b.h;
    if (inY && Math.abs(q.x - b.x) * z < 5) return { x: -1, y: 0 };
    if (inY && Math.abs(q.x - b.x - b.w) * z < 5) return { x: 1, y: 0 };
    if (inX && Math.abs(q.y - b.y) * z < 5) return { x: 0, y: -1 };
    if (inX && Math.abs(q.y - b.y - b.h) * z < 5) return { x: 0, y: 1 };
    return null;
  }

  // show effect layer l (at li) as a quick draft: a slider or a corner of it
  // is moving, or the brush is on the layer it follows (its outline, and so
  // its size, may change with every step of the stroke)
  vfxDrafting(l, li) {
    const d = this.drag;
    if (li === this.li) return this.vp.live || !!(d && d.type === "vfx-size");
    const cur = this.doc.layers[this.li];
    return !!(d && (d.type === "paint" || d.type === "move") && l.vfx.follow && cur && l.vfx.follow === cur.id);
  }

  // an effect layer's region on a frame
  vfxRegionNow(l, fi = this.fi) {
    return vfxRegion(vfxSettings(l), this.doc.frames.map((f) => f.id), fi, this.vfxCtx());
  }

  // set an effect layer's region on this frame — its key when keyed per frame,
  // else the fixed one. Inside a checkpoint; the settings are replaced, never
  // edited in place (history snapshots share them).
  setVfxRegion(l, r) {
    // whole-pixel edges (the centre may fall on a half pixel), so dragging one
    // side never nudges the other
    const x0 = Math.round(r.x - r.w / 2), y0 = Math.round(r.y - r.h / 2);
    const x1 = Math.max(x0 + 4, Math.round(r.x + r.w / 2)), y1 = Math.max(y0 + 4, Math.round(r.y + r.h / 2));
    const v = { x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
    if (vfxSettings(l).perFrame) l.vfx = { ...l.vfx, keys: { ...(l.vfx.keys || {}), [this.doc.frames[this.fi].id]: v } };
    else l.vfx = { ...l.vfx, ...v };
  }

  // 转为像素图层: the effect drawn into an ordinary layer in its place, every frame
  rasterizeVfx() {
    const l = this.doc.layers[this.li];
    if (!l || !l.vfx) return;
    const ids = this.doc.frames.map((f) => f.id);
    this.change(() => {
      const li = this.li;
      this.doc.addLayer(li, l.name);
      for (let fi = 0; fi < ids.length; fi++) {
        const c = createCanvas(this.doc.w, this.doc.h), g = c.getContext("2d");
        drawVfxLayer(g, l, ids, fi, 0, 0, 1, this.vfxCtx());
        const img = g.getImageData(0, 0, this.doc.w, this.doc.h);
        if (!R.isEmpty(img)) this.doc.setCel(fi, li, img);
      }
      this.doc.layers[li].opacity = l.opacity ?? 100;
      this.doc.deleteLayer(li + 1);
      this.li = li;
    });
    this.goLayer(this.li);
    this.app.toast("已把特效画进普通图层「" + l.name + "」，现在可以用画笔修改。");
  }

  // a 残影 layer right below the current layer. It copies the current layer when
  // that is one of several pixel layers (the character, not the effects), else
  // every pixel layer.
  addGhost() {
    const cur = this.doc.layers[this.li];
    const pixel = this.doc.layers.filter((l) => !l.trail && !l.ghost && !l.vfx && !l.stroke);
    const source = cur && !cur.trail && !cur.ghost && !cur.vfx && !cur.stroke && pixel.length > 1 ? cur.id : "all";
    if (this.tm.active) this.tm.toggle(false);
    // only the current frame to begin with: ghosts belong to the fast moments
    this.change(() => { this.li = this.doc.addGhostLayer(this.li, { ...GHOST_DEFAULTS, source, frames: [this.doc.frames[this.fi].id] }); });
    this.goLayer(this.li);
    if (this.doc.frames.length < 2) this.app.toast("残影来自前几帧：动画至少要 2 帧才看得到。", "warn");
    else this.app.toast("已在第 " + (this.fi + 1) + " 帧加入残影。到其他帧再点「残影 ＋」加入，「－」去掉。");
  }

  // the ghost layer 残影 ＋ / － works on: the current layer if it is one, else
  // the one copying the current layer, else one copying every layer
  ghostTarget() {
    const ls = this.doc.layers, cur = ls[this.li];
    if (cur && cur.ghost) return cur;
    return ls.find((l) => l.ghost && cur && l.ghost.source === cur.id) || ls.find((l) => l.ghost && ghostSettings(l).source === "all") || null;
  }

  // 残影 ＋: ghosts on the current frame (a new ghost layer the first time)
  ghostPlus() {
    const l = this.ghostTarget();
    if (!l) { this.addGhost(); return; }
    const id = this.doc.frames[this.fi].id;
    if (ghostOn(ghostSettings(l), id)) { this.app.toast("第 " + (this.fi + 1) + " 帧已经有残影了。", "warn"); return; }
    this.change(() => this.setGhostFrame(l, id, true));
    if (this.fi === 0 && !ghostSettings(l).loop) this.app.toast("第 1 帧前面没有帧，残影要在后面的帧才看得到（或在残影设置里勾「循环动画」）。", "warn");
  }

  // 残影 －: no ghosts on the current frame (from the current ghost layer, or
  // from every ghost layer when a pixel layer is selected)
  ghostMinus() {
    const cur = this.doc.layers[this.li], id = this.doc.frames[this.fi].id;
    const from = (cur && cur.ghost ? [cur] : this.doc.layers.filter((l) => l.ghost)).filter((l) => ghostOn(ghostSettings(l), id));
    if (!from.length) { this.app.toast("第 " + (this.fi + 1) + " 帧没有残影。", "warn"); return; }
    this.change(() => { for (const l of from) this.setGhostFrame(l, id, false); });
  }

  // a ghost layer on / off on one frame (inside a change; the list is replaced,
  // never edited in place, so history snapshots stay exact)
  setGhostFrame(l, frameId, on) {
    const all = this.doc.frames.map((f) => f.id);
    const cur = (Array.isArray(l.ghost.frames) ? l.ghost.frames : all).filter((id) => all.includes(id) && id !== frameId);
    l.ghost.frames = on ? [...cur, frameId] : cur;
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
    // 特效: on the selected effect layer a corner handle resizes it and a drag
    // anywhere else moves it, whatever the tool. With the 特效 tool on another
    // layer, pressing places a new effect there (a drag sets its size).
    const curL = this.doc.layers[this.li];
    if (e.button === 0 && !e.altKey && (this.tool === "vfx" || (curL && curL.vfx))) {
      this.commitFloat();
      const q = this.toFloat(e);
      if (curL && curL.vfx) {
        const r0 = this.vfxRegionNow(curL), hd = this.vfxHandle(curL, q);
        // following a layer, the region is that layer's: nothing to drag
        if (r0.followed) { this.app.toast("这个特效正在跟随图层，位置和大小自动跟着它；想手动调，先在右侧把「跟随图层」改成「不跟随」。", "warn"); return; }
        this.drag = { type: hd ? "vfx-size" : "vfx-move", hd, sx: q.x, sy: q.y, r0, moved: false };
        return;
      }
      this.drag = { type: "vfx-new", x: q.x, y: q.y, r: 0 };
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

    // on a 拖尾笔 stroke layer: its handles — tail, head, bend — or its body move
    // it on this frame (from the last frame's when this one has none yet);
    // pressing anywhere else draws a stroke
    const sl = tool === "trail" && !this.trail.toPixels ? this.strokeLayer() : null;
    if (sl && e.button === 0) {
      const q = this.toFloat(e), hit = this.strokeHit(sl, q);
      if (hit) { this.commitFloat(); this.drag = { type: "stroke", hit, base: this.strokeShown(sl).key, sx: q.x, sy: q.y, moved: false }; return; }
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
    if (!this.drag) {
      const l = this.doc.layers[this.li];
      let cur = "";
      if (l && l.vfx && !this.tm.active) {
        const hd = this.vfxHandle(l, this.toFloat(e));
        cur = hd ? HANDLE_CURSOR[hd.x + "," + hd.y] : "move";
      } else if (l && l.stroke && this.tool === "trail" && !this.trail.toPixels && !this.tm.active) {
        const hit = this.strokeHit(l, this.toFloat(e));
        cur = hit === "all" ? "move" : hit ? "grab" : "";
      }
      if (this.canvas.style.cursor !== cur) this.canvas.style.cursor = cur;
    }
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
      } else if (d.type === "vfx-new") {
        const q = this.toFloat(e);
        d.r = Math.hypot(q.x - d.x, q.y - d.y);
      } else if (d.type === "vfx-move" || d.type === "vfx-size") {
        const q = this.toFloat(e), l = this.doc.layers[this.li];
        if (!d.moved) { this.doc.checkpoint(); d.moved = true; }
        // the settings object is replaced, never edited in place (history snapshots share it)
        const r0 = d.r0;
        if (d.type === "vfx-move") this.setVfxRegion(l, { ...r0, x: r0.x + q.x - d.sx, y: r0.y + q.y - d.sy });
        else this.setVfxRegion(l, resizeBox(r0, d.hd, q, e.shiftKey, e.altKey));
        this.markDirty();
      } else if (d.type === "stroke") {
        const q = this.toFloat(e), l = this.strokeLayer();
        if (l) {
          if (!d.moved) { this.doc.checkpoint(); d.moved = true; }
          const k = d.base, dx = q.x - d.sx, dy = q.y - d.sy, pl = strokePlane(l.stroke.style);
          let nk;
          // the ellipse: its size (and tilt) or its squash — the plane's tilt and
          // squash are the stroke's, so every key goes along with them
          if (d.hit === "e-long" || d.hit === "e-short") { this.dragStrokeEllipse(l, d, q); this.markDirty(); this.requestRender(); this.updateStatus(); return; }
          // 固定弧度: the head or tail slides round the circle of the bow
          if ((d.hit === "a" || d.hit === "b") && this.strokeLockBend) nk = slideOnCircle(k, d.hit, q, pl);
          else if (d.hit === "a") nk = { ...k, a: [q.x, q.y] };
          else if (d.hit === "b") nk = { ...k, b: [q.x, q.y] };
          else if (d.hit === "mid") nk = { ...k, bend: bendAt(k, q, pl) };
          else nk = { ...k, a: [k.a[0] + dx, k.a[1] + dy], b: [k.b[0] + dx, k.b[1] + dy] };
          this.setStrokeKey(l, nk);
          this.markDirty();
        }
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
    // (a new key changes the frames round it too: the timeline is redrawn)
    if (d.type === "stroke") {
      if (d.moved) { this.afterChange(true); if (d.hit === "e-long" || d.hit === "e-short") this.buildTrailPanel(); }
      this.requestRender();
      return;
    }
    if (d.type === "vfx-new") {
      // a click: the tool's size; a drag: from the centre out to a corner
      const box = d.r * this.zoom > 6 ? d.r * 2 : this.vfxTool.box || Math.min(this.doc.w, this.doc.h) * 0.75;
      this.placeVfx(d.x, d.y, Math.max(8, box), Math.max(8, box));
      return;
    }
    if (d.type === "vfx-move" || d.type === "vfx-size") {
      // keyed per frame, the timeline shows the new key
      if (d.moved) this.afterChange(!!vfxSettings(this.doc.layers[this.li]).perFrame);
      return;
    }
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

  composite(fi, onlyReady = false) {
    const c = createCanvas(this.doc.w, this.doc.h);
    const g = c.getContext("2d");
    const doc = this.doc;
    drawFrameStack(g, doc.layers, doc.trails, doc.frames.map((f) => f.id), fi, doc.w, doc.h, this.drawCelAt, this.celKey, { celImage: this.celImage, onlyReady });
    return c;
  }

  // drawFrameStack / renderGhost callbacks: layer l's cel of frame j
  drawCelAt = (l, j, into) => {
    const img = this.doc.cel(j, this.doc.layers.indexOf(l));
    if (img) into.drawImage(celCanvas(img), 0, 0);
  };
  celKey = (l, j) => celToken(this.doc.cel(j, this.doc.layers.indexOf(l)));
  celImage = (l, j) => this.doc.cel(j, this.doc.layers.indexOf(l));

  ghostCanvas(l, fi = this.fi) {
    return renderGhost(l, this.doc.layers, this.doc.frames.map((f) => f.id), fi, this.doc.w, this.doc.h, this.drawCelAt, this.celKey);
  }

  onionLayer(fi, tint) {
    const key = fi + ":" + tint + ":" + this.doc.version;
    let c = this.onionCache.get(key);
    if (c) { this.onionCache.delete(key); this.onionCache.set(key, c); }
    else {
      // the least recently used goes; clearing them all made stepping through
      // a long animation recomposite its neighbours on every step
      while (this.onionCache.size >= 64) this.onionCache.delete(this.onionCache.keys().next().value);
      // an effect still being rendered in the background is left out for now,
      // and this picture isn't kept: it is made again once the effect has come
      const ready = this.frameReady(fi);
      c = this.composite(fi, !ready);
      const g = c.getContext("2d");
      g.globalCompositeOperation = "source-atop";
      g.fillStyle = tint;
      g.globalAlpha = 0.45;
      g.fillRect(0, 0, c.width, c.height);
      if (ready) this.onionCache.set(key, c);
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
    const c = this.canvas, doc = this.doc;
    let g = this.g;
    const dpr = window.devicePixelRatio || 1;
    const W = this.stageSize ? this.stageSize.w : this.stage.clientWidth, H = this.stageSize ? this.stageSize.h : this.stage.clientHeight;
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

    // A ghost layer with 遮挡 cuts its outline out of the layers below it, so
    // the layers are then stacked on a clear canvas of their own and laid over
    // the checkerboard afterwards (cutting into g would cut the checkerboard).
    const outer = g;
    if (doc.layers.some((l) => l.ghost && ghostCovers(l))) {
      if (!this.stackCanvas) this.stackCanvas = createCanvas(1, 1);
      const sc = this.stackCanvas;
      if (sc.width !== c.width || sc.height !== c.height) { sc.width = c.width; sc.height = c.height; }
      g = sc.getContext("2d");
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      g.imageSmoothingEnabled = false;
    }
    // attack trails are layers: sticks marked 角色后方 go under every layer, the
    // rest is drawn at the trail layer's place in the stack
    this.tm.drawBack(g, ox, oy, iw, ih);
    const frameIds = doc.frames.map((f) => f.id);
    // 拖尾笔 strokes going round (环绕): their far half under every layer too
    doc.layers.forEach((l, li) => {
      if (l.visible === false || !l.stroke || !strokeWraps(l.stroke)) return;
      g.globalAlpha = (l.opacity ?? 100) / 100;
      this.drawStrokeIn(g, l, li, "back", frameIds, ox, oy, z, iw, ih);
    });
    g.globalAlpha = 1;
    doc.layers.forEach((l, li) => {
      if (l.visible === false) return;
      g.globalAlpha = (l.opacity ?? 100) / 100;
      if (l.trail) { this.tm.drawLayer(g, l, ox, oy, iw, ih); g.globalAlpha = 1; return; }
      if (l.ghost) { drawGhostCanvas(g, l, this.ghostCanvas(l), ox, oy, iw, ih); g.globalAlpha = 1; return; }
      if (l.vfx) { drawVfxLayer(g, l, frameIds, this.fi, ox, oy, z, this.vfxCtx(this.vfxDrafting(l, li))); g.globalAlpha = 1; return; }
      if (l.stroke) {
        this.drawStrokeIn(g, l, li, "front", frameIds, ox, oy, z, iw, ih);
        g.globalAlpha = 1;
        return;
      }
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
    if (g !== outer) {
      outer.drawImage(this.stackCanvas, 0, 0, W, H);
      g = outer;
    }
    // the trail being drawn shows on top until it is committed to its layer
    if (this.trailPreview) g.drawImage(this.trailPreview, ox, oy, iw, ih);
    if (this.drag && this.drag.type === "trail" && this.drag.key && !this.trail.toPixels) {
      const tgt = this.strokeDrawTarget(), stroke = { style: tgt.style, color: tgt.color };
      const pv = strokePreview("new", stroke, this.drag.key, doc.w, doc.h);
      if (pv) g.drawImage(pv, ox, oy, iw, ih); else drawStrokeDraft(g, stroke, this.drag.key, ox, oy, z);
    }
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

    // the selected effect layer's box with corner handles (fainter on frames it
    // isn't showing on); a new effect's box while it is being dragged out
    // handles: filled on a frame with its own key (or a fixed region), hollow
    // where the region is interpolated; none while it follows a layer
    const box = (x, y, bw, bh, on, solid = true, handles = true) => {
      const sx = Math.round(ox + x * z) + 0.5, sy = Math.round(oy + y * z) + 0.5, sw = Math.round(bw * z), sh = Math.round(bh * z);
      g.globalAlpha = on ? 1 : 0.45;
      g.setLineDash([5, 4]);
      g.strokeStyle = "#000"; g.lineDashOffset = 0; g.strokeRect(sx, sy, sw, sh);
      g.strokeStyle = handles ? "#ffd25c" : "#7fe9ff"; g.lineDashOffset = 5; g.strokeRect(sx, sy, sw, sh);
      g.setLineDash([]);
      if (!handles) { g.globalAlpha = 1; return; }
      const corners = [[sx, sy], [sx + sw, sy], [sx, sy + sh], [sx + sw, sy + sh]];
      const edges = [[sx + sw / 2, sy], [sx + sw / 2, sy + sh], [sx, sy + sh / 2], [sx + sw, sy + sh / 2]];
      for (const [hx, hy, k] of [...corners.map((c) => [...c, 3.5]), ...edges.map((c) => [...c, 2.5])]) {
        g.fillStyle = solid ? "#ffd25c" : "rgba(0,0,0,0.6)"; g.fillRect(hx - k, hy - k, k * 2, k * 2);
        g.strokeStyle = solid ? "#000" : "#ffd25c"; g.strokeRect(hx - k, hy - k, k * 2, k * 2);
      }
      // the move handle in the middle
      const mx = sx + sw / 2, my = sy + sh / 2;
      g.beginPath(); g.arc(mx, my, 7, 0, Math.PI * 2);
      g.fillStyle = "rgba(0,0,0,0.55)"; g.fill();
      g.strokeStyle = "#ffd25c"; g.lineWidth = 1.5; g.stroke(); g.lineWidth = 1;
      g.beginPath(); g.moveTo(mx - 4, my); g.lineTo(mx + 4, my); g.moveTo(mx, my - 4); g.lineTo(mx, my + 4); g.stroke();
      g.globalAlpha = 1;
    };
    const curL = doc.layers[this.li];
    if (curL && curL.vfx && !this.playing) {
      const s = vfxSettings(curL), r = this.vfxRegionNow(curL), b = vfxRect(r);
      box(b.x, b.y, b.w, b.h, vfxFrame(s, frameIds, this.fi) >= 0, !s.perFrame || r.key !== false, !r.followed);
    }
    if (this.drag && this.drag.type === "vfx-new" && this.drag.r * z > 6) {
      const d = this.drag;
      box(d.x - d.r, d.y - d.r, d.r * 2, d.r * 2, true);
    }

    // the selected 拖尾笔 stroke's path and handles
    const stl = this.tool === "trail" && !this.playing && !this.trail.toPixels ? this.strokeLayer() : null;
    if (stl) { const sh = this.strokeShown(stl); if (sh) this.drawStrokeHandles(g, sh, ox, oy, z, strokePlane(stl.stroke.style)); }

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
          if (this.doc.layers[this.li].ghost || this.doc.layers[this.li - 1].ghost) { this.app.toast("残影图层不能合并：它的内容是自动生成的。", "warn"); return; }
          this.change(() => { this.doc.mergeDown(this.li); this.li--; });
        })),
      el("span", { class: "tl-sep" }),
      el("span", { class: "tl-group" }, "残影",
        b("＋", "当前帧加入残影：重复前几帧的画面，做冲刺、快速挥动的残影（第一次会在当前图层下方新建残影图层）", () => this.ghostPlus()),
        b("－", "去掉当前帧的残影", () => this.ghostMinus())),
      el("span", { class: "tl-sep" }),
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
      const kind = l.trail ? "trail" : l.ghost ? "ghost" : l.vfx ? "vfx" : l.stroke ? "stroke" : "";
      const name = el("span", { class: "tl-name" + (kind ? " " + kind : "") }, (l.trail ? "☄ " : l.ghost ? "◌ " : l.vfx ? "✦ " : l.stroke ? "〜 " : "") + l.name);
      const head = el("div", { class: "tl-lhead", dataset: { li } }, eye, lock, name);
      head.addEventListener("click", () => this.goLayer(li));
      head.addEventListener("dblclick", () => {
        const n = prompt("图层名称", l.name);
        if (n && n.trim()) this.change(() => { this.doc.layers[li].name = n.trim(); });
      });
      g.append(head);
      doc.frames.forEach((f, fi) => {
        const keyed = (l.vfx && l.vfx.perFrame && l.vfx.keys && l.vfx.keys[f.id]) || (l.stroke && l.stroke.keys && l.stroke.keys[f.id]);
        const cell = el("div", { class: "tl-cel" + (this.hasContent(fi, li) ? " has" : "") + (kind ? " " + kind : "") + (keyed ? " key" : ""), dataset: { fi, li } }, el("i"));
        cell.addEventListener("click", () => { this.goLayer(li); this.goFrame(fi); });
        g.append(cell);
      });
    }
    // the current frame's thumbnail now, the rest a few at a time
    this.thumbQ = [];
    this.refreshThumb(this.fi, true);
    this.queueThumbs(doc.frames.map((_, fi) => fi).filter((fi) => fi !== this.fi));
    this.syncTimelineSel();
  }

  // Thumbnails redrawn between frames, a few milliseconds' worth at a time:
  // compositing every frame at once (effects, ghosts and all) stalls the editor
  // for a moment after every change.
  // One whose effect frames are still being rendered in the background waits
  // for them (onVfxReady puts it back) rather than rendering them here.
  queueThumbs(list) {
    const q0 = this.thumbQ || (this.thumbQ = []);
    for (const fi of list) if (!q0.includes(fi)) q0.push(fi);
    if (this.thumbTimer || !q0.length) return;
    const step = () => {
      const q = this.thumbQ, t0 = performance.now();
      const ids = this.doc.frames.map((f) => f.id), ctx = this.vfxCtx();
      while (q.length && performance.now() - t0 < 6) {
        const fi = q.shift();
        if (fi >= ids.length) continue;
        if (!this.frameReady(fi, ids, ctx)) { (this.thumbWait || (this.thumbWait = new Set())).add(fi); continue; }
        this.refreshThumb(fi);
      }
      this.thumbTimer = q.length ? setTimeout(step, 16) : 0;
    };
    this.thumbTimer = setTimeout(step, 16);
  }

  refreshThumb(fi, noCelUpdate) {
    const th = this.thumbs && this.thumbs[fi];
    if (!th) return;
    if (!this.frameReady(fi)) { (this.thumbWait || (this.thumbWait = new Set())).add(fi); this.prefetchVfx(); return; }
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
