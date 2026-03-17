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

  it("parses tab management commands", () => {
    const listTabs = BrowserCommandSchema.parse({ type: "listTabs" });
    expect(listTabs.type).toBe("listTabs");

    const selectTab = BrowserCommandSchema.parse({ type: "selectTab", tabIndex: 2 });
    expect(selectTab.type).toBe("selectTab");

    const getTabText = BrowserCommandSchema.parse({ type: "getTabText", tabIndex: 1, maxChars: 5000 });
    expect(getTabText.type).toBe("getTabText");
  });
});
