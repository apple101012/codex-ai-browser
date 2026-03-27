"use strict";
const { app, BrowserWindow, Tray, Menu, nativeImage, shell, dialog } = require("electron");
const path = require("path");
const { pathToFileURL } = require("url");
const { parseProfilesResponse, filterValidProfiles, profileLabel, waitForUrl } = require("./utils.cjs");

const HOST = "127.0.0.1";
const PORT = Number.parseInt(process.env.PORT || "4321", 10);
const APP_URL = `http://${HOST}:${PORT}/app`;

let runningServer = null;
let tray = null;
let mainWindow = null;
let isQuitting = false;
let isCreatingWindow = false;

// ── Single-instance lock ─────────────────────────────────────────────────────
// Must be checked BEFORE app.whenReady() so the losing instance never starts
// the backend.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  // Second instance — quit immediately without doing any work
  app.quit();
} else {
  // ── Only the first instance runs everything below ────────────────────────

  app.on("second-instance", () => {
    if (mainWindow) showWindow();
    else createWindow().catch((err) => console.error("[second-instance] createWindow failed:", err));
  });

  // ── Backend lifecycle ──────────────────────────────────────────────────────
  const startBackend = async () => {
    const userDataDir = path.join(__dirname, "..", "data");
    const publicDir   = path.join(__dirname, "..", "public");

    process.env.HOST            = HOST;
    process.env.PORT            = String(PORT);
    process.env.DATA_DIR        = userDataDir;
    process.env.PUBLIC_DIR      = publicDir;
    process.env.DEFAULT_HEADLESS = process.env.DEFAULT_HEADLESS || "false";

    const modulePath  = pathToFileURL(path.join(__dirname, "..", "dist", "src", "serverApp.js")).href;
    const serverModule = await import(modulePath);
    runningServer = await serverModule.startServer({
      host: HOST,
      port: PORT,
      registerSignalHandlers: false
    });
  };

  const stopBackend = async (timeoutMs = 5000) => {
    if (!runningServer) return;
    const srv = runningServer;
    runningServer = null;
    await Promise.race([
      srv.close(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("stopBackend timed out")), timeoutMs))
    ]).catch((err) => { console.warn("[stopBackend]", err.message); }); // log timeout, best-effort shutdown
  };

  const waitForServer = (timeoutMs = 30000) =>
    waitForUrl(`http://${HOST}:${PORT}/health`, { timeoutMs });

  // ── Window helpers ─────────────────────────────────────────────────────────
  const showWindow = () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.setSkipTaskbar(false);
    mainWindow.show();
    mainWindow.focus();
  };

  const hideWindow = () => {
    if (!mainWindow) return;
    mainWindow.setSkipTaskbar(true); // set before hide() to avoid taskbar flicker
    mainWindow.hide();
  };

  const createWindow = async () => {
    if (isCreatingWindow || isQuitting) return;
    isCreatingWindow = true;
    try {
      mainWindow = new BrowserWindow({
        width:     1300,
        height:    900,
        minWidth:  900,
        minHeight: 600,
        show:      false,   // reveal after content is ready — prevents white flash
        webPreferences: {
          nodeIntegration:  false,
          contextIsolation: true,
          preload: path.join(__dirname, "preload.cjs"),
        }
      });

      // setSkipTaskbar(false) before show() to avoid taskbar flicker
      mainWindow.once("ready-to-show", () => {
        mainWindow.setSkipTaskbar(false);
        mainWindow.show();
      });

      // Sync initial viewport size once content is loaded
      mainWindow.webContents.once("did-finish-load", async () => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        const [width, height] = mainWindow.getContentSize();
        try {
          const stateRes = await fetch(`http://${HOST}:${PORT}/control/state`);
          if (!stateRes.ok) return;
          const state = await stateRes.json();
          const activeId = state.activeProfileId;
          if (!activeId) return;
          await fetch(`http://${HOST}:${PORT}/viewport`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ profileId: activeId, width, height })
          });
        } catch { /* best-effort */ }
      });

      let loadFailed = false;
      await mainWindow.loadURL(APP_URL).catch((err) => {
        console.error("[window] loadURL failed:", err);
        dialog.showErrorBox(
          "AI Browser — Load Failed",
          `Could not load the app at ${APP_URL}.\n\n${String(err?.message ?? err)}`
        );
        loadFailed = true;
      });
      if (loadFailed) {
        mainWindow.destroy();
        mainWindow = null;
        return;
      }

      // Close button → hide to tray instead of quitting
      mainWindow.on("close", (event) => {
        if (!isQuitting) {
          event.preventDefault();
          hideWindow();
          if (process.platform === "win32") tray?.displayBalloon({
            iconType: "info",
            title:    "AI Browser",
            content:  "Still running in the background. Click the tray icon to reopen."
          });
        }
      });

      mainWindow.on("closed", () => { mainWindow = null; });

      // Sync viewport size to active Playwright profile on window resize
      let _resizeTimer = null;
      mainWindow.on("resize", () => {
        clearTimeout(_resizeTimer);
        _resizeTimer = setTimeout(async () => {
          if (!mainWindow || mainWindow.isDestroyed()) return;
          const [width, height] = mainWindow.getContentSize();
          try {
            const stateRes = await fetch(`http://${HOST}:${PORT}/control/state`);
            if (!stateRes.ok) return;
            const state = await stateRes.json();
            const activeId = state.activeProfileId;
            if (!activeId) return;
            await fetch(`http://${HOST}:${PORT}/viewport`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ profileId: activeId, width, height })
            });
          } catch { /* best-effort */ }
        }, 300);
      });
    } finally {
      isCreatingWindow = false;
    }
  };

  // ── Tray ───────────────────────────────────────────────────────────────────

  const fetchProfiles = async () => {
    try {
      const res = await fetch(`http://${HOST}:${PORT}/profiles`);
      if (!res.ok) return [];
      const data = await res.json();
      return parseProfilesResponse(data);
    } catch {
      return [];
    }
  };

  const buildTrayMenu = async () => {
    const profiles = await fetchProfiles();

    const validProfiles = filterValidProfiles(profiles);
    const profileItems = validProfiles.length > 0
      ? validProfiles
          .map((p) => ({
            label: profileLabel(p),
            submenu: [
              {
                label: "Open Dashboard",
                click: () => {
                  if (mainWindow) showWindow();
                  else createWindow().catch((err) => console.error("[tray] createWindow failed:", err));
                }
              },
              {
                label: "Start",
                click: () => fetch(`http://${HOST}:${PORT}/profiles/${encodeURIComponent(p.id)}/start`, { method: "POST" })
                  .then((r) => { if (!r.ok) console.error(`[tray] Start profile failed: ${r.status}`); })
                  .catch((err) => console.error("[tray] Start profile error:", err))
              },
              {
                label: "Stop",
                click: () => fetch(`http://${HOST}:${PORT}/profiles/${encodeURIComponent(p.id)}/stop`, { method: "POST" })
                  .then((r) => { if (!r.ok) console.error(`[tray] Stop profile failed: ${r.status}`); })
                  .catch((err) => console.error("[tray] Stop profile error:", err))
              }
            ]
          }))
      : [{ label: "No profiles found", enabled: false }];

    const openAtLogin = app.getLoginItemSettings().openAtLogin;

    return Menu.buildFromTemplate([
      {
        label: "Open Dashboard",
        click: () => {
          if (mainWindow) showWindow();
          else createWindow().catch((err) => console.error("[tray] createWindow failed:", err));
        }
      },
      { type: "separator" },
      { label: "Profiles", submenu: profileItems },
      { type: "separator" },
      { label: `http://${HOST}:${PORT}/app`, enabled: false },
      { label: "Open in browser", click: () => shell.openExternal(APP_URL) },
      { type: "separator" },
      {
        label:   "Start on login",
        type:    "checkbox",
        checked: openAtLogin,
        click:   (menuItem) => {
          // openAsHidden: true starts the app silently in tray rather than opening a window
          app.setLoginItemSettings({
            openAtLogin: menuItem.checked,
            ...(menuItem.checked && { openAsHidden: true })
          });
        }
      },
      { type: "separator" },
      {
        label: "Quit",
        click: async () => {
          isQuitting = true;
          await stopBackend();
          app.quit();
        }
      }
    ]);
  };

  const createTray = async () => {
    const icoPath = path.join(__dirname, "app-icon.ico");
    const pngPath = path.join(__dirname, "tray-icon-32.png");
    const icoIcon = nativeImage.createFromPath(icoPath);
    const icon    = icoIcon.isEmpty() ? nativeImage.createFromPath(pngPath) : icoIcon;

    if (icon.isEmpty()) {
      console.error("[tray] No valid tray icon found at", icoPath, "or", pngPath);
      dialog.showErrorBox("AI Browser — Icon Missing", "Tray icon files not found. The app will continue without a system tray icon.");
      return;
    }
    tray = new Tray(icon);
    tray.setToolTip("AI Browser — running");

    let isRefreshing = false;
    const refreshMenu = async () => {
      if (isRefreshing) return;
      isRefreshing = true;
      try {
        const menu = await buildTrayMenu();
        if (tray && !tray.isDestroyed()) tray.setContextMenu(menu);
      } finally {
        isRefreshing = false;
      }
    };

    await refreshMenu();

    // Clicking the hide-to-tray balloon notification should restore the window
    tray.on("balloon-click", () => {
      if (mainWindow) showWindow();
      else createWindow().catch((err) => console.error("[tray] createWindow failed:", err));
    });

    // Refresh on interactions so menu reflects current profile/login state
    tray.on("right-click", () => { refreshMenu().catch(() => {}); });

    tray.on("click", () => {
      // Show immediately for responsiveness; refresh menu in background
      if (mainWindow) {
        showWindow();
      } else {
        createWindow().catch((err) => console.error("[tray] createWindow failed:", err));
      }
      refreshMenu().catch(() => {});
    });

    tray.on("double-click", () => {
      if (mainWindow) {
        showWindow();
      } else {
        createWindow().catch((err) => console.error("[tray] createWindow failed:", err));
      }
    });
  };

  // ── App lifecycle ──────────────────────────────────────────────────────────
  app.whenReady().then(async () => {
    if (app.dock) app.dock.hide();

    try {
      await startBackend();
      await waitForServer();
    } catch (err) {
      dialog.showErrorBox(
        "AI Browser — Startup Failed",
        `The backend server failed to start.\n\n${String(err?.message ?? err)}\n\nMake sure you have run "npm run build" and that port ${PORT} is not in use.`
      );
      app.quit();
      return;
    }

    await createTray();
    await createWindow().catch((err) => { console.error("[startup] createWindow failed:", err); });

    app.on("activate", () => {
      if (!mainWindow) {
        createWindow().catch((err) => console.error("[activate] createWindow failed:", err));
      } else {
        showWindow();
      }
    });
  }).catch((err) => {
    console.error("[app] Unhandled startup error:", err);
    app.quit();
  });

  // Stay alive in tray when all windows close
  app.on("window-all-closed", () => {
    // intentional no-op — tray keeps app running
  });

  app.on("before-quit", () => {
    isQuitting = true;
  });

  // Best-effort graceful backend shutdown on any quit path (OS shutdown, task manager, etc.)
  // The tray "Quit" handler awaits stopBackend before calling app.quit(), so runningServer
  // is null by then and this handler is a no-op for that path.
  app.on("will-quit", (event) => {
    if (runningServer) {
      event.preventDefault();
      isQuitting = true;  // prevent close handler from fighting the quit
      stopBackend()
        .catch(() => {})
        .finally(() => { app.quit(); });
    }
  });
}
