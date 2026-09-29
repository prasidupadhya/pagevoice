import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export function configuredOrigin(name, env) {
  const value = env[name];
  if (!value || value === "/") return "";
  const url = new URL(value);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    (url.protocol !== "https:" && !loopback) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      `${name} must be an HTTPS origin (or a loopback HTTP origin).`,
    );
  }
  return url.origin;
}

export function browserPolicy(env) {
  const api = configuredOrigin("VITE_API_BASE_URL", env);
  const pocketbase = configuredOrigin("VITE_POCKETBASE_URL", env);
  const connect = [...new Set([api, pocketbase].filter(Boolean))].join(" ");
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data: blob:",
    `connect-src 'self' ${connect}`.trim(),
    "worker-src 'self' blob:",
    `media-src 'self' blob: ${api}`.trim(),
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  return {
    plugins: [
      react(),
      tailwindcss(),
      ...(command === "build"
        ? [
            {
              name: "pagevoice-origin-policy",
              transformIndexHtml() {
                return [
                  {
                    tag: "meta",
                    attrs: {
                      "http-equiv": "Content-Security-Policy",
                      content: browserPolicy(env),
                    },
                    injectTo: "head-prepend",
                  },
                ];
              },
            },
          ]
        : []),
    ],
    server: {
      proxy: {
        "/api": `http://127.0.0.1:${process.env.PAGEVOICE_PORT || "8765"}`,
        "/v1": `http://127.0.0.1:${process.env.PAGEVOICE_PORT || "8765"}`,
      },
    },
    test: { environment: "jsdom", setupFiles: ["./src/test-setup.js"] },
  };
});
