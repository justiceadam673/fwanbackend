import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

const bool = (v, d = false) => (v === undefined || v === "" ? d : /^(1|true|yes|on)$/i.test(String(v)));
const list = (v, d = []) => (v ? String(v).split(",").map((s) => s.trim()).filter(Boolean) : d);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const OFFLINE = bool(process.env.OFFLINE);
const NODE_ENV = process.env.NODE_ENV || "development";
const isProd = NODE_ENV === "production";
// false = nobody is blocked for an unverified email: sign up and sign in immediately (no email sent)
const REQUIRE_EMAIL_VERIFICATION = OFFLINE ? false : bool(process.env.REQUIRE_EMAIL_VERIFICATION, true);

if (isProd && !OFFLINE && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 24)) {
  throw new Error("JWT_SECRET must be set (24+ characters) when NODE_ENV=production");
}

export const env = {
  ROOT: root,
  NODE_ENV,
  isProd,
  OFFLINE,
  PORT: Number(process.env.PORT) || 5000,
  PUBLIC_URL: (process.env.PUBLIC_URL || "").replace(/\/$/, ""),
  // Database: "mongo" or "file". OFFLINE always uses the file driver.
  DB_DRIVER: OFFLINE ? "file" : process.env.DB_DRIVER || "mongo",
  MONGODB_URI: process.env.MONGODB_URI || "",
  DB_FALLBACK_TO_FILE: bool(process.env.DB_FALLBACK_TO_FILE, false),
  DATA_DIR: path.resolve(root, process.env.DATA_DIR || (OFFLINE ? "data/offline" : "data/local")),
  // Auth
  JWT_SECRET: process.env.JWT_SECRET || "dev-only-secret-change-me-please-0123456789",
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || "7d",
  REQUIRE_EMAIL_VERIFICATION,
  AUTO_VERIFY_EMAIL: !REQUIRE_EMAIL_VERIFICATION || bool(process.env.AUTO_VERIFY_EMAIL, false),
  EXPOSE_DEV_TOKENS: OFFLINE ? true : bool(process.env.EXPOSE_DEV_TOKENS, !isProd),
  // CORS
  CORS_ORIGINS: list(process.env.CORS_ORIGINS, ["http://localhost:5173", "http://localhost:3000"]),
  // Payments: "paystack" or "mock". OFFLINE always uses mock.
  PAYMENT_MODE: OFFLINE ? "mock" : process.env.PAYMENT_MODE || "paystack",
  PAYSTACK_SECRET_KEY: process.env.PAYSTACK_SECRET_KEY || "",
  PAYSTACK_CALLBACK_URL: process.env.PAYSTACK_CALLBACK_URL || "",
  // Email. Provider is auto-detected: BREVO_API_KEY -> brevo, RESEND_API_KEY -> resend, SMTP_URL -> smtp, otherwise console (logs the email).
  EMAIL_PROVIDER: OFFLINE ? "console" : (process.env.EMAIL_PROVIDER || (process.env.BREVO_API_KEY ? "brevo" : process.env.RESEND_API_KEY ? "resend" : process.env.SMTP_URL ? "smtp" : "console")),
  // How users prove their email: "email" (Express sends the link), "firebase" (Firebase sends it; Express checks with Google), or "both"
  VERIFICATION_METHOD: process.env.VERIFICATION_METHOD || "email",
  // Shared secret for the bulk import endpoint (scripts and optional Cloud Function). Leave empty to disable it.
  MIGRATION_SECRET: process.env.MIGRATION_SECRET || "",
  FIREBASE_API_KEY: process.env.FIREBASE_API_KEY || "",
  FIREBASE_LOOKUP_URL: process.env.FIREBASE_LOOKUP_URL || "https://identitytoolkit.googleapis.com/v1/accounts:lookup",
  BREVO_API_KEY: process.env.BREVO_API_KEY || "",
  BREVO_API_URL: process.env.BREVO_API_URL || "https://api.brevo.com/v3/smtp/email",
  RESEND_API_KEY: process.env.RESEND_API_KEY || "",
  RESEND_API_URL: process.env.RESEND_API_URL || "https://api.resend.com/emails",
  SMTP_URL: process.env.SMTP_URL || "",
  MAIL_FROM_EMAIL: process.env.MAIL_FROM_EMAIL || "no-reply@fwan.local",
  MAIL_FROM_NAME: process.env.MAIL_FROM_NAME || "FWAN",
  FRONTEND_URL: (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/$/, ""),
  ADMIN_EMAIL: (process.env.ADMIN_EMAIL || "").toLowerCase(),
  SIM_TRIP_SECONDS: Number(process.env.SIM_TRIP_SECONDS) || 90,
  TRUST_PROXY: bool(process.env.TRUST_PROXY, false),
};

if (env.PAYMENT_MODE === "paystack" && !env.PAYSTACK_SECRET_KEY) {
  console.warn("[warn] PAYMENT_MODE=paystack but PAYSTACK_SECRET_KEY is empty; payment routes return 503 until it is set.");
}
if (env.isProd && env.PAYMENT_MODE === "mock") {
  console.warn("[warn] PAYMENT_MODE=mock in production: payments are simulated and NO money is collected.");
}
