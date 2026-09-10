import { COMPETENCIES, query } from "../db.js";
import { getOrGeneratePortfolio } from "./aiFeatures.js";

export async function buildPortfolioData(user, force = false, includeAvatar = false) {
  const text = await getOrGeneratePortfolio(user, force);
  const [completed, progress, notes, items, assignments, mentor, avatar] = await Promise.all([
    query(`SELECT e.title, e.area, e.event_date, ec.reflection, ec.completed_at
           FROM event_completions ec JOIN events e ON e.id = ec.event_id
           WHERE ec.user_id = $1 ORDER BY ec.completed_at DESC`, [user.id]),
    query(`SELECT competency_id, event_title, report_text, usefulness_rating, mentor_rating, updated_at
           FROM roadmap_progress WHERE user_id = $1 AND status <> 'open' ORDER BY updated_at DESC`, [user.id]),
    query("SELECT title, content, category, updated_at FROM notes WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 12", [user.id]),
    query("SELECT * FROM portfolio_items WHERE user_id = $1 ORDER BY created_at DESC", [user.id]),
    query(`SELECT a.title, a.description, t.status, t.score, t.total, t.submitted_at
           FROM assignment_targets t JOIN assignments a ON a.id = t.assignment_id
           WHERE t.user_id = $1 AND t.status <> 'assigned' ORDER BY t.submitted_at DESC`, [user.id]),
    user.mentorId ? query("SELECT full_name, subject FROM users WHERE id = $1", [user.mentorId]) : Promise.resolve({ rows: [] }),
    includeAvatar ? query("SELECT avatar_mime, avatar_bytes FROM users WHERE id = $1", [user.id]) : Promise.resolve({ rows: [] }),
  ]);
  const scores = COMPETENCIES.map((competency) => ({
    ...competency,
    value: Number(user.scores?.[competency.id] || 0),
  }));
  const ranked = scores.filter((item) => item.value > 0).sort((a, b) => b.value - a.value);
  return {
    generatedAt: new Date().toISOString(),
    profile: {
      fullName: user.fullName,
      subject: user.subject || "Не указан",
      school: user.school || "Не указана",
      region: user.region || "Не указан",
      yearsExperience: Number(user.yearsExperience || 0),
      stage: Number(user.currentStage || 1),
      mentor: mentor.rows[0]?.full_name || null,
      avatarMime: avatar.rows[0]?.avatar_mime || null,
      avatarBytes: avatar.rows[0]?.avatar_bytes || null,
    },
    summary: text,
    scores,
    strengths: ranked.slice(0, 2).map((item) => item.label),
    growthAreas: [...ranked].reverse().slice(0, 2).map((item) => item.label),
    metrics: {
      completedEvents: completed.rows.length,
      submittedReports: progress.rows.length,
      completedAssignments: assignments.rows.length,
      portfolioItems: items.rows.length,
    },
    evidence: {
      events: completed.rows,
      reports: progress.rows,
      assignments: assignments.rows,
      reflections: notes.rows,
      items: items.rows.map((row) => ({
        id: row.id,
        category: row.category,
        title: row.title,
        description: row.description,
        date: row.item_date,
        url: row.url,
        createdAt: row.created_at,
      })),
    },
  };
}
