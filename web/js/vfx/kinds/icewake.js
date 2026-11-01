// Frost left behind an ice lance: a tapered mist, a bright core, and shards
// that stay on the birth time of the path (seeking a frame does not reshuffle them).
import { rng, rgba } from "../../trails/glow/util.js";
import { mixRgb } from "../common.js";
import { drawIceMagicWake } from "./icemagic.js";

export function iceWakeHalf(r, u, trailWidth = 70, strength = 1) {
  const widen = 0.35 + 0.7 * Math.max(0, Math.min(180, trailWidth)) / 100;
  const along = 0.1 + 0.9 * Math.pow(Math.max(0, Math.min(1, u)), 0.62);
  return Math.max(0, r) * widen * along * Math.sqrt(Math.max(0, strength));
}

function centerline(points) {
  const pts = [];
  for (const p of points) if (!pts.length || Math.hypot(p[0] - pts.at(-1)[0], p[1] - pts.at(-1)[1]) > 0.35) pts.push(p);
  if (pts.length < 2) return null;
  const lengths = [0];
  for (let i = 1; i < pts.length; i++) lengths.push(lengths[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return { pts, lengths, total: lengths.at(-1) };
}

function atLength(line, dist) {
  const { pts, lengths } = line;
  let i = 1;
  while (i < pts.length - 1 && lengths[i] < dist) i++;
  const seg = lengths[i] - lengths[i - 1] || 1;
  const f = Math.max(0, Math.min(1, (dist - lengths[i - 1]) / seg));
  const a = pts[i - 1], b = pts[i];
  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
  return { x: a[0] + dx * f, y: a[1] + dy * f, nx: -dy / len, ny: dx / len, dx: dx / len, dy: dy / len };
}

// Same emission order as _remote_ice_wake in godot/ice.js.
export function iceWakeShards(points, r, strength, seed, oldest, newest, trailWidth = 70, frame = 0) {
  const line = centerline(points);
  if (!line || line.total < 0.5 || strength <= 0.001) return [];
  const span = Math.max(0.001, newest - oldest), step = 0.85;
  const shards = [];
  for (let n = Math.ceil(oldest / step); n <= Math.floor(newest / step + 1e-6); n++) {
    const born = n * step, u = Math.max(0, Math.min(1, (born - oldest) / span));
    const p = atLength(line, u * line.total);
    const P = rng(seed * 503 + n * 97);
    const side = (P() * 2 - 1) * iceWakeHalf(r, u, trailWidth, strength) * 0.72;
    const dir = P() < 0.5 ? -1 : 1;
    const spin = dir * (frame * 0.35 + P() * 6.2);
    const length = r * (0.22 + P() * 0.42) * (0.45 + u * 0.7);
    const width = length * (0.18 + P() * 0.16);
    const alpha = strength * Math.pow(Math.max(0.001, u), 0.35) * (0.45 + P() * 0.5);
    const angle = Math.atan2(p.dy, p.dx) + (P() - 0.5) * 0.9 + spin;
    shards.push({ at: [p.x + p.nx * side, p.y + p.ny * side], angle, length, width, alpha, u });
  }
  return shards;
}

function ribbon(g, line, halfOf, color, alpha) {
  const { pts } = line, n = pts.length - 1;
  g.beginPath();
  for (let i = 0; i <= n; i++) {
    const s = atLength(line, line.lengths[i]), h = halfOf(i / n);
    const x = s.x + s.nx * h, y = s.y + s.ny * h;
    if (i) g.lineTo(x, y); else g.moveTo(x, y);
  }
  for (let i = n; i >= 0; i--) {
    const s = atLength(line, line.lengths[i]), h = halfOf(i / n);
    g.lineTo(s.x - s.nx * h, s.y - s.ny * h);
  }
  g.closePath();
  const a = pts[0], b = pts[n];
  const gr = g.createLinearGradient(a[0], a[1], b[0], b[1]);
  gr.addColorStop(0, rgba(color, 0));
  gr.addColorStop(0.22, rgba(color, alpha));
  gr.addColorStop(1, rgba(color, alpha));
  g.fillStyle = gr;
  g.fill();
}

function shard(g, s, pal) {
  g.save();
  g.translate(s.at[0], s.at[1]);
  g.rotate(s.angle);
  g.beginPath();
  g.moveTo(s.length * 0.62, 0);
  g.lineTo(0, s.width);
  g.lineTo(-s.length * 0.38, 0);
  g.lineTo(0, -s.width);
  g.closePath();
  const gr = g.createLinearGradient(-s.length * 0.4, 0, s.length * 0.6, 0);
  gr.addColorStop(0, rgba(pal.rim, s.alpha * 0.15));
  gr.addColorStop(0.45, rgba(mixRgb(pal.core, pal.rim, 0.25), s.alpha));
  gr.addColorStop(1, rgba(pal.rim, s.alpha * 0.05));
  g.fillStyle = gr;
  g.fill();
  g.restore();
}

export function drawIceWake(g, pal, points, r, strength, seed, clock, trailWidth, frame, amount = 1) {
  const line = centerline(points);
  if (!line || strength <= 0.001) return;
  g.save();
  g.globalCompositeOperation = pal.dark ? "source-over" : "lighter";
  ribbon(g, line, (u) => iceWakeHalf(r, u, trailWidth, strength), pal.rim, 0.12 * strength);
  g.restore();
  drawIceMagicWake(g, pal, points, r, strength, seed, clock, trailWidth, frame, amount);
  g.save();
  g.globalCompositeOperation = pal.dark ? "source-over" : "lighter";
  for (const s of iceWakeShards(points, r, strength, seed, clock.oldest, clock.newest, trailWidth, frame)) shard(g, s, pal);
  g.restore();
}
