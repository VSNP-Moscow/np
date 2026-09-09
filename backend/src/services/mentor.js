import { COMPETENCIES, query } from "../db.js";
import { callGemini, hasApiKey } from "./gemini.js";
import { awardCoins, REWARDS } from "./gamification.js";

const DIALOG_ITEMS = [
  { id: "subject", key: "subject_science", text: "Ученик задаёт неожиданный вопрос за пределами учебника. Насколько уверенно вы объясните научную основу темы и свяжете её с программой?" },
  { id: "subject", key: "subject_gaps", text: "По итогам контрольной треть класса не усвоила тему. Насколько уверенно вы определите причины ошибок и перестроите объяснение?" },
  { id: "subject", key: "subject_links", text: "Нужно показать связь вашей темы с другими предметами и жизненной практикой. Насколько легко вы подберёте точные примеры?" },
  { id: "pedagogy", key: "pedagogy_climate", text: "В классе растёт шум, несколько учеников выпадают из работы. Насколько уверенно вы вернёте внимание без конфликта?" },
  { id: "pedagogy", key: "pedagogy_motivation", text: "В одном классе есть сильные, тревожные и слабо мотивированные ученики. Насколько уверенно вы организуете работу для всех?" },
  { id: "pedagogy", key: "pedagogy_age", text: "Насколько системно вы учитываете возрастные и индивидуальные особенности учеников при выборе заданий и темпа урока?" },
  { id: "method", key: "method_program", text: "Нужно самостоятельно собрать рабочую программу по актуальному ФГОС. Насколько уверенно вы справитесь с результатами, содержанием и тематическим планированием?" },
  { id: "method", key: "method_lesson", text: "Насколько уверенно вы формулируете цель урока, подбираете задания разной сложности и связываете этапы в единую логику?" },
  { id: "method", key: "method_reflection", text: "После неудачного урока насколько точно вы можете провести самоанализ и назвать конкретное изменение для следующего занятия?" },
  { id: "digital", key: "digital_resources", text: "Нужно быстро найти качественный ЭОР или материал МЭШ. Насколько уверенно вы оцените его достоверность и методическую ценность?" },
  { id: "digital", key: "digital_interactive", text: "Насколько уверенно вы создадите интерактивное задание, которое помогает достичь цели урока, а не просто развлекает?" },
  { id: "digital", key: "digital_data", text: "Насколько уверенно вы работаете с электронным журналом, цифровой отчётностью и защитой персональных данных учеников?" },
  { id: "communication", key: "communication_parent", text: "Родитель резко не согласен с оценкой ребёнка. Насколько уверенно вы проведёте разговор и зафиксируете совместный план действий?" },
  { id: "communication", key: "communication_conflict", text: "Возник конфликт между учениками или коллегами. Насколько уверенно вы отделите факты от эмоций и поможете договориться?" },
  { id: "communication", key: "communication_team", text: "Насколько свободно вы обсуждаете сложный случай с наставником, психологом и администрацией и принимаете профессиональную обратную связь?" },
  { id: "personal", key: "personal_reflection", text: "Насколько регулярно вы оцениваете собственный прогресс и превращаете наблюдения в конкретный план развития?" },
  { id: "personal", key: "personal_community", text: "Насколько активно вы участвуете в педагогических сообществах, мастер-классах, конкурсах или обмене практиками?" },
  { id: "personal", key: "personal_portfolio", text: "Насколько системно вы собираете подтверждения результатов: разработки, отзывы, сертификаты, рефлексии и достижения учеников?" },
];

const FOLLOWUP_LOW = {
  subject: "Понимаю. Что именно вызывает больше всего сомнений — конкретные темы, или уверенность отвечать «на лету»?",
  pedagogy: "Спасибо за честность. В какой момент урока дисциплина проседает сильнее всего?",
  method: "Ясно. Сложнее с самим планированием или с тем, чтобы уложиться в рабочую программу?",
  digital: "Понял. Дело в незнакомых инструментах или просто не хватает времени их осваивать?",
  communication: "Хорошо, что говорите об этом. Сложнее с родителями, коллегами или администрацией?",
  personal: "Не хватает времени, идей — или пока не знаете, с чего начать?",
};

const MICRO_FEEDBACK = {
  5: ["Отлично, это явно ваша опора.", "Сильная сторона — будем на неё опираться."],
  4: ["Хорошая база, отшлифуем детали.", "Уже уверенно, есть куда расти вглубь."],
  3: ["Понимаю, нестабильность — это нормально на старте.", "Окей, зафиксировал."],
  2: ["Спасибо за честность — частая точка роста у молодых педагогов.", "Понял, возьмём это в приоритет."],
  1: ["Спасибо, что не стали приукрашивать — с этого и начинается рост.", "Окей, это будет приоритет №1."],
};

const POS_WORDS = ["уверен", "легко", "хорошо", "отлично", "люблю", "получается", "сильная сторона", "опытн", "свободно", "нравится", "спокойно"];
const NEG_WORDS = ["не умею", "не знаю", "сложно", "трудно", "боюсь", "путаюсь", "не получается", "слабо", "плохо", "затрудня", "не уверен", "тяжело", "паника", "стресс"];

function inferScore(text) {
  const t = text.toLowerCase();
  let s = 3;
  POS_WORDS.forEach((w) => { if (t.includes(w)) s += 1; });
  NEG_WORDS.forEach((w) => { if (t.includes(w)) s -= 1; });
  return Math.max(1, Math.min(5, s));
}
async function inferScoreWithAi(question, answer) {
  if (!hasApiKey()) return inferScore(answer);
  try {
    const { text } = await callGemini({
      system: "Ты оцениваешь самоописание профессиональной компетенции педагога. Верни только одно целое число от 1 до 5: 1 — выраженные трудности, 3 — нестабильное владение, 5 — уверенное владение с конкретными доказательствами.",
      messages: [{ role: "user", content: `Ситуация: ${question}\nОтвет педагога: ${answer}` }],
      maxTokens: 20,
    });
    const score = Number(String(text).match(/[1-5]/)?.[0]);
    return score >= 1 && score <= 5 ? score : inferScore(answer);
  } catch (error) {
    console.error("[inferScoreWithAi] failed:", error.message || error);
    return inferScore(answer);
  }
}
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function firstName(u) { return (u.fullName || "коллега").split(" ")[0]; }
function compOrder() { return COMPETENCIES.map((c) => c.id); }
function questionFor(idx) {
  const item = DIALOG_ITEMS[idx];
  if (!item) return null;
  return { ...item, comp: COMPETENCIES.find((competency) => competency.id === item.id) };
}

const DEFAULT_PROFILE = () => ({ stepIndex: 0, awaitingFollowup: false, answers: {}, notes: {}, done: false });

async function loadProfile(userId) {
  const { rows } = await query("SELECT * FROM ai_profiles WHERE user_id = $1", [userId]);
  if (!rows[0]) return DEFAULT_PROFILE();
  return { stepIndex: rows[0].step_index, awaitingFollowup: rows[0].awaiting_followup, answers: rows[0].answers, notes: rows[0].notes, done: rows[0].done };
}

async function saveProfile(userId, state) {
  await query(
    `INSERT INTO ai_profiles (user_id, step_index, awaiting_followup, answers, notes, done) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (user_id) DO UPDATE SET step_index = $2, awaiting_followup = $3, answers = $4, notes = $5, done = $6`,
    [userId, state.stepIndex, state.awaitingFollowup, JSON.stringify(state.answers), JSON.stringify(state.notes), state.done]
  );
}

export async function startDiagnostic(user) {
  await saveProfile(user.id, DEFAULT_PROFILE());
  await query("DELETE FROM ai_chats WHERE user_id = $1", [user.id]); // начинаем диагностику заново — старую историю чата с ИИ очищаем
  const q = questionFor(0);
  return [
    { role: "ai", text: `Привет, ${firstName(user)}! Это обязательная стартовая диагностика: **18 рабочих ситуаций по 6 компетенциям**. Отвечайте своими словами и приводите короткий пример из практики. Я определю уровень по смыслу ответа, подготовлю проект плана, а наставник проверит и утвердит его.` },
    { role: "ai", text: `**Вопрос 1 из ${DIALOG_ITEMS.length}**\n${q.comp.icon} **${q.comp.label}**\n${q.text}` },
  ];
}

export async function isDiagnosticActive(userId) {
  const { rows } = await query("SELECT done FROM ai_profiles WHERE user_id = $1", [userId]);
  return Boolean(rows[0] && !rows[0].done);
}

export async function getDiagnosticProgress(userId) {
  const { rows } = await query("SELECT step_index, awaiting_followup, done FROM ai_profiles WHERE user_id = $1", [userId]);
  if (!rows[0]) return { started: false, done: false, current: 0, total: DIALOG_ITEMS.length, percent: 0 };
  const current = rows[0].done ? DIALOG_ITEMS.length : Math.min(Number(rows[0].step_index || 0), DIALOG_ITEMS.length - 1);
  const question = questionFor(current);
  return {
    started: true,
    done: Boolean(rows[0].done),
    current: rows[0].done ? DIALOG_ITEMS.length : current + 1,
    total: DIALOG_ITEMS.length,
    percent: rows[0].done ? 100 : Math.round((current / DIALOG_ITEMS.length) * 100),
    competency: question?.id || null,
    awaitingFollowup: Boolean(rows[0].awaiting_followup),
  };
}

export async function handleDiagnosticReply(user, input) {
  const state = await loadProfile(user.id);
  const out = [];
  const idx = state.stepIndex;
  const q = questionFor(idx);

  if (state.awaitingFollowup) {
    state.notes[q.key] = input;
    state.awaitingFollowup = false;
    out.push({ role: "ai", text: pick(["Записал, это поможет точнее подобрать мероприятия.", "Спасибо, учту это в карте."]) });
    await advance(state, out, user);
    await saveProfile(user.id, state);
    return out;
  }

  const score = await inferScoreWithAi(q.text, input);
  state.answers[q.key] = score;
  out.push({ role: "ai", text: pick(MICRO_FEEDBACK[score]) });

  await advance(state, out, user);
  await saveProfile(user.id, state);
  return out;
}

async function advance(state, out, user) {
  state.stepIndex += 1;
  if (state.stepIndex >= DIALOG_ITEMS.length) {
    state.done = true;
    const scores = {};
    compOrder().forEach((id) => {
      const values = DIALOG_ITEMS.filter((item) => item.id === id).map((item) => Number(state.answers[item.key] || 3));
      scores[id] = Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
    });
    await query("UPDATE users SET scores = $1, current_stage = GREATEST(current_stage, 2) WHERE id = $2", [JSON.stringify(scores), user.id]);
    await awardCoins(user.id, REWARDS.DIAGNOSTIC_DONE, "Диагностика пройдена");
    const weak = COMPETENCIES.filter((c) => scores[c.id] <= 2.8).map((c) => `${c.icon} ${c.label} (${scores[c.id]}/5)`).join(", ") || "выраженных дефицитов не выявлено";
    const strong = COMPETENCIES.filter((c) => scores[c.id] >= 4).map((c) => `${c.icon} ${c.label} (${scores[c.id]}/5)`).join(", ") || "профиль пока ровный — сильные стороны проявятся в практике";
    out.push({ role: "ai", text: `**Диагностика завершена**\nСредний балл: **${(Object.values(scores).reduce((a, b) => a + b, 0) / 6).toFixed(1)}/5**\n\n**Сильные стороны:** ${strong}\n**Приоритеты развития:** ${weak}` });
    out.push({ role: "ai", text: `Теперь я подготовлю проект плана развития и найду мероприятия для региона «${user.region || "не указан"}». Проект получит ваш наставник: только после его проверки и утверждения карта станет рабочей.`, action: "generate-roadmap" });
  } else {
    const q = questionFor(state.stepIndex);
    out.push({ role: "ai", text: `**Вопрос ${state.stepIndex + 1} из ${DIALOG_ITEMS.length}**\n${q.comp.icon} **${q.comp.label}**\n${q.text}` });
  }
}

// ---------------- ongoing assistant (quick actions + free chat) ----------------
// Цифровой ИИ-наставник выполняет основные функции наставника (диагностика, подбор
// мероприятий, разбор рабочих ситуаций, план развития) — человек-наставник, согласно
// методологии Поляковой Г.Д. (гл. 3.2), только корректирует итоговую дорожную карту.
export const QUICK_ACTIONS = [
  { id: "map", label: "🗺️ Обновить дорожную карту (поиск в интернете)" },
  { id: "analyze", label: "🔍 Анализ дефицитов" },
  { id: "week", label: "📅 План на неделю" },
  { id: "attest", label: "🎯 Подготовка к аттестации" },
  { id: "class", label: "💡 Как работать с классом?" },
];

export function quickActionText(id, user) {
  switch (id) {
    case "map": return `Найди реальные мероприятия для молодых педагогов в регионе ${user.region || "моём регионе"} и обнови мою дорожную карту.`;
    case "analyze": return "Проведи углублённый анализ моих профессиональных дефицитов.";
    case "week": return `Составь план профессионального развития на эту неделю с учётом предмета (${user.subject || "—"}).`;
    case "attest": return "Как мне подготовиться к аттестации? Расскажи пошагово.";
    case "class": return "Дай конкретные техники управления классом для молодого педагога.";
    default: return "";
  }
}

function weakestComp(user) {
  const scores = user.scores || {};
  const comps = COMPETENCIES.map((c) => ({ comp: c, score: scores[c.id] || 3 }));
  comps.sort((a, b) => a.score - b.score);
  return comps[0];
}
function adviceFor(id) {
  const map = {
    subject: "обновите знания на курсах ПК, ведите дневник сложных вопросов учеников.",
    pedagogy: "внедрите чёткие правила урока с первой минуты, используйте «выходной билет» в конце.",
    method: "начните с шаблона рабочей программы наставника, адаптируйте постепенно.",
    digital: "выделяйте 20 минут в неделю на один новый инструмент МЭШ/ЭОР.",
    communication: "готовьте краткий скрипт перед сложным разговором.",
    personal: "выберите один конкурс или сообщество на квартал.",
  };
  return map[id] || "поговорите с наставником о конкретных шагах.";
}

function localAnswer(user, text) {
  const t = text.toLowerCase();
  const has = user.scores && Object.values(user.scores).some((v) => v > 0);
  if (/карт|маршрут|roadmap|мероприят/.test(t)) return "Чтобы найти актуальные мероприятия в вашем регионе и обновить карту, используйте кнопку «Обновить дорожную карту» — я поищу в интернете.";
  if (/дефицит|анализ|слаб/.test(t)) {
    if (!has) return "Диагностика ещё не пройдена — пройдите её, чтобы я мог точно определить дефициты.";
    let out = "🔍 Анализ дефицитов:\n";
    COMPETENCIES.forEach((c) => { const s = user.scores[c.id]; if (s && s <= 3) out += `${c.icon} ${c.label} (${s}/5) → ${adviceFor(c.id)}\n`; });
    return out.trim();
  }
  if (/недел|план на/.test(t)) {
    const w = has ? weakestComp(user) : null;
    return "📅 План на неделю:\nПн–Вт: практика по предмету.\nСр: наблюдение открытого урока.\nЧт: разговор с наставником.\nПт: рефлексия в «Заметках»." + (w ? `\nОсобое внимание — ${w.comp.label}: ${adviceFor(w.comp.id)}` : "");
  }
  if (/аттестац/.test(t)) return "🎯 Портфолио, самоанализ по 6 компетенциям, открытый урок, документы за 2 месяца, репетиция защиты с наставником.";
  if (/класс|дисциплин/.test(t)) return "💡 Правило первой минуты, проксимити-контроль, «выходной билет», невербальные сигналы, конкретная похвала сразу.";
  if (/родител/.test(t)) return "🗣️ Начинайте с позитива, формулируйте через поведение, предлагайте конкретный план, фиксируйте письменно.";
  if (/привет|здравств/.test(t)) return `Здравствуйте, ${firstName(user)}! Чем могу помочь?`;
  if (!has) return "Пока не вижу результатов диагностики — пройдите её, и я смогу давать советы точнее.";
  const w = weakestComp(user);
  return `Судя по карте, точка роста — ${w.comp.icon} ${w.comp.label} (${w.score}/5). Расскажите подробнее о ситуации, либо выберите быстрое действие ниже.`;
}

const SYS_PROMPT = "Ты — цифровой ассистент пары «педагог + наставник» в системе «НавигаторПедагога». Анализируй диагностику, утверждённую дорожную карту, прогресс и комментарии наставника. Предлагай конкретные корректировки, но никогда не утверждай, что сам изменил рабочий план: ИИ создаёт предложение, наставник редактирует и публикует версию. Отвечай на русском, конкретно, без длинных вступлений. Не изобретай мероприятия и ссылки.";

export async function assistantReply(user, text, history) {
  if (hasApiKey()) {
    try {
      const { rows: roadmapRows } = await query("SELECT status, version, summary, mentor_comment, priorities FROM roadmaps WHERE user_id = $1", [user.id]);
      const roadmap = roadmapRows[0];
      const roadmapContext = roadmap ? ` Статус плана: ${roadmap.status}; версия: ${roadmap.version || 0}; резюме: ${roadmap.summary || "—"}; комментарий наставника: ${roadmap.mentor_comment || "—"}; приоритеты: ${JSON.stringify(roadmap.priorities || []).slice(0, 3500)}.` : " План ещё не создан.";
      const ctx = (user.scores && Object.values(user.scores).some((v) => v > 0)
        ? `[Педагог: ${user.fullName}, предмет: ${user.subject}, регион: ${user.region}, баллы: ${Object.entries(user.scores).map(([k, v]) => k + ":" + v).join(" ")}] `
        : `[Педагог: ${user.fullName}, предмет: ${user.subject}, регион: ${user.region}, диагностика не пройдена] `) + roadmapContext;
      const msgs = (history || []).slice(-10).map((m) => ({ role: m.role === "ai" ? "assistant" : "user", content: m.text }));
      const last = msgs[msgs.length - 1];
      if (last && last.role === "user") last.content = ctx + last.content;
      const { text: replyText } = await callGemini({ system: SYS_PROMPT, messages: msgs, maxTokens: 900 });
      return replyText;
    } catch (e) {
      console.error("[assistantReply] Gemini call failed:", e.message || e);
      return localAnswer(user, text) + `\n\n_(офлайн-режим: ${e.code || "ошибка API"})_`;
    }
  }
  return localAnswer(user, text);
}
