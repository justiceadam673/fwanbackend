import { env } from "../config/env.js";
import { HttpError } from "../utils/errors.js";

// Asks Google (Identity Toolkit) to validate a Firebase ID token and tell us the user's email and verification status.
// No service-account file is needed: only the project's public web API key (the same apiKey used in the React app).
export async function lookupFirebaseUser(idToken) {
  if (!env.FIREBASE_API_KEY) throw new HttpError(503, "Firebase verification is not configured on the server", "firebase_unconfigured");
  let res;
  try {
    res = await fetch(`${env.FIREBASE_LOOKUP_URL}?key=${encodeURIComponent(env.FIREBASE_API_KEY)}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken }), signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new HttpError(502, "Could not reach Firebase. Check the internet connection.", "firebase_unreachable");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.users?.[0]) throw new HttpError(401, "Firebase did not accept this sign-in token. Sign in again and retry.", "firebase_token_invalid");
  const u = body.users[0];
  return { uid: u.localId, email: String(u.email || "").toLowerCase(), emailVerified: u.emailVerified === true, disabled: u.disabled === true, lastLoginAt: Number(u.lastLoginAt) || 0 };
}
