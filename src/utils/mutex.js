// Per-key async mutex (serialises read-check-write sequences such as stock checks).
const tails = new Map();
export async function withLock(key, fn) {
  const prev = tails.get(key) || Promise.resolve();
  let release;
  const next = new Promise((r) => (release = r));
  tails.set(key, prev.then(() => next));
  await prev;
  try { return await fn(); }
  finally { release(); if (tails.get(key) === next) tails.delete(key); }
}
