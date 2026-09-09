import pg from "pg";
import { DatabaseSync } from "node:sqlite";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TEST_BANK } from "./data/testBank.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { Pool } = pg;
const usePostgres = Boolean(process.env.DATABASE_URL);

/*
 * Бесплатный режим по умолчанию.
 * При отсутствии DATABASE_URL используется встроенная SQLite из Node 22+.
 * Данные живут в backend/data/navpedagoga.sqlite и не пропадают после
 * перезапуска. Если DATABASE_URL появится позже, PostgreSQL остаётся
 * поддерживаемым без изменения роутов.
 */
const sqlitePath = path.resolve(process.env.DB_PATH || path.join(__dirname, "data", "navpedagoga.sqlite"));
let sqlite;
let pgPool;

if (usePostgres) {
  pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes("localhost") ? false : { rejectUnauthorized: false },
  });
} else {
  fs.mkdirSync(path.dirname(sqlitePath), { recursive: true });
  sqlite = new DatabaseSync(sqlitePath);
  sqlite.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
}

export const pool = usePostgres
  ? pgPool
  : {
      async query(text, params = []) { return sqliteQuery(text, params); },
      async connect() {
        return {
          query: async (text, params = []) => sqliteQuery(text, params),
          release() {},
        };
      },
    };

const JSON_COLUMNS = new Set(["scores", "priorities", "answers", "notes", "chips", "questions", "sources", "search_status", "test_answers", "options"]);

function hydrateRows(rows) {
  return rows.map((row) => {
    const out = { ...row };
    for (const [key, value] of Object.entries(out)) {
      if (JSON_COLUMNS.has(key) && typeof value === "string") {
        try { out[key] = JSON.parse(value); } catch { /* keep malformed legacy data readable */ }
      }
    }
    return out;
  });
}

function normalizeSql(text) {
  let sql = String(text).trim();
  sql = sql.replace(/\bNOW\(\)/gi, "CURRENT_TIMESTAMP");
  sql = sql.replace(/\bGREATEST\(/gi, "MAX(");
  sql = sql.replace(/([A-Za-z_][\w.]*)::float\b/gi, "CAST($1 AS REAL)");
  sql = sql.replace(/([A-Za-z_][\w.]*)::double precision\b/gi, "CAST($1 AS REAL)");
  sql = sql.replace(/'epoch'::timestamptz/gi, "'1970-01-01 00:00:00'");
  sql = sql.replace(/::timestamptz\b/gi, "");
  sql = sql.replace(/::(?:int|integer|smallint|bigint)\b/gi, "");
  sql = sql.replace(/\bILIKE\b/gi, "LIKE");
  sql = sql.replace(/COUNT\(([^()]+)\)\s+FILTER\s*\(\s*WHERE\s+([^()]+)\)/gi, "SUM(CASE WHEN $2 THEN 1 ELSE 0 END)");
  return sql;
}

function bindParams(params) {
  return Object.fromEntries((params || []).map((value, index) => {
    if (typeof value === "boolean") value = value ? 1 : 0;
    if (value instanceof Date) value = value.toISOString();
    return [`$${index + 1}`, value];
  }));
}

function sqliteQuery(text, params = []) {
  const sql = normalizeSql(text);
  if (/^(BEGIN|COMMIT|ROLLBACK)\b/i.test(sql)) {
    sqlite.exec(sql);
    return { rows: [], rowCount: 0 };
  }
  const statement = sqlite.prepare(sql);
  const bound = bindParams(params);
  const returnsRows = /^\s*(SELECT|WITH|PRAGMA)\b/i.test(sql) || /\bRETURNING\b/i.test(sql);
  if (returnsRows) {
    const rows = hydrateRows(statement.all(bound));
    return { rows, rowCount: rows.length };
  }
  const result = statement.run(bound);
  return { rows: [], rowCount: Number(result.changes || 0) };
}

export async function query(text, params) {
  if (usePostgres) return pgPool.query(text, params);
  return sqliteQuery(text, params);
}

export const COMPETENCIES = [
  { id: "subject", icon: "📚", label: "Предметные", short: "Предмет", color: "green", desc: "Знание предмета, научная база" },
  { id: "pedagogy", icon: "🧠", label: "Психолого-педагогическое", short: "Психология", color: "purple", desc: "Управление классом, работа с учениками" },
  { id: "method", icon: "📋", label: "Методическое", short: "Методика", color: "magenta", desc: "Планирование, разработка рабочих программ" },
  { id: "digital", icon: "💻", label: "Цифровое / ИКТ", short: "Цифра", color: "yellow", desc: "МЭШ, ЭОР, медиаграмотность" },
  { id: "communication", icon: "🗣️", label: "Коммуникативное", short: "Общение", color: "purple", desc: "Родители, коллеги, администрация" },
  { id: "personal", icon: "⭐", label: "Личностное", short: "Бренд", color: "magenta", desc: "Бренд педагога, конкурсы, лидерство" },
];

export const ALGO_STAGES = [
  "Диагностика дефицитов",
  "Создание пары наставник—наставляемый",
  "Корректировка карты",
  "Обучение и мероприятия",
  "Рефлексивный анализ",
  "Цифровое портфолио",
];

export const NOTE_CATS = ["Личное", "Урок", "Наставничество", "Мероприятие", "Рефлексия", "Администрирование"];

export function mapUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    role: row.role,
    subject: row.subject,
    school: row.school,
    region: row.region,
    yearsExperience: row.years_experience,
    currentStage: row.current_stage,
    mentorId: row.mentor_id,
    mentorStatus: row.mentor_status,
    approvedByAdmin: Boolean(row.approved_by_admin),
    scores: row.scores,
    avatarColor: row.avatar_color,
    coins: row.coins || 0,
    xp: row.xp || 0,
    createdAt: row.created_at instanceof Date ? row.created_at.getTime() : row.created_at,
  };
}

export const publicUser = mapUser;

export function mapEvent(row, completed) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    date: row.event_date,
    time: row.event_time,
    type: row.type,
    area: row.area,
    region: row.region,
    url: row.url,
    source: row.source,
    weight: row.weight,
    createdBy: row.created_by,
    completed: Boolean(completed?.completed),
    reflection: completed?.reflection || "",
  };
}

export function mapNote(row) {
  if (!row) return null;
  return { id: row.id, userId: row.user_id, title: row.title, content: row.content, category: row.category, updatedAt: row.updated_at instanceof Date ? row.updated_at.getTime() : row.updated_at };
}

export function mapMessage(row) {
  if (!row) return null;
  return {
    id: row.id,
    from: row.from_user_id,
    to: row.to_user_id,
    text: row.text,
    readAt: row.read_at instanceof Date ? row.read_at.getTime() : row.read_at,
    ts: row.created_at instanceof Date ? row.created_at.getTime() : row.created_at,
  };
}

export async function initSchema() {
  const schemaName = usePostgres ? "schema.sql" : "schema.sqlite.sql";
  const schema = fs.readFileSync(path.join(__dirname, "data", schemaName), "utf8");
  if (usePostgres) await pgPool.query(schema);
  else sqlite.exec(schema);

  // Existing installations predate binary attachment storage. Keep the
  // migration idempotent so every Render deploy can run it safely.
  if (usePostgres) {
    await pgPool.query("ALTER TABLE message_attachments ADD COLUMN IF NOT EXISTS data_bytes BYTEA");
    await pgPool.query("ALTER TABLE message_attachments ALTER COLUMN data_base64 DROP NOT NULL");
    await pgPool.query("ALTER TABLE roadmaps ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'approved'");
    await pgPool.query("ALTER TABLE roadmaps ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0");
    await pgPool.query("ALTER TABLE roadmaps ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'ai'");
    await pgPool.query("ALTER TABLE roadmaps ADD COLUMN IF NOT EXISTS mentor_comment TEXT");
    await pgPool.query("ALTER TABLE roadmaps ADD COLUMN IF NOT EXISTS change_reason TEXT");
    await pgPool.query("ALTER TABLE roadmaps ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(id) ON DELETE SET NULL");
    await pgPool.query("ALTER TABLE roadmaps ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id) ON DELETE SET NULL");
    await pgPool.query("ALTER TABLE roadmaps ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ");
    await pgPool.query("ALTER TABLE roadmaps ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now()");
    await pgPool.query("ALTER TABLE roadmaps ADD COLUMN IF NOT EXISTS sources JSONB NOT NULL DEFAULT '[]'");
    await pgPool.query("ALTER TABLE roadmaps ADD COLUMN IF NOT EXISTS search_status JSONB NOT NULL DEFAULT '{}'");
  } else {
    const columns = sqlite.prepare("PRAGMA table_info(message_attachments)").all();
    if (!columns.some((column) => column.name === "data_bytes")) {
      sqlite.exec("ALTER TABLE message_attachments ADD COLUMN data_bytes BLOB");
    }
    const roadmapColumns = sqlite.prepare("PRAGMA table_info(roadmaps)").all();
    const roadmapMigrations = [
      ["status", "ALTER TABLE roadmaps ADD COLUMN status TEXT NOT NULL DEFAULT 'approved'"],
      ["version", "ALTER TABLE roadmaps ADD COLUMN version INTEGER NOT NULL DEFAULT 0"],
      ["source", "ALTER TABLE roadmaps ADD COLUMN source TEXT NOT NULL DEFAULT 'ai'"],
      ["mentor_comment", "ALTER TABLE roadmaps ADD COLUMN mentor_comment TEXT"],
      ["change_reason", "ALTER TABLE roadmaps ADD COLUMN change_reason TEXT"],
      ["updated_by", "ALTER TABLE roadmaps ADD COLUMN updated_by TEXT"],
      ["approved_by", "ALTER TABLE roadmaps ADD COLUMN approved_by TEXT"],
      ["approved_at", "ALTER TABLE roadmaps ADD COLUMN approved_at TEXT"],
      ["updated_at", "ALTER TABLE roadmaps ADD COLUMN updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP"],
      ["sources", "ALTER TABLE roadmaps ADD COLUMN sources TEXT NOT NULL DEFAULT '[]'"],
      ["search_status", "ALTER TABLE roadmaps ADD COLUMN search_status TEXT NOT NULL DEFAULT '{}'"],
    ];
    for (const [name, sql] of roadmapMigrations) {
      if (!roadmapColumns.some((column) => column.name === name)) sqlite.exec(sql);
    }
  }
}

export async function seedIfEmpty() {
  const { rows } = await query("SELECT COUNT(*)::int AS n FROM users");
  if (Number(rows[0].n) > 0) return;

  const passHash = await bcrypt.hash("123456", 10);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const admin = await client.query(
      `INSERT INTO users (full_name, email, password_hash, role, subject, school, region, years_experience, current_stage, approved_by_admin, scores, avatar_color)
       VALUES ($1,$2,$3,'admin',$4,$5,$6,$7,6,true,$8,'purple') RETURNING id`,
      ["Администратор Системы", "admin@np.ru", passHash, "Администрация", "ГБОУ Школа №1248", "Москва", 8, JSON.stringify({ subject: 0, pedagogy: 0, method: 0, digital: 0, communication: 0, personal: 0 })]
    );
    const mentor = await client.query(
      `INSERT INTO users (full_name, email, password_hash, role, subject, school, region, years_experience, current_stage, approved_by_admin, scores, avatar_color)
       VALUES ($1,$2,$3,'mentor',$4,$5,$6,$7,6,true,$8,'green') RETURNING id`,
      ["Анна Сергеевна Козлова", "mentor@np.ru", passHash, "Математика", "ГБОУ Школа №1248", "Москва", 12, JSON.stringify({ subject: 5, pedagogy: 4, method: 5, digital: 4, communication: 5, personal: 4 })]
    );
    const user = await client.query(
      `INSERT INTO users (full_name, email, password_hash, role, subject, school, region, years_experience, current_stage, mentor_id, mentor_status, approved_by_admin, scores, avatar_color)
       VALUES ($1,$2,$3,'user',$4,$5,$6,$7,3,$8,'confirmed',true,$9,'magenta') RETURNING id`,
      ["Михаил Александрович Петров", "user@np.ru", passHash, "История", "ГБОУ Школа №1248", "Москва", 1, mentor.rows[0].id, JSON.stringify({ subject: 3, pedagogy: 2, method: 3, digital: 2, communication: 3, personal: 4 })]
    );
    const events = [
      ["Вебинар: Управление классом в современной школе", "Практические инструменты управления поведением учеников.", "15 сентября", "18:00", "online", "pedagogy", "Все регионы", 2],
      ["Мастер-класс: Цифровые инструменты учителя", "Обзор МЭШ, ЦОС и EdTech-инструментов.", "20 сентября", "16:00", "online", "digital", "Все регионы", 2],
      ["Открытый урок: Лучшие методики преподавания", "Мастер-класс от победителей конкурса «Учитель года».", "28 сентября", "10:00", "offline", "method", "Москва", 3],
      ["Тренинг: Коммуникация с родителями", "Разбор конфликтных ситуаций.", "3 октября", "17:00", "online", "communication", "Все регионы", 2],
      ["Конкурс молодых педагогов Москвы", "Городской конкурс для молодых специалистов.", "10 октября", "09:00", "offline", "personal", "Москва", 3],
      ["Курсы ПК: Обновление предметных знаний", "Актуальные научные подходы к преподаванию предмета.", "18 октября", "14:00", "online", "subject", "Все регионы", 5],
    ];
    for (const [title, description, event_date, event_time, type, area, region, weight] of events) {
      await client.query(`INSERT INTO events (title, description, event_date, event_time, type, area, region, source, weight, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,'Каталог платформы',$8,$9)`, [title, description, event_date, event_time, type, area, region, weight, admin.rows[0].id]);
    }
    for (const [title, content, category] of [["Первый урок в 8Б", "Провёл первый урок. Дисциплина слабеет к концу — попробую «выходной билет».", "Рефлексия"], ["Совет наставника по ИКТ", "Анна Сергеевна рекомендовала библиотеку МЭШ.", "Наставничество"]]) {
      await client.query("INSERT INTO notes (user_id, title, content, category) VALUES ($1,$2,$3,$4)", [user.rows[0].id, title, content, category]);
    }
    for (let i = 0; i < TEST_BANK.length; i++) {
      const item = TEST_BANK[i];
      await client.query("INSERT INTO diagnostic_items (competency_id, text, weight, sort_order) VALUES ($1,$2,$3,$4)", [item.competency, item.text, item.weight, i]);
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export function newId() { return crypto.randomUUID(); }
export function databaseInfo() { return { driver: usePostgres ? "postgres" : "sqlite", path: usePostgres ? null : sqlitePath }; }
export function isPostgres() { return usePostgres; }
