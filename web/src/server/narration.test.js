import { beforeEach, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { Readable } from "node:stream";

const require = createRequire(import.meta.url);
const path = require.resolve("../../server/narration.cjs");
const load = () => {
  delete require.cache[path];
  return require(path);
};
const VOICE = "abcdefghij1234567890";
const ORIGIN = "https://pagevoice.tech";
const env = { ELEVENLABS_API_KEY: "test-key" };

function call(method, body, headers = {}) {
  const req = Readable.from(
    body === undefined ? [] : [Buffer.from(JSON.stringify(body))],
  );
  Object.assign(req, {
    method,
    headers: { origin: ORIGIN, ...headers },
    socket: { remoteAddress: "10.0.0.1" },
  });
  const res = {
    statusCode: 0,
    headers: {},
    body: undefined,
    setHeader(k, v) {
      this.headers[k.toLowerCase()] = v;
    },
    end(chunk) {
      this.body = chunk;
      this.done = true;
    },
  };
  return { req, res };
}

function upstream(overrides = {}) {
  return vi.fn(async (url, init) => {
    if (overrides[url]) return overrides[url](init);
    if (url.endsWith("/v2/voices"))
      return new Response(
        JSON.stringify({
          voices: [
            { voice_id: VOICE, name: "Rachel", labels: { accent: "american" } },
          ],
        }),
        { status: 200 },
      );
    return new Response(new Uint8Array([1, 2, 3, 4]), {
      status: 200,
      headers: { "content-type": "audio/mpeg" },
    });
  });
}

beforeEach(() => {
  delete require.cache[path];
});

it("lists voices from the upstream with the key kept on the server", async () => {
  const { handleVoices } = load();
  const fetch = upstream();
  const { req, res } = call("GET");
  await handleVoices(req, res, { fetch, env });
  expect(res.statusCode).toBe(200);
  expect(JSON.parse(res.body).voices).toEqual([
    { id: VOICE, name: "Rachel", locale: "american" },
  ]);
  expect(fetch.mock.calls[0][1].headers["xi-api-key"]).toBe("test-key");
});

it("reports a missing key without calling the upstream", async () => {
  const { handleVoices } = load();
  const fetch = upstream();
  const { req, res } = call("GET");
  await handleVoices(req, res, { fetch, env: {} });
  expect(res.statusCode).toBe(503);
  expect(JSON.parse(res.body).error).toBe("ttsNotConfigured");
  expect(fetch).not.toHaveBeenCalled();
});

it("synthesizes an allowed voice and returns MP3 bytes", async () => {
  const { handleTts } = load();
  const fetch = upstream();
  const { req, res } = call("POST", { text: "Hello there.", voice: VOICE });
  await handleTts(req, res, { fetch, env });
  expect(res.statusCode).toBe(200);
  expect(res.headers["content-type"]).toBe("audio/mpeg");
  expect(res.headers["cache-control"]).toBe("no-store");
  expect([...res.body]).toEqual([1, 2, 3, 4]);
  const [url, init] = fetch.mock.calls.at(-1);
  expect(url).toContain(
    `/v1/text-to-speech/${VOICE}?output_format=mp3_44100_128`,
  );
  expect(JSON.parse(init.body).text).toBe("Hello there.");
  expect(init.headers["xi-api-key"]).toBe("test-key");
});

it("refuses other origins, unknown voices, empty and oversized text", async () => {
  const { handleTts, MAX_TEXT } = load();
  const fetch = upstream();
  let r = call(
    "POST",
    { text: "Hi", voice: VOICE },
    { origin: "https://evil.example" },
  );
  await handleTts(r.req, r.res, { fetch, env });
  expect(r.res.statusCode).toBe(403);
  r = call("POST", { text: "Hi", voice: "not-a-real-voice-id!" });
  await handleTts(r.req, r.res, { fetch, env });
  expect(r.res.statusCode).toBe(400);
  r = call("POST", { text: "   ", voice: VOICE });
  await handleTts(r.req, r.res, { fetch, env });
  expect(r.res.statusCode).toBe(400);
  r = call("POST", { text: "x".repeat(MAX_TEXT + 1), voice: VOICE });
  await handleTts(r.req, r.res, { fetch, env });
  expect(r.res.statusCode).toBe(413);
  expect(
    fetch.mock.calls.filter(([u]) => u.includes("text-to-speech")),
  ).toHaveLength(0);
});

it("maps upstream rate limits and rejected text to plain errors", async () => {
  const { handleTts } = load();
  const fetch = upstream({
    [`https://api.elevenlabs.io/v1/text-to-speech/${VOICE}?output_format=mp3_44100_128`]:
      async () => new Response("{}", { status: 429 }),
  });
  const { req, res } = call("POST", { text: "Hi", voice: VOICE });
  await handleTts(req, res, { fetch, env });
  expect(res.statusCode).toBe(429);
  expect(JSON.parse(res.body).error).toBe("ttsRateLimited");
});

it("rejects non-POST requests on synthesis", async () => {
  const { handleTts } = load();
  const { req, res } = call("GET");
  await handleTts(req, res, { fetch: upstream(), env });
  expect(res.statusCode).toBe(405);
});

it("explains a rejected key without exposing the upstream response", async () => {
  const { handleVoices } = load();
  const fetch = upstream({
    "https://api.elevenlabs.io/v2/voices": async () =>
      new Response("{}", { status: 401 }),
  });
  const { req, res } = call("GET");
  await handleVoices(req, res, { fetch, env });
  expect(res.statusCode).toBe(503);
  expect(JSON.parse(res.body).error).toBe("ttsKeyRejected");
});

it("reports a restricted key (403) differently from a rejected key (401)", async () => {
  const { handleVoices, handleTts } = load();
  const restricted = upstream({
    "https://api.elevenlabs.io/v2/voices": async () =>
      new Response('{"detail":{"status":"forbidden"}}', { status: 403 }),
  });
  let r = call("GET");
  await handleVoices(r.req, r.res, { fetch: restricted, env });
  expect(r.res.statusCode).toBe(503);
  expect(JSON.parse(r.res.body).error).toBe("ttsKeyRestricted");

  const speech = `https://api.elevenlabs.io/v1/text-to-speech/${VOICE}?output_format=mp3_44100_128`;
  const denied = upstream({ [speech]: async () => new Response("{}", { status: 403 }) });
  r = call("POST", { text: "Hi", voice: VOICE });
  await handleTts(r.req, r.res, { fetch: denied, env });
  expect(JSON.parse(r.res.body).error).toBe("ttsKeyRestricted");
});

it("logs the upstream reason on the server without sending it to the browser", async () => {
  const { handleVoices } = load();
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const fetch = upstream({
    "https://api.elevenlabs.io/v2/voices": async () =>
      new Response('{"detail":{"status":"missing_permissions"}}', { status: 401 }),
  });
  const { req, res } = call("GET");
  await handleVoices(req, res, { fetch, env });
  expect(errors.mock.calls.flat().join(" ")).toContain("missing_permissions");
  expect(res.body).not.toContain("missing_permissions");
  errors.mockRestore();
});

it("uses a configured voice without listing voices", async () => {
  const { handleVoices } = load();
  const fetch = upstream();
  const { req, res } = call("GET");
  await handleVoices(req, res, {
    fetch,
    env: {
      ...env,
      ELEVENLABS_VOICE_ID: VOICE,
      ELEVENLABS_VOICE_NAME: "Narrator",
    },
  });
  expect(JSON.parse(res.body).voices).toEqual([
    { id: VOICE, name: "Narrator", locale: "" },
  ]);
  expect(fetch).not.toHaveBeenCalled();
});

it("serves several configured voices with their languages", async () => {
  const { handleVoices } = load();
  const fetch = upstream();
  const SPANISH = "zyxwvutsrq0987654321";
  const { req, res } = call("GET");
  await handleVoices(req, res, {
    fetch,
    env: {
      ...env,
      ELEVENLABS_VOICE_IDS: `${VOICE}:Rachel:en, ${SPANISH}:Sofia Mendez:es, not-valid!:Bad:en`,
    },
  });
  expect(res.statusCode).toBe(200);
  expect(JSON.parse(res.body).voices).toEqual([
    { id: VOICE, name: "Rachel", locale: "en" },
    { id: SPANISH, name: "Sofia Mendez", locale: "es" },
  ]);
  expect(fetch).not.toHaveBeenCalled();
});

it("accepts a bare voice id in the configured list", async () => {
  const { handleVoices } = load();
  const { req, res } = call("GET");
  await handleVoices(req, res, {
    fetch: upstream(),
    env: { ...env, ELEVENLABS_VOICE_IDS: VOICE },
  });
  expect(JSON.parse(res.body).voices).toEqual([
    { id: VOICE, name: VOICE, locale: "" },
  ]);
});

it("synthesizes with a voice from the configured list", async () => {
  const { handleTts } = load();
  const fetch = upstream();
  const { req, res } = call("POST", { text: "Hola.", voice: VOICE });
  await handleTts(req, res, {
    fetch,
    env: { ...env, ELEVENLABS_VOICE_IDS: `${VOICE}:Rachel:en` },
  });
  expect(res.statusCode).toBe(200);
  expect(fetch.mock.calls.at(-1)[0]).toContain(`/v1/text-to-speech/${VOICE}`);
  expect(fetch.mock.calls.some(([u]) => u.endsWith("/v2/voices"))).toBe(false);
});

it("reports a network failure on the speech request as unavailable", async () => {
  const { handleTts } = load();
  const fetch = upstream({
    [`https://api.elevenlabs.io/v1/text-to-speech/${VOICE}?output_format=mp3_44100_128`]:
      async () => {
        throw new TypeError("fetch failed");
      },
  });
  const { req, res } = call("POST", { text: "Hi", voice: VOICE });
  await handleTts(req, res, { fetch, env });
  expect(res.statusCode).toBe(502);
  expect(JSON.parse(res.body).error).toBe("ttsUnavailable");
});
