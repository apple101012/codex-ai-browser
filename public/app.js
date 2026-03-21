import { normalizeProxyServer, parseProxyInput } from "/app/proxy-utils.js";

const els = {
  apiToken: document.getElementById("apiToken"),
  saveTokenBtn: document.getElementById("saveTokenBtn"),
  clearTokenBtn: document.getElementById("clearTokenBtn"),
  ensureBrowserBtn: document.getElementById("ensureBrowserBtn"),
  openGeminiBtn: document.getElementById("openGeminiBtn"),
  geminiStatus: document.getElementById("geminiStatus"),
  profileName: document.getElementById("profileName"),
  profileEngine: document.getElementById("profileEngine"),
  profileUserAgent: document.getElementById("profileUserAgent"),
  profileProxy: document.getElementById("profileProxy"),
  profileDataDir: document.getElementById("profileDataDir"),
  profileHeadless: document.getElementById("profileHeadless"),
  checkProxyBtn: document.getElementById("checkProxyBtn"),
  createProfileBtn: document.getElementById("createProfileBtn"),
  profileActionStatus: document.getElementById("profileActionStatus"),
  proxyStatus: document.getElementById("proxyStatus"),
  activeState: document.getElementById("activeState"),
  refreshBtn: document.getElementById("refreshBtn"),
  stopAllBtn: document.getElementById("stopAllBtn"),
  releaseBtn: document.getElementById("releaseBtn"),
  profilesBody: document.getElementById("profilesBody"),
  targetUrl: document.getElementById("targetUrl"),
  goBtn: document.getElementById("goBtn"),
  listTabsBtn: document.getElementById("listTabsBtn"),
  tabIndexInput: document.getElementById("tabIndexInput"),
  setTabBtn: document.getElementById("setTabBtn"),
  readTabBtn: document.getElementById("readTabBtn"),
  commandResult: document.getElementById("commandResult")
};

const tokenKey = "codex-ai-browser-api-token";
els.apiToken.value = localStorage.getItem(tokenKey) ?? "";
els.targetUrl.value = "https://gemini.google.com/";
els.profileName.value = `Browser ID ${Math.floor(Math.random() * 900) + 100}`;
els.profileHeadless.checked = false;
els.profileProxy.value = "";

const headers = () => {
  const token = localStorage.getItem(tokenKey)?.trim();
  return token ? { authorization: `Bearer ${token}` } : {};
};

const setStatus = (element, message, kind = "ok") => {
  element.textContent = message;
  element.classList.remove("status-ok", "status-warn", "status-err");
  element.classList.add(kind === "err" ? "status-err" : kind === "warn" ? "status-warn" : "status-ok");
};

const request = async (path, init = {}) => {
  const nextHeaders = {
    ...headers(),
    ...(init.headers ?? {})
  };
  const hasBody = init.body !== undefined && init.body !== null;
  const hasContentType = Object.keys(nextHeaders).some((key) => key.toLowerCase() === "content-type");
  if (hasBody && !hasContentType) {
    nextHeaders["content-type"] = "application/json";
  }

  const response = await fetch(path, {
    ...init,
    headers: nextHeaders
  });

  const text = await response.text();
  let payload = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { error: text };
    }
  }
  if (!response.ok) {
    throw new Error(payload.error ?? JSON.stringify(payload));
  }
  return payload;
};

const sanitizeForDisplay = (value) => {
  const sensitiveKeys = new Set([
    "password",
    "proxyinput",
    "authorization",
    "token",
    "apitoken",
    "cookie"
  ]);
  const redactSensitiveText = (input) =>
    input
      .replace(
        /([a-z][a-z0-9+.-]*:\/\/)([^:@/\s]+):([^@/\s]+)@/gi,
        "$1[redacted-user]:[redacted-pass]@"
      )
      .replace(/\b([a-z0-9.-]+:\d+):([^:\s]+):([^:\s]+)\b/gi, "$1:[redacted-user]:[redacted-pass]")
      .replace(/(password|passwd|pwd)=([^&\s]+)/gi, "$1=[redacted]")
      .replace(/(username|user)=([^&\s]+)/gi, "$1=[redacted]");

  const visit = (node) => {
    if (Array.isArray(node)) {
      return node.map(visit);
    }
    if (typeof node === "string") {
      return redactSensitiveText(node);
    }
    if (!node || typeof node !== "object") {
      return node;
    }

    const entries = Object.entries(node);
    const next = {};
    for (const [key, child] of entries) {
      const normalized = key.toLowerCase();
      if (normalized === "proxy" && child && typeof child === "object") {
        next[key] = {
          server: child.server,
          hasAuth: Boolean(child.username || child.password || child.hasAuth)
        };
        continue;
      }
      if (sensitiveKeys.has(normalized)) {
        next[key] = "[redacted]";
        continue;
      }
      next[key] = visit(child);
    }
    return next;
  };

  return visit(value);
};

const runAction = async (label, action, statusEl = els.profileActionStatus) => {
  setStatus(statusEl, `${label}...`, "warn");
  try {
    const payload = await action();
    setStatus(statusEl, `${label} complete.`, "ok");
    if (payload !== undefined) {
      els.commandResult.textContent = JSON.stringify(sanitizeForDisplay(payload), null, 2);
    }
    return payload;
  } catch (error) {
    const message = String(error.message ?? error);
    setStatus(statusEl, `${label} failed: ${message}`, "err");
    els.commandResult.textContent = message;
    throw error;
  }
};

const getTargetUrl = () => {
  const url = els.targetUrl.value.trim();
  if (!url) {
    throw new Error("Enter a URL first.");
  }
  return url;
};

const stringToColor = (str) => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 70%, 60%)`;
};


const summarizeProxy = (proxy) => {
  if (!proxy?.server) {
    return "No proxy";
  }

  try {
    const parsed = normalizeProxyServer(proxy.server, "http:");
    const hasAuth = Boolean(proxy.username || proxy.password);
    const authText = hasAuth ? ` • auth` : "";
    return `${parsed.protocol}//${parsed.host}${authText}`;
  } catch {
    return proxy.server;
  }
};

// Auto-refresh state
let autoRefreshInterval = null;
let lastRefreshTime = null;
let isRefreshing = false;
let lastStaleActiveId = null;

const refreshProfiles = async () => {
  // Prevent concurrent refreshes
  if (isRefreshing) {
    return;
  }
  
  isRefreshing = true;
  try {
    const [profilePayload, control] = await Promise.all([request("/profiles"), request("/control/state")]);
    const profiles = profilePayload.profiles ?? [];
    const runningProfileIds = control.runningProfileIds ?? profilePayload.runningProfileIds ?? [];
    const running = new Set(runningProfileIds);
    const activeProfileId = control.activeProfileId;
    const staleActiveProfileId = control.staleActiveProfileId ?? null;
    if (staleActiveProfileId && staleActiveProfileId !== lastStaleActiveId) {
      setStatus(
        els.profileActionStatus,
        "Active profile was released because its browser window is no longer running.",
        "warn"
      );
      lastStaleActiveId = staleActiveProfileId;
    } else if (!staleActiveProfileId) {
      lastStaleActiveId = null;
    }

    const runningStateText = activeProfileId && running.has(activeProfileId) ? "running" : "not running";
    els.activeState.textContent = `Active profile: ${activeProfileId ?? "none"} (${runningStateText}, updated ${control.updatedAt})`;
    els.releaseBtn.disabled = !activeProfileId;
    
    lastRefreshTime = new Date();
    updateRefreshIndicator();

    els.profilesBody.innerHTML = "";
    for (const profile of profiles) {
    const isRunning = running.has(profile.id);
    const isVisible = profile.settings?.headless === false;
    const isActive = profile.id === activeProfileId;
    const proxySummary = summarizeProxy(profile.settings?.proxy);
    const color = stringToColor(profile.id);
    
    const proxyHasValue = Boolean(profile.settings?.proxy?.server);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>
        <div style="display: flex; align-items: flex-start;">
          <span class="profile-color-dot" style="background-color: ${color}; color: ${color}; margin-top: 6px;"></span>
          <div>
            <div style="font-weight: 600; font-size: 0.95rem;">${profile.name}</div>
            <div style="font-size: 0.75rem; color: var(--primary); margin-top: 4px; user-select: all; cursor: pointer; font-family: monospace; word-break: break-all;" title="Double click to select entirely">${profile.id}</div>
            <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 4px; user-select: all; cursor: pointer; font-family: monospace; word-break: break-all;" title="Browser profile directory">${profile.dataDir ?? "No directory recorded"}</div>
          </div>
        </div>
      </td>
      <td>
        <div style="font-weight: 500;">${profile.engine}</div>
        <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 4px;">${isVisible ? "Visible UI" : "Hidden UI"}</div>
        <div id="proxy-display-${profile.id}" style="margin-top: 6px;">
          ${proxyHasValue
            ? `<span style="font-size: 0.75rem; color: var(--primary); font-family: monospace;">&#x1F512; ${proxySummary}</span>`
            : `<span style="font-size: 0.75rem; color: var(--text-muted);">No proxy</span>`}
        </div>
        <div id="proxy-edit-${profile.id}" style="display: none; margin-top: 6px;">
          <input
            id="proxy-input-${profile.id}"
            type="text"
            placeholder="host:port:user:pass"
            style="width: 100%; padding: 5px 8px; font-size: 0.78rem; font-family: monospace; background: var(--bg-dark); border: 1px solid var(--border-highlight); border-radius: 6px; color: var(--text-main);"
          />
          <div style="display: flex; gap: 4px; margin-top: 5px;">
            <button id="proxy-save-${profile.id}" class="btn-success btn-sm" style="font-size: 0.72rem; padding: 3px 10px;">Save</button>
            <button id="proxy-cancel-${profile.id}" class="btn-secondary btn-sm" style="font-size: 0.72rem; padding: 3px 10px;">Cancel</button>
          </div>
        </div>
      </td>
      <td>
        <div style="display: flex; flex-direction: column; gap: 6px; align-items: flex-start;">
          <span class="badge ${isRunning ? 'badge-running' : 'badge-stopped'}">${isRunning ? 'Running' : 'Stopped'}</span>
          <span class="badge ${isActive ? 'badge-active' : 'badge-stopped'}">${isActive ? 'Active' : 'Inactive'}</span>
        </div>
      </td>
      <td>
        <div class="actions-container"></div>
      </td>
    `;

    const actionsContainer = tr.querySelector(".actions-container");

    // Group 1: Start / Stop
    const startBtn = document.createElement("button");
    startBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg> Start`;
    startBtn.className = "btn-success btn-sm";
    startBtn.disabled = isRunning;
    startBtn.onclick = async () => {
      await runAction(
        `Start ${profile.name}`,
        () =>
          request(`/profiles/${profile.id}/start`, {
            method: "POST",
            body: JSON.stringify({ setActive: false })
          }),
        els.profileActionStatus
      );
      await refreshProfiles();
    };

    const stopBtn = document.createElement("button");
    stopBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg> Stop`;
    stopBtn.className = "btn-danger btn-sm";
    stopBtn.disabled = !isRunning;
    stopBtn.onclick = async () => {
      await runAction(
        `Stop ${profile.name}`,
        () =>
          request(`/profiles/${profile.id}/stop`, {
            method: "POST",
            body: JSON.stringify({})
          }),
        els.profileActionStatus
      );
      await refreshProfiles();
    };
    
    const grp1 = document.createElement("div");
    grp1.className = "btn-group";
    grp1.append(startBtn, stopBtn);

    // Group 2: Set Active / Open URL
    const setActiveBtn = document.createElement("button");
    setActiveBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="3"></circle></svg> Set Active`;
    setActiveBtn.className = "btn-primary btn-sm";
    setActiveBtn.disabled = isActive && isRunning;
    setActiveBtn.onclick = async () => {
      await runAction(
        `Set active ${profile.name}`,
        () =>
          request("/control/active-profile", {
            method: "POST",
            body: JSON.stringify({ profileId: profile.id, autoStart: true })
          }),
        els.profileActionStatus
      );
      await refreshProfiles();
    };

    const openUrlBtn = document.createElement("button");
    openUrlBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg> Open URL`;
    openUrlBtn.className = "btn-secondary btn-sm";
    openUrlBtn.onclick = async () => {
      const url = getTargetUrl();
      await runAction(
        `Open URL in ${profile.name}`,
        () =>
          request("/control/open-url", {
            method: "POST",
            body: JSON.stringify({ url, profileId: profile.id, autoSetActive: true, autoStart: true })
          }),
        els.profileActionStatus
      );
      await refreshProfiles();
    };
    
    const grp2 = document.createElement("div");
    grp2.className = "btn-group";
    grp2.append(setActiveBtn, openUrlBtn);

    // Group 3: Show / Hide UI
    const showBtn = document.createElement("button");
    showBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg> Show UI`;
    showBtn.className = "btn-info btn-sm";
    showBtn.disabled = isVisible;
    showBtn.onclick = async () => {
      await runAction(
        `Show browser for ${profile.name}`,
        () =>
          request(`/profiles/${profile.id}/visibility`, {
            method: "POST",
            body: JSON.stringify({ visible: true, autoStart: true })
          }),
        els.profileActionStatus
      );
      await refreshProfiles();
    };

    const hideBtn = document.createElement("button");
    hideBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg> Hide UI`;
    hideBtn.className = "btn-warning btn-sm";
    hideBtn.disabled = !isVisible;
    hideBtn.onclick = async () => {
      await runAction(
        `Hide browser for ${profile.name}`,
        () =>
          request(`/profiles/${profile.id}/visibility`, {
            method: "POST",
            body: JSON.stringify({ visible: false, autoStart: false })
          }),
        els.profileActionStatus
      );
      await refreshProfiles();
    };

    const grp3 = document.createElement("div");
    grp3.className = "btn-group";
    grp3.append(showBtn, hideBtn);

    // Group 4: Proxy (inline edit)
    const proxyBtn = document.createElement("button");
    proxyBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Edit Proxy`;
    proxyBtn.className = "btn-secondary btn-sm";
    proxyBtn.onclick = () => {
      const displayEl = document.getElementById(`proxy-display-${profile.id}`);
      const editEl = document.getElementById(`proxy-edit-${profile.id}`);
      const inputEl = document.getElementById(`proxy-input-${profile.id}`);
      if (!displayEl || !editEl || !inputEl) return;

      displayEl.style.display = "none";
      editEl.style.display = "block";
      inputEl.value = profile.settings?.proxy?.server ?? "";
      inputEl.focus();
      inputEl.select();

      document.getElementById(`proxy-save-${profile.id}`).onclick = async () => {
        const trimmed = inputEl.value.trim();
        if (!trimmed) {
          setStatus(els.profileActionStatus, "Enter a proxy string or use Clear Proxy to remove.", "warn");
          return;
        }
        let proxy;
        try {
          proxy = parseProxyInput(trimmed);
        } catch (error) {
          setStatus(els.profileActionStatus, String(error.message ?? error), "err");
          return;
        }
        await runAction(
          `Update proxy for ${profile.name}`,
          () => request(`/profiles/${profile.id}`, {
            method: "PATCH",
            body: JSON.stringify({ settings: { proxy } })
          }),
          els.profileActionStatus
        );
        await refreshProfiles();
      };

      document.getElementById(`proxy-cancel-${profile.id}`).onclick = () => {
        editEl.style.display = "none";
        displayEl.style.display = "block";
      };
    };

    const clearProxyBtn = document.createElement("button");
    clearProxyBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"></path></svg> Clear Proxy`;
    clearProxyBtn.className = "btn-warning btn-sm";
    clearProxyBtn.disabled = !profile.settings?.proxy;
    clearProxyBtn.onclick = async () => {
      await runAction(
        `Clear proxy for ${profile.name}`,
        () =>
          request(`/profiles/${profile.id}`, {
            method: "PATCH",
            body: JSON.stringify({
              settings: {
                proxy: null
              }
            })
          }),
        els.profileActionStatus
      );
      await refreshProfiles();
    };

    const grp4 = document.createElement("div");
    grp4.className = "btn-group";
    grp4.append(proxyBtn, clearProxyBtn);

    // Group 5: Delete
    const deleteBtn = document.createElement("button");
    deleteBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg> Delete`;
    deleteBtn.title = "Delete";
    deleteBtn.className = "btn-danger btn-sm";
    deleteBtn.onclick = async () => {
      if (!window.confirm(`Delete profile "${profile.name}"?`)) {
        return;
      }
      await runAction(
        `Delete ${profile.name}`,
        () =>
          request(`/profiles/${profile.id}`, {
            method: "DELETE"
          }),
        els.profileActionStatus
      );
      await refreshProfiles();
    };

    actionsContainer.append(grp1, grp2, grp3, grp4, deleteBtn);
    els.profilesBody.append(tr);
  }
  } finally {
    isRefreshing = false;
  }
};

// Update refresh indicator to show auto-refresh status
const updateRefreshIndicator = () => {
  const indicator = document.getElementById("autoRefreshIndicator");
  if (!indicator) return;
  
  if (lastRefreshTime) {
    const now = new Date();
    const secondsAgo = Math.floor((now - lastRefreshTime) / 1000);
    indicator.textContent = secondsAgo === 0 ? "just now" : `${secondsAgo}s ago`;
    indicator.style.opacity = "1";
  }
};

// Start auto-refresh polling
const startAutoRefresh = () => {
  if (autoRefreshInterval) {
    return; // Already running
  }
  
  // Refresh every second so manual browser-window closes show up quickly.
  autoRefreshInterval = setInterval(async () => {
    try {
      await refreshProfiles();
    } catch (error) {
      // Silently fail on auto-refresh errors to avoid spamming the UI
      console.error("Auto-refresh error:", error);
    }
  }, 1000);
  
  // Update the time indicator every second
  setInterval(updateRefreshIndicator, 1000);
  
  console.log("Auto-refresh started: polling every 1 second");
};

// Stop auto-refresh (optional, for future use)
const stopAutoRefresh = () => {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
    autoRefreshInterval = null;
    console.log("Auto-refresh stopped");
  }
};

els.saveTokenBtn.onclick = async () => {
  localStorage.setItem(tokenKey, els.apiToken.value.trim());
  setStatus(els.profileActionStatus, "Token saved locally.", "ok");
  await refreshProfiles();
};

els.clearTokenBtn.onclick = async () => {
  localStorage.removeItem(tokenKey);
  els.apiToken.value = "";
  setStatus(els.profileActionStatus, "Token cleared.", "warn");
  await refreshProfiles();
};

els.ensureBrowserBtn.onclick = async () => {
  await runAction(
    "Ensure browser profile",
    () =>
      request("/profiles/ensure/browser", {
        method: "POST",
        body: JSON.stringify({ forceUpdate: false })
      }),
    els.geminiStatus
  );
  await refreshProfiles();
};

els.openGeminiBtn.onclick = async () => {
  await runAction(
    "Open Gemini",
    () =>
      request("/control/open-gemini", {
        method: "POST",
        body: JSON.stringify({ autoSetActive: true, forceUpdate: true })
      }),
    els.geminiStatus
  );
  await refreshProfiles();
};

els.createProfileBtn.onclick = async () => {
  const name = els.profileName.value.trim();
  const engine = els.profileEngine.value;
  const userAgent = els.profileUserAgent.value.trim();
  const proxyInput = els.profileProxy.value.trim();
  const externalDataDir = els.profileDataDir.value.trim();
  const headless = els.profileHeadless.checked;

  if (!name) {
    setStatus(els.profileActionStatus, "Profile name is required.", "err");
    return;
  }

  let proxy;
  if (proxyInput) {
    try {
      proxy = parseProxyInput(proxyInput);
    } catch (error) {
      setStatus(els.proxyStatus, String(error.message ?? error), "err");
      return;
    }
  }

  await runAction(
    `Create ${name}`,
    () =>
      request("/profiles", {
        method: "POST",
        body: JSON.stringify({
          name,
          engine,
          settings: {
            ...(userAgent ? { userAgent } : {}),
            ...(proxy ? { proxy } : {}),
            headless
          },
          externalDataDir: externalDataDir || undefined
        })
      }),
    els.profileActionStatus
  );
  els.profileName.value = `Browser ID ${Math.floor(Math.random() * 900) + 100}`;
  els.profileUserAgent.value = "";
  els.profileProxy.value = "";
  els.profileDataDir.value = "";
  els.profileHeadless.checked = false;
  await refreshProfiles();
};

els.checkProxyBtn.onclick = async () => {
  const proxyInput = els.profileProxy.value.trim();
  if (!proxyInput) {
    setStatus(els.proxyStatus, "Paste a proxy string first.", "warn");
    return;
  }

  try {
    parseProxyInput(proxyInput);
  } catch (error) {
    setStatus(els.proxyStatus, String(error.message ?? error), "err");
    return;
  }

  const payload = await runAction(
    "Check proxy",
    () =>
      request("/proxy/check", {
        method: "POST",
        body: JSON.stringify({
          proxyInput,
          testUrl: "https://api.ipify.org/?format=json",
          timeoutMs: 15_000
        })
      }),
    els.proxyStatus
  );

  if (payload?.reachable) {
    const publicIp = payload.publicIp ? ` Checker IP: ${payload.publicIp}` : "";
    setStatus(els.proxyStatus, `Proxy looks reachable.${publicIp}`, "ok");
  }
};

els.refreshBtn.onclick = async () => {
  await runAction("Refresh profiles", async () => {
    await refreshProfiles();
    return { refreshed: true };
  });
};

els.stopAllBtn.onclick = async () => {
  await runAction(
    "Stop all profiles",
    () =>
      request("/profiles/stop-all", {
        method: "POST",
        body: JSON.stringify({})
      })
  );
  await refreshProfiles();
};

els.releaseBtn.onclick = async () => {
  if (els.releaseBtn.disabled) {
    setStatus(els.profileActionStatus, "No active profile to release.", "warn");
    return;
  }

  await runAction(
    "Release active profile",
    () =>
      request("/control/release", {
        method: "POST",
        body: JSON.stringify({})
      })
  );
  await refreshProfiles();
};

els.goBtn.onclick = async () => {
  const url = getTargetUrl();
  await runAction("Open URL in active profile", () =>
    request("/control/open-url", {
      method: "POST",
      body: JSON.stringify({ url, autoSetActive: true, autoStart: true })
    })
  );
  await refreshProfiles();
};

els.listTabsBtn.onclick = async () => {
  await runAction("List tabs", () =>
    request("/control/active/commands", {
      method: "POST",
      body: JSON.stringify({
        commands: [{ type: "listTabs" }]
      })
    })
  );
};

els.setTabBtn.onclick = async () => {
  const tabIndex = Number.parseInt(els.tabIndexInput.value, 10);
  if (Number.isNaN(tabIndex) || tabIndex < 0) {
    setStatus(els.profileActionStatus, "Enter a valid non-negative tab index first.", "err");
    return;
  }

  await runAction("Set active tab", () =>
    request("/control/active/commands", {
      method: "POST",
      body: JSON.stringify({
        commands: [{ type: "selectTab", tabIndex }]
      })
    })
  );
};

els.readTabBtn.onclick = async () => {
  const tabIndex = Number.parseInt(els.tabIndexInput.value, 10);
  if (Number.isNaN(tabIndex) || tabIndex < 0) {
    setStatus(els.profileActionStatus, "Enter a valid non-negative tab index first.", "err");
    return;
  }

  await runAction("Read tab text", () =>
    request("/control/active/commands", {
      method: "POST",
      body: JSON.stringify({
        commands: [{ type: "getTabText", tabIndex, maxChars: 6000 }]
      })
    })
  );
};

refreshProfiles().catch((error) => {
  const message = String(error.message ?? error);
  setStatus(els.profileActionStatus, message, "err");
  els.commandResult.textContent = message;
}).finally(() => {
  // Start auto-refresh after initial load
  startAutoRefresh();
});
