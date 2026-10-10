import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { env } from "../config/env.js";
import { db, newId, now } from "../db/index.js";
import { authRequired, signToken } from "../middleware/auth.js";
import { authLimiter } from "../middleware/security.js";
import { badRequest, forbidden, unauthorized, wrap } from "../utils/errors.js";
import { check, EMAIL, PHONE } from "../utils/validate.js";
import { sendMail } from "../services/mailer.js";
import { notify } from "../services/notify.js";
import * as present from "../utils/present.js";

const r = Router();
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const token = () => crypto.randomBytes(32).toString("hex");
const MAX_FAILS = 5, LOCK_MS = 15 * 60_000;

const PASSWORD_RULE = { type: "string", required: true, min: 8, max: 72 };
function strongEnough(pw) {
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) throw badRequest("Validation failed", { password: "must contain letters and numbers" });
}

async function issueVerification(user) {
  const t = token();
  await db("users").update(user._id, { verifyTokenHash: sha(t), verifyTokenExpires: new Date(Date.now() + 24 * 3600_000).toISOString() });
  const link = `${env.FRONTEND_URL}/verify-email?token=${t}`;
  await sendMail({ to: user.email, subject: "Verify your FWAN account", text: `Hello ${user.name},\n\nVerify your email: ${link}\n\nThis link expires in 24 hours.` });
  return t;
}

r.post("/register", authLimiter, wrap(async (req, res) => {
  const b = check(req.body, {
    name: { required: true, min: 2, max: 80 },
    email: { required: true, lower: true, max: 120, pattern: EMAIL, patternMessage: "must be a valid email" },
    phone: { required: true, pattern: PHONE, patternMessage: "must be a valid phone number" },
    password: PASSWORD_RULE,
    role: { required: true, enum: ["farmer", "buyer"] },
  });
  strongEnough(b.password);
  if (await db("users").findOne({ email: b.email })) throw badRequest("An account with this email already exists", { email: "already registered" });
  const user = {
    _id: newId(), name: b.name, email: b.email, phone: b.phone, role: b.role, passwordHash: await bcrypt.hash(b.password, 10),
    emailVerified: env.AUTO_VERIFY_EMAIL, active: true, language: "en", photoURL: "", createdAt: now(), updatedAt: now(),
  };
  await db("users").insert(user);
  const out = { user: present.user(user), message: user.emailVerified ? "Account created. You can sign in now." : "Account created. Check your email to verify it before signing in." };
  if (!user.emailVerified) { const t = await issueVerification(user); if (env.EXPOSE_DEV_TOKENS) out.devVerifyToken = t; }
  await notify(user._id, { type: "welcome", title: "Welcome to FWAN", message: user.role === "farmer" ? "List your produce and start receiving offers from buyers." : "Browse fresh produce from farmers and make your first offer." });
  res.status(201).json(out);
}));

r.post("/login", authLimiter, wrap(async (req, res) => {
  const b = check(req.body, { email: { required: true, lower: true }, password: { required: true, max: 72 }, role: { enum: ["farmer", "buyer", "admin"] } });
  const user = await db("users").findOne({ email: b.email });
  if (user?.lockedUntil && user.lockedUntil > now()) throw forbidden("Too many failed attempts. Try again later.");
  const ok = user && (await bcrypt.compare(b.password, user.passwordHash));
  if (!ok) {
    if (user) {
      const fails = (user.failedLogins || 0) + 1;
      await db("users").update(user._id, fails >= MAX_FAILS ? { failedLogins: 0, lockedUntil: new Date(Date.now() + LOCK_MS).toISOString() } : { failedLogins: fails });
    }
    throw unauthorized("Incorrect email or password");
  }
  if (user.active === false) throw forbidden("This account has been deactivated");
  if (b.role && user.role !== b.role) throw forbidden(`This account is registered as a ${user.role}. Use the ${user.role} sign-in page.`);
  if (!user.emailVerified) throw new (await import("../utils/errors.js")).HttpError(403, "Please verify your email before signing in", "email_not_verified");
  await db("users").update(user._id, { failedLogins: 0, lockedUntil: null, lastLoginAt: now() });
  res.json({ token: signToken(user), user: present.user(user) });
}));

r.get("/me", authRequired, (req, res) => res.json({ user: present.user(req.user) }));

r.post("/verify-email", wrap(async (req, res) => {
  const { token: t } = check(req.body, { token: { required: true, max: 200 } });
  const user = await db("users").findOne({ verifyTokenHash: sha(t) });
  if (!user || user.verifyTokenExpires < now()) throw badRequest("Verification link is invalid or has expired");
  await db("users").update(user._id, { emailVerified: true, verifyTokenHash: null, verifyTokenExpires: null });
  res.json({ message: "Email verified. You can sign in now." });
}));

r.post("/resend-verification", authLimiter, wrap(async (req, res) => {
  const { email } = check(req.body, { email: { required: true, lower: true } });
  const user = await db("users").findOne({ email });
  const out = { message: "If that account exists and is unverified, a new link has been sent." };
  if (user && !user.emailVerified) { const t = await issueVerification(user); if (env.EXPOSE_DEV_TOKENS) out.devVerifyToken = t; }
  res.json(out);
}));

r.post("/forgot-password", authLimiter, wrap(async (req, res) => {
  const { email } = check(req.body, { email: { required: true, lower: true } });
  const user = await db("users").findOne({ email });
  const out = { message: "If that email is registered, a reset link has been sent." };
  if (user) {
    const t = token();
    await db("users").update(user._id, { resetTokenHash: sha(t), resetTokenExpires: new Date(Date.now() + 3600_000).toISOString() });
    await sendMail({ to: user.email, subject: "Reset your FWAN password", text: `Reset your password: ${env.FRONTEND_URL}/reset-password?token=${t}\n\nThe link expires in 1 hour.` });
    if (env.EXPOSE_DEV_TOKENS) out.devResetToken = t;
  }
  res.json(out);
}));

r.post("/reset-password", authLimiter, wrap(async (req, res) => {
  const b = check(req.body, { token: { required: true, max: 200 }, password: PASSWORD_RULE });
  strongEnough(b.password);
  const user = await db("users").findOne({ resetTokenHash: sha(b.token) });
  if (!user || user.resetTokenExpires < now()) throw badRequest("Reset link is invalid or has expired");
  await db("users").update(user._id, { passwordHash: await bcrypt.hash(b.password, 10), resetTokenHash: null, resetTokenExpires: null, failedLogins: 0, lockedUntil: null });
  res.json({ message: "Password changed. You can sign in now." });
}));

r.post("/change-password", authRequired, wrap(async (req, res) => {
  const b = check(req.body, { currentPassword: { required: true, max: 72 }, newPassword: PASSWORD_RULE });
  strongEnough(b.newPassword);
  if (!(await bcrypt.compare(b.currentPassword, req.user.passwordHash))) throw unauthorized("Current password is incorrect");
  await db("users").update(req.user._id, { passwordHash: await bcrypt.hash(b.newPassword, 10), updatedAt: now() });
  res.json({ message: "Password updated" });
}));

export default r;
