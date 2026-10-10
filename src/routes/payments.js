import { Router } from "express";
import { env } from "../config/env.js";
import { db } from "../db/index.js";
import { authRequired, requireRole } from "../middleware/auth.js";
import { badRequest, conflict, forbidden, notFound, wrap } from "../utils/errors.js";
import { check } from "../utils/validate.js";
import * as present from "../utils/present.js";
import * as payments from "../services/payments.js";
import { validSignature } from "../services/paystack.js";

const r = Router();

// Paystack calls this server-to-server. Signature is verified with HMAC-SHA512 of the raw body.
r.post("/webhook", wrap(async (req, res) => {
  if (!validSignature(req.rawBody, req.headers["x-paystack-signature"])) return res.status(401).end();
  const ev = req.body || {};
  if (ev.event === "charge.success" && ev.data?.reference) {
    try { await payments.verifyAndFinalize(ev.data.reference); } catch (e) { console.warn(`[webhook] ${ev.data.reference}: ${e.message}`); }
  }
  res.sendStatus(200);
}));

r.use(authRequired);

r.get("/config", (_req, res) => res.json({ data: { mode: env.PAYMENT_MODE, currency: "NGN" } }));

r.post("/initialize", requireRole("buyer"), wrap(async (req, res) => {
  const { offerId } = check(req.body, { offerId: { required: true, max: 40 } });
  const offer = await db("offers").get(offerId);
  if (!offer) throw notFound("Offer not found");
  if (offer.buyerId !== req.user._id) throw forbidden();
  if (offer.status !== "Accepted") throw conflict(offer.status === "Paid" ? "This offer is already paid" : "Only accepted offers can be paid");
  res.json({ data: await payments.initialize(offer, req.user) });
}));

// Called by the browser after the Paystack pop-up closes. The server asks Paystack directly; the browser's word is never trusted.
r.get("/verify/:reference", wrap(async (req, res) => {
  const pay = await db("payments").findOne({ reference: req.params.reference });
  if (!pay) throw notFound("Unknown payment reference");
  if (pay.buyerId !== req.user._id && pay.farmerId !== req.user._id && req.user.role !== "admin") throw forbidden();
  const out = await payments.verifyAndFinalize(req.params.reference);
  res.json({ data: { payment: present.generic(out.payment), offer: present.offer(out.offer), order: present.generic(out.order), alreadyProcessed: !!out.alreadyProcessed } });
}));

// Demo/offline only: simulates a successful card payment.
r.post("/mock/confirm", requireRole("buyer"), wrap(async (req, res) => {
  if (env.PAYMENT_MODE !== "mock") throw badRequest("Demo payments are disabled");
  const { reference } = check(req.body, { reference: { required: true, max: 80 } });
  const pay = await db("payments").findOne({ reference });
  if (!pay || pay.buyerId !== req.user._id) throw notFound("Unknown payment reference");
  const out = await payments.mockConfirm(reference);
  res.json({ data: { payment: present.generic(out.payment), offer: present.offer(out.offer), order: present.generic(out.order), alreadyProcessed: !!out.alreadyProcessed } });
}));

r.get("/mine", wrap(async (req, res) => {
  const f = req.user.role === "farmer" ? { farmerId: req.user._id } : req.user.role === "buyer" ? { buyerId: req.user._id } : {};
  res.json({ data: (await db("payments").find(f, { sort: { createdAt: -1 }, limit: 100 })).map(present.generic) });
}));

export default r;
