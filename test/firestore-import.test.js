import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fwan-fsi-"));
Object.assign(process.env, { DB_DRIVER: "file", DATA_DIR: tmp, PAYMENT_MODE: "mock", NODE_ENV: "development" });
const { connectDB, closeDB, db } = await import("../src/db/index.js");
const { importUsers } = await import("../src/services/migration.js");
const { importFirestoreData, ts } = await import("../src/services/firestoreImport.js");
before(async () => { await connectDB(); await importUsers([
  { uid: "uF", email: "farmer@x.com", name: "Musa", role: "farmer", city: "Jos", state: "Plateau", emailVerified: true },
  { uid: "uB", email: "buyer@x.com", name: "Chidi", role: "buyer", emailVerified: true }]); });
after(async () => { await closeDB(); fs.rmSync(tmp, { recursive: true, force: true }); });

const T = (s) => ({ _seconds: s, _nanoseconds: 0 });
const data = () => ({
  uidEmail: { uF: "farmer@x.com", uB: "buyer@x.com" },
  collections: {
    farmers_listings: [
      { id: "L1", userId: "uF", farmer: "Musa", prod: "Tomatoes", quantity: "100 basket", price: "16,500", tier: "Grade A", description: "Fresh", image: "http://img/1.jpg", createdAt: T(1760000000) },
      { id: "L2", userId: "uMissing", prod: "Onion", quantity: "5 bag", price: 100 },
      { id: "L3", userId: "uF", prod: "Cabbage", quantity: "lots", price: 100 }],
    offers: [
      { id: "O1", listingId: "L1", farmerId: "uF", buyerId: "uB", buyerName: "Chidi", product: "Tomatoes", quantity: 30, offerPrice: 16000, totalValue: 480000, status: "Paid", deliveryLocation: "Kano", timestamp: T(1760100000), paymentStatus: "Paid", deliveryStatus: "Processing" },
      { id: "O2", listingId: "L1", farmerId: "uF", buyerId: "uB", quantity: "10", offerPrice: "15,000", status: "accepted", timestamp: "2025-10-12T10:00:00Z" },
      { id: "O3", listingId: "L1", farmerId: "uF", buyerId: "uB", quantity: 5, offerPrice: 100, status: "Pending" },
      { id: "O4", listingId: "L1", farmerId: "uGhost", buyerId: "uB", quantity: 5, offerPrice: 100, status: "Pending" }],
    revenue: [{ id: "R1", userId: "uF", month: "March", year: 2025, amount: 50000 }, { id: "R2", userId: "uF", month: "???", amount: 1 }],
    notifications: [{ id: "N1", userId: "uF", type: "offer", message: "New offer", read: false, timestamp: T(1760100000) }],
    orders: [{ id: "X1", farmerId: "uF", buyerId: "uB", note: "kept verbatim" }],
    deliveries: [{ id: "vehicle-001", currentLocation: { lat: 9.9, lng: 8.8 } }],
  },
  reviews: [{ id: "V1", listingId: "L1", userId: "uB", rating: 4, comment: "Good", createdAt: T(1760200000) }, { id: "V2", listingId: "L1", userId: "uB", rating: 9 }],
});

test("timestamps in every export shape", () => {
  assert.equal(ts(T(1760000000)), new Date(1760000000 * 1000).toISOString());
  assert.equal(ts("2025-01-02T00:00:00Z"), "2025-01-02T00:00:00.000Z");
  assert.equal(ts({ toDate: () => new Date("2024-02-03T00:00:00Z") }), "2024-02-03T00:00:00.000Z");
});

test("dry run writes nothing", async () => {
  const r = await importFirestoreData(data(), { dryRun: true });
  assert.equal(r.listings.created, 1); assert.equal(await db("listings").count(), 0);
});

test("real import maps listings, offers, orders, revenue, reviews, notifications and keeps the rest", async () => {
  const r = await importFirestoreData(data());
  assert.equal(r.listings.created, 1); assert.equal(r.listings.skipped.length, 2);
  assert.equal(r.offers.created, 3); assert.equal(r.offers.skipped.length, 1);
  assert.equal(r.revenue.created, 1); assert.equal(r.reviews.created, 1); assert.equal(r.reviews.skipped.length, 1); assert.equal(r.notifications.created, 1);

  const farmer = await db("users").findOne({ email: "farmer@x.com" }), buyer = await db("users").findOne({ email: "buyer@x.com" });
  const l = await db("listings").get("L1");
  assert.equal(l.farmerId, farmer._id); assert.equal(l.price, 16500); assert.equal(l.quantityValue, 100); assert.equal(l.unit, "basket");
  assert.equal(l.soldQuantity, 40);                       // O1 (Paid, 30) + O2 (Accepted, 10); O3 is only Pending
  assert.equal(l.remainingQuantity, 60); assert.equal(l.offers, 3);

  const o1 = await db("offers").get("O1");
  assert.equal(o1.buyerId, buyer._id); assert.equal(o1.status, "Paid"); assert.ok(o1.orderId);
  const o2 = await db("offers").get("O2");
  assert.equal(o2.status, "Accepted"); assert.equal(o2.offerPrice, 15000); assert.equal(o2.totalValue, 150000);

  const order = await db("orders").findOne({ offerId: "O1" });
  assert.equal(order.amount, 480000); assert.equal(order.farmerId, farmer._id);
  assert.ok(await db("tracking").get(order._id));         // paid order gets a tracking record
  assert.equal((await db("revenue").get("R1")).monthIndex, 3);
  assert.equal((await db("reviews").get("V1")).rating, 4);
  assert.equal((await db("legacy_firestore").get("orders/X1")).data.note, "kept verbatim");
  assert.equal((await db("legacy_firestore").get("deliveries/vehicle-001")).data.currentLocation.lat, 9.9);
});

test("re-running creates nothing new and never overwrites", async () => {
  await db("listings").update("L1", { price: 99999 });
  const r = await importFirestoreData(data());
  assert.equal(r.listings.created, 0); assert.equal(r.offers.created, 0); assert.equal(r.revenue.created, 0);
  assert.equal((await db("listings").get("L1")).price, 99999);
  assert.equal(await db("orders").count({ offerId: "O1" }), 1);
});
