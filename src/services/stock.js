import { db } from "../db/index.js";

export const RESERVING = ["Accepted", "Paid", "Completed"];

export function parseQuantity(q) {
  if (typeof q === "number") return { value: q, unit: "kg" };
  const m = String(q ?? "").replace(/,/g, "").trim().match(/^([0-9]*\.?[0-9]+)\s*([A-Za-z]*)/);
  return m ? { value: Number(m[1]), unit: m[2] || "kg" } : { value: NaN, unit: "kg" };
}

export async function soldQuantity(listingId) {
  const offers = await db("offers").find({ listingId, status: { $in: RESERVING } });
  return offers.reduce((s, o) => s + (Number(o.quantity) || 0), 0);
}

export async function stockInfo(listing) {
  const sold = await soldQuantity(listing._id);
  const total = listing.quantityValue ?? parseQuantity(listing.quantity).value;
  return { total, sold, remaining: Math.max(0, total - sold) };
}
