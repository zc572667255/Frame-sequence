// Shared by project migration and the UI; no renderer or browser dependencies.
export const isRemoteKind = (kind) => ["arrow", "fireball", "thunder", "ice", "wind", "sand"].includes(kind);
export const isEffectCard = (type) => type === "vfx" || type === "remote";

// 箭矢's 外观: shapes drawn in code (kinds/arrow.js)
export const PROJECTILES = [["arrow", "箭矢"], ["dagger", "匕首"], ["spear", "长枪"], ["club", "棍棒"], ["axe", "飞斧"], ["shuriken", "手里剑"], ["ball", "球"], ["core", "透明核心"]];
const SHAPES = new Set(PROJECTILES.map(([id]) => id));
// older projects chose ready-made pictures ("s:<id>") or their own picture
// ("custom"): each becomes the drawn shape closest to it
const LEGACY = [["arrow", "arrow"], ["dagger", "dagger"], ["spear", "spear"], ["pole", "spear"], ["axe", "axe"], ["club", "club"], ["star", "shuriken"], ["ball", "ball"], ["bomb", "ball"]];
export function shapeOf(shape) {
  if (SHAPES.has(shape)) return shape;
  if (shape === "custom") return "core";
  const id = typeof shape === "string" && shape.startsWith("s:") ? shape.slice(2) : "";
  const hit = LEGACY.find(([prefix]) => id.startsWith(prefix));
  return hit ? hit[1] : "arrow";
}
