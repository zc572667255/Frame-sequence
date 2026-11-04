// Add image files to an existing animation without resizing its authored frames.
import { createCanvas, uid } from "../core/util.js";
import { putCanvasAsset } from "../core/assets.js";
import { decodeFiles, isImageFile, naturalSort } from "../ui/importer.js";
import { normalizeAnim } from "./doc.js";

export const importLayer = (l) => !l.trail && !l.ghost && !l.vfx && !l.stroke
  && !l.locked && l.visible !== false && (l.opacity ?? 100) === 100;

// Keep original pixel size when it fits. Larger images shrink proportionally;
// transparent padding aligns each frame to the bottom centre (the feet).
export async function readFrameImages(files, w, h) {
  const images = naturalSort([...files].filter(isImageFile));
  if (!images.length) return [];
  const frames = await decodeFiles(images);
  return frames.map((f) => {
    const canvas = createCanvas(w, h), g = canvas.getContext("2d");
    const scale = Math.min(1, w / f.canvas.width, h / f.canvas.height);
    const fw = Math.max(1, Math.round(f.canvas.width * scale));
    const fh = Math.max(1, Math.round(f.canvas.height * scale));
    g.imageSmoothingEnabled = false;
    g.drawImage(f.canvas, Math.floor((w - fw) / 2), h - fh, fw, fh);
    return { ...f, canvas };
  });
}

export async function appendFrameImages(app, cardId, files) {
  const store = app.store, projectId = store.projectId;
  const card = store.cards[cardId];
  if (!card || card.type !== "animation") return 0;
  const original = normalizeAnim(card.params);
  const images = await readFrameImages(files, original.w, original.h);
  if (!images.length) return 0;
  const assets = [];
  for (const image of images) assets.push(await putCanvasAsset(projectId, image.canvas));
  const current = store.cards[cardId];
  if (store.projectId !== projectId || !current || current.type !== "animation") return 0;
  const n = normalizeAnim(current.params);
  if (n.w !== original.w || n.h !== original.h) throw new Error("动画画布尺寸已改变，请重新添加图片。");
  const layer = [...n.layers].reverse().find(importLayer)
    || { id: uid("L"), name: "导入图片", visible: true, opacity: 100 };
  if (!n.layers.includes(layer)) n.layers.push(layer);
  n.frames.push(...images.map((image, i) => ({ id: uid("F"), duration: image.duration || null, cels: { [layer.id]: assets[i] } })));
  store.mutate((d) => { Object.assign(d.board.cards[cardId].params, n); });
  return images.length;
}
