// The pixel editor's document: layers × frames of cels (ImageData), plus palette.
//
// Copy-on-write: an ImageData that is part of a committed state is never written
// to. Editing a cel first swaps in a fresh copy (editableCel), so a history
// snapshot can be a SHALLOW copy of the cel map and still be exact. That keeps
// undo cheap even for long animations.
import { blank, cloneImg, touch, reposition, isEmpty } from "./raster.js";
import { uid, createCanvas } from "../core/util.js";

const HISTORY_LIMIT = 100;

// a layer with its settings objects copied, so a history snapshot never shares them
const copyLayer = (l) => ({ ...l, ...(l.ghost ? { ghost: { ...l.ghost } } : {}), ...(l.vfx ? { vfx: { ...l.vfx } } : {}) });

// Animation card params, any vintage -> { w, h, fps, layers, frames, palette }
//   layers: [{ id, name, visible, opacity }]  bottom -> top
//           (+ trail: id for an attack trail layer, ghost: {…} for a 残影 layer,
//              vfx: {…} for a 特效 layer)
//   frames: [{ id, duration, cels: { [layerId]: assetId } }]
export function normalizeAnim(p) {
  const w = p.w || 32, h = p.h || 32;
  let layers = Array.isArray(p.layers) && p.layers.length ? p.layers : null;
  let frames = Array.isArray(p.frames) ? p.frames : [];
  if (!layers) {
    // baked before layers existed: one asset per frame
    layers = [{ id: "L1", name: "图层 1", visible: true, opacity: 100 }];
    frames = frames.map((f, i) => ({ id: f.id || "F" + (i + 1), duration: f.duration || null, cels: f.cels || (f.asset ? { L1: f.asset } : {}) }));
  }
  frames = frames.map((f, i) => ({ id: f.id || "F" + (i + 1), duration: f.duration || null, cels: f.cels || {} }));
  const trails = Array.isArray(p.trails) ? p.trails : [];
  // every attack trail is a layer ({ trail: id }); its place in the stack is its depth
  const ids = new Set(trails.map((t) => t.id));
  layers = layers.filter((l) => !l.trail || ids.has(l.trail));
  for (const t of trails) {
    if (!layers.some((l) => l.trail === t.id)) layers.push({ id: "LT" + t.id, name: t.name || "拖尾", visible: true, opacity: 100, trail: t.id });
  }
  return { w, h, fps: p.fps || 12, layers: layers.map((l) => ({ visible: true, opacity: 100, ...l })), frames, palette: Array.isArray(p.palette) ? p.palette : [], trails };
}

export class EditorDoc {
  constructor({ w, h, fps, layers, frames, cels, palette, trails }) {
    this.w = w; this.h = h; this.fps = fps;
    this.layers = layers;       // [{ id, name, visible, opacity, locked }]
    this.frames = frames;       // [{ id, duration }]
    this.cels = cels;           // Map "frameId|layerId" -> ImageData
    this.palette = palette;     // ["#rrggbb"]
    this.trails = trails || []; // attack trails bound to this animation (trails/model.js)
    this.undoStack = [];
    this.redoStack = [];
    this.version = 0;           // bumps on every committed change (cache key)
    this.assetOf = new WeakMap(); // ImageData -> asset id it was loaded from / saved as
  }

  static async fromParams(params, loadCanvas) {
    const n = normalizeAnim(params);
    const cels = new Map();
    const assetOf = new WeakMap();
    for (const f of n.frames) {
      for (const l of n.layers) {
        const aid = f.cels[l.id];
        if (!aid) continue;
        const c = await loadCanvas(aid);
        let img = c.getContext("2d").getImageData(0, 0, c.width, c.height);
        if (img.width !== n.w || img.height !== n.h) img = reposition(img, n.w, n.h, 0, 0);
        else assetOf.set(img, aid);
        cels.set(f.id + "|" + l.id, img);
      }
    }
    const doc = new EditorDoc({
      w: n.w, h: n.h, fps: n.fps,
      layers: n.layers.map(copyLayer),
      frames: n.frames.map((f) => ({ id: f.id, duration: f.duration })),
      cels, palette: [...n.palette], trails: JSON.parse(JSON.stringify(n.trails)),
    });
    doc.assetOf = assetOf;
    if (!doc.layers.length) doc.layers.push({ id: uid("L"), name: "图层 1", visible: true, opacity: 100 });
    if (!doc.frames.length) doc.frames.push({ id: uid("F"), duration: null });
    return doc;
  }

  key(fi, li) { return this.frames[fi].id + "|" + this.layers[li].id; }
  cel(fi, li) { return this.cels.get(this.key(fi, li)) || null; }

  // a cel that may be written to: always a fresh object, created after the last
  // checkpoint, so no snapshot can see the writes
  editableCel(fi, li) {
    const k = this.key(fi, li);
    const old = this.cels.get(k);
    const img = old ? cloneImg(old) : blank(this.w, this.h);
    touch(img);
    this.cels.set(k, img);
    return img;
  }

  setCel(fi, li, img) { this.cels.set(this.key(fi, li), img); }

  // ---------- history ----------
  snapshot() {
    return {
      w: this.w, h: this.h, fps: this.fps,
      layers: this.layers.map(copyLayer),
      frames: this.frames.map((f) => ({ ...f })),
      cels: new Map(this.cels),
      palette: [...this.palette],
      trails: JSON.parse(JSON.stringify(this.trails)),
    };
  }

  restore(s) {
    Object.assign(this, { w: s.w, h: s.h, fps: s.fps, layers: s.layers, frames: s.frames, cels: s.cels, palette: s.palette, trails: s.trails });
    this.version++;
  }

  checkpoint() {
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack.length = 0;
    this.version++;
  }

  // drop the checkpoint just taken when the operation turned out to change nothing
  discardCheckpoint() { this.undoStack.pop(); }

  undo() {
    if (!this.undoStack.length) return false;
    this.redoStack.push(this.snapshot());
    this.restore(this.undoStack.pop());
    return true;
  }

  redo() {
    if (!this.redoStack.length) return false;
    this.undoStack.push(this.snapshot());
    this.restore(this.redoStack.pop());
    return true;
  }

  // ---------- frames ----------
  addFrame(at, copyFrom) {
    const f = { id: uid("F"), duration: copyFrom != null ? this.frames[copyFrom].duration : null };
    this.frames.splice(at, 0, f);
    if (copyFrom != null) {
      const src = this.frames[copyFrom >= at ? copyFrom + 1 : copyFrom];
      // sharing the ImageData is safe: cels are copy-on-write
      for (const l of this.layers) {
        const img = this.cels.get(src.id + "|" + l.id);
        if (img) this.cels.set(f.id + "|" + l.id, img);
        // a copied frame keeps its ghosts (frames lists are replaced, never edited in place)
        if (l.ghost && Array.isArray(l.ghost.frames) && l.ghost.frames.includes(src.id)) l.ghost.frames = [...l.ghost.frames, f.id];
      }
    }
    return at;
  }

  deleteFrame(fi) {
    if (this.frames.length < 2) return false;
    const f = this.frames.splice(fi, 1)[0];
    for (const l of this.layers) this.cels.delete(f.id + "|" + l.id);
    // an effect that started on it starts on the frame that took its place
    const next = this.frames[Math.min(fi, this.frames.length - 1)].id;
    for (const l of this.layers) if (l.vfx && l.vfx.start === f.id) l.vfx = { ...l.vfx, start: next };
    for (const t of this.trails) if (t.keys) delete t.keys[f.id];
    return true;
  }

  moveFrame(fi, d) {
    const to = fi + d;
    if (to < 0 || to >= this.frames.length) return fi;
    const [f] = this.frames.splice(fi, 1);
    this.frames.splice(to, 0, f);
    return to;
  }

  // ---------- layers (index 0 = bottom) ----------
  addLayer(at, name) {
    const l = { id: uid("L"), name: name || "图层 " + (this.layers.length + 1), visible: true, opacity: 100 };
    this.layers.splice(at, 0, l);
    return at;
  }

  duplicateLayer(li) {
    const src = this.layers[li];
    const l = { ...src, id: uid("L"), name: src.name + " 副本" };
    if (src.ghost) l.ghost = { ...src.ghost };
    if (src.vfx) l.vfx = { ...src.vfx };
    if (src.trail) {
      // a trail layer's content is its trail: copy that
      const t = this.trails.find((x) => x.id === src.trail);
      if (t) {
        const copy = { ...JSON.parse(JSON.stringify(t)), id: uid("T"), name: t.name + " 副本" };
        this.trails.push(copy);
        l.trail = copy.id;
      }
    }
    this.layers.splice(li + 1, 0, l);
    for (const f of this.frames) {
      const img = this.cels.get(f.id + "|" + src.id);
      if (img) this.cels.set(f.id + "|" + l.id, img);
    }
    return li + 1;
  }

  deleteLayer(li) {
    if (this.layers.length < 2) return false;
    const l = this.layers.splice(li, 1)[0];
    for (const f of this.frames) this.cels.delete(f.id + "|" + l.id);
    if (l.trail) this.trails = this.trails.filter((t) => t.id !== l.trail);
    // a ghost that copied this layer copies all layers instead
    for (const o of this.layers) if (o.ghost && o.ghost.source === l.id) o.ghost.source = "all";
    return true;
  }

  // a trail layer, created right above layer `li`
  addTrailLayer(li, trail) {
    this.trails.push(trail);
    const l = { id: uid("L"), name: trail.name, visible: true, opacity: 100, trail: trail.id };
    this.layers.splice(li + 1, 0, l);
    return li + 1;
  }

  trailLayerIndex(trailId) { return this.layers.findIndex((l) => l.trail === trailId); }

  // an effect (特效) layer, created right above layer `li` (or right below it:
  // an aura goes behind what it surrounds)
  addVfxLayer(li, vfx, name, below = false) {
    const l = { id: uid("L"), name: name || "特效", visible: true, opacity: 100, vfx };
    const at = below ? li : li + 1;
    this.layers.splice(at, 0, l);
    return at;
  }

  // a ghost (残影) layer, created right below layer `li`: the afterimage goes
  // behind what it copies
  addGhostLayer(li, ghost) {
    const n = this.layers.filter((l) => l.ghost).length;
    const l = { id: uid("L"), name: "残影" + (n ? " " + (n + 1) : ""), visible: true, opacity: 100, ghost };
    this.layers.splice(li, 0, l);
    return li;
  }

  moveLayer(li, d) {
    const to = li + d;
    if (to < 0 || to >= this.layers.length) return li;
    const [l] = this.layers.splice(li, 1);
    this.layers.splice(to, 0, l);
    return to;
  }

  mergeDown(li) {
    const special = (l) => l.trail || l.ghost || l.vfx;
    if (li < 1 || special(this.layers[li]) || special(this.layers[li - 1])) return false;
    const top = this.layers[li];
    for (let fi = 0; fi < this.frames.length; fi++) {
      const a = this.cel(fi, li);
      if (!a) continue;
      const base = this.cel(fi, li - 1);
      const c = createCanvas(this.w, this.h);
      const g = c.getContext("2d");
      if (base) {
        g.globalAlpha = 1;
        g.putImageData(base, 0, 0);
      }
      const t = createCanvas(this.w, this.h);
      t.getContext("2d").putImageData(a, 0, 0);
      g.globalAlpha = (top.opacity ?? 100) / 100;
      g.drawImage(t, 0, 0);
      this.setCel(fi, li - 1, g.getImageData(0, 0, this.w, this.h));
    }
    this.deleteLayer(li);
    return true;
  }

  // ---------- canvas size ----------
  resize(w, h, ax, ay) {
    const ox = ax === 0 ? 0 : ax === 2 ? w - this.w : Math.round((w - this.w) / 2);
    const oy = ay === 0 ? 0 : ay === 2 ? h - this.h : Math.round((h - this.h) / 2);
    for (const [k, img] of this.cels) this.cels.set(k, reposition(img, w, h, ox, oy));
    // trail paths live in document pixels too
    for (const t of this.trails) for (const k of Object.values(t.keys || {})) {
      k.a = [k.a[0] + ox, k.a[1] + oy];
      k.b = [k.b[0] + ox, k.b[1] + oy];
    }
    this.w = w; this.h = h;
  }

  // ---------- out ----------
  // Upload what changed and return animation card params. Unchanged cels reuse
  // the asset id they came from, so saving a one-pixel edit uploads one PNG.
  async toParams(upload) {
    const frames = [];
    for (let fi = 0; fi < this.frames.length; fi++) {
      const f = this.frames[fi];
      const cels = {};
      for (let li = 0; li < this.layers.length; li++) {
        const img = this.cel(fi, li);
        if (!img) continue;
        let aid = this.assetOf.get(img);
        if (!aid) {
          if (isEmpty(img)) continue;
          aid = await upload(img);
          this.assetOf.set(img, aid);
        }
        cels[this.layers[li].id] = aid;
      }
      frames.push({ id: f.id, duration: f.duration || null, cels });
    }
    return {
      w: this.w, h: this.h, fps: this.fps,
      layers: this.layers.map((l) => ({ id: l.id, name: l.name, visible: l.visible !== false, opacity: l.opacity ?? 100, locked: !!l.locked, ...(l.trail ? { trail: l.trail } : {}), ...(l.ghost ? { ghost: { ...l.ghost } } : {}), ...(l.vfx ? { vfx: { ...l.vfx } } : {}) })),
      frames,
      palette: [...this.palette],
      trails: JSON.parse(JSON.stringify(this.trails)),
    };
  }
}
