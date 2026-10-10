import rateLimit from "express-rate-limit";
import { badRequest } from "../utils/errors.js";

// Reject MongoDB operator injection ({"$gt": ""}) and dotted keys in any request payload.
function scan(value, path = "") {
  if (Array.isArray(value)) return value.forEach((v, i) => scan(v, `${path}[${i}]`));
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (k.startsWith("$") || k.includes(".")) throw badRequest(`Invalid field name "${k}"`);
      scan(v, `${path}.${k}`);
    }
  }
}
export const noSqlGuard = (req, _res, next) => {
  try { scan(req.body); scan(req.query); scan(req.params); next(); } catch (e) { next(e); }
};

const limiter = (windowMs, limit, message) =>
  rateLimit({ windowMs, limit, standardHeaders: true, legacyHeaders: false, message: { error: { code: "rate_limited", message } } });

export const apiLimiter = limiter(60_000, 300, "Too many requests, please slow down.");
export const authLimiter = limiter(15 * 60_000, 40, "Too many sign-in attempts. Try again in a few minutes.");
export const uploadLimiter = limiter(60_000, 20, "Too many uploads. Please wait a moment.");
