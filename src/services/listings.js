import { db } from "../db/index.js";
import { stockInfo } from "./stock.js";

// Recompute "In Stock"/"Sold Out" and the offers counter after any offer change.
export async function refreshListing(listingId) {
  const l = await db("listings").get(listingId);
  if (!l) return null;
  const s = await stockInfo(l);
  const offersCount = await db("offers").count({ listingId, status: { $nin: ["Cancelled"] } });
  const status = s.remaining <= 0 ? "Sold Out" : "In Stock";
  return db("listings").update(listingId, { status, offers: offersCount, soldQuantity: s.sold, remainingQuantity: s.remaining });
}

export async function ratingFor(listingId) {
  const rs = await db("reviews").find({ listingId });
  const n = rs.length;
  return { rating: n ? Math.round((rs.reduce((a, x) => a + x.rating, 0) / n) * 10) / 10 : null, reviewCount: n };
}
