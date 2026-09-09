import { Router } from "express";
import { query } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

const COMPETENCIES = [
  ["subject", "Предметные"],
  ["pedagogy", "Психолого-педагогические"],
  ["method", "Методические"],
  ["digital", "Цифровые / ИКТ"],
  ["communication", "Коммуникативные"],
  ["personal", "Личностные"],
];

async function count(sql, params = []) {
  const { rows } = await query(sql, params);
  return Number(rows[0]?.n || 0);
}

function averageCompetencies(users) {
  return COMPETENCIES.map(([id, label]) => {
    const values = users.map((u) => Number(u.scores?.[id] || 0)).filter((value) => value > 0);
    const value = values.length ? Math.round((values.reduce((sum, item) => sum + item, 0) / values.length) * 10) / 10 : 0;
    return { id, label, value };
  });
}

async function buildReport(user) {
  let people = [];
  if (user.role === "admin") {
    people = (await query("SELECT id, full_name, subject, region, current_stage, mentor_id, scores FROM users WHERE role = 'user' ORDER BY full_name")).rows;
  } else if (user.role === "mentor") {
    people = (await query("SELECT id, full_name, subject, region, current_stage, mentor_id, scores FROM users WHERE mentor_id = $1 AND mentor_status = 'confirmed' ORDER BY full_name", [user.id])).rows;
  } else {
    people = [{ id: user.id, full_name: user.fullName, subject: user.subject, region: user.region, current_stage: user.currentStage, mentor_id: user.mentorId, scores: user.scores }];
  }

  const ids = people.map((person) => person.id);
  const rows = people.map((person) => ({
    id: person.id,
    name: person.full_name,
    subject: person.subject || "—",
    region: person.region || "—",
    stage: Number(person.current_stage || 1),
    average: (() => {
      const values = Object.values(person.scores || {}).map(Number).filter((value) => value > 0);
      return values.length ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10 : 0;
    })(),
    hasMentor: Boolean(person.mentor_id),
  }));

  const totalUsers = user.role === "admin" ? await count("SELECT COUNT(*) AS n FROM users") : rows.length;
  let completedEvents, submittedReports, messages, files, portfolios;
  if (user.role === "user") {
    completedEvents = await count("SELECT COUNT(*) AS n FROM event_completions WHERE user_id = $1", [user.id]);
    submittedReports = await count("SELECT COUNT(*) AS n FROM roadmap_progress WHERE user_id = $1 AND status <> 'open'", [user.id]);
    messages = await count("SELECT COUNT(*) AS n FROM messages WHERE from_user_id = $1 OR to_user_id = $1", [user.id]);
    files = await count("SELECT COUNT(*) AS n FROM message_attachments a JOIN messages m ON m.id = a.message_id WHERE m.from_user_id = $1 OR m.to_user_id = $1", [user.id]);
    portfolios = await count("SELECT COUNT(*) AS n FROM portfolio_items WHERE user_id = $1", [user.id]);
  } else if (user.role === "mentor") {
    completedEvents = await count("SELECT COUNT(*) AS n FROM event_completions ec JOIN users u ON u.id = ec.user_id WHERE u.mentor_id = $1", [user.id]);
    submittedReports = await count("SELECT COUNT(*) AS n FROM roadmap_progress rp JOIN users u ON u.id = rp.user_id WHERE u.mentor_id = $1 AND rp.status <> 'open'", [user.id]);
    messages = await count("SELECT COUNT(*) AS n FROM messages WHERE from_user_id = $1 OR to_user_id = $1", [user.id]);
    files = await count("SELECT COUNT(*) AS n FROM message_attachments a JOIN messages m ON m.id = a.message_id WHERE m.from_user_id = $1 OR m.to_user_id = $1", [user.id]);
    portfolios = await count("SELECT COUNT(*) AS n FROM portfolio_items pi JOIN users u ON u.id = pi.user_id WHERE u.mentor_id = $1", [user.id]);
  } else {
    completedEvents = await count("SELECT COUNT(*) AS n FROM event_completions");
    submittedReports = await count("SELECT COUNT(*) AS n FROM roadmap_progress WHERE status <> 'open'");
    messages = await count("SELECT COUNT(*) AS n FROM messages");
    files = await count("SELECT COUNT(*) AS n FROM message_attachments");
    portfolios = await count("SELECT COUNT(*) AS n FROM portfolio_items");
  }

  return {
    scope: user.role,
    generatedAt: new Date().toISOString(),
    stats: [
      { label: user.role === "admin" ? "Пользователей" : "Педагогов", value: totalUsers },
      { label: "Завершено мероприятий", value: completedEvents },
      { label: "Отчётов сдано", value: submittedReports },
      { label: "Сообщений", value: messages },
      { label: "Файлов", value: files },
      { label: "Материалов портфолио", value: portfolios },
    ],
    competencies: averageCompetencies(people),
    people: rows,
    meta: { trackedPeople: ids.length },
  };
}

router.get("/summary", requireAuth, async (req, res) => {
  res.json(await buildReport(req.user));
});

router.get("/export.csv", requireAuth, async (req, res) => {
  const report = await buildReport(req.user);
  const quote = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const lines = [
    ["ФИО", "Предмет", "Регион", "Этап", "Средний балл", "Наставник"].map(quote).join(","),
    ...report.people.map((person) => [person.name, person.subject, person.region, person.stage, person.average, person.hasMentor ? "Да" : "Нет"].map(quote).join(",")),
  ];
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=report.csv");
  res.send(`\uFEFF${lines.join("\r\n")}`);
});

export default router;
