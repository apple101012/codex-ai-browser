import { describe, expect, it } from "vitest";
import { BrowserCommandSchema } from "../src/domain/commands.js";

describe("BrowserCommandSchema", () => {
  it("parses navigate commands", () => {
    const parsed = BrowserCommandSchema.parse({
      type: "navigate",
      url: "https://example.com"
    });
    expect(parsed.type).toBe("navigate");
  });

  it("rejects malformed commands", () => {
    expect(() =>
      BrowserCommandSchema.parse({
        type: "navigate",
        url: "not-a-url"
      })
    ).toThrowError();
  });
});

