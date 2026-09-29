export function isLoopbackHost(hostname = "") {
  const host = String(hostname)
    .toLowerCase()
    .replace(/^\[|\]$/gu, "");
  return (
    host === "localhost" ||
    host === "::1" ||
    /^127(?:\.\d{1,3}){3}$/u.test(host)
  );
}

export function backendMode({
  apiBase = "",
  hostname = "",
  port = "",
  development = false,
} = {}) {
  if (
    String(apiBase).trim() &&
    (apiBase !== "/" || isLoopbackHost(hostname) || development)
  )
    return "api";
  // A PageVoice server opened directly uses its default local port.
  if (isLoopbackHost(hostname) && String(port) === "8765") return "api";
  if (isLoopbackHost(hostname) || development) return "browser";
  // A public deployment must never silently present memory-only mode as if it
  // were a persistent PageVoice library.
  return "unconfigured";
}
