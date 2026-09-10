import { Router } from "express";
import { query, mapEvent } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { cached, cacheInvalidate } from "../cache.js";
import { getOrGenerateEventQuiz, submitQuizAttempt } from "../services/aiFeatures.js";
import { awardCoins, REWARDS } from "../services/gamification.js";

const router = Router();

// Каталог мероприятий читается часто и меняется редко — кэшируем на 60с.
// Персональная отметка "пройдено" не кэшируется (личная, у каждого своя), поэтому
// кэшируем только сам каталог, а completion подмешиваем после чтения из кэша.
async function loadCatalog(area, search, type, region) {
  const term = String(search || "").trim().slice(0, 100);
  const eventType = ["online", "offline"].includes(type) ? type : "";
  const eventRegion = String(region || "").trim().slice(0, 120);
  return cached(`events:catalog:${area || "all"}:${eventType || "all"}:${eventRegion.toLowerCase() || "all"}:${term.toLowerCase()}`, 60_000, async () => {
    const clauses = [];
    const params = [];
    if (area && area !== "all") { params.push(area); clauses.push(`area = $${params.length}`); }
    if (eventType) { params.push(eventType); clauses.push(`type = $${params.length}`); }
    if (eventRegion) { params.push(`%${eventRegion}%`); clauses.push(`(region ILIKE $${params.length} OR region ILIKE '%все регионы%')`); }
    const { rows } = await query(`SELECT * FROM events${clauses.length ? " WHERE " + clauses.join(" AND ") : ""} ORDER BY event_date ASC, created_at DESC`, params);
    if (!term) return rows;
    const needle = term.toLocaleLowerCase("ru-RU");
    return rows.filter((event) => [event.title, event.description, event.source, event.region]
      .some((value) => String(value || "").toLocaleLowerCase("ru-RU").includes(needle)));
  });
}

router.get("/", requireAuth, async (req, res) => {
  const catalog = await loadCatalog(req.query.area, req.query.q, req.query.type, req.query.region);
  const { rows: completions } = await query("SELECT event_id, reflection FROM event_completions WHERE user_id = $1", [req.user.id]);
  const completedMap = new Map(completions.map((c) => [c.event_id, c.reflection]));
  let events = catalog.map((e) => mapEvent(e, completedMap.has(e.id) ? { completed: true, reflection: completedMap.get(e.id) } : null));
  if (req.query.status === "completed") events = events.filter((event) => event.completed);
  if (req.query.status === "open") events = events.filter((event) => !event.completed);
  res.json({ events });
});

router.post("/", requireAuth, requireRole("admin"), async (req, res) => {
  const { title, description, date, time, type, area, region, url, source, weight } = req.body || {};
  if (!title || !date) return res.status(400).json({ error: "Заполните название и дату" });
  const { rows } = await query(
    `INSERT INTO events (title, description, event_date, event_time, type, area, region, url, source, weight, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [title, description || "", date, time || "", type || "online", area || "subject", region || "Все регионы", url || "", source || "Каталог платформы", weight || 1, req.user.id]
  );
  cacheInvalidate("events:catalog:");
  res.json({ event: mapEvent(rows[0]) });
});

router.put("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  const { title, description, date, time, type, area, region, url, source, weight } = req.body || {};
  const { rows } = await query(
    `UPDATE events SET title = COALESCE($1,title), description = COALESCE($2,description), event_date = COALESCE($3,event_date),
       event_time = COALESCE($4,event_time), type = COALESCE($5,type), area = COALESCE($6,area), region = COALESCE($7,region),
       url = COALESCE($8,url), source = COALESCE($9,source), weight = COALESCE($10,weight)
     WHERE id = $11 RETURNING *`,
    [title, description, date, time, type, area, region, url, source, weight, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "Не найдено" });
  cacheInvalidate("events:catalog:");
  res.json({ event: mapEvent(rows[0]) });
});

router.delete("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  await query("DELETE FROM events WHERE id = $1", [req.params.id]);
  cacheInvalidate("events:catalog:");
  res.json({ ok: true });
});

router.post("/:id/complete", requireAuth, async (req, res) => {
  const completed = Boolean(req.body?.completed);
  const reflection = req.body?.reflection || "";
  if (completed) {
    const { rows: existing } = await query("SELECT 1 FROM event_completions WHERE event_id = $1 AND user_id = $2", [req.params.id, req.user.id]);
    await query(
      `INSERT INTO event_completions (event_id, user_id, reflection, completed_at) VALUES ($1,$2,$3, now())
       ON CONFLICT (event_id, user_id) DO UPDATE SET reflection = $3, completed_at = now()`,
      [req.params.id, req.user.id, reflection]
    );
    if (!existing.length) await awardCoins(req.user.id, REWARDS.EVENT_COMPLETED, "Мероприятие пройдено"); // монеты только за первое прохождение, не за редактирование рефлексии
  } else {
    await query("DELETE FROM event_completions WHERE event_id = $1 AND user_id = $2", [req.params.id, req.user.id]);
  }
  const { rows } = await query("SELECT * FROM events WHERE id = $1", [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "Не найдено" });
  res.json({ event: mapEvent(rows[0], { completed, reflection }) });
});

// ---------------- ИИ-тест после мероприятия ----------------
// Вопросы генерируются один раз на мероприятие (кэш в БД, см. aiFeatures.js), грейдинг — на сервере.
router.get("/:id/quiz", requireAuth, async (req, res) => {
  const { rows } = await query("SELECT * FROM events WHERE id = $1", [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "Мероприятие не найдено" });
  const quiz = await getOrGenerateEventQuiz(mapEvent(rows[0]));
  // без правильных ответов на клиент — только вопросы и варианты
  res.json({ questions: quiz.questions.map((q) => ({ q: q.q, options: q.options })), mode: quiz.mode, sources: quiz.sources });
});

router.post("/:id/quiz/submit", requireAuth, async (req, res) => {
  const answers = Array.isArray(req.body?.answers) ? req.body.answers : [];
  try {
    const result = await submitQuizAttempt(req.params.id, req.user.id, answers);
    if (result.score > 0) await awardCoins(req.user.id, result.score * REWARDS.EVENT_QUIZ_PASSED, `Тест по мероприятию: ${result.score}/${result.total} верно`);
    res.json({
      score: result.score,
      total: result.total,
      details: result.questions.map((q, i) => ({ q: q.q, correctIndex: q.correctIndex, yourAnswer: answers[i], explain: q.explain })),
    });
  } catch (e) {
    if (e.code === "NOT_FOUND") return res.status(404).json({ error: "Сначала откройте тест (GET /:id/quiz)" });
    throw e;
  }
});

export default router;
