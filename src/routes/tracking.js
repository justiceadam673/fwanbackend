import { Router } from "express";
import { db } from "../db/index.js";
import { authRequired, requireRole } from "../middleware/auth.js";
import { forbidden, notFound, wrap } from "../utils/errors.js";
import { check } from "../utils/validate.js";
import * as present from "../utils/present.js";
import * as tracking from "../services/tracking.js";

const r = Router();
r.use(authRequired);

async function load(req) {
  const t = await db("tracking").get(req.params.orderId);
  if (!t) throw notFound("No tracking record for this order (only paid orders are tracked)");
  if (![t.buyerId, t.farmerId].includes(req.user._id) && req.user.role !== "admin") throw forbidden();
  return t;
}
const out = (t) => ({ ...present.generic(t), simulating: tracking.isSimulating(t._id), position: { lat: t.position[0], lng: t.position[1] }, origin: { lat: t.origin[0], lng: t.origin[1] }, destination: { lat: t.destination[0], lng: t.destination[1] } });

r.get("/", wrap(async (req, res) => {
  const f = req.user.role === "farmer" ? { farmerId: req.user._id } : req.user.role === "buyer" ? { buyerId: req.user._id } : {};
  res.json({ data: (await db("tracking").find(f, { sort: { updatedAt: -1 }, limit: 50 })).map(out) });
}));

r.get("/:orderId", wrap(async (req, res) => res.json({ data: out(await load(req)) })));

// Real GPS: the farmer's phone (or an admin tool) posts positions. "source" becomes "gps".
r.post("/:orderId/location", requireRole("farmer", "admin"), wrap(async (req, res) => {
  const t = await load(req);
  const b = check(req.body, { lat: { type: "number", required: true, min: -90, max: 90 }, lng: { type: "number", required: true, min: -180, max: 180 } });
  tracking.stopSimulation(t._id);
  res.json({ data: out(await tracking.recordPosition(t._id, b, "gps")) });
}));

// Demo: moves a vehicle between the farm and the delivery town. Marked source:"simulated" so it is never mistaken for GPS.
r.post("/:orderId/simulate/start", requireRole("farmer", "admin"), wrap(async (req, res) => {
  const t = await load(req);
  res.json({ data: out(await tracking.startSimulation(t._id)) });
}));
r.post("/:orderId/simulate/stop", requireRole("farmer", "admin"), wrap(async (req, res) => {
  const t = await load(req);
  tracking.stopSimulation(t._id);
  res.json({ data: out(await db("tracking").get(t._id)) });
}));

export default r;
