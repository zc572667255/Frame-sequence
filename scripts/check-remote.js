import assert from "node:assert/strict";
import { REMOTE_DEFAULTS, remoteSettings, hasFlight, pathAt, flightState, flightTrail } from "../web/js/vfx/remote.js";
import { migrate } from "../web/js/core/store.js";
import { ribbonSections, materialAt, flameFlow } from "../web/js/vfx/remotetrail.js";
import { flightTrailWindow } from "../web/js/vfx/remote.js";
import { icePrism, iceCracks, iceTrailHalfWidth } from "../web/js/vfx/kinds/ice.js";
import { iceDebris } from "../web/js/vfx/kinds/icehit.js";
import { thunderDischarge } from "../web/js/vfx/kinds/thunderhit.js";
import { sandGrains } from "../web/js/vfx/kinds/sand.js";
import { flameCells } from "../web/js/vfx/ribbonmesh.js";
import { fbmNoise } from "../web/js/trails/glow/util.js";
import { arrowSections, headProfile } from "../web/js/vfx/arrowhead.js";
import { FLIGHT_FIELDS, flightFieldVisible } from "../web/js/vfx/remote.js";
import { projectileBounds } from "../web/js/vfx/kinds/arrow.js";
import { vfxRegion, vfxRect, vfxSettings } from "../web/js/vfx/layer.js";
import { vfxData } from "../web/js/godot/vfx.js";

const close = (a, b) => assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6, `${a} != ${b}`);
const width = 384, height = 192;
for (const flightPath of ["straight", "arc", "wave", "spiral", "custom"]) {
  for (const flightEase of ["linear", "in", "out", "smooth"]) {
    const s = remoteSettings({ ...REMOTE_DEFAULTS, kind: "fireball", flightPath, flightEase, flightCount: 3 });
    for (let index = 0; index < s.flightCount; index++) {
      close(pathAt(s, width, height, 0, index), [width * s.startX / 100, height * s.startY / 100]);
      close(pathAt(s, width, height, 1, index), [width * s.endX / 100, height * s.endY / 100]);
      const launch = index * s.flightInterval + s.chargeFrames;
      const frame = launch + s.travelFrames * 0.6;
      const state = flightState(s, width, height, frame, index);
      assert.ok(state.launched && state.body && state.hit < 0);
      close(flightTrail(s, width, height, frame, index).at(-1), state.at);
      const points = flightTrail(s, width, height, frame, index);
      for (const kind of ["fireball", "thunder", "ice", "wind", "sand", "arrow"]) {
        const sections = ribbonSections(points, 12, kind);
        assert.ok(sections.length >= 2);
        assert.equal(sections[0].u, 0);
        assert.equal(sections.at(-1).u, 1);
        close(sections.at(-1).a.map((v, i) => (v + sections.at(-1).b[i]) / 2), state.at);
        assert.ok(sections.every((q, i) => [...q.a, ...q.b, q.u].every(Number.isFinite) && (!i || q.u > sections[i - 1].u)));
        const faded = ribbonSections(points, 12, kind, 0.1).at(-1);
        assert.ok(Math.hypot(faded.a[0] - faded.b[0], faded.a[1] - faded.b[1]) < Math.hypot(sections.at(-1).a[0] - sections.at(-1).b[0], sections.at(-1).a[1] - sections.at(-1).b[1]));
      }
      const hit = flightState(s, width, height, launch + s.travelFrames, index);
      assert.equal(hit.body, false);
      assert.equal(hit.hit, 0);
      assert.equal(flightTrail(s, width, height, launch + s.travelFrames + s.trailFrames + 1, index).length, 0);
      assert.equal(flightState(s, width, height, s.frames, index).finished, true);
    }
    assert.equal(flightTrail({ ...s, trailFrames: 0 }, width, height, 10).length, 0);
  }
}
const extreme = remoteSettings({ ...REMOTE_DEFAULTS, kind: "ice", chargeFrames: 999, travelFrames: 999, impactFrames: 999, flightCount: 999, flightInterval: 999 });
assert.equal(extreme.frames, 64);
assert.equal(extreme.flightInterval, 0);
const coincident = { ...REMOTE_DEFAULTS, kind: "wind", startX: 50, startY: 50, endX: 50, endY: 50 };
assert.ok(pathAt(coincident, width, height, 0.5).every(Number.isFinite));
assert.equal(hasFlight({ kind: "hit", flightPath: "arc" }), false);
const sprite = { kind: "arrow", frames: 8, loop: true };
assert.equal(remoteSettings(sprite), sprite);
const legacy = migrate({ board: { cards: { arrow: { type: "vfx", params: { kind: "arrow", frames: 8, shape: "axe", seed: 19 } } }, edges: { e: { from: { card: "arrow" } } } } });
assert.equal(legacy.board.cards.arrow.type, "remote");
assert.equal(legacy.board.cards.arrow.params.flightPath, "sprite");
assert.equal(legacy.board.cards.arrow.params.frames, 8);
assert.equal(legacy.board.cards.arrow.params.shape, "axe");
assert.equal(legacy.board.edges.e.from.card, "arrow");
assert.deepEqual(ribbonSections([[1, 1], [1, 1], [1, 1]], 12, "fireball"), []);
assert.ok(ribbonSections([[0, 0], [0.009, 0], [0.018, 0], [0.018, 0], [1, 0]], 12, "fireball").every(q => [...q.a, ...q.b].every(Number.isFinite)));
const noise = fbmNoise(27), fine = fbmNoise(57);
const shortHit = remoteSettings({ ...REMOTE_DEFAULTS, kind: "fireball", impactFrames: 2, trailFrames: 24, flightCount: 3 });
for (let shot = 0; shot < 3; shot++) {
  const end = shortHit.chargeFrames + shortHit.travelFrames + shortHit.flightInterval * shot;
  assert.ok(flightTrail(shortHit, width, height, end, shot).length > 0);
  assert.equal(flightTrail(shortHit, width, height, end + shortHit.impactFrames, shot).length, 0, "long wake catches up before a short hit phase ends");
}
for (const kind of ["fireball", "thunder", "wind", "sand"]) {
  let moving = false;
  for (let u = 0; u <= 1; u += 0.1) for (let v = 0; v <= 1; v += 0.1) {
    const sample = materialAt(kind, u, v, 12, noise, fine);
    assert.ok(sample.every(x => Number.isFinite(x) && x >= 0 && x <= 1));
    if (u === 0) assert.equal(sample[1], 0, "tail ends dissolve to transparent");
    assert.deepEqual(sample, materialAt(kind, u, v, 12, noise, fine), "seeking is deterministic");
    moving ||= sample.some((x, i) => x !== materialAt(kind, u, v, 13, noise, fine)[i]);
  }
  assert.ok(moving, kind + " material flows between frames");
}
console.log("远程特效路径、连续截面、流动材质、拖尾消散、命中时序、连发上限与旧数据兼容检查通过");

// The rigid body's complete bounding box must sit inside the default envelope,
// including very long projectiles, broad imported images and rotated flight.
assert.deepEqual(projectileBounds({ round: false, L: 80, pivot: [0, 0], parts: [{ k: "img", l: "body", w: 80, h: 10, pts: [[0, -5], [80, -5], [80, 5], [0, 5]] }] }), [0, -5, 80, 10], "image width is not a stroke width");
const contains = (point, polygon) => {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
};
for (const bounds of [[-45, -3, 90, 6], [-12, -20, 24, 40], [-4, -4, 8, 8]]) for (const angle of [0, 0.8, 2.6]) {
  const at = [100, 100], r = 12, run = arrowSections([], at, angle, r, bounds, REMOTE_DEFAULTS);
  const outline = [...run.map(q => q.a), ...run.toReversed().map(q => q.b)];
  for (const x of [bounds[0], bounds[0] + bounds[2]]) for (const y of [bounds[1], bounds[1] + bounds[3]]) {
    const point = [at[0] + Math.cos(angle) * x - Math.sin(angle) * y, at[1] + Math.sin(angle) * x + Math.cos(angle) * y];
    assert.ok(contains(point, outline), "aura covers the entire projectile, not only its centre");
  }
  assert.equal(run[0].u, 0); assert.equal(run.at(-1).u, 1);
  assert.ok(run.every((q, i) => [...q.a, ...q.b].every(Number.isFinite) && (!i || q.u > run[i - 1].u)));
}
assert.ok(headProfile(0.7, 100) > headProfile(0.7, 0), "curvature changes the cap independently");
const envelope = (headWidth) => arrowSections([], [100, 100], 0, 12, [-20, -3, 40, 6], { ...REMOTE_DEFAULTS, headWidth });
const widthOf = run => Math.max(...run.map(q => Math.hypot(q.a[0] - q.b[0], q.a[1] - q.b[1])));
assert.ok(widthOf(envelope(200)) > widthOf(envelope(50)) * 3.9, "head width changes the body envelope");
for (const field of FLIGHT_FIELDS.filter(f => f.key === "headWidth" || f.key === "headCurve")) {
  assert.ok(flightFieldVisible(field, { kind: "arrow", flightPath: "sprite" }));
  assert.ok(flightFieldVisible(field, { kind: "arrow", flightPath: "arc" }));
  assert.equal(flightFieldVisible(field, { kind: "fireball", flightPath: "arc" }), false);
}
console.log("箭身完整包裹、旋转与长宽适配、头部弧度和宽度独立控制检查通过");

const frameIds = Array.from({ length: 36 }, (_, i) => 'C' + i);
for (const kind of ["fireball", "thunder", "ice", "wind", "sand", "arrow"]) {
  const layer = { name: kind, vfx: { ...REMOTE_DEFAULTS, kind, w: 900, h: 600, x: -200, y: -100, follow: "old", perFrame: true, keys: { C0: { w: 10, h: 10, x: 2, y: 2 } } } };
  const s = vfxSettings(layer);
  assert.equal(s.follow, null); assert.equal(s.perFrame, false); assert.equal(s.keys, null);
  for (const [w, h] of [[321, 179], [640, 360], [1, 1]]) for (const fi of [0, 17, 35]) {
    assert.deepEqual(vfxRect(vfxRegion(s, frameIds, fi, { w, h, bbox: () => { throw Error("remote effects must not follow pixel layer bounds"); } })), { x: 0, y: 0, w, h });
    const data = vfxData(layer, frameIds, w, h, 12, {}, kind);
    assert.deepEqual(data.timeline[fi].slice(1), [0, 0, w, h], "export uses the animation canvas, ignoring an old larger effect box");
  }
}
assert.deepEqual(vfxRect(vfxRegion({ kind: "hit", x: 40, y: 30, w: 20, h: 10 }, frameIds, 0, { w: 321, h: 179 })), { x: 30, y: 25, w: 20, h: 10 }, "ordinary effects retain their regions");
console.log("远程特效整幅画布、自适应尺寸、旧区域兼容与导出坐标检查通过");

// A flame feature must advect to older birth times, instead of riding forward
// with the head when the moving UV window is normalised on the next frame.
const samplePhase = (birth, frame, window) => {
  let phase;
  materialAt("fireball", (birth - window.oldest) / (window.newest - window.oldest), 0.5, frame, x => { phase = x; return 0.5; }, () => 0.5, window.oldest, window.newest - window.oldest);
  return phase;
};
const f = { ...REMOTE_DEFAULTS, kind: "fireball" };
const w0 = flightTrailWindow(f, 18), w1 = flightTrailWindow(f, 19);
assert.ok(samplePhase(14, 19, w1) > samplePhase(14, 18, w0), "flame flows backward through stationary emission points");
assert.ok(Math.abs(samplePhase(14, 18, w0) - samplePhase(14, 18, { oldest: 4, newest: 18 })) < 1e-9, "changing trail length cannot stretch the flame noise");
assert.ok(Math.abs(flameFlow(14, 18) - flameFlow(14 - 0.1 / 0.42, 19)) < 1e-9, "a feature travels toward the older tail");
const signedArea = pts => pts.reduce((area, p, i) => { const q = pts[(i + 1) % pts.length]; return area + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;
for (let i = 0; i < 48; i++) {
  const prism = icePrism(12, i * Math.PI / 24);
  assert.ok(prism.faces.length >= 2 && prism.faces.length <= 3, "only visible ice faces are painted");
  const intervals = prism.faces.map(face => [Math.min(face.body[0][1], face.body[3][1]), Math.max(face.body[0][1], face.body[3][1])]).sort((a, b) => a[0] - b[0]);
  for (let j = 1; j < intervals.length; j++) assert.ok(intervals[j][0] >= intervals[j - 1][1] - 1e-7, "ice panes do not stack into an opaque silhouette");
  for (const face of prism.faces) for (const points of [face.body, face.tip, face.blade, face.tail]) assert.ok(signedArea(points) > 1e-7, "consistently wound crystal facets");
}
for (const seed of [1, 23, 97]) {
  const roll = 0.37, a = iceCracks(12, seed, roll), b = iceCracks(12, seed, roll + Math.PI * 2);
  for (let j = 0; j < a.length; j++) for (let k = 0; k < a[j].length; k++) {
    assert.ok(Math.hypot(a[j][k][0] - b[j][k][0], a[j][k][1] - b[j][k][1]) < 1e-9, "internal ice fractures close after one full roll");
  }
  assert.notDeepEqual(a, iceCracks(12, seed, roll + Math.PI / 2), "fractures turn with the crystal, instead of remaining stuck to the screen");
}
console.log("火尾后向流动、纹理不随长度拉伸、冰晶可见切面与无重叠检查通过");

for (const seed of [1, 23, 97]) for (const angle of [0, 0.7]) {
  const initial = iceDebris(32, 0.9, seed, 0, angle);
  let spread = 0;
  for (const t of [0, 0.12, 0.35, 0.7, 1]) {
    const pieces = iceDebris(32, 0.9, seed, t, angle);
    assert.deepEqual(pieces, iceDebris(32, 0.9, seed, t, angle), "ice debris can be sought in any playback order");
    for (const [j, piece] of pieces.entries()) {
      assert.ok(piece.faces.length >= 1 && piece.faces.length < 20, "irregular shards show their front facets and never their back faces");
      assert.ok(piece.alpha >= 0 && piece.alpha <= 1);
      assert.ok(piece.at.every(Number.isFinite));
      for (const face of piece.faces) assert.ok(signedArea(face.points) > 1e-8, "only front-facing chunk surfaces are drawn");
      for (const edge of [[0, 1], [0, 2], [0, 4]]) {
        const length = vertices => Math.hypot(...vertices[edge[0]].map((x, k) => x - vertices[edge[1]][k]));
        assert.ok(Math.abs(length(piece.vertices) - length(initial[j].vertices)) < 1e-9, "ice chunks tumble as rigid volumes and never shrink into sparks");
      }
      if (t === 1) assert.equal(piece.alpha, 0, "all chunks fade before the impact phase ends");
      if (t === 0.35) spread += Math.hypot(...piece.at) - Math.hypot(...initial[j].at);
    }
  }
  assert.ok(spread > 32, "ice chunks disperse from the hit instead of only rotating in place");
}
console.log("冰块碎裂的体积保持、正面切面、确定性飞散与消散时序检查通过");

for (const flightPath of ["straight", "arc", "wave", "spiral", "custom"]) for (const flightEase of ["linear", "in", "out", "smooth"]) {
  const s = remoteSettings({ ...REMOTE_DEFAULTS, kind: "fireball", flightPath, flightEase, pathWave: 40, pathTurns: 4, pathBend: 60, trailFrames: 24 });
  for (const frame of [5, 12, 18, 23, 27]) for (const radius of [12, 80, 320]) {
    const run = ribbonSections(flightTrail(s, 640, 400, frame), radius, "fireball");
    for (const { points, uvs } of flameCells(run)) {
      const centre = [0, 1].map(k => points.reduce((sum, p) => sum + p[k], 0) / 4);
      for (let j = 0; j < 4; j++) assert.ok(signedArea([points[j], points[(j + 1) % 4], centre]) >= -1e-7, "enlarged fire ribbons cannot fold inside a bend");
      assert.ok(uvs.flat().every(x => x >= 0 && x <= 1));
    }
  }
}
console.log("大火球宽拖尾的弯道防翻折、对称网格与纹理坐标检查通过");
// A sand wake must have no bright cut at either side or its oldest endpoint.
for (const seed of [1, 23, 97]) {
  const noise = fbmNoise(seed * 13 + 7), fine = fbmNoise(seed * 29 + 11);
  for (const u of [0, 0.01, 0.3, 0.8, 1]) for (const v of [0, 1]) assert.equal(materialAt("sand", u, v, 17, noise, fine)[1], 0);
  for (const v of [0.2, 0.5, 0.8]) assert.equal(materialAt("sand", 0, v, 17, noise, fine)[1], 0);
  for (const t of [0, 0.08, 0.19, 0.32, 0.9, 1]) {
    const hit = thunderDischarge(40, 1, seed, t);
    assert.deepEqual(hit, thunderDischarge(40, 1, seed, t));
    assert.ok(hit.arcs.every(p => p.points.flat().every(Number.isFinite) && p.alpha >= 0 && p.width > 0));
    assert.ok(hit.sparks.every(p => [...p.at, ...p.back, p.alpha].every(Number.isFinite)));
    if (t === 1) assert.ok([...hit.arcs, ...hit.scars, ...hit.sparks].every(p => p.alpha === 0));
  }
  assert.equal(thunderDischarge(40, 0, seed, 0.2).sparks.length, 0);
  const early = thunderDischarge(40, 1, seed, 0.08), late = thunderDischarge(40, 1, seed, 0.32);
  assert.deepEqual(early.arcs.map(p => p.points), late.arcs.map(p => p.points), "re-strikes retain the discharge channels");
  assert.ok(early.arcs[0].alpha > thunderDischarge(40, 1, seed, 0.07).arcs[0].alpha, "return stroke briefly lights up again");
}
console.log("沙尾边缘渐隐、雷电分阶段放电与轨迹稳定检查通过");
for (const seed of [1, 23, 97]) {
  const first = sandGrains(32, 1, seed, 0), last = sandGrains(32, 1, seed, 1), moving = sandGrains(32, 1, seed, 0.01);
  assert.deepEqual(first, sandGrains(32, 1, seed, 0), "sand body is deterministic when seeking");
  first.forEach((p, i) => {
    close(p.at, last[i].at); close(p.back, last[i].back);
    assert.ok(Math.abs(p.alpha - last[i].alpha) < 1e-9, "sand grain recycling closes the loop");
    assert.ok([...p.at, ...p.back, p.width, p.alpha, p.heat].every(Number.isFinite));
    assert.ok(p.alpha >= 0 && p.alpha <= 1 && p.width > 0);
    if (moving[i].at[0] > p.at[0]) assert.ok(moving[i].alpha < 0.4, "recycled sand fades in at the tip");
  });
  assert.ok(first.some((p,i) => Math.hypot(p.at[0]-moving[i].at[0],p.at[1]-moving[i].at[1]) > 1), "sand body streams independently of path history");
}
console.log("流沙主体的独立流动、粒子重生渐隐与循环衔接检查通过");
for (const seed of [1, 23, 97]) for (const roll of [0, 0.7, 2.4, 5.1]) {
  const r = 30, prism = icePrism(r, roll, seed), half = iceTrailHalfWidth(r, roll, seed);
  const silhouette = Math.max(...prism.faces.flatMap(f => f.tip.map(p => Math.abs(p[1])))) * prism.tip[0] / (prism.tip[0] - prism.frontX);
  assert.ok(half > 0 && half < silhouette, "ice wake remains inside the projected body width");
  for (const multiplier of [0.2, 1, 3]) {
    const sections = ribbonSections([[0,0],[50,0],[100,0]], Math.min(r * multiplier, half / 0.85), "ice");
    assert.ok(sections.every(q => Math.max(Math.abs(q.a[1]), Math.abs(q.b[1])) <= half + 1e-8));
  }
}
console.log("冰晶拖尾不超过本体宽度与加宽上限检查通过");
for (const width of [0.5, 1, 2.5]) {
  const body = 40, run = ribbonSections([[0, 0], [120, 0], [240, 0]], body * width, "fireball", 1, body);
  assert.ok(Math.hypot(run.at(-1).a[0] - run.at(-1).b[0], run.at(-1).a[1] - run.at(-1).b[1]) <= body * 1.7 + 1e-9, "wide flame joins remain inside the body's height");
}
