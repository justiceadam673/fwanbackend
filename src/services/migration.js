import { db, newId, now } from "../db/index.js";
import { EMAIL } from "../utils/validate.js";

// Copies Firebase accounts into MongoDB WITHOUT passwords (Firebase never exposes them).
// Imported users sign in once through the "claim" flow, which sets their Express password.
export async function importUsers(list, { dryRun = false } = {}) {
  const result = { created: 0, updated: 0, unchanged: 0, skipped: [] };
  for (const u of Array.isArray(list) ? list : []) {
    const email = String(u?.email || "").trim().toLowerCase();
    if (!EMAIL.test(email)) { result.skipped.push({ email: email || "(none)", reason: "invalid or missing email" }); continue; }
    const role = u.role;
    const existing = await db("users").findOne({ email });
    if (!existing) {
      if (!["farmer", "buyer"].includes(role)) { result.skipped.push({ email, reason: "role missing or not farmer/buyer (no Firestore profile?)" }); continue; }
      if (!dryRun) await db("users").insert({
        _id: newId(), name: String(u.name || u.displayName || email.split("@")[0]).slice(0, 80), email, phone: String(u.phone || u.phoneNumber || "").slice(0, 20),
        role, passwordHash: null, emailVerified: u.emailVerified === true, active: u.disabled !== true, language: "en", photoURL: u.photoURL || "",
        city: u.city || "", state: u.state || "", address: u.address || "", firebaseUid: u.uid || u.firebaseUid || "", importedFrom: "firebase", importedAt: now(),
        createdAt: u.createdAt ? new Date(u.createdAt).toISOString() : now(), updatedAt: now(),
      });
      result.created++; continue;
    }
    const patch = {};
    if (!existing.firebaseUid && (u.uid || u.firebaseUid)) patch.firebaseUid = u.uid || u.firebaseUid;
    if (!existing.emailVerified && u.emailVerified === true) patch.emailVerified = true;
    if (!existing.phone && (u.phone || u.phoneNumber)) patch.phone = u.phone || u.phoneNumber;
    if (!existing.photoURL && u.photoURL) patch.photoURL = u.photoURL;
    if (Object.keys(patch).length) { if (!dryRun) await db("users").update(existing._id, { ...patch, updatedAt: now() }); result.updated++; } else result.unchanged++;
  }
  return result;
}
