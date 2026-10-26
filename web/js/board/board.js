// The infinite canvas.
//
// Cards are absolutely positioned DOM nodes inside one transformed "world" layer
// (translate + scale), edges are SVG paths in the same layer. Card positions live
// in the document; the camera (view) is saved with it but kept out of history.
//
// screen = world * z + (x, y)
import { Emitter } from "../core/events.js";
import { el, uid, clamp, setPath } from "../core/util.js";
import { nodeType, compatible } from "../nodes/registry.js";
import { entriesFromDrop, filesFromEntries } from "../ui/importer.js";

export const HEAD_H = 34;
const PORT_Y0 = HEAD_H + 20;
const PORT_GAP = 26;
const MIN_Z = 0.05, MAX_Z = 8;
const SVG_NS = "http://www.w3.org/2000/svg";

const svg = (tag, attrs) => {
  const n = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
};

const isEditable = (t) => t && (t.closest("input, textarea, select, [contenteditable='true']"));

export class Board extends Emitter {
  constructor(root, app) {
    super();
    this.app = app;
    this.store = app.store;
    this.engine = app.engine;
    this.root = root;

    this.world = el("div", { class: "world" });
    this.groupLayer = el("div", { class: "layer layer-groups" });
    this.edgeSvg = svg("svg", { class: "edges" });
    this.cardLayer = el("div", { class: "layer layer-cards" });
    this.world.append(this.groupLayer, this.edgeSvg, this.cardLayer);
    this.marqueeEl = el("div", { class: "marquee" });
    this.emptyHint = el("div", { class: "board-empty" },
      el("div", { class: "board-empty-title" }, "把序列帧图片拖到这里开始"),
      el("div", null, "或者双击空白处添加节点 · 右键查看更多操作 · Ctrl+V 粘贴图片"));
    // zoom readout pinned to the board's bottom-right corner
    this.zoomLabel = el("button", { class: "zoom-pct mono", title: "当前缩放 · 点击回到 100%（Ctrl+0）", onclick: () => this.zoomTo(1) }, "100%");
    this.zoomHud = el("div", { class: "zoom-hud" },
      el("button", { title: "缩小（-）", onclick: () => this.zoomBy(1 / 1.25) }, "−"),
      this.zoomLabel,
      el("button", { title: "放大（+）", onclick: () => this.zoomBy(1.25) }, "+"),
      el("button", { title: "适应视图（F）", onclick: () => this.fitView() }, "⤢"));
    root.append(this.world, this.marqueeEl, this.emptyHint, this.zoomHud);

    this.cards = new Map(); // id -> entry { el, ctx, view, def, type, ports }
    this.selection = new Set();
    this.selEdge = null;
    this.space = false;
    this.drag = null;
    this.tempEdge = null;
    this.clip = null;

    root.addEventListener("pointerdown", (e) => this.onDown(e));
    root.addEventListener("click", (e) => {
      if (this.swallowClick) { e.stopPropagation(); e.preventDefault(); this.swallowClick = false; }
    }, true);
    window.addEventListener("pointermove", (e) => this.onMove(e));
    window.addEventListener("pointerup", (e) => this.onUp(e));
    window.addEventListener("pointercancel", (e) => this.onUp(e));
    root.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
    root.addEventListener("dblclick", (e) => this.onDblClick(e));
    root.addEventListener("contextmenu", (e) => this.onContextMenu(e));
    root.addEventListener("dragover", (e) => this.onDragOver(e));
    root.addEventListener("dragleave", () => root.classList.remove("drop-target"));
    root.addEventListener("drop", (e) => this.onDrop(e));
    window.addEventListener("keydown", (e) => this.onKey(e, true));
    window.addEventListener("keyup", (e) => this.onKey(e, false));
    window.addEventListener("blur", () => { this.space = false; root.classList.remove("can-pan"); });
    new ResizeObserver(() => this.applyView()).observe(root);

    this.store.on("change", () => this.sync());
    this.store.on("reset", () => this.sync(true));
    this.engine.on("result", (id) => this.renderCard(id));
    this.engine.on("busy", (id) => this.updateFoot(id));
  }

  get view() { return this.store.doc.board.view; }

  // ---------- coordinates ----------
  rect() { return this.root.getBoundingClientRect(); }

  toWorld(cx, cy) {
    const r = this.rect(), v = this.view;
    return { x: (cx - r.left - v.x) / v.z, y: (cy - r.top - v.y) / v.z };
  }

  centerWorld() {
    const r = this.rect();
    return this.toWorld(r.left + r.width / 2, r.top + r.height / 2);
  }

  portPos(cardId, dir, port) {
    const c = this.store.cards[cardId];
    if (!c) return null;
    const def = nodeType(c.type);
    if (!def) return null;
    const list = dir === "in" ? def.inputs : def.outputs;
    const i = list.findIndex((p) => p.name === port);
    if (i < 0) return null;
    return { x: dir === "in" ? c.x : c.x + c.w, y: c.y + PORT_Y0 + i * PORT_GAP };
  }

  // ---------- camera ----------
  applyView() {
    if (!this.store.doc) return;
    const v = this.view;
    this.world.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.z})`;
    // dot grid that stays readable: step doubles whenever dots would crowd
    let step = 24 * v.z;
    while (step < 12) step *= 2;
    this.root.style.backgroundSize = step + "px " + step + "px";
    this.root.style.backgroundPosition = v.x + "px " + v.y + "px";
    this.root.style.setProperty("--z", v.z);
    this.root.classList.toggle("zoomed-out", v.z < 0.45);
    this.zoomLabel.textContent = Math.round(v.z * 100) + "%";
    this.emit("view", v);
  }

  setView(v, save = true) {
    this.store.doc.board.view = v;
    this.applyView();
    if (save) this.store.setView(v);
  }

  zoomAt(cx, cy, factor) {
    const r = this.rect(), v = this.view;
    const px = cx - r.left, py = cy - r.top;
    const z = clamp(v.z * factor, MIN_Z, MAX_Z);
    const wx = (px - v.x) / v.z, wy = (py - v.y) / v.z;
    this.setView({ x: px - wx * z, y: py - wy * z, z });
  }

  zoomBy(factor) {
    const r = this.rect();
    this.zoomAt(r.left + r.width / 2, r.top + r.height / 2, factor);
  }

  zoomTo(z) { this.zoomBy(z / this.view.z); }

  fitView(ids) {
    const cards = this.store.cards;
    const list = (ids && ids.length ? ids : Object.keys(cards)).map((id) => cards[id]).filter(Boolean);
    const r = this.rect();
    if (!list.length) { this.setView({ x: r.width / 2, y: r.height / 2, z: 1 }); return; }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const c of list) {
      x0 = Math.min(x0, c.x); y0 = Math.min(y0, c.y);
      x1 = Math.max(x1, c.x + c.w); y1 = Math.max(y1, c.y + c.h);
    }
    const pad = 60;
    const z = clamp(Math.min((r.width - pad * 2) / (x1 - x0), (r.height - pad * 2) / (y1 - y0)), MIN_Z, 1.5);
    this.setView({ x: r.width / 2 - (x0 + x1) / 2 * z, y: r.height / 2 - (y0 + y1) / 2 * z, z });
  }

  // ---------- sync document -> DOM ----------
  sync(full) {
    if (!this.store.doc) return;
    const cards = this.store.cards;
    for (const [id, e] of this.cards) {
      if (!cards[id] || cards[id].type !== e.type) this.unmountCard(id);
    }
    for (const id in cards) {
      const e = this.cards.get(id) || this.mountCard(cards[id]);
      this.placeCard(e, cards[id]);
      this.renderCard(id);
    }
    for (const id of [...this.selection]) if (!cards[id]) this.selection.delete(id);
    if (this.selEdge && !this.store.edges[this.selEdge]) this.selEdge = null;
    this.renderEdges();
    this.applyView();
    this.emptyHint.style.display = Object.keys(cards).length ? "none" : "";
    if (full) this.emit("selection");
  }

  mountCard(card) {
    const def = nodeType(card.type) || {
      type: card.type, title: "未知节点 " + card.type, icon: "?", inputs: [], outputs: [], size: { w: 200, h: 120 },
    };
    const wb = def.category === "白板";
    const root = el("div", { class: "card t-" + card.type + (wb ? " wb" : ""), dataset: { id: card.id } });
    const title = el("span", { class: "card-title" });
    const tools = el("span", { class: "card-tools" });
    const state = el("span", { class: "card-state" });
    const head = el("div", { class: "card-head" }, el("span", { class: "card-ico" }, def.icon || "•"), title, tools, state);
    const body = el("div", { class: "card-body" });
    const foot = el("div", { class: "card-foot mono" });
    root.append(head, body);
    if (!wb) root.append(foot);

    if (def.evaluate && def.inputs.length && def.outputs.length) {
      const bp = el("button", { class: "tool-btn bypass-btn", title: "旁路：暂时跳过这一步，输入原样输出" }, "旁路");
      bp.addEventListener("click", (e) => {
        e.stopPropagation();
        this.store.mutate((d) => { const c = d.board.cards[card.id]; if (c) c.bypass = !c.bypass; });
      });
      tools.append(bp);
    }

    def.inputs.forEach((p, i) => root.append(this.portEl("in", p, i, p.accepts)));
    def.outputs.forEach((p, i) => root.append(this.portEl("out", p, i, p.kind === "same" ? ["same"] : [p.kind])));
    root.append(el("div", { class: "card-resize", title: "拖动调整大小" }));

    const ctx = this.makeCtx(card.id, def, body, tools, root);
    const entry = { id: card.id, type: card.type, def, el: root, head, title, tools, state, body, foot, ctx, view: null };
    this.cards.set(card.id, entry);
    (card.type === "group" ? this.groupLayer : this.cardLayer).append(root);
    try {
      entry.view = def.mount ? def.mount(ctx) : null;
    } catch (err) {
      console.error(err);
      body.textContent = "卡片加载失败：" + err.message;
    }
    return entry;
  }

  portEl(dir, p, i, kinds) {
    return el("div", {
      class: "port " + dir + " " + kinds.map((k) => "k-" + k).join(" "),
      dataset: { port: p.name, dir },
      style: { top: PORT_Y0 + i * PORT_GAP - 7 + "px" },
      title: p.label,
    }, el("span", { class: "port-label" }, p.label));
  }

  unmountCard(id) {
    const e = this.cards.get(id);
    if (!e) return;
    try { e.view && e.view.destroy && e.view.destroy(); } catch (err) { console.error(err); }
    e.el.remove();
    this.cards.delete(id);
  }

  placeCard(e, card) {
    const s = e.el.style;
    s.left = card.x + "px";
    s.top = card.y + "px";
    s.width = card.w + "px";
    s.height = card.h + "px";
    e.title.textContent = card.title || e.def.title;
    e.el.classList.toggle("selected", this.selection.has(card.id));
    e.el.classList.toggle("bypassed", !!card.bypass);
    const bp = e.tools.querySelector(".bypass-btn");
    if (bp) bp.classList.toggle("active", !!card.bypass);
  }

  renderCard(id) {
    const e = this.cards.get(id);
    if (!e) return;
    try { e.view && e.view.render && e.view.render(); } catch (err) { console.error(err); }
    this.updateFoot(id);
    this.emit("card-render", id);
  }

  updateFoot(id) {
    const e = this.cards.get(id);
    if (!e) return;
    const r = this.engine.result(id);
    const busy = !!(r && r.busy);
    e.el.classList.toggle("busy", busy);
    e.el.classList.toggle("errored", !!(r && r.error));
    e.state.textContent = busy ? "" : r && r.error ? "!" : "";
    if (!e.foot.isConnected) return;
    let text = "", tone = "";
    if (busy) text = "处理中…";
    else if (r && r.error) { text = r.error; tone = "error"; }
    else if (r && r.info && r.info.waiting) { text = r.info.waiting; tone = "dim"; }
    else if (r && r.info && r.info.warn) { text = "⚠ " + (r.info.text || r.info.warn); tone = "warn"; }
    else if (r && r.info && r.info.text) text = r.info.text;
    else if (!e.def.evaluate && e.def.inputs.length) {
      const v = this.engine.input(id, e.def.inputs[0].name);
      text = v ? (v.kind === "frames" ? v.frames.length + " 帧 · " + v.w + "×" + v.h : v.canvas.width + "×" + v.canvas.height) : "连接「" + e.def.inputs[0].label + "」";
      tone = v ? "" : "dim";
    }
    e.foot.textContent = text;
    e.foot.title = text;
    e.foot.dataset.tone = tone;
  }

  // ---------- edges ----------
  renderEdges() {
    const g = this.edgeSvg;
    g.replaceChildren();
    const edges = this.store.edges;
    for (const id in edges) {
      const e = edges[id];
      const a = this.portPos(e.from.card, "out", e.from.port);
      const b = this.portPos(e.to.card, "in", e.to.port);
      if (!a || !b) continue;
      const v = this.engine.outputOf(e.from.card, e.from.port);
      const kind = v ? v.kind : "none";
      const d = curve(a, b);
      g.append(
        svg("path", { d, class: "edge-hit", "data-edge": id }),
        svg("path", { d, class: "edge k-" + kind + (this.selEdge === id ? " selected" : "") }),
      );
    }
    if (this.tempEdge) {
      g.append(svg("path", { d: curve(this.tempEdge.a, this.tempEdge.b), class: "edge temp" + (this.tempEdge.ok ? " ok" : "") }));
    }
  }

  // ---------- selection ----------
  select(id, additive) {
    if (!additive) this.selection.clear();
    if (additive && this.selection.has(id)) this.selection.delete(id);
    else if (id) this.selection.add(id);
    this.selEdge = null;
    this.refreshSelection();
  }

  setSelection(ids) {
    this.selection = new Set(ids);
    this.selEdge = null;
    this.refreshSelection();
  }

  clearSelection() {
    if (!this.selection.size && !this.selEdge) return;
    this.selection.clear();
    this.selEdge = null;
    this.refreshSelection();
  }

  refreshSelection() {
    for (const [id, e] of this.cards) e.el.classList.toggle("selected", this.selection.has(id));
    this.renderEdges();
    this.emit("selection");
  }

  selectedIds() { return [...this.selection].filter((id) => this.store.cards[id]); }

  // ---------- pointer ----------
  onDown(e) {
    const t = e.target;
    if (t.closest(".menu, .zoom-hud")) return;
    if (e.button === 1 || (e.button === 0 && this.space)) {
      e.preventDefault();
      const v = this.view;
      this.drag = { type: "pan", sx: e.clientX, sy: e.clientY, vx: v.x, vy: v.y };
      this.root.classList.add("panning");
      return;
    }
    if (e.button !== 0) return;

    const port = t.closest(".port");
    if (port) { e.preventDefault(); this.beginConnect(e, port); return; }

    const cardEl = t.closest(".card");
    if (t.closest(".card-resize") && cardEl) { e.preventDefault(); this.beginResize(e, cardEl.dataset.id); return; }

    const edgeHit = t.closest(".edge-hit");
    if (edgeHit) {
      this.selection.clear();
      this.selEdge = edgeHit.dataset.edge;
      this.refreshSelection();
      return;
    }

    if (cardEl) {
      const id = cardEl.dataset.id;
      const interactive = t.closest("button, input, select, textarea, a, label, [contenteditable='true']");
      if (e.shiftKey || e.ctrlKey) this.select(id, true);
      else if (!this.selection.has(id)) this.select(id, false);
      // the whole card is a drag handle — header, image, empty space — except its
      // controls; tools that paint or pick on the image stop the event before here
      if (!interactive) { e.preventDefault(); this.beginMove(e); }
      return;
    }

    // empty board: marquee select
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    const additive = e.shiftKey || e.ctrlKey;
    if (!additive) this.clearSelection();
    this.drag = { type: "marquee", sx: e.clientX, sy: e.clientY, base: new Set(this.selection), moved: false };
  }

  beginMove(e) {
    const cards = this.store.cards;
    const moving = new Set(this.selectedIds());
    // a group carries everything that sits entirely inside it
    for (const id of [...moving]) {
      const g = cards[id];
      if (!g || g.type !== "group") continue;
      for (const k in cards) {
        const c = cards[k];
        if (k !== id && c.x >= g.x && c.y >= g.y && c.x + c.w <= g.x + g.w && c.y + c.h <= g.y + g.h) moving.add(k);
      }
    }
    this.drag = {
      type: "move", sx: e.clientX, sy: e.clientY, moved: false,
      items: [...moving].map((id) => ({ id, x: cards[id].x, y: cards[id].y })),
    };
  }

  beginResize(e, id) {
    const c = this.store.cards[id];
    this.select(id, false);
    this.drag = { type: "resize", id, sx: e.clientX, sy: e.clientY, w: c.w, h: c.h, moved: false };
  }

  beginConnect(e, portEl) {
    const cardEl = portEl.closest(".card");
    const id = cardEl.dataset.id, port = portEl.dataset.port, dir = portEl.dataset.dir;
    let from = null, to = null;
    if (dir === "in") {
      const existing = this.engine.edgeInto(id, port);
      if (existing) {
        // grabbing a connected input picks the wire up off it
        from = existing.from;
        this.store.mutate((d) => { delete d.board.edges[existing.id]; });
      } else {
        to = { card: id, port };
      }
    } else {
      from = { card: id, port };
    }
    const anchor = from ? this.portPos(from.card, "out", from.port) : this.portPos(to.card, "in", to.port);
    this.drag = { type: "connect", from, to, anchor };
    this.tempEdge = { a: anchor, b: anchor, ok: false };
    this.markCompatiblePorts(from, to);
    this.root.classList.add("connecting");
  }

  markCompatiblePorts(from, to) {
    for (const [cid, e] of this.cards) {
      for (const p of e.el.querySelectorAll(".port")) {
        let ok = false;
        if (from && p.dataset.dir === "in" && cid !== from.card) ok = this.canConnect(from, { card: cid, port: p.dataset.port });
        if (to && p.dataset.dir === "out" && cid !== to.card) ok = this.canConnect({ card: cid, port: p.dataset.port }, to);
        p.classList.toggle("ok", ok);
      }
    }
  }

  canConnect(from, to) {
    const cards = this.store.cards;
    const a = cards[from.card], b = cards[to.card];
    if (!a || !b || from.card === to.card) return false;
    const da = nodeType(a.type), db = nodeType(b.type);
    if (!da || !db || !compatible(da, from.port, db, to.port)) return false;
    return !this.reaches(to.card, from.card);
  }

  // is there a path a -> ... -> b along edges? (connecting b -> a would close a cycle)
  reaches(a, b) {
    const edges = Object.values(this.store.edges);
    const seen = new Set();
    const stack = [a];
    while (stack.length) {
      const n = stack.pop();
      if (n === b) return true;
      if (seen.has(n)) continue;
      seen.add(n);
      for (const e of edges) if (e.from.card === n) stack.push(e.to.card);
    }
    return false;
  }

  connect(from, to, opts = {}) {
    if (!this.canConnect(from, to)) return false;
    this.store.mutate((d) => {
      for (const k in d.board.edges) {
        const e = d.board.edges[k];
        if (e.to.card === to.card && e.to.port === to.port) delete d.board.edges[k];
      }
      const id = uid("e");
      d.board.edges[id] = { id, from: { ...from }, to: { ...to } };
    }, { coalesce: opts.coalesce });
    return true;
  }

  // the first port on `cardId` that can take part in from/to
  firstCompatiblePort(cardId, from, to) {
    const c = this.store.cards[cardId];
    const def = c && nodeType(c.type);
    if (!def) return null;
    if (from) {
      const free = def.inputs.filter((p) => this.canConnect(from, { card: cardId, port: p.name }));
      return (free.find((p) => !this.engine.edgeInto(cardId, p.name)) || free[0] || {}).name || null;
    }
    const p = def.outputs.find((o) => this.canConnect({ card: cardId, port: o.name }, to));
    return p ? p.name : null;
  }

  onMove(e) {
    const d = this.drag;
    if (!d) return;
    const v = this.view;
    if (d.type === "pan") {
      this.setView({ x: d.vx + e.clientX - d.sx, y: d.vy + e.clientY - d.sy, z: v.z }, false);
      return;
    }
    const dx = (e.clientX - d.sx) / v.z, dy = (e.clientY - d.sy) / v.z;
    if (!d.moved && Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) < 3) return;

    if (d.type === "move") {
      if (!d.moved) { this.store.checkpoint(); d.moved = true; this.root.classList.add("dragging"); }
      for (const it of d.items) {
        const c = this.store.cards[it.id];
        if (!c) continue;
        c.x = Math.round(it.x + dx);
        c.y = Math.round(it.y + dy);
        const en = this.cards.get(it.id);
        if (en) this.placeCard(en, c);
      }
      this.renderEdges();
    } else if (d.type === "resize") {
      if (!d.moved) { this.store.checkpoint(); d.moved = true; }
      const c = this.store.cards[d.id];
      if (!c) return;
      const def = nodeType(c.type) || {};
      const min = def.minSize || { w: 180, h: 140 };
      c.w = Math.round(Math.max(min.w, d.w + dx));
      c.h = Math.round(Math.max(min.h, d.h + dy));
      const en = this.cards.get(d.id);
      if (en) { this.placeCard(en, c); en.view && en.view.onResize && en.view.onResize(); }
      this.renderEdges();
    } else if (d.type === "connect") {
      d.moved = true;
      const p = this.toWorld(e.clientX, e.clientY);
      const hit = document.elementFromPoint(e.clientX, e.clientY);
      const port = hit && hit.closest(".port.ok");
      const target = port ? this.portPos(port.closest(".card").dataset.id, port.dataset.dir, port.dataset.port) : p;
      this.tempEdge = d.from ? { a: d.anchor, b: target, ok: !!port } : { a: target, b: d.anchor, ok: !!port };
      this.renderEdges();
    } else if (d.type === "marquee") {
      d.moved = true;
      const r = this.rect();
      const x0 = Math.min(d.sx, e.clientX), y0 = Math.min(d.sy, e.clientY);
      const x1 = Math.max(d.sx, e.clientX), y1 = Math.max(d.sy, e.clientY);
      Object.assign(this.marqueeEl.style, {
        display: "block", left: x0 - r.left + "px", top: y0 - r.top + "px", width: x1 - x0 + "px", height: y1 - y0 + "px",
      });
      const a = this.toWorld(x0, y0), b = this.toWorld(x1, y1);
      const sel = new Set(d.base);
      for (const id in this.store.cards) {
        const c = this.store.cards[id];
        // groups need to be fully enclosed, otherwise every drag inside one grabs it
        const hit = c.type === "group"
          ? c.x >= a.x && c.y >= a.y && c.x + c.w <= b.x && c.y + c.h <= b.y
          : c.x < b.x && c.x + c.w > a.x && c.y < b.y && c.y + c.h > a.y;
        if (hit) sel.add(id);
      }
      this.selection = sel;
      for (const [id, en] of this.cards) en.el.classList.toggle("selected", sel.has(id));
    }
  }

  onUp(e) {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    this.root.classList.remove("panning", "dragging", "connecting");
    if (d.type === "pan") { this.store.setView(this.view); return; }
    if (d.type === "move" || d.type === "resize") {
      if (d.moved) {
        this.store.mutate(() => {}, { history: false });
        // the click that follows a drag must not also act on the card (e.g. toggle
        // a slice cell under the pointer)
        this.swallowClick = true;
        setTimeout(() => { this.swallowClick = false; }, 0);
      }
      return;
    }
    if (d.type === "marquee") {
      this.marqueeEl.style.display = "none";
      if (d.moved) this.emit("selection");
      return;
    }
    if (d.type === "connect") {
      this.tempEdge = null;
      for (const p of this.root.querySelectorAll(".port.ok")) p.classList.remove("ok");
      const hit = document.elementFromPoint(e.clientX, e.clientY);
      const port = hit && hit.closest(".port");
      const cardEl = hit && hit.closest(".card");
      if (port && cardEl) {
        const target = { card: cardEl.dataset.id, port: port.dataset.port };
        if (d.from && port.dataset.dir === "in") this.connect(d.from, target);
        else if (d.to && port.dataset.dir === "out") this.connect(target, d.to);
      } else if (cardEl) {
        // dropped on a card body: use its first port that fits
        const cid = cardEl.dataset.id;
        const p = this.firstCompatiblePort(cid, d.from, d.to);
        if (p) d.from ? this.connect(d.from, { card: cid, port: p }) : this.connect({ card: cid, port: p }, d.to);
      } else if (d.moved && this.root.contains(hit)) {
        // dropped on empty board: offer the node types that can continue the wire
        const at = this.toWorld(e.clientX, e.clientY);
        this.app.showAddMenu(e.clientX, e.clientY, {
          from: d.from, to: d.to,
          onPick: (type) => {
            const def = nodeType(type);
            const pos = d.from ? { x: at.x, y: at.y - PORT_Y0 } : { x: at.x - def.size.w, y: at.y - PORT_Y0 };
            const id = this.app.addCard(type, pos.x, pos.y);
            const p = this.firstCompatiblePort(id, d.from, d.to);
            if (p) d.from ? this.connect(d.from, { card: id, port: p }, { coalesce: "add-" + id }) : this.connect({ card: id, port: p }, d.to, { coalesce: "add-" + id });
          },
        });
      }
      this.renderEdges();
    }
  }

  onWheel(e) {
    const scroller = e.target.closest(".scroll-y");
    if (scroller && !e.ctrlKey && scroller.scrollHeight > scroller.clientHeight) return;
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const dy = e.deltaY * unit;
    // trackpad pinches arrive as ctrl+wheel with small deltas
    // one mouse-wheel notch (~100) ≈ 18%; trackpad pinch deltas are small, so faster
    const factor = Math.exp(-clamp(dy, -300, 300) * (e.ctrlKey ? 0.01 : 0.002));
    this.zoomAt(e.clientX, e.clientY, factor);
  }

  onDblClick(e) {
    const t = e.target;
    if (isEditable(t) || t.closest("button, .zoom-hud")) return;
    const cardEl = t.closest(".card");
    if (cardEl) {
      const id = cardEl.dataset.id;
      if (t.closest(".card-title")) { this.renameCard(id); return; }
      const en = this.cards.get(id);
      if (en && en.def.open) en.def.open(en.ctx);
      return;
    }
    if (t.closest(".port, .edge-hit")) return;
    const at = this.toWorld(e.clientX, e.clientY);
    this.app.showAddMenu(e.clientX, e.clientY, { onPick: (type) => this.app.addCard(type, at.x, at.y, null, { select: true }) });
  }

  renameCard(id) {
    const en = this.cards.get(id);
    if (!en) return;
    const t = en.title;
    t.contentEditable = "true";
    t.focus();
    document.getSelection().selectAllChildren(t);
    const done = (commit) => {
      t.contentEditable = "false";
      t.removeEventListener("keydown", onKey);
      t.removeEventListener("blur", onBlur);
      const name = t.textContent.trim();
      const card = this.store.cards[id];
      if (commit && card && name !== (card.title || en.def.title)) {
        this.store.mutate((d) => { d.board.cards[id].title = name === en.def.title ? "" : name; });
      } else if (card) {
        t.textContent = card.title || en.def.title;
      }
    };
    const onKey = (e) => {
      if (e.key === "Enter") { e.preventDefault(); t.blur(); }
      if (e.key === "Escape") { e.preventDefault(); done(false); }
      e.stopPropagation();
    };
    const onBlur = () => done(true);
    t.addEventListener("keydown", onKey);
    t.addEventListener("blur", onBlur);
  }

  onContextMenu(e) {
    e.preventDefault();
    const t = e.target;
    const cardEl = t.closest(".card");
    const edgeHit = t.closest(".edge-hit");
    if (edgeHit) {
      const id = edgeHit.dataset.edge;
      this.app.showMenu(e.clientX, e.clientY, [{ label: "删除连线", action: () => this.store.mutate((d) => { delete d.board.edges[id]; }) }]);
      return;
    }
    if (cardEl) {
      const id = cardEl.dataset.id;
      if (!this.selection.has(id)) this.select(id, false);
      this.app.showMenu(e.clientX, e.clientY, this.app.cardMenu(id));
      return;
    }
    const at = this.toWorld(e.clientX, e.clientY);
    this.app.showMenu(e.clientX, e.clientY, this.app.boardMenu(at, e.clientX, e.clientY));
  }

  // ---------- drag & drop ----------
  onDragOver(e) {
    const types = [...(e.dataTransfer.types || [])];
    if (types.includes("Files") || types.includes("application/x-guangtai-node")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      this.root.classList.add("drop-target");
    }
  }

  onDrop(e) {
    this.root.classList.remove("drop-target");
    const at = this.toWorld(e.clientX, e.clientY);
    const nodeTypeName = e.dataTransfer.getData("application/x-guangtai-node");
    if (nodeTypeName) {
      e.preventDefault();
      this.app.addCard(nodeTypeName, at.x - 40, at.y - 20, null, { select: true });
      return;
    }
    // a dropped folder is a frame sequence: read everything inside it
    const entries = entriesFromDrop(e.dataTransfer);
    if (entries) {
      e.preventDefault();
      filesFromEntries(entries)
        .then((files) => this.app.addFiles(files, at, { folder: true }))
        .catch((err) => this.app.toast("读取文件夹失败：" + err.message, "error"));
      return;
    }
    const files = [...(e.dataTransfer.files || [])];
    if (files.length) {
      e.preventDefault();
      this.app.addFiles(files, at);
    }
  }

  // ---------- keyboard ----------
  onKey(e, down) {
    if (e.code === "Space") {
      if (isEditable(e.target)) return;
      if (down && !e.repeat) { this.space = true; this.root.classList.add("can-pan"); }
      if (!down) { this.space = false; this.root.classList.remove("can-pan"); }
      if (down) e.preventDefault();
      return;
    }
    if (!down || isEditable(e.target)) return;
    if (this.app.modalOpen && this.app.modalOpen()) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (k === "delete" || k === "backspace") { e.preventDefault(); this.deleteSelection(); }
    else if (k === "escape") { this.app.clearModes(); this.clearSelection(); }
    else if (mod && k === "a") { e.preventDefault(); this.setSelection(Object.keys(this.store.cards)); }
    else if (mod && k === "d") { e.preventDefault(); this.duplicate(); }
    else if (mod && k === "c") { this.copy(); }
    else if (mod && k === "x") { this.copy(); this.deleteSelection(); }
    else if (mod && k === "0") { e.preventDefault(); this.zoomTo(1); }
    else if (!mod && (k === "f" || (e.shiftKey && e.code === "Digit1"))) { this.fitView(this.selectedIds()); }
    else if (!mod && (k === "=" || k === "+")) this.zoomBy(1.2);
    else if (!mod && k === "-") this.zoomBy(1 / 1.2);
  }

  deleteSelection() {
    if (this.selEdge) {
      const id = this.selEdge;
      this.selEdge = null;
      this.store.mutate((d) => { delete d.board.edges[id]; });
      return;
    }
    const ids = this.selectedIds();
    if (!ids.length) return;
    this.store.mutate((d) => removeCards(d, ids));
    this.selection.clear();
    this.emit("selection");
  }

  // ---------- clipboard ----------
  copy() {
    const ids = this.selectedIds();
    if (!ids.length) return false;
    const set = new Set(ids);
    const cards = ids.map((id) => JSON.parse(JSON.stringify(this.store.cards[id])));
    const edges = Object.values(this.store.edges).filter((e) => set.has(e.from.card) && set.has(e.to.card))
      .map((e) => JSON.parse(JSON.stringify(e)));
    this.clip = { cards, edges, pastes: 0 };
    return true;
  }

  paste(at) {
    if (!this.clip) return false;
    this.clip.pastes++;
    let dx = 32 * this.clip.pastes, dy = 32 * this.clip.pastes;
    if (at) {
      const x0 = Math.min(...this.clip.cards.map((c) => c.x)), y0 = Math.min(...this.clip.cards.map((c) => c.y));
      dx = at.x - x0; dy = at.y - y0;
    }
    const map = new Map();
    this.store.mutate((d) => {
      for (const c of this.clip.cards) {
        const id = uid("c");
        map.set(c.id, id);
        d.board.cards[id] = { ...JSON.parse(JSON.stringify(c)), id, x: Math.round(c.x + dx), y: Math.round(c.y + dy) };
      }
      for (const e of this.clip.edges) {
        const id = uid("e");
        d.board.edges[id] = { id, from: { card: map.get(e.from.card), port: e.from.port }, to: { card: map.get(e.to.card), port: e.to.port } };
      }
    });
    this.setSelection([...map.values()]);
    return true;
  }

  duplicate() {
    const saved = this.clip;
    if (!this.copy()) return;
    this.paste();
    this.clip = saved;
  }

  // ---------- per-card context ----------
  makeCtx(id, def, body, tools, cardEl) {
    const board = this, store = this.store, engine = this.engine, app = this.app;
    // view toggles a node type lists in `persist` start from what was saved with the
    // card, so reopening a project shows each card the way it was left
    const saved = (store.cards[id] && store.cards[id].ui) || {};
    const local = {};
    for (const k of def.persist || []) if (k in saved) local[k] = saved[k];
    const ctx = {
      id, def, body, tools, cardEl, local, app, board, store, engine,
      card: () => store.cards[id],
      params: () => (store.cards[id] || {}).params || {},
      set(patch, opts = {}) {
        if (!store.cards[id]) return;
        store.mutate((d) => {
          const c = d.board.cards[id];
          if (!c) return;
          if (typeof patch === "function") patch(c.params, c);
          else for (const k in patch) setPath(c.params, k, patch[k]);
        }, { coalesce: opts.coalesce, history: opts.history });
      },
      setLocal(patch) {
        Object.assign(ctx.local, patch);
        const keep = (def.persist || []).filter((k) => k in patch);
        const c = store.cards[id];
        if (keep.length && c) {
          c.ui = c.ui || {};
          for (const k of keep) c.ui[k] = patch[k];
          store.scheduleSave();
        }
        board.renderCard(id);
        board.emit("local", id);
      },
      input: (port) => engine.input(id, port),
      output: (port) => engine.outputOf(id, port),
      result: () => engine.result(id),
      toast: (msg, tone) => app.toast(msg, tone),
    };
    return ctx;
  }

  ctxOf(id) {
    const e = this.cards.get(id);
    return e ? e.ctx : null;
  }
}

export function removeCards(doc, ids) {
  const set = new Set(ids);
  for (const id of ids) delete doc.board.cards[id];
  for (const k in doc.board.edges) {
    const e = doc.board.edges[k];
    if (set.has(e.from.card) || set.has(e.to.card)) delete doc.board.edges[k];
  }
  // a 场景's items showing a card that is gone go with it (one undo brings both back)
  for (const k in doc.board.cards) {
    const c = doc.board.cards[k];
    if (c.type === "scene" && c.params && Array.isArray(c.params.items) && c.params.items.some((it) => set.has(it.card))) {
      c.params.items = c.params.items.filter((it) => !set.has(it.card));
    }
  }
}

function curve(a, b) {
  const dx = Math.max(40, Math.abs(b.x - a.x) * 0.5);
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
}
