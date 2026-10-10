import { Router } from "express";
import { db } from "../db/index.js";
import { authRequired } from "../middleware/auth.js";
import { forbidden, notFound, wrap } from "../utils/errors.js";
import * as present from "../utils/present.js";

const r = Router();
r.use(authRequired);

r.get("/", wrap(async (req, res) => {
  const f = req.user.role === "farmer" ? { farmerId: req.user._id } : req.user.role === "buyer" ? { buyerId: req.user._id } : {};
  const limit = Math.min(parseInt(req.query.limit) || 100, 300);
  res.json({ data: (await db("orders").find(f, { sort: { paidAt: -1 }, limit })).map(present.generic) });
}));

r.get("/:id", wrap(async (req, res) => {
  const o = await db("orders").get(req.params.id);
  if (!o) throw notFound("Order not found");
  if (![o.buyerId, o.farmerId].includes(req.user._id) && req.user.role !== "admin") throw forbidden();
  res.json({ data: present.generic(o) });
}));

export default r;
