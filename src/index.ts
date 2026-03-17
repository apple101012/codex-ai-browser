import { startServer } from "./serverApp.js";
import { pathToFileURL } from "node:url";

export const runCli = async (): Promise<void> => {
  await startServer({ registerSignalHandlers: true });
};

const isMain = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isMain) {
  runCli().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
