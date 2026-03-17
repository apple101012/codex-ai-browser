import { afterEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../src/mcp/apiClient.js";

describe("mcp apiClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.API_BASE_URL;
    delete process.env.API_TOKEN;
  });

  it("sends JSON requests and returns parsed payload", async () => {
    process.env.API_BASE_URL = "http://127.0.0.1:5999";
    process.env.API_TOKEN = "secret-token";

    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
    );
    vi.stubGlobal("fetch", fetchMock);

    const payload = (await apiRequest("/profiles", {
      method: "POST",
      body: JSON.stringify({ hello: "world" })
    })) as { ok: boolean };

    expect(payload.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const call = fetchMock.mock.calls.at(0);
    if (!call) {
      throw new Error("Expected fetch to be called.");
    }
    const [url, init] = call;
    expect(url).toBe("http://127.0.0.1:5999/profiles");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>).authorization).toBe(
      "Bearer secret-token"
    );
    expect((init?.headers as Record<string, string>)["content-type"]).toBe(
      "application/json"
    );
  });

  it("returns text payload when response is not JSON", async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () =>
        new Response("plain text result", {
          status: 200,
          headers: { "content-type": "text/plain" }
        })
    );
    vi.stubGlobal("fetch", fetchMock);

    const payload = (await apiRequest("/plain")) as string;
    expect(payload).toBe("plain text result");
  });

  it("throws informative message for JSON error responses", async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () =>
        new Response(JSON.stringify({ error: "bad request" }), {
          status: 400,
          headers: { "content-type": "application/json" }
        })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiRequest("/bad")).rejects.toThrowError(
      'API request failed (400): {"error":"bad request"}'
    );
  });

  it("throws raw message for text error responses", async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () =>
        new Response("forbidden", {
          status: 403,
          headers: { "content-type": "text/plain" }
        })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiRequest("/forbidden")).rejects.toThrowError("forbidden");
  });
});
