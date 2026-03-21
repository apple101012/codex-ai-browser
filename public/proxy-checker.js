import { parseProxyInput } from "/app/proxy-utils.js";

const tokenKey = "codex-ai-browser-api-token";

const headers = () => {
  const token = localStorage.getItem(tokenKey)?.trim();
  return token ? { authorization: `Bearer ${token}` } : {};
};

const request = async (path, init = {}) => {
  const nextHeaders = { ...headers(), ...(init.headers ?? {}) };
  if (init.body && !Object.keys(nextHeaders).some((k) => k.toLowerCase() === "content-type")) {
    nextHeaders["content-type"] = "application/json";
  }
  const res = await fetch(path, { ...init, headers: nextHeaders });
  const text = await res.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { error: text }; }
  if (!res.ok) throw new Error(payload.error ?? JSON.stringify(payload));
  return payload;
};


const maskProxy = (proxyStr) => {
  try {
    const p = parseProxyInput(proxyStr);
    if (!p) return proxyStr;
    const server = p.server ?? proxyStr;
    const hasAuth = Boolean(p.username || p.password);
    return hasAuth ? `${server} • auth` : server;
  } catch {
    // If 4-part colon, show host:port only
    const parts = proxyStr.split(":");
    if (parts.length === 4) return `${parts[0]}:${parts[1]}`;
    return proxyStr.slice(0, 40);
  }
};

const riskClass = (risk) => {
  if (!risk) return "";
  const r = risk.toLowerCase();
  if (r.includes("very high")) return "risk-very-high";
  if (r.includes("high")) return "risk-high";
  if (r.includes("medium")) return "risk-medium";
  return "risk-low";
};

const scoreClass = (score) => {
  if (score === null || score === undefined) return "";
  if (score >= 75) return "score-high";
  if (score >= 40) return "score-medium";
  return "score-low";
};

const CONCURRENCY = 3;

// State
let rows = [];
let isStopped = false;
let profiles = [];

const els = {
  input: document.getElementById("proxyListInput"),
  checkAllBtn: document.getElementById("checkAllBtn"),
  stopBtn: document.getElementById("stopBtn"),
  clearBtn: document.getElementById("clearBtn"),
  exportCsvBtn: document.getElementById("exportCsvBtn"),
  hideFailedToggle: document.getElementById("hideFailedToggle"),
  statusText: document.getElementById("statusText"),
  progressBarWrap: document.getElementById("progressBarWrap"),
  progressBarFill: document.getElementById("progressBarFill"),
  resultsSection: document.getElementById("resultsSection"),
  resultsSummary: document.getElementById("resultsSummary"),
  resultsBody: document.getElementById("resultsBody")
};

const setStatus = (msg, kind = "ok") => {
  els.statusText.textContent = msg;
  els.statusText.className = `status-text ${kind === "err" ? "status-err" : kind === "warn" ? "status-warn" : "status-ok"}`;
  els.statusText.style.margin = "0";
  els.statusText.style.flex = "1";
  els.statusText.style.textAlign = "right";
};

const updateProgress = (done, total) => {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  els.progressBarFill.style.width = `${pct}%`;
};

const updateSummary = () => {
  const total = rows.length;
  const done = rows.filter((r) => r.status !== "pending" && r.status !== "checking").length;
  const reachable = rows.filter((r) => r.reachable === true).length;
  const failed = rows.filter((r) => r.reachable === false).length;
  const listed = rows.filter((r) => r.spamhausListed === true).length;

  els.resultsSummary.innerHTML = `
    <div class="summary-item"><span class="summary-label">Total</span><span class="summary-value">${total}</span></div>
    <div class="summary-item"><span class="summary-label">Checked</span><span class="summary-value">${done}</span></div>
    <div class="summary-item"><span class="summary-label" style="color: var(--success);">Reachable</span><span class="summary-value" style="color: var(--success);">${reachable}</span></div>
    <div class="summary-item"><span class="summary-label" style="color: var(--err);">Failed</span><span class="summary-value" style="color: var(--err);">${failed}</span></div>
    <div class="summary-item"><span class="summary-label" style="color: #f59e0b;">Spamhaus</span><span class="summary-value" style="color: #f59e0b;">${listed}</span></div>
  `;
};

const renderRow = (row, idx) => {
  const tr = document.getElementById(`proxy-row-${idx}`);
  if (!tr) return;

  let statusHtml = `<span class="status-pending">Pending</span>`;
  if (row.status === "checking") statusHtml = `<span class="status-checking">Checking…</span>`;
  else if (row.status === "done") {
    if (row.reachable) statusHtml = `<span class="status-ok-text">✓ Reachable</span>`;
    else statusHtml = `<span class="status-err-text">✗ Failed</span>`;
  } else if (row.status === "error") {
    statusHtml = `<span class="status-err-text">✗ Error</span>`;
  }

  const ipHtml = row.ip ? `<span style="font-family: monospace;">${row.ip}</span>` : `<span class="status-pending">—</span>`;

  const geoHtml = row.geo
    ? `<div>${[row.geo.city, row.geo.region, row.geo.country].filter(Boolean).join(", ") || "—"}</div>`
    : `<span class="status-pending">—</span>`;

  const ispHtml = row.geo
    ? `<div style="color: var(--text-muted);">${row.geo.isp || row.geo.org || "—"}</div>`
    : `<span class="status-pending">—</span>`;

  let scamalyticsHtml = `<span class="status-pending">—</span>`;
  if (row.scamalytics) {
    if (row.scamalytics.error) {
      scamalyticsHtml = `<a href="https://scamalytics.com/ip/${row.ip ?? ''}" target="_blank" style="color: var(--text-muted); font-size: 0.75rem;">Check manually ↗</a>`;
    } else {
      const sc = row.scamalytics;
      const cls = scoreClass(sc.score);
      const label = sc.risk ? sc.risk.charAt(0).toUpperCase() + sc.risk.slice(1) : (sc.score !== null ? `Score ${sc.score}` : "—");
      scamalyticsHtml = sc.url
        ? `<a href="${sc.url}" target="_blank" style="text-decoration: none;"><span class="score-pill ${cls}">${sc.score !== null ? sc.score + " · " : ""}${label}</span></a>`
        : `<span class="score-pill ${cls}">${label}</span>`;
    }
  }

  let spamhausHtml = `<span class="status-pending">—</span>`;
  if (row.spamhaus) {
    if (row.spamhaus.error) {
      spamhausHtml = `<span style="color: var(--text-muted); font-size: 0.75rem;">Unavailable</span>`;
    } else if (row.spamhaus.listed) {
      spamhausHtml = `<span class="spam-listed">Listed (${row.spamhaus.codes.join(", ")})</span>`;
    } else {
      spamhausHtml = `<span class="spam-clean">Clean</span>`;
    }
  }

  const assignSelect = profiles.length > 0 && row.ip
    ? `<select class="assign-btn" id="assign-select-${idx}" title="Assign proxy to profile">
        <option value="">Assign to…</option>
        ${profiles.map((p) => `<option value="${p.id}">${p.name}</option>`).join("")}
       </select>`
    : "";

  const reCheckDisabled = row.status === "checking" ? " disabled" : "";

  tr.innerHTML = `
    <td style="color: var(--text-muted);">${idx + 1}</td>
    <td><span style="font-family: monospace; font-size: 0.8rem;">${maskProxy(row.raw)}</span></td>
    <td>${statusHtml}</td>
    <td>${ipHtml}</td>
    <td>${geoHtml}</td>
    <td>${ispHtml}</td>
    <td>${scamalyticsHtml}</td>
    <td>${spamhausHtml}</td>
    <td style="white-space: nowrap;">
      ${assignSelect}
      <button id="recheck-${idx}" class="assign-btn" title="Re-check this proxy"${reCheckDisabled} style="margin-top: 4px;">
        <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
        Re-check
      </button>
    </td>
  `;

  // Apply hide-failed filter
  if (els.hideFailedToggle?.checked && row.reachable === false) {
    tr.style.display = "none";
  } else {
    tr.style.display = "";
  }

  if (assignSelect) {
    const sel = document.getElementById(`assign-select-${idx}`);
    if (sel) {
      sel.addEventListener("change", async () => {
        const profileId = sel.value;
        if (!profileId) return;
        try {
          await request(`/profiles/${profileId}`, {
            method: "PATCH",
            body: JSON.stringify({ settings: { proxy: parseProxyInput(row.raw) } })
          });
          sel.value = "";
          setStatus(`Proxy assigned to profile.`, "ok");
        } catch (err) {
          setStatus(`Failed to assign: ${err.message}`, "err");
        }
      });
    }
  }

  const reCheckBtn = document.getElementById(`recheck-${idx}`);
  if (reCheckBtn) {
    reCheckBtn.addEventListener("click", async () => {
      reCheckBtn.disabled = true;
      row.ip = null; row.geo = null; row.scamalytics = null; row.spamhaus = null; row.spamhausListed = null;
      await checkProxy(row, idx);
      updateSummary();
    });
  }
};

const checkProxy = async (row, idx) => {
  row.status = "checking";
  renderRow(row, idx);

  try {
    // Step 1: Check reachability + get external IP
    const checkResult = await request("/proxy/check", {
      method: "POST",
      body: JSON.stringify({ proxyInput: row.raw, testUrl: "https://api.ipify.org/?format=json", timeoutMs: 20_000 })
    });

    row.reachable = checkResult.reachable === true;
    row.ip = checkResult.publicIp ?? null;

    if (row.ip && !isStopped) {
      // Step 2: Get reputation data (geo + Scamalytics + Spamhaus)
      const repResult = await request("/proxy/reputation", {
        method: "POST",
        body: JSON.stringify({ ip: row.ip })
      });
      row.geo = repResult.geo?.error ? null : repResult.geo;
      row.scamalytics = repResult.scamalytics;
      row.spamhaus = repResult.spamhaus;
      row.spamhausListed = repResult.spamhaus?.listed === true;
    }

    row.status = "done";
  } catch (err) {
    row.status = "error";
    row.reachable = false;
    row.error = err.message;
  }

  renderRow(row, idx);
};

// Load profiles for the assign dropdown
const loadProfiles = async () => {
  try {
    const payload = await request("/profiles");
    profiles = payload.profiles ?? [];
  } catch {
    profiles = [];
  }
};

els.checkAllBtn.addEventListener("click", async () => {
  const lines = els.input.value.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) {
    setStatus("Paste at least one proxy.", "warn");
    return;
  }

  // Parse and validate all lines first
  rows = [];
  const parseErrors = [];
  for (const line of lines) {
    try {
      parseProxyInput(line);
      rows.push({ raw: line, status: "pending", reachable: null, ip: null, geo: null, scamalytics: null, spamhaus: null, spamhausListed: null });
    } catch (err) {
      parseErrors.push(`"${line.slice(0, 30)}": ${err.message}`);
    }
  }

  if (parseErrors.length > 0 && rows.length === 0) {
    setStatus(`Parse errors: ${parseErrors[0]}`, "err");
    return;
  }

  await loadProfiles();

  // Build table rows
  els.resultsBody.innerHTML = "";
  for (let i = 0; i < rows.length; i++) {
    const tr = document.createElement("tr");
    tr.id = `proxy-row-${i}`;
    tr.innerHTML = `<td colspan="9" style="color: var(--text-muted); padding: 10px 12px;">${i + 1}. ${maskProxy(rows[i].raw)} — pending</td>`;
    els.resultsBody.appendChild(tr);
  }

  els.resultsSection.style.display = "";
  els.progressBarWrap.style.display = "";
  updateProgress(0, rows.length);
  updateSummary();
  isStopped = false;
  els.checkAllBtn.disabled = true;
  els.stopBtn.disabled = false;
  els.exportCsvBtn.disabled = true;

  if (parseErrors.length > 0) {
    setStatus(`Checking ${rows.length} valid proxies (${parseErrors.length} skipped due to parse errors)…`, "warn");
  } else {
    setStatus(`Checking ${rows.length} proxies…`, "warn");
  }

  let done = 0;
  let nextIdx = 0;
  const total = rows.length;

  const worker = async () => {
    while (nextIdx < total && !isStopped) {
      const i = nextIdx++;
      await checkProxy(rows[i], i);
      done++;
      updateProgress(done, total);
      updateSummary();
    }
  };

  // Run up to CONCURRENCY workers in parallel
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, total) }, worker));

  els.checkAllBtn.disabled = false;
  els.stopBtn.disabled = true;
  els.exportCsvBtn.disabled = false;

  const reachable = rows.filter((r) => r.reachable === true).length;
  const total = rows.length;
  setStatus(isStopped ? `Stopped. ${done}/${total} checked, ${reachable} reachable.` : `Done. ${reachable}/${total} proxies reachable.`, isStopped ? "warn" : "ok");
});

els.stopBtn.addEventListener("click", () => {
  isStopped = true;
  els.stopBtn.disabled = true;
  setStatus("Stopping…", "warn");
});

els.clearBtn.addEventListener("click", () => {
  rows = [];
  els.resultsBody.innerHTML = "";
  els.resultsSection.style.display = "none";
  els.progressBarWrap.style.display = "none";
  els.exportCsvBtn.disabled = true;
  setStatus("", "ok");
});

els.hideFailedToggle?.addEventListener("change", () => {
  rows.forEach((_, i) => {
    const tr = document.getElementById(`proxy-row-${i}`);
    if (!tr) return;
    const row = rows[i];
    if (els.hideFailedToggle.checked && row.reachable === false) {
      tr.style.display = "none";
    } else {
      tr.style.display = "";
    }
  });
});

els.exportCsvBtn.addEventListener("click", () => {
  const headers = ["#", "Proxy (masked)", "Reachable", "IP", "Country", "Region", "City", "ISP", "Scamalytics Score", "Scamalytics Risk", "Spamhaus Listed", "Spamhaus Codes"];
  const csvRows = rows.map((r, i) => [
    i + 1,
    maskProxy(r.raw),
    r.reachable === true ? "yes" : r.reachable === false ? "no" : "",
    r.ip ?? "",
    r.geo?.country ?? "",
    r.geo?.region ?? "",
    r.geo?.city ?? "",
    r.geo?.isp ?? r.geo?.org ?? "",
    r.scamalytics?.score ?? "",
    r.scamalytics?.risk ?? "",
    r.spamhaus?.listed === true ? "yes" : r.spamhaus?.listed === false ? "no" : "",
    r.spamhaus?.codes?.join(";") ?? ""
  ].map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","));

  const csv = [headers.join(","), ...csvRows].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `proxy-check-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});
