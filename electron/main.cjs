const { app, BrowserWindow } = require("electron");
const { spawn } = require("child_process");
const path = require("path");

const HOST = "127.0.0.1";
const PORT = process.env.PORT || "4321";
const APP_URL = `http://${HOST}:${PORT}/app`;

let backendProcess = null;

const startBackend = () => {
  const backendEntry = path.join(__dirname, "..", "dist", "src", "index.js");
  backendProcess = spawn(process.execPath, [backendEntry], {
    env: {
      ...process.env,
      HOST,
      PORT,
      DEFAULT_HEADLESS: process.env.DEFAULT_HEADLESS || "false"
    },
    stdio: "inherit"
  });

  backendProcess.on("exit", (code) => {
    if (code !== 0) {
      console.error(`Backend exited with code ${code}`);
    }
  });
};

const stopBackend = () => {
  if (backendProcess && !backendProcess.killed) {
    backendProcess.kill();
  }
  backendProcess = null;
};

const waitForServer = async (timeoutMs = 30000) => {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`http://${HOST}:${PORT}/health`);
      if (response.ok) {
        return;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error("Timed out waiting for backend server.");
};

const createWindow = async () => {
  const window = new BrowserWindow({
    width: 1300,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  await window.loadURL(APP_URL);
};

app.whenReady().then(async () => {
  startBackend();
  await waitForServer();
  await createWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  stopBackend();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("quit", () => {
  stopBackend();
});

