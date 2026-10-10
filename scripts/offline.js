// One-command offline demo: file database, simulated payments, demo data, no internet needed.
import os from "node:os";
process.env.OFFLINE = "true";
process.env.NODE_ENV = process.env.NODE_ENV || "development";

const { env } = await import("../src/config/env.js");
const { connectDB, db } = await import("../src/db/index.js");
const { seed, DEMO_ACCOUNTS, DEMO_PASSWORD } = await import("../src/seed/seed.js");

await connectDB();
if (!(await db("users").count())) await seed();

const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === "IPv4" && !i.internal).map((i) => i.address);
console.log("\n=== FWAN OFFLINE DEMO MODE ===");
console.log(`Local:    http://localhost:${env.PORT}`);
ips.forEach((ip) => console.log(`Network:  http://${ip}:${env.PORT}   (other devices on the same Wi-Fi/hotspot)`));
console.log(`\nDemo logins (password ${DEMO_PASSWORD}):`);
DEMO_ACCOUNTS.forEach((a) => console.log(`  ${a.role.padEnd(7)} ${a.email}`));
console.log("\nPayments are SIMULATED in this mode. Data is saved in", env.DATA_DIR, "\n");

await import("../server.js");
