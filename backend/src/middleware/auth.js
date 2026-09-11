import jwt from "jsonwebtoken";
import { query, mapUser } from "../db.js";

const SECRET = process.env.JWT_SECRET || "dev-insecure-secret-change-me";

export function signToken(userId) {
  return jwt.sign({ uid: userId }, SECRET, { expiresIn: "30d" });
}

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Нет токена авторизации" });
  let payload;
  try {
    payload = jwt.verify(token, SECRET);
  } catch {
    return res.status(401).json({ error: "Недействительный токен" });
  }
  try {
    // Polling needs profile metadata, never the potentially megabyte-sized photo.
    const { rows } = await query(`SELECT id, full_name, email, password_hash, role,
      subject, school, region, years_experience, current_stage, mentor_id,
      mentor_status, approved_by_admin, scores, avatar_color, email_verified,
      organization_id, avatar_mime, avatar_updated_at, coins, xp, created_at,
      CASE WHEN avatar_bytes IS NULL THEN NULL ELSE 1 END AS avatar_bytes
      FROM users WHERE id = $1`, [payload.uid]);
    if (!rows[0]) return res.status(401).json({ error: "Пользователь не найден" });
    req.user = mapUser(rows[0]);
    req.dbUser = rows[0]; // сырая строка (с password_hash) — на случай если понадобится в защищённых роутах
    next();
  } catch (e) {
    return next(e);
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (req.user.role !== "admin" && !roles.includes(req.user.role)) return res.status(403).json({ error: "Недостаточно прав" });
    next();
  };
}
