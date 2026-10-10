import { env } from "./src/config/env.js";
import { connectDB, closeDB, db } from "./src/db/index.js";
import { createApp } from "./src/app.js";
import { stopAllSimulations } from "./src/services/tracking.js";

async function promoteAdmin() {
  if (!env.ADMIN_EMAIL) return;
  const u = await db("users").findOne({ email: env.ADMIN_EMAIL });
  if (u && u.emailVerified && u.role !== "admin") { await db("users").update(u._id, { role: "admin" }); console.log(`Promoted ${env.ADMIN_EMAIL} to admin`); }
}

async function start() {
  await connectDB();
  await promoteAdmin();
  const app = createApp();
  const server = app.listen(env.PORT, () => {
    console.log(`\nFWAN backend running on http://localhost:${env.PORT}`);
    console.log(`  mode: ${env.OFFLINE ? "OFFLINE DEMO" : "online"} | database: ${env.DB_DRIVER} | payments: ${env.PAYMENT_MODE}\n`);
  });
  const stop = async () => { stopAllSimulations(); server.close(); await closeDB(); process.exit(0); };
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
}

start().catch((e) => { console.error("Failed to start:", e.message); process.exit(1); });
