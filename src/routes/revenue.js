import { Router } from "express";
import { db, newId, now } from "../db/index.js";
import { authRequired, requireRole } from "../middleware/auth.js";
import { badRequest, forbidden, notFound, wrap } from "../utils/errors.js";
import { check } from "../utils/validate.js";
import * as present from "../utils/present.js";

const r = Router();
r.use(authRequired);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Monthly revenue from verified paid orders (+ optional manual entries), computed on the server.
r.get("/summary", requireRole("farmer"), wrap(async (req, res) => {
  const year = parseInt(req.query.year) || new Date().getFullYear();
  const orders = await db("orders").find({ farmerId: req.user._id });
  const manual = await db("revenue").find({ userId: req.user._id });
  const months = MONTHS.map((m, i) => ({ month: m, monthIndex: i + 1, orders: 0, manual: 0, total: 0, orderCount: 0 }));
  for (const o of orders) { const d = new Date(o.paidAt); if (d.getFullYear() === year) { const m = months[d.getMonth()]; m.orders += o.amount; m.orderCount++; } }
  for (const e of manual) if (Number(e.year) === year && e.monthIndex >= 1 && e.monthIndex <= 12) months[e.monthIndex - 1].manual += e.amount;
  months.forEach((m) => (m.total = Math.round((m.orders + m.manual) * 100) / 100));
  const totalFromOrders = months.reduce((a, m) => a + m.orders, 0), totalManual = months.reduce((a, m) => a + m.manual, 0);
  res.json({ data: { year, months, totals: { orders: totalFromOrders, manual: totalManual, all: totalFromOrders + totalManual }, currency: "NGN" } });
}));

r.get("/", requireRole("farmer"), wrap(async (req, res) => {
  res.json({ data: (await db("revenue").find({ userId: req.user._id }, { sort: { createdAt: -1 } })).map(present.generic) });
}));

r.post("/", requireRole("farmer"), wrap(async (req, res) => {
  const b = check(req.body, {
    month: { required: true, max: 12 }, year: { type: "number", required: true, min: 2000, max: 2100, int: true },
    amount: { type: "number", required: true, min: 0 }, note: { max: 200 },
  });
  const idx = MONTHS.findIndex((m) => m.toLowerCase() === b.month.slice(0, 3).toLowerCase()) + 1 || Number(b.month);
  if (!(idx >= 1 && idx <= 12)) throw badRequest("Month must be a name like 'Mar' or a number 1-12");
  const e = { _id: newId(), userId: req.user._id, month: MONTHS[idx - 1], monthIndex: idx, year: b.year, amount: b.amount, note: b.note || "", source: "manual", createdAt: now() };
  await db("revenue").insert(e);
  res.status(201).json({ data: present.generic(e) });
}));

r.delete("/:id", requireRole("farmer"), wrap(async (req, res) => {
  const e = await db("revenue").get(req.params.id);
  if (!e) throw notFound();
  if (e.userId !== req.user._id) throw forbidden();
  await db("revenue").remove(e._id);
  res.json({ data: { deleted: true } });
}));

export default r;
