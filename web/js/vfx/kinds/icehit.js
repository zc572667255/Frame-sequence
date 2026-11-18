import { rng, rgba, smooth } from "../../trails/glow/util.js";
import { TAU, easeOut } from "../common.js";
import { iceTones, chipPoints, crystal, sparklePoints, drawPieces } from "./ice.js";

// The ice lance striking, in the same flat cel shading as the lance: a white
// sparkle flash, a fan of ice spikes shooting out of the point it hit (mostly
// the way it flew), which hold a moment and then shatter, each into a few
// pieces that tumble away and fall; small chips fly from the start, and a
// thin ring spreads. All a function of t (0..1 over the hit), so any frame can
// be sought; all is gone by t = 1. godot/icehit.js draws exactly the same.
//
// R: the hit's radius; angle: the direction the lance flew.
// → { flash: { size, alpha }, ring: { radius, alpha }, pieces: [crystal] }
export function iceBurst(R, amount, seed, t, angle = 0) {
  const P = rng(seed * 227 + 61), q = Math.max(0.25, Math.min(2, amount)), e = easeOut(t), pieces = [];
  const fade = 1 - smooth(0.62, 0.97, t);
  for (let j = 0, n = Math.round(6 + 2 * q); j < n; j++) {
    const k = n > 1 ? j / (n - 1) - 0.5 : 0, a = angle + k * 2.8 + (P() - 0.5) * 0.25;
    const L = R * (0.7 + 0.55 * P()) * (1 - 0.35 * Math.abs(k) * 2), w = L * (0.12 + 0.06 * P()), tb = 0.36 + 0.12 * P();
    const dir = [Math.cos(a), Math.sin(a)], grow = easeOut(Math.min(1, t / 0.16));
    // the spike from just behind the point it hit out to its tip
    const back = [-dir[0] * w * 0.8, -dir[1] * w * 0.8], full = L * grow + w * 0.8;
    const shards = [];
    for (let m = 0; m < 3; m++) {
      const u0 = m / 3, u1 = (m + 1) / 3, um = (u0 + u1) / 2;
      shards.push({ um, len: (u1 - u0) * full * 1.1, width: w * (m === 2 ? 0.55 : 1 - 0.3 * m), v: [dir[0] * R * (0.5 + 0.8 * P()) - dir[1] * (P() - 0.5) * R * 0.6, dir[1] * R * (0.5 + 0.8 * P()) + dir[0] * (P() - 0.5) * R * 0.6], spin: (P() - 0.5) * 8 });
    }
    if (t < tb) {
      if (grow > 0.001) pieces.push(crystal(chipPoints(back, a, full, w), 1));
      continue;
    }
    const dt = t - tb;
    for (const s of shards) {
      const c = [back[0] + dir[0] * full * s.um + s.v[0] * dt, back[1] + dir[1] * full * s.um + s.v[1] * dt + R * 1.4 * dt * dt], ang = a + s.spin * dt;
      pieces.push(crystal(chipPoints([c[0] - Math.cos(ang) * s.len * 0.5, c[1] - Math.sin(ang) * s.len * 0.5], ang, s.len, s.width), fade));
    }
  }
  for (let j = 0, n = Math.round(10 * q); j < n; j++) {
    const a = angle + (P() - 0.5) * (P() < 0.7 ? 2.2 : TAU), len = R * (0.08 + 0.12 * P()), speed = R * (0.9 + 1.2 * P()), rot = P() * TAU, spin = (P() - 0.5) * 10, life = 0.45 + 0.4 * P();
    const d = speed * t * (1 - 0.45 * t), ang = rot + spin * t;
    pieces.push(crystal(chipPoints([Math.cos(a) * d, Math.sin(a) * d + R * 0.6 * t * t], ang, len * (1 - 0.3 * t), len * 0.3), 1 - smooth(life * 0.5, life, t)));
  }
  return {
    flash: { size: R * 0.55 * Math.sin(Math.PI * Math.min(1, t / 0.18)), alpha: t < 0.18 ? 1 : 0 },
    ring: { radius: R * (0.25 + 0.85 * e), alpha: 0.45 * (1 - smooth(0.05, 0.4, t)) },
    pieces,
  };
}

export function drawIceImpact(g, c, radius, angle = 0) {
  const T = iceTones(c.pal), hit = iceBurst(radius, c.amount, c.seed, c.t, angle);
  g.save(); g.translate(c.cx, c.cy);
  g.globalCompositeOperation = "source-over";
  if (hit.ring.alpha > 0.005) {
    g.strokeStyle = rgba(T.light, hit.ring.alpha); g.lineWidth = Math.max(0.6, radius * 0.03);
    g.beginPath(); g.arc(0, 0, hit.ring.radius, 0, TAU); g.stroke();
  }
  drawPieces(g, hit.pieces, T, Math.max(0.5, radius * 0.018));
  if (hit.flash.alpha > 0 && hit.flash.size > 0.3) {
    const pts = sparklePoints(0, 0, hit.flash.size);
    g.fillStyle = rgba(T.hi, hit.flash.alpha); g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fill();
  }
  g.restore();
}
