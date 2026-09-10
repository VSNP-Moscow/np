import { Router } from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { query, mapUser } from "../db.js";
import { signToken, requireAuth, requireRole } from "../middleware/auth.js";
import { createEmailCode, emailCodeExpiry, hashEmailCode, mailConfigured, sendAccountCode } from "../services/email.js";

const router = Router();
const AVATAR_COLORS = ["purple", "magenta", "yellow", "green"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const codeLimiter = rateLimit({ windowMs: 15 * 60_000, max: 30, standardHeaders: true, legacyHeaders: false });

async function issueCode(user, purpose) {
  const code = createEmailCode();
  await query("UPDATE email_tokens SET used_at = CURRENT_TIMESTAMP WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL", [user.id, purpose]);
  await query("INSERT INTO email_tokens (user_id, purpose, code_hash, expires_at) VALUES ($1,$2,$3,$4)", [user.id, purpose, hashEmailCode(code), emailCodeExpiry(purpose)]);
  let delivery;
  try {
    delivery = await sendAccountCode({ to: user.email, code, purpose });
  } catch (error) {
    console.error(`[email] ${purpose} delivery failed for ${user.id}:`, error.message || error);
    delivery = { sent: false, reason: "delivery_failed" };
  }
  const allowDebugCode = !process.env.DATABASE_URL && process.env.NODE_ENV !== "production";
  return { delivery, debugCode: allowDebugCode ? code : undefined };
}

async function consumeCode(userId, purpose, code) {
  const normalizedCode = String(code || "").replace(/\D/g, "");
  if (normalizedCode.length !== 6) return false;
  const { rows } = await query("SELECT * FROM email_tokens WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL ORDER BY created_at DESC LIMIT 1", [userId, purpose]);
  const token = rows[0];
  if (!token || new Date(token.expires_at).getTime() < Date.now() || Number(token.attempts) >= 5) return false;
  if (token.code_hash !== hashEmailCode(normalizedCode)) {
    await query("UPDATE email_tokens SET attempts = attempts + 1 WHERE id = $1", [token.id]);
    return false;
  }
  await query("UPDATE email_tokens SET used_at = CURRENT_TIMESTAMP WHERE id = $1", [token.id]);
  return true;
}

router.get("/options", async (req, res) => {
  const { rows } = await query("SELECT id, name, short_name, region FROM organizations WHERE active = true ORDER BY name");
  res.json({ organizations: rows, mailDeliveryAvailable: mailConfigured() });
});

router.post("/register", codeLimiter, async (req, res) => {
  const { fullName, email, password, subject, region, school, yearsExperience, role, organizationId } = req.body || {};
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!String(fullName || "").trim() || !EMAIL_RE.test(normalizedEmail) || String(password || "").length < 8) {
    return res.status(400).json({ error: "Укажите имя, корректный email и пароль не короче 8 символов" });
  }
  const exists = await query("SELECT id FROM users WHERE lower(email) = lower($1)", [normalizedEmail]);
  if (exists.rows.length) return res.status(409).json({ error: "Пользователь с такой почтой уже существует" });
  if (organizationId) {
    const org = await query("SELECT id FROM organizations WHERE id = $1 AND active = true", [organizationId]);
    if (!org.rows[0]) return res.status(400).json({ error: "Выбранная организация недоступна" });
  }
  const passwordHash = await bcrypt.hash(password, 12);
  const finalRole = role === "mentor" ? "mentor" : "user";
  const scores = { subject: 0, pedagogy: 0, method: 0, digital: 0, communication: 0, personal: 0 };
  const { rows } = await query(
    `INSERT INTO users (full_name, email, password_hash, role, subject, school, region, years_experience, current_stage, approved_by_admin, scores, avatar_color, email_verified, organization_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1,false,$9,$10,false,$11) RETURNING *`,
    [String(fullName).trim(), normalizedEmail, passwordHash, finalRole, subject || "", school || "", region || "", parseInt(yearsExperience, 10) || 0, JSON.stringify(scores), AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)], organizationId || null]
  );
  const user = rows[0];
  res.locals.auditUserId = user.id;
  const result = await issueCode(user, "verify_email");
  res.status(201).json({ verificationRequired: true, email: normalizedEmail, mailSent: result.delivery.sent, debugCode: result.debugCode });
});

router.post("/verify-email", codeLimiter, async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const { rows } = await query("SELECT * FROM users WHERE lower(email) = lower($1)", [email]);
  const user = rows[0];
  if (!user || !(await consumeCode(user.id, "verify_email", String(req.body?.code || "")))) return res.status(400).json({ error: "Код неверен или истёк" });
  const updated = await query("UPDATE users SET email_verified = true WHERE id = $1 RETURNING *", [user.id]);
  res.locals.auditUserId = user.id;
  res.json({ token: signToken(user.id), user: mapUser(updated.rows[0]) });
});

router.post("/resend-verification", codeLimiter, async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const { rows } = await query("SELECT * FROM users WHERE lower(email) = lower($1) AND email_verified = false", [email]);
  if (!rows[0]) return res.json({ ok: true });
  const result = await issueCode(rows[0], "verify_email");
  res.json({ ok: true, mailSent: result.delivery.sent, debugCode: result.debugCode });
});

router.post("/forgot-password", codeLimiter, async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const { rows } = await query("SELECT * FROM users WHERE lower(email) = lower($1)", [email]);
  let result = null;
  if (rows[0]) result = await issueCode(rows[0], "reset_password");
  res.json({ ok: true, message: "Если аккаунт существует, код отправлен на почту", debugCode: result?.debugCode });
});

router.post("/reset-password", codeLimiter, async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  if (password.length < 8) return res.status(400).json({ error: "Пароль должен быть не короче 8 символов" });
  const { rows } = await query("SELECT * FROM users WHERE lower(email) = lower($1)", [email]);
  const user = rows[0];
  if (!user || !(await consumeCode(user.id, "reset_password", String(req.body?.code || "")))) return res.status(400).json({ error: "Код неверен или истёк" });
  await query("UPDATE users SET password_hash = $1 WHERE id = $2", [await bcrypt.hash(password, 12), user.id]);
  res.locals.auditUserId = user.id;
  res.json({ ok: true });
});

router.post("/mail-test", requireAuth, requireRole("admin"), codeLimiter, async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: "Укажите корректный email" });
  const delivery = await sendAccountCode({ to: email, code: createEmailCode(), purpose: "verify_email" });
  if (!delivery.sent) return res.status(503).json({ error: "SMTP не настроен" });
  res.json({ sent: true, provider: delivery.provider });
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body || {};
  const { rows } = await query("SELECT * FROM users WHERE lower(email) = lower($1)", [email || ""]);
  const user = rows[0];
  if (!user || !(await bcrypt.compare(password || "", user.password_hash))) return res.status(401).json({ error: "Неверная почта или пароль" });
  if (!user.email_verified) return res.status(403).json({ error: "Подтвердите электронную почту", code: "EMAIL_NOT_VERIFIED" });
  res.locals.auditUserId = user.id;
  res.json({ token: signToken(user.id), user: mapUser(user) });
});

router.get("/me", requireAuth, (req, res) => res.json({ user: req.user }));

export default router;
