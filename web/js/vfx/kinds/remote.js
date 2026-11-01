import { createCanvas } from "../../core/util.js";
import { rng, rgba } from "../../trails/glow/util.js";
import { TAU, at, blob, ring, bolt, swirl, trail, streak } from "../common.js";
import { drawRemoteTrail } from "../remotetrail.js";
import { REMOTE_DEFAULTS, remoteSettings, hasFlight, flightState, pathAt } from "../remote.js";
import { fireball } from "./fireball.js";
import { arrow } from "./arrow.js";
import { drawIcePrism } from "./ice.js";
import { drawIceImpact } from "./icehit.js";
import { drawThunderImpact } from "./thunderhit.js";
import { drawSandBody, drawSandImpact } from "./sand.js";
import { explosion } from "./explosion.js";
import { shock } from "./shock.js";
import { hit } from "./hit.js";
import { accentAmounts, drawAccents } from "../accents.js";

// Each material has its own geometry, independent of palette and flight path.
export function remoteBody(g, c, r) {
  const { pal, t } = c;
  if (c.kind === "fireball" || c.kind === "arrow") {
    const box = Math.max(16, Math.ceil(r * 8)), cv = createCanvas(box, box), ctx = cv.getContext("2d");
    const local = { ...c, w: box, h: box, cx: box / 2, cy: box / 2, R: c.kind === "fireball" ? r / 0.29 : r * 2.1,
      bodyOnly: true, bodyRadius: r, loop: true, pixel: false, amount: 0 };
    (c.kind === "fireball" ? fireball : arrow)(ctx, local);
    g.globalCompositeOperation = "source-over";
    g.drawImage(cv, -box / 2, -box / 2);
  } else if (c.kind === "ice") {
    drawIcePrism(g, c, r);
  } else if (c.kind === "thunder") {
    const Q = rng(c.seed * 139 + Math.floor(c.i / 2));
    g.globalCompositeOperation = "lighter";
    blob(g, -r * 0.15, 0, r * 1.7, [[0, pal.rim, 0.34], [0.45, pal.rim, 0.1], [1, pal.rim, 0]]);
    const dart = (x0, x1, amp, n) => {
      const pts = [];
      for (let k = 0; k <= n; k++) pts.push([x0 + (x1 - x0) * k / n, (k === 0 || k === n) ? 0 : (Q() * 2 - 1) * amp]);
      return pts;
    };
    const main = dart(-r * 1.85, r * 1.15, r * 0.22, 7);
    bolt(g, pal, main, Math.max(0.7, r * 0.075), 1);
    for (let j = 0; j < 3; j++) {
      const from = main[2 + j], fork = [from];
      let x = from[0], y = from[1];
      const side = j === 1 ? -1 : 1;
      for (let k = 0; k < 3; k++) { x -= r * (0.28 + Q() * 0.22); y += side * r * (0.18 + Q() * 0.28); fork.push([x, y]); }
      bolt(g, pal, fork, Math.max(0.4, r * 0.032), 0.75);
    }
    blob(g, r * 0.95, 0, r * 0.48, [[0, pal.core, 1], [0.35, pal.core, 0.75], [1, pal.rim, 0]]);
  } else if (c.kind === "wind") {
    const flick = 0.5 + 0.5 * Math.sin(t * TAU * 3);
    g.globalCompositeOperation = pal.dark ? "source-over" : "lighter";
    blob(g, -r * 0.15, 0, r * 1.15, [[0, pal.core, 0.16], [0.55, pal.rim, 0.05], [1, pal.rim, 0]]);
    const blade = [];
    for (let k = 0; k <= 18; k++) {
      const a = -1.15 + (k / 18) * 2.3, rad = r * (0.72 + 0.28 * Math.sin((k / 18) * Math.PI));
      blade.push([Math.cos(a) * rad * 1.25, Math.sin(a) * rad * 0.62]);
    }
    trail(g, pal, blade, Math.max(0.7, r * 0.11), 0.75 + flick * 0.2, false);
    for (let j = 0; j < 5; j++) {
      const y = (j - 2) * r * 0.22, back = r * (1.1 + (j % 2) * 0.45);
      trail(g, pal, [[-back, y * 0.35], [-r * 0.15, y]], Math.max(0.35, r * 0.028), 0.28 + (j === 2 ? 0.22 : 0), true);
    }
  } else if (c.kind === "sand") {
    drawSandBody(g, c, r);
  }
}

function drawWindImpact(g, c, radius) {
  const { pal, t } = c, a = 1 - t, spin = t * 5;
  g.save();
  g.translate(c.cx, c.cy);
  g.globalCompositeOperation = pal.dark ? "source-over" : "lighter";
  for (let j = 0; j < 3; j++) {
    const reach = radius * (0.28 + t * (0.75 + j * 0.16));
    swirl(g, pal, 0, 0, reach, reach * 0.58, spin + j * 1.7, a * (0.62 - j * 0.14), Math.max(0.6, radius * 0.032));
  }
  ring(g, 0, 0, Math.max(0.4, t * radius * 1.15), Math.max(0.6, radius * 0.04), 0.72, pal.core, a * 0.75);
  const P = rng(c.seed * 157 + 11);
  for (let j = 0; j < 8; j++) {
    const th = -0.7 + P() * 1.4, len = radius * (0.35 + t * 0.95);
    streak(g, [-len * 0.25, Math.sin(th) * len * 0.15], [Math.cos(th) * len * 0.35, Math.sin(th) * len * 0.7], pal.rim, pal.core, a * 0.55, Math.max(0.5, radius * 0.02));
  }
  blob(g, 0, 0, radius * 0.42 * Math.max(0.15, a), [[0, pal.core, a * 0.55], [1, pal.rim, 0]]);
  g.restore();
}

function impact(g, c, s, atPoint, t, angle) {
  if (s.impactKind === "none" || t < 0 || t >= 1) return;
  const radius = Math.min(c.w, c.h) * s.impactSize / 100;
  const local = { ...c, t, loop: false, cx: atPoint[0], cy: atPoint[1], R: radius, gy: atPoint[1], squash: 0.45 };
  const kind = s.impactKind;
  if (c.kind === "ice" && (kind === "auto" || kind === "explosion")) return drawIceImpact(g, { ...local, bodyRadius: Math.min(c.w,c.h)*s.bodySize/100*s.size/90, iceRoll: (s.chargeFrames+s.travelFrames)/s.frames*TAU+c.seed }, radius, angle);
  if (c.kind === "thunder" && (kind === "auto" || kind === "explosion")) return drawThunderImpact(g, local, radius);
  if (c.kind === "wind" && (kind === "auto" || kind === "shock")) return drawWindImpact(g, local, radius);
  if (c.kind === "sand" && (kind === "auto" || kind === "explosion")) return drawSandImpact(g, local, radius);
  if (kind === "explosion" || (kind === "auto" && c.kind === "fireball")) return explosion(g, local);
  if (kind === "shock") return shock(g, local);
  if (kind === "hit" || (kind === "auto" && c.kind === "arrow")) return hit(g, local);
  const { pal } = c, a = 1 - t, reach = radius * (1 - (1 - t) ** 2);
  g.globalCompositeOperation = pal.dark ? "source-over" : "lighter";
  ring(g, ...atPoint, Math.max(0.1, reach), Math.max(0.6, radius * 0.035), 0.65, pal.rim, a * 0.7);
  const P = rng(c.seed * 157 + 11);
  for (let j = 0, n = Math.round((c.kind === "sand" ? 60 : 16) * c.amount); j < n; j++) {
    const th = P() * TAU, distance = reach * (0.4 + P() * 0.7), sz = 0.5 + P() * 0.7;
    const x = atPoint[0] + Math.cos(th) * distance, y = atPoint[1] + Math.sin(th) * distance * 0.8;
    if (c.kind === "wind") {
      if (j < 4) swirl(g, pal, ...atPoint, reach * (0.65 + j * 0.1), reach * 0.4, th + t * 4, a * 0.6, Math.max(0.6, radius * 0.025));
    } else {
      g.fillStyle = rgba(at(pal.flame, 0.3 + P() * 0.6), a); const px = Math.max(0.6, radius * 0.035 * sz); g.fillRect(x, y + t * t * radius * 0.4, px, px);
    }
  }
  blob(g, ...atPoint, radius * 0.65 * a, [[0, pal.core, a * 0.8], [0.3, pal.rim, a * 0.4], [1, pal.rim, 0]]);
}

export function remote(g, c, settings) {
  const s = remoteSettings({ ...REMOTE_DEFAULTS, ...settings });
  const radius = Math.min(c.w, c.h) * Math.max(2, Math.min(16, s.bodySize)) / 100 * s.size / 90;
  const frame = c.t * s.frames;
  if (!hasFlight(s)) {
    g.save(); g.translate(c.cx, c.cy); remoteBody(g, c, radius); g.restore(); return;
  }
  for (let index = 0; index < s.flightCount; index++) {
    const state = flightState(s, c.w, c.h, frame, index);
    if (!state.born || state.finished) continue;
    const ctx = { ...c, seed: c.seed + index * 31 };
    const wrap = drawRemoteTrail(g, ctx, s, state, frame, index, radius);
    if (state.body) {
      const scale = state.launched ? 1 : 0.45 + state.charge * 0.55;
      g.save(); g.translate(...state.at); g.rotate(state.angle);
      remoteBody(g, ctx, radius * scale);
      drawAccents(g, { ...ctx, cx: 0, cy: 0, gy: 0, R: radius * scale * 1.5 }, accentAmounts(s, c.pal.preset));
      g.restore();
      if (wrap) {
        g.save(); g.globalCompositeOperation = c.pal.dark ? "source-over" : "lighter"; g.globalAlpha = 0.14; g.drawImage(wrap, 0, 0); g.restore();
      }
      if (!state.launched) {
        g.globalCompositeOperation = "lighter";
        ring(g, ...state.at, Math.max(0.3, radius * (2.4 - state.charge * 1.3)), Math.max(0.5, radius * 0.08), 0.65, c.pal.rim, state.charge * 0.75);
      }
    }
    impact(g, ctx, s, pathAt(s, c.w, c.h, 1, index), state.hit, state.angle);
  }
  g.globalCompositeOperation = "source-over";
}
