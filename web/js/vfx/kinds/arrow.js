import { createCanvas } from "../../core/util.js";
import { renderGlow, glowStyle } from "../../trails/glow.js";
import { rng, rgba, clamp01, smooth } from "../../trails/glow/util.js";
import { TAU, frac, mixRgb, blob, streak } from "../common.js";
import { SPRITES, spriteOf } from "../projectiles.js";
import { headProfile } from "../arrowhead.js";

// 箭矢: something thrown or shot, wrapped in the glow of an attack trail. The
// light round it and streaming off behind it is drawn by the trails' own
// renderer (trails/glow.js) in the palette's preset, so 烈焰斩 wraps it in
// flames, 冰晶 in crystals, 雷光 in lightning, 疾风 in wind, exactly as the
// trail of that name looks. The trail is two halves, one either side of the
// flight line, each with its hot edge along it; together they make one comet
// whose head closes round the point (or, round what is round or tumbles, round
// the whole of it). Looping, it holds still (the game moves it) while the glow
// flickers and light rushes back off it; a one-shot shoots it across the box
// and leaves the trail to dissolve.
// Everything is sized by R, the circle that fits the box, and kept inside it
// (round in VFX_KINDS): turned any way (旋转) it never reaches the box's edge.

// 外观: what flies — the ready-made pictures (projectiles.js), then the ones
// drawn here in the palette's colours (简笔), nothing solid, the user's picture
export const PROJECTILES = [...SPRITES.map((x) => ["s:" + x.id, x.name]),
  ["arrow", "简笔·箭矢"], ["dagger", "简笔·匕首"], ["spear", "简笔·长枪"], ["club", "简笔·棍棒"], ["axe", "简笔·飞斧"], ["shuriken", "简笔·手里剑"], ["ball", "简笔·球"],
  ["core", "透明核心"], ["custom", "自定义核心"]];
// 自转: "auto" turns what tumbles when thrown
export const SPINS = [["auto", "按外观（斧、锤棍、飞镖、炸弹会转）"], ["on", "转"], ["off", "不转"]];
const TUMBLES = new Set(["club", "axe", "shuriken"]);
const ROUND = new Set(["shuriken", "ball", "core"]);
const spins = (shape, spin) => (spin === "on" ? true : spin === "off" ? false : spriteOf(shape) ? spriteOf(shape).spin : TUMBLES.has(shape));

// What flies, in its own frame: x forward, its point at (0, 0) — or, for what
// is round or tumbles, its middle at pivot. Its parts, drawn in order:
//   fill   — a polygon, a linear gradient from g[0..1] to g[2..3] (st: [[t, rgb, a]])
//   line   — a stroke of colour c, width w, closed (cl) or not
//   dot    — a soft round glow at `at`, radius r (st by radius)
//   tassel — strands streaming back from root, fluttering (whole cycles per loop)
//   img    — a picture (自定义核心) centred at `at`, w × h, turned by `turn`
// and what each is: body (solid and outlined), solid (over the body), glint
// (light on it), glow (light round it, drawn last). fx: stays upright while the
// rest tumbles (a ball's shine). core: 自定义核心's picture { img, size (of R),
// turn (radians) }.
export function projectile(shape, spin, pal, R, core = null) {
  const H = R * 0.24, sw = Math.max(1, H * 0.12);
  const c0 = pal.cols[0], k = pal.dark ? 0.6 : 1, W = [255, 255, 255], B = [0, 0, 0];
  const shade = mixRgb(c0, [14, 10, 18], 0.55);
  const wood = mixRgb([70, 48, 34], c0, 0.3), feather = mixRgb(c0, [20, 16, 24], 0.3), steel = mixRgb([104, 110, 124], c0, 0.25);
  const brass = mixRgb([150, 118, 58], c0, 0.25), leather = mixRgb([58, 36, 28], c0, 0.3);
  const lit = mixRgb(steel, W, 0.4), dk35 = mixRgb(steel, B, 0.35), dk50 = mixRgb(steel, B, 0.5);
  const parts = [];
  const fill = (l, pts, st, g = null, fx = false) => parts.push({ k: "fill", l, pts, st, g, fx });
  const line = (l, pts, c, a, w, cl = false, fx = false) => parts.push({ k: "line", l, pts, c, a, w, cl, fx });
  const dot = (l, at, r, st, fx = false) => parts.push({ k: "dot", l, at, r, st, fx });
  const one = (c) => [[0, c, 1]];
  const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const bez = (a, c, b, n) => Array.from({ length: n + 1 }, (_, i) => { const t = i / n, u = 1 - t; return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]; });
  const arc = (x, y, r, a0, a1, n) => Array.from({ length: n + 1 }, (_, i) => { const a = a0 + (a1 - a0) * i / n; return [x + Math.cos(a) * r, y + Math.sin(a) * r]; });
  const mirror = (pts) => pts.map(([x, y]) => [x, -y]);
  // lit from above: light → mid → dark across the height
  const metal = (c, h) => [[[0, mixRgb(c, W, 0.3), 1], [1, mixRgb(c, B, 0.35), 1]], [0, -h, 0, h]];
  // a steel blade: its upper half lit, the lower in shadow
  const blade = (up, dn, h) => { fill("body", up, [[0, lit, 1], [0.5, steel, 1]], [0, -h, 0, h]); fill("body", dn, [[0.52, dk35, 1], [1, dk50, 1]], [0, -h, 0, h]); };
  const sheath = (x0, w) => line("glow", [[x0, 0], [0, 0]], pal.rim, 0.12 * k, w);
  const point = (x) => dot("glow", [x, 0], H * 0.3, [[0, pal.core, 0.5 * k], [0.4, pal.rim, 0.2 * k], [1, pal.rim, 0]]);
  let L = 0, pivot = [0, 0];

  if (shape === "dagger") {
    // 匕首: a double-edged blade with a ridge, a crossguard, a wrapped grip, a pommel
    L = R * 0.62;
    const bl = L * 0.56, bw = Math.max(1.5, H * 0.26), gw = Math.max(1.5, L * 0.05), gh = bw * 2, pr = Math.max(1.2, bw * 0.75);
    const xg = -bl - gw, xe = -L + pr * 1.4;
    fill("body", rect(xe, -bw * 0.55, xg, bw * 0.55), [[0, mixRgb(leather, W, 0.15), 1], [1, mixRgb(leather, B, 0.3), 1]], [0, -bw * 0.55, 0, bw * 0.55]);
    fill("body", arc(-L + pr, 0, pr, 0, TAU * 13 / 14, 13), ...metal(brass, pr));
    fill("body", rect(xg, -gh, -bl, gh), ...metal(brass, gh));
    const up = [[0, 0], [-bl * 0.3, -bw], [-bl, -bw * 0.8], [-bl, 0]];
    blade(up, [[0, 0], [-bl, 0], [-bl, bw * 0.8], [-bl * 0.3, bw]], bw);
    line("solid", [[-bl * 0.92, 0], [-bl * 0.3, 0]], dk50, 0.6, Math.max(0.5, bw * 0.22));
    for (let j = 1; j <= 3; j++) { const x = xg + (xe - xg) * j / 4; line("solid", [[x + bw * 0.25, -bw * 0.55], [x - bw * 0.25, bw * 0.55]], shade, 0.7, 0.6); }
    line("glint", [[0, 0], [-bl * 0.3, -bw], [-bl, -bw * 0.8], [-bl, bw * 0.8], [-bl * 0.3, bw]], pal.core, 0.7 * k, Math.max(0.5, bw * 0.18), true);
    sheath(-bl, bw * 3);
    point(bw * 0.4);
  } else if (shape === "spear") {
    // 长枪: a long, narrow leaf of a head with a ridge, a socket, a long shaft,
    // a tassel streaming back
    L = R * 0.95;
    const hl = L * 0.34, hw = Math.max(2, H * 0.27), s2 = Math.max(1, H * 0.12), sl = hl * 0.18;
    const leaf = [[0, 0], [-0.12, -0.16], [-0.3, -0.46], [-0.5, -0.82], [-0.66, -1], [-0.82, -0.86], [-0.94, -0.5]].map(([a, b]) => [a * hl, b * hw]);
    fill("body", rect(-L, -s2 / 2, -hl - sl, s2 / 2), one(wood));
    if (s2 >= 1.5) fill("body", rect(-L, -s2 / 2, -hl - sl, -s2 / 2 + s2 * 0.35), one(mixRgb(wood, W, 0.3)));
    fill("body", rect(-L - s2 * 0.5, -s2 * 0.75, -L + s2 * 1.2, s2 * 0.75), one(brass));
    fill("body", rect(-hl - sl, -s2 * 1.05, -hl + s2 * 0.2, s2 * 1.05), ...metal(brass, s2 * 1.05));
    fill("body", rect(-hl - sl - s2 * 0.6, -s2 * 1.35, -hl - sl, s2 * 1.35), ...metal(brass, s2 * 1.35));
    blade([...leaf, [-hl, -s2 * 0.7], [-hl, 0]], [[0, 0], [-hl, 0], [-hl, s2 * 0.7], ...mirror(leaf.slice(1)).reverse()], hw);
    line("solid", [[-hl * 0.95, 0], [-hl * 0.12, 0]], lit, 0.7, Math.max(0.5, s2 * 0.4));
    const P = rng(7);
    parts.push({ k: "tassel", l: "solid", root: [-hl - sl * 0.6, 0], len: L * 0.24, w: Math.max(0.8, s2 * 0.9), c: mixRgb([176, 28, 36], c0, 0.25), a: 1, fx: false,
      s: Array.from({ length: 11 }, () => [0.75 + 0.35 * P(), (P() - 0.5) * 0.35, P()]) });
    line("glint", [...leaf, [-hl, -s2 * 0.7], [-hl, s2 * 0.7], ...mirror(leaf.slice(1)).reverse()], pal.core, 0.45 * k, Math.max(0.5, s2 * 0.25), true);
    sheath(-L * 0.45, s2 * 5);
    point(hw * 0.3);
  } else if (shape === "club") {
    // 棍棒: a knotty club swelling to a round head, studded, its handle wrapped
    L = R * 0.55;
    const r1 = Math.max(1.2, H * 0.16), r2 = Math.max(2.5, H * 0.42);
    const rad = (x) => r1 + (r2 - r1) * Math.pow(clamp01((x + L) / (L - r2)), 1.3);
    const top = [], bot = [];
    for (let i = 0; i < 8; i++) { const x = -L + (L - r2) * i / 8, bump = 1 + 0.06 * Math.sin(i * 2.3); top.push([x, -rad(x) * bump]); bot.push([x, rad(x) * (2 - bump)]); }
    const outline = [...top, ...arc(-r2, 0, r2, -Math.PI / 2, Math.PI / 2, 10), ...bot.reverse(), ...arc(-L, 0, r1, Math.PI / 2, Math.PI * 1.5, 6).slice(1, -1)];
    fill("body", outline, [[0, mixRgb(wood, W, 0.3), 1], [0.45, wood, 1], [1, mixRgb(wood, B, 0.4), 1]], [0, -r2, 0, r2]);
    for (const [x, v, s] of [[-0.3, -0.3, 0.22], [-0.62, 0.25, 0.2], [-0.45, 0.05, 0.14]]) fill("solid", arc(x * L, v * rad(x * L), s * rad(x * L) + 0.4, 0, TAU * 9 / 10, 9), one(mixRgb(wood, B, 0.45)));
    for (const [x, y] of [[-0.9, -0.62], [-0.3, 0.55], [-1.5, 0.1], [-0.15, -0.35]]) fill("solid", arc(x * r2, y * r2, Math.max(0.8, r2 * 0.16), 0, TAU * 7 / 8, 7), one(lit));
    for (let j = 0; j < 3; j++) { const x = -L + L * (0.1 + 0.07 * j); line("solid", [[x, -rad(x)], [x - r1 * 0.4, rad(x)]], leather, 0.9, Math.max(0.6, r1 * 0.5)); }
    line("glint", outline, pal.rim, 0.45 * k, Math.max(0.5, r1 * 0.35), true);
    pivot = [-L * 0.42, 0];
  } else if (shape === "axe") {
    // 飞斧: a short handle with a bearded head, its edge catching the light
    L = R * 0.55;
    const hs = Math.max(0.8, H * 0.1), bh = H, y0 = -hs * 1.8;
    fill("body", rect(-L, -hs, 0, hs), [[0, mixRgb(wood, W, 0.3), 1], [1, mixRgb(wood, B, 0.35), 1]], [0, -hs, 0, hs]);
    const edge = bez([-0.33 * L, -bh], [-0.12 * L, -bh * 1.22], [0.08 * L, -bh * 0.92], 10);
    fill("body", [[-0.2 * L, y0], ...bez([-0.2 * L, y0], [-0.3 * L, -bh * 0.5], [-0.33 * L, -bh], 6).slice(1), ...edge.slice(1), [-0.02 * L, y0]], [[0, dk35, 1], [0.6, steel, 1], [1, lit, 1]], [0, y0, 0, -bh]);
    fill("body", rect(-0.22 * L, y0, -0.02 * L, -y0), [[0, dk35, 1], [1, dk50, 1]], [0, y0, 0, -y0]);
    fill("body", [[-0.18 * L, -y0], [-0.06 * L, -y0], [-0.12 * L, -y0 + H * 0.22]], one(dk50));
    for (let j = 0; j < 3; j++) { const x = -L + L * (0.08 + 0.06 * j); line("solid", [[x, -hs], [x - hs * 0.6, hs]], leather, 0.9, Math.max(0.6, hs * 0.7)); }
    line("glint", edge, pal.core, 0.75 * k, Math.max(0.6, hs * 0.5));
    pivot = [-L * 0.45, -H * 0.25];
  } else if (shape === "shuriken") {
    // 手里剑: a four-pointed star, each point faceted light and dark, a hole in the middle
    const rs = R * 0.22, ri = rs * 0.3, star = [];
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2, tip = [rs * Math.cos(a), rs * Math.sin(a)];
      const l = [ri * Math.cos(a - Math.PI / 4), ri * Math.sin(a - Math.PI / 4)], r = [ri * Math.cos(a + Math.PI / 4), ri * Math.sin(a + Math.PI / 4)];
      fill("body", [[0, 0], l, tip], one(lit));
      fill("body", [[0, 0], tip, r], one(dk35));
      star.push(l, tip);
    }
    fill("solid", arc(0, 0, ri * 0.45, 0, TAU * 9 / 10, 9), one(shade));
    line("glint", star, pal.core, 0.6 * k, Math.max(0.5, rs * 0.03), true);
  } else if (shape === "ball") {
    // 球: a plain ball lit from above left
    const rb = R * 0.16;
    fill("body", arc(0, 0, rb, 0, TAU * 23 / 24, 23), [[0, lit, 1], [0.5, steel, 1], [1, dk50, 1]], [-rb * 0.6, -rb * 0.6, rb * 0.7, rb * 0.7], true);
    dot("glint", [-rb * 0.4, -rb * 0.45], rb * 0.38, [[0, W, 0.75 * k], [1, W, 0]], true);
    line("glint", arc(0, 0, rb * 0.92, 0.2, 1.6, 10), pal.rim, 0.5 * k, Math.max(0.6, rb * 0.1), false, true);
  } else if (shape === "core") {
    // 透明核心: nothing solid at all — only the light flies, a spell cast
    // (its head as round as a small orb's)
  } else if (shape === "custom" || spriteOf(shape)) {
    // 自定义核心 and the ready-made looks: a picture, its longer side size × R, turned so
    // it faces forward; its front at the point (until there is a picture,
    // only the light flies, as 透明核心)
    if (core && core.img) {
      const im = core.img, sc = R * core.size / Math.max(1, im.width, im.height), w = im.width * sc, h = im.height * sc, a = core.turn;
      const bw = Math.abs(w * Math.cos(a)) + Math.abs(h * Math.sin(a)), cs = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
      parts.push({ k: "img", l: "body", img: im, at: [-bw / 2, 0], w, h, turn: a, fx: false,
        pts: cs.map(([x, y]) => [-bw / 2 + x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]) });
      L = bw;
      pivot = [-bw / 2, 0];
    }
  } else {
    // 箭矢: a shaft with a barbed broadhead, two swept feathers, a nock
    L = R * 0.8;
    const hl = Math.max(4, L * 0.22), hw = Math.max(2, H * 0.38), xh = -hl * 0.72, xb = -L, fl = L * 0.26, fh = Math.max(1.5, H * 0.42);
    fill("body", rect(xb, -sw / 2, xh, sw / 2), one(wood));
    if (sw >= 1.5) fill("body", rect(xb, -sw / 2, xh, -sw / 2 + sw * 0.35), one(mixRgb(wood, W, 0.3)));
    const vanes = [-1, 1].map((s) => [...bez([xb + fl, s * sw / 2], [xb + fl * 0.55, s * fh * 0.55], [xb + fl * 0.1, s * fh], 10), [xb - fl * 0.08, s * fh], [xb + fl * 0.08, s * sw / 2]]);
    vanes.forEach((v, i) => fill("body", v, [[0, mixRgb(feather, W, 0.2), 1], [1, feather, 1]], [0, 0, 0, (i ? 1 : -1) * fh]));
    fill("body", rect(xb - sw * 0.8, -sw * 0.75, xb + sw * 0.4, sw * 0.75), one(shade));
    blade([[0, 0], [-hl, -hw], [xh, -sw * 0.6], [xh, 0]], [[0, 0], [xh, 0], [xh, sw * 0.6], [-hl, hw]], hw);
    if (fh >= 5) for (const s of [-1, 1]) for (let j = 1; j < 4; j++) { const x = xb + fl * (0.12 + 0.22 * j); line("solid", [[x, s * sw / 2], [x - fl * 0.18, s * fh * (0.85 - 0.18 * j)]], shade, 0.6, 0.6); }
    line("glint", [[0, 0], [-hl, -hw], [xh, -sw * 0.6], [xh, sw * 0.6], [-hl, hw]], pal.core, 0.7 * k, Math.max(0.5, sw * 0.35), true);
    for (const v of vanes) line("glint", v, pal.rim, 0.45 * k, Math.max(0.5, sw * 0.3), true);
    sheath(xb, sw * 5);
    point(hl * 0.1);
  }
  const spinning = spins(shape, spin), round = spinning || ROUND.has(shape) || !parts.length;
  // what is round or tumbles: the glow wraps the circle it turns in (nothing
  // solid: a small orb's)
  let ro = parts.length ? 0 : R * 0.08;
  if (round) for (const q of parts) for (const p of q.pts || []) ro = Math.max(ro, Math.hypot(p[0] - pivot[0], p[1] - pivot[1]));
  else pivot = [0, 0];
  return { L: round ? 2 * ro : L, ro, round, spin: spinning, pivot, shade, parts };
}

// tassel strands at t: polylines from the root, streaming back and fluttering
function strands(q, t) {
  return q.s.map(([f, spread, ph]) => Array.from({ length: 7 }, (_, i) => {
    const s = i / 6;
    return [q.root[0] - q.len * f * s, q.root[1] + q.len * spread * s + q.len * 0.12 * Math.pow(s, 1.5) * Math.sin(TAU * (2 * t + ph) - 3 * s)];
  }));
}

function drawPart(g, q, t) {
  const path = (pts, close) => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); if (close) g.closePath(); };
  if (q.k === "fill") {
    path(q.pts, true);
    if (!q.g || q.st.length === 1) g.fillStyle = rgba(q.st[0][1], q.st[0][2]);
    else {
      const gr = g.createLinearGradient(q.g[0], q.g[1], q.g[2], q.g[3]);
      for (const [o, col, a] of q.st) gr.addColorStop(o, rgba(col, a));
      g.fillStyle = gr;
    }
    g.fill();
  } else if (q.k === "dot") {
    blob(g, q.at[0], q.at[1], q.r, q.st);
  } else if (q.k === "img") {
    g.translate(q.at[0], q.at[1]);
    g.rotate(q.turn);
    g.imageSmoothingEnabled = true;
    g.drawImage(q.img, -q.w / 2, -q.h / 2, q.w, q.h);
  } else {
    g.lineCap = "round"; g.lineJoin = "round";
    g.strokeStyle = rgba(q.c, q.a);
    g.lineWidth = q.w;
    for (const pts of q.k === "tassel" ? strands(q, t) : [q.pts]) { path(pts, q.cl); g.stroke(); }
  }
}

// What flies, painted on a w × h canvas S: its body, dark against the light so
// it reads inside it (an outline round it, nudged out by d), what lies on it,
// and its edges lit by the glow. place(cv, q) moves a part to where it goes;
// draw(cv, layer, op) paints one layer of parts (the light round it, after).
function paintObject(obj, t, w, h, place, d) {
  const draw = (cv, l, op) => {
    cv.globalCompositeOperation = op;
    for (const q of obj.parts) {
      if (q.l !== l) continue;
      cv.save();
      place(cv, q);
      drawPart(cv, q, t);
      cv.restore();
    }
  };
  const A = createCanvas(w, h), ag = A.getContext("2d");
  draw(ag, "body", "source-over");
  const O = createCanvas(w, h), og = O.getContext("2d");
  og.drawImage(A, 0, 0);
  og.globalCompositeOperation = "source-in";
  og.fillStyle = rgba(obj.shade, 0.8);
  og.fillRect(0, 0, w, h);
  const S = createCanvas(w, h), sg = S.getContext("2d");
  for (let j = 0; j < 8; j++) sg.drawImage(O, Math.cos(j * TAU / 8) * d, Math.sin(j * TAU / 8) * d);
  sg.drawImage(A, 0, 0);
  draw(sg, "solid", "source-over");
  draw(sg, "glint", "lighter");
  return { S, draw };
}

// how far the outline reaches out round the body
const nudge = (R) => Math.max(0.75, Math.max(1, R * 0.24 * 0.12) * 0.4);

// What flies as the game draws it (godot/code.js, Godot 纯代码): a picture of
// it (png, base64) and of the light on and round it (light, added; "" when
// none), at twice the size for a sharp picture, with where the pictures go —
// rect [x, y, w, h] from its point (or, round or tumbling, its middle) — and
// how it flies: L, ro (lengths in R), round, spin. The tassel stands still.
// the box parts cover, from the pivot: { bx, by, w, h } (whole pixels), or null
function boundsOf(parts, pivot, d) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const grow = (x, y, m) => { x0 = Math.min(x0, x - m); y0 = Math.min(y0, y - m); x1 = Math.max(x1, x + m); y1 = Math.max(y1, y + m); };
  for (const q of parts) {
    if (q.k === "dot") grow(q.at[0], q.at[1], q.r);
    else if (q.k === "tassel") { grow(q.root[0], q.root[1], q.w + q.len * 0.5); grow(q.root[0] - q.len * 1.15, q.root[1], q.w + q.len * 0.5); }
    else for (const p of q.pts || []) grow(p[0], p[1], (q.w || 0) / 2 + d + 1);
  }
  if (!(x1 > x0)) return null;
  return { bx: Math.floor(x0 - pivot[0]), by: Math.floor(y0 - pivot[1]), w: Math.ceil(x1 - x0) + 2, h: Math.ceil(y1 - y0) + 2 };
}

export function projectileBounds(obj) {
  if (obj.round) return [-obj.ro, -obj.ro, obj.ro * 2, obj.ro * 2];
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const q of obj.parts.filter(q => q.l !== "glow")) for (const [x, y] of q.pts || []) {
    const pad = q.k === "line" ? (q.w || 0) / 2 : 0;
    left = Math.min(left, x - obj.pivot[0] - pad); right = Math.max(right, x - obj.pivot[0] + pad);
    top = Math.min(top, y - obj.pivot[1] - pad); bottom = Math.max(bottom, y - obj.pivot[1] + pad);
  }
  return Number.isFinite(left) ? [left, top, right - left, bottom - top] : [-obj.L / 2, -1, obj.L, 2];
}

export function projectileSprite(shape, spin, pal, R, core) {
  const R2 = Math.min(600, Math.max(96, R * 2)), obj = projectile(shape, spin, pal, R2, core), d = nudge(R2);
  const base = { L: obj.L / R2, ro: obj.ro / R2, round: obj.round, spin: obj.spin, bounds: projectileBounds(obj).map(v => v / R2), rect: [0, 0, 0, 0], png: "", light: "" };
  const b = boundsOf(obj.parts, obj.pivot, d);
  if (!b) return base;
  const { bx, by, w, h } = b;
  const { S, draw } = paintObject(obj, 0, w, h, (cv) => cv.translate(-bx - obj.pivot[0], -by - obj.pivot[1]), d);
  const G = createCanvas(w, h);
  draw(G.getContext("2d"), "glow", "lighter");
  const b64 = (cv) => cv.toDataURL("image/png").split(",")[1];
  return { ...base, rect: [bx / R2, by / R2, w / R2, h / R2], png: b64(S), light: obj.parts.some((q) => q.l === "glow") ? b64(G) : "" };
}

// What flies painted once, upright, per look — the parts that turn with it and
// those that stay upright (fx) apart — and then only placed (and turned) each
// frame: painting it is the costly part. The tassel, which moves, is left out.
const sprites = new Map(), imgIds = new WeakMap();
let nextImg = 1;
function objectSprites(obj, key, d) {
  if (sprites.has(key)) return sprites.get(key);
  const out = [false, true].map((fx) => {
    const parts = obj.parts.filter((q) => !!q.fx === fx && q.k !== "tassel" && q.l !== "glow");
    const b = parts.some((q) => q.l === "body" || q.l === "solid" || q.l === "glint") && boundsOf(parts, obj.pivot, d);
    if (!b) return null;
    return { ...b, S: paintObject({ ...obj, parts }, 0, b.w, b.h, (cv) => cv.translate(-b.bx - obj.pivot[0], -b.by - obj.pivot[1]), d).S };
  });
  sprites.set(key, out);
  if (sprites.size > 48) sprites.delete(sprites.keys().next().value);
  return out;
}
const imgId = (img) => { if (!img) return 0; if (!imgIds.has(img)) imgIds.set(img, nextImg++); return imgIds.get(img); };

export function arrow(g, c) {
  const { t, pal, cx, cy, R } = c;
  const P = rng(c.seed * 113 + 7);
  const obj = projectile(c.shape, c.spin, pal, R, c.core), { L, ro } = obj;
  const H = obj.round ? Math.max(R * 0.24, ro * 1.35) : R * 0.24;   // how far the glow reaches either side
  const nose = H * 0.45;                                              // the glow past its point
  const fly = c.loop ? 0 : clamp01(t / 0.72);
  const xt = c.bodyOnly ? cx + (obj.round ? ro : L * 0.5) : c.loop ? cx + R * 0.84 - nose : cx - R + L * 0.5 + (2 * R + L * 0.5 + nose) * fly;
  const x0 = Math.max(cx - R * 1.05, xt - R * 1.9), xn = xt + nose, xw = obj.round ? xt - ro : xt - L * 0.2;
  // a one-shot's trail dissolves once it is through
  const life = c.loop ? 1 : 1 - smooth(0.55, 1, t);
  // the outline of the glow along the flight: thin at the tail, widest round
  // the head, closing to a point just past it
  const Wd = H / 0.75 * (c.headWidth ?? 100) / 100;
  const width = (x) => {
    if (x >= xw) { const q = (x - xw) / (xn - xw); return Wd * Math.max(0.001, headProfile(q, c.headCurve)); }
    return Wd * (0.18 + 0.82 * Math.pow(clamp01((x - x0) / Math.max(1, xw - x0)), 0.7));
  };
  // the tail sways a little, a wave running back along it (whole cycles per loop)
  const sway = (u) => H * 0.14 * Math.pow(1 - u, 1.5) * Math.sin(TAU * (u * 1.3 + 2 * t));
  const M = 48;
  // the hot edge (v ≈ 0.75 across a trail) on the flight line, the body out to one side
  const half = (dir) => Array.from({ length: M + 1 }, (_, i) => {
    const u = i / M, x = x0 + (xn - x0) * u, W = width(x), y = cy + sway(u);
    return { a: [x, y + dir * 0.75 * W], b: [x, y - dir * 0.25 * W], u };
  });
  const lit = pal.dark ? "source-over" : "lighter";
  const glows = [];
  if (!c.bodyOnly && xn - x0 > 2 && life > 0.01) {
    const style = glowStyle(pal.preset);
    for (const [dir, k] of [[1, 0], [-1, 1]]) {
      const G = renderGlow([half(dir)], style, c.w, c.h, { seed: c.seed * 2 + k, frame: c.i, alpha: life, fade: 0.75, fx: false, loop: c.loop ? c.n : 0 });
      if (G) glows.push(G);
    }
  }
  // the two halves overlap along the flight line: a little less of each
  const layGlow = (a) => {
    g.globalCompositeOperation = lit;
    g.globalAlpha = a;
    for (const G of glows) g.drawImage(G, 0, 0);
    g.globalAlpha = 1;
  };
  layGlow(pal.dark ? 1 : 0.85);

  // light rushing back off it: streaks inside the glow, brightest at their
  // front, and motes shed behind, drifting out (whole cycles per loop)
  g.globalCompositeOperation = "lighter";
  const lw = Math.max(0.6, H * 0.06), back = xt - L * 0.3 - x0;
  for (let k = Math.round(9 * c.amount); k > 0; k--) {
    const v = P() * 2 - 1, ph = P(), sp = 1 + Math.floor(P() * 2), len = R * (0.12 + 0.18 * P());
    const p = frac(ph + t * sp), x = xt - L * 0.3 - back * p, y = cy + sway(clamp01((x - x0) / (xn - x0))) + v * 0.5 * width(x) * 0.75;
    const a = Math.sin(Math.PI * p) * life * (0.4 + 0.4 * P());
    if (a > 0.02) streak(g, [x - len, y], [x, y], pal.rim, pal.core, a, lw);
  }
  for (let k = Math.round(12 * c.amount); k > 0; k--) {
    const side = P() < 0.5 ? -1 : 1, ph = P(), sp = 1 + Math.floor(P() * 2), out = 0.4 + 0.8 * P(), sz = 0.6 + 0.8 * P(), x1 = xt - L * 0.5 * P();
    const p = frac(ph + t * sp), x = x1 - p * R * 1.1, y = cy + side * H * (0.15 + out * p);
    const a = Math.sin(Math.PI * p) * (1 - 0.5 * p) * life;
    if (a > 0.02) blob(g, x, y, Math.max(0.9, H * 0.08 * sz), [[0, pal.core, a], [0.45, pal.rim, 0.6 * a], [1, pal.rim, 0]]);
  }

  // the thing itself over its glow. What is round or tumbles sits at the
  // middle of its glow's head, turning (whole turns per loop); 物体前后 moves it
  // forward out of the head or back into the glow
  const sh = R * (c.coreShift || 0);
  if (xt + sh - L > cx + R + 2) return;
  const at = obj.round ? [xt - ro + sh, cy] : [xt + sh, cy], th = obj.spin ? TAU * t * (c.loop ? 1 : 2) : 0;
  // a picture has its own outline: as pixels the blocks would make it all outline
  const d = c.pixel && obj.parts.some((q) => q.k === "img") ? 0 : nudge(R);
  const key = [c.shape, pal.preset.id, R.toFixed(2), d, obj.pivot.join(","), c.core ? [c.core.size, c.core.turn, imgId(c.core.img)].join(",") : ""].join("|");
  const S = createCanvas(c.w, c.h), sg = S.getContext("2d");
  sg.imageSmoothingEnabled = true;
  sg.imageSmoothingQuality = "high";
  objectSprites(obj, key, d).forEach((sp, fx) => {
    if (!sp) return;
    sg.save();
    sg.translate(at[0], at[1]);
    if (!fx) sg.rotate(th);
    sg.drawImage(sp.S, sp.bx, sp.by);
    sg.restore();
  });
  const draw = (cv, test, op) => {
    cv.globalCompositeOperation = op;
    for (const q of obj.parts) {
      if (!test(q)) continue;
      cv.save();
      cv.translate(at[0], at[1]);
      if (!q.fx) cv.rotate(th);
      cv.translate(-obj.pivot[0], -obj.pivot[1]);
      drawPart(cv, q, t);
      cv.restore();
    }
  };
  draw(sg, (q) => q.k === "tassel", "source-over");
  // in 像素 it goes over the finished frame (effects.js): snapped to the glow's
  // colours it would melt into its own light
  g.globalCompositeOperation = "source-over";
  if (c.pixel) c.top = S;
  else g.drawImage(S, 0, 0);

  // wrapped in light: the glow once more, thinly, over it, then the light round it
  if (!pal.dark && !c.pixel) layGlow(0.15);
  draw(g, (q) => q.l === "glow", "lighter");
  g.globalCompositeOperation = "source-over";
}
