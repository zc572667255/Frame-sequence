// Stand-alone effects (特效): hit sparks, explosions, shockwaves, dust, a
// charging orb, a magic circle, a healing aura, an aura round a character,
// fire — generated as a sequence of
// frames from a handful of settings, in the colours of the glow presets
// (trails/glow.js), smooth (高清) or pixelated (像素, trails/glow/finish.js).
//
// Every effect is a function of time t (0 → 1 over the sequence) with its
// particles fixed per seed, so neighbouring frames belong together and a loop
// closes on itself. Fire, smoke and dust are a noisy density field coloured per
// pixel (volume); the rest are drawn with canvas strokes and gradients, then
// given a bloom.
//
// Each kind draws itself (vfx/kinds/<id>.js) with the shared helpers of
// vfx/common.js; this file lists them and turns one into a finished frame.
import { createCanvas } from "../core/util.js";
import { GLOW_PRESETS } from "../trails/glow.js";
import { clamp01, drawBlurred, toHex } from "../trails/glow/util.js";
import { pixelateGlow } from "../trails/glow/finish.js";
import { paletteOf, ring, sparks, bolt } from "./common.js";
import { ACCENTS, accentAmounts, drawAccents } from "./accents.js";
import { hit } from "./kinds/hit.js";
import { explosion } from "./kinds/explosion.js";
import { shock } from "./kinds/shock.js";
import { dust } from "./kinds/dust.js";
import { charge } from "./kinds/charge.js";
import { circle } from "./kinds/circle.js";
import { heal } from "./kinds/heal.js";
import { aura, auraBody } from "./kinds/aura.js";
import { ribbon } from "./kinds/ribbon.js";
import { wings } from "./kinds/wings.js";
import { burn } from "./kinds/burn.js";
import { cloud, cloudColors } from "./kinds/cloud.js";

// kinds: name, what it is for, and the settings it starts with
export const VFX_KINDS = [
  { id: "hit", name: "命中火花", help: "打中的一瞬间：白热闪光、尖刺和飞溅的火花", defaults: { palette: "radiant", frames: 7, loop: false, size: 80 } },
  { id: "explosion", name: "爆炸", help: "火球膨胀、冷却成烟往上飘，带飞散的火星", defaults: { palette: "inferno", frames: 12, loop: false, size: 80 } },
  { id: "shock", name: "冲击波", help: "向外扩散的环，可以压扁成地面上的冲击波；侧面是竖起来侧对着的环", defaults: { palette: "frost", frames: 8, loop: false, size: 80 }, side: true },
  { id: "dust", name: "烟尘", help: "落地、急停、冲刺扬起的烟尘，向两侧散开", defaults: { palette: "quake", frames: 10, loop: false, size: 80 } },
  { id: "charge", name: "蓄力", help: "能量向中心汇聚成发光的球；不循环时最后爆开", defaults: { palette: "spark", frames: 12, loop: true, size: 80 } },
  { id: "circle", name: "魔法阵", help: "旋转的法阵：圆环、符文、星形，向上飘的光点；侧面是竖起来侧对着的法阵，像一道传送门", defaults: { palette: "crescent", frames: 16, loop: true, size: 80 }, side: true },
  { id: "heal", name: "治疗光圈", help: "脚下的光圈和升起的光柱、十字光点", defaults: { palette: "venom", frames: 12, loop: true, size: 80 } },
  { id: "aura", name: "环绕光", help: "超级赛亚人那样包住角色的斗气：向上舔动的光焰、中间透明、上升的光束和火花，可加闪电", defaults: { palette: "radiant", frames: 8, loop: true, size: 95, pad: 20 }, around: true, fit: auraBody },
  { id: "burn", name: "燃烧", help: "从区域底部烧起来的火焰，火舌摇动，火星上飘；「根部宽度」调小就像火把上的火焰", defaults: { palette: "blaze", frames: 8, loop: true, size: 95 } },
  { id: "cloud", name: "云朵", help: "不规则的积云：轮廓坑坑洼洼、高低不一、底边不平，有时旁边飘着扯下来的碎云；一团团菜花状的云堆，左上受光发白，褶皱和平平的云底是蓝灰色的阴影，边缘半透明地化开、带一圈淡淡的雾气。每朵云的形状、大小、浓淡都随机（「换一个随机样子」换一批）；粒子越多、画幅越宽，云越多，宽画幅就是一整片天际线。云团会翻滚起伏，默认横向飘动（循环时每朵正好飘过一圈：帧数越多飘得越慢）", defaults: { palette: "frost", frames: 48, loop: true, size: 90, acc: "none", w: 384, h: 160, drift: true } },
  { id: "ribbon", name: "流光", help: "柔和流动的光带：几束细丝交织起伏、扭转，带闪烁的光尘", defaults: { palette: "dream", frames: 16, loop: true, size: 95 } },
  { id: "wings", name: "翅膀", help: "光做的翅膀，重神不重形：一扇从肩部放出的发光笔触、淡淡的光幕，光沿笔触流向翼尖，翼尖飘落光点；循环时扇动一次，不循环时展开后散成光点。正面是一对，侧面是向后展开的近翼和后面的远翼", defaults: { palette: "radiant", frames: 16, loop: true, size: 95 }, side: true },
];

// does this kind have a side view (视角 侧面)? The others look the same from
// any side, so they offer no choice
export const hasSide = (kind) => !!(VFX_KINDS.find((k) => k.id === kind) || {}).side;

export const VFX_DEFAULTS = {
  kind: "hit", palette: "radiant", w: 128, h: 128, frames: 7, fps: 12, loop: false,
  size: 80,      // % of the canvas the effect reaches
  amount: 100,   // particles, %
  glow: 60,      // bloom, %
  tilt: 60,      // 冲击波 / 魔法阵 / 治疗 / 烟尘: how flat the ground is seen, degrees (0 = from above)
  pattern: "hex", // 魔法阵: "hex" 六芒星 | "penta" 五芒星 | "square" 双方形 | "taiji" 太极八卦 | 光环（kinds/auras.js GROUND_AURAS）
  edge: "auto",  // 魔法阵: what plays round the rim — "auto" (the palette's element) | "none" | "fire" 火焰 | "earth" 岩石 | "wind" 风刃 | "water" 水波 | "bolt" 闪电
  bolts: false,  // 环绕光: lightning crawling over it
  root: 100,     // 燃烧: 根部宽度, % of the fire's width (small: a torch's flame)
  drift: false,  // 云朵: 横向飘动 (once across the box a loop)
  view: "front", // "front" 正面 | "side" 侧面, for the kinds that have one (hasSide)
  rotate: 0,     // degrees, the whole effect turned about its centre
  acc: "auto",  // 光效点缀 (vfx/accents.js): "auto" the trail preset's mix | "none" | "custom" (acc_<id>, 0..100)
  ...Object.fromEntries(ACCENTS.map((a) => ["acc_" + a.id, 0])),
  seed: 1,
  style: "hd",   // "hd" | "pixel"
  pxSize: 2, pxAlpha: "steps",
};

export const VFX_PALETTES = GLOW_PRESETS.map((p) => [p.id, p.name]);

// 魔法阵: what can play round its rim (circleEdge); "auto" takes the palette's element
export const VFX_EDGES = [["auto", "自动（按配色）"], ["none", "无"], ["fire", "火焰"], ["earth", "岩石"], ["wind", "风刃"], ["water", "水波"], ["bolt", "闪电"]];

const EFFECTS = { hit, explosion, shock, dust, charge, circle, heal, aura, ribbon, wings, burn, cloud };

// how much bloom each kind gets on top of what it draws itself
const BLOOM = { hit: 1, shock: 0.8, charge: 1, heal: 0.7, circle: 0, explosion: 0.7, dust: 0, aura: 0.9, burn: 0.9, ribbon: 1, wings: 1, cloud: 0 };

// one frame: a w×h canvas
export function renderVfx(p, i) {
  const s = { ...VFX_DEFAULTS, ...p };
  const w = Math.max(8, Math.min(2048, s.w | 0)), h = Math.max(8, Math.min(1024, s.h | 0));
  const n = Math.max(1, Math.min(64, s.frames | 0));
  // a loop runs 0 → (n − 1) / n so the last frame leads into the first; a
  // one-shot samples the middle of each frame's slot, so it starts just after
  // the hit and ends just before it is gone
  const t = s.loop ? i / n : (i + 0.5) / n;
  const pal = paletteOf(s.palette);
  const R = Math.min(w, h) / 2 * clamp01(s.size / 100);
  const ground = s.kind === "dust" || s.kind === "heal" || s.kind === "circle" || (s.kind === "shock" && s.tilt > 2);
  const squash = Math.max(0.15, Math.cos(Math.max(0, Math.min(80, s.tilt)) * Math.PI / 180));
  const c = {
    w, h, t, i, n, seed: s.seed | 0 || 1, pal, R, cx: w / 2, cy: h / 2, kind: s.kind,
    // what wraps or fills the area (环绕光, 燃烧) uses its width and height
    rx: w / 2 * clamp01(s.size / 100), ry: h / 2 * clamp01(s.size / 100),
    // the ground line: low enough for what rises off it to fit
    gy: s.kind === "dust" ? h * 0.85 : ground ? h / 2 + R * squash * 0.5 : h / 2,
    squash: s.kind === "shock" && s.tilt <= 2 ? 1 : squash,
    amount: Math.max(0, s.amount / 100), glow: Math.max(0, s.glow / 100), loop: !!s.loop, pattern: s.pattern, edge: s.edge || "auto",
    root: Math.max(0.1, Math.min(1, (s.root ?? 100) / 100)), drift: !!s.drift,
    pixel: s.style === "pixel", px: Math.max(1, Math.min(8, s.pxSize | 0 || 1)), bolts: !!s.bolts, view: hasSide(s.kind) ? s.view : "front",
  };
  // what stands on the ground sits low, its ring just inside the bottom edge
  if (s.kind === "circle" || s.kind === "heal") c.gy = Math.max(h / 2, h - R * squash - 4);
  const draw = EFFECTS[s.kind] || EFFECTS.hit;
  let base = createCanvas(w, h);
  const bg = base.getContext("2d");
  draw(bg, c);
  // the trails' accents over it (光效点缀)
  drawAccents(bg, c, accentAmounts(s, pal.preset));
  bg.globalCompositeOperation = "source-over";
  bg.globalAlpha = 1;
  // 旋转, for every kind: the whole picture turns about its centre — before
  // the bloom and the pixels, so both follow it. (视角 is drawn by the kinds
  // that have a side view; squashing the finished picture would only stretch
  // round sparks and flames out of shape.)
  const rot = ((+s.rotate || 0) % 360) * Math.PI / 180;
  if (rot) {
    const turned = createCanvas(w, h), tg = turned.getContext("2d");
    tg.imageSmoothingEnabled = true;
    tg.imageSmoothingQuality = "high";
    tg.translate(w / 2, h / 2); tg.rotate(rot);
    tg.drawImage(base, -w / 2, -h / 2);
    // back to no turn: what draws on it next (the edge fade) draws straight
    tg.setTransform(1, 0, 0, 1, 0, 0);
    base = turned;
  }
  // pixels keep a tighter glow: a wide faint halo snaps to solid blocks
  const bloom = (BLOOM[s.kind] ?? 1) * c.glow * (c.pixel ? 0.5 : 1);
  let out = base;
  if (bloom > 0 && !pal.dark) {
    out = createCanvas(w, h);
    const og = out.getContext("2d");
    og.globalCompositeOperation = "lighter";
    og.globalAlpha = Math.min(1, 0.7 * bloom);
    drawBlurred(og, [base], Math.max(2, R * 0.1));
    og.globalAlpha = 1;
    og.globalCompositeOperation = "source-over";
    og.drawImage(base, 0, 0);
  }
  // what still reaches the edge of the box (a spark thrown far, the corner of a
  // turned effect) fades out there instead of being cut off in a straight line
  out = fadeEdges(out);
  if (s.style !== "pixel") return out;
  // pixel art: blocks on the preset's palette (smoke and dust shades added)
  // (clouds snap to their own whites and shades, not to the glow's colours)
  const cc = s.kind === "cloud" ? cloudColors(pal) : null;
  const st = cc
    ? { glowColors: [cc.deep, cc.shade, cc.body, cc.light].map(toHex), glowCore: toHex(cc.light), glowRim: toHex(cc.body), glowSplat: toHex(cc.light), tailTint: 1, glowTail: toHex(cc.shade) }
    : { glowColors: pal.preset.colors, glowCore: pal.preset.core, glowRim: pal.preset.rim, glowSplat: pal.preset.splat, tailTint: 1, glowTail: toHex(pal.smoke) };
  return pixelateGlow(out, st, { size: s.pxSize, alpha: s.pxAlpha });
}

// fade a canvas out over its outermost few pixels (4 % of its shorter side)
function fadeEdges(cv) {
  const w = cv.width, h = cv.height, m = Math.max(2, Math.round(Math.min(w, h) * 0.04));
  const g = cv.getContext("2d");
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = "destination-in";
  for (const [x1, y1, len] of [[w, 0, w], [0, h, h]]) {
    const gr = g.createLinearGradient(0, 0, x1, y1), e = Math.min(0.5, m / len);
    gr.addColorStop(0, "rgba(0,0,0,0)"); gr.addColorStop(e, "rgba(0,0,0,1)");
    gr.addColorStop(1 - e, "rgba(0,0,0,1)"); gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  }
  g.restore();
  return cv;
}

export function renderVfxFrames(p) {
  const n = Math.max(1, Math.min(64, (p.frames ?? VFX_DEFAULTS.frames) | 0));
  return Array.from({ length: n }, (_, i) => renderVfx(p, i));
}
