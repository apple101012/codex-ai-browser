# codex-ai-browser

AI-focused, multi-profile browser runtime with:
- Persistent profile state (`userDataDir`) for unlimited local profiles
- Per-profile proxy + user-agent spoofing controls
- HTTP API for deterministic browser commands
- Active profile takeover mode (you pick the live profile, AI controls that one)
- Built-in Gemini persistent profile bootstrap
- One-shot Gemini opener (`/control/open-gemini`) for "open + set active + navigate"
- Browser control UI at `/app`
- Desktop wrapper support (Electron)
- MCP server for Codex / Claude / Gemini CLI integrations
- Testable architecture with unit and integration tests

## Why this exists

This project is designed so an AI agent can fully control browser sessions while preserving profile state safely across runs.

## Core Features

- Unlimited profile records persisted on disk
- Profile-level settings:
  - `engine` (`chromium` or `firefox`)
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
  - `POST /control/active-profile`
  - `POST /control/active/commands`
  - `POST /control/release`
- Preset profile API:
  - `POST /profiles/ensure/gemini`
  - `POST /control/open-gemini`
- MCP tools:
  - `list_profiles`
  - `get_profile`
  - `create_profile`
  - `update_profile`
  - `start_profile`
  - `stop_profile`
  - `run_commands`
  - `ensure_gemini_profile`
  - `get_control_state`
  - `set_active_profile`
  - `run_active_commands`

## Quick Start

```bash
npm install
npx playwright install chromium firefox
cp .env.example .env
npm run start
```

API default: `http://127.0.0.1:4321`
UI default: `http://127.0.0.1:4321/app`

## Run MCP Server

Start API server first, then:

```bash
npm run mcp
```

Environment variables:
- `API_BASE_URL` (default `http://127.0.0.1:4321`)
- `API_TOKEN` (must match API token if configured on server)

## Gemini Profile Setup

This project can reuse the same persistent Gemini profile path used by your `gemini-persistent-browser` skill.

```bash
npm run profile:gemini
```

Default profile path:
`C:\Users\<you>\.codex\playwright-profiles\gemini`

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
```

Current automated coverage focuses on store logic, API behavior, and command schema validation.

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
