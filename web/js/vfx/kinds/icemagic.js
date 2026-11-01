// 冰矛的“魔法”层：发亮的白芯、交织的青/蓝/紫彩带、沿路长出的冰刺、霜尘与闪光点、
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
export const iceEnvelope = (u) => Math.pow(clamp01(u), 0.55) * Math.pow(clamp01(1 - u), 0.35) * 1.9;

// 均匀重采样的中心线（u: 0 = 最老的尾端, 1 = 弹头）
export function iceLine(points, n = 40) {
  const pts = [];
  for (const p of points) if (!pts.length || Math.hypot(p[0] - pts.at(-1)[0], p[1] - pts.at(-1)[1]) > 0.35) pts.push(p);
  if (pts.length < 2) return null;
  const lengths = [0];
  for (let i = 1; i < pts.length; i++) lengths.push(lengths[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = lengths.at(-1);
  if (total < 0.5) return null;
  const out = [];
  let i = 1;
  for (let k = 0; k <= n; k++) {
    const u = k / n, dist = u * total;
    while (i < pts.length - 1 && lengths[i] < dist) i++;
    const seg = Math.max(1e-6, lengths[i] - lengths[i - 1]), f = clamp01((dist - lengths[i - 1]) / seg);
    const a = pts[i - 1], b = pts[i], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.max(1e-6, Math.hypot(dx, dy));
    out.push({ x: a[0] + dx * f, y: a[1] + dy * f, dx: dx / len, dy: dy / len, nx: -dy / len, ny: dx / len, u });
  }
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

// 沿路长出的冰刺：弹头经过后迅速长出，朝后外侧斜指
export function iceSpikes(line, r, trailWidth, strength, seed, oldest, newest, amount = 1) {
  if (!line || strength <= 0.001) return [];
  const span = Math.max(0.001, newest - oldest), step = 0.5 / Math.max(0.25, Math.min(2, amount)), W = iceSpread(r, trailWidth, strength), out = [];
  for (let n = Math.ceil(oldest / step); n <= Math.floor(newest / step + 1e-6); n++) {
    const born = n * step, u = clamp01((born - oldest) / span), age = newest - born;
    const p = line.pts[Math.round(u * (line.pts.length - 1))];
    const P = rng(seed * 613 + n * 131); P();
    const side = P() < 0.5 ? -1 : 1, off = side * W * (0.12 + P() * 0.5) * (0.35 + iceEnvelope(u) * 0.65);
    const tilt = 0.5 + P() * 0.7, angle = Math.atan2(p.dy, p.dx) + side * (Math.PI - tilt);
    const length = r * (0.35 + P() * 0.75) * (0.4 + 0.6 * u) * smooth(0, 1.2, age);
    const width = length * (0.16 + P() * 0.1);
    const alpha = strength * smooth(0, 0.25, u) * (0.6 + 0.4 * P());
    if (length > 0.4) out.push({ root: [p.x + p.nx * off, p.y + p.ny * off], angle, length, width, alpha });
  }
  return out;
}

// 霜尘和闪光点：出生后向外飘散并闪烁
export function iceDust(line, r, trailWidth, strength, seed, oldest, newest, frame, amount = 1) {
  if (!line || strength <= 0.001) return [];
  const span = Math.max(0.001, newest - oldest), step = 0.12 / Math.max(0.25, Math.min(2, amount)), W = iceSpread(r, trailWidth, strength), out = [];
  for (let n = Math.ceil(oldest / step); n <= Math.floor(newest / step + 1e-6); n++) {
    const born = n * step, u = clamp01((born - oldest) / span), age = newest - born;
    const p = line.pts[Math.round(u * (line.pts.length - 1))];
    const P = rng(seed * 733 + n * 53); P();
    const side = P() * 2 - 1, off = side * W * (0.25 + 0.75 * iceEnvelope(u)) + side * r * 0.08 * age;
    const size = Math.max(0.6, r * (0.025 + P() * 0.045)), star = P() < 0.12;
    const twinkle = 0.55 + 0.45 * Math.sin(frame * 1.7 + P() * TAU);
    const alpha = strength * smooth(0, 0.2, u) * (0.35 + 0.65 * P()) * twinkle;
    out.push({ at: [p.x + p.nx * off, p.y + p.ny * off + r * 0.02 * age], size, star, alpha, tone: P() });
  }
  return out;
}

// 宽度和透明度逐点变化的线（与 Godot 的 _line(pts, cols, w, ws) 相同）
export function taperLine(g, pts, widths, color, alphas, scale = 1, amul = 1) {
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
    g.fillStyle = rgba(color, a);
    g.beginPath();
    g.moveTo(p[0] + m[0] * h0, p[1] + m[1] * h0); g.lineTo(q[0] + k[0] * h1, q[1] + k[1] * h1);
    g.lineTo(q[0] - k[0] * h1, q[1] - k[1] * h1); g.lineTo(p[0] - m[0] * h0, p[1] - m[1] * h0);
    g.closePath(); g.fill();
  }
}

export function drawIceKite(g, root, angle, length, width, pal, alpha) {
  if (alpha <= 0.004 || length <= 0.4) return;
  const d = [Math.cos(angle), Math.sin(angle)], n = [-d[1], d[0]];
  const tip = [root[0] + d[0] * length, root[1] + d[1] * length], mid = [root[0] + d[0] * length * 0.3, root[1] + d[1] * length * 0.3];
  const back = [root[0] - d[0] * width * 0.6, root[1] - d[1] * width * 0.6];
  const gr = g.createLinearGradient(root[0], root[1], tip[0], tip[1]);
  gr.addColorStop(0, rgba(pal.rim, alpha * 0.35));
  gr.addColorStop(1, rgba(mixRgb(pal.core, pal.rim, 0.2), alpha * 0.95));
  g.fillStyle = gr;
  g.beginPath(); g.moveTo(...back); g.lineTo(mid[0] + n[0] * width, mid[1] + n[1] * width); g.lineTo(...tip); g.lineTo(mid[0] - n[0] * width, mid[1] - n[1] * width); g.closePath(); g.fill();
  g.strokeStyle = rgba(pal.core, alpha * 0.85); g.lineWidth = Math.max(0.5, width * 0.22); g.lineCap = "round";
  g.beginPath(); g.moveTo(mid[0] + n[0] * width, mid[1] + n[1] * width); g.lineTo(...tip); g.stroke();
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
  const haze = line.pts.map((p) => [p.x, p.y]), hw = line.pts.map((p) => W * (0.35 + 1.5 * iceEnvelope(p.u))), ha = line.pts.map((p) => strength * smooth(0, 0.4, p.u) * 0.16);
  taperLine(g, haze, hw, deep, ha);
  for (const rb of iceRibbons(line, r, trailWidth, strength, frame)) {
    const col = cols[rb.k];
    taperLine(g, rb.pts, rb.widths, col, rb.alphas, 3.2, 0.28);
    taperLine(g, rb.pts, rb.widths, mixRgb(col, WHITE, 0.3), rb.alphas, 1, 0.9);
    taperLine(g, rb.pts, rb.widths, WHITE, rb.alphas.map((a, i) => a * line.pts[i].u), 0.3, 0.7);
  }
  // 白芯：后段到弹头的一道高亮光束
  const cw = line.pts.map((p) => r * 0.42 * Math.pow(p.u, 1.6) + 0.6), ca = line.pts.map((p) => strength * smooth(0.25, 0.9, p.u));
  taperLine(g, haze, cw, pal.rim, ca, 2.6, 0.35);
  taperLine(g, haze, cw, WHITE, ca, 1, 0.95);
  for (const s of iceSpikes(line, r, trailWidth, strength, seed, clock.oldest, clock.newest, amount)) drawIceKite(g, s.root, s.angle, s.length, s.width, pal, s.alpha);
  for (const d of iceDust(line, r, trailWidth, strength, seed, clock.oldest, clock.newest, frame, amount)) {
    const col = mixRgb(pal.rim, WHITE, 0.4 + d.tone * 0.6);
    if (d.star) drawIceGlint(g, d.at, d.size, col, d.alpha, d.tone);
    else { g.fillStyle = rgba(col, d.alpha); g.fillRect(d.at[0] - d.size / 2, d.at[1] - d.size / 2, d.size, d.size); }
  }
  g.restore();
}

// 弹头外面的光：拉长的辉光、蓝紫外晕和身后的冰晶簇（画在冰晶之前）
export function drawIceHeadBack(g, c, r) {
  const pal = c.pal, cols = iceRibbonColors(pal);
  g.save();
  g.globalCompositeOperation = pal.dark ? "source-over" : "lighter";
  g.save(); g.scale(2.6, 0.7); blob(g, -r * 0.1, 0, r * 2.3, [[0, pal.rim, 0.42], [0.5, cols[1], 0.14], [1, cols[1], 0]]); g.restore();
  g.save(); g.scale(3.2, 0.5); blob(g, -r * 0.55, 0, r * 2.2, [[0, cols[2], 0.16], [1, cols[2], 0]]); g.restore();
  const P = rng(c.seed * 977 + 5);
  for (let j = 0; j < 6; j++) {
    const side = j % 2 ? -1 : 1, x = -r * (1.3 - P() * 2.1), tilt = 0.45 + P() * 0.55;
    const len = r * (0.8 + P() * 0.9) * (0.92 + 0.08 * Math.sin(c.t * TAU * 2 + j));
    drawIceKite(g, [x, side * r * 0.25], side * (Math.PI - tilt), len, len * 0.2, pal, 0.75);
  }
  g.restore();
}

// 冰晶前面的光：白热的梭形光芯和弹尖的星芒（画在冰晶之后）
export function drawIceHeadFront(g, c, r, tip) {
  const pal = c.pal;
  g.save();
  g.globalCompositeOperation = pal.dark ? "source-over" : "lighter";
  const gr = g.createLinearGradient(-r * 1.6, 0, tip[0], 0);
  gr.addColorStop(0, rgba(pal.rim, 0)); gr.addColorStop(0.45, rgba(WHITE, 0.75)); gr.addColorStop(1, rgba(WHITE, 0.95));
  g.fillStyle = gr;
  g.beginPath(); g.moveTo(-r * 1.6, 0); g.quadraticCurveTo(r * 0.6, -r * 0.34, tip[0], tip[1]); g.quadraticCurveTo(r * 0.6, r * 0.34, -r * 1.6, 0); g.closePath(); g.fill();
  const pulse = 0.85 + 0.15 * Math.sin(c.t * TAU * 3);
  blob(g, tip[0], tip[1], r * 1.1 * pulse, [[0, WHITE, 0.95], [0.25, pal.rim, 0.45], [1, pal.rim, 0]]);
  drawIceGlint(g, tip, r * 0.32 * pulse, mixRgb(pal.rim, WHITE, 0.5), 0.9, 0);
  g.strokeStyle = rgba(WHITE, 0.55); g.lineWidth = Math.max(0.6, r * 0.05); g.lineCap = "round";
  g.beginPath(); g.moveTo(tip[0] - r * 2.6, tip[1]); g.lineTo(tip[0] + r * 1.4, tip[1]); g.stroke();
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
    const a = angle + Math.PI + (j - 4) * 0.62 + (P() - 0.5) * 0.4, len = radius * (0.45 + P() * 0.6) * grow;
    spikes.push({ angle: a, length: len, width: len * (0.16 + P() * 0.08), alpha: fade * (0.7 + 0.3 * P()) });
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
  for (const s of b.spikes) drawIceKite(g, [0, 0], s.angle, s.length, s.width, pal, s.alpha);
  for (const p of b.glints) {
    const col = mixRgb(pal.rim, WHITE, 0.6);
    if (p.star) drawIceGlint(g, p.at, p.size, col, p.alpha, t * 3);
    else { g.fillStyle = rgba(col, p.alpha); g.fillRect(p.at[0] - p.size / 2, p.at[1] - p.size / 2, p.size, p.size); }
  }
  const flash = 1 - smooth(0, 0.18, t);
  blob(g, 0, 0, radius * 1.1, [[0, WHITE, flash * 0.9], [0.3, pal.rim, flash * 0.45], [1, cols[1], 0]]);
  g.restore();
}
