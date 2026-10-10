import { env } from "../config/env.js";

// Sends email when SMTP_URL is configured and nodemailer is installed; otherwise logs (dev/offline).
export async function sendMail({ to, subject, text }) {
  if (env.OFFLINE || !env.SMTP_URL) {
    console.log(`[mail:console] to=${to} subject="${subject}"\n${text}\n`);
    return { sent: false };
  }
  try {
    const nodemailer = (await import("nodemailer")).default;
    await nodemailer.createTransport(env.SMTP_URL).sendMail({ from: env.MAIL_FROM, to, subject, text });
    return { sent: true };
  } catch (e) {
    console.warn(`[warn] email not sent (${e.message}). Install nodemailer and check SMTP_URL.`);
    return { sent: false };
  }
}
