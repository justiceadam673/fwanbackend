import { Router } from "express";
import { db, newId, now } from "../db/index.js";
import { authRequired, requireRole } from "../middleware/auth.js";
import { badRequest, conflict, forbidden, notFound, wrap } from "../utils/errors.js";
import { check } from "../utils/validate.js";
import * as present from "../utils/present.js";
import { stockInfo } from "../services/stock.js";
import { refreshListing } from "../services/listings.js";
import { notify } from "../services/notify.js";
import { withLock } from "../utils/mutex.js";

const r = Router();
r.use(authRequired);

const money = (n) => `₦${Number(n).toLocaleString("en-NG")}`;
const total = (price, qty) => Math.round(price * qty * 100) / 100;

async function loadOffer(id) {
  const o = await db("offers").get(id);
  if (!o) throw notFound("Offer not found");
  return o;
}
const isParty = (o, u) => u.role === "admin" || o.buyerId === u._id || o.farmerId === u._id;

async function transition(offer, patch, expectStatuses) {
  const updated = await db("offers").findOneAndUpdate({ _id: offer._id, status: { $in: expectStatuses } }, { ...patch, updatedAt: now() });
  if (!updated) throw conflict("This offer was changed by someone else. Refresh and try again.");
  await refreshListing(offer.listingId);
  return updated;
}

r.get("/", wrap(async (req, res) => {
  const u = req.user, q = req.query;
  const filter = u.role === "buyer" ? { buyerId: u._id } : u.role === "farmer" ? { farmerId: u._id } : {};
  if (q.status) filter.status = q.status.includes(",") ? { $in: q.status.split(",") } : String(q.status);
  if (q.listingId) filter.listingId = String(q.listingId);
  const limit = Math.min(Math.max(parseInt(q.limit) || 50, 1), 200), page = Math.max(parseInt(q.page) || 1, 1);
  const [items, totalCount] = await Promise.all([db("offers").find(filter, { sort: { createdAt: -1 }, skip: (page - 1) * limit, limit }), db("offers").count(filter)]);
  res.json({ data: items.map(present.offer), meta: { page, limit, total: totalCount } });
}));

r.get("/:id", wrap(async (req, res) => {
  const o = await loadOffer(req.params.id);
  if (!isParty(o, req.user)) throw forbidden();
  res.json({ data: present.offer(o) });
}));

r.post("/", requireRole("buyer"), wrap(async (req, res) => {
  const b = check(req.body, {
    listingId: { required: true, max: 40 },
    quantity: { type: "number", required: true, min: 0.01 },
    offerPrice: { type: "number", required: true, min: 1, max: 1_000_000_000 },
    deliveryDate: { type: "date", required: true },
    deliveryLocation: { required: true, min: 3, max: 200 },
    messageToFarmer: { max: 500 },
  });
  if (new Date(b.deliveryDate) < new Date(new Date().toDateString())) throw badRequest("Validation failed", { deliveryDate: "cannot be in the past" });
  const offer = await withLock(`listing:${b.listingId}`, async () => {
    const l = await db("listings").get(b.listingId);
    if (!l) throw notFound("Listing not found");
    if (l.farmerId === req.user._id) throw forbidden("You cannot make an offer on your own listing");
    const s = await stockInfo(l);
    if (b.quantity > s.remaining) throw badRequest(`Only ${s.remaining} ${l.unit || "kg"} is still available`, { quantity: `max ${s.remaining}` });
    const active = await db("offers").count({ listingId: l._id, buyerId: req.user._id, status: { $in: ["Pending", "Countered"] } });
    if (active >= 3) throw conflict("You already have 3 open offers on this listing");
    const o = {
      _id: newId(), listingId: l._id, farmerId: l.farmerId, farmerName: l.farmer, buyerId: req.user._id, buyerName: req.user.name,
      product: l.prod, listingPrice: l.price, unit: l.unit || "kg", quantity: b.quantity, offerPrice: b.offerPrice,
      totalValue: total(b.offerPrice, b.quantity), deliveryDate: b.deliveryDate, deliveryLocation: b.deliveryLocation,
      messageToFarmer: b.messageToFarmer || "", status: "Pending", paymentStatus: "Unpaid", deliveryStatus: null,
      createdAt: now(), updatedAt: now(),
    };
    o.timestamp = o.createdAt;
    await db("offers").insert(o);
    await refreshListing(l._id);
    return o;
  });
  await notify(offer.farmerId, { type: "offer", title: "New offer", message: `${offer.buyerName} offered ${money(offer.offerPrice)} per ${offer.unit} for ${offer.quantity} ${offer.unit} of ${offer.product}.`, metadata: { offerId: offer._id, listingId: offer.listingId } });
  res.status(201).json({ data: present.offer(offer) });
}));

// ---- Farmer actions
const acceptFn = wrap(async (req, res) => {
  const o0 = await loadOffer(req.params.id);
  if (o0.farmerId !== req.user._id) throw forbidden();
  const o = await withLock(`listing:${o0.listingId}`, async () => {
    const l = await db("listings").get(o0.listingId);
    const s = await stockInfo(l);
    if (o0.quantity > s.remaining) throw conflict(`Only ${s.remaining} ${l.unit || "kg"} remains, which is less than this offer needs`);
    return transition(o0, { status: "Accepted", acceptedAt: now() }, ["Pending"]);
  });
  await notify(o.buyerId, { type: "offer", title: "Offer accepted", message: `${o.farmerName} accepted your offer for ${o.product}. You can now pay ${money(o.totalValue)}.`, metadata: { offerId: o._id } });
  res.json({ data: present.offer(o) });
});
r.post("/:id/accept", requireRole("farmer"), acceptFn);

const rejectFn = wrap(async (req, res) => {
  const { reason } = check(req.body, { reason: { max: 300 } });
  const o0 = await loadOffer(req.params.id);
  if (o0.farmerId !== req.user._id) throw forbidden();
  const o = await transition(o0, { status: "Rejected", rejectReason: reason || "" }, ["Pending", "Countered"]);
  await notify(o.buyerId, { type: "offer", title: "Offer rejected", message: `${o.farmerName} declined your offer for ${o.product}.${reason ? ` Reason: ${reason}` : ""}`, metadata: { offerId: o._id } });
  res.json({ data: present.offer(o) });
});
r.post("/:id/reject", requireRole("farmer"), rejectFn);

r.post("/:id/counter", requireRole("farmer"), wrap(async (req, res) => {
  const b = check(req.body, { offerPrice: { type: "number", required: true, min: 1 }, message: { max: 300 } });
  const o0 = await loadOffer(req.params.id);
  if (o0.farmerId !== req.user._id) throw forbidden();
  const o = await transition(o0, { status: "Countered", originalOfferPrice: o0.originalOfferPrice ?? o0.offerPrice, offerPrice: b.offerPrice, totalValue: total(b.offerPrice, o0.quantity), counterMessage: b.message || "" }, ["Pending"]);
  await notify(o.buyerId, { type: "offer", title: "Counter-offer", message: `${o.farmerName} proposed ${money(b.offerPrice)} per ${o.unit} for ${o.product}.`, metadata: { offerId: o._id } });
  res.json({ data: present.offer(o) });
}));

// Compatibility with the frontend's updateDoc(offerRef, { status }) calls
r.patch("/:id/status", requireRole("farmer"), wrap(async (req, res, next) => {
  const { status } = check(req.body, { status: { required: true, enum: ["Accepted", "Rejected"] } });
  return (status === "Accepted" ? acceptFn : rejectFn)(req, res, next);
}));

r.post("/:id/delivery", requireRole("farmer"), wrap(async (req, res) => {
  const { deliveryStatus } = check(req.body, { deliveryStatus: { required: true, enum: ["Processing", "Shipped", "Delivered"] } });
  const o0 = await loadOffer(req.params.id);
  if (o0.farmerId !== req.user._id) throw forbidden();
  if (o0.status !== "Paid") throw conflict("Delivery can only be updated on paid orders");
  const order = ["Processing", "Shipped", "Delivered"];
  if (order.indexOf(deliveryStatus) < order.indexOf(o0.deliveryStatus || "Processing")) throw badRequest("Delivery status cannot go backwards");
  const o = await transition(o0, { deliveryStatus, ...(deliveryStatus === "Delivered" ? { deliveredAt: now() } : {}) }, ["Paid"]);
  await notify(o.buyerId, { type: "delivery", title: `Order ${deliveryStatus.toLowerCase()}`, message: `Your ${o.product} order is now: ${deliveryStatus}.`, metadata: { offerId: o._id } });
  res.json({ data: present.offer(o) });
}));

// ---- Buyer actions
r.post("/:id/accept-counter", requireRole("buyer"), wrap(async (req, res) => {
  const o0 = await loadOffer(req.params.id);
  if (o0.buyerId !== req.user._id) throw forbidden();
  const o = await withLock(`listing:${o0.listingId}`, async () => {
    const s = await stockInfo(await db("listings").get(o0.listingId));
    if (o0.quantity > s.remaining) throw conflict("That much produce is no longer available");
    return transition(o0, { status: "Accepted", acceptedAt: now() }, ["Countered"]);
  });
  await notify(o.farmerId, { type: "offer", title: "Counter-offer accepted", message: `${o.buyerName} accepted your price for ${o.product}.`, metadata: { offerId: o._id } });
  res.json({ data: present.offer(o) });
}));

r.post("/:id/cancel", requireRole("buyer"), wrap(async (req, res) => {
  const o0 = await loadOffer(req.params.id);
  if (o0.buyerId !== req.user._id) throw forbidden();
  const o = await transition(o0, { status: "Cancelled", cancelReason: "Cancelled by buyer" }, ["Pending", "Countered", "Accepted"]);
  await db("payments").removeWhere({ offerId: o._id, status: "pending" });
  await notify(o.farmerId, { type: "offer", title: "Offer cancelled", message: `${o.buyerName} cancelled the offer for ${o.product}.`, metadata: { offerId: o._id } });
  res.json({ data: present.offer(o) });
}));

r.post("/:id/confirm-receipt", requireRole("buyer"), wrap(async (req, res) => {
  const o0 = await loadOffer(req.params.id);
  if (o0.buyerId !== req.user._id) throw forbidden();
  if (o0.deliveryStatus !== "Delivered") throw conflict("The order has not been marked delivered yet");
  const o = await transition(o0, { status: "Completed", completedAt: now() }, ["Paid"]);
  if (o.orderId) await db("orders").update(o.orderId, { status: "Completed", completedAt: now() });
  await notify(o.farmerId, { type: "order", title: "Order completed", message: `${o.buyerName} confirmed receipt of ${o.product}.`, metadata: { offerId: o._id } });
  res.json({ data: present.offer(o) });
}));

export default r;
