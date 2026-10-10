import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { env } from "../config/env.js";
import { db, now } from "../db/index.js";
import { authRequired } from "../middleware/auth.js";
import { uploadLimiter } from "../middleware/security.js";
import { badRequest, notFound, wrap } from "../utils/errors.js";
import { check, PHONE } from "../utils/validate.js";
import * as present from "../utils/present.js";

const r = Router();

r.get("/me", authRequired, (req, res) => res.json({ data: present.user(req.user) }));

r.patch("/me", authRequired, wrap(async (req, res) => {
  const b = check(req.body, {
    name: { min: 2, max: 80 }, phone: { pattern: PHONE }, address: { max: 200 }, city: { max: 80 }, state: { max: 80 },
    bio: { max: 500 }, farmName: { max: 100 }, photoURL: { max: 500 },
    language: { enum: ["en", "ha", "yo", "ig"] }, nin: { max: 20 },
  });
  if ("role" in (req.body || {}) || "email" in (req.body || {})) throw badRequest("Role and email cannot be changed here");
  const user = await db("users").update(req.user._id, { ...b, updatedAt: now() });
  res.json({ data: present.user(user) });
}));

r.get("/:id/public", wrap(async (req, res) => {
  const u = await db("users").get(req.params.id);
  if (!u || u.active === false) throw notFound("User not found");
  res.json({ data: { id: u._id, name: u.name, role: u.role, photoURL: u.photoURL, city: u.city, state: u.state, farmName: u.farmName, bio: u.bio, memberSince: u.createdAt } });
}));

// ---- Image upload (replaces ImgBB; works offline). Body: { dataUrl: "data:image/png;base64,...." }
export const uploads = Router();
const SIGNS = [
  ["image/png", "png", [0x89, 0x50, 0x4e, 0x47]], ["image/jpeg", "jpg", [0xff, 0xd8, 0xff]],
  ["image/gif", "gif", [0x47, 0x49, 0x46, 0x38]], ["image/webp", "webp", [0x52, 0x49, 0x46, 0x46]],
];
export const uploadDir = path.join(env.DATA_DIR, "uploads");

uploads.post("/image", authRequired, uploadLimiter, wrap(async (req, res) => {
  const { dataUrl } = check(req.body, { dataUrl: { required: true, max: 8_000_000, trim: false } });
  const m = dataUrl.match(/^data:image\/[a-z+.-]+;base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!m) throw badRequest("Send the image as a base64 data URL");
  const buf = Buffer.from(m[1].replace(/\s/g, ""), "base64");
  if (buf.length > 5 * 1024 * 1024) throw badRequest("Image must be 5 MB or smaller");
  const kind = SIGNS.find(([, , sig]) => sig.every((b, i) => buf[i] === b));
  if (!kind) throw badRequest("Only PNG, JPEG, GIF or WebP images are allowed");
  fs.mkdirSync(uploadDir, { recursive: true });
  const name = `${crypto.randomBytes(12).toString("hex")}.${kind[1]}`;
  fs.writeFileSync(path.join(uploadDir, name), buf);
  const base = env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`;
  res.status(201).json({ data: { url: `${base}/uploads/${name}`, path: `/uploads/${name}`, size: buf.length, mime: kind[0] } });
}));

export default r;
