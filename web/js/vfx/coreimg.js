// 自定义核心 (箭矢): the pictures people bring in, kept in an effect's settings
// as a PNG data URL (coreImg) with a short key (coreKey). Each is decoded once
// per key — here and in the render workers — and kept; the key, not the
// picture, goes in the rendered frames' cache keys (vfx/layer.js).
import { hashSeed } from "../trails/glow/util.js";

const imgs = new Map(), loading = new Map(), readyFns = new Set();

// the decoded picture, or null while it isn't (yet)
export const coreImage = (key) => imgs.get(key) || null;

export function loadCoreImage(key, url) {
  if (!key || !url) return Promise.resolve(null);
  if (imgs.has(key)) return Promise.resolve(imgs.get(key));
  if (!loading.has(key)) {
    loading.set(key, fetch(url).then((r) => r.blob()).then((b) => createImageBitmap(b)).then((bmp) => {
      imgs.set(key, bmp);
      loading.delete(key);
      for (const fn of readyFns) fn(key);
      return bmp;
    }).catch(() => { loading.delete(key); return null; }));
  }
  return loading.get(key);
}

// call fn whenever a picture has been decoded
export function onCoreReady(fn) { readyFns.add(fn); return () => readyFns.delete(fn); }

// pick a picture from disk: { coreImg, coreKey, coreName }, a PNG at most 512 px
// on its longer side, or null when nothing was picked
export function pickCoreImage() {
  return new Promise((resolve) => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "image/*";
    inp.onchange = () => {
      const f = inp.files && inp.files[0];
      if (!f) { resolve(null); return; }
      createImageBitmap(f).then((bmp) => {
        const sc = Math.min(1, 512 / Math.max(bmp.width, bmp.height));
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(bmp.width * sc));
        c.height = Math.max(1, Math.round(bmp.height * sc));
        c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
        const url = c.toDataURL("image/png");
        resolve({ coreImg: url, coreKey: "c" + hashSeed(url).toString(36), coreName: f.name });
      }).catch(() => resolve(null));
    };
    inp.click();
  });
}
