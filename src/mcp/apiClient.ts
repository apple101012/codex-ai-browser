const getApiBaseUrl = (): string => process.env.API_BASE_URL ?? "http://127.0.0.1:4321";
const getApiToken = (): string | undefined => process.env.API_TOKEN;

const buildHeaders = (hasBody: boolean): HeadersInit => {
  const headers: HeadersInit = {};
  if (hasBody) {
    headers["content-type"] = "application/json";
  }

  const apiToken = getApiToken();
  if (apiToken) {
    headers.authorization = `Bearer ${apiToken}`;
  }

  return headers;
};

export const apiRequest = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const hasBody = init?.body !== undefined && init?.body !== null;
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    ...init,
    headers: {
      ...buildHeaders(hasBody),
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
