import { Router } from "express";
import { query } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();
const HEX = /^#[0-9a-f]{6}$/i;

function mapOrganization(row) {
  return {
    id: row.id, name: row.name, shortName: row.short_name || "", region: row.region || "",
    domain: row.domain || "", active: Boolean(row.active),
  };
}

function mapTheme(row, organizationId) {
  return {
    organizationId,
    productName: row?.product_name || "НавигаторПедагога",
    primaryColor: row?.primary_color || "#5b35d5",
    accentColor: row?.accent_color || "#d52d75",
    surfaceColor: row?.surface_color || "#ffffff",
    fontScale: Number(row?.font_scale || 1),
    compactMode: Boolean(row?.compact_mode),
    welcomeText: row?.welcome_text || "",
  };
}

router.get("/", requireAuth, async (req, res) => {
  const where = req.user.role === "admin" ? "" : " WHERE active = true";
  const { rows } = await query(`SELECT * FROM organizations${where} ORDER BY name`);
  res.json({ organizations: rows.map(mapOrganization) });
});

router.post("/", requireAuth, requireRole("admin"), async (req, res) => {
  const { name, shortName, region, domain } = req.body || {};
  if (!String(name || "").trim()) return res.status(400).json({ error: "Укажите название организации" });
  const { rows } = await query(
    "INSERT INTO organizations (name, short_name, region, domain) VALUES ($1,$2,$3,$4) RETURNING *",
    [String(name).trim(), String(shortName || "").trim(), String(region || "").trim(), String(domain || "").trim().toLowerCase()]
  );
  res.status(201).json({ organization: mapOrganization(rows[0]) });
});

router.put("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  const { name, shortName, region, domain, active } = req.body || {};
  if (!String(name || "").trim()) return res.status(400).json({ error: "Укажите название организации" });
  const { rows } = await query(
    "UPDATE organizations SET name=$1, short_name=$2, region=$3, domain=$4, active=$5, updated_at=CURRENT_TIMESTAMP WHERE id=$6 RETURNING *",
    [String(name).trim(), shortName || "", region || "", String(domain || "").toLowerCase(), active !== false, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "Организация не найдена" });
  res.json({ organization: mapOrganization(rows[0]) });
});

router.delete("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  const { rows } = await query("UPDATE organizations SET active=false, updated_at=CURRENT_TIMESTAMP WHERE id=$1 RETURNING *", [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "Организация не найдена" });
  res.json({ organization: mapOrganization(rows[0]) });
});

router.get("/:id/theme", requireAuth, async (req, res) => {
  if (req.user.role !== "admin" && req.user.organizationId !== req.params.id) return res.status(403).json({ error: "Недостаточно прав" });
  const { rows } = await query("SELECT * FROM organization_themes WHERE organization_id=$1", [req.params.id]);
  res.json({ theme: mapTheme(rows[0], req.params.id) });
});

router.put("/:id/theme", requireAuth, requireRole("admin"), async (req, res) => {
  const payload = req.body || {};
  for (const color of [payload.primaryColor, payload.accentColor, payload.surfaceColor]) {
    if (color && !HEX.test(color)) return res.status(400).json({ error: "Цвет должен быть в формате #RRGGBB" });
  }
  const scale = Math.min(1.15, Math.max(0.9, Number(payload.fontScale || 1)));
  const values = [req.params.id, String(payload.productName || "НавигаторПедагога").slice(0, 80), payload.primaryColor || "#5b35d5", payload.accentColor || "#d52d75", payload.surfaceColor || "#ffffff", scale, Boolean(payload.compactMode), String(payload.welcomeText || "").slice(0, 300), req.user.id];
  const { rows } = await query(
    `INSERT INTO organization_themes (organization_id, product_name, primary_color, accent_color, surface_color, font_scale, compact_mode, welcome_text, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (organization_id) DO UPDATE SET product_name=$2, primary_color=$3, accent_color=$4, surface_color=$5, font_scale=$6, compact_mode=$7, welcome_text=$8, updated_by=$9, updated_at=CURRENT_TIMESTAMP RETURNING *`,
    values
  );
  res.json({ theme: mapTheme(rows[0], req.params.id) });
});

router.get("/:id/overview", requireAuth, requireRole("admin"), async (req, res) => {
  const users = await query(
    `SELECT COUNT(*) AS total,
      SUM(CASE WHEN role='user' THEN 1 ELSE 0 END) AS teachers,
      SUM(CASE WHEN role='mentor' THEN 1 ELSE 0 END) AS mentors,
      SUM(CASE WHEN approved_by_admin=false THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN email_verified=false THEN 1 ELSE 0 END) AS unverified
     FROM users WHERE organization_id=$1`, [req.params.id]
  );
  const reports = await query("SELECT COUNT(*) AS reports FROM roadmap_progress p JOIN users u ON u.id=p.user_id WHERE u.organization_id=$1 AND p.status IN ('reported','rated')", [req.params.id]);
  const roadmaps = await query("SELECT COUNT(*) AS roadmaps FROM roadmaps r JOIN users u ON u.id=r.user_id WHERE u.organization_id=$1", [req.params.id]);
  res.json({ overview: { ...users.rows[0], reports: Number(reports.rows[0].reports || 0), roadmaps: Number(roadmaps.rows[0].roadmaps || 0) } });
});

export default router;
