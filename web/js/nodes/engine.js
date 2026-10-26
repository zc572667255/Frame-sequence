// Graph evaluation.
//
// Each processing node's result is cached under a key built from its params and
// the `ver` of every value feeding it. A pass walks the graph in topological order
// and re-runs only the nodes whose key changed, so tweaking a slider on the last
// node never recomputes the expensive de-pixelation upstream.
import { Emitter } from "../core/events.js";
import { nodeType } from "./registry.js";
import { getAssetCanvas } from "../core/assets.js";

export class Engine extends Emitter {
  constructor(store) {
    super();
    this.store = store;
    this.results = new Map(); // cardId -> { key, outputs, info, view, error, busy }
    this.verSeq = 0;
    this.running = false;
    this.again = false;
    this.raf = 0;
    store.on("change", () => this.schedule());
    store.on("reset", () => this.schedule());
  }

  result(id) { return this.results.get(id) || null; }

  // the value arriving at card `id`'s input `port`, or null
  input(id, port) {
    const e = this.edgeInto(id, port);
    if (!e) return null;
    const r = this.results.get(e.from.card);
    return (r && r.outputs && r.outputs[e.from.port]) || null;
  }

  edgeInto(id, port) {
    const edges = this.store.edges;
    for (const k in edges) {
      const e = edges[k];
      if (e.to.card === id && e.to.port === port) return e;
    }
    return null;
  }

  // a node without evaluate() (preview, export) still exposes what it receives,
  // so views can treat every card the same way
  outputOf(id, port) {
    const r = this.results.get(id);
    return (r && r.outputs && r.outputs[port]) || null;
  }

  schedule() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.run(); });
  }

  async run() {
    if (this.running) { this.again = true; return; }
    this.running = true;
    try {
      do {
        this.again = false;
        await this.pass();
      } while (this.again);
    } finally {
      this.running = false;
    }
  }

  // the cards a card draws on without a connection (a 场景's items): def.refs(params)
  refsOf(card) {
    const def = nodeType(card.type);
    return def && def.refs ? def.refs(card.params || {}).filter((id) => id !== card.id && this.store.cards[id]) : [];
  }

  // does anything take this card's output?
  isUsed(id) {
    const edges = this.store.edges;
    for (const k in edges) if (edges[k].from.card === id) return true;
    return false;
  }

  topoOrder() {
    const cards = this.store.cards, edges = this.store.edges;
    const indeg = new Map(), out = new Map();
    for (const id in cards) { indeg.set(id, 0); out.set(id, []); }
    const link = (from, to) => {
      if (!indeg.has(from) || !indeg.has(to)) return;
      indeg.set(to, indeg.get(to) + 1);
      out.get(from).push(to);
    };
    for (const k in edges) link(edges[k].from.card, edges[k].to.card);
    // what a card refers to is worked out before it, like an input
    for (const id in cards) for (const r of this.refsOf(cards[id])) link(r, id);
    const queue = [...indeg].filter(([, d]) => d === 0).map(([id]) => id);
    const order = [];
    while (queue.length) {
      const id = queue.shift();
      order.push(id);
      for (const n of out.get(id)) {
        indeg.set(n, indeg.get(n) - 1);
        if (indeg.get(n) === 0) queue.push(n);
      }
    }
    // cycles are refused at connect time; one through references (which can't
    // be refused there) leaves its cards out here rather than hanging
    return order;
  }

  async pass() {
    const cards = this.store.cards;
    for (const id of [...this.results.keys()]) if (!cards[id]) this.results.delete(id);

    for (const id of this.topoOrder()) {
      const card = this.store.cards[id];
      if (!card) continue; // deleted while an earlier node was running
      const def = nodeType(card.type);
      if (!def) continue;

      const inputs = {};
      const parts = [card.type, card.bypass ? "bypass" : "", def.evaluate ? JSON.stringify(card.params) : ""];
      for (const inp of def.inputs) {
        const e = this.edgeInto(id, inp.name);
        const v = e ? this.outputOf(e.from.card, e.from.port) : null;
        inputs[inp.name] = v;
        parts.push(v ? v.ver : "-");
      }
      // what it refers to (their outputs' versions), and, for a card that only
      // works when something takes its output (def.whenUsed), whether anything does
      for (const r of this.refsOf(card)) {
        const rr = this.results.get(r);
        parts.push(r + "@" + (rr && rr.outputs ? Object.values(rr.outputs).map((o) => (o ? o.ver : "-")).join(",") : "-"));
      }
      const used = def.whenUsed ? this.isUsed(id) : true;
      if (def.whenUsed) parts.push(used ? "used" : "unused");
      const key = parts.join("|");
      const prev = this.results.get(id);
      if (prev && prev.key === key && !prev.busy) continue;

      if (!def.evaluate) {
        // pass-through: views read the input directly
        this.results.set(id, { key, outputs: {}, inputs, info: null, view: null, error: null });
        this.emit("result", id);
        continue;
      }

      if (card.bypass && def.inputs.length && def.outputs.length) {
        // bypassed: the first input flows straight to the first output, so a step
        // can be switched off without deleting it or rewiring around it
        const v = inputs[def.inputs[0].name];
        const outputs = {};
        if (v) outputs[def.outputs[0].name] = { ...v, ver: ++this.verSeq };
        this.results.set(id, { key, outputs, info: { text: "已旁路：原样输出" }, view: null, error: null, bypassed: true });
        this.emit("result", id);
        continue;
      }

      const missing = def.inputs.find((i) => !i.optional && !inputs[i.name]);
      if (missing) {
        this.results.set(id, { key, outputs: {}, info: { waiting: "连接「" + missing.label + "」输入" }, view: null, error: null });
        this.emit("result", id);
        continue;
      }

      // Only a node that was slow last time shows the spinner, which costs a frame
      // of latency to paint. Fast nodes (most edits while dragging a slider) run
      // straight through, so the result lands in the same frame as the edit.
      const slow = !prev || prev.ms == null || prev.ms > 30;
      if (slow) {
        this.results.set(id, { ...(prev || { outputs: {} }), key: null, busy: true });
        this.emit("busy", id);
        await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
        if (!this.store.cards[id]) continue;
      }

      let res;
      const t0 = performance.now();
      try {
        const r = (await def.evaluate(card.params, inputs, { ...this.ctx(), id, used })) || {};
        const outputs = r.outputs || {};
        for (const k in outputs) if (outputs[k]) outputs[k].ver = ++this.verSeq;
        res = { key, outputs, info: r.info || null, view: r.view || null, error: null, ms: performance.now() - t0 };
      } catch (err) {
        console.error(err);
        res = { key, outputs: {}, info: null, view: null, error: err && err.message ? err.message : String(err) };
      }
      // params changed mid-run: the next pass recomputes; don't flash a stale result
      // as if it were current, but do keep it so the card isn't blank meanwhile
      this.results.set(id, res);
      this.emit("result", id);
    }
  }

  ctx() {
    const store = this.store;
    return {
      projectId: store.projectId,
      asset: (aid) => getAssetCanvas(store.projectId, aid),
      // for a card reading other cards' results (refs)
      store, engine: this,
    };
  }
}
