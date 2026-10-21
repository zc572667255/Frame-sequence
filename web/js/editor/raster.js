// Pixel operations on ImageData for the editor.
//
// Colours are [r, g, b, a] arrays. Cels are edited copy-on-write (see doc.js), and
// every in-place change bumps `img.__v` so cached canvases know to refresh.

export const TRANSPARENT = [0, 0, 0, 0];

export function blank(w, h) {
  return new ImageData(w, h);
}

export function cloneImg(img) {
  return new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
}

export function touch(img) {
  img.__v = (img.__v || 0) + 1;
}

export function getPx(img, x, y) {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return null;
  const i = (y * img.width + x) * 4, d = img.data;
  return [d[i], d[i + 1], d[i + 2], d[i + 3]];
}

const inClip = (clip, x, y) => !clip || (x >= clip.x && y >= clip.y && x < clip.x + clip.w && y < clip.y + clip.h);

export function setPx(img, x, y, c, clip) {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height || !inClip(clip, x, y)) return;
  const i = (y * img.width + x) * 4, d = img.data;
  d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = c[3];
}

// square brush of `size`, centred on (x, y); even sizes lean up-left like Aseprite
export function stamp(img, x, y, size, c, clip) {
  const o = Math.floor((size - 1) / 2);
  for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) setPx(img, x - o + dx, y - o + dy, c, clip);
}

export function brushCells(x, y, size) {
  const o = Math.floor((size - 1) / 2);
  return { x: x - o, y: y - o, size };
}

export function line(x0, y0, x1, y1, fn) {
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    fn(x0, y0);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

export function rectPoints(x0, y0, x1, y1, filled, fn) {
  const ax = Math.min(x0, x1), bx = Math.max(x0, x1), ay = Math.min(y0, y1), by = Math.max(y0, y1);
  for (let y = ay; y <= by; y++) {
    for (let x = ax; x <= bx; x++) {
      if (filled || x === ax || x === bx || y === ay || y === by) fn(x, y);
    }
  }
}

// ellipse inscribed in the box; the outline is the filled shape's 4-connected rim,
// which gives clean 1px pixel-art curves at every size
export function ellipsePoints(x0, y0, x1, y1, filled, fn) {
  const ax = Math.min(x0, x1), bx = Math.max(x0, x1), ay = Math.min(y0, y1), by = Math.max(y0, y1);
  const cx = (ax + bx + 1) / 2, cy = (ay + by + 1) / 2;
  const rx = (bx - ax + 1) / 2, ry = (by - ay + 1) / 2;
  const inside = (x, y) => {
    if (x < ax || x > bx || y < ay || y > by) return false;
    const nx = (x + 0.5 - cx) / rx, ny = (y + 0.5 - cy) / ry;
    return nx * nx + ny * ny <= 1.0001;
  };
  for (let y = ay; y <= by; y++) {
    for (let x = ax; x <= bx; x++) {
      if (!inside(x, y)) continue;
      if (filled || !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)) fn(x, y);
    }
  }
}

const same = (d, i, c) => (d[i + 3] === 0 && c[3] === 0) || (d[i] === c[0] && d[i + 1] === c[1] && d[i + 2] === c[2] && d[i + 3] === c[3]);

// bucket fill: exact colour match; contiguous (4-connected) or every matching pixel
export function floodFill(img, x, y, c, contiguous, clip) {
  const target = getPx(img, x, y);
  if (!target || !inClip(clip, x, y)) return false;
  if (same(target, 0, c) && target[3] === c[3]) return false;
  const { width: w, height: h, data: d } = img;
  const paint = (i) => { d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = c[3]; };
  if (!contiguous) {
    for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
      const i = (py * w + px) * 4;
      if (same(d, i, target) && inClip(clip, px, py)) paint(i);
    }
    return true;
  }
  const seen = new Uint8Array(w * h);
  const stack = [x, y];
  while (stack.length) {
    const py = stack.pop(), px = stack.pop();
    if (px < 0 || py < 0 || px >= w || py >= h) continue;
    const k = py * w + px;
    if (seen[k]) continue;
    seen[k] = 1;
    if (!same(d, k * 4, target) || !inClip(clip, px, py)) continue;
    paint(k * 4);
    stack.push(px + 1, py, px - 1, py, px, py + 1, px, py - 1);
  }
  return true;
}

export function extract(img, r) {
  const out = new ImageData(r.w, r.h);
  for (let y = 0; y < r.h; y++) {
    for (let x = 0; x < r.w; x++) {
      const sx = r.x + x, sy = r.y + y;
      if (sx < 0 || sy < 0 || sx >= img.width || sy >= img.height) continue;
      const si = (sy * img.width + sx) * 4, di = (y * r.w + x) * 4;
      out.data[di] = img.data[si]; out.data[di + 1] = img.data[si + 1];
      out.data[di + 2] = img.data[si + 2]; out.data[di + 3] = img.data[si + 3];
    }
  }
  return out;
}

export function clearRect(img, r) {
  for (let y = Math.max(0, r.y); y < Math.min(img.height, r.y + r.h); y++) {
    for (let x = Math.max(0, r.x); x < Math.min(img.width, r.x + r.w); x++) {
      img.data[(y * img.width + x) * 4 + 3] = 0;
    }
  }
}

// paste src onto dst at (x, y): opaque pixels replace, transparent ones leave dst alone
export function blit(dst, src, ox, oy) {
  for (let y = 0; y < src.height; y++) {
    const dy = oy + y;
    if (dy < 0 || dy >= dst.height) continue;
    for (let x = 0; x < src.width; x++) {
      const dx = ox + x;
      if (dx < 0 || dx >= dst.width) continue;
      const si = (y * src.width + x) * 4;
      const a = src.data[si + 3];
      if (!a) continue;
      const di = (dy * dst.width + dx) * 4;
      if (a === 255) {
        dst.data[di] = src.data[si]; dst.data[di + 1] = src.data[si + 1]; dst.data[di + 2] = src.data[si + 2]; dst.data[di + 3] = 255;
      } else {
        // the rare partially transparent pixel (imported art) composites normally
        const da = dst.data[di + 3] / 255, sa = a / 255, oa = sa + da * (1 - sa);
        for (let k = 0; k < 3; k++) dst.data[di + k] = Math.round((src.data[si + k] * sa + dst.data[di + k] * da * (1 - sa)) / oa);
        dst.data[di + 3] = Math.round(oa * 255);
      }
    }
  }
}

export function flip(img, horizontal) {
  const { width: w, height: h } = img;
  const out = new ImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = (y * w + x) * 4;
      const di = horizontal ? (y * w + (w - 1 - x)) * 4 : ((h - 1 - y) * w + x) * 4;
      out.data[di] = img.data[si]; out.data[di + 1] = img.data[si + 1];
      out.data[di + 2] = img.data[si + 2]; out.data[di + 3] = img.data[si + 3];
    }
  }
  return out;
}

export function isEmpty(img) {
  const d = img.data;
  for (let i = 3; i < d.length; i += 4) if (d[i]) return false;
  return true;
}

// new w×h image with `img` placed at (ox, oy)
export function reposition(img, w, h, ox, oy) {
  const out = new ImageData(w, h);
  blit(out, img, ox, oy);
  return out;
}

export const hex = (c) => "#" + [c[0], c[1], c[2]].map((v) => v.toString(16).padStart(2, "0")).join("");
export const fromHex = (h) => {
  const s = h.replace("#", "");
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16), 255];
};
