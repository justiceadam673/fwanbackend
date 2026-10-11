import { Router } from "express";
import crypto from "node:crypto";
import { env } from "../config/env.js";
import { userFromToken } from "../middleware/auth.js";
import { forbidden, unauthorized, wrap, badRequest } from "../utils/errors.js";
import { importUsers } from "../services/migration.js";

const r = Router();
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

// POST /api/migration/import  { users: [...], dryRun?: true }  with header x-migration-secret, or an admin bearer token.
r.post("/import", wrap(async (req, res) => {
  const secret = req.headers["x-migration-secret"];
  let allowed = !!env.MIGRATION_SECRET && !!secret && same(secret, env.MIGRATION_SECRET);
  if (!allowed && req.headers.authorization?.startsWith("Bearer ")) {
    try { allowed = (await userFromToken(req.headers.authorization.slice(7))).role === "admin"; } catch { throw unauthorized(); }
  }
  if (!allowed) throw forbidden("Migration secret or admin sign-in required");
  if (!Array.isArray(req.body?.users) || !req.body.users.length) throw badRequest("Send { users: [ ... ] }");
  if (req.body.users.length > 1000) throw badRequest("Send at most 1000 users per request");
  res.json({ data: await importUsers(req.body.users, { dryRun: req.body.dryRun === true }) });
}));

export default r;
