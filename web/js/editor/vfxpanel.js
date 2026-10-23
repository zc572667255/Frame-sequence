// The 特效 panel: settings of the selected effect layer (vfx/layer.js), shown on
// the right in place of the colours while an effect layer is the current layer.
// Where and how big it is can also be set on the canvas (drag it, or a corner).
import { el } from "../core/util.js";
import { VFX_KINDS, VFX_DEFAULTS, VFX_PALETTES, VFX_EDGES as EDGES, hasSide } from "../vfx/effects.js";
import { vfxSettings, renderVfxAsync } from "../vfx/layer.js";
import { ACCENTS, ACC_MODES, autoAccents } from "../vfx/accents.js";
import { GLOW_PRESETS } from "../trails/glow.js";
import { GROUND_AURAS } from "../vfx/kinds/auras.js";

const GROUND = new Set(["shock", "dust", "circle", "heal"]);

// a kind's picture for the type grid: one telling frame, rendered in the
// background (the card shows empty until it comes) and kept
const thumbs = new Map(); // key -> the picture, or a Promise of it
const THUMB_FRAME = { hit: 1, explosion: 3, shock: 3, dust: 4, charge: 2, circle: 0, heal: 0, aura: 0, burn: 0, ribbon: 0 };
function vfxThumb(kind, palette, style) {
  const key = kind.id + ":" + palette + ":" + style;
  const c = el("canvas", { class: "trail-thumb vfx-thumb" + (style === "pixel" ? " px" : ""), width: 48, height: 48 });
  const draw = (src) => c.getContext("2d").drawImage(src, (48 - src.width) / 2, 0);
  let got = thumbs.get(key);
  if (!got) {
    const tall = kind.id === "aura" || kind.id === "burn";
    got = renderVfxAsync({ ...VFX_DEFAULTS, ...kind.defaults, kind: kind.id, palette, style, pxSize: 1, w: tall ? 36 : 48, h: 48, size: 90 }, THUMB_FRAME[kind.id] || 0)
      .then((src) => { thumbs.set(key, src); return src; });
    thumbs.set(key, got);
  }
  if (got instanceof Promise) got.then(draw); else draw(got);
  return c;
}

export class VfxPanel {
  constructor(ed) {
    this.ed = ed;
    this.panel = el("div", { class: "tm-panel", style: { display: "none" } });
    this.shown = false;
    this.live = false; // a slider drag already took its undo checkpoint
  }

  get doc() { return this.ed.doc; }
  layer() { const l = this.doc.layers[this.ed.li]; return l && l.vfx ? l : null; }

  sync() {
    const on = !!this.layer();
    if (on !== this.shown) {
      this.shown = on;
      this.panel.style.display = on ? "" : "none";
    }
    if (on) this.refresh();
  }

  // the next new effect starts like this one
  remember() {
    const s = vfxSettings(this.layer());
    Object.assign(this.ed.vfxTool, { kind: s.kind, palette: s.palette, style: s.style });
    this.ed.saveVfxTool();
  }

  // a new type brings its own colours, length and looping. One that wraps a
  // figure (环绕光) wraps the nearest layer with something on this frame and
  // goes behind it.
  pickKind(k) {
    const ed = this.ed, layers = this.doc.layers;
    const l = this.layer(), li = ed.li;
    ed.change(() => {
      const v = { ...l.vfx, kind: k.id, ...k.defaults };
      if (!k.side) v.view = "front";
      // a layer still named after its type takes the new type's name
      if (VFX_KINDS.some((x) => l.name === x.name || l.name.startsWith(x.name + " "))) l.name = k.name;
      if (k.around && !v.follow) {
        const order = [...layers.keys()].filter((i) => i > li).concat([...layers.keys()].filter((i) => i < li).reverse());
        const t = order.find((i) => { const o = layers[i]; return !o.trail && !o.ghost && !o.vfx && ed.hasContent(ed.fi, i); });
        if (t != null) {
          v.follow = layers[t].id;
          if (li > t) { layers.splice(li, 1); layers.splice(t, 0, l); ed.li = t; }
        }
      }
      l.vfx = v;
    });
    this.remember();
  }

  // settings objects are replaced, never edited in place (history snapshots share
  // them). structural: the timeline changes too (its key marks)
  edit(patch, structural = false) {
    this.ed.commitFloat();
    this.doc.checkpoint();
    const l = this.layer();
    l.vfx = { ...l.vfx, ...(typeof patch === "function" ? patch(vfxSettings(l)) : patch) };
    this.ed.afterChange(structural);
  }

  liveEdit(patch) {
    if (!this.live) { this.ed.commitFloat(); this.doc.checkpoint(); this.live = true; }
    const l = this.layer();
    l.vfx = { ...l.vfx, ...patch };
    this.ed.markDirty();
    this.ed.requestRender();
  }

  // the region on this frame (a key when keyed per frame, else the fixed one)
  editRegion(patch) {
    this.ed.commitFloat();
    this.doc.checkpoint();
    const l = this.layer();
    this.ed.setVfxRegion(l, { ...this.ed.vfxRegionNow(l), ...patch });
    this.ed.afterChange(!!l.vfx.perFrame);
  }

  liveRegion(patch) {
    if (!this.live) { this.ed.commitFloat(); this.doc.checkpoint(); this.live = true; }
    const l = this.layer();
    this.ed.setVfxRegion(l, { ...this.ed.vfxRegionNow(l), ...patch });
    this.ed.markDirty();
    this.ed.requestRender();
  }

  endLive(structural = false) {
    if (!this.live) return;
    this.live = false;
    this.ed.afterChange(structural && !!vfxSettings(this.layer()).perFrame);
  }

  refresh() {
    const l = this.layer();
    const P = this.panel;
    P.replaceChildren();
    if (!l) return;
    const s = vfxSettings(l);
    const ids = this.doc.frames.map((f) => f.id);
    const row = (label, ...kids) => { const r = el("div", { class: "tm-row" }, el("span", { class: "tm-label" }, label), ...kids); P.append(r); return r; };
    const slider = (label, key, min, max, unit, title, fmt) => {
      const show = (v) => (fmt ? fmt(v) : v + unit);
      const val = el("span", { class: "mono tm-num" }, show(s[key]));
      const r = el("input", { type: "range", min, max, value: s[key] });
      r.oninput = () => { this.liveEdit({ [key]: +r.value }); val.textContent = show(+r.value); };
      r.onchange = () => this.endLive();
      row(label, r, val).title = title || "";
    };
    const choose = (label, key, options, onPick) => {
      const sel = el("select", { class: "ed-select" }, ...options.map(([v, n]) => el("option", { value: String(v), selected: String(s[key]) === String(v) }, n)));
      sel.onchange = () => {
        const v = typeof options[0][0] === "number" ? +sel.value : sel.value;
        this.edit(onPick ? onPick(v) : { [key]: v });
      };
      row(label, sel, el("span"));
    };
    const btn = (label, title, fn, primary) => el("button", { class: "btn small" + (primary ? " primary" : ""), title, onclick: fn }, label);

    P.append(el("div", { class: "ed-panel-title" }, "特效 · " + l.name,
      el("span", { class: "spacer" }),
      el("button", { class: "tool-btn", title: "在当前帧再加一个特效图层", onclick: () => this.ed.newVfx() }, "＋ 新特效")));
    // 像素 / 高清, then the kinds as small pictures
    const setStyle = (v) => { if (s.style !== v) { this.edit({ style: v }); this.remember(); } };
    P.append(el("div", { class: "trail-kind" },
      el("button", { class: s.style === "hd" ? "on" : "", title: "平滑发光的高清特效", onclick: () => setStyle("hd") }, "高清"),
      el("button", { class: s.style === "pixel" ? "on" : "", title: "像素画：颜色吸附到配色的色板", onclick: () => setStyle("pixel") }, "像素")));
    const grid = el("div", { class: "trail-presets" });
    for (const k of VFX_KINDS) {
      grid.append(el("button", { class: "trail-preset" + (s.kind === k.id ? " on" : ""), title: k.help,
        onclick: () => { if (s.kind !== k.id) this.pickKind(k); } },
        vfxThumb(k, s.kind === k.id ? s.palette : k.defaults.palette, s.style), el("span", null, k.name)));
    }
    P.append(grid);
    choose("配色", "palette", VFX_PALETTES, (v) => { queueMicrotask(() => this.remember()); return { palette: v }; });
    if (s.style === "pixel") {
      choose("像素", "pxSize", [[1, "1 px"], [2, "2 px"], [3, "3 px"], [4, "4 px"]]);
      choose("透明", "pxAlpha", [["steps", "4 级透明"], ["dither", "抖动（全实心）"], ["hard", "硬边"]]);
    }

    // where and how big: following a layer, keyed frame by frame, or fixed
    P.append(el("div", { class: "ed-panel-title" }, "画幅框（位置与大小）"));
    // past the canvas, what is out there isn't shown (or exported)
    {
      const r = this.ed.vfxRegionNow(l), W = this.doc.w, H = this.doc.h;
      const over = { 上: -(r.y - r.h / 2), 下: r.y + r.h / 2 - H, 左: -(r.x - r.w / 2), 右: r.x + r.w / 2 - W };
      const sides = Object.entries(over).filter(([, v]) => v > 2).map(([k, v]) => k + " " + Math.round(v) + "px");
      if (sides.length) P.append(el("p", { class: "ed-hint warn" }, "画幅框超出画布（" + sides.join("，") + "），超出的部分不会显示也不会导出。可以用顶部「画布尺寸…」把画布加大" + (s.follow ? "，或减小「外扩」。" : "，或把画幅框缩小、挪回画布里。")));
    }
    const pixelLayers = this.doc.layers.filter((o) => !o.trail && !o.ghost && !o.vfx && !o.stroke);
    choose("跟随图层", "follow", [["", "不跟随"], ...pixelLayers.map((o) => [o.id, o.name])], (v) => ({ follow: v || null }));
    const here = this.ed.fi;
    if (s.follow) {
      slider("外扩", "pad", 0, 150, "%", "特效区域比图层的轮廓大多少（按轮廓较长的一边算）");
      P.append(el("p", { class: "ed-hint" }, "特效每一帧都套住「" + ((pixelLayers.find((o) => o.id === s.follow) || {}).name || "?") + "」的轮廓，角色走到哪、变多大，特效就跟到哪。"));
    } else {
      const r = this.ed.vfxRegionNow(l);
      const maxSize = Math.max(64, Math.min(1024, Math.max(this.doc.w, this.doc.h) * 2));
      const regionSlider = (label, prop, min, max, title) => {
        const val = el("span", { class: "mono tm-num" }, Math.round(r[prop]) + "");
        const input = el("input", { type: "range", min, max, value: Math.round(r[prop]) });
        input.oninput = () => { this.liveRegion({ [prop]: +input.value }); val.textContent = input.value; };
        input.onchange = () => this.endLive(true);
        row(label, input, val).title = title || "";
      };
      regionSlider("宽", "w", 4, maxSize, "画幅框的宽；也可以在画布上拖画幅框的边或角（Shift 保持比例，Alt 以中心缩放）");
      regionSlider("高", "h", 4, maxSize);
      regionSlider("X", "x", 0, this.doc.w, "特效区域中心；也可以在画布上拖中间的圆点");
      regionSlider("Y", "y", 0, this.doc.h);
      const per = el("input", { type: "checkbox", checked: !!s.perFrame, onchange: () => {
        // on: the present region becomes the first key; off: the region on
        // this frame becomes the fixed one and the keys go
        if (per.checked) this.edit({ perFrame: true, keys: { [ids[here]]: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) } } }, true);
        else this.edit({ perFrame: false, keys: null, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) }, true);
      } });
      P.append(el("label", { class: "ed-check" }, per, "逐帧调整（每帧单独设位置和大小，中间的帧自动过渡）"));
      if (s.perFrame) {
        const keys = s.keys || {};
        const n = ids.filter((id) => keys[id]).length;
        const isKey = !!keys[ids[here]];
        row("本帧", el("span", { class: "mono" }, isKey ? "◆ 关键帧" : "◇ 自动过渡"),
          isKey && n > 1 ? btn("删除", "删除本帧的关键帧，改为由前后关键帧过渡", () => this.edit((v) => { const k = { ...v.keys }; delete k[ids[here]]; return { keys: k }; }, true)) : el("span"));
        P.append(el("p", { class: "ed-hint" }, "共 " + n + " 个关键帧。在某一帧拖动或拉伸特效，这一帧就成为关键帧；没设的帧在前后关键帧之间平滑过渡。"));
      }
      row("", el("div", { class: "tm-colors" },
        btn("居中", "放到画布正中", () => this.editRegion({ x: this.doc.w / 2, y: this.doc.h / 2 }))), el("span"));
    }

    // when
    P.append(el("div", { class: "ed-panel-title" }, "时间"));
    const st = Math.max(0, ids.indexOf(s.start));
    row("开始", el("span", { class: "mono" }, "第 " + (st + 1) + " 帧"),
      btn("从本帧开始", "让特效从当前帧开始", () => this.edit({ start: ids[here] }), st !== here));
    slider("特效帧数", "frames", 2, 48, " 帧", "特效本身有几帧：越多播得越慢、越细");
    const loop = el("input", { type: "checkbox", checked: !!s.loop, onchange: () => this.edit({ loop: loop.checked }) });
    P.append(el("label", { class: "ed-check" }, loop, "循环播放（蓄力、魔法阵、治疗光圈这类持续的特效）"));
    slider("持续", "length", 0, Math.max(1, ids.length - st), " 帧", "特效在动画里出现几帧；0 = 自动（不循环：播完为止；循环：到最后一帧）",
      (v) => (v ? v + " 帧" : "自动"));

    // look
    P.append(el("div", { class: "ed-panel-title" }, "效果"));
    slider("特效大小", "size", 20, 100, "%", "特效在画幅框里占多大：画幅框不变，只缩放特效（超出画幅框的部分会被裁掉）");
    slider("粒子", "amount", 0, 200, "%");
    slider("辉光", "glow", 0, 150, "%");
    if (hasSide(s.kind)) choose("视角", "view", [["front", "正面"], ["side", "侧面"]]);
    slider("旋转", "rotate", -180, 180, "°", "整个特效绕中心转动（转出画幅框的部分会被裁掉，可以把画幅框拉大）");
    if (GROUND.has(s.kind)) slider("地面倾斜", "tilt", 0, 80, "°", "0° 是从正上方看，越大越扁，像放在地上；侧面视角时 0° 是正对着，越大越侧过去");
    if (s.kind === "circle") {
      choose("法阵图案", "pattern", [["hex", "六芒星"], ["penta", "五芒星"], ["square", "双方形（八角）"], ["taiji", "太极八卦"], ...GROUND_AURAS]);
      choose("边缘特效", "edge", EDGES);
    }
    if (s.kind === "aura") {
      const bolts = el("input", { type: "checkbox", checked: !!s.bolts, onchange: () => this.edit({ bolts: bolts.checked }) });
      P.append(el("label", { class: "ed-check" }, bolts, "带闪电（超级赛亚人 2 那样在斗气上窜动）"));
    }
    // 光效点缀: the trails' accents over it — the palette's own mix, none, or
    // each set by hand (starting from the palette's mix)
    P.append(el("div", { class: "ed-panel-title" }, "光效点缀（来自拖尾）"));
    const preset = GLOW_PRESETS.find((x) => x.id === s.palette) || GLOW_PRESETS[0];
    const auto = autoAccents(preset), mode = s.acc || "auto";
    choose("点缀", "acc", ACC_MODES, (v) => (v === "custom" && mode !== "custom" ? { acc: v, ...auto } : { acc: v }));
    if (mode === "auto") {
      const names = ACCENTS.filter((a) => auto["acc_" + a.id] > 0).map((a) => a.name);
      P.append(el("p", { class: "ed-hint" }, names.length
        ? "「" + preset.name + "」配色带：" + names.join("、") + "，和同名拖尾一样。想单独调就选「自定义」。"
        : "「" + preset.name + "」配色没有点缀，可以选「自定义」自己加。"));
    } else if (mode === "custom") for (const a of ACCENTS) slider(a.name, "acc_" + a.id, 0, 100, "%");

    row("", el("div", { class: "tm-colors" },
      btn("换一个随机样子", "同样的设置，换一组随机细节", () => this.edit({ seed: (s.seed % 9973) + 1 + Math.floor(Math.random() * 500) })),
      btn("转为像素图层", "把每一帧的特效画进一个普通图层，之后可以用画笔手修（不再能调特效设置）", () => this.ed.rasterizeVfx())), el("span"));
    P.append(el("p", { class: "ed-hint" }, "在画布上拖动特效移动位置；拖画幅框的边或角改变大小（对边不动，Shift 保持比例，Alt 以中心缩放）。特效图层可以用 ↑ ↓ 移到角色前面或后面。"));
  }
}
