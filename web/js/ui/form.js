// Inspector form widgets bound to a card's params by key path ("fit.thr").
//
// Every widget registers a sync function that re-reads its value from the store,
// so undo/redo and edits made on the card itself show up here without rebuilding
// the panel. A widget that has keyboard focus is left alone mid-edit.
import { el, getPath, clampNum } from "../core/util.js";

export function makeForm(ctx, container, shared) {
  const syncers = shared ? shared.syncers : [];
  const get = (key) => getPath(ctx.params(), key);
  // `extra` rides along in the same undo step (e.g. typing a size also turns on "custom")
  const put = (key, value, coalesce = true, extra) =>
    ctx.set({ ...(extra || {}), [key]: value }, { coalesce: coalesce ? ctx.id + ":" + key : null });

  const field = (label, control, extra) =>
    el("label", { class: "f-field" + (extra ? " " + extra : "") }, el("span", { class: "f-label" }, label), control);

  const f = {
    el: container,
    syncers,
    sync() { for (const s of syncers) { try { s(); } catch (err) { console.error(err); } } },
    add(...nodes) { container.append(...nodes); return nodes[0]; },

    section(title, opts = {}) {
      const body = el("div", { class: "f-section-body" });
      const sec = opts.collapsible
        ? el("details", { class: "f-section", open: !!opts.open }, el("summary", { class: "f-section-title" }, title), body)
        : el("div", { class: "f-section" }, title ? el("div", { class: "f-section-title" }, title) : null, body);
      container.append(sec);
      return makeForm(ctx, body, { syncers });
    },

    row(...nodes) {
      return f.add(el("div", { class: "f-row" }, ...nodes));
    },

    number(label, key, o = {}) {
      const input = el("input", {
        type: "number", class: "mono", step: o.step ?? 1, min: o.min, max: o.max,
        placeholder: o.placeholder || "",
      });
      input.addEventListener("input", () => {
        const raw = input.value.trim();
        if (raw === "" || raw === "-") {
          if (o.allowEmpty && raw === "") put(key, "");
          return; // still mid-typing
        }
        const n = clampNum(raw, o.min ?? -Infinity, o.max ?? Infinity, o.fallback ?? 0);
        put(key, o.integer === false ? n : Math.round(n), true, o.extra);
      });
      input.addEventListener("change", () => sync());
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); });
      const sync = () => {
        if (document.activeElement === input) return;
        const v = get(key);
        input.value = v === "" || v == null ? "" : o.format ? o.format(v) : v;
      };
      syncers.push(sync); sync();
      const node = field(label, input, o.wide ? "wide" : "");
      if (o.into) o.into.append(node); else if (!o.detached) container.append(node);
      return node;
    },

    pair(a, b) {
      const row = el("div", { class: "f-pair" });
      container.append(row);
      const sub = makeForm(ctx, row, { syncers });
      a(sub); b(sub);
      return row;
    },

    slider(label, key, o = {}) {
      const range = el("input", { type: "range", min: o.min, max: o.max, step: o.step ?? 1 });
      const num = el("input", { type: "number", class: "mono f-num", min: o.min, max: o.max, step: o.step ?? 1 });
      const set = (v) => put(key, clampNum(v, o.min, o.max, o.fallback ?? o.min));
      range.addEventListener("input", () => { num.value = range.value; set(range.value); });
      num.addEventListener("input", () => {
        if (num.value === "" || num.value === "-") return;
        range.value = num.value; set(num.value);
      });
      num.addEventListener("change", () => sync());
      const sync = () => {
        const v = get(key) ?? o.fallback ?? 0;
        if (document.activeElement !== range) range.value = v;
        if (document.activeElement !== num) num.value = v;
      };
      syncers.push(sync); sync();
      return f.add(el("div", { class: "f-slider" },
        el("span", { class: "f-label" }, label), range, num, o.unit ? el("span", { class: "f-unit mono" }, o.unit) : null));
    },

    select(label, key, options, o = {}) {
      const sel = el("select", null, ...options.map(([v, t]) => el("option", { value: String(v) }, t)));
      sel.addEventListener("change", () => {
        const opt = options.find(([v]) => String(v) === sel.value);
        put(key, opt ? opt[0] : sel.value, false);
        o.onChange && o.onChange(sel.value);
      });
      const sync = () => { sel.value = String(get(key)); };
      syncers.push(sync); sync();
      return f.add(field(label, sel, o.wide ? "wide" : ""));
    },

    check(label, key, o = {}) {
      const box = el("input", { type: "checkbox" });
      box.addEventListener("change", () => put(key, box.checked, false));
      const sync = () => { box.checked = !!get(key); };
      syncers.push(sync); sync();
      return f.add(el("label", { class: "f-check" }, box, el("span", null, label), o.hint ? el("small", null, o.hint) : null));
    },

    // 3×3 anchor picker; value "ax,ay" with 0 start, 1 centre, 2 end
    anchor(label, key) {
      const grid = el("div", { class: "anchor-grid" });
      const cells = [];
      for (let y = 0; y < 3; y++) {
        for (let x = 0; x < 3; x++) {
          const v = x + "," + y;
          const name = x === 1 && y === 1 ? "正中" : ["上", "中", "下"][y] + ["左", "中", "右"][x];
          const b = el("button", { type: "button", class: "anchor-cell", title: name, onclick: () => put(key, v, false) });
          b.dataset.v = v;
          cells.push(b);
          grid.append(b);
        }
      }
      const sync = () => { const cur = String(get(key)); for (const b of cells) b.classList.toggle("on", b.dataset.v === cur); };
      syncers.push(sync); sync();
      return f.add(el("div", { class: "f-field" }, el("span", { class: "f-label" }, label), grid));
    },

    text(label, key, o = {}) {
      const input = el("input", { type: "text", placeholder: o.placeholder || "" });
      input.addEventListener("input", () => put(key, input.value));
      const sync = () => { if (document.activeElement !== input) input.value = get(key) ?? ""; };
      syncers.push(sync); sync();
      return f.add(field(label, input, "wide"));
    },

    button(label, onClick, o = {}) {
      const b = el("button", { class: "btn" + (o.primary ? " primary" : "") + (o.danger ? " danger" : ""), title: o.title || "", onclick: onClick }, label);
      if (o.sync) syncers.push(() => o.sync(b));
      if (!o.detached) container.append(b);
      return b;
    },

    buttons(...specs) {
      const row = el("div", { class: "f-buttons" });
      for (const [label, fn, o] of specs) row.append(f.button(label, fn, { ...(o || {}), detached: true }));
      container.append(row);
      return row;
    },

    hint(text) {
      const p = el("p", { class: "f-hint" });
      if (typeof text === "function") { syncers.push(() => { p.textContent = text() || ""; }); p.textContent = text() || ""; }
      else p.textContent = text;
      return f.add(p);
    },

    // fn() -> [[label, value], ...] | null
    readout(fn) {
      const box = el("div", { class: "f-readout mono" });
      const sync = () => {
        const rows = fn();
        box.style.display = rows && rows.length ? "" : "none";
        if (!rows) return;
        box.replaceChildren(...rows.map(([k, v]) => el("span", null, el("span", { class: "k" }, k), el("span", { class: "v" }, v))));
      };
      syncers.push(sync); sync();
      return f.add(box);
    },

    // fn() -> { text, tone: "ok" | "warn" | "error" } | string | null
    status(fn) {
      const p = el("div", { class: "f-status" });
      const sync = () => {
        const r = fn();
        const s = typeof r === "string" ? { text: r } : r;
        p.style.display = s && s.text ? "" : "none";
        if (!s) return;
        p.textContent = s.text || "";
        p.dataset.tone = s.tone || "";
      };
      syncers.push(sync); sync();
      return f.add(p);
    },

    custom(node, sync) {
      if (sync) { syncers.push(sync); sync(); }
      return f.add(node);
    },
  };
  return f;
}
