import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const fresh = () => String(Date.now() - 60_000), stale = () => String(Date.now() - 3 * 3600_000);
const DB = {
  "tok-ife": { localId: "fbA", email: "ife@test.com", emailVerified: true, lastLoginAt: fresh() },
  "tok-ife-stale": { localId: "fbA", email: "ife@test.com", emailVerified: true, lastLoginAt: stale() },
  "tok-uche": { localId: "fbB", email: "uche@test.com", emailVerified: false, lastLoginAt: fresh() },
  "tok-nobody": { localId: "fbZ", email: "nobody@test.com", emailVerified: true, lastLoginAt: fresh() },
};
const mock = http.createServer((req, res) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { const u = typeof DB[JSON.parse(b).idToken] === "object" ? DB[JSON.parse(b).idToken] : null; res.writeHead(u ? 200 : 400); res.end(JSON.stringify(u ? { users: [{ ...u, lastLoginAt: u.lastLoginAt }] } : { error: {} })); }); }).listen(0);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fwan-mig-"));
Object.assign(process.env, { DB_DRIVER: "file", DATA_DIR: tmp, PAYMENT_MODE: "mock", AUTO_VERIFY_EMAIL: "false", VERIFICATION_METHOD: "firebase", MIGRATION_SECRET: "s3cret-migration-value", EXPOSE_DEV_TOKENS: "false",
  FIREBASE_API_KEY: "k", FIREBASE_LOOKUP_URL: `http://127.0.0.1:${mock.address().port}/lookup`, NODE_ENV: "development" });
const { connectDB, closeDB } = await import("../src/db/index.js");
const { createApp } = await import("../src/app.js");
let server, base;
const api = async (m, u, b, h = {}) => { const r = await fetch(base + u, { method: m, headers: { "Content-Type": "application/json", ...h }, body: b ? JSON.stringify(b) : undefined }); return { ...(await r.json().catch(() => ({}))), status: r.status }; };
before(async () => { await connectDB(); server = createApp().listen(0); base = `http://127.0.0.1:${server.address().port}`; });
after(async () => { server.close(); mock.close(); await closeDB(); fs.rmSync(tmp, { recursive: true, force: true }); });

const users = [
  { uid: "fbA", email: "Ife@Test.com", name: "Ife Farmer", phone: "08011112222", role: "farmer", emailVerified: true, createdAt: "2024-05-01T10:00:00Z" },
  { uid: "fbB", email: "uche@test.com", name: "Uche Buyer", phone: "08033334444", role: "buyer", emailVerified: false },
  { uid: "fbC", email: "norole@test.com", name: "No Role" },
  { uid: "fbD", email: "not-an-email", role: "buyer" },
];
const H = { "x-migration-secret": "s3cret-migration-value" };

test("import needs the secret (or an admin)", async () => {
  assert.equal((await api("POST", "/api/migration/import", { users })).status, 403);
  assert.equal((await api("POST", "/api/migration/import", { users }, { "x-migration-secret": "wrong" })).status, 403);
});

test("import creates accounts without passwords, skips bad rows, and is idempotent", async () => {
  const dry = await api("POST", "/api/migration/import", { users, dryRun: true }, H);
  assert.equal(dry.data.created, 2);
  const r = await api("POST", "/api/migration/import", { users }, H);
  assert.equal(r.status, 200); assert.equal(r.data.created, 2); assert.equal(r.data.skipped.length, 2);
  const again = await api("POST", "/api/migration/import", { users }, H);
  assert.equal(again.data.created, 0); assert.equal(again.data.unchanged, 2);
});

test("imported user must claim the account; login explains it", async () => {
  const l = await api("POST", "/api/auth/login", { email: "ife@test.com", password: "Passw0rd1" });
  assert.equal(l.status, 403); assert.equal(l.error.code, "password_setup_required");
});

test("claim: stale, unknown and invalid tokens are refused; fresh token sets the password once", async () => {
  const c = (idToken, password = "Passw0rd1") => api("POST", "/api/auth/claim-with-firebase", { idToken, password });
  assert.equal((await c("tok-ife-stale")).status, 401);
  assert.equal((await c("tok-nobody")).status, 404);
  assert.equal((await c("garbage")).status, 401);
  assert.equal((await c("tok-ife", "weak")).status, 400);
  assert.equal((await c("tok-ife")).status, 200);
  assert.equal((await c("tok-ife")).status, 409);
  const l = await api("POST", "/api/auth/login", { email: "ife@test.com", password: "Passw0rd1", role: "farmer" });
  assert.equal(l.status, 200); assert.ok(l.token);
  assert.equal((await api("POST", "/api/auth/login", { email: "ife@test.com", password: "nope" })).status, 401);
});

test("claimed but unverified user still has to verify the email", async () => {
  assert.equal((await api("POST", "/api/auth/claim-with-firebase", { idToken: "tok-uche", password: "Passw0rd1" })).status, 200);
  const l = await api("POST", "/api/auth/login", { email: "uche@test.com", password: "Passw0rd1" });
  assert.equal(l.status, 403); assert.equal(l.error.code, "email_not_verified");
});
