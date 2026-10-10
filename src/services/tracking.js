import { env } from "../config/env.js";
import { db, now } from "../db/index.js";
import { publish } from "./events.js";
import { notify } from "./notify.js";
import { coordsFor, haversineKm, lerp, DEFAULT_ORIGIN } from "../utils/geo.js";

const timers = new Map();

export async function createTracking({ order, offer, farmer }) {
  const origin = coordsFor(farmer?.address || farmer?.location || farmer?.city, DEFAULT_ORIGIN);
  let destination = coordsFor(offer.deliveryLocation, origin);
  if (destination[0] === origin[0] && destination[1] === origin[1]) destination = [origin[0] + 0.35, origin[1] + 0.3];
  const doc = {
    _id: order._id, orderId: order._id, offerId: offer._id, buyerId: offer.buyerId, farmerId: offer.farmerId,
    origin, destination, position: origin, progress: 0, distanceKm: round(haversineKm(origin, destination)),
    remainingKm: round(haversineKm(origin, destination)), status: "Preparing", source: "none", updatedAt: now(),
  };
  await db("tracking").insert(doc);
  return doc;
}

const round = (n) => Math.round(n * 10) / 10;

async function push(doc) {
  const out = { ...doc, id: doc._id };
  publish(doc.buyerId, "tracking", out);
  publish(doc.farmerId, "tracking", out);
}

export async function recordPosition(orderId, { lat, lng }, source = "gps") {
  const t = await db("tracking").get(orderId);
  if (!t) return null;
  const total = haversineKm(t.origin, t.destination) || 1;
  const remaining = haversineKm([lat, lng], t.destination);
  const progress = Math.min(1, Math.max(0, 1 - remaining / total));
  const arrived = remaining < 0.3;
  const doc = await db("tracking").update(orderId, {
    position: [lat, lng], progress: arrived ? 1 : progress, remainingKm: round(remaining),
    status: arrived ? "Delivered" : "In transit", source, updatedAt: now(),
  });
  await push(doc);
  if (arrived) await markDelivered(doc);
  return doc;
}

async function markDelivered(t) {
  const offer = await db("offers").findOneAndUpdate(
    { _id: t.offerId, deliveryStatus: { $ne: "Delivered" }, status: "Paid" },
    { deliveryStatus: "Delivered", deliveredAt: now() });
  if (offer) {
    await notify(offer.buyerId, { type: "delivery", title: "Delivered", message: `Your ${offer.product} order has arrived. Please confirm receipt.`, metadata: { offerId: offer._id } });
    await notify(offer.farmerId, { type: "delivery", title: "Delivered", message: `The ${offer.product} order to ${offer.buyerName} was delivered.`, metadata: { offerId: offer._id } });
  }
}

export async function startSimulation(orderId) {
  const t = await db("tracking").get(orderId);
  if (!t) return null;
  stopSimulation(orderId);
  await db("offers").findOneAndUpdate({ _id: t.offerId, status: "Paid", deliveryStatus: "Processing" }, { deliveryStatus: "Shipped" });
  const step = 2 / env.SIM_TRIP_SECONDS;
  let progress = t.progress >= 1 ? 0 : t.progress;
  const tick = async () => {
    progress = Math.min(1, progress + step);
    const pos = lerp(t.origin, t.destination, progress);
    const jitter = progress < 1 ? (Math.random() - 0.5) * 0.004 : 0;
    const doc = await db("tracking").update(orderId, {
      position: [pos[0] + jitter, pos[1] - jitter], progress, remainingKm: round(haversineKm(pos, t.destination)),
      status: progress >= 1 ? "Delivered" : "In transit", source: "simulated", updatedAt: now(),
    });
    if (doc) await push(doc);
    if (progress >= 1) { stopSimulation(orderId); if (doc) await markDelivered(doc); }
  };
  timers.set(orderId, setInterval(() => tick().catch(() => stopSimulation(orderId)), 2000));
  await tick();
  return db("tracking").get(orderId);
}

export function stopSimulation(orderId) {
  clearInterval(timers.get(orderId));
  timers.delete(orderId);
}
export const isSimulating = (orderId) => timers.has(orderId);
export const stopAllSimulations = () => { for (const id of timers.keys()) stopSimulation(id); };
