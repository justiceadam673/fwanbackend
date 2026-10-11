// Copies Firestore data (listings, reviews, offers, revenue, notifications and everything else) into MongoDB.
// Read-only on Firebase. Safe to re-run: existing documents are never overwritten.
//
//   1) node scripts/import-firebase-users.js --firebase ./serviceAccount.json     (accounts first)
//   2) node scripts/import-firestore-data.js --firebase ./serviceAccount.json --dry-run
//   3) node scripts/import-firestore-data.js --firebase ./serviceAccount.json
// Offline alternative: --from-file firestore-export.json  ({ uidEmail, collections: { name: [{ id, ... }] }, reviews: [{ listingId, id, ... }] })
import fs from "node:fs";
import { connectDB, closeDB } from "../src/db/index.js";
import { importFirestoreData } from "../src/services/firestoreImport.js";

const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };
const dryRun = process.argv.includes("--dry-run");

function plain(v) {                       // Firestore types -> JSON-friendly values
  if (v === null || typeof v !== "object") return v;
  if (typeof v.toDate === "function") return v.toDate().toISOString();
  if (typeof v.latitude === "number" && typeof v.longitude === "number") return { lat: v.latitude, lng: v.longitude };
  if (typeof v.path === "string" && v.firestore) return v.path;
  if (Array.isArray(v)) return v.map(plain);
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]));
}

async function fromFirebase(keyPath) {
  let admin;
  try { admin = (await import("firebase-admin")).default; } catch { throw new Error("Run: npm install firebase-admin   (then try again)"); }
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(keyPath, "utf8"))) });
  const store = admin.firestore(), collections = {}, uidEmail = {};
  let token;
  do { const p = await admin.auth().listUsers(1000, token); p.users.forEach((u) => u.email && (uidEmail[u.uid] = u.email)); token = p.pageToken; } while (token);
  for (const c of await store.listCollections()) {
    collections[c.id] = (await c.get()).docs.map((d) => ({ id: d.id, ...plain(d.data()) }));
    console.log(`  read ${collections[c.id].length} documents from ${c.id}`);
  }
  const reviews = (await store.collectionGroup("reviews").get()).docs.map((d) => ({ id: d.id, listingId: d.ref.parent.parent?.id, ...plain(d.data()) })).filter((r) => r.listingId);
  console.log(`  read ${reviews.length} reviews`);
  return { uidEmail, collections, reviews };
}

const data = arg("--firebase") ? await fromFirebase(arg("--firebase")) : arg("--from-file") ? JSON.parse(fs.readFileSync(arg("--from-file"), "utf8")) : null;
if (!data) { console.error("Usage: node scripts/import-firestore-data.js --firebase ./serviceAccount.json | --from-file export.json  [--dry-run]"); process.exit(1); }
await connectDB();
const rep = await importFirestoreData(data, { dryRun });
console.log(`\n${dryRun ? "DRY RUN (nothing written)" : "Import finished"}`);
for (const [k, v] of Object.entries(rep)) {
  console.log(`  ${k.padEnd(22)} created ${String(v.created || 0).padStart(4)}   already there ${String(v.existing || 0).padStart(4)}   skipped ${v.skipped.length}`);
  v.skipped.slice(0, 10).forEach((s) => console.log(`      skipped ${s.id}: ${s.reason}`));
}
await closeDB();
