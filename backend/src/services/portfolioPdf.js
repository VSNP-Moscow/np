import PDFDocument from "pdfkit";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONT_REGULAR = path.resolve(__dirname, "../../node_modules/dejavu-fonts-ttf/ttf/DejaVuSans.ttf");
const FONT_BOLD = path.resolve(__dirname, "../../node_modules/dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf");
const COLORS = { ink: "#173629", body: "#3E4D44", faint: "#738078", green: "#47735B", paper: "#F7F8F4", accent: "#E5AA3C", coral: "#E27457", line: "#DCE5DD" };

function dateText(value) {
  if (!value) return "Дата не указана";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat("ru-RU", { dateStyle: "long" }).format(date);
}

function ensureSpace(doc, height = 90) {
  if (doc.y + height <= doc.page.height - 64) return;
  doc.addPage();
}

function sectionTitle(doc, title) {
  ensureSpace(doc, 58);
  doc.x = 48;
  doc.moveDown(.7).font("Bold").fontSize(15).fillColor(COLORS.ink).text(title, 48, doc.y, { width: 499 });
  doc.moveDown(.25).strokeColor(COLORS.accent).lineWidth(2).moveTo(48, doc.y).lineTo(118, doc.y).stroke();
  doc.moveDown(.65);
}

function evidenceRows(doc, rows, emptyText) {
  if (!rows.length) {
    doc.font("Regular").fontSize(9.5).fillColor(COLORS.faint).text(emptyText, 48, doc.y, { width: 499 });
    return;
  }
  rows.forEach((row) => {
    ensureSpace(doc, 70);
    doc.roundedRect(48, doc.y, 499, 52, 8).fillAndStroke("#FFFFFF", COLORS.line);
    const top = doc.y + 10;
    doc.font("Bold").fontSize(9.5).fillColor(COLORS.ink).text(row.title, 62, top, { width: 360, ellipsis: true });
    doc.font("Regular").fontSize(8.5).fillColor(COLORS.body).text(row.description || "Подтверждено данными платформы", 62, top + 17, { width: 370, height: 23, ellipsis: true });
    doc.font("Regular").fontSize(8).fillColor(COLORS.faint).text(dateText(row.date), 430, top, { width: 102, align: "right" });
    doc.y = top + 52;
  });
}

export function createPortfolioPdf(portfolio) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margins: { top: 44, right: 48, bottom: 58, left: 48 }, bufferPages: true, info: { Title: `Портфолио ${portfolio.profile.fullName}`, Author: "НавигаторПедагога" } });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.registerFont("Regular", FONT_REGULAR);
    doc.registerFont("Bold", FONT_BOLD);

    doc.rect(0, 0, doc.page.width, 205).fill(COLORS.ink);
    doc.roundedRect(48, 38, 38, 38, 10).fill(COLORS.accent);
    doc.font("Bold").fontSize(16).fillColor(COLORS.ink).text("NP", 55, 47);
    doc.font("Bold").fontSize(10).fillColor("#FFFFFF").text("НАВИГАТОРПЕДАГОГА", 98, 49);
    doc.font("Regular").fontSize(8).fillColor("#BFD1C7").text("Цифровое профессиональное портфолио", 98, 66);
    doc.font("Bold").fontSize(25).fillColor("#FFFFFF").text(portfolio.profile.fullName, 48, 104, { width: 490 });
    doc.font("Regular").fontSize(10).fillColor("#DCE8E1").text(`${portfolio.profile.subject}  |  ${portfolio.profile.school}  |  ${portfolio.profile.region}`, 48, 145, { width: 490 });
    doc.font("Regular").fontSize(8).fillColor("#AFC3B8").text(`Сформировано ${dateText(portfolio.generatedAt)}  |  Этап ${portfolio.profile.stage} из 6`, 48, 169);
    doc.y = 226;

    sectionTitle(doc, "Профессиональный профиль");
    doc.font("Regular").fontSize(10).fillColor(COLORS.body).text(portfolio.summary, 48, doc.y, { width: 499, lineGap: 4, align: "left" });
    doc.moveDown(.6);
    const facts = [
      `Стаж: ${portfolio.profile.yearsExperience} лет`,
      `Наставник: ${portfolio.profile.mentor || "не назначен"}`,
      `Сильные стороны: ${portfolio.strengths.join(", ") || "диагностика не завершена"}`,
      `Точки роста: ${portfolio.growthAreas.join(", ") || "диагностика не завершена"}`,
    ];
    facts.forEach((fact) => doc.font("Regular").fontSize(9.5).fillColor(COLORS.body).text(`• ${fact}`, 48, doc.y, { width: 499, lineGap: 2 }));

    sectionTitle(doc, "Профиль компетенций");
    portfolio.scores.forEach((score) => {
      ensureSpace(doc, 36);
      const y = doc.y;
      doc.font("Regular").fontSize(9).fillColor(COLORS.body).text(score.label, 48, y, { width: 220 });
      doc.roundedRect(275, y + 2, 225, 9, 4).fill("#E9EFEA");
      doc.roundedRect(275, y + 2, Math.max(0, 225 * (score.value / 5)), 9, 4).fill(score.value <= 2 ? COLORS.coral : COLORS.green);
      doc.font("Bold").fontSize(9).fillColor(COLORS.ink).text(score.value ? `${score.value}/5` : "—", 508, y, { width: 38, align: "right" });
      doc.y = y + 27;
    });

    sectionTitle(doc, "Показатели развития");
    const metrics = [
      ["Мероприятий", portfolio.metrics.completedEvents],
      ["Отчётов", portfolio.metrics.submittedReports],
      ["Заданий", portfolio.metrics.completedAssignments],
      ["Материалов", portfolio.metrics.portfolioItems],
    ];
    const metricsY = doc.y;
    metrics.forEach(([label, value], index) => {
      const x = 48 + index * 125;
      doc.roundedRect(x, metricsY, 113, 55, 8).fill(index === 0 ? "#E6F0E8" : index === 1 ? "#FFF0EA" : index === 2 ? "#FFF4D8" : "#DDF3E8");
      doc.font("Bold").fontSize(17).fillColor(COLORS.ink).text(String(value), x + 12, metricsY + 10);
      doc.font("Regular").fontSize(7.5).fillColor(COLORS.faint).text(label.toUpperCase(), x + 12, metricsY + 33, { width: 90 });
    });
    doc.y = metricsY + 67;

    ensureSpace(doc, 130);
    sectionTitle(doc, "Подтверждённые достижения");
    evidenceRows(doc, portfolio.evidence.items.map((item) => ({ title: item.title, description: item.description, date: item.date || item.createdAt })), "Добавленные достижения пока отсутствуют.");

    sectionTitle(doc, "Обучение и мероприятия");
    evidenceRows(doc, portfolio.evidence.events.map((item) => ({ title: item.title, description: item.reflection, date: item.completed_at })), "Завершённых мероприятий пока нет.");

    sectionTitle(doc, "Отчёты и рефлексия");
    evidenceRows(doc, portfolio.evidence.reports.map((item) => ({ title: item.event_title, description: item.report_text, date: item.updated_at })), "Отчётов по дорожной карте пока нет.");

    const range = doc.bufferedPageRange();
    for (let index = range.start; index < range.start + range.count; index += 1) {
      doc.switchToPage(index);
      const bottomMargin = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.strokeColor(COLORS.line).lineWidth(1).moveTo(48, doc.page.height - 39).lineTo(547, doc.page.height - 39).stroke();
      doc.font("Regular").fontSize(7.5).fillColor(COLORS.faint).text("НавигаторПедагога · цифровое наставничество", 48, doc.page.height - 29, { width: 390, lineBreak: false });
      doc.text(`${index + 1} / ${range.count}`, 480, doc.page.height - 29, { width: 67, align: "right", lineBreak: false });
      doc.page.margins.bottom = bottomMargin;
    }
    doc.end();
  });
}
