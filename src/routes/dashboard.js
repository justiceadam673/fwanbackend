import { Router } from "express";
import { db } from "../db/index.js";
import { authRequired } from "../middleware/auth.js";
import { wrap } from "../utils/errors.js";
import * as present from "../utils/present.js";

const r = Router();
r.use(authRequired);
const sum = (a, k) => a.reduce((s, x) => s + (Number(x[k]) || 0), 0);

r.get("/", wrap(async (req, res) => {
  const u = req.user;
  if (u.role === "farmer") {
    const [listings, offers, orders] = await Promise.all([db("listings").find({ farmerId: u._id }), db("offers").find({ farmerId: u._id }, { sort: { createdAt: -1 } }), db("orders").find({ farmerId: u._id })]);
    const by = (s) => offers.filter((o) => o.status === s).length;
    return res.json({ data: {
      role: "farmer", listings: listings.length, activeListings: listings.filter((l) => l.status === "In Stock").length,
      offers: offers.length, pendingOffers: by("Pending"), counteredOffers: by("Countered"), acceptedAwaitingPayment: by("Accepted"), paidOrders: orders.length,
      completedOrders: by("Completed"), totalRevenue: sum(orders, "amount"), soldQuantity: sum(listings, "soldQuantity"),
      recentOffers: offers.slice(0, 5).map(present.offer),
    } });
  }
  if (u.role === "buyer") {
    const [offers, orders] = await Promise.all([db("offers").find({ buyerId: u._id }, { sort: { createdAt: -1 } }), db("orders").find({ buyerId: u._id })]);
    const by = (s) => offers.filter((o) => o.status === s).length;
    return res.json({ data: {
      role: "buyer", offers: offers.length, pendingOffers: by("Pending"), counteredOffers: by("Countered"), awaitingPayment: by("Accepted"),
      paidOrders: orders.length, completedOrders: by("Completed"), totalSpent: sum(orders, "amount"), recentOffers: offers.slice(0, 5).map(present.offer),
    } });
  }
  res.json({ data: { role: u.role } });
}));

export default r;
