import { query } from "../db.js";

export async function createNotification(userId, type, title, body = "", link = null) {
  if (!userId) return null;
  const { rows } = await query(
    `INSERT INTO notifications (user_id, type, title, body, link)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [userId, type || "info", title, body || "", link || null]
  );
  return rows[0] || null;
}

export function mapNotification(row) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    link: row.link,
    read: Boolean(row.read_at),
    createdAt: row.created_at instanceof Date ? row.created_at.getTime() : row.created_at,
  };
}
