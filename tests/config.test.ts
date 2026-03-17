import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("parses booleans and defaults", () => {
    process.env.HOST = "0.0.0.0";
    process.env.PORT = "9876";
    process.env.DEFAULT_HEADLESS = "false";
    process.env.ALLOW_EVALUATE = "true";
    process.env.DATA_DIR = "./data-test";
    process.env.API_TOKEN = "abc";

    const config = loadConfig();
    expect(config.host).toBe("0.0.0.0");
    expect(config.port).toBe(9876);
    expect(config.defaultHeadless).toBe(false);
    expect(config.allowEvaluate).toBe(true);
    expect(config.apiToken).toBe("abc");
    expect(config.dataDir.endsWith("data-test")).toBe(true);
  });
});
