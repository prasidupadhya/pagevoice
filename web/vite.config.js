import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
export const browserPolicy = () =>
  [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval' blob:",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data: blob:",
    "connect-src 'self' blob: https://huggingface.co https://cdn-lfs.huggingface.co https://cdn-lfs-us-1.hf.co https://cdn-lfs-eu-1.hf.co https://cas-bridge.xethub.hf.co https://us.aws.cdn.hf.co https://eu.aws.cdn.hf.co https://cdn.jsdelivr.net",
    "worker-src 'self' blob:",
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    {
      name: "local-runtime-modules",
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          if (req.url.startsWith("/runtime/")) req.url = req.url.split("?")[0];
          next();
        });
      },
    },
    VitePWA({
      registerType: "prompt",
      injectRegister: false,
      includeAssets: ["favicon.svg", "icon-192.png", "icon-512.png"],
      manifest: {
        name: "PageVoice · A private reading room",
        short_name: "PageVoice",
        description:
          "Read and narrate English and Spanish books on your device.",
        theme_color: "#eee5d4",
        background_color: "#eee5d4",
        display: "standalone",
        start_url: "/",
        scope: "/",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          {
            src: "/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,mjs,css,html,svg,woff2,json,png,webmanifest,txt}"],
        globIgnores: ["runtime/**"],
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
        navigateFallback: "index.html",
        navigateFallbackDenylist: [/^\/runtime\//, /^\/language-data\//],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: ({ url }) =>
              url.origin === self.location.origin &&
              (/^\/runtime\//u.test(url.pathname) ||
                /^\/language-data\//u.test(url.pathname)),
            handler: "CacheFirst",
            options: { cacheName: "pagevoice-models-v1" },
          },
        ],
      },
    }),
    ...(command === "build"
      ? [
          {
            name: "offline-csp",
            transformIndexHtml: () => [
              {
                tag: "meta",
                attrs: {
                  "http-equiv": "Content-Security-Policy",
                  content: browserPolicy(),
                },
                injectTo: "head-prepend",
              },
            ],
          },
        ]
      : []),
  ],
  worker: { format: "es" },
  build: { chunkSizeWarningLimit: 1500 },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.js"],
    exclude: ["e2e/**", "node_modules/**"],
  },
}));
