import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

// Mock of the Brevo HTTP API so the test needs no internet.
const sent = []; let failNext = false;
const mock = http.createServer((req, res) => {
  let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
    if (failNext) { res.writeHead(500); return res.end("boom"); }
    sent.push({ headers: req.headers, body: JSON.parse(b) }); res.writeHead(201, { "Content-Type": "application/json" }); res.end("{}");
  });
}).listen(0);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fwan-mail-"));
Object.assign(process.env, { DB_DRIVER: "file", DATA_DIR: tmp, PAYMENT_MODE: "mock", AUTO_VERIFY_EMAIL: "false", EXPOSE_DEV_TOKENS: "false",
  BREVO_API_KEY: "test-key", BREVO_API_URL: `http://127.0.0.1:${mock.address().port}/v3/smtp/email`, MAIL_FROM_EMAIL: "sender@fwan.test", NODE_ENV: "development" });

const { connectDB, closeDB } = await import("../src/db/index.js");
const { createApp } = await import("../src/app.js");
let server, base;
const api = async (m, u, b) => { const r = await fetch(base + u, { method: m, headers: { "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); let j = {}; try { j = JSON.parse(t); } catch { j = { html: t }; } return { ...j, status: r.status }; };
const linkIn = (msg) => msg.body.htmlContent.match(/href="([^"]+)"/)[1].replace(/&amp;/g, "&");
const path_ = (url) => new URL(url).pathname + new URL(url).search;

before(async () => { await connectDB(); server = createApp().listen(0); base = `http://127.0.0.1:${server.address().port}`; });
after(async () => { server.close(); mock.close(); await closeDB(); fs.rmSync(tmp, { recursive: true, force: true }); });

const user = { name: "Ada Farmer", email: "ada@test.com", phone: "08011112222", password: "Passw0rd1", role: "farmer" };

test("registration sends a verification email through the provider", async () => {
  const r = await api("POST", "/api/auth/register", user);
  assert.equal(r.status, 201); assert.equal(r.emailSent, true); assert.equal(r.devVerifyToken, undefined);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].headers["api-key"], "test-key");
  assert.equal(sent[0].body.to[0].email, "ada@test.com");
  assert.equal(sent[0].body.sender.email, "sender@fwan.test");
  assert.match(linkIn(sent[0]), /\/api\/auth\/verify-email\?token=[a-f0-9]{64}/);
  assert.match(sent[0].body.textContent, /verify/i);
});

test("sign-in is blocked until the email is verified; resend has a cooldown", async () => {
  const l = await api("POST", "/api/auth/login", { email: user.email, password: user.password, role: "farmer" });
  assert.equal(l.status, 403); assert.equal(l.error.code, "email_not_verified");
  const again = await api("POST", "/api/auth/resend-verification", { email: user.email });
  assert.equal(again.status, 429);
});

test("clicking the link verifies once, then the link is dead", async () => {
  const link = path_(linkIn(sent[0]));
  const ok = await fetch(base + link); assert.equal(ok.status, 200); assert.match(await ok.text(), /Email verified/);
  const reuse = await fetch(base + link); assert.equal(reuse.status, 400);
  const l = await api("POST", "/api/auth/login", { email: user.email, password: user.password, role: "farmer" });
  assert.equal(l.status, 200);
  assert.equal((await fetch(base + "/api/auth/verify-email?token=abc")).status, 400);
});

test("password reset email, form page and new password", async () => {
  await api("POST", "/api/auth/forgot-password", { email: user.email });
  assert.equal(sent.length, 2);
  const link = path_(linkIn(sent[1])); assert.match(link, /reset-password\?token=/);
  const page = await fetch(base + link); assert.equal(page.status, 200); assert.match(await page.text(), /Choose a new password/);
  const token = new URL(linkIn(sent[1])).searchParams.get("token");
  assert.equal((await api("POST", "/api/auth/reset-password", { token, password: "weak" })).status, 400);
  assert.equal((await api("POST", "/api/auth/reset-password", { token, password: "BetterPass9" })).status, 200);
  assert.equal((await api("POST", "/api/auth/login", { email: user.email, password: "BetterPass9" })).status, 200);
  assert.equal((await api("POST", "/api/auth/forgot-password", { email: "nobody@test.com" })).status, 200);   // no account enumeration
  assert.equal(sent.length, 2);
});

test("a mail provider outage does not break registration", async () => {
  failNext = true;
  const r = await api("POST", "/api/auth/register", { ...user, email: "bob@test.com", name: "Bob" });
  failNext = false;
  assert.equal(r.status, 201); assert.equal(r.emailSent, false); assert.match(r.message, /Resend/i);
});
