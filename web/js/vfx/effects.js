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
import { arrow } from "./kinds/arrow.js";
import { fireball } from "./kinds/fireball.js";
import { isRemoteKind } from "./catalog.js";
import { REMOTE_DEFAULTS, remoteSettings, hasFlight } from "./remote.js";
import { remote } from "./kinds/remote.js";
import { coreImage, loadCoreImage } from "./coreimg.js";
import { spriteOf, spriteUrl } from "./projectiles.js";

// kinds: name, what it is for, and the settings it starts with
export const VFX_KINDS = [
  { id: "thunder", name: "雷电", help: "蓝白电核与分叉电弧；命中时短促闪光、多次放电、飞散电火花和逐渐冷却的放射电纹", defaults: { palette: "animebolt", loop: true, size: 90, glow: 40, acc: "none" }, round: true },
  { id: "ice", name: "冰矛", help: "单尖冰锥，带碎裂断口、纵向冰纹与透光切面，使用拖尾特效的「冰晶」拖尾；命中时冰块翻滚碎裂，留下冰裂纹", defaults: { palette: "frost", loop: true, size: 90, glow: 30, acc: "none", flightPath: "straight" }, round: true },
  { id: "wind", name: "风刃", help: "白色翻滚气团、两端渐隐的细长流线与逐渐扩散的空气尾迹，命中时扩散", defaults: { palette: "air", loop: true, size: 90, glow: 20, acc: "none" }, round: true },
  { id: "sand", name: "沙流", help: "流动的沙粒与金色细丝，沿路径飞行，命中时扬起散沙", defaults: { palette: "sand", loop: true, size: 90, glow: 20, acc: "none", flightPath: "wave" }, round: true },
  { id: "hit", name: "命中火花", help: "打中的一瞬间：白热闪光、尖刺和飞溅的火花", defaults: { palette: "radiant", frames: 7, loop: false, size: 80 } },
  { id: "fireball", name: "火球", help: "翻滚燃烧的火球：明亮火核、不规则火舌、向后撕开的火尾、烟和冷却的余烬。循环时原地燃烧供游戏移动；不循环时飞过画幅后消散。用旋转改变飞行方向", defaults: { palette: "blaze", frames: 24, loop: true, size: 90, glow: 35, acc: "none" }, round: true },
  { id: "explosion", name: "爆炸", help: "火球膨胀、冷却成烟往上飘，带飞散的火星", defaults: { palette: "inferno", frames: 12, loop: false, size: 80 } },
  { id: "shock", name: "冲击波", help: "向外扩散的环，可以压扁成地面上的冲击波；侧面是竖起来侧对着的环", defaults: { palette: "frost", frames: 8, loop: false, size: 80 }, side: true },
  { id: "dust", name: "烟尘", help: "落地、急停、冲刺扬起的烟尘，向两侧散开", defaults: { palette: "quake", frames: 10, loop: false, size: 80 } },
  { id: "charge", name: "蓄力", help: "能量向中心汇聚成发光的球；不循环时最后爆开", defaults: { palette: "spark", frames: 12, loop: true, size: 80 } },
  { id: "circle", name: "魔法阵", help: "旋转的法阵：圆环、符文、星形，向上飘的光点；侧面是竖起来侧对着的法阵，像一道传送门", defaults: { palette: "crescent", frames: 16, loop: true, size: 80 }, side: true },
  { id: "heal", name: "治疗光圈", help: "脚下的光圈和升起的光柱、十字光点", defaults: { palette: "venom", frames: 12, loop: true, size: 80 } },
  { id: "aura", name: "环绕光", help: "超级赛亚人那样包住角色的斗气：向上舔动的光焰、中间透明、上升的光束和火花，可加闪电", defaults: { palette: "radiant", frames: 8, loop: true, size: 95, pad: 20 }, around: true, fit: auraBody },
  { id: "burn", name: "燃烧", help: "从区域底部烧起来的火焰，火舌摇动，火星上飘；「根部宽度」调小就像火把上的火焰", defaults: { palette: "blaze", frames: 8, loop: true, size: 95 } },
  { id: "cloud", name: "云朵", help: "不规则的积云：轮廓坑坑洼洼、高低不一、底边不平，有时旁边飘着扯下来的碎云；像照片里的积云：大鼓包上叠着小鼓包，朝阳（左上）的一面白，背面、里面和云底是柔和的浅灰蓝阴影，边缘半透明地化开；大云都是实心的，偶尔有小块的薄云。每朵云的形状、大小、浓淡都随机（「换一个随机样子」换一批）；粒子越多、画幅越宽，云越多，宽画幅就是一整片天际线。云团会翻滚起伏，默认横向飘动（循环时每朵正好飘过一圈：帧数越多飘得越慢）", defaults: { palette: "frost", frames: 48, loop: true, size: 90, acc: "none", w: 384, h: 160, drift: true } },
  { id: "ribbon", name: "流光", help: "柔和流动的光带：几束细丝交织起伏、扭转，带闪烁的光尘", defaults: { palette: "dream", frames: 16, loop: true, size: 95 } },
  { id: "wings", name: "翅膀", help: "光做的翅膀，重神不重形：一扇从肩部放出的发光笔触、淡淡的光幕，光沿笔触流向翼尖，翼尖飘落光点；循环时扇动一次，不循环时展开后散成光点。正面是一对，侧面是向后展开的近翼和后面的远翼", defaults: { palette: "radiant", frames: 16, loop: true, size: 95 }, side: true },
  { id: "arrow", name: "箭矢", help: "远程攻击的飞行道具，外面包着拖尾的光效，光往后拖成彗星的样子；「外观」有现成的图（箭、刀、枪、斧、锤棍、飞镖、球与炸弹）、随配色变色的简笔画、透明核心（没有实体，像放出去的法术）和自定义核心（自己的图片）；斧、锤棍、飞镖、炸弹默认边飞边转（「自转」可改）。光效和同名拖尾一样（烈焰斩是火焰、冰晶是冰晶、雷光是闪电、疾风是风刃……）。朝右飞，用「旋转」改方向：都在画幅的内切圆里，转到任何角度都不会出框；循环时停在原地、光在流动（游戏里移动它），不循环时从左飞过画幅、拖尾随后散去", defaults: { palette: "blaze", frames: 8, loop: true, size: 95, shape: "s:arrow1" }, round: true },
];

for (const kind of VFX_KINDS) if (isRemoteKind(kind.id)) {
  kind.defaults = remoteSettings({ ...REMOTE_DEFAULTS, ...kind.defaults, kind: kind.id });
  if (kind.id === "fireball") kind.help = "翻滚的火焰主体、破碎火尾、烟和余烬；可沿路径移动，终点爆炸。原地模式可保留循环精灵，由游戏控制移动。";
  if (kind.id === "arrow") kind.help = "箭、刀、枪、飞斧、飞镖、球与炸弹，支持透明核心、自定义图片和自转；沿路径飞行，拖尾跟随轨迹，终点播放命中效果。原地模式保留原有循环精灵。";
}

// is this kind kept inside the circle that fits its box (so 旋转 never takes it
// past the box's edge)?
const isRound = (kind) => !!(VFX_KINDS.find((k) => k.id === kind) || {}).round;

// does this kind have a side view (视角 侧面)? The others look the same from
// any side, so they offer no choice
export const hasSide = (kind) => !!(VFX_KINDS.find((k) => k.id === kind) || {}).side;

export const VFX_DEFAULTS = {
  ...REMOTE_DEFAULTS, flightPath: "sprite",
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
  shape: "arrow", // 箭矢: 外观 — what flies (kinds/arrow.js PROJECTILES)
  spin: "auto",  // 箭矢: 自转 — "auto" (what tumbles when thrown) | "on" | "off"
  coreImg: "", coreKey: "", coreName: "", // 箭矢 自定义核心: the picture (PNG data URL, vfx/coreimg.js), its key, its file name
  coreSize: 60,  // 自定义核心: its longer side, % of the effect's radius
  coreTurn: 0,   // 自定义核心: degrees it is turned so it faces forward (right)
  coreScale: 100, // a ready-made look (projectiles.js): % of its own size
  coreShift: 0,  // 箭矢 物体前后: how far what flies sits ahead of (+) or back in (−) its glow's head, % of the radius
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

export const effectKinds = (remote = false) => {
  const kinds = VFX_KINDS.filter((k) => isRemoteKind(k.id) === remote);
  return remote ? kinds.sort((a, b) => ["fireball", "thunder", "ice", "wind", "sand", "arrow"].indexOf(a.id) - ["fireball", "thunder", "ice", "wind", "sand", "arrow"].indexOf(b.id)) : kinds;
};

const EFFECTS = { hit, explosion, shock, dust, charge, circle, heal, aura, ribbon, wings, burn, cloud, arrow, fireball };

// how much bloom each kind gets on top of what it draws itself
const BLOOM = { hit: 1, shock: 0.8, charge: 1, heal: 0.7, circle: 0, explosion: 0.7, dust: 0, aura: 0.9, burn: 0.9, ribbon: 1, wings: 1, cloud: 0, arrow: 0.4, fireball: 0.45, ice: 0.28 };

// one frame: a w×h canvas
export function renderVfx(p, i) {
  const s = remoteSettings({ ...VFX_DEFAULTS, ...p });
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
    root: Math.max(0.1, Math.min(1, (s.root ?? 100) / 100)), drift: !!s.drift, shape: s.shape || "arrow", spin: s.spin || "auto", core: coreOf(s), coreShift: Math.max(-1, Math.min(1, (+s.coreShift || 0) / 100)),
    pixel: s.style === "pixel", px: Math.max(1, Math.min(8, s.pxSize | 0 || 1)), bolts: !!s.bolts, view: hasSide(s.kind) ? s.view : "front",
    headWidth: Math.max(20, Math.min(250, s.headWidth ?? 100)), headCurve: Math.max(0, Math.min(100, s.headCurve ?? 35)),
    top: null,     // a canvas a kind wants over the finished frame in 像素 (箭矢's arrow)
  };
  // what stands on the ground sits low, its ring just inside the bottom edge
  if (s.kind === "circle" || s.kind === "heal") c.gy = Math.max(h / 2, h - R * squash - 4);
  const draw = EFFECTS[s.kind] || EFFECTS.hit;
  let base = createCanvas(w, h);
  const bg = base.getContext("2d");
  if (hasFlight(s) || ["thunder", "ice", "wind", "sand"].includes(s.kind)) remote(bg, c, s);
  else draw(bg, c);
  // the trails' accents over it (光效点缀)
  if (!hasFlight(s)) drawAccents(bg, c, accentAmounts(s, pal.preset));
  bg.globalCompositeOperation = "source-over";
  bg.globalAlpha = 1;
  if (isRound(s.kind) && !hasFlight(s)) { roundOff(base); if (c.top) roundOff(c.top); }
  // 旋转, for every kind: the whole picture turns about its centre — before
  // the bloom and the pixels, so both follow it. (视角 is drawn by the kinds
  // that have a side view; squashing the finished picture would only stretch
  // round sparks and flames out of shape.)
  const rot = ((+s.rotate || 0) % 360) * Math.PI / 180;
  if (rot) base = turn(base, rot);
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
  const px = pixelateGlow(out, st, { size: s.pxSize, alpha: s.pxAlpha });
  // what a kind keeps in its own colours over the glow (c.top: 箭矢's arrow),
  // turned, faded and cut into the same blocks
  if (c.top) px.getContext("2d").drawImage(blocks(fadeEdges(rot ? turn(c.top, rot) : c.top), c.px), 0, 0);
  return px;
}

// a canvas turned about its centre
function turn(cv, rot) {
  const w = cv.width, h = cv.height;
  const turned = createCanvas(w, h), tg = turned.getContext("2d");
  tg.imageSmoothingEnabled = true;
  tg.imageSmoothingQuality = "high";
  tg.translate(w / 2, h / 2); tg.rotate(rot);
  tg.drawImage(cv, -w / 2, -h / 2);
  // back to no turn: what draws on it next (the edge fade) draws straight
  tg.setTransform(1, 0, 0, 1, 0, 0);
  return turned;
}

// a canvas cut into solid k×k blocks on the frame's grid, hard-edged
function blocks(cv, k) {
  const w = cv.width, h = cv.height, bw = Math.ceil(w / k), bh = Math.ceil(h / k);
  const small = createCanvas(bw, bh), sg = small.getContext("2d", { willReadFrequently: true });
  sg.imageSmoothingEnabled = true;
  sg.imageSmoothingQuality = "high";
  sg.drawImage(cv, 0, 0, bw * k, bh * k, 0, 0, bw, bh);
  const img = sg.getImageData(0, 0, bw, bh), d = img.data;
  for (let i = 3; i < d.length; i += 4) d[i] = d[i] >= 110 ? 255 : 0;
  sg.putImageData(img, 0, 0);
  const out = createCanvas(w, h), og = out.getContext("2d");
  og.imageSmoothingEnabled = false;
  og.drawImage(small, 0, 0, bw, bh, 0, 0, bw * k, bh * k);
  return out;
}

// 自定义核心's picture for kinds/arrow.js, or null; one not decoded yet starts
// decoding (a frame drawn meanwhile has no core: vfx/layer.js keys it apart)
export function coreOf(s) {
  const src = coreSource(s);
  if (!src) return null;
  const img = coreImage(src.key);
  if (!img) loadCoreImage(src.key, src.url);
  const sp = spriteOf(s.shape);
  return sp
    ? { img, size: Math.max(0.05, sp.size / 100 * (+s.coreScale || 100) / 100), turn: 0 }
    : { img, size: Math.max(0.05, (+s.coreSize || 60) / 100), turn: (+s.coreTurn || 0) * Math.PI / 180 };
}

// the picture 箭矢 flies as: { key, url } — a ready-made look's or the user's
// own (自定义核心) — or null
export function coreSource(s) {
  if (!s || s.kind !== "arrow") return null;
  const sp = spriteOf(s.shape);
  if (sp) return { key: "s:" + sp.id, url: spriteUrl(sp.id) };
  return s.shape === "custom" && s.coreKey && s.coreImg ? { key: s.coreKey, url: s.coreImg } : null;
}

// Code exports need the decoded image on the main thread as well as in workers.
export async function prepareVfxCore(s) {
  const source = coreSource(s);
  if (source && !await loadCoreImage(source.key, source.url)) throw new Error("无法读取投掷物核心图片，请重新导入或选择其他外观。");
}

// fade a canvas out towards the circle that fits it, gone at its edge: then no
// turn takes anything past the box
function roundOff(cv) {
  const w = cv.width, h = cv.height, r = Math.min(w, h) / 2;
  const g = cv.getContext("2d");
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = "destination-in";
  const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, r);
  gr.addColorStop(0, "rgba(0,0,0,1)"); gr.addColorStop(0.86, "rgba(0,0,0,1)"); gr.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, w, h);
  g.restore();
  return cv;
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
  p = remoteSettings({ ...VFX_DEFAULTS, ...p });
  const n = Math.max(1, Math.min(64, (p.frames ?? VFX_DEFAULTS.frames) | 0));
  return Array.from({ length: n }, (_, i) => renderVfx(p, i));
}
