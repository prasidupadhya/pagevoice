// Vercel evaluates this at build time, so the CSP follows the two public origins
// baked into the Vite bundle. Neither service is proxied through Vercel.
function configuredOrigin(name) {
  const value = process.env[name];
  if (!value) return "";
  const url = new URL(value);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    (url.protocol !== "https:" && !loopback) ||
    url.username || url.password || url.pathname !== "/" || url.search || url.hash
  ) {
    throw new Error(`${name} must be an HTTPS origin (or a loopback HTTP origin).`);
  }
  return url.origin;
}

const api = configuredOrigin("VITE_API_BASE_URL");
const pocketbase = configuredOrigin("VITE_POCKETBASE_URL");
const sources = [...new Set([api, pocketbase].filter(Boolean))];
const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data: blob:",
  `connect-src 'self' ${sources.join(" ")}`.trim(),
  "worker-src 'self' blob:",
  `media-src 'self' blob: ${api}`.trim(),
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join("; ");

export const config = {
  framework: "vite",
  installCommand: "npm ci --prefix web",
  buildCommand: "npm --prefix web run build",
  outputDirectory: "web/dist",
  rewrites: [{ source: "/((?!assets/).*)", destination: "/index.html" }],
  headers: [
    {
      source: "/(.*)",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        { key: "Content-Security-Policy", value: csp },
      ],
    },
    {
      source: "/assets/(.*)",
      headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
    },
    {
      source: "/index.html",
      headers: [{ key: "Cache-Control", value: "public, max-age=0, must-revalidate" }],
    },
  ],
};
