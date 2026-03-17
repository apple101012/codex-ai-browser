import { startServer } from "./serverApp.js";

startServer({ registerSignalHandlers: true }).catch((error) => {
  console.error(error);
  process.exit(1);
});

