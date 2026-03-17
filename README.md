# codex-ai-browser

AI-focused, multi-profile browser runtime with:
- Persistent profile state (`userDataDir`) for unlimited local profiles
- Per-profile proxy + user-agent spoofing controls
- HTTP API for deterministic browser commands
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
  - `screenshot`
  - `evaluate` (disabled by default for safety)
- MCP tools:
  - `list_profiles`
  - `get_profile`
  - `create_profile`
  - `update_profile`
  - `start_profile`
  - `stop_profile`
  - `run_commands`

## Quick Start

```bash
npm install
npx playwright install chromium firefox
cp .env.example .env
npm run start
```

API default: `http://127.0.0.1:4321`

## Run MCP Server

Start API server first, then:

```bash
npm run mcp
```

Environment variables:
- `API_BASE_URL` (default `http://127.0.0.1:4321`)
- `API_TOKEN` (must match API token if configured on server)

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

## Project Plan Artifacts

- [Architecture](./docs/ARCHITECTURE.md)
- [Security Checklist](./docs/SECURITY_CHECKLIST.md)
- [Planning Agents](./docs/planning-agents.md)

## Publishing as Public GitHub Repo

```bash
git init
git add .
git commit -m "Initial commit"
gh repo create codex-ai-browser --public --source=. --remote=origin --push
```

