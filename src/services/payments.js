import crypto from "node:crypto";
import { env } from "../config/env.js";
import { db, newId, now } from "../db/index.js";
import { badRequest, conflict, notFound } from "../utils/errors.js";
import * as paystack from "./paystack.js";
import { notify } from "./notify.js";
import { createTracking } from "./tracking.js";

export const newReference = () => `FWAN-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
const toKobo = (naira) => Math.round(Number(naira) * 100);

export async function initialize(offer, buyer) {
  const amountKobo = toKobo(offer.totalValue);       // amount always comes from the stored offer, never from the browser
  if (amountKobo < 100) throw badRequest("Offer total is too small to charge");
  // Re-use an open payment for the same offer so a buyer cannot double-pay.
  const open = await db("payments").findOne({ offerId: offer._id, status: "pending", mode: env.PAYMENT_MODE });
  if (open && now() < open.expiresAt) return publicInit(open);
  const reference = newReference();
  const base = { _id: newId(), reference, offerId: offer._id, buyerId: buyer._id, farmerId: offer.farmerId, amount: offer.totalValue, amountKobo, currency: "NGN", status: "pending", mode: env.PAYMENT_MODE, createdAt: now(), expiresAt: new Date(Date.now() + 30 * 60_000).toISOString() };
  if (env.PAYMENT_MODE === "paystack") {
    const data = await paystack.initializeTransaction({ email: buyer.email, amountKobo, reference, metadata: { offerId: offer._id, product: offer.product } });
    base.accessCode = data.access_code; base.authorizationUrl = data.authorization_url;
  }
  await db("payments").insert(base);
  return publicInit(base);
}

const publicInit = (p) => ({ reference: p.reference, amount: p.amount, amountKobo: p.amountKobo, currency: p.currency, mode: p.mode, accessCode: p.accessCode, authorizationUrl: p.authorizationUrl, expiresAt: p.expiresAt });

export async function verifyAndFinalize(reference) {
  const pay = await db("payments").findOne({ reference });
  if (!pay) throw notFound("Unknown payment reference");
  if (pay.status === "success") return { payment: pay, offer: await db("offers").get(pay.offerId), alreadyProcessed: true };
  if (pay.mode !== "paystack") throw badRequest("This reference belongs to a demo payment");
  const g = await paystack.verifyTransaction(reference);
  return finalize(pay, { status: g.status, amountKobo: g.amount, currency: g.currency, raw: { id: g.id, channel: g.channel, paid_at: g.paid_at } });
}

export async function mockConfirm(reference) {
  const pay = await db("payments").findOne({ reference });
  if (!pay) throw notFound("Unknown payment reference");
  if (pay.mode !== "mock") throw badRequest("Not a demo payment");
  return finalize(pay, { status: "success", amountKobo: pay.amountKobo, currency: "NGN", raw: { demo: true } });
}

export async function finalize(pay, g) {
  if (pay.status === "success") return { payment: pay, offer: await db("offers").get(pay.offerId), alreadyProcessed: true };
  if (g.status !== "success") {
    await db("payments").update(pay._id, { status: g.status === "abandoned" ? "abandoned" : "failed", updatedAt: now() });
    throw badRequest(`Payment was not successful (${g.status})`);
  }
  if (g.amountKobo !== pay.amountKobo || g.currency !== pay.currency) {
    await db("payments").update(pay._id, { status: "mismatch", updatedAt: now(), gateway: g.raw });
    throw conflict("Paid amount does not match the offer total. The payment has been flagged for review.");
  }
  const claimed = await db("payments").findOneAndUpdate({ _id: pay._id, status: "pending" }, { status: "success", paidAt: now(), gateway: g.raw });
  if (!claimed) return { payment: await db("payments").get(pay._id), offer: await db("offers").get(pay.offerId), alreadyProcessed: true };

  const paidAt = now();
  const offer = await db("offers").findOneAndUpdate({ _id: pay.offerId, status: "Accepted" },
    { status: "Paid", paymentStatus: "Paid", deliveryStatus: "Processing", paymentDate: paidAt, paymentReference: pay.reference });
  if (!offer) {
    await db("payments").update(pay._id, { status: "needs_review", note: "Money received but the offer was no longer in Accepted state" });
    throw conflict("Payment received but the offer is no longer payable. Support has been flagged to review/refund.");
  }
  const order = { _id: newId(), offerId: offer._id, listingId: offer.listingId, buyerId: offer.buyerId, farmerId: offer.farmerId, buyerName: offer.buyerName, product: offer.product, quantity: offer.quantity, amount: offer.totalValue, currency: "NGN", reference: pay.reference, status: "Paid", createdAt: paidAt, paidAt };
  await db("orders").insert(order);
  const final = await db("offers").update(offer._id, { orderId: order._id });
  const farmer = await db("users").get(offer.farmerId);
  await createTracking({ order, offer: final, farmer });
  await notify(offer.farmerId, { type: "payment", title: "Payment received", message: `${offer.buyerName} paid ₦${offer.totalValue.toLocaleString()} for ${offer.quantity} ${offer.product}. Please prepare the order for delivery.`, metadata: { offerId: offer._id, orderId: order._id } });
  await notify(offer.buyerId, { type: "payment", title: "Payment confirmed", message: `Your payment of ₦${offer.totalValue.toLocaleString()} for ${offer.product} was confirmed.`, metadata: { offerId: offer._id, orderId: order._id } });
  return { payment: await db("payments").get(pay._id), offer: final, order };
}
