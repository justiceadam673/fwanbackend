import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { env } from "../config/env.js";
import { db, newId, now } from "../db/index.js";
import { authRequired, signToken } from "../middleware/auth.js";
import { authLimiter } from "../middleware/security.js";
import { badRequest, forbidden, unauthorized, wrap, HttpError } from "../utils/errors.js";
import { check, EMAIL, PHONE } from "../utils/validate.js";
import { sendMail } from "../services/mailer.js";
import * as tpl from "../services/emailTemplates.js";
import { lookupFirebaseUser } from "../services/firebaseAuth.js";
const sendsOwnEmail = () => env.VERIFICATION_METHOD !== "firebase";
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

const baseOf = (req) => env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`;
const COOLDOWN_MS = 60_000;

async function issueVerification(user, req) {
  const t = token();
  await db("users").update(user._id, { verifyTokenHash: sha(t), verifyTokenExpires: new Date(Date.now() + 24 * 3600_000).toISOString(), verifySentAt: now() });
  const link = `${baseOf(req)}/api/auth/verify-email?token=${t}`;
  const mail = await sendMail({ to: user.email, ...tpl.verifyEmail({ name: user.name, link }) });
  return { t, mail };
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
  out.verification = user.emailVerified ? "not_needed" : env.VERIFICATION_METHOD;
  if (user.emailVerified) out.token = signToken(user);   // sign in immediately after registering
  if (!user.emailVerified && !sendsOwnEmail()) out.message = "Account created. Verify your email using the link Firebase sends you, then sign in.";
  if (!user.emailVerified && sendsOwnEmail()) { const { t, mail } = await issueVerification(user, req); out.emailSent = mail.sent; if (!mail.sent) out.message = "Account created, but the verification email could not be sent. Use 'Resend verification email'."; if (env.EXPOSE_DEV_TOKENS) out.devVerifyToken = t; }
  await notify(user._id, { type: "welcome", title: "Welcome to FWAN", message: user.role === "farmer" ? "List your produce and start receiving offers from buyers." : "Browse fresh produce from farmers and make your first offer." });
  res.status(201).json(out);
}));

r.post("/login", authLimiter, wrap(async (req, res) => {
  const b = check(req.body, { email: { required: true, lower: true }, password: { required: true, max: 72 }, role: { enum: ["farmer", "buyer", "admin"] } });
  const user = await db("users").findOne({ email: b.email });
  if (user?.lockedUntil && user.lockedUntil > now()) throw forbidden("Too many failed attempts. Try again later.");
  if (user && !user.passwordHash) throw new HttpError(403, "Your account was moved from the old system. Sign in once to finish setting it up.", "password_setup_required");
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
  if (!user.emailVerified && env.REQUIRE_EMAIL_VERIFICATION) throw new HttpError(403, "Please verify your email before signing in", "email_not_verified", { method: env.VERIFICATION_METHOD });
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
  if (!sendsOwnEmail()) throw badRequest("Verification emails are sent by Firebase. Request the new link from Firebase (sendEmailVerification).");
  if (user && !user.emailVerified) {
    if (user.verifySentAt && Date.now() - new Date(user.verifySentAt).getTime() < COOLDOWN_MS) throw new HttpError(429, "Please wait a minute before requesting another email", "cooldown");
    const { t, mail } = await issueVerification(user, req); out.emailSent = mail.sent;
    if (env.EXPOSE_DEV_TOKENS) out.devVerifyToken = t;
  }
  res.json(out);
}));

// Link target from the email. Works without any front-end page: verifies, then shows a result page with a button back to the app.
r.get("/verify-email", wrap(async (req, res) => {
  const t = String(req.query.token || "");
  const user = t ? await db("users").findOne({ verifyTokenHash: sha(t) }) : null;
  const ok = !!user && user.verifyTokenExpires >= now();
  if (ok) await db("users").update(user._id, { emailVerified: true, verifyTokenHash: null, verifyTokenExpires: null });
  res.status(ok ? 200 : 400).type("html").send(tpl.resultPage({
    ok, title: ok ? "Email verified" : "Link invalid or expired",
    message: ok ? "Your email address is confirmed. You can now sign in to FWAN." : "This verification link is invalid, already used, or has expired. Sign in and request a new one.",
    continueUrl: env.FRONTEND_URL }));
}));

// Firebase proves the email; Express only records the result. Body: { idToken } from firebase auth user.getIdToken().
r.post("/verify-with-firebase", authLimiter, wrap(async (req, res) => {
  if (env.VERIFICATION_METHOD === "email") throw badRequest("Firebase verification is turned off (VERIFICATION_METHOD=email)");
  const { idToken } = check(req.body, { idToken: { required: true, max: 5000, trim: false } });
  const fb = await lookupFirebaseUser(idToken);
  if (fb.disabled) throw forbidden("This Firebase account is disabled");
  if (!fb.emailVerified) throw forbidden("Your email is not verified yet. Click the link Firebase emailed you, then try again.");
  const user = await db("users").findOne({ email: fb.email });
  if (!user) throw new HttpError(404, "No FWAN account uses this email. Register first.", "not_found");
  if (!user.emailVerified) await db("users").update(user._id, { emailVerified: true, verifiedVia: "firebase", verifyTokenHash: null, verifyTokenExpires: null });
  res.json({ message: "Email verified. You can sign in now." });
}));

// Finish setting up an account imported from Firebase: Firebase has just checked the password, the client sends it so Express can store its own hash.
r.post("/claim-with-firebase", authLimiter, wrap(async (req, res) => {
  const b = check(req.body, { idToken: { required: true, max: 5000, trim: false }, password: PASSWORD_RULE });
  const fb = await lookupFirebaseUser(b.idToken);
  if (fb.disabled) throw forbidden("This Firebase account is disabled");
  if (Date.now() - fb.lastLoginAt > 15 * 60_000) throw unauthorized("Please sign in again and retry right away");
  const user = await db("users").findOne({ email: fb.email });
  if (!user) throw new HttpError(404, "No FWAN account uses this email", "not_found");
  if (user.passwordHash) throw new HttpError(409, "This account is already set up. Sign in normally.", "already_claimed");
  await db("users").update(user._id, { passwordHash: await bcrypt.hash(b.password, 10), emailVerified: user.emailVerified || fb.emailVerified, firebaseUid: user.firebaseUid || fb.uid, updatedAt: now() });
  res.json({ message: "Account set up. You can sign in now." });
}));

r.post("/forgot-password", authLimiter, wrap(async (req, res) => {
  const { email } = check(req.body, { email: { required: true, lower: true } });
  const user = await db("users").findOne({ email });
  const out = { message: "If that email is registered, a reset link has been sent." };
  if (user) {
    const t = token();
    await db("users").update(user._id, { resetTokenHash: sha(t), resetTokenExpires: new Date(Date.now() + 3600_000).toISOString() });
    await sendMail({ to: user.email, ...tpl.resetPassword({ name: user.name, link: `${baseOf(req)}/api/auth/reset-password?token=${t}` }) });
    if (env.EXPOSE_DEV_TOKENS) out.devResetToken = t;
  }
  res.json(out);
}));

// Link target from the reset email: a small form page served by the backend (no front-end page needed).
r.get("/reset-password", (req, res) =>
  res.type("html").send(tpl.resetFormPage({ token: String(req.query.token || ""), apiPath: "/api/auth/reset-password", continueUrl: env.FRONTEND_URL })));

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
