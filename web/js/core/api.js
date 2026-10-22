// Thin client for server/server.js. Every mutating call carries X-Guangtai so the
// server can tell it apart from a cross-site form post.
const HEADERS = { "X-Guangtai": "1" };

async function request(method, url, body, opts = {}) {
  const init = { method, headers: { ...HEADERS } };
  if (body !== undefined) {
    if (opts.type) {
      init.headers["Content-Type"] = opts.type;
      init.body = body;
    } else {
      init.headers["Content-Type"] = "application/json";
      init.body = typeof body === "string" ? body : JSON.stringify(body);
    }
  }
  // keepalive lets a save started while the page is closing still reach the server
  // (browsers cap keepalive bodies at 64 KB, so bigger ones go out normally)
  if (opts.keepalive && (!init.body || init.body.length < 60000)) init.keepalive = true;
  let res;
  try {
    res = await fetch(url, init);
  } catch {
    throw new Error("连不上本地服务，请确认 start.bat 的窗口还开着");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.error) || "请求失败（" + res.status + "）");
  return data;
}

const enc = encodeURIComponent;
const P = (id) => "/api/projects/" + enc(id);

export const api = {
  listProjects: () => request("GET", "/api/projects"),
  createProject: (name, parent) => request("POST", "/api/projects", { name, parent }),
  openProject: (path) => request("POST", "/api/projects/open", { path }),
  loadProject: (id) => request("GET", P(id)),
  saveProject: (id, docJson, opts) => request("PUT", P(id), docJson, opts),
  saveProjectAs: (id, parent, name) => request("POST", P(id) + "/save-as", { parent, name }),
  forgetProject: (id) => request("DELETE", P(id)),
  trashProject: (id) => request("DELETE", P(id) + "?trash=1"),
  unusedAssets: (id, keep) => request("POST", P(id) + "/unused-assets", { keep }),
  cleanAssets: (id, keep) => request("POST", P(id) + "/clean-assets", { keep }),
  revealProject: (id) => request("POST", P(id) + "/reveal", {}),
  listBackups: (id) => request("GET", P(id) + "/backups"),
  loadBackup: (id, name) => request("GET", P(id) + "/backups/" + enc(name)),
  uploadAsset: async (id, blob) => (await request("POST", P(id) + "/assets", blob, { type: blob.type || "application/octet-stream" })).id,
  assetUrl: (id, assetId) => P(id) + "/assets/" + enc(assetId),
  pickFolder: (title, start) => request("POST", "/api/dialog/folder", { title, start }),
  pickProjectFile: (start) => request("POST", "/api/dialog/project", { start }),
  getSettings: () => request("GET", "/api/settings"),
  putSettings: (patch) => request("PUT", "/api/settings", patch),
};
