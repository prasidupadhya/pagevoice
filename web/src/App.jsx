import React, { lazy, Suspense } from "react";
import { backendMode } from "./backends/mode";

const ApiApp = lazy(() => import("./ApiApp"));
const BrowserApp = lazy(() => import("./BrowserApp"));
const BackendRequired = lazy(() => import("./BackendRequired"));

export default function App() {
  const mode = backendMode({
    apiBase: import.meta.env.VITE_API_BASE_URL || "",
    hostname: window.location.hostname,
    port: window.location.port,
    development: import.meta.env.DEV,
  });
  return (
    <Suspense fallback={<div className="reader-loading" role="status" />}>
      {mode === "api" ? (
        <ApiApp />
      ) : mode === "browser" ? (
        <BrowserApp />
      ) : (
        <BackendRequired />
      )}
    </Suspense>
  );
}
