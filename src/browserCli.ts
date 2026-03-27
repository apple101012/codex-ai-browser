import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

interface ProfileSummary {
  id: string;
  name: string;
  engine: string;
  settings?: {
    headless?: boolean;
  };
}

interface ListProfilesResponse {
  profiles: ProfileSummary[];
  runningProfileIds: string[];
  activeProfileId: string | null;
}

interface CommandResult {
  type: string;
  ok: boolean;
  data?: unknown;
  error?: string;
}

interface CommandBatchResponse {
  total: number;
  successCount: number;
  results: CommandResult[];
  profileId?: string;
  activeProfileId?: string;
}

interface PageControlSummaryControl {
  index: number;
  tag: string;
  role?: string;
  text?: string;
  ariaLabel?: string;
  placeholder?: string;
}

interface PageControlSummarySuggestedTarget {
  purpose: "prompt-input" | "submit-action" | "project-entry";
  controlIndex: number;
  reason: string;
}

interface PageControlSummary {
  controls: PageControlSummaryControl[];
  suggestedTargets?: PageControlSummarySuggestedTarget[];
  progressSignals?: string[];
}

interface PageStateData {
  url?: string;
  title?: string;
  textExcerpt?: string;
  controlSummary?: PageControlSummary;
}

interface CanvasPoint {
  x: number;
  y: number;
}

type CanvasOrigin = "viewport" | "selector";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DESTRUCTIVE_TEXT_REGEX = /\b(delete|remove|clear all|reset|destroy|terminate|purge)\b/i;
const RUNNING_SIGNAL_REGEX = /\b(generating|rendering|queued|loading|processing|in progress|creating)\b/i;
const FAILURE_SIGNAL_REGEX = /\b(failed|error|unable|try again|unsuccessful)\b/i;
const SUCCESS_SIGNAL_REGEX = /\b(done|complete|completed|download|finished|result)\b/i;

class ParsedArgs {
  readonly positionals: string[];
  private readonly options: Map<string, string[]>;

  constructor(positionals: string[], options: Map<string, string[]>) {
    this.positionals = positionals;
    this.options = options;
  }

  static parse(argv: string[]): ParsedArgs {
    const positionals: string[] = [];
    const options = new Map<string, string[]>();
    const knownBooleanFlags = new Set([
      "json",
      "compact",
      "auto-start",
      "help",
      "strict",
      "append",
      "set-active",
      "exact",
      "allow-destructive",
      "full-page",
      "stop-on-failure",
      "auto",
      "verbose-watch"
    ]);

    const pushOption = (name: string, value: string): void => {
      const existing = options.get(name) ?? [];
      existing.push(value);
      options.set(name, existing);
    };

    for (let i = 0; i < argv.length; i += 1) {
      const arg = argv[i];
      if (!arg) {
        continue;
      }
      if (arg === "--") {
        positionals.push(...argv.slice(i + 1));
        break;
      }
      if (!arg.startsWith("--")) {
        positionals.push(arg);
        continue;
      }

      if (arg.startsWith("--no-")) {
        pushOption(arg.slice("--no-".length), "false");
        continue;
      }

      const eqIndex = arg.indexOf("=");
      if (eqIndex >= 0) {
        pushOption(arg.slice(2, eqIndex), arg.slice(eqIndex + 1));
        continue;
      }

      const key = arg.slice(2);
      if (knownBooleanFlags.has(key)) {
        pushOption(key, "true");
        continue;
      }
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        pushOption(key, next);
        i += 1;
      } else {
        pushOption(key, "true");
      }
    }

    return new ParsedArgs(positionals, options);
  }

  getString(name: string): string | undefined {
    const values = this.options.get(name);
    if (!values || values.length === 0) {
      return undefined;
    }
    return values[values.length - 1];
  }

  getStrings(name: string): string[] {
    return this.options.get(name) ?? [];
  }

  getBoolean(name: string, fallback: boolean): boolean {
    const value = this.getString(name);
    if (value === undefined) {
      return fallback;
    }

    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no", "off"].includes(normalized)) {
      return false;
    }
    return fallback;
  }

  getInt(name: string): number | undefined {
    const value = this.getString(name);
    if (value === undefined) {
      return undefined;
    }
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed)) {
      throw new Error(`Invalid integer for --${name}: "${value}"`);
    }
    return parsed;
  }

  getNumber(name: string): number | undefined {
    const value = this.getString(name);
    if (value === undefined) {
      return undefined;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      throw new Error(`Invalid number for --${name}: "${value}"`);
    }
    return parsed;
  }
}

interface CliContext {
  parsed: ParsedArgs;
  apiBaseUrl: string;
  apiToken?: string;
  outputJson: boolean;
  compact: boolean;
  autoStart: boolean;
}

const DEFAULT_PROFILE_NAME = "Browser Profile";

const print = (ctx: CliContext, payload: unknown, fallbackText?: string): void => {
  if (ctx.outputJson) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  if (fallbackText) {
    process.stdout.write(`${fallbackText}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(payload)}\n`);
};

const apiRequest = async <T>(ctx: CliContext, path: string, init?: RequestInit): Promise<T> => {
  const hasBody = init?.body !== undefined && init?.body !== null;
  const headers: HeadersInit = {};
  if (hasBody) {
    headers["content-type"] = "application/json";
  }
  if (ctx.apiToken) {
    headers.authorization = `Bearer ${ctx.apiToken}`;
  }

  const response = await fetch(`${ctx.apiBaseUrl}${path}`, {
    ...init,
    headers: {
      ...headers,
      ...(init?.headers ?? {})
    }
  });

  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json")
    ? ((await response.json()) as unknown)
    : await response.text();

  if (!response.ok) {
    throw new Error(
      typeof payload === "string"
        ? `API ${response.status}: ${payload}`
        : `API ${response.status}: ${JSON.stringify(payload)}`
    );
  }

  return payload as T;
};

const helpText = `
AI Browser CLI (token-efficient API wrapper)

Usage:
  npm run cli -- <command> [args] [options]

Core commands:
  health
  profiles list
  profiles start <profile-id-or-name>
  profiles stop <profile-id-or-name>
  profiles use <profile-id-or-name>
  profiles release
  open [url] [--profile=<id-or-name>] [--set-active=true|false]
  goto <url>
  snapshot [--max-elements=<n>]
  suggest [--max-controls=<n>]
  observe [--timeout-ms=<n>] [--poll-ms=<n>] [--stable-for-ms=<n>] [--until-text=<t>]... [--until-text-gone=<t>]... [--screenshot-every-ms=<n>] [--max-screenshots=<n>]
  click <ref> [--snapshot-id=<id>] [--strict=true|false]
  click-text <text> [--tag=button|a|any] [--occurrence=<n>] [--exact] [--allow-destructive]
  canvas-click <x> <y> [--origin=viewport|selector] [--selector=<css>] [--timeout-ms=<n>]
  canvas-drag <start-x> <start-y> <end-x> <end-y> [--origin=viewport|selector] [--selector=<css>] [--timeout-ms=<n>]
  canvas-path <x1,y1> <x2,y2> [x3,y3]... [--point=<x,y>]... [--origin=viewport|selector] [--selector=<css>] [--timeout-ms=<n>]
  type <ref> <text> [--snapshot-id=<id>] [--strict=true|false] [--append]
  prompt-type <text> [--append]
  prompt-submit
  wait-text [--text=<value>] [--text-gone=<value>] [--timeout-ms=<n>] [--poll-ms=<n>]
  wait-progress [--visible=<selector>]... [--hidden=<selector>]... [--timeout-ms=<n>] [--poll-ms=<n>] [--stable-for-ms=<n>]
  state
  tab-text [--tab-index=<n>] [--max-chars=<n>]
  run-active <commands-json-or-@file>

Global options:
  --api-base-url=<url>  (default: API_BASE_URL or http://127.0.0.1:4321)
  --api-token=<token>   (default: API_TOKEN env)
  --json                print full JSON responses
  --compact             compact text output (default true)
  --no-compact
  --strict              when snapshot-id is supplied, defaults to true unless --strict=false
  --allow-destructive   required for click-text actions matching delete/remove/reset keywords
  --origin              canvas coordinate space: viewport or selector (selector means selector-relative)
  --selector            CSS selector used as the canvas/container origin when --origin=selector
  --point               extra canvas-path point in x,y form; repeat for multi-point paths
  --auto                for observe, auto-detect running/completion/failure signals (default true)
  --stop-on-failure     for observe, stop early on failure-like signals (default true)
  --auto-start          auto start profile for active commands (default true)
  --no-auto-start
  --help

Examples:
  npm run cli -- profiles list
  npm run cli -- profiles use "Browser Profile"
  npm run cli -- open https://labs.google/fx/tools/flow
  npm run cli -- snapshot
  npm run cli -- prompt-type "cat logo, minimalist"
  npm run cli -- prompt-submit
  npm run cli -- click-text "Generate" --occurrence=1 --tag=button
  npm run cli -- type e7 cat logo minimalist --snapshot-id=snapshot-1-1
  npm run cli -- observe --until-text Done --until-text-gone Generating --screenshot-every-ms=10000 --timeout-ms=180000
  npm run cli -- click e12
  npm run cli -- canvas-click 320 180 --origin=selector --selector="canvas"
  npm run cli -- canvas-drag 30 30 180 180 --origin=selector --selector="[data-testid='canvas']"
  npm run cli -- canvas-path 20,20 120,40 160,160 --origin=selector --selector="canvas"
  npm run cli -- wait-progress --visible=".result-ready" --hidden=".spinner" --timeout-ms=30000
`;

const resolveProfileId = async (ctx: CliContext, identifier: string): Promise<string> => {
  if (UUID_REGEX.test(identifier)) {
    return identifier;
  }

  const payload = await apiRequest<ListProfilesResponse>(ctx, "/profiles");
  const needle = identifier.trim().toLowerCase();
  const exactMatches = payload.profiles.filter((profile) => profile.name.trim().toLowerCase() === needle);
  if (exactMatches.length === 1) {
    return exactMatches[0]!.id;
  }

  if (exactMatches.length > 1) {
    throw new Error(`Multiple profiles match "${identifier}" exactly. Use profile id.`);
  }

  const partialMatches = payload.profiles.filter((profile) => profile.name.toLowerCase().includes(needle));
  if (partialMatches.length === 1) {
    return partialMatches[0]!.id;
  }
  if (partialMatches.length > 1) {
    const names = partialMatches.map((profile) => profile.name).join(", ");
    throw new Error(`Multiple profiles matched "${identifier}": ${names}. Use profile id.`);
  }

  throw new Error(`No profile found for "${identifier}".`);
};

const ensureAnyActiveProfile = async (ctx: CliContext): Promise<void> => {
  try {
    await apiRequest(ctx, "/control/ensure-active", {
      method: "POST",
      body: JSON.stringify({
        profileName: DEFAULT_PROFILE_NAME,
        autoStart: ctx.autoStart,
        setActive: true,
        preferRunningBrowserProfile: true,
        allowAnyRunningFallback: true
      })
    });
    return;
  } catch {
    const profiles = await apiRequest<ListProfilesResponse>(ctx, "/profiles");
    const first = profiles.profiles[0];
    if (!first) {
      throw new Error("No profiles available. Create a profile first.");
    }
    await apiRequest(ctx, "/control/active-profile", {
      method: "POST",
      body: JSON.stringify({
        profileId: first.id,
        autoStart: ctx.autoStart
      })
    });
  }
};

const runActiveCommands = async (ctx: CliContext, commands: unknown[]): Promise<CommandBatchResponse> => {
  try {
    return await apiRequest<CommandBatchResponse>(ctx, "/control/active/commands", {
      method: "POST",
      body: JSON.stringify({
        autoStart: ctx.autoStart,
        commands
      })
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("No active profile selected")) {
      throw error;
    }
    await ensureAnyActiveProfile(ctx);

    return await apiRequest<CommandBatchResponse>(ctx, "/control/active/commands", {
      method: "POST",
      body: JSON.stringify({
        autoStart: ctx.autoStart,
        commands
      })
    });
  }
};

const formatCommand = (ctx: CliContext, batch: CommandBatchResponse): void => {
  const first = batch.results[0];
  if (!first) {
    print(ctx, batch, "No command results.");
    return;
  }
  if (!first.ok) {
    throw new Error(first.error ?? `Command ${first.type} failed.`);
  }

  if (ctx.outputJson) {
    print(ctx, batch);
    return;
  }

  if (ctx.compact) {
    if (first.type === "snapshot") {
      const data = first.data as { snapshotId?: string; backend?: string; elementCount?: number } | undefined;
      process.stdout.write(
        `snapshot ok snapshotId=${data?.snapshotId ?? "n/a"} backend=${data?.backend ?? "n/a"} elements=${data?.elementCount ?? 0}\n`
      );
      return;
    }
    if (first.type === "getPageState") {
      const data = first.data as PageStateData | undefined;
      const signals = data?.controlSummary?.progressSignals?.length ?? 0;
      process.stdout.write(
        `state ok title=${JSON.stringify(data?.title ?? "")} url=${data?.url ?? "n/a"} signals=${signals}\n`
      );
      return;
    }
    process.stdout.write(`${first.type} ok\n`);
    return;
  }

  print(ctx, batch);
};

const parseCommandsInput = async (value: string): Promise<unknown[]> => {
  const content = value.startsWith("@")
    ? await readFile(value.slice(1), "utf-8")
    : value;
  const parsed = JSON.parse(content) as unknown;
  if (Array.isArray(parsed)) {
    return parsed;
  }
  if (parsed && typeof parsed === "object" && Array.isArray((parsed as { commands?: unknown[] }).commands)) {
    return (parsed as { commands: unknown[] }).commands;
  }
  throw new Error("run-active expects a JSON array of commands or { commands: [...] }");
};

interface ObservePollRecord {
  elapsedMs: number;
  url: string;
  title: string;
  progressSignals: string[];
  runningDetected: boolean;
  successDetected: boolean;
  failureDetected: boolean;
  untilMatched: string[];
  untilMissing: string[];
  untilGoneStillPresent: string[];
  screenshotPath?: string;
}

interface ObserveResult {
  reason: "conditions_met" | "auto_completed" | "failure_signal" | "timeout";
  elapsedMs: number;
  polls: number;
  observedRunning: boolean;
  observedFailure: boolean;
  observedSuccess: boolean;
  lastUrl: string;
  lastTitle: string;
  lastSignals: string[];
  screenshots: string[];
  records: ObservePollRecord[];
}

const sleep = async (ms: number): Promise<void> =>
  await new Promise((resolve) => setTimeout(resolve, ms));

const includesIgnoreCase = (haystack: string, needle: string): boolean =>
  haystack.toLowerCase().includes(needle.toLowerCase());

const detectRunningSignal = (textBlob: string, signals: string[]): boolean => {
  const hasKeyword = RUNNING_SIGNAL_REGEX.test(textBlob);
  const hasProgressPercent = signals.some((signal) => {
    const match = signal.match(/(\d{1,3})%/);
    if (!match) {
      return false;
    }
    const value = Number.parseInt(match[1] ?? "0", 10);
    return value > 0 && value < 100;
  });
  return hasKeyword || hasProgressPercent;
};

const detectFailureSignal = (textBlob: string): boolean =>
  FAILURE_SIGNAL_REGEX.test(textBlob);

const detectSuccessSignal = (textBlob: string, running: boolean): boolean =>
  !running && SUCCESS_SIGNAL_REGEX.test(textBlob);

const parseRequiredText = (rest: string[], commandName: string, startIndex = 0): string => {
  const text = rest.slice(startIndex).join(" ").trim();
  if (!text) {
    throw new Error(`${commandName} requires text.`);
  }
  return text;
};

const parseNumberValue = (value: string, label: string): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid number for ${label}: "${value}"`);
  }
  return parsed;
};

const parseCanvasOrigin = (parsed: ParsedArgs): { origin?: CanvasOrigin; selector?: string } => {
  const rawOrigin = parsed.getString("origin");
  const selector = parsed.getString("selector");
  const normalizedOrigin =
    rawOrigin === undefined
      ? selector
        ? "selector"
        : undefined
      : rawOrigin === "viewport" || rawOrigin === "selector" || rawOrigin === "selector-relative" || rawOrigin === "element"
        ? (rawOrigin === "selector-relative" || rawOrigin === "element" ? "selector" : rawOrigin)
        : undefined;

  if (rawOrigin && !normalizedOrigin) {
    throw new Error('--origin must be "viewport" or "selector".');
  }
  if (normalizedOrigin === "selector" && !selector) {
    throw new Error('Canvas selector-relative commands require --selector when --origin=selector.');
  }

  return {
    origin: normalizedOrigin,
    selector
  };
};

const toCanvasCommandOrigin = (origin: CanvasOrigin | undefined): "viewport" | "element" | undefined =>
  origin === "selector" ? "element" : origin;

const parseCanvasPoint = (value: string, label: string): CanvasPoint => {
  const parts = value.split(",");
  if (parts.length !== 2) {
    throw new Error(`${label} must be in x,y form.`);
  }
  return {
    x: parseNumberValue(parts[0]!.trim(), `${label} x`),
    y: parseNumberValue(parts[1]!.trim(), `${label} y`)
  };
};

const parseCanvasPathPoints = (rest: string[], parsed: ParsedArgs): CanvasPoint[] => {
  const positionalPoints = rest.map((value, index) => parseCanvasPoint(value, `point ${index + 1}`));
  const optionPoints = parsed.getStrings("point").map((value, index) => parseCanvasPoint(value, `--point #${index + 1}`));
  const points = [...positionalPoints, ...optionPoints];
  if (points.length < 2) {
    throw new Error("canvas-path requires at least two points.");
  }
  return points;
};

const renderSuggestions = (summary?: PageControlSummary): string => {
  if (!summary) {
    return "No control summary available.";
  }
  const targets = summary.suggestedTargets ?? [];
  if (targets.length === 0) {
    return "No suggested targets detected.";
  }
  const lines = targets.map((target) => {
    const control = summary.controls.find((item) => item.index === target.controlIndex);
    const label = control?.text || control?.ariaLabel || control?.placeholder || control?.tag || "unknown";
    return `${target.purpose}: index=${target.controlIndex} label=${JSON.stringify(label)} reason=${target.reason}`;
  });
  const signals = summary.progressSignals?.slice(0, 6) ?? [];
  if (signals.length > 0) {
    lines.push(`signals: ${signals.join(", ")}`);
  }
  return lines.join("\n");
};

const runObserve = async (ctx: CliContext): Promise<ObserveResult> => {
  const timeoutMs = parsedTimeout(ctx, "timeout-ms", 180_000, 1_000, 600_000);
  const pollMs = parsedTimeout(ctx, "poll-ms", 2_500, 250, 60_000);
  const stableForMs = parsedTimeout(ctx, "stable-for-ms", 6_000, 0, 180_000);
  const screenshotEveryMs = parsedTimeout(ctx, "screenshot-every-ms", 0, 0, 600_000);
  const maxScreenshots = parsedIntBounded(ctx, "max-screenshots", 8, 0, 200);
  const maxControls = parsedIntBounded(ctx, "max-controls", 100, 1, 500);
  const maxTextChars = parsedIntBounded(ctx, "max-text-chars", 2_500, 200, 20_000);
  const fullPage = ctx.parsed.getBoolean("full-page", true);
  const stopOnFailure = ctx.parsed.getBoolean("stop-on-failure", true);
  const auto = ctx.parsed.getBoolean("auto", true);
  const verboseWatch = ctx.parsed.getBoolean("verbose-watch", false);
  const untilTexts = ctx.parsed.getStrings("until-text").map((value) => value.trim()).filter((value) => value.length > 0);
  const untilTextsGone = ctx.parsed.getStrings("until-text-gone").map((value) => value.trim()).filter((value) => value.length > 0);

  let reason: ObserveResult["reason"] = "timeout";
  let observedRunning = false;
  let observedFailure = false;
  let observedSuccess = false;
  let stableSince: number | null = null;
  let conditionsSince: number | null = null;
  let nextScreenshotAt = screenshotEveryMs > 0 ? 0 : Number.POSITIVE_INFINITY;
  let lastUrl = "";
  let lastTitle = "";
  let lastSignals: string[] = [];
  const screenshots: string[] = [];
  const records: ObservePollRecord[] = [];
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;

  for (;;) {
    const now = Date.now();
    const elapsedMs = now - startedAt;
    const shouldScreenshot =
      screenshotEveryMs > 0 && screenshots.length < maxScreenshots && elapsedMs >= nextScreenshotAt;
    const commands: unknown[] = [
      {
        type: "getPageState",
        includeTextExcerpt: true,
        includeControlSummary: true,
        maxControls,
        maxTextChars,
        includeHtml: false
      }
    ];
    if (shouldScreenshot) {
      commands.push({
        type: "screenshot",
        fullPage
      });
    }

    const batch = await runActiveCommands(ctx, commands);
    const stateResult = batch.results[0];
    if (!stateResult || !stateResult.ok) {
      throw new Error(stateResult?.error ?? "observe failed to read state.");
    }
    const state = (stateResult.data ?? {}) as PageStateData;
    const textExcerpt = state.textExcerpt ?? "";
    const signals = state.controlSummary?.progressSignals ?? [];
    lastUrl = state.url ?? "";
    lastTitle = state.title ?? "";
    lastSignals = signals;
    const textBlob = `${lastTitle}\n${textExcerpt}\n${signals.join("\n")}`;

    const untilMatched = untilTexts.filter((needle) => includesIgnoreCase(textBlob, needle));
    const untilMissing = untilTexts.filter((needle) => !includesIgnoreCase(textBlob, needle));
    const untilGoneStillPresent = untilTextsGone.filter((needle) => includesIgnoreCase(textBlob, needle));
    const conditionsSatisfied = untilMissing.length === 0 && untilGoneStillPresent.length === 0;

    const runningDetected = detectRunningSignal(textBlob, signals);
    const failureDetected = detectFailureSignal(textBlob);
    const successDetected = detectSuccessSignal(textBlob, runningDetected);
    observedRunning = observedRunning || runningDetected;
    observedFailure = observedFailure || failureDetected;
    observedSuccess = observedSuccess || successDetected;

    let screenshotPath: string | undefined;
    if (shouldScreenshot) {
      const screenshotResult = batch.results[1];
      if (screenshotResult?.ok) {
        const data = (screenshotResult.data ?? {}) as { path?: string };
        screenshotPath = data.path;
        if (screenshotPath) {
          screenshots.push(screenshotPath);
        }
      }
      nextScreenshotAt = elapsedMs + screenshotEveryMs;
    }

    const record: ObservePollRecord = {
      elapsedMs,
      url: lastUrl,
      title: lastTitle,
      progressSignals: signals,
      runningDetected,
      successDetected,
      failureDetected,
      untilMatched,
      untilMissing,
      untilGoneStillPresent,
      screenshotPath
    };
    records.push(record);

    if (verboseWatch && !ctx.outputJson) {
      const summary = `observe poll=${records.length} elapsedMs=${elapsedMs} running=${runningDetected} success=${successDetected} failure=${failureDetected} signals=${JSON.stringify(signals.slice(0, 6))}`;
      process.stdout.write(`${summary}\n`);
    }

    if (untilTexts.length > 0 || untilTextsGone.length > 0) {
      if (conditionsSatisfied) {
        if (conditionsSince === null) {
          conditionsSince = now;
        }
        if (now - conditionsSince >= stableForMs) {
          reason = "conditions_met";
          break;
        }
      } else {
        conditionsSince = null;
      }
    } else if (auto) {
      if (failureDetected && stopOnFailure) {
        reason = "failure_signal";
        break;
      }
      if (observedRunning && !runningDetected) {
        if (stableSince === null) {
          stableSince = now;
        }
        if (now - stableSince >= stableForMs) {
          reason = "auto_completed";
          break;
        }
      } else {
        stableSince = null;
      }
    }

    if (now >= deadline) {
      reason = "timeout";
      break;
    }

    await sleep(pollMs);
  }

  const elapsedMs = Date.now() - startedAt;
  return {
    reason,
    elapsedMs,
    polls: records.length,
    observedRunning,
    observedFailure,
    observedSuccess,
    lastUrl,
    lastTitle,
    lastSignals,
    screenshots,
    records
  };
};

const parsedTimeout = (
  ctx: CliContext,
  name: string,
  fallback: number,
  min: number,
  max: number
): number => parsedIntBounded(ctx, name, fallback, min, max);

const parsedIntBounded = (
  ctx: CliContext,
  name: string,
  fallback: number,
  min: number,
  max: number
): number => {
  const parsed = ctx.parsed.getInt(name);
  if (parsed === undefined) {
    return fallback;
  }
  if (parsed < min || parsed > max) {
    throw new Error(`--${name} must be between ${min} and ${max}.`);
  }
  return parsed;
};

const handleProfiles = async (ctx: CliContext, rest: string[]): Promise<void> => {
  const sub = rest[0];
  switch (sub) {
    case "list": {
      const payload = await apiRequest<ListProfilesResponse>(ctx, "/profiles");
      if (ctx.outputJson || !ctx.compact) {
        print(ctx, payload);
        return;
      }

      const lines = payload.profiles.map((profile) => {
        const running = payload.runningProfileIds.includes(profile.id) ? "running" : "stopped";
        const active = payload.activeProfileId === profile.id ? "active" : "";
        return `${profile.name} (${profile.id}) ${running}${active ? ` ${active}` : ""}`.trim();
      });
      process.stdout.write(`${lines.join("\n")}\n`);
      return;
    }
    case "start": {
      const idOrName = rest[1];
      if (!idOrName) {
        throw new Error("profiles start requires <profile-id-or-name>");
      }
      const profileId = await resolveProfileId(ctx, idOrName);
      const payload = await apiRequest(ctx, `/profiles/${profileId}/start`, { method: "POST" });
      print(ctx, payload, `started ${profileId}`);
      return;
    }
    case "stop": {
      const idOrName = rest[1];
      if (!idOrName) {
        throw new Error("profiles stop requires <profile-id-or-name>");
      }
      const profileId = await resolveProfileId(ctx, idOrName);
      const payload = await apiRequest(ctx, `/profiles/${profileId}/stop`, { method: "POST" });
      print(ctx, payload, `stopped ${profileId}`);
      return;
    }
    case "use": {
      const idOrName = rest[1];
      if (!idOrName) {
        throw new Error("profiles use requires <profile-id-or-name>");
      }
      const profileId = await resolveProfileId(ctx, idOrName);
      const payload = await apiRequest(ctx, "/control/active-profile", {
        method: "POST",
        body: JSON.stringify({
          profileId,
          autoStart: ctx.autoStart
        })
      });
      print(ctx, payload, `active profile ${profileId}`);
      return;
    }
    case "release": {
      const payload = await apiRequest(ctx, "/control/release", {
        method: "POST",
        body: JSON.stringify({})
      });
      print(ctx, payload, "released active profile");
      return;
    }
    default:
      throw new Error("profiles subcommands: list | start | stop | use | release");
  }
};

const runCli = async (): Promise<void> => {
  const parsed = ParsedArgs.parse(process.argv.slice(2));
  const outputJson = parsed.getBoolean("json", false);
  const compact = parsed.getBoolean("compact", true);
  const autoStart = parsed.getBoolean("auto-start", true);
  const apiBaseUrl = parsed.getString("api-base-url") ?? process.env.API_BASE_URL ?? "http://127.0.0.1:4321";
  const apiToken = parsed.getString("api-token") ?? process.env.API_TOKEN;

  const ctx: CliContext = {
    parsed,
    apiBaseUrl,
    apiToken,
    outputJson,
    compact,
    autoStart
  };

  const [command, ...rest] = parsed.positionals;
  if (!command || command === "help" || parsed.getBoolean("help", false)) {
    process.stdout.write(`${helpText.trim()}\n`);
    return;
  }

  switch (command) {
    case "health": {
      const payload = await apiRequest(ctx, "/health");
      print(ctx, payload, "ok");
      return;
    }
    case "profiles": {
      await handleProfiles(ctx, rest);
      return;
    }
    case "use": {
      const idOrName = rest[0];
      if (!idOrName) {
        throw new Error("use requires <profile-id-or-name>");
      }
      const profileId = await resolveProfileId(ctx, idOrName);
      const payload = await apiRequest(ctx, "/control/active-profile", {
        method: "POST",
        body: JSON.stringify({
          profileId,
          autoStart: ctx.autoStart
        })
      });
      print(ctx, payload, `active profile ${profileId}`);
      return;
    }
    case "release": {
      const payload = await apiRequest(ctx, "/control/release", {
        method: "POST",
        body: JSON.stringify({})
      });
      print(ctx, payload, "released active profile");
      return;
    }
    case "open": {
      const url = rest[0];
      const profileIdentifier = parsed.getString("profile");
      const autoSetActive = parsed.getBoolean("set-active", true);
      const profileId = profileIdentifier ? await resolveProfileId(ctx, profileIdentifier) : undefined;

      if (!url) {
        if (profileId) {
          const payload = await apiRequest(ctx, "/control/active-profile", {
            method: "POST",
            body: JSON.stringify({
              profileId,
              autoStart: ctx.autoStart
            })
          });
          print(ctx, payload, "active profile ensured");
          return;
        }

        await ensureAnyActiveProfile(ctx);
        print(ctx, { ok: true }, "active profile ensured");
        return;
      }

      const payload = await apiRequest(ctx, "/control/open-url", {
        method: "POST",
        body: JSON.stringify({
          url,
          profileId,
          autoSetActive,
          autoStart: ctx.autoStart
        })
      });
      print(ctx, payload, `opened ${url}`);
      return;
    }
    case "goto": {
      const url = rest[0];
      if (!url) {
        throw new Error("goto requires <url>");
      }
      const batch = await runActiveCommands(ctx, [
        {
          type: "navigate",
          url
        }
      ]);
      formatCommand(ctx, batch);
      return;
    }
    case "snapshot": {
      const maxElements = parsed.getInt("max-elements");
      const batch = await runActiveCommands(ctx, [
        {
          type: "snapshot",
          maxElements
        }
      ]);
      formatCommand(ctx, batch);
      return;
    }
    case "suggest": {
      const maxControls = parsed.getInt("max-controls") ?? 120;
      const batch = await runActiveCommands(ctx, [
        {
          type: "getPageState",
          includeTextExcerpt: false,
          includeControlSummary: true,
          maxControls,
          maxTextChars: 2000,
          includeHtml: false
        }
      ]);
      const first = batch.results[0];
      if (!first || !first.ok) {
        throw new Error(first?.error ?? "suggest failed.");
      }
      if (ctx.outputJson) {
        print(ctx, batch);
        return;
      }
      const data = first.data as PageStateData | undefined;
      process.stdout.write(`${renderSuggestions(data?.controlSummary)}\n`);
      return;
    }
    case "observe": {
      const result = await runObserve(ctx);
      if (ctx.outputJson) {
        print(ctx, result);
        return;
      }
      if (ctx.compact) {
        process.stdout.write(
          `observe ${result.reason} polls=${result.polls} elapsedMs=${result.elapsedMs} running=${result.observedRunning} success=${result.observedSuccess} failure=${result.observedFailure} screenshots=${result.screenshots.length}\n`
        );
        return;
      }
      print(ctx, result);
      return;
    }
    case "click": {
      const ref = rest[0];
      if (!ref) {
        throw new Error("click requires <ref>");
      }
      const timeoutMs = parsed.getInt("timeout-ms");
      const snapshotId = parsed.getString("snapshot-id");
      const strictSnapshot = parsed.getBoolean("strict", Boolean(snapshotId));
      const batch = await runActiveCommands(ctx, [
        {
          type: "clickRef",
          ref,
          timeoutMs,
          snapshotId,
          strictSnapshot,
          includeStateAfter: false
        }
      ]);
      formatCommand(ctx, batch);
      return;
    }
    case "click-text": {
      const text = parseRequiredText(rest, "click-text");
      const timeoutMs = parsed.getInt("timeout-ms");
      const occurrence = parsed.getInt("occurrence");
      const tagRaw = parsed.getString("tag");
      const tag = tagRaw && ["button", "a", "any"].includes(tagRaw) ? tagRaw : undefined;
      if (tagRaw && !tag) {
        throw new Error('click-text --tag must be one of: "button", "a", "any".');
      }
      const exact = parsed.getBoolean("exact", false);
      const allowDestructive = parsed.getBoolean("allow-destructive", false);
      if (!allowDestructive && DESTRUCTIVE_TEXT_REGEX.test(text)) {
        throw new Error(
          "click-text matched destructive keywords (delete/remove/reset/etc). " +
          "If intentional, retry with --allow-destructive."
        );
      }

      const batch = await runActiveCommands(ctx, [
        {
          type: "clickByText",
          text,
          occurrence,
          tag,
          exact,
          timeoutMs,
          includeStateAfter: false
        }
      ]);
      formatCommand(ctx, batch);
      return;
    }
    case "canvas-click":
    case "mouse-click": {
      const xRaw = rest[0];
      const yRaw = rest[1];
      if (xRaw === undefined || yRaw === undefined) {
        throw new Error("canvas-click requires <x> <y>");
      }
      const { origin, selector } = parseCanvasOrigin(parsed);
      const timeoutMs = parsed.getInt("timeout-ms");
      const batch = await runActiveCommands(ctx, [
        {
          type: "mouse",
          action: "click",
          coordinates: {
            x: parseNumberValue(xRaw, "x"),
            y: parseNumberValue(yRaw, "y")
          },
          origin: toCanvasCommandOrigin(origin),
          selector,
          timeoutMs
        }
      ]);
      formatCommand(ctx, batch);
      return;
    }
    case "canvas-drag":
    case "mouse-drag": {
      const startXRaw = rest[0];
      const startYRaw = rest[1];
      const endXRaw = rest[2];
      const endYRaw = rest[3];
      if (startXRaw === undefined || startYRaw === undefined || endXRaw === undefined || endYRaw === undefined) {
        throw new Error("canvas-drag requires <start-x> <start-y> <end-x> <end-y>");
      }
      const { origin, selector } = parseCanvasOrigin(parsed);
      const timeoutMs = parsed.getInt("timeout-ms");
      const batch = await runActiveCommands(ctx, [
        {
          type: "mouseDrag",
          from: {
            x: parseNumberValue(startXRaw, "start-x"),
            y: parseNumberValue(startYRaw, "start-y")
          },
          to: {
            x: parseNumberValue(endXRaw, "end-x"),
            y: parseNumberValue(endYRaw, "end-y")
          },
          origin: toCanvasCommandOrigin(origin),
          selector,
          timeoutMs
        }
      ]);
      formatCommand(ctx, batch);
      return;
    }
    case "canvas-path":
    case "mouse-path": {
      const { origin, selector } = parseCanvasOrigin(parsed);
      const timeoutMs = parsed.getInt("timeout-ms");
      const points = parseCanvasPathPoints(rest, parsed);
      const batch = await runActiveCommands(ctx, [
        {
          type: "mousePath",
          points,
          origin: toCanvasCommandOrigin(origin),
          selector,
          timeoutMs
        }
      ]);
      formatCommand(ctx, batch);
      return;
    }
    case "type": {
      const ref = rest[0];
      if (!ref) {
        throw new Error("type requires <ref> <text>");
      }
      const text = parseRequiredText(rest, "type", 1);
      const timeoutMs = parsed.getInt("timeout-ms");
      const snapshotId = parsed.getString("snapshot-id");
      const strictSnapshot = parsed.getBoolean("strict", Boolean(snapshotId));
      const clear = !parsed.getBoolean("append", false);
      const batch = await runActiveCommands(ctx, [
        {
          type: "typeRef",
          ref,
          text,
          clear,
          timeoutMs,
          snapshotId,
          strictSnapshot,
          includeStateAfter: false
        }
      ]);
      formatCommand(ctx, batch);
      return;
    }
    case "prompt-type": {
      const text = parseRequiredText(rest, "prompt-type");
      const timeoutMs = parsed.getInt("timeout-ms");
      const clear = !parsed.getBoolean("append", false);
      const batch = await runActiveCommands(ctx, [
        {
          type: "typeIntoPrompt",
          text,
          clear,
          timeoutMs,
          includeStateAfter: false
        }
      ]);
      formatCommand(ctx, batch);
      return;
    }
    case "prompt-submit": {
      const timeoutMs = parsed.getInt("timeout-ms");
      const batch = await runActiveCommands(ctx, [
        {
          type: "submitPrompt",
          timeoutMs,
          includeStateAfter: false
        }
      ]);
      formatCommand(ctx, batch);
      return;
    }
    case "wait-text": {
      const text = parsed.getString("text");
      const textGone = parsed.getString("text-gone");
      if (!text && !textGone) {
        throw new Error("wait-text requires --text and/or --text-gone");
      }
      const timeoutMs = parsed.getInt("timeout-ms");
      const pollMs = parsed.getInt("poll-ms");
      const batch = await runActiveCommands(ctx, [
        {
          type: "waitForText",
          text,
          textGone,
          timeoutMs,
          pollMs,
          includeStateAfter: false
        }
      ]);
      formatCommand(ctx, batch);
      return;
    }
    case "wait-progress": {
      const anyVisibleSelectors = parsed.getStrings("visible");
      const allHiddenSelectors = parsed.getStrings("hidden");
      if (anyVisibleSelectors.length === 0 && allHiddenSelectors.length === 0) {
        throw new Error("wait-progress requires at least one --visible and/or --hidden selector.");
      }
      const timeoutMs = parsed.getInt("timeout-ms");
      const pollMs = parsed.getInt("poll-ms");
      const stableForMs = parsed.getInt("stable-for-ms");
      const batch = await runActiveCommands(ctx, [
        {
          type: "waitForDomState",
          anyVisibleSelectors,
          allHiddenSelectors,
          timeoutMs,
          pollMs,
          stableForMs,
          includeStateAfter: false
        }
      ]);
      formatCommand(ctx, batch);
      return;
    }
    case "state": {
      const batch = await runActiveCommands(ctx, [
        {
          type: "getPageState",
          includeTextExcerpt: true,
          includeControlSummary: true,
          maxControls: 80,
          maxTextChars: 4000,
          includeHtml: false
        }
      ]);
      formatCommand(ctx, batch);
      return;
    }
    case "tab-text": {
      const tabIndex = parsed.getInt("tab-index") ?? 0;
      const maxChars = parsed.getInt("max-chars") ?? 4000;
      const batch = await runActiveCommands(ctx, [
        {
          type: "getTabText",
          tabIndex,
          maxChars
        }
      ]);
      formatCommand(ctx, batch);
      return;
    }
    case "run-active": {
      const raw = rest[0];
      if (!raw) {
        throw new Error("run-active requires JSON commands payload or @path/to/file.json");
      }
      const commands = await parseCommandsInput(raw);
      const batch = await runActiveCommands(ctx, commands);
      formatCommand(ctx, batch);
      return;
    }
    default:
      throw new Error(`Unknown command "${command}". Use --help.`);
  }
};

const isMain = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isMain) {
  runCli().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`ai-browser-cli error: ${message}\n`);
    process.exit(1);
  });
}

export { runCli };
