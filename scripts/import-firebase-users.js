// One-time (re-runnable, idempotent) import of Firebase accounts into MongoDB, WITHOUT passwords.
//   node scripts/import-firebase-users.js --firebase ./serviceAccount.json [--dry-run]
//   node scripts/import-firebase-users.js --from-file users.json [--dry-run]
// Needs MONGODB_URI in .env. For --firebase also: npm install firebase-admin (once).
import fs from "node:fs";
import { connectDB, closeDB } from "../src/db/index.js";
import { importUsers } from "../src/services/migration.js";

const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };
const dryRun = process.argv.includes("--dry-run");

async function fromFirebase(keyPath) {
  let admin;
  try { admin = (await import("firebase-admin")).default; } catch { throw new Error("Run: npm install firebase-admin   (then try again)"); }
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(keyPath, "utf8"))) });
  const profiles = new Map();
  for (const d of (await admin.firestore().collection("users").get()).docs) profiles.set(d.id, d.data());
  const out = []; let token;
  do {
    const page = await admin.auth().listUsers(1000, token);
    for (const u of page.users) {
      const p = profiles.get(u.uid) || {};
      out.push({ uid: u.uid, email: u.email, emailVerified: u.emailVerified, disabled: u.disabled, photoURL: u.photoURL || p.photoURL, createdAt: u.metadata.creationTime,
        name: p.name || p.fullName || u.displayName, phone: p.phone || u.phoneNumber, role: p.role, city: p.city, state: p.state, address: p.address });
    }
    token = page.pageToken;
  } while (token);
  return out;
}

const list = arg("--firebase") ? await fromFirebase(arg("--firebase")) : arg("--from-file") ? JSON.parse(fs.readFileSync(arg("--from-file"), "utf8")) : null;
if (!list) { console.error("Usage: node scripts/import-firebase-users.js --firebase ./serviceAccount.json | --from-file users.json  [--dry-run]"); process.exit(1); }
console.log(`Read ${list.length} Firebase accounts${dryRun ? " (dry run: nothing is written)" : ""}`);
await connectDB();
const r = await importUsers(list, { dryRun });
console.log(`Created: ${r.created}  Updated: ${r.updated}  Unchanged: ${r.unchanged}  Skipped: ${r.skipped.length}`);
r.skipped.forEach((s) => console.log(`  skipped ${s.email}: ${s.reason}`));
await closeDB();
