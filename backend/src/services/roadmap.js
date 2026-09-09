import crypto from "node:crypto";
import { COMPETENCIES, query } from "../db.js";
import { callGemini, extractJsonBlock, hasApiKey } from "./gemini.js";
import { cacheInvalidate } from "../cache.js";

const ROADMAP_STATUSES = new Set(["mentor_review", "approved", "changes_requested"]);

function safeUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch { return ""; }
}

function normalizePriorities(priorities, scores = {}) {
  if (!Array.isArray(priorities)) return [];
  return priorities.filter((item) => COMPETENCIES.some((c) => c.id === item?.competency)).map((item) => ({
    competency: item.competency,
    score: Number(item.score || scores[item.competency] || 0),
    events: Array.isArray(item.events) ? item.events.slice(0, 5).map((event) => ({
      title: String(event?.title || "").trim().slice(0, 240),
      date: String(event?.date || "").trim().slice(0, 80),
      url: safeUrl(event?.url),
      source: String(event?.source || "").trim().slice(0, 160),
      description: String(event?.description || "").trim().slice(0, 1000),
    })).filter((event) => event.title) : [],
  }));
}

function decodeXml(value) {
  return String(value || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

async function searchOfficialEvents(region) {
  const queries = [
    `${region} институт развития образования мероприятия педагоги`,
    `${region} школа молодого педагога вебинар`,
    `${region} педагогический дебют учитель года`,
  ];
  const candidates = [];
  for (const searchQuery of queries) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 7000);
      const response = await fetch(`https://www.bing.com/search?format=rss&q=${encodeURIComponent(searchQuery)}`, {
        headers: { "User-Agent": "Mozilla/5.0 NavigatorPedagoga/1.0" }, signal: controller.signal,
      });
      clearTimeout(timer);
      if (!response.ok) continue;
      const xml = await response.text();
      for (const item of xml.match(/<item>[\s\S]*?<\/item>/gi) || []) {
        const title = decodeXml(item.match(/<title>([\s\S]*?)<\/title>/i)?.[1]).replace(/<[^>]+>/g, "").trim();
        const url = safeUrl(decodeXml(item.match(/<link>([\s\S]*?)<\/link>/i)?.[1]).trim());
        const description = decodeXml(item.match(/<description>([\s\S]*?)<\/description>/i)?.[1]).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        if (title && url && !candidates.some((candidate) => candidate.url === url)) candidates.push({ title, url, description });
      }
    } catch { /* one unavailable search source must not break the roadmap */ }
  }
  return candidates.slice(0, 18);
}

function weakestFirst(scores) {
  return COMPETENCIES.map((c) => ({ comp: c, score: scores[c.id] || 3 })).sort((a, b) => a.score - b.score);
}

function eventHash(title, region, date) {
  const norm = [title, region, date].map((s) => (s || "").trim().toLowerCase()).join("|");
  return crypto.createHash("sha256").update(norm).digest("hex");
}

/**
 * Хеширование как механизм дедупликации, а не защиты данных: сохраняет мероприятия,
 * найденные ИИ через живой поиск, в общий каталог (events), чтобы он и правда становился
 * "постоянно обновляющимся списком" по региону и компетенции. sha256(название|регион|дата)
 * даёт стабильный ключ — при повторном поиске (ручном или по cron-расписанию) тот же вебинар
 * не дублируется в таблице (ON CONFLICT (content_hash) DO NOTHING), а просто пропускается.
 */
async function ingestDiscoveredEvents(priorities, region) {
  for (const p of priorities || []) {
    for (const ev of p.events || []) {
      if (!ev.title) continue;
      const hash = eventHash(ev.title, region, ev.date);
      await query(
        `INSERT INTO events (title, description, event_date, type, area, region, url, source, weight, content_hash, discovered_by_ai)
         VALUES ($1,$2,$3,'online',$4,$5,$6,$7,2,$8,true)
         ON CONFLICT (content_hash) DO NOTHING`,
        [ev.title, ev.description || "", ev.date || "", p.competency, region, ev.url || "", ev.source || "Найдено ИИ", hash]
      );
    }
  }
}

async function offlineRoadmap(user, note) {
  const ranked = weakestFirst(user.scores || {});
  const priorities = [];
  for (const { comp, score } of ranked.slice(0, 6)) {
    const { rows } = await query(
      "SELECT title, event_date AS date, url, source, description FROM events WHERE area = $1 AND (region = 'Все регионы' OR region = $2) ORDER BY created_at DESC LIMIT 2",
      [comp.id, user.region || ""]
    );
    priorities.push({ competency: comp.id, score, events: rows });
  }
  return {
    region: user.region || "не указан",
    summary: note || "Офлайн-режим: показаны мероприятия из общего каталога платформы. Чтобы включить поиск реальных мероприятий по региону, укажите GROQ_API_KEY на сервере.",
    priorities,
    mode: "offline",
    searchStatus: { provider: "catalog", checked: 0, found: priorities.reduce((sum, p) => sum + p.events.length, 0), searchedAt: Date.now() },
    generatedAt: Date.now(),
  };
}

const ROADMAP_SYSTEM = `Ты — ИИ-наставник образовательной платформы «НавигаторПедагога» (методология Поляковой Г.Д., МГУ 2022–2023) для молодых педагогов России.

Используй доступный веб-поиск. Твоя задача — найти РЕАЛЬНЫЕ, актуальные мероприятия для молодых педагогов (вебинары, курсы повышения квалификации, конкурсы, форумы, школы молодого педагога) в указанном регионе России.

Приоритетные источники (сформируй несколько разных поисковых запросов, комбинируя регион с этими источниками, не ограничивайся одним общим запросом):
- Общероссийский профсоюз образования и его региональные отделения (сайт eseur.ru и региональные организации профсоюза, например «профсоюз образования <регион>»)
- Региональные министерства/департаменты образования
- Региональные институты развития образования / ИПК / ИРО
- Конкурс «Учитель года» и «Педагогический дебют», региональные этапы
- Школа молодого педагога / молодого специалиста в конкретном регионе

Тебе передан профиль педагога и его баллы по 6 компетенциям (1-5, где ≤2 — выраженный дефицит, приоритет для развития). Для каждой компетенции с дефицитом подбери 1-3 реально найденных мероприятия.
Работай компактно: выполни не более 4 поисковых запросов и подбери максимум 1 мероприятие на каждую приоритетную компетенцию, чтобы ответ помещался в бесплатный лимит.

ВАЖНО: используй только то, что реально нашёл через поиск. Не придумывай названия, даты или ссылки. Если по какой-то компетенции в регионе ничего релевантного не нашлось — честно оставь для неё пустой список "events", не выдумывай.

В конце ответа выведи ИСКЛЮЧИТЕЛЬНО валидный JSON в блоке \`\`\`json ... \`\`\` по схеме:
{
  "region": "название региона",
  "summary": "2-3 предложения на русском о том, что удалось найти",
  "priorities": [
    {
      "competency": "id компетенции (subject|pedagogy|method|digital|communication|personal)",
      "score": число,
      "events": [
        { "title": "...", "date": "если известна, иначе пусто", "url": "полная ссылка", "source": "название сайта/организации", "description": "1 предложение" }
      ]
    }
  ]
}
Перед JSON можешь кратко написать 2-4 предложения по-русски о ходе поиска, но JSON-блок обязателен и должен идти последним.`;

const CATALOG_ROADMAP_SYSTEM = `Ты — ИИ-наставник платформы «НавигаторПедагога».
Сформируй компактную дорожную карту молодого педагога, используя ТОЛЬКО мероприятия из переданного каталога. Не добавляй вымышленные названия, даты, организации или ссылки. Для каждой приоритетной компетенции оставь максимум одно мероприятие.
В конце выведи ИСКЛЮЧИТЕЛЬНО валидный JSON в блоке \`\`\`json ... \`\`\` по схеме:
{
  "region": "название региона",
  "summary": "1-2 предложения на русском",
  "priorities": [
    { "competency": "subject|pedagogy|method|digital|communication|personal", "score": 1, "events": [{ "title": "из каталога", "date": "", "url": "", "source": "", "description": "" }] }
  ]
}`;

async function generateFromCatalog(user, profileLine, searchError) {
  const catalog = await offlineRoadmap(user);
  const catalogText = JSON.stringify(catalog.priorities).slice(0, 9000);
  const { text, sources } = await callGemini({
    system: CATALOG_ROADMAP_SYSTEM,
    messages: [{
      role: "user",
      content: `${profileLine}\n\nВеб-поиск временно недоступен (${searchError?.message || "ошибка инструмента"}). Используй только этот каталог платформы:\n${catalogText}`,
    }],
    maxTokens: 700,
  });
  const parsed = extractJsonBlock(text);
  if (!parsed) return null;
  parsed.region = user.region || parsed.region || "не указан";
  parsed.mode = "ai";
  parsed.generatedAt = Date.now();
  parsed.sources = sources.slice(0, 15);
  parsed.rawText = text.slice(0, 4000);
  parsed.summary = parsed.summary || "Карта собрана ИИ-наставником из каталога платформы.";
  parsed.searchStatus = { provider: "catalog+ai", checked: 0, found: normalizePriorities(parsed.priorities).reduce((sum, p) => sum + p.events.length, 0), searchedAt: Date.now() };
  return parsed;
}

async function saveRoadmap(userId, rm) {
  const priorities = normalizePriorities(rm.priorities);
  const { rows: current } = await query("SELECT * FROM roadmaps WHERE user_id = $1", [userId]);
  if (current[0]?.status === "approved") await archiveApproved(current[0]);
  await query(
    `INSERT INTO roadmaps (user_id, region, summary, priorities, mode, raw_text, sources, search_status, generated_at, status, source, change_reason, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now(),'mentor_review','ai',$9,now())
     ON CONFLICT (user_id) DO UPDATE SET region=$2, summary=$3, priorities=$4, mode=$5, raw_text=$6,
       sources=$7, search_status=$8, generated_at=now(), status='mentor_review', source='ai', change_reason=$9, mentor_comment=NULL,
       updated_by=NULL, approved_by=NULL, approved_at=NULL, updated_at=now()`,
    [userId, rm.region, rm.summary, JSON.stringify(priorities), rm.mode, rm.rawText || null, JSON.stringify(rm.sources || []), JSON.stringify(rm.searchStatus || {}), rm.changeReason || "ИИ обновил предложение по диагностике и прогрессу"]
  );
  return getStoredRoadmap(userId);
}

async function archiveApproved(row) {
  const version = Math.max(1, Number(row.version || 1));
  await query(
    `INSERT INTO roadmap_versions (user_id,version,region,summary,priorities,mode,sources,search_status,source,mentor_comment,approved_by,approved_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,COALESCE($12,now())) ON CONFLICT (user_id,version) DO NOTHING`,
    [row.user_id, version, row.region, row.summary, JSON.stringify(row.priorities || []), row.mode, JSON.stringify(row.sources || []), JSON.stringify(row.search_status || {}), row.source || "mentor", row.mentor_comment, row.approved_by, row.approved_at]
  );
}

function mapRoadmap(row) {
  if (!row) return null;
  const generatedAt = row.generated_at?.getTime?.() ?? new Date(row.generated_at).getTime();
  return {
    region: row.region, summary: row.summary, priorities: row.priorities || [], mode: row.mode,
    rawText: row.raw_text, sources: row.sources || [], searchStatus: row.search_status || {}, generatedAt, stale: Date.now() - generatedAt > STALE_MS,
    status: ROADMAP_STATUSES.has(row.status) ? row.status : "mentor_review", version: Number(row.version || 0),
    source: row.source || "ai", mentorComment: row.mentor_comment || "", changeReason: row.change_reason || "",
    approvedBy: row.approved_by || null, approvedAt: row.approved_at || null,
  };
}

export async function generateRoadmap(user) {
  if (!user.scores || !Object.values(user.scores).some((v) => v > 0)) {
    const err = new Error("NO_SCORES");
    err.code = "NO_SCORES";
    throw err;
  }

  if (!hasApiKey()) {
    return saveRoadmap(user.id, await offlineRoadmap(user));
  }

  const region = user.region || "";
  if (!region) {
    return saveRoadmap(user.id, await offlineRoadmap(user, "Регион не указан — укажите его в профиле, чтобы включить поиск реальных мероприятий."));
  }

  const ranked = weakestFirst(user.scores);
  let profileLine =
    `Педагог: ${user.fullName}. Предмет: ${user.subject}. Стаж: ${user.yearsExperience} лет. Регион: ${region}.\n` +
    `Баллы по компетенциям (1-5): ` +
    ranked.map((r) => `${r.comp.label} (${r.comp.id}) = ${r.score}`).join(", ") +
    `.\nНайди реальные мероприятия для региона "${region}" под указанные дефициты и построй дорожную карту по инструкции.`;
  const [{ rows: currentRows }, { rows: progressRows }] = await Promise.all([
    query("SELECT status, mentor_comment, summary FROM roadmaps WHERE user_id=$1", [user.id]),
    query("SELECT competency_id, event_title, status, report_text, usefulness_rating, mentor_rating FROM roadmap_progress WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 20", [user.id]),
  ]);
  if (currentRows[0]?.mentor_comment) profileLine += `\nОбязательная корректировка наставника: ${currentRows[0].mentor_comment}`;
  if (progressRows.length) profileLine += `\nФактический прогресс и обратная связь: ${JSON.stringify(progressRows).slice(0, 6000)}`;

  const webCandidates = await searchOfficialEvents(region);
  if (webCandidates.length) {
    try {
      const candidatePrompt = `${profileLine}\n\nНиже результаты живого веб-поиска. Используй только эти названия и URL, выбери релевантные и распредели по компетенциям:\n${JSON.stringify(webCandidates).slice(0, 14000)}`;
      const candidateRoadmap = await generateFromCatalog(user, candidatePrompt, { message: "использованы результаты независимого веб-поиска" });
      if (candidateRoadmap) {
        candidateRoadmap.mode = "live";
        candidateRoadmap.sources = webCandidates.map((item) => item.url);
        candidateRoadmap.searchStatus = { provider: "web+ai", checked: webCandidates.length, found: normalizePriorities(candidateRoadmap.priorities).reduce((sum, p) => sum + p.events.length, 0), searchedAt: Date.now() };
        await ingestDiscoveredEvents(candidateRoadmap.priorities, region);
        cacheInvalidate("events:catalog:");
        return saveRoadmap(user.id, candidateRoadmap);
      }
    } catch (e) { console.error("[generateRoadmap] web candidate processing failed:", e.message || e); }
  }

  try {
    const { text, sources } = await callGemini({
      system: ROADMAP_SYSTEM,
      messages: [{ role: "user", content: profileLine }],
      googleSearch: true,
      searchTools: ["web_search"],
      maxTokens: 900,
    });

    let parsed = extractJsonBlock(text);

    if (!parsed) {
      const rm = await offlineRoadmap(user, "Не удалось получить структурированный ответ от ИИ — показаны мероприятия из общего каталога. Попробуйте обновить карту ещё раз.");
      rm.rawText = text.slice(0, 4000);
      return saveRoadmap(user.id, rm);
    }

    parsed.mode = "live";
    parsed.generatedAt = Date.now();
    parsed.sources = sources.slice(0, 15);
    parsed.rawText = text.slice(0, 4000);
    parsed.searchStatus = { provider: "ai-search", checked: sources.length, found: normalizePriorities(parsed.priorities).reduce((sum, p) => sum + p.events.length, 0), searchedAt: Date.now() };
    await ingestDiscoveredEvents(parsed.priorities, region);
    cacheInvalidate("events:catalog:"); // каталог пополнился — сбрасываем кэш, чтобы список сразу увидели остальные пользователи
    return saveRoadmap(user.id, parsed);
  } catch (e) {
    console.error("[generateRoadmap] failed:", e.message || e);
    try {
      const aiCatalogRoadmap = await generateFromCatalog(user, profileLine, e);
      if (aiCatalogRoadmap) return saveRoadmap(user.id, aiCatalogRoadmap);
    } catch (fallbackError) {
      console.error("[generateRoadmap] catalog fallback failed:", fallbackError.message || fallbackError);
    }
    const rm = await offlineRoadmap(user, `Не удалось связаться с AI-сервисом (${e.code || e.message}). Показаны мероприятия из общего каталога.`);
    return saveRoadmap(user.id, rm);
  }
}

export async function getStoredRoadmap(userId) {
  const { rows } = await query("SELECT * FROM roadmaps WHERE user_id = $1", [userId]);
  if (!rows[0]) return null;
  const current = mapRoadmap(rows[0]);
  if (current.status === "approved") return current;
  const { rows: approvedRows } = await query("SELECT * FROM roadmap_versions WHERE user_id = $1 ORDER BY version DESC LIMIT 1", [userId]);
  if (!approvedRows[0]) return current;
  const approved = mapRoadmap({ ...approvedRows[0], status: "approved", generated_at: approvedRows[0].created_at, raw_text: null });
  return { ...approved, proposal: current, proposalStatus: current.status };
}

export async function getRoadmapWorkflow(userId) {
  const { rows } = await query("SELECT * FROM roadmaps WHERE user_id = $1", [userId]);
  if (!rows[0]) return { active: null, draft: null, history: [] };
  const current = mapRoadmap(rows[0]);
  const { rows: versions } = await query("SELECT * FROM roadmap_versions WHERE user_id = $1 ORDER BY version DESC LIMIT 12", [userId]);
  const history = versions.map((row) => mapRoadmap({ ...row, status: "approved", generated_at: row.created_at, raw_text: null }));
  return { active: current.status === "approved" ? current : history[0] || null, draft: current.status === "approved" ? null : current, history };
}

export async function saveMentorDraft(userId, mentorId, payload) {
  const { rows } = await query("SELECT * FROM roadmaps WHERE user_id = $1", [userId]);
  if (!rows[0]) return null;
  if (rows[0].status === "approved") await archiveApproved(rows[0]);
  const summary = String(payload.summary ?? rows[0].summary ?? "").trim().slice(0, 4000);
  const priorities = normalizePriorities(payload.priorities ?? rows[0].priorities);
  const comment = String(payload.mentorComment || "").trim().slice(0, 3000);
  const { rows: updated } = await query(
    `UPDATE roadmaps SET summary=$1, priorities=$2, status='mentor_review', source='mentor', mentor_comment=$3,
       change_reason='Наставник отредактировал предложение', updated_by=$4, approved_by=NULL, approved_at=NULL, updated_at=now()
     WHERE user_id=$5 RETURNING *`,
    [summary, JSON.stringify(priorities), comment, mentorId, userId]
  );
  return mapRoadmap(updated[0]);
}

export async function approveRoadmap(userId, mentorId, mentorComment) {
  const { rows } = await query("SELECT * FROM roadmaps WHERE user_id = $1", [userId]);
  if (!rows[0]) return null;
  const { rows: versionRows } = await query("SELECT MAX(version) AS version FROM roadmap_versions WHERE user_id = $1", [userId]);
  const version = Math.max(Number(rows[0].version || 0), Number(versionRows[0]?.version || 0)) + 1;
  const comment = String(mentorComment ?? rows[0].mentor_comment ?? "").trim().slice(0, 3000);
  const { rows: updated } = await query(
    `UPDATE roadmaps SET status='approved', version=$1, source='mentor', mentor_comment=$2, approved_by=$3,
       approved_at=now(), updated_by=$3, change_reason='Наставник утвердил и опубликовал версию', updated_at=now()
     WHERE user_id=$4 RETURNING *`, [version, comment, mentorId, userId]
  );
  await archiveApproved(updated[0]);
  return mapRoadmap(updated[0]);
}

export async function requestRoadmapChanges(userId, mentorId, comment) {
  const text = String(comment || "").trim().slice(0, 3000);
  if (!text) return null;
  const { rows } = await query(
    `UPDATE roadmaps SET status='changes_requested', mentor_comment=$1, change_reason='Наставник запросил изменения',
       updated_by=$2, updated_at=now() WHERE user_id=$3 RETURNING *`, [text, mentorId, userId]
  );
  return mapRoadmap(rows[0]);
}

const STALE_MS = 4 * 24 * 3600 * 1000; // карта считается устаревшей через 4 дня — повод обновить поиск по региону

/** Обновляет карты всех активных педагогов, чьи карты устарели — вызывается по расписанию (см. routes/cron.js). */
export async function refreshStaleRoadmaps(limit = 15) {
  const { rows } = await query(
    `SELECT u.* FROM users u
     LEFT JOIN roadmaps r ON r.user_id = u.id
     WHERE u.role = 'user' AND u.scores::text <> '{"subject":0,"pedagogy":0,"method":0,"digital":0,"communication":0,"personal":0}'
       AND (r.generated_at IS NULL OR r.generated_at < now() - interval '4 days')
     ORDER BY r.generated_at ASC NULLS FIRST
     LIMIT $1`,
    [limit]
  );
  const results = [];
  for (const row of rows) {
    const user = { id: row.id, fullName: row.full_name, subject: row.subject, region: row.region, yearsExperience: row.years_experience, scores: row.scores, currentStage: row.current_stage };
    try {
      const rm = await generateRoadmap(user);
      results.push({ userId: user.id, ok: true, mode: rm.mode });
    } catch (e) {
      results.push({ userId: user.id, ok: false, error: e.message });
    }
  }
  return results;
}

// ---------------- roadmap_progress: репорт/оценка мероприятий (гл. 3.3, п.8-9 диссертации) ----------------
// Молодой педагог добавляет мероприятие в работу, по завершении пишет отчёт и оценивает
// полезность (1-5); человек-наставник видит отчёт и ставит свою оценку — это и есть та
// самая "корректировка пути", которую по методологии выполняет наставник, а не ИИ.
export async function addProgressItem(userId, { competencyId, eventTitle, eventUrl, weight }) {
  const { rows: current } = await query("SELECT status FROM roadmaps WHERE user_id=$1", [userId]);
  const { rows: versions } = current[0]?.status === "approved" ? { rows: [{ ok: 1 }] } : await query("SELECT 1 AS ok FROM roadmap_versions WHERE user_id=$1 LIMIT 1", [userId]);
  if (!current[0] || (!versions[0] && current[0].status !== "approved")) {
    const error = new Error("NO_APPROVED_ROADMAP");
    error.code = "NO_APPROVED_ROADMAP";
    throw error;
  }
  const { rows } = await query(
    `INSERT INTO roadmap_progress (user_id, competency_id, event_title, event_url, weight) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [userId, competencyId, eventTitle, eventUrl || "", weight || 1]
  );
  return rows[0];
}

export async function listProgress(userId) {
  const { rows } = await query("SELECT * FROM roadmap_progress WHERE user_id = $1 ORDER BY created_at DESC", [userId]);
  return rows;
}

export async function reportProgress(id, userId, reportText, usefulnessRating) {
  const { rows } = await query(
    `UPDATE roadmap_progress SET status = 'reported', report_text = $1, usefulness_rating = $2, updated_at = now()
     WHERE id = $3 AND user_id = $4 RETURNING *`,
    [reportText, usefulnessRating, id, userId]
  );
  return rows[0] || null;
}

export async function mentorRateProgress(id, mentorId, mentorRating) {
  const { rows } = await query(
    `UPDATE roadmap_progress SET status = 'rated', mentor_rating = $1, updated_at = now()
     WHERE id = $2 AND user_id IN (SELECT id FROM users WHERE mentor_id = $3 AND mentor_status = 'confirmed') RETURNING *`,
    [mentorRating, id, mentorId]
  );
  return rows[0] || null;
}
