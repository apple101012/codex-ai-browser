import { chromium } from "playwright";
import { coerceProxyConfig } from "./proxyParser.js";
import type { ProxyConfig, ProxyConfigInput } from "./proxyTypes.js";

const DEFAULT_PROXY_TEST_URLS = [
  "https://api.ipify.org?format=json",
  "https://api64.ipify.org?format=json",
  "https://ifconfig.me/ip"
];
const FALLBACK_TEST_URL = DEFAULT_PROXY_TEST_URLS[0] ?? "https://api.ipify.org?format=json";

export interface ProxyCheckOptions {
  testUrl?: string;
  timeoutMs?: number;
  testUrls?: string[];
  headless?: boolean;
}

export interface ProxyCheckAttempt {
  testUrl: string;
  statusCode?: number;
  finalUrl?: string;
  publicIp?: string;
  bodySnippet?: string;
  error?: string;
}

export interface ProxyCheckResult {
  reachable: boolean;
  proxy: ProxyConfig;
  selectedTestUrl?: string;
  publicIp?: string;
  statusCode?: number;
  finalUrl?: string;
  bodySnippet?: string;
  error?: string;
  attempts: ProxyCheckAttempt[];
}

const formatError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};

const extractIpFromBody = (body: string): string | undefined => {
  const trimmed = body.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const candidate = parsed.ip ?? parsed.ipAddress ?? parsed.address;
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  } catch {
    // Not JSON, fall through to text parsing.
  }

  const textCandidate = trimmed.split(/\s+/)[0]?.trim();
  if (textCandidate && /^(?:\d{1,3}\.){3}\d{1,3}$/.test(textCandidate)) {
    return textCandidate;
  }

  if (textCandidate && /^[0-9a-f:]+$/i.test(textCandidate) && textCandidate.includes(":")) {
    return textCandidate;
  }

  return undefined;
};

export const createPlaywrightProxyChecker = (options: { headless?: boolean } = {}) => {
  const headless = options.headless ?? true;

  return async (proxyInput: ProxyConfigInput, checkOptions: ProxyCheckOptions = {}): Promise<ProxyCheckResult> => {
    const proxy = coerceProxyConfig(proxyInput, { emptyStringAsUndefined: false });
    if (!proxy) {
      throw new Error("Proxy configuration is required.");
    }

    const timeoutMs = checkOptions.timeoutMs ?? 15_000;
    const testUrls = checkOptions.testUrl
      ? [checkOptions.testUrl]
      : checkOptions.testUrls?.length
        ? checkOptions.testUrls
        : DEFAULT_PROXY_TEST_URLS;

    const attempts: ProxyCheckAttempt[] = [];
    let browser;

    try {
      browser = await chromium.launch({
        headless: checkOptions.headless ?? headless,
        proxy,
        chromiumSandbox: true
      });

      for (const testUrl of testUrls) {
        const page = await browser.newPage();
        try {
          const response = await page.goto(testUrl, {
            waitUntil: "domcontentloaded",
            timeout: timeoutMs
          });
          const body = await page.locator("body").innerText({ timeout: timeoutMs }).catch(() => "");
          const attempt: ProxyCheckAttempt = {
            testUrl,
            statusCode: response?.status(),
            finalUrl: page.url(),
            publicIp: extractIpFromBody(body),
            bodySnippet: body.trim().slice(0, 400)
          };

          attempts.push(attempt);
          return {
            reachable: true,
            proxy,
            selectedTestUrl: testUrl,
            publicIp: attempt.publicIp,
            statusCode: attempt.statusCode,
            finalUrl: attempt.finalUrl,
            bodySnippet: attempt.bodySnippet,
            attempts
          };
        } catch (error) {
          attempts.push({
            testUrl,
            error: formatError(error)
          });
        } finally {
          await page.close().catch(() => undefined);
        }
      }

      return {
        reachable: false,
        proxy,
        selectedTestUrl: testUrls[0] ?? FALLBACK_TEST_URL,
        error: attempts.at(-1)?.error ?? "Proxy check failed.",
        attempts
      };
    } catch (error) {
      attempts.push({
        testUrl: testUrls[0] ?? FALLBACK_TEST_URL,
        error: formatError(error)
      });
      return {
        reachable: false,
        proxy,
        selectedTestUrl: testUrls[0] ?? FALLBACK_TEST_URL,
        error: formatError(error),
        attempts
      };
    } finally {
      if (browser) {
        await browser.close().catch(() => undefined);
      }
    }
  };
};
