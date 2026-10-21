// The project document and its history.
//
// Everything that should survive a reload or be undoable lives in `doc`; transient
// UI state (which tool is active, is a preview playing) stays with the views.
// History is whole-document JSON snapshots: documents hold parameters and asset
// ids, never pixels, so a snapshot is small and undo can't drift out of sync.
import { Emitter } from "./events.js";
import { api } from "./api.js";
import { debounce } from "./util.js";

const HISTORY_LIMIT = 200;
const COALESCE_MS = 1200;

export class Store extends Emitter {
  constructor() {
    super();
    this.doc = null;
    this.projectId = null;
    this.undoStack = [];
    this.redoStack = [];
    this.coalesce = null; // { key, t }
    this.saveState = "saved"; // saved | dirty | saving | error
    this.saveError = null;
    this._save = debounce(() => this.saveNow(), 700);
  }

  load(projectId, doc, projectPath) {
    this._save.flush();
    this.projectId = projectId;
    this.projectPath = projectPath || "";
    this.doc = migrate(doc);
    this.undoStack = [];
    this.redoStack = [];
    this.coalesce = null;
    this.setSaveState("saved");
    this.emit("reset");
  }

  get cards() { return this.doc.board.cards; }
  get edges() { return this.doc.board.edges; }

  // Push an undo step. Calls sharing a coalesce key within COALESCE_MS of each
  // other collapse into one step, so a slider drag or a brush stroke undoes as a
  // single action instead of a hundred.
  checkpoint(coalesceKey) {
    const now = performance.now();
    const c = this.coalesce;
    if (coalesceKey && c && c.key === coalesceKey && now - c.t < COALESCE_MS) {
      c.t = now;
      return;
    }
    this.undoStack.push(JSON.stringify(this.doc));
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack.length = 0;
    this.coalesce = coalesceKey ? { key: coalesceKey, t: now } : null;
  }

  // mutate(fn, { history = true, coalesce, silent })
  mutate(fn, opts = {}) {
    if (opts.history !== false) this.checkpoint(opts.coalesce);
    fn(this.doc);
    if (!opts.silent) this.emit("change");
    this.scheduleSave();
  }

  setView(view) {
    this.doc.board.view = view;
    this.scheduleSave();
  }

  // UI state that should come back when the project is reopened (selection, panel
  // visibility, per-card view toggles) — saved with the document but never undone
  setUi(patch) {
    if (!this.doc) return;
    Object.assign(this.doc.ui, patch);
    this.scheduleSave();
  }

  canUndo() { return this.undoStack.length > 0; }
  canRedo() { return this.redoStack.length > 0; }

  undo() { this._step(this.undoStack, this.redoStack); }
  redo() { this._step(this.redoStack, this.undoStack); }

  _step(from, to) {
    if (!from.length) return;
    to.push(JSON.stringify(this.doc));
    // camera position and UI state are not part of history
    const view = this.doc.board.view, ui = this.doc.ui, cardsBefore = this.doc.board.cards;
    this.doc = migrate(JSON.parse(from.pop()));
    this.doc.board.view = view;
    this.doc.ui = ui;
    for (const id in this.doc.board.cards) {
      if (cardsBefore[id]) this.doc.board.cards[id].ui = cardsBefore[id].ui;
    }
    this.coalesce = null;
    this.emit("reset");
    this.scheduleSave();
  }

  rename(name) {
    this.mutate((d) => { d.name = name; }, { history: false });
    this.emit("meta");
  }

  scheduleSave() {
    if (!this.projectId) return;
    this.setSaveState("dirty");
    this._save();
  }

  async saveNow() {
    if (!this.projectId) return;
    // one request at a time: two PUTs racing could land out of order and leave
    // the older document on disk
    if (this._inflight) { this._again = true; return; }
    const id = this.projectId;
    const body = JSON.stringify(this.doc);
    this._inflight = true;
    this.setSaveState("saving");
    try {
      const r = await api.saveProject(id, body);
      if (id === this.projectId) {
        this.doc.updatedAt = r.updatedAt;
        // something changed while the request was in flight: another save is queued
        if (this.saveState === "saving") this.setSaveState("saved");
      }
    } catch (err) {
      this.saveError = err.message;
      this.setSaveState("error");
    } finally {
      this._inflight = false;
      if (this._again) { this._again = false; this.saveNow(); }
    }
  }

  flushSave() { this._save.flush(); }

  // the page is going away: send whatever isn't on disk yet as a keepalive request,
  // which the browser finishes even after the tab closes
  saveOnExit() {
    this._save.cancel();
    if (!this.projectId || this.saveState === "saved") return;
    api.saveProject(this.projectId, JSON.stringify(this.doc), { keepalive: true }).catch(() => {});
  }

  setSaveState(s) {
    this.saveState = s;
    this.emit("save", s);
  }
}

// bring documents from older builds up to the current shape
export function migrate(doc) {
  doc.format = doc.format || 1;
  doc.board = doc.board || {};
  doc.board.view = doc.board.view || { x: 0, y: 0, z: 1 };
  doc.board.cards = doc.board.cards || {};
  doc.board.edges = doc.board.edges || {};
  doc.ui = doc.ui || {};
  for (const id in doc.board.cards) {
    const c = doc.board.cards[id];
    c.id = id;
    c.params = c.params || {};
    c.ui = c.ui || {};
  }
  return doc;
}
