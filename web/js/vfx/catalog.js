// Shared by project migration and the UI; no renderer or browser dependencies.
export const isRemoteKind = (kind) => ["arrow", "fireball", "thunder", "ice", "wind", "sand"].includes(kind);
export const isEffectCard = (type) => type === "vfx" || type === "remote";
