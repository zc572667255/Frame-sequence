// 攻击拖尾模式 inside the pixel editor.
//
// One stick per frame. On the first frame of a swing, drag on the canvas to draw
// the stick (press = inner end near the hilt, release = outer end at the blade
// tip): its length is the trail's width. On each following frame the stick is
// carried over from the previous one — move it (drag the body) or reshape it
// (drag an end) to follow the weapon. Each frame's trail is generated from the
// sticks of the last few frames.
//
// Every trail is a layer (layers[i].trail = trail id), created with the trail:
// its place in the stack is its depth, its eye / lock / opacity apply as usual.
import { el, uid, blobToCanvas, canvasToBlob } from "../core/util.js";
import { putBlobAsset, getAssetCanvas } from "../core/assets.js";
import { showMenu } from "../ui/menu.js";
import { STYLE_DEFAULTS, BUILTIN_PRESETS, BUILTIN_BRUSHES, SHAPES, newTrail, normalizeTrail, trailState, stickReversed } from "../trails/model.js";
import { trailCanvas, textureFor, brushFor, loadTextures, setTexture, drawTrail } from "../trails/composite.js";
import { TRAIL_PRESETS, BAND_LOOK } from "./trailbrush.js";
import { GLOW_PRESETS, GLOW_DEFAULTS, glowStyle } from "../trails/glow.js";
import { styleThumb } from "./thumbs.js";

// a new trail starts as the 梦幻 glow; the pixel bands are one click away
const NEW_TRAIL_STYLE = { ...STYLE_DEFAULTS, colorMode: "glow", pixel: false, fade: 0.7, ...glowStyle(GLOW_PRESETS[0]) };

export class TrailMode {
  constructor(ed) {
    this.ed = ed;
    this.active = false;
    this.selId = null;
    this.showSticks = true;   // 棍: stick handles
    this.showPath = true;     // 轨: earlier frames' sticks and the tip path
    this.carry = true;        // going to the next frame copies the stick over
    this.openGroups = new Set(); // panel: which ▸ detail groups are open
    this.drag = null;
    this.live = false;        // a slider drag already took its undo checkpoint
    this.panel = el("div", { class: "tm-panel" });
    this.toggles = this.buildToggles();
  }

  get doc() { return this.ed.doc; }
  frameIds() { return this.doc.frames.map((f) => f.id); }
  frameId(fi = this.ed.fi) { const f = this.doc.frames[fi]; return f && f.id; }

  trail() {
    const list = this.doc.trails;
    const cur = this.doc.layers[this.ed.li];
    if (cur && cur.trail) this.selId = cur.trail;
    return list.find((t) => t.id === this.selId) || list[0] || null;
  }

  // make the trail's layer the current layer
  focusLayer(t) {
    const i = t ? this.doc.trailLayerIndex(t.id) : -1;
    if (i >= 0 && i !== this.ed.li) { this.ed.li = i; this.ed.syncTimelineSel(); }
  }

  key(t = this.trail(), fi = this.ed.fi) { return t && t.keys ? t.keys[this.frameId(fi)] || null : null; }

  // the nearest earlier frame's stick, shown as a guide when this frame has none.
  // A segment with no earlier stick of its own borrows the latest one of the
  // other segments: the next cut of a combo starts where the last one ended.
  ghost(t = this.trail()) {
    if (!t) return null;
    for (let i = this.ed.fi - 1; i >= 0; i--) { const k = t.keys[this.frameId(i)]; if (k) return k; }
    for (let i = this.ed.fi; i >= 0; i--) {
      const id = this.frameId(i);
      for (const o of this.doc.trails) if (o !== t && o.keys && o.keys[id]) return o.keys[id];
    }
    return null;
  }

  // ---------- on / off ----------
  toggle(on = !this.active) {
    this.active = on;
    if (on) {
      this.ed.commitFloat();
      if (!this.doc.trails.length) this.addTrail(NEW_TRAIL_STYLE, true);
      else this.focusLayer(this.trail());
    }
    this.ed.colorPanel.style.display = on ? "none" : "";
    this.panel.style.display = on ? "" : "none";
    this.toggles.style.display = on ? "" : "none";
    this.ed.trailBtn.classList.toggle("primary", on);
    // while the canvas edits sticks, no drawing tool is "active"
    for (const id in this.ed.toolBtns) this.ed.toolBtns[id].classList.toggle("active", !on && id === this.ed.tool);
    this.ensureTextures();
    this.refresh();
    this.ed.requestRender();
    if (on) this.ed.app.toast("在开始帧拖出一根棍子（按下 = 内端，松开 = 刀尖），再逐帧移动或拉伸它。");
  }

  ensureTextures() {
    const pid = this.ed.app.store.projectId;
    loadTextures(this.doc.trails, (aid) => getAssetCanvas(pid, aid)).then(() => this.ed.requestRender());
  }

  buildToggles() {
    const mk = (label, title, key) => {
      const b = el("button", { class: "tool-btn active", title }, label);
      b.onclick = () => { this[key] = !this[key]; b.classList.toggle("active", this[key]); this.ed.requestRender(); };
      return b;
    };
    return el("div", { class: "tm-toggles", style: { display: "none" } },
      mk("棍", "显示 / 隐藏棍子手柄", "showSticks"),
      mk("轨", "显示 / 隐藏前几帧的棍子和刀尖轨迹（不影响拖尾本身）", "showPath"));
  }

  // called by the editor when the frame changes: carry the stick forward
  // Only 下一帧 → / N carries the stick: that means "keep drawing this swing".
  // Browsing frames (, . or the timeline) must not, or every frame after the peak
  // would get a copy and the trail could never dissolve.
  onFrameChange(prevFi) {
    if (!this.active || !this.carry || !this.carrying) return;
    const t = this.trail();
    if (!t || this.key(t) || prevFi == null || this.ed.fi !== prevFi + 1) return;
    const prev = t.keys[this.frameId(prevFi)];
    if (!prev) return;
    this.edit(() => { t.keys[this.frameId()] = JSON.parse(JSON.stringify(prev)); });
  }

  // ---------- undoable edits ----------
  edit(fn, structural) {
    this.ed.commitFloat();
    this.doc.checkpoint();
    fn();
    this.ed.afterChange(!!structural);
    this.refresh();
  }

  liveEdit(fn) {
    if (!this.live) { this.ed.commitFloat(); this.doc.checkpoint(); this.live = true; }
    fn();
    this.ed.markDirty();
    this.ed.requestRender();
  }
  endLive() {
    if (!this.live) return;
    this.live = false;
    this.ed.afterChange(false);
  }

  // first and last frame index with a stick, or null
  range(t) {
    const ids = this.frameIds();
    let a = -1, b = -1;
    ids.forEach((id, i) => { if (t.keys && t.keys[id]) { if (a < 0) a = i; b = i; } });
    return a < 0 ? null : [a, b];
  }

  // a new segment of a combo (第 2 段, 第 3 段 …): same look and timing as the
  // current one, its own layer right above the current one. The swing's
  // direction and arc start fresh — the next cut usually goes another way.
  newSegment(from, name) {
    const t = newTrail(uid("T"), name || "第 " + (this.doc.trails.length + 1) + " 段", from ? from.style : NEW_TRAIL_STYLE);
    if (from) for (const k of ["length", "dissolve", "rotate", "smooth", "flip"]) t[k] = from[k];
    return t;
  }

  // a new trail always comes with its own layer, right above the current one
  addTrail(style, quiet) {
    const t = this.newSegment(null);
    t.style = JSON.parse(JSON.stringify(style || NEW_TRAIL_STYLE));
    this.selId = t.id;
    this.edit(() => { this.ed.li = this.doc.addTrailLayer(this.ed.li, t); }, true);
    if (!quiet) this.ed.app.toast("已新建拖尾图层「" + t.name + "」。在开始帧拖出一根棍子。");
  }

  // ＋ 下一段: the next cut of a combo. Starts on the frame after the current
  // segment's last stick (when we're still inside it), where that stick shows as
  // a dashed guide to drag from.
  addNextSegment() {
    const prev = this.trail();
    const t = this.newSegment(prev);
    this.selId = t.id;
    this.edit(() => { this.ed.li = this.doc.addTrailLayer(prev ? Math.max(this.ed.li, this.doc.trailLayerIndex(prev.id)) : this.ed.li, t); }, true);
    const r = prev && this.range(prev);
    if (r && this.ed.fi <= r[1] && r[1] + 1 < this.doc.frames.length) this.ed.goFrame(r[1] + 1);
    this.ed.app.toast("已新建「" + t.name + "」。拖动虚线（上一段最后的棍子）从那里接着挥，或在空白处重新画。");
  }

  // 从这帧拆开: the sticks from this frame on become a new segment, so the first
  // part ends (and dissolves) here instead of sweeping straight into the next cut
  splitHere() {
    const t = this.trail();
    if (!t) return;
    const ids = this.frameIds(), fi = this.ed.fi;
    const after = ids.slice(fi).filter((id) => t.keys[id]);
    if (!after.length || !ids.slice(0, fi).some((id) => t.keys[id])) { this.ed.app.toast("这一帧前后都要有棍子才能拆开。", "warn"); return; }
    const nt = this.newSegment(t);
    for (const p of ["turn", "bow", "plane", "squash", "tilt", "autoDepth"]) nt[p] = t[p];
    this.edit(() => {
      for (const id of after) { nt.keys[id] = t.keys[id]; delete t.keys[id]; }
      this.ed.li = this.doc.addTrailLayer(this.doc.trailLayerIndex(t.id), nt);
      this.selId = nt.id;
    }, true);
    this.ed.app.toast("已从第 " + (fi + 1) + " 帧拆成「" + nt.name + "」。前一段在这里收尾消散。", "ok");
  }

  removeTrail() {
    const t = this.trail();
    if (!t || !confirm("删除拖尾「" + t.name + "」和它的图层？（可以撤销）")) return;
    this.edit(() => {
      const i = this.doc.trailLayerIndex(t.id);
      if (i >= 0) this.doc.layers.splice(i, 1);
      this.doc.trails = this.doc.trails.filter((x) => x.id !== t.id);
      this.ed.li = Math.max(0, Math.min(this.ed.li, this.doc.layers.length - 1));
    }, true);
    this.selId = null;
    if (!this.doc.trails.length) this.toggle(false);
  }

  copyFromPrevious() {
    const t = this.trail(), g = this.ghost(t);
    if (!t || !g) { this.ed.app.toast("前面的帧还没有棍子。", "warn"); return; }
    this.edit(() => { t.keys[this.frameId()] = JSON.parse(JSON.stringify(g)); });
  }

  // the other sticks of the swing this frame belongs to (up to the gaps either side)
  swingNeighbours(t) {
    const ids = this.frameIds(), fi = this.ed.fi, out = [];
    for (let i = fi - 1; i >= 0 && t.keys[ids[i]]; i--) out.push(t.keys[ids[i]]);
    for (let i = fi + 1; i < ids.length && t.keys[ids[i]]; i++) out.push(t.keys[ids[i]]);
    return out;
  }

  // 对调两端: the grip end becomes the tip and the other way round
  swapEnds() {
    const t = this.trail(), k = this.key(t);
    if (!k) return;
    this.edit(() => { [k.a, k.b] = [k.b, k.a]; });
  }

  removeKey() {
    const t = this.trail();
    if (!t || !this.key(t)) return;
    this.edit(() => { delete t.keys[this.frameId()]; });
  }

  toggleZ() {
    const t = this.trail(), k = this.key(t);
    if (!k) { this.ed.app.toast("这一帧还没有棍子。", "warn"); return; }
    this.edit(() => { k.z = k.z === "back" ? "front" : "back"; });
  }

  // step to the next frame, carrying the stick over (the core loop of drawing a swing)
  next() {
    const prev = this.ed.fi;
    if (prev >= this.doc.frames.length - 1) { this.ed.app.toast("已经是最后一帧。"); return; }
    this.carrying = true;
    try { this.ed.goFrame(prev + 1); } finally { this.carrying = false; }
  }

  // ---------- presets & texture ----------
  userPresets() { return (this.ed.app.settings && this.ed.app.settings.trailPresets) || []; }

  presetMenu(e) {
    const r = e.currentTarget.getBoundingClientRect();
    showMenu(r.left, r.bottom + 4, [
      { heading: "内置预设" },
      ...BUILTIN_PRESETS.map((p) => ({ label: p.name, action: () => this.applyPreset(p) })),
      ...(this.userPresets().length ? [{ heading: "我的预设" }, ...this.userPresets().map((p) => ({ label: p.name, action: () => this.applyPreset(p) }))] : []),
    ]);
  }

  // a 拖尾笔 style (editor/trailbrush.js): its bands and default fade; "主色"
  // takes the current primary colour
  // 高清 / 像素: switch the trail to the other kind, with the style it had there
  // last time (or the first one)
  // 高清 <-> 像素: a glow trail keeps its preset and only turns pixel art on or
  // off; a band trail going to 高清 takes its last glow preset
  setKind(k) {
    const t = this.trail();
    if (!t) return;
    const st = t.style;
    if (st.colorMode === "glow") this.edit(() => { t.style.pixelGlow = k !== "hd"; });
    else if (k === "hd") this.applyGlow(GLOW_PRESETS.find((p) => p.id === st.glowId) || GLOW_PRESETS[0]);
  }

  // a 光效 style (pixelGlow: as pixel art). The band renderer's pixel flag goes
  // off: glows have their own pixel step
  applyGlow(p, pixelGlow = false) {
    const t = this.trail();
    if (!t) return;
    this.edit(() => { Object.assign(t.style, { colorMode: "glow", pixel: false, pixelGlow }, glowStyle(p)); });
  }

  applyStyle(p, pixel) {
    const t = this.trail();
    if (!t) return;
    const bands = p.bands ? p.bands.map(([c, f]) => [c, f]) : [["#" + this.ed.primary.slice(0, 3).map((v) => v.toString(16).padStart(2, "0")).join(""), 1]];
    this.edit(() => {
      t.style.colorMode = "bands";
      t.style.bands = bands;
      t.style.styleId = p.id;
      t.style.fade = (p.fade ?? 45) / 100;
      // the preset's whole look: layout, fades, speed lines, raggedness (and the
      // crescent shape for the 弧光 styles)
      Object.assign(t.style, BAND_LOOK, p.look || {});
      if (pixel) t.style.pixel = true;
    });
  }

  async applyPreset(p) {
    const t = this.trail();
    if (!t) return;
    const style = JSON.parse(JSON.stringify(p.style));
    // a saved preset carries its texture as a data URL; it becomes a project asset here
    for (const key of ["texture", "brush"]) {
      const v = style[key];
      if (!v || v.kind !== "data") continue;
      const blob = await (await fetch(v.url)).blob();
      const asset = await putBlobAsset(this.ed.app.store.projectId, blob);
      setTexture(asset, await blobToCanvas(blob));
      style[key] = { kind: "asset", asset, name: v.name };
    }
    this.edit(() => { t.style = { ...STYLE_DEFAULTS, ...style }; });
    this.ensureTextures();
  }

  async savePreset() {
    const t = this.trail();
    if (!t) return;
    const list = this.userPresets();
    let name = prompt("预设名称（留空自动编号）", "");
    if (name === null) return;
    name = name.trim() || "拖尾预设 " + (list.length + 1);
    const style = JSON.parse(JSON.stringify(t.style));
    for (const [key, get] of [["texture", textureFor], ["brush", brushFor]]) {
      const v = style[key];
      if (!v || v.kind !== "asset") continue;
      const c = get(t);
      if (c) {
        const blob = await canvasToBlob(c);
        const url = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); });
        style[key] = { kind: "data", url, name: v.name };
      } else style[key] = { ...STYLE_DEFAULTS[key] };
    }
    // always a new entry: existing presets are never overwritten, and the sticks
    // (the swing itself) are not part of a preset
    this.ed.app.saveSetting({ trailPresets: [...list, { name, style }] });
    this.ed.app.toast("已保存拖尾预设「" + name + "」。", "ok");
  }

  // a custom tail brush: any greyscale image; across = trail width, along = trail
  // length; brighter streaks reach further into the tail
  async importBrush() {
    const t = this.trail();
    if (!t) return;
    const files = await this.ed.app.pickFiles("image/png,image/webp,image/*");
    if (!files[0]) return;
    const asset = await putBlobAsset(this.ed.app.store.projectId, files[0]);
    setTexture(asset, await blobToCanvas(files[0]));
    this.edit(() => { t.style.brush = { kind: "asset", asset, name: files[0].name }; t.style.tailMode = "brush"; });
  }

  async importTexture() {
    const t = this.trail();
    if (!t) return;
    const files = await this.ed.app.pickFiles("image/png,image/webp,image/*");
    if (!files[0]) return;
    const asset = await putBlobAsset(this.ed.app.store.projectId, files[0]);
    setTexture(asset, await blobToCanvas(files[0]));
    this.edit(() => { t.style.texture = { kind: "asset", asset, name: files[0].name }; });
  }

  // ---------- rendering hooks ----------
  drawOne(g, raw, z, ox, oy, iw, ih) {
    if (!raw) return;
    const doc = this.doc, t = normalizeTrail(raw);
    const c = trailCanvas(t, trailState(t, this.frameIds(), this.ed.fi), doc.w, doc.h, z);
    if (c) g.drawImage(c, ox, oy, iw, ih);
    else if (!textureFor(t) || !brushFor(t)) this.ensureTextures();
  }

  // the 角色后方 parts of every visible trail layer, under all layers
  drawBack(g, ox, oy, iw, ih) {
    for (const l of this.doc.layers) {
      if (!l.trail || l.visible === false) continue;
      g.globalAlpha = (l.opacity ?? 100) / 100;
      this.drawOne(g, this.doc.trails.find((t) => t.id === l.trail), "back", ox, oy, iw, ih);
    }
    g.globalAlpha = 1;
  }

  // a trail layer at its place in the stack (alpha already set by the caller)
  drawLayer(g, l, ox, oy, iw, ih) {
    this.drawOne(g, this.doc.trails.find((t) => t.id === l.trail), "front", ox, oy, iw, ih);
  }

  drawOverlay(g, ox, oy, z) {
    if (!this.active) return;
    const t = this.trail();
    if (!t) return;
    const P = (p) => [ox + p[0] * z, oy + p[1] * z];
    const line = (a, b) => { g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); };
    g.save();
    // earlier sticks of this swing and the path of the blade tip
    if (this.showPath) {
      const ids = this.frameIds();
      const past = [];
      for (let i = this.ed.fi - 1; i >= 0 && past.length < Math.max(1, t.length | 0) + 2; i--) {
        const k = t.keys[ids[i]];
        if (!k) break;
        past.unshift(k);
      }
      g.strokeStyle = "rgba(255,255,255,0.35)";
      g.lineWidth = 1.5;
      for (const k of past) line(P(k.a), P(k.b));
      const cur = this.key(t);
      const tips = [...past, ...(cur ? [cur] : [])].map((k) => P(k.b));
      if (tips.length > 1) {
        g.setLineDash([4, 4]);
        g.strokeStyle = "rgba(255,255,255,0.7)";
        g.beginPath();
        tips.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
        g.stroke();
        g.setLineDash([]);
      }
    }
    if (this.showSticks) {
      const k = this.key(t);
      const s = k || this.ghost(t);
      if (s) {
        const a = P(s.a), b = P(s.b);
        const col = k ? (k.z === "back" ? "#9aa0ad" : "#ffd166") : "rgba(255,209,102,0.45)";
        g.strokeStyle = col;
        g.lineWidth = 3;
        if (!k) g.setLineDash([5, 4]);
        line(a, b);
        g.setLineDash([]);
        for (const [p, r] of [[a, 4.5], [b, 6]]) {
          g.fillStyle = "#11131a"; g.beginPath(); g.arc(p[0], p[1], r + 1.5, 0, Math.PI * 2); g.fill();
          g.fillStyle = col; g.beginPath(); g.arc(p[0], p[1], r, 0, Math.PI * 2); g.fill();
        }
        g.fillStyle = "#fff";
        g.font = "11px sans-serif";
        g.fillText(k ? (k.z === "back" ? "角色后方" : "") : "上一帧的棍子（拖动它沿用到本帧）", b[0] + 9, b[1] - 8);
        // which end is which: 柄 = inner end (grip side), 尖 = blade tip (the trail's outer edge)
        if (k) {
          g.font = "bold 11px sans-serif";
          g.lineWidth = 3;
          g.strokeStyle = "#11131a";
          g.fillStyle = col;
          for (const [txt, p, dx] of [["柄", a, 8], ["尖", b, 9]]) {
            g.strokeText(txt, p[0] + dx, p[1] + 4);
            g.fillText(txt, p[0] + dx, p[1] + 4);
          }
        }
      }
    }
    g.restore();
  }

  // ---------- pointer (document pixels, floats) ----------
  onDown(e, p) {
    let t = this.trail();
    if (!t) { this.addTrail(); t = this.trail(); }
    const hit = 9 / this.ed.zoom;
    const round = (v) => Math.round(v * 4) / 4;
    let k = this.key(t);
    const g = k ? null : this.ghost(t);
    const s = k || g;
    if (s) {
      const which = Math.hypot(s.b[0] - p.x, s.b[1] - p.y) <= hit ? "b" : Math.hypot(s.a[0] - p.x, s.a[1] - p.y) <= hit ? "a"
        : segDist(p, s.a, s.b) <= hit * 0.8 ? "body" : null;
      if (which) {
        this.ed.commitFloat();
        this.doc.checkpoint();
        // touching last frame's stick adopts it for this frame first
        if (!k) { k = JSON.parse(JSON.stringify(g)); t.keys[this.frameId()] = k; }
        this.drag = { type: which, start: { x: p.x, y: p.y }, a: k.a.slice(), b: k.b.slice() };
        return;
      }
      if (k) return; // this frame already has its stick: empty clicks do nothing
    }
    // no stick here: draw one (press = inner end, release = blade tip)
    this.ed.commitFloat();
    this.doc.checkpoint();
    t.keys[this.frameId()] = { a: [round(p.x), round(p.y)], b: [round(p.x), round(p.y)], z: (g && g.z) || "front" };
    this.drag = { type: "new" };
  }

  onMove(e, p) {
    const d = this.drag, t = this.trail(), k = this.key(t);
    if (!d || !k) return;
    const round = (v) => Math.round(v * 4) / 4;
    if (d.type === "new" || d.type === "b") k.b = [round(p.x), round(p.y)];
    else if (d.type === "a") k.a = [round(p.x), round(p.y)];
    else if (d.type === "body") {
      const dx = p.x - d.start.x, dy = p.y - d.start.y;
      k.a = [round(d.a[0] + dx), round(d.a[1] + dy)];
      k.b = [round(d.b[0] + dx), round(d.b[1] + dy)];
    }
    this.ed.markDirty();
  }

  onUp() {
    const d = this.drag, t = this.trail();
    this.drag = null;
    if (!d || !t) return;
    const k = this.key(t);
    if (d.type === "new" && k && Math.hypot(k.b[0] - k.a[0], k.b[1] - k.a[1]) < 1) {
      // a click, not a drag: nothing drawn
      delete t.keys[this.frameId()];
      this.doc.discardCheckpoint();
      this.ed.requestRender();
      return;
    }
    // grabbed the wrong end? a stick whose tip lands where this swing's grip is
    // would twist the trail into a bow-tie — turn it round
    if (k && this.swingNeighbours(t).length && stickReversed(k, this.swingNeighbours(t))) {
      [k.a, k.b] = [k.b, k.a];
      this.ed.app.toast("这根棍子和同一刀的其他帧方向相反（刀尖在握柄一侧），已自动对调两端。小圆点 = 柄，大圆点 = 刀尖。");
    }
    this.ed.afterChange(false);
    this.refresh();
  }

  onKey(k) {
    if (!this.active) return false;
    if (k === "delete" || k === "backspace") { this.removeKey(); return true; }
    if (k === "n") { this.next(); return true; }
    return false;
  }

  // ---------- panel ----------
  refresh() {
    if (!this.active) return;
    const P = this.panel;
    const doc = this.doc;
    const t = this.trail();
    if (t) this.selId = t.id;
    P.replaceChildren();
    const title = (text, ...btns) => el("div", { class: "ed-panel-title" }, text, el("span", { class: "spacer" }), ...btns);

    // a combo is several segments, one per cut, each with its own layer
    P.append(title("本动作的拖尾（每段一个图层）",
      el("button", { class: "tool-btn", title: "连招的下一刀：新建一段拖尾（沿用当前样式），从上一段结束的地方接着画", onclick: () => this.addNextSegment() }, "＋ 下一段")));
    const list = el("div", { class: "tn-list" });
    for (const x of doc.trails) {
      const row = el("div", { class: "tn-row" + (t && x.id === t.id ? " on" : "") },
        el("span", { class: "tn-row-name" }, x.name),
        el("span", { class: "tn-row-meta mono" }, (() => { const r = this.range(x); return r ? "第 " + (r[0] + 1) + (r[1] > r[0] ? "–" + (r[1] + 1) : "") + " 帧" : "未画"; })()));
      // picking a segment also jumps to it when the current frame is outside it
      row.onclick = () => {
        this.selId = x.id;
        this.focusLayer(x);
        const r = this.range(x);
        if (r && (this.ed.fi < r[0] || this.ed.fi > r[1] + (x.dissolve ?? 3))) this.ed.goFrame(r[0]);
        this.refresh();
        this.ed.requestRender();
      };
      row.ondblclick = () => {
        const nn = prompt("拖尾名称", x.name);
        if (!nn || !nn.trim()) return;
        // the trail and its layer share one name
        this.edit(() => { x.name = nn.trim(); const i = this.doc.trailLayerIndex(x.id); if (i >= 0) this.doc.layers[i].name = x.name; }, true);
      };
      list.append(row);
    }
    P.append(list);
    if (!t) return;

    // this frame
    const k = this.key(t), g = this.ghost(t);
    P.append(title("第 " + (this.ed.fi + 1) + " 帧的棍子"));
    const fading = !k && trailState(normalizeTrail(t), this.frameIds(), this.ed.fi);
    P.append(el("p", { class: "ed-hint" }, k
      ? "拖棍身移动，拖两端拉伸 / 旋转。刀尖一端（大圆点）是拖尾的外侧。"
      : fading ? "挥砍已过顶峰：这一帧没有棍子，拖尾正在收尾消散（尾追上头、逐渐变淡）。想继续挥，就拖动上一帧的棍子沿用过来。"
      : g ? "这一帧还没有棍子：拖动虚线显示的上一帧棍子就会沿用并调整，或在空白处重新画一根。"
        : "在画面上拖出一根棍子：按下处是内端（靠近握柄），松开处是刀尖。棍子的长度就是拖尾的宽度。"));
    const carry = el("input", { type: "checkbox", checked: this.carry, onchange: () => { this.carry = carry.checked; } });
    P.append(
      el("div", { class: "tm-bar" },
        el("button", { class: "tool-btn", title: "到下一帧，并沿用这根棍子（N）", onclick: () => this.next() }, "下一帧 →"),
        el("button", { class: "tool-btn", title: "沿用前面最近一帧的棍子", disabled: !g || !!k, onclick: () => this.copyFromPrevious() }, "沿用上一帧"),
        el("button", { class: "tool-btn" + (k && k.z === "back" ? " active" : ""), title: "这一帧的棍子在角色前方还是后方（拖尾可以中途绕到角色身后）", disabled: !k, onclick: () => this.toggleZ() }, k && k.z === "back" ? "后方" : "前方"),
        el("button", { class: "tool-btn", title: "删除这一帧的棍子（Delete）：拖尾在这里中断", disabled: !k, onclick: () => this.removeKey() }, "删除"),
        el("button", { class: "tool-btn", title: "握柄端和刀尖端对调（棍子画反了、拖尾拧成麻花时用）", disabled: !k, onclick: () => this.swapEnds() }, "对调两端"),
        el("button", { class: "tool-btn", title: "从这一帧起的棍子拆成新的一段：前一段在这里收尾消散，不会一路连到下一刀", disabled: !k || !this.range(t) || this.range(t)[0] >= this.ed.fi, onclick: () => this.splitHere() }, "从这帧拆开")),
      el("label", { class: "ed-check" }, carry, "「下一帧 →」（N）时自动沿用棍子"),
      el("p", { class: "ed-hint" }, "挥到顶峰后就不要再放棍子：后面几帧会按「收尾消散」自动渐隐。连招的每一刀用「＋ 下一段」各画一段，可以各用不同样式、前后重叠；已经画成一段的，用「从这帧拆开」分开。"),
    );

    // shape & style
    const st = t.style || {};
    P.append(title("形状与样式",
      el("button", { class: "tool-btn", title: "套用预设", onclick: (e) => this.presetMenu(e) }, "预设 ▾"),
      el("button", { class: "tool-btn", title: "把当前纹理、配色和参数另存为预设（不含棍子）", onclick: () => this.savePreset() }, "保存")));
    // the same styles as the 拖尾笔 brush: one click sets the colour bands, the
    // shape / arc / direction / length settings stay as they are
    const isGlow = st.colorMode === "glow", hd = isGlow && !st.pixelGlow;
    const grid = el("div", { class: "trail-presets" });
    for (const p of TRAIL_PRESETS) {
      const on = st.colorMode === "bands" && st.styleId === p.id;
      grid.append(el("button", { class: "trail-preset" + (on ? " on" : ""), title: p.name, onclick: () => this.applyStyle(p) },
        styleThumb("band", p, this.ed.primary), el("span", null, p.name)));
    }
    // 高清 or 像素 first. 像素 lists the same glow styles drawn as pixel art
    // (像素光效), then the classic colour bands
    const glowGrid = el("div", { class: "trail-presets" });
    for (const p of GLOW_PRESETS) {
      const on = isGlow && st.glowId === p.id;
      glowGrid.append(el("button", { class: "trail-preset" + (on ? " on" : ""), title: p.name, onclick: () => this.applyGlow(p, !hd) },
        styleThumb(hd ? "hd" : "pixel", p), el("span", null, p.name)));
    }
    const kind = el("div", { class: "trail-kind" },
      el("button", { class: hd ? "on" : "", title: "平滑发光的高清特效", onclick: () => { if (!hd) this.setKind("hd"); } }, "高清"),
      el("button", { class: hd ? "" : "on", title: "像素画：同样的光效画成像素，或经典分层色带", onclick: () => { if (hd) this.setKind("pixel"); } }, "像素"));
    P.append(el("div", { class: "tm-label" }, "样式"), kind);
    if (hd) P.append(glowGrid);
    else P.append(el("div", { class: "tm-label" }, "像素光效"), glowGrid, el("div", { class: "tm-label" }, "经典色带"), grid);
    if (isGlow && st.pixelGlow) {
      // the pixel step: block size and how soft edges become pixels
      const ps = el("input", { type: "range", min: 1, max: 8, value: st.pxSize || 1, title: "几个画布像素拼成一个大像素。像素画角色用 1；高分辨率画布想要更粗的颗粒就调大" });
      const pv = el("span", { class: "mono tm-num" }, (st.pxSize || 1) + " px");
      ps.oninput = () => this.liveEdit(() => { t.style.pxSize = +ps.value; pv.textContent = ps.value + " px"; });
      ps.onchange = () => this.endLive();
      const pa = el("select", { class: "ed-select", title: "辉光、渐隐这些半透明的地方怎么变成像素" },
        ...[["steps", "4 级透明"], ["dither", "抖动（全实心像素）"], ["hard", "硬边（只留实心部分）"]].map(([v, n]) => el("option", { value: v, selected: (st.pxAlpha || "steps") === v }, n)));
      pa.onchange = () => this.edit(() => { t.style.pxAlpha = pa.value; });
      P.append(el("div", { class: "tm-row" }, el("span", { class: "tm-label" }, "像素大小"), ps, pv),
        el("div", { class: "tm-row" }, el("span", { class: "tm-label" }, "透明方式"), pa));
    }
    const shape = el("select", { class: "ed-select" }, ...SHAPES.map(([v, n]) => el("option", { value: v, selected: (st.shape || "head") === v }, n)));
    shape.onchange = () => this.edit(() => { t.style.shape = shape.value; });
    P.append(el("div", { class: "tm-row" }, el("span", { class: "tm-label" }, "形状"), shape));
    const len = el("input", { type: "range", min: 1, max: 12, value: t.length || 4 });
    const lenVal = el("span", { class: "mono tm-num" }, (t.length || 4) + " 帧");
    len.oninput = () => this.liveEdit(() => { t.length = +len.value; lenVal.textContent = len.value + " 帧"; });
    len.onchange = () => this.endLive();
    P.append(el("div", { class: "tm-row" }, el("span", { class: "tm-label" }, "拖尾长度"), len, lenVal));

    // the swing itself: how it curves, and how it dies away after the peak
    const trailSlider = (label, key, min, max, scale, unit, def, title) => {
      const v = t[key] ?? def;
      const val = el("span", { class: "mono tm-num" }, Math.round(v * scale) + unit);
      const r = el("input", { type: "range", min, max, value: Math.round(v * scale), title });
      r.oninput = () => this.liveEdit(() => { t[key] = +r.value / scale; val.textContent = r.value + unit; });
      r.onchange = () => this.endLive();
      P.append(el("div", { class: "tm-row", title }, el("span", { class: "tm-label" }, label), r, val));
    };
    // the plane of the swing: in the picture (chops, diagonal cuts) or a
    // horizontal sweep around the body seen in perspective (an ellipse)
    const flat = t.plane === "flat";
    const plane = el("select", { class: "ed-select", title: "横扫：刀在水平面上绕身体转，从正面看是一个压扁的椭圆，远侧那一半在角色身后" },
      ...[["screen", "画面内（竖劈、斜劈、上挑）"], ["flat", "横扫（水平绕身，椭圆透视）"]]
        .map(([v, n]) => el("option", { value: v, selected: (t.plane || "screen") === v }, n)));
    plane.onchange = () => this.edit(() => { t.plane = plane.value; if (plane.value === "flat") t.rotate = true; });
    P.append(el("div", { class: "tm-row" }, el("span", { class: "tm-label" }, "挥动平面"), plane));
    if (flat) {
      trailSlider("压扁", "squash", 10, 100, 100, "%", 0.35, "椭圆的高度和宽度之比：越小越扁（视线越平），100% 是正圆（从头顶往下看）");
      trailSlider("倾斜", "tilt", -60, 60, 1, "°", 0, "整个挥动平面的倾斜角：斜着横扫（比如从左下扫到右上）时调它");
      const ad = el("input", { type: "checkbox", checked: t.autoDepth !== false, onchange: () => this.edit(() => { t.autoDepth = ad.checked; }) });
      P.append(el("label", { class: "ed-check" }, ad, "远侧自动绕到角色后方（刀尖朝里的那半圈）"));
      P.append(el("p", { class: "ed-hint" }, "棍子按画面上看到的样子画：刀朝左右时棍子长，刀朝向镜头或背向镜头时棍子变短（透视），插值会把它们连成椭圆。开着「远侧自动」时，每帧的「前方 / 后方」按钮不起作用。"));
    }
    // which way round the blade travels between sticks: with few frames a big
    // swing is ambiguous, and "the smaller turn" can take it under instead of over
    const turns = flat
      ? [["auto", "自动（转得少的一边）"], ["cw", "经过身后（远侧）↻"], ["ccw", "经过身前（近侧）↺"]]
      : [["auto", "自动（转得少的一边）"], ["cw", "顺时针 ↻（左上→头顶→右下）"], ["ccw", "逆时针 ↺（右上→头顶→左下）"]];
    const turn = el("select", { class: "ed-select", title: flat ? "从一侧扫到另一侧时，刀是从身前还是身后转过去" : "两根棍子之间刀往哪边转。从左上劈到右下（经过头顶）选顺时针" },
      ...turns.map(([v, n]) => el("option", { value: v, selected: (t.turn || "auto") === v }, n)));
    turn.onchange = () => this.edit(() => { t.turn = turn.value; if (turn.value !== "auto") t.rotate = true; });
    P.append(el("div", { class: "tm-row" }, el("span", { class: "tm-label" }, "挥动方向"), turn));
    trailSlider("弧度", "bow", -100, 100, 100, "%", 0, "整段拖尾额外弯曲：正值向刀尖一侧外鼓（如从上往下劈的抛物线），负值向握柄一侧内收");
    trailSlider("收尾消散", "dissolve", 0, 8, 1, " 帧", 3, "最后一根棍子之后，拖尾继续显示几帧：头停住、尾追上来、逐渐变淡消失");
    const rot = el("input", { type: "checkbox", checked: t.rotate !== false, onchange: () => this.edit(() => { t.rotate = rot.checked; }) });
    P.append(el("label", { class: "ed-check" }, rot, "按握柄旋转插值（帧与帧之间刀尖走圆弧）"));

    // band trails can also be coloured from a texture instead of the bands
    if (!isGlow) {
      const mode = el("select", { class: "ed-select" },
        ...[["bands", "色带（上面的样式）"], ["mono", "单色 · 灰度纹理"], ["gradient", "渐变 · 灰度纹理"], ["original", "原色（RGBA 纹理）"]].map(([v, n]) => el("option", { value: v, selected: st.colorMode === v }, n)));
      mode.onchange = () => this.edit(() => { t.style.colorMode = mode.value; });
      P.append(el("div", { class: "tm-row" }, el("span", { class: "tm-label" }, "配色"), mode));
    }
    if (st.colorMode === "gradient") {
      const stops = st.gradient || STYLE_DEFAULTS.gradient;
      stops.forEach((g0, i) => {
        const c = el("input", { type: "color", value: g0.c });
        c.oninput = () => this.liveEdit(() => { t.style.gradient[i].c = c.value; });
        c.onchange = () => this.endLive();
        const pos = el("input", { type: "range", min: 0, max: 100, value: Math.round(g0.p * 100) });
        pos.oninput = () => this.liveEdit(() => { t.style.gradient[i].p = +pos.value / 100; });
        pos.onchange = () => this.endLive();
        P.append(el("div", { class: "tm-stop" }, c, pos,
          el("button", { class: "tool-btn", title: "删除节点", disabled: stops.length <= 2, onclick: () => this.edit(() => { t.style.gradient.splice(i, 1); }) }, "×")));
      });
      P.append(el("button", { class: "btn small", onclick: () => this.edit(() => {
        const gr = t.style.gradient || (t.style.gradient = JSON.parse(JSON.stringify(STYLE_DEFAULTS.gradient)));
        gr.push({ p: 0.5, c: "#ffffff" });
      }) }, "＋ 渐变节点"), el("p", { class: "ed-hint" }, "节点位置：0 = 尾，100 = 头（刀尖处）。"));
    } else if (st.colorMode === "glow") {
      // colours across the trail (inner -> outer), then the hot crescent, its rim and the splatter
      const gc = st.glowColors || GLOW_PRESETS[0].colors;
      const pick = (value, set, title) => {
        const c = el("input", { type: "color", value, title });
        c.oninput = () => this.liveEdit(() => { set(c.value); t.style.glowId = null; });
        c.onchange = () => this.endLive();
        return c;
      };
      P.append(el("div", { class: "tm-row" }, el("span", { class: "tm-label" }, "内 → 外"),
        el("div", { class: "tm-colors" }, ...gc.map((v, i) => pick(v, (x) => { t.style.glowColors = gc.slice(); t.style.glowColors[i] = x; }, "第 " + (i + 1) + " 色（1 = 握柄一侧，" + gc.length + " = 刀尖一侧）")))));
      P.append(el("div", { class: "tm-row" }, el("span", { class: "tm-label" }, "其他颜色"),
        el("div", { class: "tm-colors" },
          pick(st.glowCore || "#ffffff", (x) => { t.style.glowCore = x; }, "刀芯（最亮的月牙）"),
          pick(st.glowRim || "#ffffff", (x) => { t.style.glowRim = x; }, "外缘亮线（和刀芯的描边）"),
          pick(st.glowSplat || "#ffffff", (x) => { t.style.glowSplat = x; }, "飞溅墨点"),
          pick(st.glowTail || gc[0], (x) => { t.style.glowTail = x; }, "尾部颜色（「尾部变色」往这个颜色过渡）"))));
    } else if (st.colorMode !== "original" && st.colorMode !== "bands") {
      const c = el("input", { type: "color", value: st.color || "#ffffff" });
      c.oninput = () => this.liveEdit(() => { t.style.color = c.value; });
      c.onchange = () => this.endLive();
      P.append(el("div", { class: "tm-row" }, el("span", { class: "tm-label" }, "颜色"), c));
    }

    const tex = st.texture && st.texture.kind === "asset" ? (st.texture.name || "自定义纹理") : "dynamic_trail_luma（内置）";
    // colour bands don't use a texture; the texture tools only show for texture modes
    if (st.colorMode !== "bands" && st.colorMode !== "glow") P.append(el("div", { class: "tm-row" }, el("span", { class: "tm-label" }, "纹理"), el("span", { class: "tm-val" }, tex)),
      el("div", { class: "f-buttons" },
        el("button", { class: "btn small", onclick: () => this.importTexture() }, "导入纹理…"),
        el("button", { class: "btn small", onclick: () => this.edit(() => { t.style.texture = { ...STYLE_DEFAULTS.texture }; }) }, "用内置"),
        el("button", { class: "btn small" + (st.invert ? " primary" : ""), onclick: () => this.edit(() => { t.style.invert = !t.style.invert; }) }, "反色"),
        el("button", { class: "btn small" + (t.flip ? " primary" : ""), title: "纹理内外侧对调", onclick: () => this.edit(() => { t.flip = !t.flip; }) }, "翻面")));

    const slider = (label, key, min, max, scale, unit, into = P) => {
      const v = st[key] ?? STYLE_DEFAULTS[key] ?? GLOW_DEFAULTS[key] ?? 0;
      const val = el("span", { class: "mono tm-num" }, Math.round(v * scale) + unit);
      const r = el("input", { type: "range", min, max, value: Math.round(v * scale) });
      r.oninput = () => this.liveEdit(() => { t.style[key] = +r.value / scale; val.textContent = r.value + unit; });
      r.onchange = () => this.endLive();
      const row = el("div", { class: "tm-row" }, el("span", { class: "tm-label" }, label), r, val);
      into.append(row);
      return row;
    };
    const choose = (label, key, options, def, into = P, title) => {
      const cur = String(st[key] ?? def);
      const sel = el("select", { class: "ed-select", title }, ...options.map(([v, n]) => el("option", { value: String(v), selected: cur === String(v) }, n)));
      sel.onchange = () => this.edit(() => { const v = sel.value; t.style[key] = v === "true" ? true : v === "false" ? false : v; });
      into.append(el("div", { class: "tm-row" }, el("span", { class: "tm-label" }, label), sel));
    };
    // a control with its fine-grained parts folded under it: ▸ opens them, and
    // they stay open while you work
    const group = (id, row, details) => {
      const open = this.openGroups.has(id);
      row.classList.add("has-more");
      row.append(el("button", {
        class: "tm-more" + (open ? " on" : ""), title: open ? "收起细节" : "展开细节调整",
        onclick: () => { if (open) this.openGroups.delete(id); else this.openGroups.add(id); this.refresh(); },
      }, open ? "细节 ▾" : "细节 ▸"));
      if (open) { const box = el("div", { class: "tm-details" }); P.append(box); details(box); }
    };
    const heading = (label) => {
      const row = el("div", { class: "tm-row tm-group-head" }, el("span", { class: "tm-label" }, label), el("span"), el("span"));
      P.append(row);
      return row;
    };

    // the effect controls get their own section, so they are easy to find
    P.append(title("效果调整"), el("p", { class: "ed-hint" }, "每项右边的「细节 ▸」展开这个位置的每一层单独调。"));
    if ((st.shape || "head") !== "crescent") slider("头部弧度", "headArc", 0, 100, 100, "%");
    // 尾部: one slider for the tail — a longer, softer tail is also a thinner one;
    // its two parts can be set apart under ▸
    {
      const tv = Math.round((st.fade ?? STYLE_DEFAULTS.fade) * 100);
      const tr = el("input", { type: "range", min: 0, max: 100, value: tv, title: "尾巴拖多长、多细：越大尾巴越长、渐隐越慢、尾端越细" });
      const tvv = el("span", { class: "mono tm-num" }, tv + "%");
      tr.oninput = () => this.liveEdit(() => {
        const v = +tr.value / 100;
        t.style.fade = v;
        t.style.taper = Math.max(0.05, 0.6 - 0.55 * v);
        tvv.textContent = tr.value + "%";
      });
      tr.onchange = () => this.endLive();
      const row = el("div", { class: "tm-row" }, el("span", { class: "tm-label" }, "尾部"), tr, tvv);
      P.append(row);
      group("tail", row, (box) => {
        slider("渐隐长度", "fade", 0, 100, 100, "%", box);
        if ((st.shape || "head") === "head") slider("尾端收窄", "taper", 0, 100, 100, "%", box);
      });
    }
    // colour bands: a few controls, each with its parts under ▸
    if (st.colorMode === "bands") {
      // 破碎 covers the edges: their raggedness and how far the inner side fades
      const bv = Math.round((st.edgeBreak ?? 0.3) * 100);
      const br = el("input", { type: "range", min: 0, max: 100, value: bv, title: "边缘：参差破碎的程度，以及握柄一侧碎开渐隐的范围" });
      const bvv = el("span", { class: "mono tm-num" }, bv + "%");
      br.oninput = () => this.liveEdit(() => {
        const v = +br.value / 100;
        t.style.edgeBreak = v;
        if (t.style.bandLayout === "edge") t.style.edgeFade = Math.min(0.85, v * 0.9);
        bvv.textContent = br.value + "%";
      });
      br.onchange = () => this.endLive();
      const brow = el("div", { class: "tm-row" }, el("span", { class: "tm-label" }, "破碎"), br, bvv);
      P.append(brow);
      group("b-edge", brow, (box) => {
        slider("边缘破碎", "edgeBreak", 0, 100, 100, "%", box);
        slider(st.bandLayout === "edge" ? "内侧渐隐" : "边缘渐隐", "edgeFade", 0, 100, 100, "%", box);
        choose("亮边位置", "bandLayout", [["center", "居中（中间最亮）"], ["edge", "外缘（刀尖一侧最亮）"]], "center", box, "居中：中间最亮、两侧暗；外缘：刀尖一侧一道亮边，往握柄一侧变暗");
      });
      group("b-streak", slider("速度线", "streaks", 0, 100, 100, "%"), (box) => {
        slider("分条", "splits", 0, 4, 1, " 道", box);
      });
      group("b-fx", slider("粒子", "pxFx", 0, 100, 100, "%"), (box) => {
        slider("粉尘", "pxDust", 0, 100, 100, "%", box);
        slider("碎片", "pxShards", 0, 100, 100, "%", box);
        slider("飞溅", "pxSplatter", 0, 100, 100, "%", box);
      });
      slider("爆发", "pxImpact", 0, 100, 100, "%");
      group("b-bands", heading("色带细节"), (box) => {
        choose("色带过渡", "bandBlend", [["steps", "色阶（插入中间色）"], ["dither", "抖动（网点过渡）"], ["smooth", "平滑渐变"], ["hard", "硬边"]], "steps", box, "相邻两条色带怎么衔接");
        slider("过渡宽度", "bandSoft", 0, 100, 100, "%", box);
        slider("尾部变暗", "bandShade", 0, 100, 100, "%", box);
        if (st.pixel !== false) choose("渐隐方式", "fadeSteps", [[false, "抖动（全实心像素）"], [true, "分级透明（4 级）"]], false, box, "渐隐的地方怎么画");
      });
    }
    const glow = st.colorMode === "glow";
    if (glow) {
      // the same controls for every glow style, by where on the effect they act;
      // each scales its layers (100 % = the preset as designed), and ▸ opens the
      // layers themselves for fine tuning
      group("g-edge", slider("刀锋", "mixEdge", 0, 200, 1, "%"), (box) => {
        slider("刀芯", "core", 0, 100, 1, "%", box);
        slider("结晶", "crystal", 0, 100, 1, "%", box);
        slider("光芒", "rays", 0, 100, 1, "%", box);
        slider("阴影", "shadow", 0, 100, 1, "%", box);
      });
      group("g-body", slider("刀身", "mixBody", 0, 200, 1, "%"), (box) => {
        slider("光丝", "strands", 0, 160, 1, " 条", box);
        slider("流体", "flow", 0, 100, 1, "%", box);
        slider("火舌", "flames", 0, 100, 1, "%", box);
        slider("闪电", "bolts", 0, 100, 1, "%", box);
        slider("速度线", "speedLines", 0, 100, 1, "%", box);
      });
      group("g-glow", slider("光晕", "mixGlow", 0, 200, 1, "%"), (box) => {
        slider("辉光", "glow", 0, 100, 1, "%", box);
        slider("残影", "haze", 0, 100, 1, "%", box);
      });
      group("g-fx", slider("粒子", "mixFx", 0, 200, 1, "%"), (box) => {
        slider("星光", "sparkles", 0, 60, 1, " 颗", box);
        slider("星光大小", "sparkleSize", 1, 20, 1, "", box);
        slider("粉尘", "dust", 0, 100, 1, "%", box);
        slider("雪花", "snow", 0, 100, 1, "%", box);
        slider("余烬", "embers", 0, 100, 1, "%", box);
        slider("碎片", "shards", 0, 100, 1, "%", box);
        slider("飞溅", "splatter", 0, 100, 1, "%", box);
      });
      group("g-burst", slider("爆发", "mixBurst", 0, 200, 1, "%"), (box) => {
        slider("起手闪光", "flash", 0, 100, 1, "%", box);
        slider("命中爆点", "impact", 0, 100, 1, "%", box);
      });
      if (!st.pixelGlow) slider("平涂", "cel", 0, 100, 1, "%");
      group("g-more", heading("其他细节"), (box) => {
        slider("侵蚀", "erode", 0, 100, 1, "%", box);
        slider("尾部变色", "tailTint", 0, 100, 1, "%", box);
        if (!st.pixelGlow) slider("平涂描边", "celOutline", 0, 100, 1, "%", box);
      });
      P.append(el("p", { class: "ed-hint" }, "这些总控所有光效通用，按作用的位置分，100% 是预设原样，换预设时保留。"));
    }
    // how the tail ends: brush streaks (default), dither dots, or a soft fade.
    // Glow trails are smooth light: no tail texture, no pixel mode
    if (!glow) {
      const tm = el("select", { class: "ed-select" },
        ...[["brush", "笔刷（顺着挥动的刷痕）"], ["dither", "颗粒抖动"], ["smooth", "平滑渐隐（需关闭像素化）"]]
          .map(([v, n]) => el("option", { value: v, selected: (st.tailMode || "brush") === v }, n)));
      tm.onchange = () => this.edit(() => { t.style.tailMode = tm.value; if (tm.value === "smooth") t.style.pixel = false; });
      P.append(el("div", { class: "tm-row" }, el("span", { class: "tm-label" }, "尾部质感"), tm));
      if ((st.tailMode || "brush") === "brush") {
        const cur = st.brush || STYLE_DEFAULTS.brush;
        const bsel = el("select", { class: "ed-select" },
          ...BUILTIN_BRUSHES.map((b) => el("option", { value: b.id, selected: cur.kind !== "asset" && (cur.id || "bristle") === b.id }, b.name)),
          ...(cur.kind === "asset" ? [el("option", { value: "__asset", selected: true }, "自定义：" + (cur.name || "笔刷图"))] : []));
        bsel.onchange = () => { if (bsel.value !== "__asset") this.edit(() => { t.style.brush = { kind: "builtin", id: bsel.value }; }); };
        // preview strip: left = tail end, right = toward the head
        const pv = el("canvas", { class: "tm-brush-pv", width: 120, height: 28, title: "笔刷：左边是拖尾末端，越亮的刷痕伸得越远" });
        const bc = brushFor(t);
        if (bc) { const g = pv.getContext("2d"); g.drawImage(bc, 0, 0, 120, 28); }
        P.append(el("div", { class: "tm-row" }, el("span", { class: "tm-label" }, "笔刷"), bsel),
          el("div", { class: "tm-row" }, el("span", { class: "tm-label" }), pv,
            el("button", { class: "btn small", title: "导入灰度图作为笔刷：横向 = 拖尾方向，纵向 = 宽度方向", onclick: () => this.importBrush() }, "导入笔刷…")));
      }
    }
    slider("不透明度", "opacity", 0, 100, 1, "");
    slider("细腻度", "fineness", 4, 64, 1, "");
    const px = el("input", { type: "checkbox", checked: st.pixel !== false, onchange: () => this.edit(() => { t.style.pixel = px.checked; }) });
    const sm = el("input", { type: "checkbox", checked: t.smooth !== false, onchange: () => this.edit(() => { t.smooth = sm.checked; }) });
    if (!glow) P.append(el("label", { class: "ed-check" }, px, "像素化（无半透明，渐隐用网格抖动）"));
    P.append(el("label", { class: "ed-check" }, sm, "平滑轨迹（棍子之间用曲线过渡）"));
    P.append(el("div", { class: "f-buttons" },
      el("button", { class: "btn small", title: "把当前帧的拖尾画进「特效」图层，变成可以手修的像素", onclick: () => this.rasterize() }, "栅格化本帧到特效图层"),
      el("button", { class: "btn small danger", onclick: () => this.removeTrail() }, "删除这段拖尾（连同图层）")));
    P.append(el("p", { class: "ed-hint" }, "每帧的拖尾 = 最近「拖尾长度」帧里棍子扫过的区域，刀尖一侧最亮。拖尾图层在图层列表里的位置决定前后；某几帧设为「后方」则垫到所有图层下面。细腻度默认 20。"));
  }

  // bake the current frame's trails into the 特效 layer
  rasterize() {
    const doc = this.doc;
    const tmp = document.createElement("canvas");
    tmp.width = doc.w; tmp.height = doc.h;
    const g = tmp.getContext("2d", { willReadFrequently: true });
    const t = this.trail();
    drawTrail(g, t, this.frameIds(), this.ed.fi, "back", doc.w, doc.h);
    drawTrail(g, t, this.frameIds(), this.ed.fi, "front", doc.w, doc.h);
    const img = g.getImageData(0, 0, doc.w, doc.h);
    if (!img.data.some((v, i) => i % 4 === 3 && v)) { this.ed.app.toast("这一帧没有拖尾。", "warn"); return; }
    this.ed.stampOnFxLayer(img);
    this.ed.app.toast("已栅格化到「特效」图层。原拖尾还在，不需要的话删掉这一帧的棍子。", "ok");
  }
}

function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a[0]) * dx + (p.y - a[1]) * dy) / L2));
  return Math.hypot(p.x - (a[0] + dx * t), p.y - (a[1] + dy * t));
}
