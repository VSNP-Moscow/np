import { Router } from "express";
import { query, mapMessage, isPostgres } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import crypto from "node:crypto";
import { createNotification } from "../services/notifications.js";

const router = Router();

async function allowedConversation(user, otherId) {
  const { rows } = await query("SELECT id, role, mentor_id, mentor_status FROM users WHERE id = $1", [otherId]);
  const other = rows[0];
  if (!other || other.id === user.id) return null;
  if (user.role === "admin" || other.role === "admin") return other;
  if (user.role === "user" && user.mentorId === other.id && user.mentorStatus === "confirmed") return other;
  if (user.role === "mentor" && other.mentor_id === user.id && other.mentor_status === "confirmed") return other;
  return null;
}

router.get("/:otherId", requireAuth, async (req, res) => {
  if (!await allowedConversation(req.user, req.params.otherId)) return res.status(403).json({ error: "Чат доступен только участникам наставнической пары" });
  const { rows } = await query(
    `SELECT * FROM messages WHERE (from_user_id = $1 AND to_user_id = $2) OR (from_user_id = $2 AND to_user_id = $1)
     ORDER BY created_at ASC`,
    [req.user.id, req.params.otherId]
  );
  await query(
    "UPDATE messages SET read_at = CURRENT_TIMESTAMP WHERE from_user_id = $1 AND to_user_id = $2 AND read_at IS NULL",
    [req.params.otherId, req.user.id]
  );
  const messages = [];
  for (const row of rows) {
    const message = mapMessage(row);
    const attachment = await query(
      "SELECT id, file_name, mime_type, size_bytes FROM message_attachments WHERE message_id = $1",
      [row.id]
    );
    message.attachment = attachment.rows[0] ? {
      id: attachment.rows[0].id,
      name: attachment.rows[0].file_name,
      type: attachment.rows[0].mime_type,
      size: attachment.rows[0].size_bytes,
    } : null;
    messages.push(message);
  }
  res.json({ messages });
});

router.post("/:otherId", requireAuth, async (req, res) => {
  const text = (req.body?.text || "").trim();
  const attachment = req.body?.attachment;
  if (!text && !attachment) return res.status(400).json({ error: "Пустое сообщение" });
  const other = await allowedConversation(req.user, req.params.otherId);
  if (!other) return res.status(403).json({ error: "Чат доступен только участникам наставнической пары" });
  let file = null;
  if (attachment) {
    const name = String(attachment.name || "file").trim().slice(0, 180).replace(/[\\/]/g, "_");
    const type = String(attachment.type || "application/octet-stream").slice(0, 120);
    const raw = String(attachment.data || "").replace(/^data:[^;]+;base64,/, "");
    const data = Buffer.from(raw, "base64");
    if (!name || !raw || !data.length) return res.status(400).json({ error: "Файл повреждён или пуст" });
    if (data.length > 5 * 1024 * 1024) return res.status(413).json({ error: "Максимальный размер файла — 5 МБ" });
    file = { name, type, data };
  }
  const { rows } = await query(
    "INSERT INTO messages (from_user_id, to_user_id, text) VALUES ($1,$2,$3) RETURNING *",
    [req.user.id, req.params.otherId, text || `Файл: ${file.name}`]
  );
  const message = mapMessage(rows[0]);
  if (file) {
    const saved = await query(
      `INSERT INTO message_attachments (message_id, file_name, mime_type, size_bytes, data_bytes, data_base64)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [message.id, file.name, file.type, file.data.length, isPostgres() ? file.data : new Uint8Array(file.data), isPostgres() ? null : ""]
    );
    message.attachment = { id: saved.rows[0].id, name: file.name, type: file.type, size: file.data.length };
  }
  await createNotification(
    req.params.otherId,
    file ? "file" : "message",
    file ? "Новый файл" : "Новое сообщение",
    `${req.user.fullName}: ${file ? file.name : text.slice(0, 140)}`,
    req.user.role === "mentor" ? "#/mentor" : `#/mentees/${req.user.id}`
  );
  res.json({ message });
});

router.post("/:otherId/video-call", requireAuth, async (req, res) => {
  if (!await allowedConversation(req.user, req.params.otherId)) return res.status(403).json({ error: "Видеовстреча доступна только участникам наставнической пары" });
  const pair = [req.user.id, req.params.otherId].sort().join(":");
  const roomCode = crypto.createHash("sha256").update(`${process.env.JWT_SECRET || "navigator"}:${pair}`).digest("hex").slice(0, 24);
  const room = `https://meet.jit.si/NavigatorPedagoga-${roomCode}`;
  const provider = req.body?.provider === "jitsi" ? "jitsi" : "telemost";
  const launchUrl = provider === "telemost" ? "https://telemost.yandex.ru/" : room;
  if (provider === "jitsi") {
    await query(
      "INSERT INTO messages (from_user_id, to_user_id, text) VALUES ($1,$2,$3)",
      [req.user.id, req.params.otherId, `Видеовстреча: ${room}`]
    );
  }
  await createNotification(req.params.otherId, "video", "Приглашение на видеовстречу", `${req.user.fullName} приглашает вас подключиться к видеовстрече (${provider === "telemost" ? "Яндекс Телемост" : "резервный канал"}).`, req.user.role === "mentor" ? "#/mentor" : `#/mentees/${req.user.id}`);
  res.json({ provider, launchUrl, room, requiresLinkShare: provider === "telemost" });
});

export default router;
