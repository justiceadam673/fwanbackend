import bcrypt from "bcryptjs";
import { env } from "../config/env.js";
import { connectDB, closeDB, db, newId, now } from "../db/index.js";
import { createTracking } from "../services/tracking.js";

export const DEMO_PASSWORD = "Demo@1234";
export const DEMO_ACCOUNTS = [
  { role: "admin", email: "admin@fwan.demo" },
  { role: "farmer", email: "farmer@fwan.demo", name: "Musa Danladi", city: "Jos", state: "Plateau", farmName: "Danladi Farms" },
  { role: "farmer", email: "farmer2@fwan.demo", name: "Hauwa Bello", city: "Bauchi", state: "Bauchi", farmName: "Bello Fresh" },
  { role: "buyer", email: "buyer@fwan.demo", name: "Chinedu Okafor" },
  { role: "buyer", email: "buyer2@fwan.demo", name: "Fatima Sani" },
];
const days = (n) => new Date(Date.now() + n * 86400000).toISOString();

export async function seed({ reset = false } = {}) {
  if (env.isProd && !process.argv.includes("--force")) throw new Error("Refusing to seed in production (use --force if you really mean it)");
  if (reset) for (const c of ["users", "listings", "offers", "orders", "payments", "tracking", "notifications", "reviews", "revenue"]) await db(c).clear();
  if (await db("users").count()) { console.log("Database already has data; skipping seed (use --reset to wipe)."); return false; }

  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const U = {};
  for (const a of DEMO_ACCOUNTS) {
    const u = { _id: newId(), name: a.name || "FWAN Admin", email: a.email, phone: "+2348012345678", role: a.role, passwordHash: hash, emailVerified: true, active: true, language: "en", photoURL: "", city: a.city || "", state: a.state || "", farmName: a.farmName || "", address: a.city || "", createdAt: now(), updatedAt: now() };
    await db("users").insert(u); U[a.email] = u;
  }
  const f1 = U["farmer@fwan.demo"], f2 = U["farmer2@fwan.demo"], b1 = U["buyer@fwan.demo"], b2 = U["buyer2@fwan.demo"];
  const mk = (f, prod, qty, unit, price, tier, desc) => ({ _id: newId(), farmerId: f._id, userId: f._id, farmer: f.name, farmerPhoto: "", prod, quantityValue: qty, unit, quantity: `${qty} ${unit}`, price, tier, description: desc, image: "", location: `${f.city}, ${f.state}`, status: "In Stock", offers: 0, soldQuantity: 0, remainingQuantity: qty, harvestDate: days(-2), createdAt: now(), updatedAt: now() });
  const L = [
    mk(f1, "Tomatoes", 120, "basket", 16500, "Grade A", "Firm, fresh tomatoes harvested this week."),
    mk(f1, "Irish Potatoes", 80, "bag", 21000, "Grade A", "Clean, medium-sized Jos potatoes."),
    mk(f1, "Cabbage", 60, "bag", 12000, "Standard", "Tight green heads."),
    mk(f2, "Onion Bulb", 100, "bag", 58000, "Grade A", "Dry cured onion bulbs."),
    mk(f2, "Yellow pepper", 40, "bag", 5500, "Standard", "Ripe yellow pepper."),
  ];
  for (const l of L) await db("listings").insert(l);

  const offer = (l, b, qty, price, status, extra = {}) => ({ _id: newId(), listingId: l._id, farmerId: l.farmerId, farmerName: l.farmer, buyerId: b._id, buyerName: b.name, product: l.prod, listingPrice: l.price, unit: l.unit, quantity: qty, offerPrice: price, totalValue: qty * price, deliveryDate: days(5), deliveryLocation: "Kano", messageToFarmer: "Please deliver in clean crates.", status, paymentStatus: "Unpaid", deliveryStatus: null, createdAt: now(), updatedAt: now(), timestamp: now(), ...extra });
  const pending = offer(L[0], b1, 10, 16000, "Pending");
  const accepted = offer(L[1], b2, 5, 20500, "Accepted", { acceptedAt: now() });
  const paid = offer(L[3], b1, 8, 57000, "Paid", { paymentStatus: "Paid", deliveryStatus: "Processing", paymentDate: now(), paymentReference: "FWAN-DEMO-0001", deliveryLocation: "Abuja" });
  const rejected = offer(L[4], b2, 3, 4000, "Rejected");
  for (const o of [pending, accepted, paid, rejected]) await db("offers").insert(o);
  const order = { _id: newId(), offerId: paid._id, listingId: paid.listingId, buyerId: b1._id, farmerId: f2._id, buyerName: b1.name, product: paid.product, quantity: paid.quantity, amount: paid.totalValue, currency: "NGN", reference: "FWAN-DEMO-0001", status: "Paid", createdAt: now(), paidAt: now() };
  await db("orders").insert(order);
  await db("offers").update(paid._id, { orderId: order._id });
  await db("payments").insert({ _id: newId(), reference: "FWAN-DEMO-0001", offerId: paid._id, buyerId: b1._id, farmerId: f2._id, amount: paid.totalValue, amountKobo: paid.totalValue * 100, currency: "NGN", status: "success", mode: "mock", createdAt: now(), paidAt: now() });
  await createTracking({ order, offer: { ...paid, orderId: order._id }, farmer: f2 });
  await db("reviews").insert({ _id: newId(), listingId: L[3]._id, userId: b1._id, userName: b1.name, rating: 5, comment: "Great quality onions.", verifiedPurchase: true, createdAt: now() });
  for (const [u, t, m] of [[f1._id, "New offer", "Chinedu Okafor offered ₦16,000 per basket for 10 Tomatoes."], [b2._id, "Offer accepted", "Your offer for Irish Potatoes was accepted. You can now pay."]])
    await db("notifications").insert({ _id: newId(), userId: u, type: "offer", title: t, message: m, metadata: {}, read: false, createdAt: now(), timestamp: now() });
  console.log("Seeded demo data.");
  return true;
}

if (process.argv[1] && process.argv[1].endsWith("seed.js")) {
  await connectDB();
  await seed({ reset: process.argv.includes("--reset") });
  console.log(`\nDemo logins (password ${DEMO_PASSWORD}):\n` + DEMO_ACCOUNTS.map((a) => `  ${a.role.padEnd(7)} ${a.email}`).join("\n"));
  await closeDB();
}
