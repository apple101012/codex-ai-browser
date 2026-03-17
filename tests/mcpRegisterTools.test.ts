import { describe, expect, it } from "vitest";
import { registerBrowserTools, type ApiRequestFn, type RegisterableMcpServer } from "../src/mcp/registerTools.js";

interface RegisteredTool {
  name: string;
  handler: (input: unknown) => Promise<{ content: Array<{ type: "text"; text: string }> }>;
}

const parseTextPayload = (result: { content: Array<{ type: "text"; text: string }> }): unknown =>
  JSON.parse(result.content[0]?.text ?? "null");

describe("registerBrowserTools", () => {
  it("registers the expected MCP tool set", () => {
    const registered: RegisteredTool[] = [];
    const server: RegisterableMcpServer = {
      registerTool(name, _definition, handler) {
        registered.push({ name, handler });
      }
    };

    const apiRequest: ApiRequestFn = async <T>() => ({ ok: true } as T);
    registerBrowserTools(server, apiRequest);

    expect(registered.map((tool) => tool.name)).toEqual([
      "list_profiles",
      "get_profile",
      "create_profile",
      "update_profile",
      "ensure_gemini_profile",
      "open_gemini_session",
      "get_control_state",
      "set_active_profile",
      "run_active_commands",
      "start_profile",
      "stop_profile",
      "run_commands",
      "list_backups",
      "backup_profile",
      "restore_profile_backup"
    ]);
  });

  it("maps tool inputs to API requests and applies defaults", async () => {
    const registered = new Map<string, RegisteredTool>();
    const calls: Array<{ path: string; init?: RequestInit }> = [];
    const server: RegisterableMcpServer = {
      registerTool(name, _definition, handler) {
        registered.set(name, { name, handler });
      }
    };

    const apiRequest: ApiRequestFn = async <T>(path: string, init?: RequestInit) => {
      calls.push({ path, init });
      return { path, init } as T;
    };

    registerBrowserTools(server, apiRequest);

    const created = await registered.get("create_profile")?.handler({
      name: "Agent Profile"
    });
    expect(calls[0]?.path).toBe("/profiles");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.body).toBe(
      JSON.stringify({
        name: "Agent Profile",
        engine: "chrome",
        settings: {
          userAgent: undefined,
          headless: undefined,
          proxy: undefined
        },
        externalDataDir: undefined
      })
    );
    expect(parseTextPayload(created!)).toMatchObject({ path: "/profiles" });

    await registered.get("update_profile")?.handler({
      profileId: "11111111-1111-4111-8111-111111111111",
      engine: "msedge",
      headless: false
    });
    expect(calls[1]?.path).toBe("/profiles/11111111-1111-4111-8111-111111111111");
    expect(calls[1]?.init?.method).toBe("PATCH");

    await registered.get("ensure_gemini_profile")?.handler({});
    expect(calls[2]?.path).toBe("/profiles/ensure/gemini");
    expect(calls[2]?.init?.method).toBe("POST");
    expect(calls[2]?.init?.body).toContain('"forceUpdate":false');

    await registered.get("open_gemini_session")?.handler({});
    expect(calls[3]?.path).toBe("/control/open-gemini");
    expect(calls[3]?.init?.body).toContain('"forceUpdate":true');
    expect(calls[3]?.init?.body).toContain('"autoSetActive":true');
    expect(calls[3]?.init?.body).toContain('"targetUrl":"https://gemini.google.com/"');

    await registered.get("set_active_profile")?.handler({
      profileId: "22222222-2222-4222-8222-222222222222"
    });
    expect(calls[4]?.path).toBe("/control/active-profile");
    expect(calls[4]?.init?.body).toContain('"autoStart":true');

    await registered.get("run_active_commands")?.handler({
      commands: [{ type: "getPageState", includeTextExcerpt: true }]
    });
    expect(calls[5]?.path).toBe("/control/active/commands");
    expect(calls[5]?.init?.body).toContain('"autoStart":true');

    await registered.get("start_profile")?.handler({
      profileId: "33333333-3333-4333-8333-333333333333"
    });
    expect(calls[6]).toEqual({
      path: "/profiles/33333333-3333-4333-8333-333333333333/start",
      init: { method: "POST" }
    });

    await registered.get("stop_profile")?.handler({
      profileId: "33333333-3333-4333-8333-333333333333"
    });
    expect(calls[7]).toEqual({
      path: "/profiles/33333333-3333-4333-8333-333333333333/stop",
      init: { method: "POST" }
    });

    await registered.get("run_commands")?.handler({
      profileId: "44444444-4444-4444-8444-444444444444",
      commands: [{ type: "navigate", url: "https://example.com/" }]
    });
    expect(calls[8]?.path).toBe("/profiles/44444444-4444-4444-8444-444444444444/commands");
    expect(calls[8]?.init?.body).toContain('"autoStart":true');

    await registered.get("list_profiles")?.handler({});
    expect(calls[9]?.path).toBe("/profiles");

    await registered.get("get_control_state")?.handler({});
    expect(calls[10]?.path).toBe("/control/state");

    await registered.get("list_backups")?.handler({
      profileId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      limit: 25
    });
    expect(calls[11]?.path).toBe("/backups?profileId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa&limit=25");

    await registered.get("backup_profile")?.handler({
      profileId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      destinationDir: "C:\\backups",
      label: "nightly"
    });
    expect(calls[12]?.path).toBe("/profiles/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/backup");
    expect(calls[12]?.init?.body).toContain('"destinationDir":"C:\\\\backups"');
    expect(calls[12]?.init?.body).toContain('"label":"nightly"');

    await registered.get("restore_profile_backup")?.handler({
      profileId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      backupId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
    });
    expect(calls[13]?.path).toBe("/profiles/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/restore");
    expect(calls[13]?.init?.body).toContain('"backupId":"cccccccc-cccc-4ccc-8ccc-cccccccccccc"');
    expect(calls[13]?.init?.body).toContain('"autoStart":false');
    expect(calls[13]?.init?.body).toContain('"setActive":false');
  });

  it("rejects invalid tool input", async () => {
    const registered = new Map<string, RegisteredTool>();
    const server: RegisterableMcpServer = {
      registerTool(name, _definition, handler) {
        registered.set(name, { name, handler });
      }
    };

    const apiRequest: ApiRequestFn = async <T>() => ({} as T);
    registerBrowserTools(server, apiRequest);

    await expect(
      registered.get("get_profile")?.handler({
        profileId: "not-a-uuid"
      }) ?? Promise.resolve()
    ).rejects.toThrowError();
  });
});
