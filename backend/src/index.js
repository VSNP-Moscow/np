import "dotenv/config";
import express from "express";
import cors from "cors";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { initSchema, seedIfEmpty, databaseInfo } from "./db.js";
import { hasApiKey, aiProviderInfo } from "./services/gemini.js";
import authRoutes from "./routes/auth.js";
import userRoutes from "./routes/users.js";
import eventRoutes from "./routes/events.js";
import noteRoutes from "./routes/notes.js";
import messageRoutes from "./routes/messages.js";
import aiRoutes from "./routes/ai.js";
import diagnosticRoutes from "./routes/diagnostic.js";
import cronRoutes from "./routes/cron.js";
import groupRoutes from "./routes/groups.js";
import testRoutes from "./routes/tests.js";
import assignmentRoutes from "./routes/assignments.js";
import notificationRoutes from "./routes/notifications.js";
import fileRoutes from "./routes/files.js";
import reportRoutes from "./routes/reports.js";
import activityRoutes from "./routes/activity.js";
import { query } from "./db.js";
import crypto from "node:crypto";

await initSchema();
await seedIfEmpty();

const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(cors(process.env.CORS_ORIGIN ? { origin: process.env.CORS_ORIGIN.split(",").map((item) => item.trim()) } : undefined));
app.use(express.json({ limit: "8mb" }));
app.use(morgan("tiny"));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  next();
});

// Persist an audit trail for every state-changing authenticated request.
// Only metadata is stored; request bodies can contain private chat/file data.
app.use((req, res, next) => {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method) || req.path.startsWith("/api/cron/")) return next();
  res.on("finish", () => {
    const actorId = req.user?.id || res.locals.auditUserId;
    if (!actorId) return;
    const ip = req.ip || req.socket?.remoteAddress || "";
    const ipHash = crypto.createHash("sha256").update(`${process.env.JWT_SECRET || "navigator"}:${ip}`).digest("hex").slice(0, 24);
    query(
      "INSERT INTO activity_log (user_id, method, path, status_code, ip_hash, user_agent) VALUES ($1,$2,$3,$4,$5,$6)",
      [actorId, req.method, req.path.slice(0, 300), res.statusCode, ipHash, String(req.headers["user-agent"] || "").slice(0, 300)]
    ).catch((error) => console.error("activity_log:", error.message));
  });
  next();
});

const globalLimiter = rateLimit({ windowMs: 60_000, max: 240, standardHeaders: true, legacyHeaders: false });
app.use(globalLimiter);

app.get("/api/health", (req, res) => {
  res.json({ ok: true, liveAiMode: hasApiKey(), ...aiProviderInfo(), database: databaseInfo().driver, time: new Date().toISOString() });
});

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/events", eventRoutes);
app.use("/api/notes", noteRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/diagnostic", diagnosticRoutes);
app.use("/api/cron", cronRoutes);
app.use("/api/groups", groupRoutes);
app.use("/api/tests", testRoutes);
app.use("/api/assignments", assignmentRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/files", fileRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/activity", activityRoutes);

// При обычном запуске один Node-процесс раздаёт и API, и фронтенд.
// Это позволяет опубликовать сервис одной бесплатной публичной ссылкой.
const frontendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../frontend");
if (fs.existsSync(frontendDir)) {
  app.use(express.static(frontendDir, { maxAge: process.env.NODE_ENV === "production" ? "1h" : 0 }));
  app.use((req, res, next) => {
    if (req.method === "GET" && !req.path.startsWith("/api/")) return res.sendFile(path.join(frontendDir, "index.html"));
    next();
  });
}
app.use((req, res) => res.status(404).json({ error: "Не найдено" }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Внутренняя ошибка сервера" });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`НавигаторПедагога API запущен на порту ${PORT}`);
  const ai = aiProviderInfo();
  console.log(hasApiKey() ? `✅ AI подключён: ${ai.provider} / ${ai.model}.` : "⚠️  Ключ AI-провайдера не задан — ИИ работает в офлайн-режиме.");
});
