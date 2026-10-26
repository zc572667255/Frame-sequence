// 预设素材: asset packs that come with the studio (web/presets/<pack>/
// manifest.json) — scenery to drop into a scene: buildings, trees, props,
// distant layers, 16×16 ground tiles, and a ready-made example scene.
//
// A scene only holds cards, so a preset picture becomes a 素材图 card the
// first time it is used (its PNG copied into the project, so the project
// keeps working without the pack) and the same card is used again after that
// (it remembers params.preset). Ground strips are drawn from the tiles, a new
// card each.
import { el, createCanvas, blobToCanvas } from "../core/util.js";
import { putBlobAsset, putCanvasAsset } from "../core/assets.js";
import { openModal } from "../ui/modal.js";

const PACKS = ["fantasy_village"];
let loading = null;

// every pack's manifest, with base (its folder's URL)
export function loadPacks() {
  if (!loading) {
    loading = Promise.all(PACKS.map(async (id) => {
      const base = "/presets/" + id + "/";
      const r = await fetch(base + "manifest.json");
      if (!r.ok) throw new Error("预设 " + id + " 读取失败");
      return { ...(await r.json()), base };
    })).catch((err) => { loading = null; throw err; });
  }
  return loading;
}

const images = new Map();
function loadImage(url) {
  if (!images.has(url)) {
    images.set(url, new Promise((ok, bad) => {
      const im = new Image();
      im.onload = () => ok(im);
      im.onerror = () => { images.delete(url); bad(new Error("图片读取失败：" + url)); };
      im.src = url;
    }));
  }
  return images.get(url);
}

// a card's first result (its picture), once the engine has worked it out
export function whenReady(app, id) {
  return new Promise((ok) => {
    if (app.engine.outputOf(id, "out")) { ok(); return; }
    const off = app.engine.on("result", (rid) => { if (rid === id) { off(); ok(); } });
    setTimeout(() => { off(); ok(); }, 8000);
  });
}

// somewhere on the board near a card (the scene) for a new card
function placeNear(app, nearId, size) {
  const c = app.store.cards[nearId];
  const x = c ? c.x + c.w + 60 : 0, y = c ? c.y : 0;
  return app.freeSpot(x, y, size.w, size.h);
}

// The 素材图 card for a pack's sprite: the one made before, or a new one.
// Resolves to its id, its picture ready.
export async function spriteCard(app, pack, sprite, nearId) {
  const key = pack.id + "/" + sprite.id;
  const had = Object.values(app.store.cards).find((c) => c.type === "image" && c.params && c.params.preset === key);
  if (had) { await whenReady(app, had.id); return had.id; }
  const blob = await (await fetch(pack.base + sprite.file)).blob();
  const canvas = await blobToCanvas(blob);
  const asset = await putBlobAsset(app.store.projectId, blob);
  const size = app.imageCardSize(canvas.width, canvas.height), at = placeNear(app, nearId, size);
  const id = app.addCard("image", at.x, at.y, { asset, name: sprite.name, preset: key }, { size, title: sprite.name, select: false });
  await whenReady(app, id);
  return id;
}

// A ground strip from a material's tiles: tilesX × tilesY, the variants mixed
// (the same way for the same seed), grass's top edge along the top if asked.
export async function groundCanvas(pack, material, tilesX, tilesY, grassTop, seed = 1) {
  const t = pack.tiles, m = t.materials.find((x) => x.id === material) || t.materials[0], s = t.size;
  const tiles = await Promise.all(m.files.map((f) => loadImage(pack.base + f)));
  const c = createCanvas(tilesX * s, tilesY * s), g = c.getContext("2d");
  g.imageSmoothingEnabled = false;
  let r = seed * 2654435761 >>> 0;
  const rnd = () => { r ^= r << 13; r ^= r >>> 17; r ^= r << 5; return (r >>> 0) / 4294967296; };
  for (let y = 0; y < tilesY; y++) for (let x = 0; x < tilesX; x++) {
    // mostly the first variant, the others here and there (less repetition)
    const v = rnd() < 0.55 ? 0 : 1 + Math.floor(rnd() * (tiles.length - 1));
    g.drawImage(tiles[v], x * s, y * s);
  }
  if (grassTop && t.grassTop) {
    const top = await loadImage(pack.base + t.grassTop);
    for (let x = 0; x < tilesX; x++) g.drawImage(top, x * s, 0);
  }
  return c;
}

// a new 素材图 card holding a ground strip; resolves to its id
export async function groundCard(app, pack, material, tilesX, tilesY, grassTop, nearId) {
  const m = pack.tiles.materials.find((x) => x.id === material) || pack.tiles.materials[0];
  const canvas = await groundCanvas(pack, m.id, tilesX, tilesY, grassTop, Math.floor(Math.random() * 1e6) + 1);
  const asset = await putCanvasAsset(app.store.projectId, canvas);
  const name = "地面 · " + m.name + (grassTop ? "（草边）" : "");
  const size = app.imageCardSize(canvas.width, canvas.height), at = placeNear(app, nearId, size);
  const id = app.addCard("image", at.x, at.y, { asset, name, preset: pack.id + "/ground:" + m.id }, { size, title: name, select: false });
  await whenReady(app, id);
  return id;
}

// the scale that shows a sprite as wide as the pack's example scene does
// (so the pack's pieces keep their sizes to each other), or null
export function exampleScale(pack, spriteId, srcW) {
  const it = pack.scene && pack.scene.items.find((x) => x.sprite === spriteId);
  // not in the example: the width the pack suggests for it, on the same scale
  const sp = pack.sprites && pack.sprites.find((x) => x.id === spriteId);
  const w = (it && it.w) || (sp && sp.w);
  return w && srcW ? w / srcW : null;
}

// Ask whether the example scene replaces what is in the scene or goes on top.
// Resolves to "replace" | "append" | null (cancelled).
export function askExample(hasItems, packName) {
  if (!hasItems) return Promise.resolve("replace");
  return new Promise((ok) => {
    const m = openModal("套用示例场景「" + packName + "」", {
      buttons: [
        { label: "取消", action: () => ok(null) },
        { label: "追加到现有元素上", action: () => ok("append") },
        { label: "替换现有元素", primary: true, action: () => ok("replace") },
      ],
    });
    m.body.append(el("p", null, "场景里已经有元素了。替换会去掉现有元素（原卡片不受影响），并把舞台改成示例的尺寸和背景色；追加只把示例的元素加在最上面。"));
  });
}
