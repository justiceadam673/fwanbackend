import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

// Mock of Google's accounts:lookup endpoint.
const DB = { "tok-good": { localId: "fb1", email: "Kemi@Test.com", emailVerified: true }, "tok-unverified": { localId: "fb2", email: "kemi@test.com", emailVerified: false },
  "tok-other": { localId: "fb3", email: "someone@else.com", emailVerified: true }, "tok-disabled": { localId: "fb4", email: "kemi@test.com", emailVerified: true, disabled: true } };
let lastKey = "";
const mock = http.createServer((req, res) => {
  let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
    lastKey = new URL(req.url, "http://x").searchParams.get("key");
    const u = DB[JSON.parse(b).idToken];
    res.writeHead(u ? 200 : 400, { "Content-Type": "application/json" }); res.end(JSON.stringify(u ? { users: [u] } : { error: { message: "INVALID_ID_TOKEN" } }));
  });
}).listen(0);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fwan-fb-"));
Object.assign(process.env, { DB_DRIVER: "file", DATA_DIR: tmp, PAYMENT_MODE: "mock", AUTO_VERIFY_EMAIL: "false", VERIFICATION_METHOD: "firebase", EXPOSE_DEV_TOKENS: "false",
  FIREBASE_API_KEY: "web-key", FIREBASE_LOOKUP_URL: `http://127.0.0.1:${mock.address().port}/lookup`, NODE_ENV: "development" });

const { connectDB, closeDB } = await import("../src/db/index.js");
const { createApp } = await import("../src/app.js");
let server, base;
const api = async (m, u, b) => { const r = await fetch(base + u, { method: m, headers: { "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return { ...(await r.json().catch(() => ({}))), status: r.status }; };
before(async () => { await connectDB(); server = createApp().listen(0); base = `http://127.0.0.1:${server.address().port}`; });
after(async () => { server.close(); mock.close(); await closeDB(); fs.rmSync(tmp, { recursive: true, force: true }); });

const user = { name: "Kemi", email: "kemi@test.com", phone: "08011112222", password: "Passw0rd1", role: "buyer" };

test("register in firebase mode: no Express email, user waits for Firebase", async () => {
  const r = await api("POST", "/api/auth/register", user);
  assert.equal(r.status, 201); assert.equal(r.verification, "firebase"); assert.equal(r.emailSent, undefined);
  const l = await api("POST", "/api/auth/login", { email: user.email, password: user.password });
  assert.equal(l.status, 403); assert.equal(l.error.code, "email_not_verified"); assert.equal(l.error.details.method, "firebase");
  assert.equal((await api("POST", "/api/auth/resend-verification", { email: user.email })).status, 400);
});

test("Express refuses to trust an unverified, foreign, disabled or invalid Firebase token", async () => {
  assert.equal((await api("POST", "/api/auth/verify-with-firebase", { idToken: "tok-unverified" })).status, 403);
  assert.equal((await api("POST", "/api/auth/verify-with-firebase", { idToken: "tok-disabled" })).status, 403);
  assert.equal((await api("POST", "/api/auth/verify-with-firebase", { idToken: "tok-other" })).status, 404);   // verified email, but no FWAN account with it
  assert.equal((await api("POST", "/api/auth/verify-with-firebase", { idToken: "garbage" })).status, 401);
  assert.equal((await api("POST", "/api/auth/verify-with-firebase", {})).status, 400);
  assert.equal((await api("POST", "/api/auth/login", { email: user.email, password: user.password })).status, 403);   // still blocked
});

test("a verified Firebase user unlocks the matching Express account", async () => {
  const v = await api("POST", "/api/auth/verify-with-firebase", { idToken: "tok-good" });
  assert.equal(v.status, 200); assert.equal(lastKey, "web-key");
  const l = await api("POST", "/api/auth/login", { email: user.email, password: user.password, role: "buyer" });
  assert.equal(l.status, 200); assert.ok(l.token);
  assert.equal((await api("POST", "/api/auth/verify-with-firebase", { idToken: "tok-good" })).status, 200);   // idempotent
});
