import { Router } from "express";
import rateLimit from "express-rate-limit";
import { query, mapUser } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { startDiagnostic, handleDiagnosticReply, isDiagnosticActive, getDiagnosticProgress, assistantReply, QUICK_ACTIONS, quickActionText } from "../services/mentor.js";
import { generateRoadmap, getStoredRoadmap, getRoadmapWorkflow, saveMentorDraft, approveRoadmap, requestRoadmapChanges, addProgressItem, listProgress, reportProgress, mentorRateProgress } from "../services/roadmap.js";
import { hasApiKey, aiProviderInfo } from "../services/gemini.js";
import { getOrGenerateDigest, reviewReportDraft, getOrGenerateMethodicalTips, getInactivityNudge } from "../services/aiFeatures.js";
import { awardCoins, REWARDS } from "../services/gamification.js";
import { createNotification } from "../services/notifications.js";
import { buildPortfolioData } from "../services/portfolio.js";
import { createPortfolioPdf } from "../services/portfolioPdf.js";

const router = Router();

// A diagnostic conversation alone makes a dozen+ small requests, so keep this generous.
// Only the web-search-backed roadmap generation gets a tight limit below.
const aiLimiter = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false });
router.use(aiLimiter);

const roadmapLimiter = rateLimit({ windowMs: 60_000, max: 6, standardHeaders: true, legacyHeaders: false, message: { error: "Слишком много запросов на построение карты — подождите минуту." } });

async function saveChatRow(userId, msg) {
  await query("INSERT INTO ai_chats (user_id, role, text, chips, action) VALUES ($1,$2,$3,$4,$5)", [
    userId, msg.role, msg.text, msg.chips ? JSON.stringify(msg.chips) : null, msg.action || null,
  ]);
}
function mapChatRow(r) {
  return { role: r.role, text: r.text, chips: r.chips || undefined, action: r.action || undefined };
}

router.get("/status", requireAuth, (req, res) => {
  res.json({ liveMode: hasApiKey(), ...aiProviderInfo(), quickActions: QUICK_ACTIONS });
});

router.get("/chat", requireAuth, async (req, res) => {
  const { rows } = await query("SELECT * FROM ai_chats WHERE user_id = $1 ORDER BY id ASC", [req.user.id]);
  res.json({ messages: rows.map(mapChatRow), diagnosticActive: await isDiagnosticActive(req.user.id), diagnosticProgress: await getDiagnosticProgress(req.user.id) });
});

router.post("/diagnostic/start", requireAuth, async (req, res) => {
  const msgs = await startDiagnostic(req.user);
  for (const m of msgs) await saveChatRow(req.user.id, m);
  res.json({ messages: msgs, diagnosticProgress: await getDiagnosticProgress(req.user.id) });
});

router.post("/diagnostic/reply", requireAuth, async (req, res) => {
  const text = (req.body?.text || "").trim();
  if (!text) return res.status(400).json({ error: "Пустой ответ" });
  await saveChatRow(req.user.id, { role: "user", text });
  const newMsgs = await handleDiagnosticReply(req.user, text);
  for (const m of newMsgs) await saveChatRow(req.user.id, m);
  const diagnosticActive = await isDiagnosticActive(req.user.id);
  let roadmap = null;
  if (!diagnosticActive) {
    const { rows } = await query("SELECT * FROM users WHERE id = $1", [req.user.id]);
    roadmap = await generateRoadmap(mapUser(rows[0])).catch((error) => {
      console.error("[diagnostic] automatic roadmap draft failed:", error.message || error);
      return null;
    });
    if (req.user.mentorId && roadmap) await createNotification(req.user.mentorId, "roadmap", "Проект плана готов к проверке", `${req.user.fullName}: ИИ подготовил новую дорожную карту.`, `#/mentees/${req.user.id}`);
  }
  res.json({ messages: newMsgs, diagnosticActive, diagnosticProgress: await getDiagnosticProgress(req.user.id), roadmap });
});

router.post("/chat", requireAuth, async (req, res) => {
  const text = (req.body?.text || "").trim();
  if (!text) return res.status(400).json({ error: "Пустое сообщение" });
  await saveChatRow(req.user.id, { role: "user", text });
  const { rows } = await query("SELECT role, text FROM ai_chats WHERE user_id = $1 ORDER BY id ASC", [req.user.id]);
  const replyText = await assistantReply(req.user, text, rows);
  const aiMsg = { role: "ai", text: replyText };
  await saveChatRow(req.user.id, aiMsg);
  res.json({ messages: [aiMsg] });
});

router.get("/quick-actions", requireAuth, (req, res) => {
  res.json({ actions: QUICK_ACTIONS.map((a) => ({ ...a, prompt: quickActionText(a.id, req.user) })) });
});

// The star feature: web-search-powered, region-aware roadmap.
router.post("/roadmap/generate", requireAuth, roadmapLimiter, async (req, res) => {
  if (req.user.role !== "user") return res.status(403).json({ error: "Для наставника обновление ИИ доступно в карточке педагога" });
  const region = (req.body?.region || req.user.region || "").trim();
  if (!region) return res.status(400).json({ error: "Укажите регион в профиле или в запросе" });
  if (region !== req.user.region) { await query("UPDATE users SET region = $1 WHERE id = $2", [region, req.user.id]); req.user.region = region; }
  try {
    const rm = await generateRoadmap(req.user);
    res.json({ roadmap: rm });
  } catch (e) {
    if (e.code === "NO_SCORES") return res.status(400).json({ error: "Сначала пройдите диагностику с ИИ-наставником" });
    res.status(500).json({ error: "Не удалось построить карту: " + e.message });
  }
});

router.get("/roadmap", requireAuth, async (req, res) => {
  res.json({ roadmap: await getStoredRoadmap(req.user.id) });
});

async function confirmedMentee(mentorId, userId) {
  const { rows } = await query("SELECT * FROM users WHERE id=$1 AND mentor_id=$2 AND mentor_status='confirmed'", [userId, mentorId]);
  return rows[0] ? mapUser(rows[0]) : null;
}

router.get("/roadmap/mentee/:userId", requireAuth, requireRole("mentor"), async (req, res) => {
  if (!await confirmedMentee(req.user.id, req.params.userId)) return res.status(404).json({ error: "Педагог не найден среди ваших подопечных" });
  res.json({ workflow: await getRoadmapWorkflow(req.params.userId) });
});

router.put("/roadmap/mentee/:userId", requireAuth, requireRole("mentor"), async (req, res) => {
  if (!await confirmedMentee(req.user.id, req.params.userId)) return res.status(404).json({ error: "Педагог не найден среди ваших подопечных" });
  const roadmap = await saveMentorDraft(req.params.userId, req.user.id, req.body || {});
  if (!roadmap) return res.status(404).json({ error: "Сначала создайте предложение ИИ" });
  await createNotification(req.params.userId, "roadmap", "Наставник обновил план", "Изменения сохранены и ожидают окончательного утверждения.", "#/roadmap");
  res.json({ roadmap });
});

router.post("/roadmap/mentee/:userId/approve", requireAuth, requireRole("mentor"), async (req, res) => {
  if (!await confirmedMentee(req.user.id, req.params.userId)) return res.status(404).json({ error: "Педагог не найден среди ваших подопечных" });
  const roadmap = await approveRoadmap(req.params.userId, req.user.id, req.body?.mentorComment);
  if (!roadmap) return res.status(404).json({ error: "План не найден" });
  await query("UPDATE users SET current_stage=GREATEST(current_stage,3) WHERE id=$1", [req.params.userId]);
  await createNotification(req.params.userId, "roadmap", `План развития v${roadmap.version} утверждён`, req.body?.mentorComment || "Наставник проверил и опубликовал дорожную карту.", "#/roadmap");
  res.json({ roadmap });
});

router.post("/roadmap/mentee/:userId/request-changes", requireAuth, requireRole("mentor"), async (req, res) => {
  if (!await confirmedMentee(req.user.id, req.params.userId)) return res.status(404).json({ error: "Педагог не найден среди ваших подопечных" });
  const roadmap = await requestRoadmapChanges(req.params.userId, req.user.id, req.body?.comment);
  if (!roadmap) return res.status(400).json({ error: "Напишите, что должен скорректировать ИИ" });
  await createNotification(req.params.userId, "roadmap", "План возвращён на доработку", roadmap.mentorComment, "#/roadmap");
  res.json({ roadmap });
});

router.post("/roadmap/mentee/:userId/ai-revise", requireAuth, requireRole("mentor"), roadmapLimiter, async (req, res) => {
  const mentee = await confirmedMentee(req.user.id, req.params.userId);
  if (!mentee) return res.status(404).json({ error: "Педагог не найден среди ваших подопечных" });
  const roadmap = await generateRoadmap(mentee);
  await createNotification(req.params.userId, "roadmap", "ИИ подготовил новую редакцию", "Наставник получил её на проверку; утверждённая версия пока не менялась.", "#/roadmap");
  res.json({ roadmap, workflow: await getRoadmapWorkflow(req.params.userId) });
});

// ---------------- прогресс по мероприятиям: отчёт наставляемого + оценка наставника ----------------
// Наставляемый добавляет мероприятие дорожной карты в работу.
router.post("/roadmap/progress", requireAuth, async (req, res) => {
  const { competencyId, eventTitle, eventUrl, weight } = req.body || {};
  if (!competencyId || !eventTitle) return res.status(400).json({ error: "Укажите компетенцию и название мероприятия" });
  try {
    const item = await addProgressItem(req.user.id, { competencyId, eventTitle, eventUrl, weight });
    res.json({ progress: item });
  } catch (error) {
    if (error.code === "NO_APPROVED_ROADMAP") return res.status(409).json({ error: "Сначала наставник должен утвердить дорожную карту" });
    throw error;
  }
});

router.get("/roadmap/progress", requireAuth, async (req, res) => {
  res.json({ progress: await listProgress(req.user.id) });
});

// Наставляемый заполняет отчёт и оценивает мероприятие по шкале «Полезность» 1-5 (гл. 3.2 диссертации).
router.post("/roadmap/progress/:id/report", requireAuth, async (req, res) => {
  const { reportText, usefulnessRating } = req.body || {};
  if (!reportText) return res.status(400).json({ error: "Опишите, что узнали и как будете применять" });
  const rating = Math.max(1, Math.min(5, parseInt(usefulnessRating, 10) || 3));
  const item = await reportProgress(req.params.id, req.user.id, reportText, rating);
  if (!item) return res.status(404).json({ error: "Не найдено" });
  await awardCoins(req.user.id, REWARDS.ROADMAP_PROGRESS_REPORTED, "Отчёт по мероприятию сдан");
  if (req.user.mentorId) {
    await createNotification(req.user.mentorId, "report", "Новый отчёт на проверку", `${req.user.fullName}: ${item.event_title}`, `#/mentees/${req.user.id}`);
  }
  res.json({ progress: item });
});

// Наставник оценивает отчёт наставляемого — здесь и происходит "ручная корректировка" со стороны человека.
router.post("/roadmap/progress/:id/mentor-rate", requireAuth, requireRole("mentor"), async (req, res) => {
  const rating = Math.max(1, Math.min(5, parseInt(req.body?.mentorRating, 10) || 3));
  const requestRevision = req.body?.decision === "revision";
  const feedback = String(req.body?.mentorFeedback || "").trim();
  if (requestRevision && !feedback) return res.status(400).json({ error: "Напишите, что педагог должен доработать" });
  const item = await mentorRateProgress(req.params.id, req.user.id, rating, feedback, requestRevision);
  if (!item) return res.status(404).json({ error: "Не найдено или не ваш наставляемый" });
  if (!requestRevision && rating >= 4) await awardCoins(item.user_id, REWARDS.ROADMAP_PROGRESS_RATED_BONUS, "Наставник высоко оценил отчёт");
  await createNotification(item.user_id, "report", requestRevision ? "Отчёт нужно доработать" : "Наставник проверил отчёт", feedback || (requestRevision ? "Откройте отчёт и дополните его." : `Оценка наставника: ${rating}/5`), "#/roadmap");
  res.json({ progress: item });
});

// Наставнику — список отчётов своих наставляемых, ожидающих оценки.
router.get("/roadmap/progress/mentees", requireAuth, requireRole("mentor"), async (req, res) => {
  const { rows } = await query(
    `SELECT rp.*, u.full_name AS mentee_name FROM roadmap_progress rp
     JOIN users u ON u.id = rp.user_id
     WHERE u.mentor_id = $1 AND u.mentor_status = 'confirmed' AND rp.status = 'reported'
     ORDER BY rp.updated_at DESC`,
    [req.user.id]
  );
  res.json({ progress: rows });
});

// ==================== 5 новых ИИ-функций ====================

// 1) Ежедневный дайджест "что дальше" на дашборде (кэш 24ч).
router.get("/digest", requireAuth, async (req, res) => {
  const text = await getOrGenerateDigest(req.user, req.query.force === "1");
  res.json({ text });
});

// 2) ИИ-ревью черновика отчёта до отправки наставнику.
router.post("/roadmap/progress/review", requireAuth, async (req, res) => {
  const feedback = await reviewReportDraft(req.body?.text || "");
  res.json({ feedback });
});

// 3) Методические рекомендации Минпросвещения по конкретной компетенции.
router.get("/tips/:competencyId", requireAuth, async (req, res) => {
  const tips = await getOrGenerateMethodicalTips(req.params.competencyId, req.user.subject);
  res.json(tips);
});

router.get("/portfolio/items", requireAuth, async (req, res) => {
  const { rows } = await query("SELECT * FROM portfolio_items WHERE user_id = $1 ORDER BY created_at DESC", [req.user.id]);
  res.json({ items: rows });
});

router.post("/portfolio/items", requireAuth, async (req, res) => {
  const title = String(req.body?.title || "").trim();
  const description = String(req.body?.description || "").trim();
  const category = String(req.body?.category || "achievement").trim().slice(0, 40);
  const itemDate = req.body?.date || null;
  const rawUrl = String(req.body?.url || "").trim();
  const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : null;
  if (rawUrl && !url) return res.status(400).json({ error: "Ссылка должна начинаться с http:// или https://" });
  if (!title) return res.status(400).json({ error: "Укажите название достижения" });
  const { rows } = await query(
    `INSERT INTO portfolio_items (user_id, category, title, description, item_date, url)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [req.user.id, category, title.slice(0, 180), description.slice(0, 3000), itemDate, url]
  );
  res.json({ item: rows[0] });
});

router.delete("/portfolio/items/:id", requireAuth, async (req, res) => {
  const result = await query("DELETE FROM portfolio_items WHERE id = $1 AND user_id = $2", [req.params.id, req.user.id]);
  if (!result.rowCount) return res.status(404).json({ error: "Материал не найден" });
  res.json({ ok: true });
});

router.get("/portfolio/pdf", requireAuth, async (req, res) => {
  if (req.user.role !== "user") return res.status(403).json({ error: "Портфолио доступно молодому педагогу" });
  const portfolio = await buildPortfolioData(req.user, req.query.force === "1");
  const pdf = await createPortfolioPdf(portfolio);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Length", String(pdf.length));
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Content-Disposition", `attachment; filename=portfolio.pdf; filename*=UTF-8''${encodeURIComponent(`Портфолио_${req.user.fullName}.pdf`)}`);
  res.send(pdf);
});

// 4) Автосборка расширенного цифрового портфолио (этап 6 алгоритма).
router.get("/portfolio", requireAuth, async (req, res) => {
  if (req.user.role !== "user") return res.status(403).json({ error: "Портфолио доступно молодому педагогу" });
  res.json(await buildPortfolioData(req.user, req.query.force === "1"));
});

// 5) Умное напоминание о неактивности.
router.get("/nudge", requireAuth, async (req, res) => {
  res.json(await getInactivityNudge(req.user.id));
});

export default router;
