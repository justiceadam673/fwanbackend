import { Router } from "express";
import { db, newId, now } from "../db/index.js";
import { authOptional, authRequired, requireRole } from "../middleware/auth.js";
import { badRequest, forbidden, notFound, wrap, conflict } from "../utils/errors.js";
import { check } from "../utils/validate.js";
import * as present from "../utils/present.js";
import { parseQuantity, stockInfo } from "../services/stock.js";
import { ratingFor, refreshListing } from "../services/listings.js";
import { notify } from "../services/notify.js";
import { withLock } from "../utils/mutex.js";

const r = Router();
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function decorate(l) {
  const s = await stockInfo(l);
  const rt = await ratingFor(l._id);
  return present.listing(l, { farmerId: l.farmerId, soldQuantity: s.sold, remainingQuantity: s.remaining, ...rt });
}

const FIELDS = {
  prod: { max: 80 }, product: { max: 80 },
  unit: { max: 20 },
  price: { type: "number", min: 1, max: 1_000_000_000 },
  tier: { max: 40 }, description: { max: 1000 }, harvestDate: { type: "date" }, image: { max: 500 },
  location: { max: 120 },
};

function normalise(b, partial = false) {
  const out = {};
  const name = b.prod || b.product;
  if (name) out.prod = name;
  const q = b.quantityValue ?? b.quantity;
  if (q !== undefined && q !== null && q !== "") {
    const p = parseQuantity(typeof q === "number" ? q : String(q));
    if (!(p.value > 0)) throw badRequest("Validation failed", { quantity: "must be a positive amount, e.g. 50 or '50 kg'" });
    out.quantityValue = p.value;
    out.unit = b.unit || p.unit;
    out.quantity = `${p.value} ${out.unit}`;
  }
  for (const k of ["price", "tier", "description", "harvestDate", "image", "location"]) if (b[k] !== undefined) out[k] = b[k];
  if (!partial) {
    if (!out.prod) throw badRequest("Validation failed", { prod: "is required" });
    if (out.quantityValue === undefined) throw badRequest("Validation failed", { quantity: "is required" });
    if (out.price === undefined) throw badRequest("Validation failed", { price: "is required" });
  }
  return out;
}

r.get("/", authOptional, wrap(async (req, res) => {
  const q = req.query;
  const filter = {};
  if (q.product) filter.prod = String(q.product);
  if (q.farmerId) filter.farmerId = String(q.farmerId);
  if (q.status) filter.status = String(q.status);
  if (q.minPrice || q.maxPrice) filter.price = { ...(q.minPrice && { $gte: Number(q.minPrice) }), ...(q.maxPrice && { $lte: Number(q.maxPrice) }) };
  if (q.q) { const rx = esc(String(q.q).slice(0, 60)); filter.$or = [{ prod: { $regex: rx, $options: "i" } }, { farmer: { $regex: rx, $options: "i" } }, { description: { $regex: rx, $options: "i" } }]; }
  const sort = { newest: { createdAt: -1 }, price_asc: { price: 1 }, price_desc: { price: -1 } }[q.sort] || { createdAt: -1 };
  const limit = Math.min(Math.max(parseInt(q.limit) || 24, 1), 100), page = Math.max(parseInt(q.page) || 1, 1);
  const [items, total] = await Promise.all([db("listings").find(filter, { sort, skip: (page - 1) * limit, limit }), db("listings").count(filter)]);
  res.json({ data: await Promise.all(items.map(decorate)), meta: { page, limit, total, pages: Math.ceil(total / limit) } });
}));

r.get("/mine", authRequired, requireRole("farmer"), wrap(async (req, res) => {
  const items = await db("listings").find({ farmerId: req.user._id }, { sort: { createdAt: -1 } });
  res.json({ data: await Promise.all(items.map(decorate)) });
}));

r.get("/:id", wrap(async (req, res) => {
  const l = await db("listings").get(req.params.id);
  if (!l) throw notFound("Listing not found");
  res.json({ data: await decorate(l) });
}));

r.post("/", authRequired, requireRole("farmer"), wrap(async (req, res) => {
  const b = check(req.body, FIELDS);
  const n = normalise({ ...req.body, ...b });
  const listing = {
    _id: newId(), farmerId: req.user._id, userId: req.user._id, farmer: req.user.name, farmerPhoto: req.user.photoURL || "",
    ...n, tier: n.tier || "Standard", description: n.description || "", image: n.image || "",
    location: n.location || [req.user.city, req.user.state].filter(Boolean).join(", "),
    status: "In Stock", offers: 0, soldQuantity: 0, remainingQuantity: n.quantityValue, createdAt: now(), updatedAt: now(),
  };
  await db("listings").insert(listing);
  res.status(201).json({ data: await decorate(listing) });
}));

r.patch("/:id", authRequired, requireRole("farmer"), wrap(async (req, res) => {
  const result = await withLock(`listing:${req.params.id}`, async () => {
    const l = await db("listings").get(req.params.id);
    if (!l) throw notFound("Listing not found");
    if (l.farmerId !== req.user._id) throw forbidden("You can only edit your own listings");
    const b = check(req.body, FIELDS);
    const n = normalise({ ...req.body, ...b }, true);
    if (n.quantityValue !== undefined) {
      const s = await stockInfo(l);
      if (n.quantityValue < s.sold) throw conflict(`You have already committed ${s.sold} ${l.unit || "kg"} in accepted or paid offers`);
    }
    await db("listings").update(l._id, { ...n, updatedAt: now() });
    return refreshListing(l._id);
  });
  res.json({ data: await decorate(result) });
}));

r.delete("/:id", authRequired, requireRole("farmer"), wrap(async (req, res) => {
  await withLock(`listing:${req.params.id}`, async () => {
    const l = await db("listings").get(req.params.id);
    if (!l) throw notFound("Listing not found");
    if (l.farmerId !== req.user._id) throw forbidden("You can only delete your own listings");
    const open = await db("offers").count({ listingId: l._id, status: { $in: ["Accepted", "Paid"] } });
    if (open) throw conflict("This listing has accepted or paid offers in progress. Complete or cancel them first.");
    const pending = await db("offers").find({ listingId: l._id, status: { $in: ["Pending", "Countered"] } });
    for (const o of pending) {
      await db("offers").update(o._id, { status: "Cancelled", cancelReason: "Listing removed by farmer", updatedAt: now() });
      await notify(o.buyerId, { type: "offer", title: "Offer cancelled", message: `The ${o.product} listing was removed, so your offer was cancelled.`, metadata: { offerId: o._id } });
    }
    await db("reviews").removeWhere({ listingId: l._id });
    await db("listings").remove(l._id);
  });
  res.json({ data: { deleted: true } });
}));

// ---- Reviews
r.get("/:id/reviews", wrap(async (req, res) => {
  const rs = await db("reviews").find({ listingId: req.params.id }, { sort: { createdAt: -1 } });
  res.json({ data: rs.map(present.generic) });
}));

r.post("/:id/reviews", authRequired, requireRole("buyer"), wrap(async (req, res) => {
  const l = await db("listings").get(req.params.id);
  if (!l) throw notFound("Listing not found");
  const b = check(req.body, { rating: { type: "number", required: true, min: 1, max: 5, int: true }, comment: { max: 600 } });
  if (await db("reviews").findOne({ listingId: l._id, userId: req.user._id })) throw conflict("You have already reviewed this listing");
  const verified = (await db("offers").count({ listingId: l._id, buyerId: req.user._id, status: { $in: ["Paid", "Completed"] } })) > 0;
  const review = { _id: newId(), listingId: l._id, userId: req.user._id, userName: req.user.name, rating: b.rating, comment: b.comment || "", verifiedPurchase: verified, createdAt: now() };
  await db("reviews").insert(review);
  await notify(l.farmerId, { type: "review", title: "New review", message: `${req.user.name} rated your ${l.prod} ${b.rating}/5.`, metadata: { listingId: l._id } });
  res.status(201).json({ data: present.generic(review) });
}));

r.delete("/:id/reviews/:reviewId", authRequired, wrap(async (req, res) => {
  const rv = await db("reviews").get(req.params.reviewId);
  if (!rv || rv.listingId !== req.params.id) throw notFound("Review not found");
  if (rv.userId !== req.user._id && req.user.role !== "admin") throw forbidden();
  await db("reviews").remove(rv._id);
  res.json({ data: { deleted: true } });
}));

export default r;
