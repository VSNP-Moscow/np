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
  const httpConfigured = Boolean(process.env.BREVO_API_KEY);
  const smtpConfigured = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
  return senderConfigured && (httpConfigured || smtpConfigured);
}

function transporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE).toLowerCase() === "true",
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
      subject,
      textContent: text,
      htmlContent: html,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Brevo delivery failed (${response.status}): ${details.slice(0, 300)}`);
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
    subject: `${code} - ${title}`,
    text: `Код ${action}: ${code}. Он действует ${isVerify ? "15" : "30"} минут. Если вы не запрашивали код, проигнорируйте письмо.`,
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto"><h2>${title}</h2><p>Ваш код:</p><p style="font-size:30px;font-weight:700;letter-spacing:6px">${code}</p><p>Код действует ${isVerify ? "15" : "30"} минут и используется один раз.</p></div>`,
  };
  if (process.env.BREVO_API_KEY) {
    await sendViaBrevo(message);
    return { sent: true, provider: "brevo" };
  }
  await transporter().sendMail(message);
  return { sent: true, provider: "smtp" };
}
