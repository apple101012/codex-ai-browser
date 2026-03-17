import { describe, expect, it } from "vitest";
import {
  CreateProfileToolInputSchema,
  RunCommandsToolInputSchema,
  UpdateProfileToolInputSchema
} from "../src/mcp/toolSchemas.js";

describe("MCP tool schemas", () => {
  it("accepts valid create profile payload", () => {
    const value = CreateProfileToolInputSchema.parse({
      name: "profile-1",
      engine: "chromium",
      userAgent: "Agent/9.0",
      proxy: { server: "http://127.0.0.1:9000" }
    });

    expect(value.name).toBe("profile-1");
  });

  it("rejects invalid profile id on update", () => {
    expect(() =>
      UpdateProfileToolInputSchema.parse({
        profileId: "bad-id",
        name: "x"
      })
    ).toThrowError();
  });

  it("accepts command batches", () => {
    const payload = RunCommandsToolInputSchema.parse({
      profileId: "11111111-1111-4111-8111-111111111111",
      commands: [{ type: "navigate", url: "https://example.com" }]
    });
    expect(payload.commands).toHaveLength(1);
  });
});

