const els = {
  apiToken: document.getElementById("apiToken"),
  saveTokenBtn: document.getElementById("saveTokenBtn"),
  ensureGeminiBtn: document.getElementById("ensureGeminiBtn"),
  geminiStatus: document.getElementById("geminiStatus"),
  activeState: document.getElementById("activeState"),
  refreshBtn: document.getElementById("refreshBtn"),
  releaseBtn: document.getElementById("releaseBtn"),
  profilesBody: document.getElementById("profilesBody"),
  targetUrl: document.getElementById("targetUrl"),
  goBtn: document.getElementById("goBtn"),
  commandResult: document.getElementById("commandResult")
};

const tokenKey = "codex-ai-browser-api-token";
els.apiToken.value = localStorage.getItem(tokenKey) ?? "";
els.targetUrl.value = "https://gemini.google.com/";

const headers = () => {
  const token = localStorage.getItem(tokenKey)?.trim();
  return token ? { authorization: `Bearer ${token}` } : {};
};

const request = async (path, init = {}) => {
  const response = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...headers(),
      ...(init.headers ?? {})
    }
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error ?? JSON.stringify(payload));
  }
  return payload;
};

const renderProfiles = async () => {
  const [{ profiles, runningProfileIds }, control] = await Promise.all([
    request("/profiles"),
    request("/control/state")
  ]);

  els.activeState.textContent = `Active profile: ${control.activeProfileId ?? "none"} (updated ${control.updatedAt})`;

  els.profilesBody.innerHTML = "";
  for (const profile of profiles) {
    const running = runningProfileIds.includes(profile.id);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${profile.name}</td>
      <td>${profile.id}</td>
      <td>${profile.engine}</td>
      <td>${running ? "Yes" : "No"}</td>
      <td></td>
    `;

    const actions = tr.querySelector("td:last-child");

    const startBtn = document.createElement("button");
    startBtn.textContent = "Start";
    startBtn.onclick = async () => {
      await request(`/profiles/${profile.id}/start`, { method: "POST" });
      await renderProfiles();
    };

    const stopBtn = document.createElement("button");
    stopBtn.textContent = "Stop";
    stopBtn.className = "secondary";
    stopBtn.onclick = async () => {
      await request(`/profiles/${profile.id}/stop`, { method: "POST" });
      await renderProfiles();
    };

    const takeoverBtn = document.createElement("button");
    takeoverBtn.textContent = "Set Active";
    takeoverBtn.onclick = async () => {
      await request("/control/active-profile", {
        method: "POST",
        body: JSON.stringify({ profileId: profile.id, autoStart: true })
      });
      await renderProfiles();
    };

    actions.append(startBtn, stopBtn, takeoverBtn);
  }
};

els.saveTokenBtn.onclick = async () => {
  localStorage.setItem(tokenKey, els.apiToken.value.trim());
  await renderProfiles();
};

els.refreshBtn.onclick = renderProfiles;

els.releaseBtn.onclick = async () => {
  await request("/control/release", { method: "POST" });
  await renderProfiles();
};

els.ensureGeminiBtn.onclick = async () => {
  els.geminiStatus.textContent = "Creating/updating Gemini profile...";
  try {
    const payload = await request("/profiles/ensure/gemini", {
      method: "POST",
      body: JSON.stringify({})
    });
    els.geminiStatus.textContent = `Gemini profile ready: ${payload.profile?.id ?? "unknown"}`;
    await renderProfiles();
  } catch (error) {
    els.geminiStatus.textContent = String(error.message ?? error);
  }
};

els.goBtn.onclick = async () => {
  const url = els.targetUrl.value.trim();
  const payload = await request("/control/active/commands", {
    method: "POST",
    body: JSON.stringify({
      commands: [
        { type: "navigate", url },
        { type: "getPageState", includeTextExcerpt: true }
      ]
    })
  });
  els.commandResult.textContent = JSON.stringify(payload, null, 2);
};

renderProfiles().catch((error) => {
  els.commandResult.textContent = String(error.message ?? error);
});

