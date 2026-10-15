// Narration proxy for PageVoice. The ElevenLabs key is read from a server-only
// environment variable and is never sent to the browser. CommonJS so Vercel
// functions and the Vite development server can both load it.
"use strict";

const UPSTREAM = "https://api.elevenlabs.io";
const MODEL = process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2";
const FORMAT = "mp3_44100_128";
const MAX_TEXT = 1000;
const VOICE_TTL_MS = 60 * 60 * 1000;
const RATE_WINDOW_MS = 60 * 1000;
const RATE_LIMIT = 60;
const DEFAULT_ORIGINS = [
  "https://pagevoice.tech",
  "https://www.pagevoice.tech",
  "http://127.0.0.1:4173",
  "http://localhost:4173",
  "http://127.0.0.1:5173",
  "http://localhost:5173",
];

let voiceCache = { at: 0, voices: [] };
const windows = new Map();

const allowedOrigins = () =>
  (process.env.PAGEVOICE_ALLOWED_ORIGINS || DEFAULT_ORIGINS.join(","))
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

// Best-effort limit per server instance. Set a Vercel Firewall rate limit for
// the real protection; instances do not share this counter.
function overLimit(ip) {
  const now = Date.now();
  const entry = windows.get(ip);
  if (!entry || now - entry.start > RATE_WINDOW_MS) {
    windows.set(ip, { start: now, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT;
}

function send(res, status, body, type = "application/json") {
  res.statusCode = status;
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (type === "application/json") {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(body));
  } else {
    res.setHeader("Content-Type", type);
    res.end(body);
  }
}

async function readBody(req) {
  if (req.body !== undefined) {
    return typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16 * 1024) throw Object.assign(Error("tooLarge"), { status: 413 });
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function apiKey(env) {
  const key = (env.ELEVENLABS_API_KEY || "").trim();
  return key || null;
}

async function loadVoices(fetchImpl, env) {
  if (Date.now() - voiceCache.at < VOICE_TTL_MS && voiceCache.voices.length)
    return voiceCache.voices;
  const key = apiKey(env);
  if (!key) throw Object.assign(Error("ttsNotConfigured"), { status: 503 });
  const response = await fetchImpl(`${UPSTREAM}/v1/voices`, {
    headers: { "xi-api-key": key },
  });
  if (!response.ok)
    throw Object.assign(Error("ttsUnavailable"), { status: 502 });
  const data = await response.json();
  const voices = (data.voices || []).slice(0, 40).map((v) => ({
    id: v.voice_id,
    name: v.name,
    locale: v.labels?.accent || v.labels?.language || "",
  }));
  voiceCache = { at: Date.now(), voices };
  return voices;
}

async function handleVoices(req, res, { fetch = globalThis.fetch, env = process.env } = {}) {
  if (req.method !== "GET") return send(res, 405, { error: "methodNotAllowed" });
  try {
    return send(res, 200, { voices: await loadVoices(fetch, env) });
  } catch (error) {
    return send(res, error.status || 502, { error: error.message });
  }
}

async function handleTts(req, res, { fetch = globalThis.fetch, env = process.env } = {}) {
  if (req.method !== "POST") return send(res, 405, { error: "methodNotAllowed" });
  const origin = req.headers.origin;
  if (!origin || !allowedOrigins().includes(origin))
    return send(res, 403, { error: "forbidden" });
  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").split(",")[0].trim();
  if (overLimit(ip)) return send(res, 429, { error: "ttsRateLimited" });
  let body;
  try {
    body = await readBody(req);
  } catch (error) {
    return send(res, error.status || 400, { error: error.status === 413 ? "textTooLong" : "badRequest" });
  }
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return send(res, 400, { error: "noReadableText" });
  if (text.length > MAX_TEXT) return send(res, 413, { error: "textTooLong" });
  const voice = typeof body.voice === "string" ? body.voice : "";
  if (!/^[A-Za-z0-9]{10,40}$/u.test(voice)) return send(res, 400, { error: "voiceUnknown" });
  let voices;
  try {
    voices = await loadVoices(fetch, env);
  } catch (error) {
    return send(res, error.status || 502, { error: error.message });
  }
  if (!voices.some((v) => v.id === voice)) return send(res, 400, { error: "voiceUnknown" });
  const upstream = await fetch(
    `${UPSTREAM}/v1/text-to-speech/${voice}?output_format=${FORMAT}`,
    {
      method: "POST",
      headers: { "xi-api-key": apiKey(env), "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({ text, model_id: MODEL }),
    },
  );
  if (!upstream.ok) {
    if (upstream.status === 429) return send(res, 429, { error: "ttsRateLimited" });
    if (upstream.status === 401 || upstream.status === 403) return send(res, 503, { error: "ttsNotConfigured" });
    if (upstream.status === 422 || upstream.status === 400) return send(res, 400, { error: "ttsRejectedText" });
    return send(res, 502, { error: "ttsFailed" });
  }
  const audio = Buffer.from(await upstream.arrayBuffer());
  return send(res, 200, audio, "audio/mpeg");
}

module.exports = { handleTts, handleVoices, MAX_TEXT };
