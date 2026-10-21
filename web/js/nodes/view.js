// Building blocks for card bodies and the inspector: a raster stage, a filmstrip,
// and a frame player driven by one shared animation clock.
import { el, canvasPoint } from "../core/util.js";

// ---------- shared clock ----------
const tickers = new Set();
let raf = 0;
function loop(t) {
  raf = 0;
  for (const fn of tickers) fn(t);
  if (tickers.size) raf = requestAnimationFrame(loop);
}
export function onTick(fn) {
  tickers.add(fn);
  if (!raf) raf = requestAnimationFrame(loop);
  return () => tickers.delete(fn);
}

// ---------- stage ----------
// A canvas scaled to fit its box. Drawing happens in SOURCE pixels and the browser
// scales it up with nearest-neighbour, so pixel art stays crisp at every board zoom
// without re-rendering. The checkerboard sits on the canvas element itself, so it
// covers exactly the image: the picture's real frame (where the PNG ends) is
// visible against the plain stage around it.
//   fit: "contain" (fill the box) | "integer" (largest whole-number scale)
export function makeStage(opts = {}) {
  const canvas = el("canvas", { class: "stage-canvas" });
  const msg = el("div", { class: "stage-msg" });
  const wrap = el("div", { class: "stage" + (opts.className ? " " + opts.className : "") }, canvas, msg);
  let bg = "checker";
  let fit = opts.fit || "contain";
  let last = null;

  const applyBg = () => {
    canvas.classList.toggle("checker", bg === "checker");
    canvas.style.backgroundColor = bg === "checker" ? "" : bg;
  };
  applyBg();

  const layout = () => {
    if (!canvas.width || canvas.style.display === "none") return;
    const pad = 8;
    const W = wrap.clientWidth - pad * 2, H = wrap.clientHeight - pad * 2;
    if (W <= 0 || H <= 0) return;
    let s = Math.min(W / canvas.width, H / canvas.height);
    if (fit === "integer" && s >= 1) s = Math.floor(s);
    canvas.style.width = Math.max(1, canvas.width * s) + "px";
    canvas.style.height = Math.max(1, canvas.height * s) + "px";
  };
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(layout).observe(wrap);

  const stage = {
    el: wrap,
    canvas,
    // src: canvas | null. overlay(ctx, w, h) draws on top in source pixels.
    show(src, overlay, key) {
      if (!src) { stage.message(""); return; }
      // the same source with the same overlay state is already on screen
      if (key !== undefined && last && last.src === src && last.key === key) return;
      last = { src, key };
      msg.style.display = "none";
      const wasHidden = canvas.style.display === "none";
      canvas.style.display = "";
      if (canvas.width !== src.width || canvas.height !== src.height || wasHidden) {
        canvas.width = src.width;
        canvas.height = src.height;
        layout();
      }
      const ctx = canvas.getContext("2d");
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(src, 0, 0);
      if (overlay) overlay(ctx, canvas.width, canvas.height);
    },
    message(text) {
      last = null;
      canvas.style.display = "none";
      msg.style.display = "";
      msg.textContent = text || "";
    },
    invalidate() { last = null; },
    setBg(v) { bg = v || "checker"; applyBg(); },
    setFit(v) { if (v !== fit) { fit = v; layout(); } },
    relayout: layout,
    point: (e) => canvasPoint(canvas, e),
  };
  return stage;
}

// ---------- filmstrip ----------
// items: [{ src, sx?, sy?, sw?, sh?, label, dim?, current? }]
export function makeFilmstrip(opts = {}) {
  const root = el("div", { class: "filmstrip" });
  const size = opts.size || 56;
  return {
    el: root,
    set(items) {
      root.replaceChildren();
      items.forEach((it, i) => {
        const sw = it.sw || it.src.width, sh = it.sh || it.src.height;
        const s = Math.min(size / sw, size / sh, 4) || 1;
        const c = el("canvas", { width: Math.max(1, Math.round(sw * s)), height: Math.max(1, Math.round(sh * s)) });
        const cx = c.getContext("2d");
        cx.imageSmoothingEnabled = false;
        cx.drawImage(it.src, it.sx || 0, it.sy || 0, sw, sh, 0, 0, c.width, c.height);
        const cell = el("button", {
          class: "film-cell" + (it.dim ? " dim" : "") + (it.current ? " current" : ""),
          title: it.title || "",
          onclick: () => opts.onClick && opts.onClick(i, it),
        }, c, el("span", { class: "film-idx mono" }, it.label));
        root.append(cell);
      });
    },
    highlight(i) {
      [...root.children].forEach((c, k) => c.classList.toggle("current", k === i));
    },
  };
}

// ---------- player ----------
// Plays a frames value on a stage. Per-frame `duration` (ms) wins over fps.
export function makePlayer(stage, opts) {
  let value = null, idx = 0, last = 0, playing = opts.autoplay !== false;
  const draw = () => {
    if (!value || !value.frames.length) { stage.message(opts.emptyText || "等待序列帧输入"); return; }
    idx = ((idx % value.frames.length) + value.frames.length) % value.frames.length;
    stage.show(value.frames[idx].canvas, opts.overlay ? (c, w, h) => opts.overlay(c, w, h, idx) : null);
    opts.onFrame && opts.onFrame(idx, value.frames.length, playing);
  };
  const off = onTick((t) => {
    if (!playing || !value || value.frames.length < 2) return;
    const f = value.frames[idx];
    const dur = (f && f.duration) || 1000 / Math.max(1, opts.fps());
    if (t - last >= dur) {
      // catch up without drifting when the tab was briefly busy
      last = t - Math.min(dur, t - last - dur);
      idx = (idx + 1) % value.frames.length;
      draw();
    }
  });
  return {
    setValue(v) {
      if (v === value) return;
      value = v;
      draw();
    },
    get value() { return value; },
    get index() { return idx; },
    get playing() { return playing; },
    play() { playing = true; last = performance.now(); draw(); },
    pause() { playing = false; draw(); },
    toggle() { playing ? this.pause() : this.play(); },
    step(d) { playing = false; idx += d; draw(); },
    seek(i) { idx = i; draw(); },
    redraw() { stage.invalidate(); draw(); },
    destroy: off,
  };
}

export function readPixel(canvas, x, y) {
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return null;
  const d = canvas.getContext("2d", { willReadFrequently: true }).getImageData(x, y, 1, 1).data;
  return d[3] < 8 ? null : [d[0], d[1], d[2]];
}

export function toolButton(label, title, onClick) {
  return el("button", { class: "tool-btn", title, onclick: (e) => { e.stopPropagation(); onClick(e); } }, label);
}
