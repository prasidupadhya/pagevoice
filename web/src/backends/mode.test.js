import { describe, expect, it } from "vitest";
import { backendMode, isLoopbackHost } from "./mode";

describe("backend selection", () => {
  it("uses API mode only when explicitly configured or served directly by the local API", () => {
    expect(
      backendMode({
        apiBase: "https://reader.example/api",
        hostname: "pagevoice.app",
      }),
    ).toBe("api");
    expect(backendMode({ hostname: "127.0.0.1", port: "8765" })).toBe("api");
    expect(backendMode({ hostname: "localhost", port: "5173" })).toBe(
      "browser",
    );
    expect(backendMode({ hostname: "localhost" })).toBe("browser");
    expect(backendMode({ hostname: "pagevoice.app", apiBase: "/" })).toBe(
      "unconfigured",
    );
    expect(
      backendMode({ hostname: "pagevoice-sepia.vercel.app", port: "443" }),
    ).toBe("unconfigured");
    expect(
      backendMode({
        hostname: "pagevoice-sepia.vercel.app",
        port: "443",
        apiBase: "https://api.pagevoice.example",
      }),
    ).toBe("api");
    expect(backendMode({ hostname: "192.168.1.8", development: true })).toBe(
      "browser",
    );
    expect(isLoopbackHost("[::1]")).toBe(true);
  });
});
