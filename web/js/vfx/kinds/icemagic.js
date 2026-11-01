// 冰矛的“魔法”层：光刃弹头、交织的青/蓝/紫彩带、霜线上的雾带、霜尘与闪光点、
// 出手时的月牙光环和命中时的冰晶爆发。所有位置都按出生时间和种子算出，任意跳帧都一样。
// godot/icemagic.js 的 GDScript 用同一套公式（同样的随机数调用顺序）。
import { rng, rgba, smooth } from "../../trails/glow/util.js";
import { TAU, mixRgb, blob, ring } from "../common.js";

const WHITE = [255, 255, 255];
const clamp01 = (x) => Math.max(0, Math.min(1, x));

// 色相旋转 deg 度并提高饱和度（与 Godot 的 Color.from_hsv 相同）
export function iceHue(c, deg, boost = 1.25) {
  const r = c[0] / 255, g = c[1] / 255, b = c[2] / 255, max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d > 1e-9) h = max === r ? ((g - b) / d) / 6 : max === g ? ((b - r) / d + 2) / 6 : ((r - g) / d + 4) / 6;
  h = ((h + deg / 360) % 1 + 1) % 1;
  const s = Math.min(1, (max > 0 ? d / max : 0) * boost + 0.1), v = max;
  const i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  const [R, G, B] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6];
  return [Math.round(R * 255), Math.round(G * 255), Math.round(B * 255)];
}

// 四条彩带：青（配色的边光）、蓝紫、品红和一条近白的细带
export const iceRibbonColors = (pal) => [iceHue(pal.rim, 0), iceHue(pal.rim, 42), iceHue(pal.rim, 105), mixRgb(pal.rim, WHITE, 0.55)];

export function iceSpread(r, trailWidth, strength) {
  return Math.max(0, r) * (0.35 + 0.7 * Math.max(0, Math.min(180, trailWidth)) / 100) * Math.sqrt(Math.max(0, strength)) * 1.6;
}
// 彩带的包络：尾端和弹头处收拢，中段最宽
export const iceEnvelope = (u) => Math.pow(clamp01(u), 0.55) * Math.pow(clamp01(1 - u), 0.75) * 2.3;

// 中心线（u: 0 = 最老的尾端, 1 = 弹头）。轨迹只是一串每半帧的位置，直接连成折线会在每个点上折一下，
// 法线也会跳，彩带一偏移就出现棱角；所以先用向心 Catmull-Rom 样条把这些点连成光滑曲线，
// 再按弧长密集重采样，法线取相邻采样点的差（随曲线连续变化）。
export const ICE_LINE_SAMPLES = 120;
const SPLINE_STEPS = 8;
function catmull(p0, p1, p2, p3, s) {
  const k = (a, b) => Math.max(1e-4, Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])));
  const t1 = k(p0, p1), t2 = t1 + k(p1, p2), t3 = t2 + k(p2, p3), t = t1 + (t2 - t1) * s;
  const L = (a, b, ta, tb) => [(a[0] * (tb - t) + b[0] * (t - ta)) / (tb - ta), (a[1] * (tb - t) + b[1] * (t - ta)) / (tb - ta)];
  const a1 = L(p0, p1, 0, t1), a2 = L(p1, p2, t1, t2), a3 = L(p2, p3, t2, t3);
  return L(L(a1, a2, 0, t2), L(a2, a3, t1, t3), t1, t2);
}
export function iceLine(points, n = ICE_LINE_SAMPLES) {
  const pts = [];
  for (const p of points) if (!pts.length || Math.hypot(p[0] - pts.at(-1)[0], p[1] - pts.at(-1)[1]) > 0.35) pts.push(p);
  if (pts.length < 2) return null;
  const m = pts.length, ext = (a, b) => [2 * a[0] - b[0], 2 * a[1] - b[1]], dense = [pts[0]];
  for (let i = 0; i < m - 1; i++) {
    const p0 = i > 0 ? pts[i - 1] : ext(pts[0], pts[1]), p3 = i + 2 < m ? pts[i + 2] : ext(pts[m - 1], pts[m - 2]);
    for (let j = 1; j <= SPLINE_STEPS; j++) dense.push(j === SPLINE_STEPS ? pts[i + 1] : catmull(p0, pts[i], pts[i + 1], p3, j / SPLINE_STEPS));
  }
  const lengths = [0];
  for (let i = 1; i < dense.length; i++) lengths.push(lengths[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]));
  const total = lengths.at(-1);
  if (total < 0.5) return null;
  const at = [];
  let i = 1;
  for (let k = 0; k <= n; k++) {
    const dist = k / n * total;
    while (i < dense.length - 1 && lengths[i] < dist) i++;
    const seg = Math.max(1e-6, lengths[i] - lengths[i - 1]), f = clamp01((dist - lengths[i - 1]) / seg), a = dense[i - 1], b = dense[i];
    at.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
  }
  const out = at.map((p, k) => {
    const a = at[Math.max(0, k - 1)], b = at[Math.min(n, k + 1)], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.max(1e-6, Math.hypot(dx, dy));
    return { x: p[0], y: p[1], dx: dx / len, dy: dy / len, nx: -dy / len, ny: dx / len, u: k / n };
  });
  return { pts: out, total };
}

// [相位, 沿路的半波数, 随帧流动, 幅度, 粗细]
const RIBBONS = [[0.4, 0.9, 0.3, 1.2, 1], [2.5, 1.3, -0.22, 0.95, 0.9], [4.5, 0.7, 0.18, 1.35, 1.1], [1.3, 1.8, 0.4, 0.6, 0.55]];

// 交织的彩带：每条是一串点、宽度和透明度
export function iceRibbons(line, r, trailWidth, strength, frame) {
  if (!line) return [];
  const W = iceSpread(r, trailWidth, strength);
  return RIBBONS.map(([phase, freq, speed, amp, thick], k) => {
    const pts = [], widths = [], alphas = [];
    for (const p of line.pts) {
      const off = W * amp * iceEnvelope(p.u) * Math.sin(phase + (1 - p.u) * freq * Math.PI + frame * speed);
      pts.push([p.x + p.nx * off, p.y + p.ny * off]);
      widths.push(Math.max(0.6, r * (0.05 + 0.13 * p.u) * thick));
      alphas.push(strength * smooth(0, 0.35, p.u) * (0.55 + 0.45 * p.u));
    }
    return { pts, widths, alphas, k };
  });
}

// 霜尘沿三条弯曲的“霜线”铺开：[朝哪一侧, 离中心的距离, 摆动, 摆动频率, 相位]
export const ICE_STRANDS = [[-1, 0.85, 0.3, 0.29, 0.7], [1, 1.15, 0.35, 0.21, 2.1], [-1, 0.16, 0.14, 0.43, 4.0]];
// 霜线在出生时刻 born 的位置（中心线法向的倍数），随路径固定，不随时间漂
export function iceStrand(k, born, seed) {
  const [side, base, wave, freq, phase] = ICE_STRANDS[k];
  return side * (base + wave * Math.sin(born * freq + phase + seed * 0.37));
}
// 弹头刚过时霜线贴近中心，之后张开
const iceOpen = (age) => 0.45 + 0.55 * smooth(0, 6, age);

// 霜尘：大多铺在霜线上，少量散在彩带之间，向外飘散并闪烁
export function iceDust(line, r, trailWidth, strength, seed, oldest, newest, frame, amount = 1) {
  if (!line || strength <= 0.001) return [];
  const span = Math.max(0.001, newest - oldest), step = 0.03 / Math.max(0.25, Math.min(2, amount)), W = iceSpread(r, trailWidth, strength), out = [];
  for (let n = Math.ceil(oldest / step); n <= Math.floor(newest / step + 1e-6); n++) {
    const born = n * step, u = clamp01((born - oldest) / span), age = newest - born;
    const p = line.pts[Math.round(u * (line.pts.length - 1))];
    const P = rng(seed * 733 + n * 53); P();
    const pick = P(), k = pick < 0.36 ? 0 : pick < 0.72 ? 1 : pick < 0.84 ? 2 : 3;
    const j1 = P(), j2 = P(), star = P() < 0.13, tw = P(), a = P(), tone = P();
    const off = k < 3
      ? (iceStrand(k, born, seed) + (j1 - 0.5) * 0.14) * W * iceOpen(age) + (j2 - 0.5) * r * 0.06 * age
      : (j1 * 2 - 1) * W * (0.25 + 0.75 * iceEnvelope(u)) + (j1 * 2 - 1) * r * 0.08 * age;
    const size = Math.max(0.7, r * (0.022 + j2 * 0.04));
    const twinkle = 0.55 + 0.45 * Math.sin(frame * 1.7 + tw * TAU);
    const alpha = strength * smooth(0, 0.2, u) * (0.3 + 0.7 * a) * twinkle * (k < 3 ? 1.2 : 0.6);
    out.push({ at: [p.x + p.nx * off, p.y + p.ny * off + r * 0.02 * age], size, star, alpha, tone });
  }
  return out;
}

// 宽度和透明度逐点变化的线（与 Godot 的 _line(pts, cols, w, ws) 相同）
// soft：横截面两侧 30% 渐隐到透明（辉光和雾带用，免得硬边一段段地显出棱角），透明度补偿 1.3 倍
const SOFT_CORE = 0.4, SOFT_GAIN = 1.3;
export function taperLine(g, pts, widths, color, alphas, scale = 1, amul = 1, soft = false) {
  const n = pts.length;
  if (n < 2) return;
  const nrm = pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    return [-dy / l, dx / l];
  });
  for (let i = 1; i < n; i++) {
    const a = (alphas[i - 1] + alphas[i]) / 2 * amul;
    if (a <= 0.004) continue;
    const h0 = widths[i - 1] * scale / 2, h1 = widths[i] * scale / 2, p = pts[i - 1], q = pts[i], m = nrm[i - 1], k = nrm[i];
    const l0 = [p[0] + m[0] * h0, p[1] + m[1] * h0], l1 = [q[0] + k[0] * h1, q[1] + k[1] * h1];
    const r0 = [p[0] - m[0] * h0, p[1] - m[1] * h0], r1 = [q[0] - k[0] * h1, q[1] - k[1] * h1];
    if (soft) {
      const gr = g.createLinearGradient((l0[0] + l1[0]) / 2, (l0[1] + l1[1]) / 2, (r0[0] + r1[0]) / 2, (r0[1] + r1[1]) / 2), as = Math.min(1, a * SOFT_GAIN), lo = (1 - SOFT_CORE) / 2;
      gr.addColorStop(0, rgba(color, 0)); gr.addColorStop(lo, rgba(color, as)); gr.addColorStop(1 - lo, rgba(color, as)); gr.addColorStop(1, rgba(color, 0));
      g.fillStyle = gr;
    } else g.fillStyle = rgba(color, a);
    g.beginPath();
    g.moveTo(p[0] + m[0] * h0, p[1] + m[1] * h0); g.lineTo(q[0] + k[0] * h1, q[1] + k[1] * h1);
    g.lineTo(q[0] - k[0] * h1, q[1] - k[1] * h1); g.lineTo(p[0] - m[0] * h0, p[1] - m[1] * h0);
    g.closePath(); g.fill();
  }
}

// 细长的半透明冰晶（命中冰刺）：外层冷光、由根部到尖端变亮的晶体、一条亮边和一道浅色晶芯
export function iceCrystalShape(root, angle, length, width, grow = 1) {
  const d = [Math.cos(angle), Math.sin(angle)], n = [-d[1], d[0]], L = length * grow, w = width * grow;
  const at = (a, b) => [root[0] + d[0] * a + n[0] * b, root[1] + d[1] * a + n[1] * b];
  return { d, n, tip: at(L, 0), pts: [at(-L * 0.04, w * 0.45), at(L * 0.2, w), at(L, 0), at(L * 0.13, -w * 0.8), at(-L * 0.04, -w * 0.5)] };
}

function gradFill(g, pts, from, to, c0, a0, c1, a1) {
  const gr = g.createLinearGradient(from[0], from[1], to[0], to[1]);
  gr.addColorStop(0, rgba(c0, a0)); gr.addColorStop(1, rgba(c1, a1));
  g.fillStyle = gr;
  g.beginPath(); pts.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath(); g.fill();
}

export function drawIceCrystal(g, root, angle, length, width, pal, alpha) {
  if (alpha <= 0.004 || length <= 0.4) return;
  const glow = iceCrystalShape([root[0] - Math.cos(angle) * length * 0.04, root[1] - Math.sin(angle) * length * 0.04], angle, length * 1.08, width * 2);
  const c = iceCrystalShape(root, angle, length, width), body = iceHue(pal.rim, 12), edge = mixRgb(pal.rim, WHITE, 0.6);
  gradFill(g, glow.pts, root, glow.tip, body, alpha * 0.12, body, alpha * 0.04);
  gradFill(g, c.pts, root, c.tip, body, alpha * 0.3, mixRgb(body, WHITE, 0.4), alpha * 0.9);
  g.lineCap = "round";
  const core = (a, b) => [root[0] + c.d[0] * length * a, root[1] + c.d[1] * length * a];
  g.strokeStyle = rgba(WHITE, alpha * 0.3); g.lineWidth = Math.max(0.5, width * 0.25);
  g.beginPath(); g.moveTo(...core(0.08)); g.lineTo(...core(0.9)); g.stroke();
  g.strokeStyle = rgba(edge, alpha * 0.95); g.lineWidth = Math.max(0.5, width * 0.2);
  g.beginPath(); g.moveTo(...c.pts[0]); g.lineTo(...c.pts[1]); g.lineTo(...c.pts[2]); g.stroke();
  g.strokeStyle = rgba(edge, alpha * 0.4); g.lineWidth = Math.max(0.4, width * 0.12);
  g.beginPath(); g.moveTo(...c.pts[3]); g.lineTo(...c.pts[2]); g.stroke();
}

export function drawIceGlint(g, at, size, color, alpha, turn = 0) {
  if (alpha <= 0.004) return;
  g.strokeStyle = rgba(color, alpha); g.lineCap = "round";
  for (let j = 0; j < 2; j++) {
    const a = turn + j * Math.PI / 2, len = size * (j ? 2.2 : 3.4), w = Math.max(0.5, size * 0.35);
    g.lineWidth = w;
    g.beginPath(); g.moveTo(at[0] - Math.cos(a) * len, at[1] - Math.sin(a) * len); g.lineTo(at[0] + Math.cos(a) * len, at[1] + Math.sin(a) * len); g.stroke();
  }
  blob(g, at[0], at[1], size * 1.6, [[0, WHITE, alpha], [1, color, 0]]);
}

export function drawIceMagicWake(g, pal, points, r, strength, seed, clock, trailWidth, frame, amount = 1) {
  const line = iceLine(points);
  if (!line || strength <= 0.001) return;
  const cols = iceRibbonColors(pal), deep = pal.cols[0];
  g.save();
  g.globalCompositeOperation = pal.dark ? "source-over" : "lighter";
  const W = iceSpread(r, trailWidth, strength);
  const haze = line.pts.map((p) => [p.x, p.y]), hw = line.pts.map((p) => W * (0.35 + 1.5 * iceEnvelope(p.u))), ha = line.pts.map((p) => strength * smooth(0, 0.4, p.u) * (1 - smooth(0.75, 1, p.u)) * 0.16);
  taperLine(g, haze, hw, deep, ha, 1, 1, true);
  for (const rb of iceRibbons(line, r, trailWidth, strength, frame)) {
    const col = cols[rb.k];
    taperLine(g, rb.pts, rb.widths, col, rb.alphas, 3.2, 0.28, true);
    taperLine(g, rb.pts, rb.widths, mixRgb(col, WHITE, 0.3), rb.alphas, 1, 0.9);
    taperLine(g, rb.pts, rb.widths, WHITE, rb.alphas.map((a, i) => a * line.pts[i].u), 0.3, 0.7);
  }
  // 白芯：后段到弹头的一道高亮光束
  const cw = line.pts.map((p) => r * 0.42 * Math.pow(p.u, 1.6) + 0.6), ca = line.pts.map((p) => strength * smooth(0.25, 0.9, p.u));
  taperLine(g, haze, cw, pal.rim, ca, 2.6, 0.35, true);
  taperLine(g, haze, cw, WHITE, ca, 1, 0.95);
  // 霜线上的雾带：一道道白色霜尘
  const span = Math.max(0.001, clock.newest - clock.oldest), mist = mixRgb(pal.rim, WHITE, 0.6);
  for (let k = 0; k < 2; k++) {
    const pts = line.pts.map((p) => {
      const born = clock.oldest + p.u * span, off = iceStrand(k, born, seed) * W * iceOpen(clock.newest - born);
      return [p.x + p.nx * off, p.y + p.ny * off];
    });
    const ws = line.pts.map((p) => r * (0.16 + 0.42 * smooth(0, 0.5, p.u))), as = line.pts.map((p) => strength * smooth(0, 0.4, p.u) * (1 - smooth(0.8, 1, p.u)));
    taperLine(g, pts, ws, mist, as, 2.4, 0.09, true);
    taperLine(g, pts, ws, mist, as, 0.8, 0.2, true);
  }
  for (const d of iceDust(line, r, trailWidth, strength, seed, clock.oldest, clock.newest, frame, amount)) {
    const col = mixRgb(pal.rim, WHITE, 0.5 + d.tone * 0.5);
    if (d.star) drawIceGlint(g, d.at, d.size, col, d.alpha, d.tone);
    else { g.fillStyle = rgba(col, d.alpha); g.fillRect(d.at[0] - d.size / 2, d.at[1] - d.size / 2, d.size, d.size); }
  }
  g.restore();
}

// 弹头：一把细长、微弯的光刃。白热的芯收成针尖，外面裹着一圈紧凑的青蓝色柔光（不拉成长条）。
// 刃形 [x, 上缘, 下缘]（r 的倍数，+x 朝前）
export function iceBlade(r, scale = 1, n = 16) {
  const back = -1.2, tip = 2.2, top = [], bottom = [];
  for (let k = 0; k <= n; k++) {
    const s = k / n, x = (back + (tip - back) * s) * r, f = Math.pow(s, 0.35) * Math.pow(1 - s, 1.2) * 2.29, y = -r * 0.08 * Math.sin(Math.PI * s);
    top.push([x, y - r * 0.24 * f * scale]);
    bottom.push([x, y + r * 0.14 * f * scale]);
  }
  return { top, bottom, back: back * r, tip: tip * r, poly: [...top, ...bottom.slice(1, -1).reverse()] };
}

function bladeFill(g, b, c0, a0, c1, a1) { gradFill(g, b.poly, [b.back, 0], [b.tip, 0], c0, a0, c1, a1); }

export function drawIceSpear(g, c, r) {
  const pal = c.pal, cols = iceRibbonColors(pal), pulse = 0.9 + 0.1 * Math.sin(c.t * TAU * 3);
  g.save();
  g.globalCompositeOperation = pal.dark ? "source-over" : "lighter";
  g.save(); g.scale(1.3, 0.8); blob(g, r * 0.25, 0, r * 1.35, [[0, pal.rim, 0.6], [0.5, cols[1], 0.18], [1, cols[1], 0]]); g.restore();
  const blade = iceBlade(r);
  bladeFill(g, blade, pal.rim, 0, mixRgb(pal.rim, WHITE, 0.55), 0.9);
  bladeFill(g, iceBlade(r, 0.4), WHITE, 0.2, WHITE, 1);
  g.strokeStyle = rgba(mixRgb(pal.rim, WHITE, 0.7), 0.75); g.lineWidth = Math.max(0.6, r * 0.04); g.lineCap = "round"; g.lineJoin = "round";
  g.beginPath(); blade.top.slice(2).forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.stroke();
  blob(g, -r * 0.1, -r * 0.04, r * 0.55 * pulse, [[0, WHITE, 0.8], [0.4, pal.rim, 0.3], [1, pal.rim, 0]]);
  const tip = blade.tip, ng = g.createLinearGradient(tip - r * 0.15, 0, tip + r * 0.5, 0);
  ng.addColorStop(0, rgba(WHITE, 0.75)); ng.addColorStop(1, rgba(WHITE, 0));
  g.strokeStyle = ng; g.lineWidth = Math.max(0.6, r * 0.05);
  g.beginPath(); g.moveTo(tip - r * 0.15, 0); g.lineTo(tip + r * 0.5, 0); g.stroke();
  g.restore();
}

// 出手时在起点张开的月牙光环
export function drawIceMuzzle(g, pal, at, angle, r, age) {
  const life = 9;
  if (age < 0 || age >= life) return;
  const f = age / life, a = Math.pow(1 - f, 1.5), R = r * (1 + f * 2.2), cols = iceRibbonColors(pal);
  g.save();
  g.globalCompositeOperation = pal.dark ? "source-over" : "lighter";
  g.translate(at[0], at[1]); g.rotate(angle);
  ring(g, 0, 0, R, Math.max(0.6, r * 0.09), 1, WHITE, a * 0.9, 0.3);
  ring(g, 0, 0, R * 1.18, Math.max(0.6, r * 0.14), 1, cols[0], a * 0.55, 0.32);
  ring(g, 0, 0, R * 0.8, Math.max(0.6, r * 0.1), 1, cols[2], a * 0.35, 0.28);
  blob(g, 0, 0, r * 1.4 * (1 - f), [[0, WHITE, a * 0.8], [1, pal.rim, 0]]);
  g.restore();
}

// 命中时的冰晶爆发：放射冰刺、彩色光环、闪光点和霜尘
export function iceBurst(radius, seed, t, angle, amount = 1) {
  const P = rng(seed * 1009 + 17), grow = 1 - Math.pow(1 - clamp01(t / 0.12), 3), fade = 1 - smooth(0.55, 1, t);
  const spikes = [], glints = [];
  for (let j = 0; j < 9; j++) {
    const a = angle + Math.PI + (j - 4) * 0.62 + (P() - 0.5) * 0.4, len = radius * (0.45 + P() * 0.75) * grow;
    spikes.push({ angle: a, length: len, width: len * (0.08 + P() * 0.05) + radius * 0.015, alpha: fade * (0.7 + 0.3 * P()) });
  }
  const move = 1 - Math.pow(1 - clamp01(t / 0.7), 2);
  for (let j = 0, n = Math.round(16 * Math.max(0.25, Math.min(2, amount))); j < n; j++) {
    const a = P() * TAU, d = radius * (0.2 + P() * 0.95) * move, life = 0.55 + P() * 0.45;
    const tw = 0.6 + 0.4 * Math.sin(t * 40 + j * 2.3);
    glints.push({ at: [Math.cos(a) * d, Math.sin(a) * d * 0.75 + radius * 0.15 * t * t], size: Math.max(0.6, radius * (0.02 + P() * 0.03)), alpha: (1 - smooth(life * 0.5, life, t)) * tw, star: j % 3 === 0 });
  }
  return { spikes, glints, grow, fade };
}

export function drawIceBurst(g, pal, radius, seed, t, angle, amount = 1) {
  const b = iceBurst(radius, seed, t, angle, amount), cols = iceRibbonColors(pal), wave = 1 - Math.pow(1 - clamp01(t / 0.5), 2);
  g.save();
  g.globalCompositeOperation = pal.dark ? "source-over" : "lighter";
  ring(g, 0, 0, Math.max(0.6, wave * radius * 1.05), Math.max(0.8, radius * 0.05), 0.55, cols[1], (1 - t) * 0.6);
  ring(g, 0, 0, Math.max(0.6, wave * radius * 1.4), Math.max(0.6, radius * 0.025), 0.55, cols[2], (1 - t) * 0.45);
  for (const s of b.spikes) drawIceCrystal(g, [0, 0], s.angle, s.length, s.width, pal, s.alpha);
  for (const p of b.glints) {
    const col = mixRgb(pal.rim, WHITE, 0.6);
    if (p.star) drawIceGlint(g, p.at, p.size, col, p.alpha, t * 3);
    else { g.fillStyle = rgba(col, p.alpha); g.fillRect(p.at[0] - p.size / 2, p.at[1] - p.size / 2, p.size, p.size); }
  }
  const flash = 1 - smooth(0, 0.18, t);
  blob(g, 0, 0, radius * 1.1, [[0, WHITE, flash * 0.9], [0.3, pal.rim, flash * 0.45], [1, cols[1], 0]]);
  g.restore();
}
