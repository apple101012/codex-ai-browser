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

## AI Browser CLI (Playwright-Style, API-Backed)

If you want lower-overhead agent usage than MCP tool schemas, use the CLI wrapper:

```bash
npm run cli -- --help
```

The CLI uses concise commands (`open`, `snapshot`, `click`, `type`, `wait-*`) and calls your local API under the hood.
This keeps your existing multi-profile architecture while making agent loops more token-efficient.

Common flow:

```bash
npm run cli -- profiles use "Browser Profile"
npm run cli -- open https://labs.google/fx/tools/flow
npm run cli -- suggest
npm run cli -- prompt-type "minimal cat logo, monochrome"
npm run cli -- prompt-submit
npm run cli -- observe --until-text Done --until-text-gone Generating --screenshot-every-ms=10000 --timeout-ms=180000
npm run cli -- wait-progress --visible ".result-ready" --hidden ".spinner" --timeout-ms=30000
```

Canvas helpers:

```bash
npm run cli -- canvas-click 320 180 --origin=selector --selector="canvas"
npm run cli -- canvas-drag 24 24 180 140 --origin=selector --selector="[data-testid='canvas']"
npm run cli -- canvas-path 20,20 120,40 160,160 --origin=selector --selector="canvas"
```

Useful options:
- `--json` for full machine-readable output
- `--compact` / `--no-compact` for terse vs verbose text output
- `--api-base-url=http://127.0.0.1:4321` to point at a specific backend
- `--api-token=...` if auth is enabled
- `--auto-start` / `--no-auto-start`
- `--origin=viewport|selector` for canvas commands (`selector` means selector-relative coordinates)
- `--selector="canvas"` to anchor selector-relative canvas coordinates to a specific element
- `canvas-path` accepts positional `x,y` points plus repeated `--point=x,y`
- `click-text` now rejects destructive keywords (`delete/remove/reset/...`) unless `--allow-destructive` is passed
- `click` and `type` default to strict snapshot behavior when `--snapshot-id` is provided (use `--strict=false` to opt out)
- `observe` continuously polls live page state for reactive websites and can capture periodic screenshots with low-token text-first monitoring

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
  - `clickByText`
  - `clickRef`
  - `type`
  - `typeRef`
  - `typeIntoPrompt`
  - `submitPrompt`
  - `press`
  - `extractText`
  - `getPageState`
  - `snapshot`
  - `waitForText`
  - `mouse`
  - `mouseDrag`
  - `mousePath`
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
  - `snapshot_active_page`
  - `click_active_ref`
  - `type_active_ref`
  - `click_active_canvas`
  - `drag_active_canvas`
  - `path_active_canvas`
  - `wait_for_active_text`
  - `wait_for_active_progress`
  - `select_active_tab_by_url_prefix`
  - `get_active_page_state`
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

Optional acceleration env flags:
- `ENABLE_ACCELERATOR_EXTENSION=false` (default) keeps side-loaded extension injection disabled unless you explicitly opt in.
- `ACCELERATOR_EXTENSION_DIR=./extension/ai-browser-accelerator` controls extension path.
- `ENABLE_SNAPSHOT_CACHE=false` (default) keeps snapshot caching off unless you explicitly opt in for local experimentation.
- If the extension is unavailable or unsupported for a channel, runtime continues with the built-in cached snapshot accelerator and normal Playwright fallback.

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
7. For Playwright-style control, call `snapshot_active_page` then `click_active_ref` / `type_active_ref`.
8. If you need visual proof, call `capture_active_screenshot`, then `delete_artifact`.
9. Call `release_active_profile` when you hand control back to manual browsing.

If `ensure_active_profile` sees an older backend that lacks `/control/ensure-active`, it automatically switches to `legacy-ensure-active-fallback`.

## Canvas Automation

For drawing apps, whiteboards, signature pads, and other canvas-heavy pages, you can now drive mouse coordinates without hand-writing JSON.

- Use viewport coordinates when the canvas fills the page or the app already gives you absolute positions.
- Use selector-relative coordinates when the canvas sits inside toolbars, side panels, or nested layout containers.
- `run_active_commands` and `run_commands` accept raw `mouse`, `mouseDrag`, and `mousePath` command objects in addition to the higher-level wrappers below.
- Wrapper tools/CLI use `selector` wording for ergonomics; raw command JSON uses `origin: "element"` together with `selector`.

CLI examples:

```bash
npm run cli -- canvas-click 400 260
npm run cli -- canvas-click 48 48 --origin=selector --selector="canvas"
npm run cli -- canvas-drag 10 10 220 120 --origin=selector --selector="[data-testid='drawing-surface']"
npm run cli -- canvas-path 20,20 80,20 80,80 20,80 20,20 --origin=selector --selector="canvas"
```

MCP wrapper tools:

```json
{"tool":"click_active_canvas","input":{"x":48,"y":48,"origin":"selector","selector":"canvas"}}
{"tool":"drag_active_canvas","input":{"startX":10,"startY":10,"endX":220,"endY":120,"origin":"selector","selector":"[data-testid='drawing-surface']"}}
{"tool":"path_active_canvas","input":{"points":[{"x":20,"y":20},{"x":80,"y":20},{"x":80,"y":80},{"x":20,"y":80},{"x":20,"y":20}],"origin":"selector","selector":"canvas"}}
```

Raw `run_active_commands` example:

```json
{
  "commands": [
    {
      "type": "mousePath",
      "origin": "element",
      "selector": "canvas",
      "points": [
        { "x": 20, "y": 20 },
        { "x": 120, "y": 40 },
        { "x": 160, "y": 160 }
      ]
    }
  ]
}
```

## Canvas & Drawing Workflows

The AI browser is designed for drawing, pixel art, and whiteboard tasks on any web app. This section shows how AI agents should use the available tools efficiently.

### Token-Efficient Screenshot Hierarchy

| Tool | When to use | Token cost |
|------|-------------|------------|
| `screenshot_active_element` | See a specific canvas/widget | ~15–25 KB (vs ~85 KB full page) |
| `screenshot_active_region` | Crop by coordinates when no selector | ~15–30 KB |
| `get_canvas_pixels` | Verify pixel art programmatically | **0** (JSON only, requires `ALLOW_EVALUATE=true`) |
| `capture_active_screenshot` | Full page / general state check | ~50–100 KB |

**Rule of thumb:** Use `screenshot_active_element` for canvas inspection. Reserve full-page screenshots for when you need to see the whole UI.

### The 5-Step Canvas Drawing Protocol

Follow this for any canvas app (Piskel, Excalidraw, Miro, whiteboards, etc.):

**Step 1 — Navigate and wait for canvas**
```json
{ "type": "navigate", "url": "https://..." }
{ "type": "waitForDomState", "anyVisibleSelectors": ["canvas"], "timeoutMs": 15000 }
```

**Step 2 — ONE element screenshot to see initial state**
Use `screenshot_active_element` with the canvas selector. This is 70–82% smaller than a full screenshot.

**Step 3 — Get canvas dimensions (zero tokens)**
```json
{ "type": "getElementBounds", "selector": "canvas.drawing-canvas" }
```
Returns `{ x, y, width, height }`. Use these to calculate grid coordinates.

**Step 4 — Draw (zero screenshots)**

For pixel art grids (Piskel):
```
draw_piskel_pattern { pattern: [[1,0,...],[...]], canvasSelector: "canvas.drawing-canvas" }
```

For freehand paths (whiteboards, Excalidraw):
```json
{ "type": "mousePath", "origin": "element", "selector": "canvas",
  "points": [{"x": 50, "y": 50}, {"x": 200, "y": 100}] }
```

For horizontal/vertical lines (batch all at once):
```json
[
  { "type": "mouseDrag", "origin": "element", "selector": "canvas",
    "from": {"x": 10, "y": 10}, "to": {"x": 300, "y": 10}, "includeStateAfter": false },
  ...
]
```

**Always set `includeStateAfter: false` on all draw commands — it prevents a DOM snapshot after every stroke.**
**Always send all draw commands in ONE batch call — not one-by-one.**

**Step 5 — ONE element screenshot to verify**
Use `screenshot_active_element` again. Total: **2 screenshots** for the whole workflow.

### Coordinate System

All canvas commands support `origin: "element"` mode. In this mode, `(0, 0)` is the top-left of the matched element.

```
Canvas is 480×480px, sprite is 16×16 grid:
  cellSize = 480 / 16 = 30px
  cell(col=2, row=3) center = { x: (2 + 0.5) × 30, y: (3 + 0.5) × 30 } = { x: 75, y: 105 }
```

### App-Specific Canvas Selectors

| App | Drawing canvas selector |
|-----|------------------------|
| Piskel | `canvas.drawing-canvas` |
| Excalidraw | `.excalidraw canvas` |
| Miro | `canvas` (use `getElementBounds` to identify the right one) |
| tldraw | `canvas` or `.tl-canvas` |
| Generic HTML5 | `canvas` (first match) |

### Common Mistakes

- Taking a full screenshot after every draw command
- Setting `includeStateAfter: true` on draw commands (triggers a DOM snapshot per stroke)
- Sending one command per pixel — always batch
- Using `origin: "viewport"` when the canvas might be scrolled
- Using `canvas` selector when multiple canvases exist (use a specific class/id)

## Playwright-Style Ref Workflow (Recommended)

For Playwright MCP-like reliability, prefer refs over raw selectors:
1. `snapshot` to get stable `ref` ids for visible controls.
2. `clickRef` / `typeRef` to act on those refs.
3. `waitForText` (or another `snapshot`) to confirm state before next action.
4. Re-run `snapshot` after navigation or tab changes (refs are intentionally invalidated).
5. MCP shortcut tools are available: `snapshot_active_page`, `click_active_ref`, `type_active_ref`, `wait_for_active_text`, `wait_for_active_progress`, `select_active_tab_by_url_prefix`, `get_active_page_state`.
6. `click_active_ref`, `type_active_ref`, and `wait_for_active_text` default to `includeStateAfter=false` for speed (opt in when needed).
7. `snapshot` now returns `snapshotId`; pass it into `clickRef`/`typeRef` with `strictSnapshot:true` when you want deterministic stale-ref protection.
8. Optional snapshot caching (`ENABLE_SNAPSHOT_CACHE=true`) is available for local benchmarking experiments; keep it off unless your workload proves it faster.

Example:

```bash
curl -X POST http://127.0.0.1:4321/control/active/commands \
  -H "Content-Type: application/json" \
  -d '{
    "commands":[
      {"type":"snapshot","maxElements":80}
    ]
  }'
```

Then use returned refs:

```bash
curl -X POST http://127.0.0.1:4321/control/active/commands \
  -H "Content-Type: application/json" \
  -d '{
    "commands":[
      {"type":"typeRef","ref":"e7","text":"minimal black knight logo, flat monochrome icon"},
      {"type":"clickRef","ref":"e12"},
      {"type":"waitForText","text":"Generating","timeoutMs":12000}
    ]
  }'
```

MCP wrapper equivalents (no manual command JSON needed):
1. `snapshot_active_page` -> returns `command.data.elements` with refs (`e1`, `e2`, ...)
2. `type_active_ref` with `ref` and `text` (optionally `snapshotId` + `strictSnapshot`)
3. `click_active_ref` with `ref` (optionally `snapshotId` + `strictSnapshot`)
4. `wait_for_active_text` with `text` or `textGone`
5. `wait_for_active_progress` with selector conditions (`anyVisibleSelectors` / `allHiddenSelectors`)
6. `select_active_tab_by_url_prefix` to target the correct Flow project tab
7. `get_active_page_state` for URL/title/text/control summary

Compact output mode:
- Most MCP command tools accept `compact: true` to return smaller response payloads for faster agent parsing.

Minimal expected response shape from wrapper tools:

```json
{
  "command": {
    "type": "snapshot",
    "ok": true,
    "data": { "url": "...", "title": "...", "elements": [{ "ref": "e1" }] }
  },
  "batch": { "total": 1, "successCount": 1, "results": [{ "ok": true }] }
}
```

## API Smoke Flow (Optional)

Windows quick launcher (optional):

```bat
start-webapp.bat
```

Terminal 1 (server, PowerShell):

```powershell
cd /path/to/codex-ai-browser
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

For deployment hardening: restrict `API_TOKEN`, keep `ALLOW_EVALUATE=false` unless required, and do not expose the server port publicly without authentication.

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
