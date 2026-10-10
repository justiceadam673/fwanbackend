import express from "express";
import cors from "cors";
import helmet from "helmet";
import path from "node:path";
import fs from "node:fs";
import { env } from "./config/env.js";
import { noSqlGuard, apiLimiter } from "./middleware/security.js";
import { errorHandler, notFoundHandler } from "./middleware/error.js";
import auth from "./routes/auth.js";
import users, { uploads, uploadDir } from "./routes/users.js";
import listings from "./routes/listings.js";
import offers from "./routes/offers.js";
import payments from "./routes/payments.js";
import orders from "./routes/orders.js";
import notifications from "./routes/notifications.js";
import revenue from "./routes/revenue.js";
import dashboard from "./routes/dashboard.js";
import tracking from "./routes/tracking.js";
import { health, stream, prices, admin } from "./routes/misc.js";

export function createApp() {
  const app = express();
  if (env.TRUST_PROXY) app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" }, contentSecurityPolicy: false }));

  const allowed = new Set(env.CORS_ORIGINS);
  app.use(cors({
    origin: (origin, cb) => (!origin || allowed.has(origin) || allowed.has("*") || (env.OFFLINE && /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)(:\d+)?$/.test(origin)) ? cb(null, true) : cb(new Error(`Origin ${origin} is not allowed by CORS`))),
    credentials: true,
  }));

  app.use(express.json({ limit: "8mb", verify: (req, _res, buf) => { req.rawBody = buf; } }));
  app.use(noSqlGuard);

  fs.mkdirSync(uploadDir, { recursive: true });
  app.use("/uploads", express.static(uploadDir, { maxAge: "7d", setHeaders: (res) => res.setHeader("X-Content-Type-Options", "nosniff") }));

  app.use("/api", apiLimiter);
  app.use("/api/health", health);
  app.use("/api/auth", auth);
  app.use("/api/users", users);
  app.use("/api/uploads", uploads);
  app.use("/api/listings", listings);
  app.use("/api/offers", offers);
  app.use("/api/payments", payments);
  app.use("/api/orders", orders);
  app.use("/api/notifications", notifications);
  app.use("/api/revenue", revenue);
  app.use("/api/dashboard", dashboard);
  app.use("/api/tracking", tracking);
  app.use("/api/prices", prices);
  app.use("/api/stream", stream);
  app.use("/api/admin", admin);
  app.use("/api", notFoundHandler);

  // Optional: serve the built React app (copy the Vite "dist" folder into ./public) so one server hosts everything.
  const publicDir = path.join(env.ROOT, "public");
  if (fs.existsSync(path.join(publicDir, "index.html"))) {
    app.use(express.static(publicDir));
    app.get(/^(?!\/(api|uploads)\/).*/, (_req, res) => res.sendFile(path.join(publicDir, "index.html")));
  } else {
    app.get("/", (_req, res) => res.json({ message: "FWAN backend is running", health: "/api/health", docs: "see README.md" }));
  }
  app.use(errorHandler);
  return app;
}
