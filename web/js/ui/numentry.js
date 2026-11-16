// Typing a slider's value: the readout next to a slider in the editor's
// panels (effects, trails, strokes, ghosts, the layer's opacity …) turns
// into a number box when clicked. Enter or leaving it sets the slider there
// (kept within its range, in its steps) through the slider's own input and
// change events, so the effect updates and the edit undoes as one, just as a
// drag would; ↑ / ↓ nudge it by a step (Shift: ten), live; Esc puts it back.
// Installed once for the whole page: any readout found by readoutRange works.

// the slider a readout (a .mono span) belongs to, or null
export function readoutRange(span) {
  if (!span || !span.classList || !span.classList.contains("mono") || span.tagName !== "SPAN") return null;
  const box = span.closest(".tm-row, .tm-stop, .tl-field");
  if (box) return box.querySelector('input[type="range"]');
  // 拖尾笔: the title row with the readout, the slider right after it
  const title = span.closest(".ed-opt-title");
  const next = title && title.nextElementSibling;
  return next && next.matches && next.matches('input[type="range"]') ? next : null;
}

function edit(span, range) {
  if (range.disabled || span.dataset.editing) return;
  span.dataset.editing = "1";
  const min = +range.min, max = +range.max, step = +range.step || 1, start = range.value;
  const box = document.createElement("input");
  box.type = "number";
  box.className = "mono num-entry";
  box.min = range.min; box.max = range.max; box.step = range.step || "1";
  box.value = range.value;
  box.title = "输入数值，回车确认（↑ ↓ 微调，Shift 加大步长，Esc 取消）";
  const fit = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    return String(Math.min(max, Math.max(min, Math.round((n - min) / step) * step + min)));
  };
  const put = (v, done) => {
    const f = fit(v);
    if (f != null && f !== range.value) { range.value = f; range.dispatchEvent(new Event("input", { bubbles: true })); }
    if (done) range.dispatchEvent(new Event("change", { bubbles: true }));
  };
  let over = false;
  const finish = (keep) => {
    if (over) return;
    over = true;
    if (keep) put(box.value, true);
    else if (range.value !== start) { range.value = start; range.dispatchEvent(new Event("input", { bubbles: true })); range.dispatchEvent(new Event("change", { bubbles: true })); }
    box.remove();
    span.style.display = "";
    delete span.dataset.editing;
  };
  box.addEventListener("keydown", (e) => {
    e.stopPropagation(); // not the editor's shortcuts
    if (e.key === "Enter") { e.preventDefault(); finish(true); }
    else if (e.key === "Escape") { e.preventDefault(); finish(false); }
    else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const d = (e.key === "ArrowUp" ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
      box.value = fit(Number(box.value || range.value) + d) ?? box.value;
      put(box.value, false);
    }
  });
  box.addEventListener("keyup", (e) => e.stopPropagation());
  box.addEventListener("blur", () => finish(true));
  span.style.display = "none";
  span.after(box);
  box.focus();
  box.select();
}

let installed = false;
export function installNumberEntry(root = document) {
  if (installed) return;
  installed = true;
  root.addEventListener("click", (e) => {
    const span = e.target && e.target.closest && e.target.closest("span.mono");
    const range = readoutRange(span);
    if (!range) return;
    e.preventDefault();
    e.stopPropagation();
    edit(span, range);
  }, true);
  // a hint on hover: readouts that can be typed into
  root.addEventListener("mouseover", (e) => {
    const span = e.target && e.target.closest && e.target.closest("span.mono");
    if (readoutRange(span) && !span.classList.contains("num-readout")) {
      span.classList.add("num-readout");
      if (!span.title) span.title = "点击输入数值";
    }
  });
}
