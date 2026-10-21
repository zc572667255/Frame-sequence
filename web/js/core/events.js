export class Emitter {
  constructor() { this._handlers = new Map(); }
  on(name, fn) {
    if (!this._handlers.has(name)) this._handlers.set(name, new Set());
    this._handlers.get(name).add(fn);
    return () => this._handlers.get(name).delete(fn);
  }
  emit(name, ...args) {
    const hs = this._handlers.get(name);
    if (!hs) return;
    for (const fn of [...hs]) {
      try { fn(...args); } catch (err) { console.error(err); }
    }
  }
}
