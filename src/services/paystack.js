import crypto from "node:crypto";
import { env } from "../config/env.js";
import { HttpError } from "../utils/errors.js";

const BASE = "https://api.paystack.co";

async function call(path, options = {}) {
  if (!env.PAYSTACK_SECRET_KEY) throw new HttpError(503, "Payments are not configured on the server", "payments_unavailable");
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...options,
      headers: { Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`, "Content-Type": "application/json", ...(options.headers || {}) },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    throw new HttpError(502, "Could not reach Paystack. Check your internet connection.", "gateway_unreachable");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.status === false) throw new HttpError(502, body.message || "Paystack request failed", "gateway_error");
  return body.data;
}

export const initializeTransaction = ({ email, amountKobo, reference, metadata }) =>
  call("/transaction/initialize", {
    method: "POST",
    body: JSON.stringify({
      email, amount: amountKobo, reference, currency: "NGN", metadata,
      ...(env.PAYSTACK_CALLBACK_URL ? { callback_url: env.PAYSTACK_CALLBACK_URL } : {}),
    }),
  });

export const verifyTransaction = (reference) => call(`/transaction/verify/${encodeURIComponent(reference)}`);

export function validSignature(rawBody, signature) {
  if (!env.PAYSTACK_SECRET_KEY || !signature || !rawBody) return false;
  const hash = crypto.createHmac("sha512", env.PAYSTACK_SECRET_KEY).update(rawBody).digest("hex");
  const a = Buffer.from(hash), b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
