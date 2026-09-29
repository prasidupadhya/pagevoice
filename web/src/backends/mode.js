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

export function backendMode({ apiBase = "", hostname = "", port = "" } = {}) {
  if (String(apiBase).trim()) return "api";
  // A PageVoice server opened directly uses its default local port.
  if (isLoopbackHost(hostname) && String(port) === "8765") return "api";
  return "browser";
}
