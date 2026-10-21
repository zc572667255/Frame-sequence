// Project binaries (images, frames, audio). The document references them by the
// server's content-hash id; decoded canvases are cached here and must be treated
// as read-only — copy before drawing into one.
import { api } from "./api.js";
import { blobToCanvas, canvasToBlob } from "./util.js";

const canvases = new Map(); // "pid/aid" -> Promise<HTMLCanvasElement>

export function getAssetCanvas(projectId, assetId) {
  const key = projectId + "/" + assetId;
  let p = canvases.get(key);
  if (!p) {
    p = fetch(api.assetUrl(projectId, assetId))
      .then((r) => {
        if (!r.ok) throw new Error("素材读取失败：" + assetId);
        return r.blob();
      })
      .then(blobToCanvas);
    p.catch(() => canvases.delete(key));
    canvases.set(key, p);
  }
  return p;
}

export async function putBlobAsset(projectId, blob) {
  return api.uploadAsset(projectId, blob);
}

export async function putCanvasAsset(projectId, canvas) {
  const blob = await canvasToBlob(canvas);
  const id = await api.uploadAsset(projectId, blob);
  const key = projectId + "/" + id;
  if (!canvases.has(key)) canvases.set(key, Promise.resolve(canvas));
  return id;
}

export function assetUrl(projectId, assetId) {
  return api.assetUrl(projectId, assetId);
}
