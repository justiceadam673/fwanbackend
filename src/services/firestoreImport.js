import { db, now } from "../db/index.js";
import { refreshListing } from "./listings.js";
import { createTracking } from "./tracking.js";
import { parseQuantity } from "./stock.js";

// Copies Firestore data into MongoDB. Idempotent: documents that already exist (same _id) are left alone, so it is safe to re-run
// to pick up new Firestore data. Firestore document ids are reused as MongoDB _id, so references between documents stay valid.
// Anything that is not mapped (other collections, orders, deliveries...) is kept verbatim in "legacy_firestore".

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const STATUSES = { pending: "Pending", accepted: "Accepted", rejected: "Rejected", paid: "Paid", completed: "Completed", cancelled: "Cancelled", canceled: "Cancelled", countered: "Countered" };

export function ts(v) {                      // Firestore Timestamp in any export shape -> ISO string
  if (!v) return now();
  if (typeof v === "string") { const d = new Date(v); return Number.isNaN(d.getTime()) ? now() : d.toISOString(); }
  if (typeof v === "number") return new Date(v > 1e12 ? v : v * 1000).toISOString();
  if (typeof v.toDate === "function") return v.toDate().toISOString();
  const s = v._seconds ?? v.seconds; if (s !== undefined) return new Date(s * 1000).toISOString();
  return now();
}
const num = (v, d = 0) => { const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/[^0-9.\-]/g, "")); return Number.isFinite(n) ? n : d; };

export async function importFirestoreData({ uidEmail = {}, collections = {}, reviews = [] }, { dryRun = false } = {}) {
  const rep = {}; const bump = (k, f) => { (rep[k] ||= { created: 0, existing: 0, skipped: [] }); rep[k][f] = (rep[k][f] || 0) + 1; };
  const skip = (k, id, reason) => { (rep[k] ||= { created: 0, existing: 0, skipped: [] }).skipped.push({ id, reason }); };

  // Firebase uid -> MongoDB user (by email; accounts must be imported first with scripts/import-firebase-users.js)
  const cache = new Map();
  const mongoUser = async (uid) => {
    if (cache.has(uid)) return cache.get(uid);
    let u = (await db("users").findOne({ firebaseUid: uid })) || (uidEmail[uid] ? await db("users").findOne({ email: String(uidEmail[uid]).toLowerCase() }) : null);
    cache.set(uid, u); return u;
  };
  const put = async (coll, doc, key) => {
    if (await db(coll).get(doc._id)) { bump(key, "existing"); return false; }
    if (!dryRun) await db(coll).insert(doc); bump(key, "created"); return true;
  };

  // ---- listings
  const listingIds = new Set(), touched = new Set();
  for (const d of collections.farmers_listings || []) {
    const farmer = await mongoUser(d.userId || d.farmerId);
    if (!farmer) { skip("listings", d.id, "owner account not in MongoDB (import accounts first)"); continue; }
    const q = parseQuantity(d.quantity);
    if (!(q.value > 0)) { skip("listings", d.id, `unreadable quantity "${d.quantity}"`); continue; }
    const doc = { _id: d.id, farmerId: farmer._id, userId: farmer._id, farmer: d.farmer || farmer.name, farmerPhoto: farmer.photoURL || "", prod: d.prod || d.product || "Produce",
      quantityValue: q.value, unit: q.unit, quantity: `${q.value} ${q.unit}`, price: num(d.price), tier: d.tier || "Standard", description: d.description || "", image: d.image || "",
      location: [farmer.city, farmer.state].filter(Boolean).join(", "), harvestDate: d.harvestDate ? ts(d.harvestDate) : null, status: "In Stock", offers: 0, soldQuantity: 0,
      remainingQuantity: q.value, createdAt: ts(d.createdAt), updatedAt: now(), importedFrom: "firestore" };
    if (await put("listings", doc, "listings")) touched.add(d.id);
    listingIds.add(d.id);
  }

  // ---- reviews (subcollection farmers_listings/{id}/reviews)
  for (const r of reviews) {
    const u = await mongoUser(r.userId); const rating = Math.round(num(r.rating ?? r.stars));
    if (!u) { skip("reviews", r.id, "reviewer not in MongoDB"); continue; }
    if (rating < 1 || rating > 5) { skip("reviews", r.id, "no usable 1-5 rating"); continue; }
    if (await db("reviews").findOne({ listingId: r.listingId, userId: u._id })) { bump("reviews", "existing"); continue; }
    await put("reviews", { _id: r.id, listingId: r.listingId, userId: u._id, userName: r.userName || r.name || u.name, rating, comment: r.comment ?? r.text ?? r.review ?? "", verifiedPurchase: false, createdAt: ts(r.createdAt || r.timestamp) }, "reviews");
  }

  // ---- offers (+ orders and tracking for paid ones)
  for (const d of collections.offers || []) {
    const farmer = await mongoUser(d.farmerId), buyer = await mongoUser(d.buyerId || d.userId);
    if (!farmer || !buyer) { skip("offers", d.id, "buyer or farmer account not in MongoDB"); continue; }
    const listing = await db("listings").get(d.listingId);
    const status = STATUSES[String(d.status || "pending").toLowerCase()] || "Pending";
    const quantity = num(d.quantity), offerPrice = num(d.offerPrice ?? d.price);
    if (!(quantity > 0)) { skip("offers", d.id, "unreadable quantity"); continue; }
    const paid = status === "Paid" || status === "Completed";
    const doc = { _id: d.id, listingId: d.listingId, farmerId: farmer._id, farmerName: farmer.name, buyerId: buyer._id, buyerName: d.buyerName || buyer.name, product: d.product || listing?.prod || "Produce",
      listingPrice: listing?.price ?? offerPrice, unit: listing?.unit || "kg", quantity, offerPrice, totalValue: num(d.totalValue, quantity * offerPrice), deliveryDate: d.deliveryDate ? ts(d.deliveryDate) : null,
      deliveryLocation: d.deliveryLocation || "", messageToFarmer: d.messageToFarmer || "", status, paymentStatus: paid ? "Paid" : (d.paymentStatus || "Unpaid"),
      deliveryStatus: d.deliveryStatus || (paid ? "Processing" : null), createdAt: ts(d.timestamp || d.createdAt), updatedAt: now(), importedFrom: "firestore" };
    doc.timestamp = doc.createdAt;
    if (paid) { doc.paymentDate = ts(d.paymentDate || d.timestamp); doc.paymentReference = d.paymentReference || d.reference || `FS-${d.id}`; }
    const created = await put("offers", doc, "offers");
    if (listing) touched.add(d.listingId);
    if (created && paid && !dryRun) {
      const order = { _id: d.orderId || `ord_${d.id}`, offerId: d.id, listingId: doc.listingId, buyerId: buyer._id, farmerId: farmer._id, buyerName: doc.buyerName, product: doc.product, quantity, amount: doc.totalValue,
        currency: "NGN", reference: doc.paymentReference, status: status === "Completed" ? "Completed" : "Paid", createdAt: doc.paymentDate, paidAt: doc.paymentDate, importedFrom: "firestore" };
      if (!(await db("orders").findOne({ offerId: d.id }))) {
        await db("orders").insert(order); bump("orders", "created"); await db("offers").update(d.id, { orderId: order._id });
        if (status === "Paid") await createTracking({ order, offer: { ...doc, orderId: order._id }, farmer });
      }
    }
  }

  // ---- revenue entries
  for (const d of collections.revenue || []) {
    const u = await mongoUser(d.userId);
    if (!u) { skip("revenue", d.id, "owner not in MongoDB"); continue; }
    const m = MONTHS.findIndex((x) => x.toLowerCase() === String(d.month || "").slice(0, 3).toLowerCase()) + 1 || num(d.month);
    if (!(m >= 1 && m <= 12)) { skip("revenue", d.id, `unreadable month "${d.month}"`); continue; }
    await put("revenue", { _id: d.id, userId: u._id, month: MONTHS[m - 1], monthIndex: m, year: num(d.year, new Date().getFullYear()), amount: num(d.amount), note: d.note || "", source: "imported", createdAt: ts(d.createdAt) }, "revenue");
  }

  // ---- notifications
  for (const d of collections.notifications || []) {
    const u = await mongoUser(d.userId);
    if (!u) { skip("notifications", d.id, "user not in MongoDB"); continue; }
    await put("notifications", { _id: d.id, userId: u._id, type: d.type || "general", title: d.title || "Notification", message: d.message || "", metadata: d.metadata || {}, read: d.read === true, createdAt: ts(d.timestamp || d.createdAt), timestamp: ts(d.timestamp || d.createdAt) }, "notifications");
  }

  // ---- everything else, verbatim, so nothing from Firestore is lost
  const mapped = new Set(["users", "farmers_listings", "offers", "revenue", "notifications"]);
  for (const [name, docs] of Object.entries(collections)) {
    if (mapped.has(name)) continue;
    for (const d of docs) { const { id, ...data } = d; await put("legacy_firestore", { _id: `${name}/${id}`, collection: name, docId: id, data, importedAt: now() }, `legacy:${name}`); }
  }

  if (!dryRun) for (const id of touched) await refreshListing(id);    // recompute stock, Sold Out and offer counters
  return rep;
}
