import { setTimeout as delay } from "node:timers/promises";

interface CommandResult {
  type: string;
  ok: boolean;
  data?: unknown;
  error?: string;
}

interface RunCommandsResponse {
  profileId: string;
  total: number;
  successCount: number;
  results: CommandResult[];
}

interface ProfileCommandContext {
  apiBaseUrl: string;
  profileId: string;
}

const parseArgs = (): Record<string, string> => {
  const args = process.argv.slice(2);
  const out: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (!token || !token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const value = args[i + 1];
    if (!value || value.startsWith("--")) {
      out[key] = "true";
      continue;
    }
    out[key] = value;
    i += 1;
  }
  return out;
};

const args = parseArgs();
const apiBaseUrl = args["api-url"] ?? "http://127.0.0.1:4321";
const waitMs = Number.parseInt(args["wait-ms"] ?? "45000", 10);
const prompt1 =
  args.prompt1 ??
  "Create one logo image for StudioLuxe: premium AI voice production brand, dark mode aesthetic, black background, electric violet glow accents, minimalist icon + wordmark, clean geometric design.";
const prompt2 =
  args.prompt2 ??
  "Create an alternate StudioLuxe logo image: abstract waveform monogram symbol, monochrome black-and-white with subtle violet edge light, minimal tech luxury style.";
const prompt3 =
  args.prompt3 ??
  "Generate one cinematic image of a coal rail car in heavy rain at dusk, dramatic moody lighting, realistic texture, wet metal reflections, atmospheric fog.";

const requestJson = async <T>(base: string, path: string, init: RequestInit = {}): Promise<T> => {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers ?? {})
    }
  });
  const raw = await response.text();
  const data = raw ? (JSON.parse(raw) as unknown) : {};
  if (!response.ok) {
    throw new Error(`${path} failed (${response.status}): ${raw}`);
  }
  return data as T;
};

const runCommands = async (
  context: ProfileCommandContext,
  commands: Array<Record<string, unknown>>
): Promise<RunCommandsResponse> => {
  return await requestJson<RunCommandsResponse>(context.apiBaseUrl, `/profiles/${context.profileId}/commands`, {
    method: "POST",
    body: JSON.stringify({
      autoStart: true,
      commands
    })
  });
};

const pickResultData = <T>(payload: RunCommandsResponse, type: string): T | undefined => {
  return payload.results.find((result) => result.type === type)?.data as T | undefined;
};

const isLikelyGeneratedResponse = (excerpt: string): boolean => {
  const normalized = excerpt.toLowerCase();
  if (normalized.includes("gemini said")) {
    return true;
  }
  if (normalized.includes("here are")) {
    return true;
  }
  return normalized.includes("defining");
};

const submitPromptAndCapture = async (
  context: ProfileCommandContext,
  tabIndex: number,
  label: string,
  prompt: string,
  outputPrefix: string
) => {
  const inputSelector = ".ql-editor[aria-label='Enter a prompt for Gemini']";

  await runCommands(context, [
    { type: "selectTab", tabIndex },
    { type: "navigate", url: "https://gemini.google.com/app" },
    { type: "click", selector: inputSelector },
    { type: "type", selector: inputSelector, text: prompt, clear: false },
    { type: "press", key: "Enter" },
    { type: "screenshot", path: `${outputPrefix}/${label}-submitted.png`, fullPage: true }
  ]);

  await delay(waitMs);

  const captured = await runCommands(context, [
    { type: "selectTab", tabIndex },
    { type: "screenshot", path: `${outputPrefix}/${label}-result.png`, fullPage: true },
    { type: "getPageState", includeTextExcerpt: true }
  ]);

  const pageState = pickResultData<{ url: string; title: string; textExcerpt?: string }>(
    captured,
    "getPageState"
  );
  const screenshot = pickResultData<{ path: string }>(captured, "screenshot")?.path;
  const excerpt = pageState?.textExcerpt ?? "";

  return {
    label,
    tabIndex,
    screenshot,
    url: pageState?.url,
    title: pageState?.title,
    excerpt: excerpt.slice(0, 600),
    verifier: {
      likelyGeneratedResponse: isLikelyGeneratedResponse(excerpt),
      hasGeminiText: excerpt.toLowerCase().includes("gemini")
    }
  };
};

const resolveProfileId = async (): Promise<string> => {
  if (args["profile-id"]) {
    return args["profile-id"];
  }
  const controlState = await requestJson<{ activeProfileId?: string }>(apiBaseUrl, "/control/state");
  if (!controlState.activeProfileId) {
    throw new Error("No active profile set. Pass --profile-id or set an active profile in the UI first.");
  }
  return controlState.activeProfileId;
};

const main = async (): Promise<void> => {
  const profileId = await resolveProfileId();
  await requestJson(apiBaseUrl, "/control/active-profile", {
    method: "POST",
    body: JSON.stringify({
      profileId,
      autoStart: true
    })
  });

  const outputPrefix = `gemini-batch-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const context: ProfileCommandContext = { apiBaseUrl, profileId };

  await runCommands(context, [
    { type: "newTab", url: "https://gemini.google.com/app" },
    { type: "newTab", url: "https://gemini.google.com/app" }
  ]);

  const listed = await runCommands(context, [{ type: "listTabs" }]);
  const tabs = pickResultData<{ tabs: Array<{ index: number; url: string }> }>(listed, "listTabs")?.tabs ?? [];
  const geminiTabs = tabs.filter((tab) => tab.url.includes("gemini.google.com"));
  if (geminiTabs.length < 2) {
    throw new Error(`Expected at least 2 Gemini tabs, found ${geminiTabs.length}.`);
  }

  const tabA = geminiTabs[geminiTabs.length - 2]?.index;
  const tabB = geminiTabs[geminiTabs.length - 1]?.index;
  if (tabA === undefined || tabB === undefined) {
    throw new Error("Could not resolve first two Gemini tab indexes.");
  }

  const [result1, result2] = await Promise.all([
    submitPromptAndCapture(context, tabA, "parallel-1-logo", prompt1, outputPrefix),
    submitPromptAndCapture(context, tabB, "parallel-2-logo-alt", prompt2, outputPrefix)
  ]);

  await runCommands(context, [{ type: "newTab", url: "https://gemini.google.com/app" }]);
  const listedAgain = await runCommands(context, [{ type: "listTabs" }]);
  const tabsAgain =
    pickResultData<{ tabs: Array<{ index: number; url: string }> }>(listedAgain, "listTabs")?.tabs ?? [];
  const tabC = tabsAgain[tabsAgain.length - 1]?.index;
  if (tabC === undefined) {
    throw new Error("Could not resolve third tab index.");
  }
  const result3 = await submitPromptAndCapture(context, tabC, "third-coal-rain", prompt3, outputPrefix);

  console.log(
    JSON.stringify(
      {
        apiBaseUrl,
        profileId,
        outputPrefix,
        waitMs,
        results: [result1, result2, result3]
      },
      null,
      2
    )
  );
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
