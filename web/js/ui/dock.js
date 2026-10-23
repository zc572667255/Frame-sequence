// Panels at the side of a work area — the node bar and the 属性 panel on the
// home page, the tools, settings and timeline in the pixel editor — each with
// a bar on its inner edge: drag it to make the panel wider / taller, click its
// arrow (or double-click the bar) to fold the panel away and back. Sizes and
// what is folded are remembered (localStorage, under key).
import { el } from "../core/util.js";

function load(key) {
  try { return JSON.parse(localStorage.getItem(key) || "{}") || {}; } catch { return {}; }
}
function save(key, all) {
  try { localStorage.setItem(key, JSON.stringify(all)); } catch { /* private mode */ }
}

// A splitter for panel. key/id: where its size is remembered; axis "x"
// (width) or "y" (height); after: the panel sits after the bar (right of it /
// below it) rather than before; def, min, max(): its size; closed: folded to
// begin with (when nothing is remembered); label: the panel's name for the
// tooltips; cls: a class for the bar; onToggle(folded) after it folds or
// unfolds. Returns the bar to put next to the panel;
// bar.toggle(on) folds it (true) / unfolds it (false) / flips it, and
// bar.folded() says which it is.
export function dockSplit(panel, { key = "gt.layout", id, axis, after, def, min, max, closed = false, label, cls = "", onToggle }) {
  const all = load(key), st = { size: def, closed, ...(all[id] || {}) };
  const prop = axis === "x" ? "width" : "height";
  const arrows = axis === "x" ? (after ? ["›", "‹"] : ["‹", "›"]) : ["▾", "▴"]; // [fold, unfold]
  const btn = el("button", { class: "dock-split-btn" });
  const bar = el("div", { class: "dock-split " + axis + (after ? " after" : " before") + (cls ? " " + cls : "") }, btn);
  const clamp = (v) => Math.round(Math.max(min, Math.min(max(), v)));
  const apply = () => {
    panel.classList.toggle("dock-folded", st.closed);
    panel.style[prop] = st.closed ? "" : clamp(st.size) + "px";
    panel.classList.toggle("dock-narrow", axis === "x" && !st.closed && clamp(st.size) < 70);
    bar.classList.toggle("folded", st.closed);
    btn.textContent = st.closed ? arrows[1] : arrows[0];
    btn.title = (st.closed ? "展开" : "折叠") + label;
    bar.title = st.closed ? "点箭头展开" + label : "拖动调整" + label + (axis === "x" ? "宽度" : "高度") + "，双击折叠";
  };
  const remember = () => { const a = load(key); a[id] = { size: st.size, closed: st.closed }; save(key, a); };
  bar.toggle = (on = !st.closed) => { st.closed = !!on; apply(); remember(); if (onToggle) onToggle(st.closed); };
  bar.folded = () => st.closed;
  btn.addEventListener("click", (e) => { e.stopPropagation(); bar.toggle(); });
  btn.addEventListener("pointerdown", (e) => e.stopPropagation());
  bar.addEventListener("dblclick", (e) => { if (e.target === bar) bar.toggle(); });
  bar.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || st.closed) return;
    e.preventDefault();
    const start = axis === "x" ? e.clientX : e.clientY, from = panel.getBoundingClientRect()[prop];
    bar.setPointerCapture(e.pointerId);
    bar.classList.add("drag");
    const move = (ev) => {
      const d = (axis === "x" ? ev.clientX : ev.clientY) - start;
      st.size = clamp(from + (after ? -d : d));
      apply();
    };
    const up = () => {
      bar.classList.remove("drag");
      bar.removeEventListener("pointermove", move);
      bar.removeEventListener("pointerup", up);
      bar.removeEventListener("pointercancel", up);
      remember();
    };
    bar.addEventListener("pointermove", move);
    bar.addEventListener("pointerup", up);
    bar.addEventListener("pointercancel", up);
  });
  apply();
  return bar;
}
