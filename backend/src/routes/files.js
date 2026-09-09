import { Router } from "express";
import { query } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

function mapFile(row) {
  return {
    id: row.id,
    messageId: row.message_id,
    name: row.file_name,
    type: row.mime_type,
    size: row.size_bytes,
    from: row.from_user_id,
    to: row.to_user_id,
    senderName: row.sender_name,
    createdAt: row.created_at instanceof Date ? row.created_at.getTime() : row.created_at,
  };
}

router.get("/", requireAuth, async (req, res) => {
  const { rows } = await query(
    `SELECT a.*, m.from_user_id, m.to_user_id, u.full_name AS sender_name
     FROM message_attachments a
     JOIN messages m ON m.id = a.message_id
     JOIN users u ON u.id = m.from_user_id
     WHERE m.from_user_id = $1 OR m.to_user_id = $1
     ORDER BY a.created_at DESC`,
    [req.user.id]
  );
  res.json({ files: rows.map(mapFile) });
});

router.get("/:id", requireAuth, async (req, res) => {
  const { rows } = await query(
    `SELECT a.*, m.from_user_id, m.to_user_id
     FROM message_attachments a JOIN messages m ON m.id = a.message_id
     WHERE a.id = $1 AND (m.from_user_id = $2 OR m.to_user_id = $2)`,
    [req.params.id, req.user.id]
  );
  const file = rows[0];
  if (!file) return res.status(404).json({ error: "Файл не найден" });
  const safeName = String(file.file_name || "file").replace(/[\r\n"]/g, "_");
  res.setHeader("Content-Type", file.mime_type || "application/octet-stream");
  res.setHeader("Content-Length", String(file.size_bytes));
  res.setHeader("Content-Disposition", `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(safeName)}`);
  res.send(Buffer.from(file.data_base64, "base64"));
});

export default router;
