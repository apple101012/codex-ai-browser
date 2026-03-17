const { app, BrowserWindow } = require("electron");
const path = require("path");
const { pathToFileURL } = require("url");

const HOST = "127.0.0.1";
const PORT = Number.parseInt(process.env.PORT || "4321", 10);
const APP_URL = `http://${HOST}:${PORT}/app`;

let runningServer = null;

const startBackend = async () => {
  const userDataDir = path.join(app.getPath("userData"), "data");
  const publicDir = path.join(__dirname, "..", "public");

  process.env.HOST = HOST;
  process.env.PORT = String(PORT);
  process.env.DATA_DIR = userDataDir;
  process.env.PUBLIC_DIR = publicDir;
  process.env.DEFAULT_HEADLESS = process.env.DEFAULT_HEADLESS || "false";

  const modulePath = pathToFileURL(path.join(__dirname, "..", "dist", "src", "serverApp.js")).href;
  const serverModule = await import(modulePath);
  runningServer = await serverModule.startServer({
    host: HOST,
    port: PORT,
    registerSignalHandlers: false
  });
};

const stopBackend = async () => {
  if (!runningServer) {
    return;
  }
  await runningServer.close();
  runningServer = null;
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
  await startBackend();
  await waitForServer();
  await createWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

app.on("window-all-closed", async () => {
  await stopBackend();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("quit", async () => {
  await stopBackend();
});

