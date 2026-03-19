# codex-ai-browser

AI-focused, multi-profile browser runtime with:
- Persistent profile state (`userDataDir`) for unlimited local profiles
- Per-profile proxy + user-agent spoofing controls
- HTTP API for repeatable browser commands (same request shape each run)
- Active profile takeover mode (you pick one managed profile, then AI commands target that profile)
- Built-in persistent Browser Profile bootstrap (Gemini-ready)
- Generic URL opener (`/control/open-url`) plus Gemini opener (`/control/open-gemini`)
- Optional profile backup/restore API (supports VPS-mounted backup directory)
- Browser control UI at `/app`
- Desktop wrapper support (Electron)
- MCP server for Codex / Claude / Gemini CLI integrations
- Testable architecture with unit and integration tests

## Why this exists

This project is designed so an AI agent can fully control browser sessions while preserving profile state safely across runs.

## What You Actually Run

- Start one local API server (`npm run start`).
- Start one MCP bridge (`npm run mcp`) so AI tools can call browser actions directly.
- Run one MCP-first flow: `ensure_browser_profile` -> `list_profiles` -> `ensure_active_profile` -> `run_active_commands` -> `capture_active_screenshot` -> `delete_artifact` -> `release_active_profile`.
- Use the web UI at `http://127.0.0.1:4321/app` when you want manual takeover.
- AI only controls profiles managed by this app, not random external browser windows.

## Core Features

- Unlimited profile records persisted on disk
- Profile-level settings:
  - `engine` (`chrome`, `msedge`, `chromium`, or `firefox`)
  - `userAgent`
  - `proxy` (`server`, optional auth)
  - `headless`
- Browser command API:
  - `navigate`
  - `click`
  - `type`
  - `press`
  - `extractText`
  - `getPageState`
  - `listTabs`
  - `newTab`
  - `selectTab`
  - `closeTab`
  - `getTabText`
  - `screenshot`
  - `evaluate` (disabled by default for safety)
- Control/takeover API:
  - `GET /control/state`
  - `POST /control/ensure-active`
  - `POST /control/active-profile`
  - `POST /control/active/commands`
  - `POST /control/active/screenshot`
  - `POST /control/release`
  - `POST /artifacts/delete`
- Browser profile API:
  - `POST /profiles/ensure/browser`
  - `POST /profiles/ensure/gemini`
  - `POST /profiles/stop-all`
  - `POST /profiles/:id/backup`
  - `POST /profiles/:id/restore`
  - `GET /profiles/:id/backups`
  - `GET /backups`
  - `POST /control/open-url`
  - `POST /control/open-gemini`
- MCP tools:
  - `list_profiles`
  - `get_profile`
  - `create_profile`
  - `update_profile`
  - `ensure_browser_profile`
  - `start_profile`
  - `stop_profile`
  - `run_commands`
  - `ensure_gemini_profile`
  - `get_control_state`
  - `ensure_active_profile`
  - `set_active_profile`
  - `run_active_commands`
  - `capture_active_screenshot`
  - `delete_artifact`
  - `list_backups`
  - `backup_profile`
  - `restore_profile_backup`

## Quick Start

```bash
npm install
npx playwright install chromium firefox
cp .env.example .env
npm run start
```

API default: `http://127.0.0.1:4321`
UI default: `http://127.0.0.1:4321/app`

## Web App First Run (No MCP Required)

If you want to bootstrap from the web UI first:
1. Start server: `npm run start`
2. Open `http://127.0.0.1:4321/app`
3. Click `Ensure Browser Profile` once (creates/reconciles the default managed Browser Profile)
4. Click `Start` on that profile, then `Set Active` if you want agent takeover routing to target it
5. Use `Open Gemini` or the URL/command controls in the UI

After this, MCP clients can safely attach and continue with `ensure_active_profile` and `run_active_commands`.

## Recommended First Run (MCP, End-to-End)

Use this exact order for the least ambiguity:
1. Terminal 1: start API server with `npm run start`.
2. Terminal 2: start MCP bridge with `npm run mcp` (set `API_BASE_URL` if you changed the port).
3. In your AI client, call `ensure_browser_profile` once to bootstrap the default managed profile on fresh installs.
4. Call `list_profiles` (optional quick check).
5. Call `ensure_active_profile` with:
   - `autoStart: true`
   - `setActive: true`
   - `preferRunningBrowserProfile: true`
   - `allowAnyRunningFallback: false`
6. Call `run_active_commands` with `navigate` and `getPageState` (or `getTabText`).
7. If you need visual proof, call `capture_active_screenshot`, then `delete_artifact`.
8. Call `release_active_profile` when you hand control back to manual browsing.

If `ensure_active_profile` sees an older backend that lacks `/control/ensure-active`, it automatically switches to `legacy-ensure-active-fallback`.

## API Smoke Flow (Optional)

Windows quick launcher (optional):

```bat
start-webapp.bat
```

Terminal 1 (server, PowerShell):

```powershell
cd C:/Users/Apple/Documents/Github/codex-ai-browser
npm run start
```

If `4321` is already in use, either reuse the already-running server or start a new one with a different port, for example:

```powershell
$env:PORT=4322
npm run start
```

Command Prompt equivalent:

```cmd
set PORT=4322 && npm run start
```

Terminal 2 (quick control smoke, PowerShell):

```powershell
$PORT = if ($env:PORT) { $env:PORT } else { "4321" }
$BASE_URL = "http://127.0.0.1:$PORT"

Invoke-RestMethod -Method Post -Uri "$BASE_URL/control/ensure-active" `
  -ContentType "application/json" `
  -Body '{"autoStart":true,"setActive":true,"preferRunningBrowserProfile":true,"allowAnyRunningFallback":false}'

Invoke-RestMethod -Method Post -Uri "$BASE_URL/control/active/commands" `
  -ContentType "application/json" `
  -Body '{"commands":[{"type":"navigate","url":"https://example.com"},{"type":"getPageState","includeTextExcerpt":true}]}'
```

Use safe temporary profile names for tests in shared environments (example: `fresh2-a-<timestamp>`). If you run on a non-default port, replace `4321` in later examples with your chosen port.

If routes like `/control/ensure-active`, `/control/active/screenshot`, or `/artifacts/delete` return `404`, you are likely talking to an older server build still running on that port. Stop that process and restart `npm run start` from this repo.

## Run MCP Server

Start API server first, then:

```bash
npm run mcp
```

Environment variables:
- `API_BASE_URL` (default `http://127.0.0.1:4321`)
- `API_TOKEN` (must match API token if configured on server)
- `BACKUP_DIR` (optional backup index/default snapshot directory; set this to a VPS-mounted path if desired)

## Gemini Profile Setup

This project can reuse the same persistent Gemini profile path used by your `gemini-persistent-browser` skill.

```bash
npm run profile:gemini
```

Default profile path:
`C:\Users\<you>\.codex\playwright-profiles\gemini`

For Google sign-in compatibility, managed Browser Profile presets default to `engine: "chrome"` and launch with reduced automation fingerprints.

You can also create/reconcile it through API:

```bash
curl -X POST http://127.0.0.1:4321/profiles/ensure/gemini \
  -H "Content-Type: application/json" \
  -d '{}'
```

## Takeover Flow (Manual -> AI)

1. Open UI: `http://127.0.0.1:4321/app`
2. Start profile and click `Set Active` for the browser you are currently using.
3. AI clients call `run_active_commands` (MCP) or `POST /control/active/commands` (API).
4. Use `Release Active Profile` when done.

## Third-Tab Example

Use active-profile commands:

```bash
curl -X POST http://127.0.0.1:4321/control/active/commands \
  -H "Content-Type: application/json" \
  -d '{
    "commands":[
      {"type":"listTabs"},
      {"type":"getTabText","tabIndex":2,"maxChars":6000}
    ]
  }'
```

`tabIndex` is zero-based (`0` is first tab, `1` is second tab, `2` is third tab).

## Current Browser Resolve Example

Resolve active control deterministically (reuse current active profile, else running `Browser Profile`):

```bash
curl -X POST http://127.0.0.1:4321/control/ensure-active \
  -H "Content-Type: application/json" \
  -d '{
    "autoStart":true,
    "setActive":true,
    "preferRunningBrowserProfile":true,
    "allowAnyRunningFallback":false
  }'
```

If `POST /control/ensure-active` returns `404` (older backend), `ensure_active_profile` can fall back automatically. Manual fallback:
1. `GET /control/state`
2. `GET /profiles`
3. `POST /control/active-profile` with the resolved profile id (start it first if needed)

## Visual Capture + Cleanup Example

Capture the current active profile tab as a screenshot:

```bash
curl -X POST http://127.0.0.1:4321/control/active/screenshot \
  -H "Content-Type: application/json" \
  -d '{
    "tabIndex":0,
    "fullPage":true,
    "autoDeleteAfterMs":30000
  }'
```

Delete a screenshot artifact immediately:

```bash
curl -X POST http://127.0.0.1:4321/artifacts/delete \
  -H "Content-Type: application/json" \
  -d '{
    "path":"my-temp-shot.png"
  }'
```

## Minimal API Examples

Create profile:

```bash
curl -X POST http://127.0.0.1:4321/profiles \
  -H "Content-Type: application/json" \
  -d '{
    "name":"profile-a",
    "engine":"chromium",
    "settings":{
      "userAgent":"MyUA/1.0",
      "proxy":{"server":"http://127.0.0.1:8080"}
    }
  }'
```

Run commands:

```bash
curl -X POST http://127.0.0.1:4321/profiles/<PROFILE_ID>/commands \
  -H "Content-Type: application/json" \
  -d '{
    "commands":[
      {"type":"navigate","url":"https://example.com"},
      {"type":"getPageState","includeTextExcerpt":true}
    ]
  }'
```

Create a profile backup snapshot:

```bash
curl -X POST http://127.0.0.1:4321/profiles/<PROFILE_ID>/backup \
  -H "Content-Type: application/json" \
  -d '{
    "label":"before-retest",
    "destinationDir":"D:/vps-mount/browser-backups"
  }'
```

Restore profile from backup:

```bash
curl -X POST http://127.0.0.1:4321/profiles/<PROFILE_ID>/restore \
  -H "Content-Type: application/json" \
  -d '{
    "backupId":"<BACKUP_ID>",
    "autoStart":true,
    "setActive":true
  }'
```

## Public Repo Safety Defaults

- Runtime data is gitignored (`/data/*`)
- `.env` and local secrets are gitignored
- Optional bearer-token auth via `API_TOKEN`
- `evaluate` command disabled by default (`ALLOW_EVALUATE=false`)
- Screenshots are constrained to artifact directory (no absolute path writes)

See [SECURITY.md](./SECURITY.md) for hardening guidance.

## Testing

```bash
npm run typecheck
npm run test
npm run qa:ui-subagents
```

Current automated coverage focuses on store logic, API behavior, and command schema validation.
The UI sub-agent run writes screenshots + grading reports under `artifacts/ui-subagents/`.

## Desktop App (Windows)

Run desktop app in dev:

```bash
npm run desktop:dev
```

The relaunch-loop bug was fixed by running the backend in-process inside Electron, instead of spawning the Electron executable as a child backend process.

Build Windows package:

```bash
npm run desktop:build
```

If portable packaging fails due Windows symlink privileges, use the unpacked executable in:

`release\win-unpacked\Codex AI Browser.exe`

## Project Plan Artifacts

- [Architecture](./docs/ARCHITECTURE.md)
- [Security Checklist](./docs/SECURITY_CHECKLIST.md)
- [Planning Agents](./docs/planning-agents.md)
- [Research Notes](./docs/research-notes.md)
- [Gemini Integration](./docs/GEMINI_INTEGRATION.md)
- [Desktop Build Notes](./docs/DESKTOP_BUILD.md)

## Publishing as Public GitHub Repo

```bash
git init
git add .
git commit -m "Initial commit"
gh repo create codex-ai-browser --public --source=. --remote=origin --push
```
