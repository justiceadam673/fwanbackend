import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { env } from "../config/env.js";
import { db, dbKind, now } from "../db/index.js";
import { authRequired, requireRole } from "../middleware/auth.js";
import { subscribe, connectedUsers } from "../services/events.js";
import { badRequest, notFound, wrap } from "../utils/errors.js";
import { check } from "../utils/validate.js";
import * as present from "../utils/present.js";

export const health = Router();
health.get("/", (_req, res) => res.json({
  status: "ok", app: "FWAN backend", version: "2.0.0", database: dbKind(), offlineMode: env.OFFLINE,
  paymentMode: env.PAYMENT_MODE, paymentsConfigured: env.PAYMENT_MODE === "mock" || !!env.PAYSTACK_SECRET_KEY,
  liveClients: connectedUsers(), uptimeSeconds: Math.round(process.uptime()), time: now(),
}));

// ---- Live updates (Server-Sent Events): events "notification" and "tracking"
export const stream = Router();
// EventSource cannot set headers, so the stream (and only the stream) also accepts ?token=
const tokenFromQuery = (req, _res, next) => { if (req.query.token && !req.headers.authorization) req.headers.authorization = `Bearer ${req.query.token}`; next(); };
stream.get("/", tokenFromQuery, authRequired, (req, res) => {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  res.write(`event: ready\ndata: ${JSON.stringify({ userId: req.user._id })}\n\n`);
  subscribe(req.user._id, res);
});

// ---- Market prices
const priceFile = path.join(env.ROOT, "data", "prices.json");
const readPrices = () => JSON.parse(fs.readFileSync(priceFile, "utf8"));
export const prices = Router();

prices.get("/", wrap(async (_req, res) => {
  const ref = readPrices();
  const [listings, orders] = await Promise.all([db("listings").find({}), db("orders").find({})]);
  const stats = {};
  for (const l of listings) { const s = (stats[l.prod] ||= { product: l.prod, listings: 0, listingPriceSum: 0, paidOrders: 0, paidValue: 0, paidQty: 0 }); s.listings++; s.listingPriceSum += l.price; }
  for (const o of orders) { const s = (stats[o.product] ||= { product: o.product, listings: 0, listingPriceSum: 0, paidOrders: 0, paidValue: 0, paidQty: 0 }); s.paidOrders++; s.paidValue += o.amount; s.paidQty += o.quantity; }
  const platformStats = Object.values(stats).map((s) => ({
    product: s.product, activeListings: s.listings, averageListingPrice: s.listings ? Math.round(s.listingPriceSum / s.listings) : null,
    paidOrders: s.paidOrders, averagePaidPricePerUnit: s.paidQty ? Math.round(s.paidValue / s.paidQty) : null,
  }));
  res.json({ data: { reference: ref, platformStats, note: "'reference' is a static table. 'platformStats' is computed from real FWAN listings and paid orders." } });
}));

prices.put("/", authRequired, requireRole("admin"), wrap(async (req, res) => {
  const items = req.body?.items;
  if (!Array.isArray(items) || !items.length) throw badRequest("Send { items: [{ product, unit, min, max }] }");
  const clean = items.map((i) => ({ ...check(i, { product: { required: true, max: 80 }, unit: { max: 40 }, min: { type: "number", required: true, min: 0 }, max: { type: "number", required: true, min: 0 } }), currency: "NGN" }));
  const doc = { source: String(req.body.source || "Updated by an administrator").slice(0, 300), updatedAt: now().slice(0, 10), items: clean };
  fs.writeFileSync(priceFile, JSON.stringify(doc, null, 2));
  res.json({ data: doc });
}));

// ---- Admin
export const admin = Router();
admin.use(authRequired, requireRole("admin"));
admin.get("/stats", wrap(async (_req, res) => {
  const [users, farmers, buyers, listings, offers, orders, flagged] = await Promise.all([
    db("users").count(), db("users").count({ role: "farmer" }), db("users").count({ role: "buyer" }), db("listings").count(),
    db("offers").count(), db("orders").find({}), db("payments").count({ status: { $in: ["mismatch", "needs_review"] } }),
  ]);
  res.json({ data: { users, farmers, buyers, listings, offers, paidOrders: orders.length, grossValue: orders.reduce((s, o) => s + o.amount, 0), paymentsNeedingReview: flagged } });
}));
admin.get("/users", wrap(async (req, res) => {
  const f = req.query.role ? { role: String(req.query.role) } : {};
  res.json({ data: (await db("users").find(f, { sort: { createdAt: -1 }, limit: 300 })).map(present.user) });
}));
admin.patch("/users/:id/active", wrap(async (req, res) => {
  const { active } = check(req.body, { active: { type: "boolean", required: true } });
  const u = await db("users").get(req.params.id);
  if (!u) throw notFound("User not found");
  if (u._id === req.user._id) throw badRequest("You cannot deactivate yourself");
  res.json({ data: present.user(await db("users").update(u._id, { active })) });
}));
admin.get("/payments", wrap(async (_req, res) => res.json({ data: (await db("payments").find({ status: { $in: ["mismatch", "needs_review", "failed"] } }, { sort: { createdAt: -1 }, limit: 200 })).map(present.generic) })));
