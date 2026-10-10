// Server-Sent Events hub: replaces Firestore onSnapshot for live updates.
const clients = new Map(); // userId -> Set<res>

export function subscribe(userId, res) {
  if (!clients.has(userId)) clients.set(userId, new Set());
  clients.get(userId).add(res);
  const hb = setInterval(() => res.write(": ping\n\n"), 25_000);
  res.on("close", () => {
    clearInterval(hb);
    clients.get(userId)?.delete(res);
    if (!clients.get(userId)?.size) clients.delete(userId);
  });
}

export function publish(userId, event, data) {
  const set = clients.get(userId);
  if (!set) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of set) res.write(payload);
}

export const connectedUsers = () => clients.size;
