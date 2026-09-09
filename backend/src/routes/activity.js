import { Router } from "express";
import { query } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

router.get("/", requireAuth, async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const admin = req.user.role === "admin";
  const { rows } = await query(
    `SELECT a.id, a.user_id, a.method, a.path, a.status_code, a.created_at,
            u.full_name AS user_name
       FROM activity_log a
       LEFT JOIN users u ON u.id = a.user_id
      ${admin ? "" : "WHERE a.user_id = $1"}
      ORDER BY a.created_at DESC
      LIMIT ${limit}`,
    admin ? [] : [req.user.id]
  );
  res.json({ activities: rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    userName: row.user_name,
    method: row.method,
    path: row.path,
    statusCode: row.status_code,
    createdAt: row.created_at instanceof Date ? row.created_at.getTime() : row.created_at,
  })) });
});

export default router;
