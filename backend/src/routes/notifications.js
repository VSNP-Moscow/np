import { Router } from "express";
import { query } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { mapNotification } from "../services/notifications.js";

const router = Router();

router.get("/", requireAuth, async (req, res) => {
  const { rows } = await query(
    "SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 80",
    [req.user.id]
  );
  res.json({
    notifications: rows.map(mapNotification),
    unread: rows.filter((row) => !row.read_at).length,
  });
});

router.post("/read-all", requireAuth, async (req, res) => {
  await query("UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE user_id = $1 AND read_at IS NULL", [req.user.id]);
  res.json({ ok: true });
});

router.post("/:id/read", requireAuth, async (req, res) => {
  const { rows } = await query(
    "UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE id = $1 AND user_id = $2 RETURNING *",
    [req.params.id, req.user.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "Уведомление не найдено" });
  res.json({ notification: mapNotification(rows[0]) });
});

export default router;
