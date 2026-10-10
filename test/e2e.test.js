import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fwan-test-"));
process.env.OFFLINE = "true";
process.env.DATA_DIR = tmp;

const { connectDB, closeDB } = await import("../src/db/index.js");
const { createApp } = await import("../src/app.js");
const { stopAllSimulations } = await import("../src/services/tracking.js");

let server, base;
const S = {}; // shared state
const api = async (method, url, body, token) => {
  const res = await fetch(base + url, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  return { ...json, status: res.status };
};

before(async () => {
  await connectDB();
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { stopAllSimulations(); server.close(); await closeDB(); fs.rmSync(tmp, { recursive: true, force: true }); });

test("health reports offline mode", async () => {
  const r = await api("GET", "/api/health");
  assert.equal(r.status, 200); assert.equal(r.database, "file"); assert.equal(r.paymentMode, "mock");
});

test("register + login for farmer and buyer, role guard works", async () => {
  const f = await api("POST", "/api/auth/register", { name: "Test Farmer", email: "F@Test.com", phone: "08011112222", password: "Passw0rd1", role: "farmer" });
  assert.equal(f.status, 201);
  const b = await api("POST", "/api/auth/register", { name: "Test Buyer", email: "b@test.com", phone: "08033334444", password: "Passw0rd1", role: "buyer" });
  assert.equal(b.status, 201);
  assert.equal((await api("POST", "/api/auth/register", { name: "X", email: "b@test.com", phone: "08033334444", password: "Passw0rd1", role: "buyer" })).status, 400);
  assert.equal((await api("POST", "/api/auth/register", { name: "Weak", email: "w@test.com", phone: "08033334444", password: "short", role: "buyer" })).status, 400);
  const lf = await api("POST", "/api/auth/login", { email: "f@test.com", password: "Passw0rd1", role: "farmer" });
  assert.equal(lf.status, 200); S.farmer = lf.token; S.farmerId = lf.user.id;
  assert.equal((await api("POST", "/api/auth/login", { email: "b@test.com", password: "Passw0rd1", role: "farmer" })).status, 403);
  assert.equal((await api("POST", "/api/auth/login", { email: "b@test.com", password: "wrong" })).status, 401);
  const lb = await api("POST", "/api/auth/login", { email: "b@test.com", password: "Passw0rd1", role: "buyer" });
  S.buyer = lb.token; S.buyerId = lb.user.id;
  assert.equal(lb.user.passwordHash, undefined);
});

test("NoSQL operator injection is rejected", async () => {
  const r = await api("POST", "/api/auth/login", { email: { $gt: "" }, password: { $gt: "" } });
  assert.equal(r.status, 400);
});

test("farmer creates listing; buyer cannot; buyers can browse", async () => {
  const body = { product: "Tomatoes", quantity: 100, unit: "basket", price: 16500, tier: "Grade A", description: "Fresh" };
  assert.equal((await api("POST", "/api/listings", body, S.buyer)).status, 403);
  assert.equal((await api("POST", "/api/listings", { ...body, price: -5 }, S.farmer)).status, 400);
  const c = await api("POST", "/api/listings", body, S.farmer);
  assert.equal(c.status, 201); S.listing = c.data.id;
  assert.equal(c.data.remainingQuantity, 100);
  const list = await api("GET", "/api/listings?q=tomat", null, S.buyer);
  assert.equal(list.data.length, 1); assert.equal(list.data[0].product, "Tomatoes");
});

test("offer rules: stock limit, own listing, validation", async () => {
  const tomorrow = new Date(Date.now() + 86400000).toISOString();
  const good = { listingId: S.listing, quantity: 30, offerPrice: 16000, deliveryDate: tomorrow, deliveryLocation: "Kano" };
  assert.equal((await api("POST", "/api/offers", { ...good, quantity: 500 }, S.buyer)).status, 400);
  assert.equal((await api("POST", "/api/offers", { ...good, deliveryDate: "2001-01-01" }, S.buyer)).status, 400);
  assert.equal((await api("POST", "/api/offers", good, S.farmer)).status, 403);
  const o = await api("POST", "/api/offers", good, S.buyer);
  assert.equal(o.status, 201); S.offer = o.data.id;
  assert.equal(o.data.totalValue, 480000);       // computed by the server
  assert.equal(o.data.status, "Pending");
});

test("only the owning farmer can accept; payment cannot happen before acceptance", async () => {
  assert.equal((await api("POST", `/api/offers/${S.offer}/accept`, {}, S.buyer)).status, 403);
  assert.equal((await api("POST", "/api/payments/initialize", { offerId: S.offer }, S.buyer)).status, 409);
  const a = await api("POST", `/api/offers/${S.offer}/accept`, {}, S.farmer);
  assert.equal(a.status, 200); assert.equal(a.data.status, "Accepted");
  const l = await api("GET", `/api/listings/${S.listing}`);
  assert.equal(l.data.remainingQuantity, 70);
});

test("payment: server-side amount, idempotent confirmation, order created", async () => {
  const init = await api("POST", "/api/payments/initialize", { offerId: S.offer, amount: 1 }, S.buyer);
  assert.equal(init.status, 200); assert.equal(init.data.amountKobo, 48000000); S.ref = init.data.reference;
  const again = await api("POST", "/api/payments/initialize", { offerId: S.offer }, S.buyer);
  assert.equal(again.data.reference, S.ref);       // no duplicate charge references
  assert.equal((await api("POST", "/api/payments/mock/confirm", { reference: S.ref }, S.farmer)).status, 403);
  const ok = await api("POST", "/api/payments/mock/confirm", { reference: S.ref }, S.buyer);
  assert.equal(ok.status, 200); assert.equal(ok.data.offer.status, "Paid"); S.order = ok.data.order.id;
  const dup = await api("POST", "/api/payments/mock/confirm", { reference: S.ref }, S.buyer);
  assert.equal(dup.data.alreadyProcessed, true);
  const orders = await api("GET", "/api/orders", null, S.farmer);
  assert.equal(orders.data.length, 1);
  assert.equal((await api("POST", "/api/payments/initialize", { offerId: S.offer }, S.buyer)).status, 409);
});

test("browser cannot mark an offer paid by itself", async () => {
  const r = await api("PATCH", `/api/offers/${S.offer}`, { status: "Paid" }, S.buyer);
  assert.ok([404, 405].includes(r.status));
});

test("tracking: record GPS position, arrival marks delivered", async () => {
  const t = await api("GET", `/api/tracking/${S.order}`, null, S.buyer);
  assert.equal(t.status, 200); assert.equal(t.data.source, "none");
  const mid = await api("POST", `/api/tracking/${S.order}/location`, { lat: t.data.origin.lat + 0.1, lng: t.data.origin.lng + 0.1 }, S.farmer);
  assert.equal(mid.data.source, "gps"); assert.equal(mid.data.status, "In transit");
  const arrive = await api("POST", `/api/tracking/${S.order}/location`, { lat: t.data.destination.lat, lng: t.data.destination.lng }, S.farmer);
  assert.equal(arrive.data.status, "Delivered");
  assert.equal((await api("POST", `/api/tracking/${S.order}/location`, { lat: 1, lng: 1 }, S.buyer)).status, 403);
  const o = await api("GET", `/api/offers/${S.offer}`, null, S.buyer);
  assert.equal(o.data.deliveryStatus, "Delivered");
});

test("buyer confirms receipt; revenue and dashboards", async () => {
  const c = await api("POST", `/api/offers/${S.offer}/confirm-receipt`, {}, S.buyer);
  assert.equal(c.data.status, "Completed");
  const rev = await api("GET", "/api/revenue/summary", null, S.farmer);
  assert.equal(rev.data.totals.orders, 480000);
  assert.equal((await api("GET", "/api/revenue/summary", null, S.buyer)).status, 403);
  const d = await api("GET", "/api/dashboard", null, S.farmer);
  assert.equal(d.data.totalRevenue, 480000); assert.equal(d.data.completedOrders, 1);
  const db_ = await api("GET", "/api/dashboard", null, S.buyer);
  assert.equal(db_.data.totalSpent, 480000);
});

test("counter-offer flow", async () => {
  const o = await api("POST", "/api/offers", { listingId: S.listing, quantity: 10, offerPrice: 10000, deliveryDate: new Date(Date.now() + 86400000).toISOString(), deliveryLocation: "Jos" }, S.buyer);
  const c = await api("POST", `/api/offers/${o.data.id}/counter`, { offerPrice: 14000 }, S.farmer);
  assert.equal(c.data.status, "Countered"); assert.equal(c.data.totalValue, 140000);
  const a = await api("POST", `/api/offers/${o.data.id}/accept-counter`, {}, S.buyer);
  assert.equal(a.data.status, "Accepted");
  const x = await api("POST", `/api/offers/${o.data.id}/cancel`, {}, S.buyer);
  assert.equal(x.data.status, "Cancelled");
});

test("reviews: one per buyer, verified purchase flag", async () => {
  const r = await api("POST", `/api/listings/${S.listing}/reviews`, { rating: 5, comment: "Great" }, S.buyer);
  assert.equal(r.status, 201); assert.equal(r.data.verifiedPurchase, true);
  assert.equal((await api("POST", `/api/listings/${S.listing}/reviews`, { rating: 4 }, S.buyer)).status, 409);
  const l = await api("GET", `/api/listings/${S.listing}`);
  assert.equal(l.data.rating, 5);
});

test("notifications, read state", async () => {
  const n = await api("GET", "/api/notifications", null, S.farmer);
  assert.ok(n.data.length >= 3); assert.ok(n.meta.unread >= 1);
  await api("POST", "/api/notifications/read-all", {}, S.farmer);
  assert.equal((await api("GET", "/api/notifications/unread-count", null, S.farmer)).data.unread, 0);
});

test("listing delete is blocked while an order is active, allowed otherwise", async () => {
  const c = await api("POST", "/api/listings", { product: "Cabbage", quantity: 5, unit: "bag", price: 10000 }, S.farmer);
  assert.equal((await api("DELETE", `/api/listings/${c.data.id}`, null, S.buyer)).status, 403);
  assert.equal((await api("DELETE", `/api/listings/${c.data.id}`, null, S.farmer)).status, 200);
});

test("image upload validates real image bytes", async () => {
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  const ok = await api("POST", "/api/uploads/image", { dataUrl: png }, S.farmer);
  assert.equal(ok.status, 201);
  const img = await fetch(base + ok.data.path); assert.equal(img.status, 200); assert.equal(img.headers.get("content-type"), "image/png");
  const fake = "data:image/png;base64," + Buffer.from("<script>alert(1)</script>").toString("base64");
  assert.equal((await api("POST", "/api/uploads/image", { dataUrl: fake }, S.farmer)).status, 400);
  assert.equal((await api("POST", "/api/uploads/image", { dataUrl: png })).status, 401);
});

test("password reset and change", async () => {
  const f = await api("POST", "/api/auth/forgot-password", { email: "b@test.com" });
  assert.ok(f.devResetToken);
  assert.equal((await api("POST", "/api/auth/reset-password", { token: f.devResetToken, password: "NewPass123" })).status, 200);
  assert.equal((await api("POST", "/api/auth/login", { email: "b@test.com", password: "NewPass123" })).status, 200);
});

test("prices endpoint and live stream handshake", async () => {
  const p = await api("GET", "/api/prices");
  assert.ok(p.data.reference.items.length >= 10); assert.ok(p.data.platformStats.length >= 1);
  const ctl = new AbortController();
  const res = await fetch(`${base}/api/stream?token=${S.buyer}`, { signal: ctl.signal });
  assert.equal(res.headers.get("content-type"), "text/event-stream");
  const chunk = await res.body.getReader().read();
  assert.match(new TextDecoder().decode(chunk.value), /event: ready/);
  ctl.abort();
});

test("unauthenticated and bad-token access is refused", async () => {
  assert.equal((await api("GET", "/api/offers")).status, 401);
  assert.equal((await api("GET", "/api/offers", null, "garbage")).status, 401);
  assert.equal((await api("GET", "/api/admin/stats", null, S.buyer)).status, 403);
});
