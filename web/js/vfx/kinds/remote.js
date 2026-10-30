import { createCanvas } from "../../core/util.js";
import { rng, rgba } from "../../trails/glow/util.js";
import { TAU, at, blob, ring, bolt, swirl, trail } from "../common.js";
import { drawRemoteTrail, drawPuff } from "../remotetrail.js";
import { REMOTE_DEFAULTS, remoteSettings, hasFlight, flightState, pathAt } from "../remote.js";
import { fireball } from "./fireball.js";
import { arrow } from "./arrow.js";
import { drawIcePrism } from "./ice.js";
import { drawIceImpact } from "./icehit.js";
import { drawThunderImpact } from "./thunderhit.js";
import { drawSandBody } from "./sand.js";
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
    blob(g, 0, 0, r * 2, [[0, pal.core, 0.8], [0.25, pal.rim, 0.4], [1, pal.rim, 0]]);
    for (let j = 0; j < 4; j++) {
      const a = Q() * TAU, points = [];
      for (let k = 0; k < 7; k++) { const angle = a + k * 0.4, radius = r * (0.55 + Q() * 0.5); points.push([Math.cos(angle) * radius, Math.sin(angle) * radius]); }
      bolt(g, pal, points, Math.max(0.55, r * 0.04), 0.8);
    }
    blob(g, 0, 0, r * 0.65, [[0, pal.core, 1], [0.5, pal.core, 0.95], [1, pal.rim, 0]]);
  } else if (c.kind === "wind") {
    const spin = t * TAU * 2;
    for (let j = 0; j < 6; j++) {
      const a = spin + j * TAU / 6;
      drawPuff(g, Math.cos(a) * r * 0.45, Math.sin(a) * r * 0.32, r * 0.72, a, pal.core, 0.58, c.seed + j, 1.5);
    }
    drawPuff(g, 0, 0, r * 0.8, -spin * 0.5, pal.core, 0.85, c.seed, 1.5);
    g.globalCompositeOperation = pal.dark ? "source-over" : "lighter";
    for (let j = 0; j < 2; j++) {
      const points = [];
      for (let k = 0; k <= 18; k++) {
        const a = spin + j * Math.PI + k * 0.15, radius = r * (0.9 + k / 60);
        points.push([Math.cos(a) * radius * 1.5, Math.sin(a) * radius * 0.7]);
      }
      trail(g, pal, points, Math.max(0.6, r * 0.055), 0.32, false);
    }
  } else if (c.kind === "sand") {
    drawSandBody(g, c, r);
  }
}

function impact(g, c, s, atPoint, t, angle) {
  if (s.impactKind === "none" || t < 0 || t >= 1) return;
  const radius = Math.min(c.w, c.h) * s.impactSize / 100;
  const local = { ...c, t, loop: false, cx: atPoint[0], cy: atPoint[1], R: radius, gy: atPoint[1], squash: 0.45 };
  const kind = s.impactKind;
  if (c.kind === "ice" && (kind === "auto" || kind === "explosion")) return drawIceImpact(g, { ...local, bodyRadius: Math.min(c.w,c.h)*s.bodySize/100*s.size/90, iceRoll: (s.chargeFrames+s.travelFrames)/s.frames*TAU+c.seed }, radius, angle);
  if (c.kind === "thunder" && (kind === "auto" || kind === "explosion")) return drawThunderImpact(g, local, radius);
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
      const scale = state.launched ? 1 : 0.15 + state.charge * 0.85;
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
