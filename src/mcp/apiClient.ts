const API_BASE_URL = process.env.API_BASE_URL ?? "http://127.0.0.1:4321";
const API_TOKEN = process.env.API_TOKEN;

const buildHeaders = (): HeadersInit => {
  const headers: HeadersInit = {
    "content-type": "application/json"
  };

  if (API_TOKEN) {
    headers.authorization = `Bearer ${API_TOKEN}`;
  }

  return headers;
};

export const apiRequest = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      ...buildHeaders(),
      ...(init?.headers ?? {})
    }
  });

  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json")
    ? ((await response.json()) as unknown)
    : await response.text();

  if (!response.ok) {
    throw new Error(
      typeof payload === "string"
        ? payload
        : `API request failed (${response.status}): ${JSON.stringify(payload)}`
    );
  }

  return payload as T;
};

