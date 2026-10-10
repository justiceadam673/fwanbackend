import { Router } from "express";
import { db } from "../db/index.js";
import { authRequired } from "../middleware/auth.js";
import { forbidden, notFound, wrap } from "../utils/errors.js";
import * as present from "../utils/present.js";

const r = Router();
r.use(authRequired);

r.get("/", wrap(async (req, res) => {
  const f = { userId: req.user._id };
  if (req.query.unread === "true") f.read = false;
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const [items, unread] = await Promise.all([db("notifications").find(f, { sort: { createdAt: -1 }, limit }), db("notifications").count({ userId: req.user._id, read: false })]);
  res.json({ data: items.map(present.generic), meta: { unread } });
}));

r.get("/unread-count", wrap(async (req, res) => res.json({ data: { unread: await db("notifications").count({ userId: req.user._id, read: false }) } })));

r.post("/read-all", wrap(async (req, res) => {
  const items = await db("notifications").find({ userId: req.user._id, read: false });
  for (const n of items) await db("notifications").update(n._id, { read: true });
  res.json({ data: { updated: items.length } });
}));

r.patch("/:id/read", wrap(async (req, res) => {
  const n = await db("notifications").get(req.params.id);
  if (!n) throw notFound();
  if (n.userId !== req.user._id) throw forbidden();
  res.json({ data: present.generic(await db("notifications").update(n._id, { read: true })) });
}));

r.delete("/:id", wrap(async (req, res) => {
  const n = await db("notifications").get(req.params.id);
  if (!n) throw notFound();
  if (n.userId !== req.user._id) throw forbidden();
  await db("notifications").remove(n._id);
  res.json({ data: { deleted: true } });
}));

export default r;
