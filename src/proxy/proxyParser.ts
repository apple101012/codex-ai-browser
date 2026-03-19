import { ProxyConfigSchema, type ProxyConfig, type ProxyConfigInput } from "./proxyTypes.js";

const DEFAULT_PROXY_SCHEME = "http:";

const trimOrUndefined = (value: string | undefined): string | undefined => {
  const next = value?.trim();
  return next ? next : undefined;
};

const normalizeServerFromUrl = (url: URL): string => {
  if (!url.hostname) {
    throw new Error("Proxy host is missing.");
  }
  if (!url.port) {
    throw new Error("Proxy port is missing.");
  }
  return `${url.protocol}//${url.host}`;
};

const tryParseUrlStyleProxy = (input: string): ProxyConfig | null => {
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `http://${input}`;

  try {
    const url = new URL(candidate);
    if (!url.hostname || !url.port) {
      return null;
    }

    return ProxyConfigSchema.parse({
      server: normalizeServerFromUrl(url),
      username: trimOrUndefined(url.username),
      password: trimOrUndefined(url.password)
    });
  } catch {
    return null;
  }
};

const parseDelimitedProxy = (input: string, delimiter: "," | "|"): ProxyConfig => {
  const parts = input.split(delimiter).map((part) => part.trim()).filter(Boolean);
  if (parts.length < 3) {
    throw new Error(`Proxy input using "${delimiter}" must include host:port, username, and password.`);
  }

  const [hostPort, username, ...passwordParts] = parts;
  if (!hostPort || !username || passwordParts.length === 0) {
    throw new Error(`Proxy input using "${delimiter}" must include host:port, username, and password.`);
  }

  const password = passwordParts.join(delimiter).trim();
  if (!password) {
    throw new Error("Proxy password is missing.");
  }

  const normalized = parseHostPortToken(hostPort);
  return ProxyConfigSchema.parse({
    server: normalized.server,
    username,
    password
  });
};

const parseHostPortToken = (token: string): ProxyConfig => {
  const cleaned = token.trim();
  if (!cleaned) {
    throw new Error("Proxy host and port are required.");
  }

  const urlStyle = tryParseUrlStyleProxy(cleaned);
  if (urlStyle) {
    return urlStyle;
  }

  const segments = cleaned.split(":");
  if (segments.length < 2) {
    throw new Error("Proxy must include host and port.");
  }

  const [host, port, username, ...passwordParts] = segments.map((part) => part.trim());
  if (!host || !port) {
    throw new Error("Proxy host and port are required.");
  }

  const portNumber = Number.parseInt(port, 10);
  if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) {
    throw new Error("Proxy port must be a number between 1 and 65535.");
  }

  const server = `${DEFAULT_PROXY_SCHEME}//${host}:${portNumber}`;
  const parsed = {
    server,
    username: trimOrUndefined(username),
    password: trimOrUndefined(passwordParts.join(":"))
  };

  return ProxyConfigSchema.parse(parsed);
};

export const parseProxyString = (input: string): ProxyConfig => {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Proxy input is required.");
  }

  const urlStyle = tryParseUrlStyleProxy(trimmed);
  if (urlStyle) {
    return urlStyle;
  }

  if (trimmed.includes("|")) {
    return parseDelimitedProxy(trimmed, "|");
  }
  if (trimmed.includes(",")) {
    return parseDelimitedProxy(trimmed, ",");
  }

  return parseHostPortToken(trimmed);
};

export const coerceProxyConfig = (
  input: ProxyConfigInput,
  options: { emptyStringAsUndefined?: boolean } = {}
): ProxyConfig | undefined => {
  if (input === undefined || input === null) {
    return undefined;
  }

  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) {
      if (options.emptyStringAsUndefined) {
        return undefined;
      }
      throw new Error("Proxy input is required.");
    }
    return parseProxyString(trimmed);
  }

  return ProxyConfigSchema.parse(input);
};
