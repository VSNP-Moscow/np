import { LogLevel, WorkerMailer } from "worker-mailer";

interface Env {
  SMTP_USER: string;
  SMTP_PASS: string;
  RELAY_SECRET: string;
}

interface MailPayload {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
}

const MAX_BODY_BYTES = 256 * 1024;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(body: Record<string, unknown>, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function secretsEqual(actual: string, expected: string): boolean {
  if (!actual || actual.length !== expected.length) return false;
  let different = 0;
  for (let index = 0; index < actual.length; index += 1) {
    different |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return different === 0;
}

function isEmail(value: unknown): value is string {
  return typeof value === "string" && value.length <= 254 && EMAIL_PATTERN.test(value);
}

function parsePayload(value: unknown): MailPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  const allowed = new Set(["to", "subject", "text", "html", "replyTo"]);
  if (Object.keys(payload).some((key) => !allowed.has(key))) return null;
  if (!isEmail(payload.to) || typeof payload.subject !== "string" || typeof payload.text !== "string") return null;
  if (payload.subject.length < 1 || payload.subject.length > 180 || payload.text.length < 1 || payload.text.length > 20_000) return null;
  if (payload.html !== undefined && (typeof payload.html !== "string" || payload.html.length > 100_000)) return null;
  if (payload.replyTo !== undefined && !isEmail(payload.replyTo)) return null;
  return payload as unknown as MailPayload;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/send") {
      return json({ error: "not_found" }, 404);
    }

    const authorization = request.headers.get("authorization") || "";
    if (!secretsEqual(authorization, `Bearer ${env.RELAY_SECRET}`)) {
      return json({ error: "unauthorized" }, 401);
    }

    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > MAX_BODY_BYTES) return json({ error: "payload_too_large" }, 413);

    let rawBody: string;
    try {
      rawBody = await request.text();
    } catch {
      return json({ error: "invalid_request" }, 400);
    }
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
      return json({ error: "payload_too_large" }, 413);
    }

    let payload: MailPayload | null = null;
    try {
      payload = parsePayload(JSON.parse(rawBody));
    } catch {
      // Invalid JSON is handled by the generic validation response below.
    }
    if (!payload) return json({ error: "invalid_request" }, 400);

    try {
      await WorkerMailer.send(
        {
          host: "smtp.yandex.ru",
          port: 465,
          secure: true,
          startTls: false,
          authType: "plain",
          credentials: { username: env.SMTP_USER, password: env.SMTP_PASS },
          logLevel: LogLevel.ERROR,
          socketTimeoutMs: 15_000,
          responseTimeoutMs: 15_000,
        },
        {
          from: { name: "НавигаторПедагога", email: env.SMTP_USER },
          to: payload.to,
          reply: payload.replyTo || env.SMTP_USER,
          subject: payload.subject,
          text: payload.text,
          html: payload.html,
          headers: { "X-Entity-Ref-ID": crypto.randomUUID() },
        },
      );
      return json({ sent: true }, 200);
    } catch (error) {
      console.error("SMTP delivery failed", error instanceof Error ? error.message : "unknown error");
      return json({ error: "delivery_failed" }, 502);
    }
  },
} satisfies ExportedHandler<Env>;
