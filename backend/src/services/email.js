import crypto from "node:crypto";
import nodemailer from "nodemailer";

const CODE_TTL = { verify_email: 15 * 60_000, reset_password: 30 * 60_000 };

export function createEmailCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashEmailCode(code) {
  return crypto.createHmac("sha256", process.env.EMAIL_TOKEN_SECRET || process.env.JWT_SECRET || "navigator-local")
    .update(String(code)).digest("hex");
}

export function emailCodeExpiry(purpose) {
  return new Date(Date.now() + (CODE_TTL[purpose] || CODE_TTL.verify_email));
}

export function mailConfigured() {
  const senderConfigured = Boolean(process.env.MAIL_FROM);
  const httpConfigured = Boolean(process.env.MAIL_RELAY_URL && process.env.MAIL_RELAY_SECRET) || Boolean(process.env.BREVO_API_KEY);
  return senderConfigured && (httpConfigured || hasSmtpConfiguration());
}

function hasSmtpConfiguration() {
  return process.env.SMTP_ENABLED === "true" && Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function transporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE).toLowerCase() === "true",
    family: 4,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
}

async function sendViaBrevo({ to, subject, text, html }) {
  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      accept: "application/json",
      "api-key": process.env.BREVO_API_KEY,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      sender: { email: process.env.MAIL_FROM, name: "НавигаторПедагога" },
      to: [{ email: to }],
      replyTo: { email: process.env.MAIL_REPLY_TO || process.env.MAIL_FROM, name: "Поддержка НавигаторПедагога" },
      subject,
      textContent: text,
      htmlContent: html,
      tags: ["account-code"],
      headers: { "X-Entity-Ref-ID": crypto.randomUUID() },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const details = await response.text();
  if (!response.ok) {
    throw new Error(`Brevo delivery failed (${response.status}): ${details.slice(0, 300)}`);
  }
  try { return JSON.parse(details); } catch { return {}; }
}

async function sendViaRelay({ to, subject, text, html }) {
  const response = await fetch(process.env.MAIL_RELAY_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.MAIL_RELAY_SECRET}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      to,
      subject,
      text,
      html,
      replyTo: process.env.MAIL_REPLY_TO || process.env.MAIL_FROM,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`Mail relay delivery failed (${response.status})`);
  }
}

export async function sendAccountCode({ to, code, purpose }) {
  if (!mailConfigured()) return { sent: false, reason: "mail_not_configured" };
  const isVerify = purpose === "verify_email";
  const title = isVerify ? "Подтверждение электронной почты" : "Восстановление пароля";
  const action = isVerify ? "подтверждения почты" : "восстановления пароля";
  const message = {
    from: process.env.MAIL_FROM,
    to,
    subject: `${title} - НавигаторПедагога`,
    text: `НавигаторПедагога\n\nКод ${action}: ${code}\n\nОн действует ${isVerify ? "15" : "30"} минут и используется один раз. Если вы не запрашивали код, просто проигнорируйте письмо.`,
    html: `<div style="display:none;max-height:0;overflow:hidden">Код для сервиса НавигаторПедагога: ${code}</div><div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:24px;color:#18201e"><div style="font-size:14px;font-weight:700;color:#087f8c">НАВИГАТОРПЕДАГОГА</div><h2 style="margin:18px 0 8px">${title}</h2><p style="margin:0 0 18px;color:#56615e">Введите этот код в открытой форме сервиса:</p><p style="margin:0 0 18px;padding:16px 18px;border:1px solid #d8dedc;background:#f5f7f6;font-size:30px;font-weight:700;letter-spacing:6px">${code}</p><p style="margin:0;color:#56615e">Код действует ${isVerify ? "15" : "30"} минут и используется один раз.</p></div>`,
  };
  if (process.env.MAIL_RELAY_URL && process.env.MAIL_RELAY_SECRET) {
    try {
      await sendViaRelay(message);
      return { sent: true, provider: "cloudflare-yandex", messageId: null };
    } catch (error) {
      if (!hasSmtpConfiguration() && !process.env.BREVO_API_KEY) throw error;
      console.error("[email] Cloudflare relay failed, using fallback:", error.message || error);
    }
  }
  if (hasSmtpConfiguration()) {
    try {
      const result = await transporter().sendMail(message);
      return { sent: true, provider: "smtp", messageId: result.messageId || null };
    } catch (error) {
      if (!process.env.BREVO_API_KEY) throw error;
      console.error("[email] Primary SMTP failed, using Brevo fallback:", error.message || error);
    }
  }
  if (process.env.BREVO_API_KEY) {
    const result = await sendViaBrevo(message);
    return { sent: true, provider: "brevo", messageId: result.messageId || null };
  }
  return { sent: false, reason: "mail_not_configured" };
}
