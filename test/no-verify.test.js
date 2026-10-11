import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fwan-nv-"));
Object.assign(process.env, { DB_DRIVER: "file", DATA_DIR: tmp, PAYMENT_MODE: "mock", REQUIRE_EMAIL_VERIFICATION: "false", MIGRATION_SECRET: "migration-secret-value", NODE_ENV: "development" });
const { connectDB, closeDB } = await import("../src/db/index.js");
const { createApp } = await import("../src/app.js");
let server, base;
const api = async (m, u, b, h = {}) => { const r = await fetch(base + u, { method: m, headers: { "Content-Type": "application/json", ...h }, body: b ? JSON.stringify(b) : undefined }); return { ...(await r.json().catch(() => ({}))), status: r.status }; };
before(async () => { await connectDB(); server = createApp().listen(0); base = `http://127.0.0.1:${server.address().port}`; });
after(async () => { server.close(); await closeDB(); fs.rmSync(tmp, { recursive: true, force: true }); });

test("register returns a session and signing in works immediately, with no email step", async () => {
  const r = await api("POST", "/api/auth/register", { name: "Tolu", email: "tolu@test.com", phone: "08011112222", password: "Passw0rd1", role: "buyer" });
  assert.equal(r.status, 201); assert.ok(r.token); assert.equal(r.user.emailVerified, true); assert.equal(r.emailSent, undefined);
  const me = await api("GET", "/api/auth/me", null, { Authorization: `Bearer ${r.token}` });
  assert.equal(me.user.email, "tolu@test.com");
  const l = await api("POST", "/api/auth/login", { email: "tolu@test.com", password: "Passw0rd1", role: "buyer" });
  assert.equal(l.status, 200);
});

test("imported accounts with an unverified Firebase email are not blocked either", async () => {
  await api("POST", "/api/migration/import", { users: [{ uid: "f1", email: "old@test.com", name: "Old User", phone: "0803", role: "farmer", emailVerified: false }] }, { "x-migration-secret": "migration-secret-value" });
  const first = await api("POST", "/api/auth/login", { email: "old@test.com", password: "Passw0rd1" });
  assert.equal(first.error.code, "password_setup_required");   // still needs to claim its password, but not to verify an email
});
