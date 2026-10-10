// Minimal MongoDB-style matcher used by the offline file driver.
const isObj = (v) => v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date);
const get = (doc, key) => key.split(".").reduce((o, k) => (o == null ? undefined : o[k]), doc);

function cmp(value, op, arg, options) {
  switch (op) {
    case "$eq": return value === arg;
    case "$ne": return value !== arg;
    case "$in": return Array.isArray(arg) && arg.includes(value);
    case "$nin": return Array.isArray(arg) && !arg.includes(value);
    case "$gt": return value > arg;
    case "$gte": return value >= arg;
    case "$lt": return value < arg;
    case "$lte": return value <= arg;
    case "$exists": return (value !== undefined) === !!arg;
    case "$regex": return typeof value === "string" && new RegExp(arg, options || "i").test(value);
    default: throw new Error(`Unsupported query operator ${op}`);
  }
}

export function matches(doc, filter = {}) {
  for (const [key, cond] of Object.entries(filter)) {
    if (key === "$or") { if (!cond.some((f) => matches(doc, f))) return false; continue; }
    if (key === "$and") { if (!cond.every((f) => matches(doc, f))) return false; continue; }
    const value = get(doc, key);
    if (isObj(cond) && Object.keys(cond).some((k) => k.startsWith("$"))) {
      for (const [op, arg] of Object.entries(cond)) {
        if (op === "$options") continue;
        if (!cmp(value, op, arg, cond.$options)) return false;
      }
    } else if (Array.isArray(value) && !Array.isArray(cond)) {
      if (!value.includes(cond)) return false;
    } else if (value !== cond) return false;
  }
  return true;
}

export function sortDocs(docs, sort) {
  if (!sort) return docs;
  const keys = Object.entries(sort);
  return [...docs].sort((a, b) => {
    for (const [k, dir] of keys) {
      const x = get(a, k), y = get(b, k);
      if (x === y) continue;
      if (x === undefined) return 1;
      if (y === undefined) return -1;
      return (x < y ? -1 : 1) * (dir < 0 ? -1 : 1);
    }
    return 0;
  });
}
