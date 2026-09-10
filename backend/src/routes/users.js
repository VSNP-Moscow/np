import { Router } from "express";
import { query, mapUser } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { cacheInvalidate } from "../cache.js";
import { createNotification } from "../services/notifications.js";

const router = Router();
const AVATAR_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

router.put("/me", requireAuth, async (req, res) => {
  const { fullName, subject, school, region, yearsExperience, currentStage } = req.body || {};
  const fields = [];
  const values = [];
  let i = 1;
  if (fullName) { fields.push(`full_name = $${i++}`); values.push(fullName); }
  if (subject !== undefined) { fields.push(`subject = $${i++}`); values.push(subject); }
  if (school !== undefined) { fields.push(`school = $${i++}`); values.push(school); }
  if (region !== undefined) { fields.push(`region = $${i++}`); values.push(region); }
  if (yearsExperience !== undefined) { fields.push(`years_experience = $${i++}`); values.push(parseInt(yearsExperience, 10) || 0); }
  if (currentStage !== undefined) {
    const stage = Number(currentStage);
    if (!Number.isInteger(stage) || stage < 1 || stage > 6) return res.status(400).json({ error: "Этап должен быть целым числом от 1 до 6" });
    fields.push(`current_stage = $${i++}`); values.push(stage);
  }
  if (!fields.length) return res.json({ user: req.user });
  values.push(req.user.id);
  const { rows } = await query(`UPDATE users SET ${fields.join(", ")} WHERE id = $${i} RETURNING *`, values);
  res.json({ user: mapUser(rows[0]) });
});

router.put("/me/avatar", requireAuth, async (req, res) => {
  const mime = String(req.body?.mime || "").toLowerCase();
  const encoded = String(req.body?.dataBase64 || "").replace(/^data:[^;]+;base64,/, "");
  if (!AVATAR_TYPES.has(mime)) return res.status(400).json({ error: "Разрешены изображения JPEG, PNG и WebP" });
  let bytes;
  try { bytes = Buffer.from(encoded, "base64"); } catch { return res.status(400).json({ error: "Повреждённое изображение" }); }
  if (!bytes.length || bytes.length > MAX_AVATAR_BYTES) return res.status(400).json({ error: "Размер фотографии должен быть не более 2 МБ" });
  const signatures = {
    "image/jpeg": bytes[0] === 0xff && bytes[1] === 0xd8,
    "image/png": bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    "image/webp": bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP",
  };
  if (!signatures[mime]) return res.status(400).json({ error: "Содержимое файла не соответствует формату" });
  const { rows } = await query("UPDATE users SET avatar_mime=$1, avatar_bytes=$2, avatar_updated_at=CURRENT_TIMESTAMP WHERE id=$3 RETURNING *", [mime, bytes, req.user.id]);
  res.json({ user: mapUser(rows[0]) });
});

router.delete("/me/avatar", requireAuth, async (req, res) => {
  const { rows } = await query("UPDATE users SET avatar_mime=NULL, avatar_bytes=NULL, avatar_updated_at=CURRENT_TIMESTAMP WHERE id=$1 RETURNING *", [req.user.id]);
  res.json({ user: mapUser(rows[0]) });
});

router.get("/leaderboard", requireAuth, async (req, res) => {
  const { rows } = await query(
    `SELECT id, full_name, email, role, subject, school, region, years_experience, current_stage,
            mentor_id, mentor_status, approved_by_admin, scores, avatar_color, avatar_mime,
            CASE WHEN avatar_bytes IS NULL THEN NULL ELSE 1 END AS avatar_bytes,
            avatar_updated_at, coins, xp, created_at
     FROM users
     WHERE role = 'user' AND email_verified = true
     ORDER BY xp DESC, coins DESC, full_name ASC
     LIMIT 100`
  );
  res.json({
    leaders: rows.map((row, index) => {
      const user = mapUser(row);
      return { ...user, rank: index + 1, level: Math.floor(Number(user.xp || 0) / 100) + 1 };
    }),
  });
});

router.get("/:id/avatar", async (req, res) => {
  const { rows } = await query("SELECT avatar_mime, avatar_bytes, avatar_updated_at FROM users WHERE id=$1", [req.params.id]);
  const avatar = rows[0];
  if (!avatar?.avatar_mime || !avatar?.avatar_bytes) return res.status(404).json({ error: "Фотография не найдена" });
  const bytes = Buffer.isBuffer(avatar.avatar_bytes) ? avatar.avatar_bytes : Buffer.from(avatar.avatar_bytes);
  res.setHeader("Content-Type", avatar.avatar_mime);
  res.setHeader("Cache-Control", "private, max-age=86400");
  res.send(bytes);
});

// list users by role — admins see everyone; mentors see their confirmed mentees;
// молодой педагог, выбирающий наставника, может запросить список подтверждённых наставников (role=mentor).
router.get("/", requireAuth, async (req, res) => {
  const { role } = req.query;
  if (req.user.role === "admin") {
    const { rows } = await query("SELECT * FROM users" + (role ? " WHERE role = $1" : "") + " ORDER BY created_at DESC", role ? [role] : []);
    return res.json({ users: rows.map(mapUser) });
  }
  if (req.user.role === "mentor") {
    const status = req.query.status === "pending" ? "pending" : "confirmed";
    const { rows } = await query("SELECT * FROM users WHERE mentor_id = $1 AND mentor_status = $2 ORDER BY created_at DESC", [req.user.id, status]);
    return res.json({ users: rows.map(mapUser) });
  }
  // req.user.role === 'user'
  if (role === "mentor") {
    const { rows } = await query("SELECT * FROM users WHERE role = 'mentor' AND approved_by_admin = true ORDER BY created_at DESC");
    return res.json({ users: rows.map(mapUser) });
  }
  return res.status(403).json({ error: "Недостаточно прав" });
});

router.get("/:id", requireAuth, async (req, res) => {
  const { rows } = await query("SELECT * FROM users WHERE id = $1", [req.params.id]);
  const u = rows[0];
  if (!u) return res.status(404).json({ error: "Не найден" });
  const canView = req.user.role === "admin" || req.user.id === u.id || u.mentor_id === req.user.id || req.user.mentorId === u.id;
  if (!canView) return res.status(403).json({ error: "Недостаточно прав" });
  res.json({ user: mapUser(u) });
});

// Прямое назначение наставника администратором (в обход запроса/подтверждения).
router.put("/:id/mentor", requireAuth, requireRole("admin"), async (req, res) => {
  const mentorId = req.body?.mentorId || null;
  const { rows } = await query(
    "UPDATE users SET mentor_id = $1, mentor_status = $2, current_stage = GREATEST(current_stage, 2) WHERE id = $3 RETURNING *",
    [mentorId, mentorId ? "confirmed" : null, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "Не найден" });
  res.json({ user: mapUser(rows[0]) });
});

// Подтверждение профиля администрацией — обязательный шаг из ТЗ диссертации.
router.put("/:id/approval", requireAuth, requireRole("admin"), async (req, res) => {
  const approved = req.body?.approved !== false;
  const { rows } = await query("UPDATE users SET approved_by_admin = $1 WHERE id = $2 RETURNING *", [approved, req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "Не найден" });
  res.json({ user: mapUser(rows[0]) });
});

router.put("/:id/admin", requireAuth, requireRole("admin"), async (req, res) => {
  const { role, organizationId, approved } = req.body || {};
  if (role && !["user", "mentor", "admin"].includes(role)) return res.status(400).json({ error: "Недопустимая роль" });
  if (organizationId) {
    const organization = await query("SELECT id FROM organizations WHERE id=$1", [organizationId]);
    if (!organization.rows[0]) return res.status(400).json({ error: "Организация не найдена" });
  }
  const { rows } = await query(
    "UPDATE users SET role=COALESCE($1,role), organization_id=$2, approved_by_admin=COALESCE($3,approved_by_admin) WHERE id=$4 RETURNING *",
    [role || null, organizationId || null, approved === undefined ? null : Boolean(approved), req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "Пользователь не найден" });
  res.json({ user: mapUser(rows[0]) });
});

// Создание пары «наставник-наставляемый» по алгоритму из диссертации (гл. 3.3, п.3-4):
// молодой педагог отправляет запрос -> наставник подтверждает или отклоняет.
router.post("/mentors/:mentorId/request", requireAuth, requireRole("user"), async (req, res) => {
  const mentor = await query("SELECT id FROM users WHERE id = $1 AND role = 'mentor' AND approved_by_admin = true", [req.params.mentorId]);
  if (!mentor.rows[0]) return res.status(404).json({ error: "Наставник не найден" });
  const { rows } = await query(
    "UPDATE users SET mentor_id = $1, mentor_status = 'pending' WHERE id = $2 RETURNING *",
    [req.params.mentorId, req.user.id]
  );
  await createNotification(req.params.mentorId, "mentor", "Новая заявка на наставничество", `${req.user.fullName} хочет стать вашим подопечным.`, `#/mentees/${req.user.id}`);
  res.json({ user: mapUser(rows[0]) });
});

router.post("/mentees/:menteeId/confirm", requireAuth, requireRole("mentor"), async (req, res) => {
  const { rows } = await query(
    "UPDATE users SET mentor_status = 'confirmed', current_stage = GREATEST(current_stage, 2) WHERE id = $1 AND mentor_id = $2 AND mentor_status = 'pending' RETURNING *",
    [req.params.menteeId, req.user.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "Заявка не найдена" });
  await createNotification(req.params.menteeId, "mentor", "Наставник подтвердил заявку", `${req.user.fullName} подтвердил вашу пару. Теперь доступны чат, файлы и видеовстречи.`, "#/mentor");
  res.json({ user: mapUser(rows[0]) });
});

router.post("/mentees/:menteeId/decline", requireAuth, requireRole("mentor"), async (req, res) => {
  const { rows } = await query(
    "UPDATE users SET mentor_id = NULL, mentor_status = NULL WHERE id = $1 AND mentor_id = $2 AND mentor_status = 'pending' RETURNING *",
    [req.params.menteeId, req.user.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "Заявка не найдена" });
  await createNotification(req.params.menteeId, "mentor", "Заявка отклонена", `${req.user.fullName} не смог принять заявку. Вы можете выбрать другого наставника.`, "#/mentor");
  res.json({ user: mapUser(rows[0]) });
});

router.delete("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  await query("DELETE FROM users WHERE id = $1", [req.params.id]);
  cacheInvalidate("events:"); // события этого пользователя как создателя каскадно уходят из кэша тоже
  res.json({ ok: true });
});

export default router;
