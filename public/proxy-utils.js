// Shared proxy parsing utilities used by app.js and proxy-checker.js

export const normalizeProxyServer = (value, defaultScheme = "http:") => {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("Proxy server is required.");
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `${defaultScheme}//${trimmed}`;
  const parsed = new URL(withScheme);
  if (!parsed.hostname || !parsed.port) throw new Error("Proxy must include a host and port.");
  return parsed;
};

export const parseProxyInput = (input) => {
  const raw = input.trim();
  if (!raw) return null;
  const cleaned = raw.replace(/^proxy\s*=\s*/i, "").trim();
  if (!cleaned) return null;

  const parseFromUrl = (value) => {
    const parsed = normalizeProxyServer(value);
    return {
      server: `${parsed.protocol}//${parsed.host}`,
      ...(parsed.username ? { username: decodeURIComponent(parsed.username) } : {}),
      ...(parsed.password ? { password: decodeURIComponent(parsed.password) } : {})
    };
  };

  if (cleaned.includes("://")) return parseFromUrl(cleaned);
  if (cleaned.includes("@")) return parseFromUrl(`http://${cleaned}`);

  const pipeParts = cleaned.split("|").map((p) => p.trim()).filter(Boolean);
  const commaParts = cleaned.split(",").map((p) => p.trim()).filter(Boolean);
  const authParts = pipeParts.length > 1 ? pipeParts : commaParts.length > 1 ? commaParts : null;
  if (authParts) {
    if (authParts.length === 3) {
      const [server, username, password] = authParts;
      return { ...parseFromUrl(server), username, password };
    }
    if (authParts.length === 4) {
      const [host, port, username, password] = authParts;
      return { server: `http://${host}:${port}`, username, password };
    }
  }

  const colonParts = cleaned.split(":").map((p) => p.trim()).filter(Boolean);
  if (colonParts.length === 2) return { server: `http://${colonParts[0]}:${colonParts[1]}` };
  if (colonParts.length === 4) {
    const [host, port, username, password] = colonParts;
    return { server: `http://${host}:${port}`, username, password };
  }

  throw new Error(
    "Unsupported proxy format. Use host:port, host:port:username:password, user:pass@host:port, or scheme://host:port."
  );
};
