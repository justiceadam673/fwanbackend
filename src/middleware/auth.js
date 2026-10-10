import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { db } from "../db/index.js";
import { unauthorized, forbidden } from "../utils/errors.js";

export const signToken = (user) =>
  jwt.sign({ sub: user._id, role: user.role }, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN });

export async function userFromToken(token) {
  const payload = jwt.verify(token, env.JWT_SECRET);
  const user = await db("users").get(payload.sub);
  if (!user || user.active === false) throw unauthorized("Account not found or deactivated");
  return user;
}

function bearer(req) {
  const h = req.headers.authorization || "";
  if (h.startsWith("Bearer ")) return h.slice(7);
  return null;
}

export const authRequired = async (req, _res, next) => {
  try {
    const t = bearer(req);
    if (!t) throw unauthorized();
    req.user = await userFromToken(t);
    next();
  } catch (e) {
    next(e.name === "JsonWebTokenError" || e.name === "TokenExpiredError" ? unauthorized("Invalid or expired session, please sign in again") : e);
  }
};

export const authOptional = async (req, _res, next) => {
  try {
    const t = bearer(req);
    if (t) req.user = await userFromToken(t);
  } catch { /* anonymous */ }
  next();
};

export const requireRole = (...roles) => (req, _res, next) =>
  roles.includes(req.user?.role) ? next() : next(forbidden(`This action is for ${roles.join(" or ")} accounts`));

export const requireVerified = (req, _res, next) =>
  req.user?.emailVerified ? next() : next(forbidden("Please verify your email address first"));
