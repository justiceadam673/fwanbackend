// Turn stored documents into API responses (id instead of _id, no secrets, frontend-friendly aliases).
const omit = (o, keys) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));

export function user(u) {
  if (!u) return null;
  const o = omit(u, ["_id", "passwordHash", "verifyTokenHash", "verifyTokenExpires", "resetTokenHash", "resetTokenExpires"]);
  return { id: u._id, uid: u._id, ...o };
}
export function listing(l, extra = {}) {
  if (!l) return null;
  return { id: l._id, ...omit(l, ["_id"]), product: l.prod, ...extra };
}
export function generic(d) { return d ? { id: d._id, ...omit(d, ["_id"]) } : null; }
export function offer(o) {
  if (!o) return null;
  return { id: o._id, ...omit(o, ["_id"]) };
}
