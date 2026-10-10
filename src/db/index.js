import crypto from "node:crypto";
import { env } from "../config/env.js";
import { createFileDriver } from "./fileDriver.js";
import { createMongoDriver } from "./mongoDriver.js";

let driver = null;

export const newId = () => crypto.randomBytes(12).toString("hex");
export const now = () => new Date().toISOString();

export async function connectDB() {
  if (driver) return driver;
  if (env.DB_DRIVER === "file") {
    driver = createFileDriver(env.DATA_DIR);
  } else {
    if (!env.MONGODB_URI) throw new Error("MONGODB_URI is not set. Set it in .env, or run offline mode (npm run offline).");
    try {
      driver = await createMongoDriver(env.MONGODB_URI);
      await driver.connect();
    } catch (err) {
      if (!env.DB_FALLBACK_TO_FILE) throw err;
      console.warn(`[warn] MongoDB unavailable (${err.message}). Using the offline file database instead.`);
      driver = createFileDriver(env.DATA_DIR);
    }
  }
  await ensureIndexes();
  console.log(`Database ready: ${driver.kind} (${driver.location})`);
  return driver;
}

export const db = (name) => {
  if (!driver) throw new Error("Database not connected");
  return driver.collection(name);
};
export const dbKind = () => driver?.kind;
export const closeDB = async () => { if (driver) await driver.close(); driver = null; };

async function ensureIndexes() {
  const idx = [
    ["users", { email: 1 }, { unique: true }],
    ["listings", { farmerId: 1, createdAt: -1 }, {}],
    ["offers", { buyerId: 1, createdAt: -1 }, {}],
    ["offers", { farmerId: 1, createdAt: -1 }, {}],
    ["offers", { listingId: 1, status: 1 }, {}],
    ["notifications", { userId: 1, createdAt: -1 }, {}],
    ["payments", { reference: 1 }, { unique: true }],
    ["orders", { offerId: 1 }, { unique: true }],
    ["reviews", { listingId: 1, userId: 1 }, { unique: true }],
  ];
  for (const [c, spec, opts] of idx) {
    try { await driver.collection(c).ensureIndex(spec, opts); } catch (e) { console.warn(`[warn] index ${c}: ${e.message}`); }
  }
}
