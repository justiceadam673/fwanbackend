import { env } from "../config/env.js";

// Sends email through the configured provider. Never throws: returns { sent, provider, error? }
// so a mail outage cannot break registration (the user can press "resend").
async function viaHttp(url, headers, payload, provider) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", ...headers }, body: JSON.stringify(payload), signal: AbortSignal.timeout(15_000) });
  if (!res.ok) { const body = await res.text().catch(() => ""); throw new Error(`${provider} responded ${res.status}: ${body.slice(0, 200)}`); }
}

export async function sendMail({ to, subject, text, html }) {
  const provider = env.EMAIL_PROVIDER;
  try {
    if (provider === "brevo") {
      if (!env.BREVO_API_KEY) throw new Error("BREVO_API_KEY is empty");
      await viaHttp(env.BREVO_API_URL, { "api-key": env.BREVO_API_KEY },
        { sender: { name: env.MAIL_FROM_NAME, email: env.MAIL_FROM_EMAIL }, to: [{ email: to }], subject, htmlContent: html, textContent: text }, "Brevo");
    } else if (provider === "resend") {
      if (!env.RESEND_API_KEY) throw new Error("RESEND_API_KEY is empty");
      await viaHttp(env.RESEND_API_URL, { Authorization: `Bearer ${env.RESEND_API_KEY}` },
        { from: `${env.MAIL_FROM_NAME} <${env.MAIL_FROM_EMAIL}>`, to: [to], subject, html, text }, "Resend");
    } else if (provider === "smtp") {
      const nodemailer = (await import("nodemailer")).default;
      await nodemailer.createTransport(env.SMTP_URL).sendMail({ from: `"${env.MAIL_FROM_NAME}" <${env.MAIL_FROM_EMAIL}>`, to, subject, text, html });
    } else {
      console.log(`[mail:console] to=${to} subject="${subject}"\n${text}\n`);
      return { sent: false, provider: "console" };
    }
    return { sent: true, provider };
  } catch (e) {
    console.warn(`[warn] email to ${to} failed via ${provider}: ${e.message}`);
    return { sent: false, provider, error: e.message };
  }
}
