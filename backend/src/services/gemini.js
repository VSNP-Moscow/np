/**
 * Единая обёртка над OpenAI-совместимым AI-шлюзом.
 *
 * Сохраняем прежнее имя файла и экспортов, чтобы остальные сервисы проекта
 * Сначала используется SmartAPI с моделью gpt-5.6-luna, если задан его ключ.
 * Groq Compound остаётся резервным провайдером для локального запуска.
 */

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const SMARTAPI_BASE_URL = (process.env.SMARTAPI_BASE_URL || "https://api.smartapi.shop/v1").replace(/\/+$/, "");
const SMARTAPI_MODEL = process.env.SMARTAPI_MODEL || "gpt-5.6-luna";
const GROQ_MODEL = process.env.GROQ_MODEL || "groq/compound";

export function hasApiKey() {
  return Boolean(process.env.SMARTAPI_API_KEY || process.env.GROQ_API_KEY);
}

export function aiProviderInfo() {
  return process.env.SMARTAPI_API_KEY
    ? { provider: "smartapi", model: SMARTAPI_MODEL }
    : process.env.GROQ_API_KEY
      ? { provider: "groq", model: GROQ_MODEL }
      : { provider: "offline", model: null };
}

function serializeMessages(system, messages) {
  return [
    ...(system ? [{ role: "system", content: system }] : []),
    ...(messages || []).map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: String(message.content || ""),
    })),
  ];
}

function collectUrls(value, target = new Set()) {
  if (typeof value === "string") {
    for (const url of value.match(/https?:\/\/[^\s)\]}>"']+/g) || []) target.add(url.replace(/[.,;]+$/, ""));
  } else if (Array.isArray(value)) {
    value.forEach((item) => collectUrls(item, target));
  } else if (value && typeof value === "object") {
    Object.values(value).forEach((item) => collectUrls(item, target));
  }
  return target;
}

function isQuotaError(error) {
  return error?.status === 429 || /rate.?limit|quota|too many requests/i.test(String(error?.message || ""));
}

/**
 * @param {object} opts
 * @param {string} opts.system
 * @param {Array<{role:'user'|'assistant', content:string}>} opts.messages
 * @param {boolean} [opts.googleSearch] - включить встроенные инструменты поиска
 * @param {string[]} [opts.searchTools] - ограниченный набор Compound-инструментов
 * @param {number} [opts.maxTokens]
 * @returns {Promise<{text:string, sources:string[], raw:object}>}
 */
export async function callGemini({ system, messages, googleSearch = false, searchTools, maxTokens = 1800 }) {
  if (!hasApiKey()) {
    const error = new Error("NoApiKey");
    error.code = "NoApiKey";
    throw error;
  }

  const smartApi = Boolean(process.env.SMARTAPI_API_KEY);
  const provider = smartApi ? "smartapi" : "groq";
  const body = {
    model: smartApi ? SMARTAPI_MODEL : GROQ_MODEL,
    messages: serializeMessages(system, messages),
    max_tokens: maxTokens,
    temperature: 0.35,
  };
  if (googleSearch && !smartApi) {
    body.compound_custom = { tools: { enabled_tools: searchTools || ["web_search", "visit_website"] } };
  }

  try {
    const response = await fetch(smartApi ? `${SMARTAPI_BASE_URL}/chat/completions` : GROQ_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${smartApi ? process.env.SMARTAPI_API_KEY : process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json",
        ...(smartApi ? {} : { "Groq-Model-Version": process.env.GROQ_MODEL_VERSION || "latest" }),
      },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = payload?.error?.message || `Groq API HTTP ${response.status}`;
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }

    const message = payload?.choices?.[0]?.message || {};
    const text = typeof message.content === "string" ? message.content : "";
    const sources = [...collectUrls([text, message.executed_tools, payload.citations])];
    return { text, sources, raw: payload };
  } catch (cause) {
    console.error(`[${provider}.js] API error:`, cause?.message || cause);
    const error = new Error(cause?.message || `${provider} API error`);
    error.status = cause?.status;
    error.code = isQuotaError(cause) ? "превышена бесплатная квота" : "APIError";
    throw error;
  }
}

/** Извлекает последний блок ```json ... ``` из текстового ответа. */
export function extractJsonBlock(text) {
  if (!text) return null;
  const matches = [...String(text).matchAll(/```json\s*([\s\S]*?)```/gi)];
  if (!matches.length) return null;
  try { return JSON.parse(matches[matches.length - 1][1]); } catch { return null; }
}
