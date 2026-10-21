// Colour math shared by de-pixelation, recolouring and GIF quantization.
import { hexToRgb } from "../core/util.js";

export const packRGB = (d, i) => ((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]) >>> 0;
export const unpackRGB = (k) => [(k >> 16) & 255, (k >> 8) & 255, k & 255];

// RESURRECT-64 pixel-art palette (Kerrie Lake), official Lospec hex order
export const RESURRECT_64 = [
  "2e222f", "3e3546", "625565", "966c6c", "ab947a", "694f62", "7f708a", "9babb2",
  "c7dcd0", "ffffff", "6e2727", "b33831", "ea4f36", "f57d4a", "ae2334", "e83b3b",
  "fb6b1d", "f79617", "f9c22b", "7a3045", "9e4539", "cd683d", "e6904e", "fbb954",
  "4c3e24", "676633", "a2a947", "d5e04b", "fbff86", "165a4c", "239063", "1ebc73",
  "91db69", "cddf6c", "313638", "374e4a", "547e64", "92a984", "b2ba90", "0b5e65",
  "0b8a8f", "0eaf9b", "30e1b9", "8ff8e2", "323353", "484a77", "4d65b4", "4d9be6",
  "8fd3ff", "45293f", "6b3e75", "905ea9", "a884f3", "eaaded", "753c54", "a24b6f",
  "cf657f", "ed8099", "831c5d", "c32454", "f04f78", "f68181", "fca790", "fdcbb0",
].map((h) => hexToRgb(h));

// well-known fixed pixel-art palettes (Lospec), by key
export const PALETTES = {
  resurrect64: { label: "Resurrect 64", colors: RESURRECT_64 },
  endesga32: {
    label: "Endesga 32",
    colors: ["be4a2f", "d77643", "ead4aa", "e4a672", "b86f50", "733e39", "3e2731", "a22633",
      "e43b44", "f77622", "feae34", "fee761", "63c74d", "3e8948", "265c42", "193c3e",
      "124e89", "0099db", "2ce8f5", "ffffff", "c0cbdc", "8b9bb4", "5a6988", "3a4466",
      "262b44", "181425", "ff0044", "68386c", "b55088", "f6757a", "e8b796", "c28569"].map(hexToRgb),
  },
  sweetie16: {
    label: "Sweetie 16",
    colors: ["1a1c2c", "5d275d", "b13e53", "ef7d57", "ffcd75", "a7f070", "38b764", "257179",
      "29366f", "3b5dc9", "41a6f6", "73eff7", "f4f4f4", "94b0c2", "566c86", "333c57"].map(hexToRgb),
  },
  db32: {
    label: "DawnBringer 32",
    colors: ["000000", "222034", "45283c", "663931", "8f563b", "df7126", "d9a066", "eec39a",
      "fbf236", "99e550", "6abe30", "37946e", "4b692f", "524b24", "323c39", "3f3f74",
      "306082", "5b6ee1", "639bff", "5fcde4", "cbdbfc", "ffffff", "9badb7", "847e87",
      "696a6a", "595652", "76428a", "ac3232", "d95763", "d77bba", "8f974a", "8a6f30"].map(hexToRgb),
  },
  gray16: {
    label: "灰阶 16",
    colors: Array.from({ length: 16 }, (_v, i) => { const v = Math.round(i * 255 / 15); return [v, v, v]; }),
  },
  pico8: {
    label: "PICO-8",
    colors: ["000000", "1d2b53", "7e2553", "008751", "ab5236", "5f574f", "c2c3c7", "fff1e8",
      "ff004d", "ffa300", "ffec27", "00e436", "29adff", "83769c", "ff77a8", "ffccaa"].map(hexToRgb),
  },
};

export function rgb2hsl(c) {
  const r = c[0] / 255, g = c[1] / 255, b = c[2] / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0; const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h, s, l };
}

export function hsl2rgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - c / 2;
  let r, g, b;
  if (h < 60) { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

// perceptual "redmean" distance — better nearest-color than plain euclidean
export function colorDist(a, b) {
  const rmean = (a[0] + b[0]) / 2;
  const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
  return (2 + rmean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rmean) / 256) * db * db;
}

export function nearestIndexIn(c, pal) {
  let bi = 0, bd = Infinity;
  for (let i = 0; i < pal.length; i++) {
    const d = colorDist(c, pal[i]);
    if (d < bd) { bd = d; bi = i; }
  }
  return bi;
}

export function nearestIn(c, pal) {
  return pal[nearestIndexIn(c, pal)];
}

// median-cut down to k representative colors, weighted by pixel counts
export function medianCut(colors, counts, k) {
  if (colors.length <= k) return colors.map((c) => c.slice());
  const rangeOf = (box) => {
    const mn = [255, 255, 255], mx = [0, 0, 0];
    for (const e of box) for (let j = 0; j < 3; j++) {
      if (e.c[j] < mn[j]) mn[j] = e.c[j];
      if (e.c[j] > mx[j]) mx[j] = e.c[j];
    }
    return [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
  };
  const boxes = [colors.map((c, i) => ({ c, n: counts[i] }))];
  while (boxes.length < k) {
    let bi = -1, bestR = -1, bestCh = 0;
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i].length < 2) continue;
      const r = rangeOf(boxes[i]);
      const ch = r[0] >= r[1] ? (r[0] >= r[2] ? 0 : 2) : (r[1] >= r[2] ? 1 : 2);
      if (r[ch] > bestR) { bestR = r[ch]; bi = i; bestCh = ch; }
    }
    if (bi < 0) break;
    const box = boxes[bi];
    box.sort((a, b) => a.c[bestCh] - b.c[bestCh]);
    let tot = 0; for (const e of box) tot += e.n;
    let acc = 0, cut = 1;
    for (let i = 0; i < box.length; i++) {
      acc += box[i].n;
      if (acc >= tot / 2) { cut = Math.min(Math.max(i, 1), box.length - 1); break; }
    }
    boxes.splice(bi, 1, box.slice(0, cut), box.slice(cut));
  }
  return boxes.filter((b) => b.length).map((box) => {
    let sr = 0, sg = 0, sb = 0, sn = 0;
    for (const e of box) { sr += e.c[0] * e.n; sg += e.c[1] * e.n; sb += e.c[2] * e.n; sn += e.n; }
    return [Math.round(sr / sn), Math.round(sg / sn), Math.round(sb / sn)];
  });
}

// distinct opaque colours -> pixel count, over one or many ImageData
export function colorCounts(images) {
  const counts = new Map();
  for (const im of [].concat(images)) {
    const d = im.data, n = im.width * im.height;
    for (let i = 0; i < n; i++) {
      if (d[i * 4 + 3] < 8) continue;
      const key = packRGB(d, i * 4);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return counts;
}

export function countColors(images) {
  return colorCounts(images).size;
}

// apply a key -> [r,g,b] mapping in place
export function remapColors(imageData, mapFn) {
  const d = imageData.data, n = imageData.width * imageData.height;
  const cache = new Map();
  for (let i = 0; i < n; i++) {
    if (d[i * 4 + 3] < 8) continue;
    const key = packRGB(d, i * 4);
    let nc = cache.get(key);
    if (!nc) { nc = mapFn(key); cache.set(key, nc); }
    d[i * 4] = nc[0]; d[i * 4 + 1] = nc[1]; d[i * 4 + 2] = nc[2];
  }
}

// reduce one or several images (sharing one palette) to at most k colours
export function reduceColors(images, k) {
  const list = [].concat(images);
  const counts = colorCounts(list);
  if (counts.size <= k) return;
  const entries = [...counts.entries()];
  const pal = medianCut(entries.map(([key]) => unpackRGB(key)), entries.map(([, c]) => c), k);
  for (const im of list) remapColors(im, (key) => pal[nearestIndexIn(unpackRGB(key), pal)]);
}

export function snapToPalette(images, pal) {
  for (const im of [].concat(images)) remapColors(im, (key) => nearestIn(unpackRGB(key), pal));
}
