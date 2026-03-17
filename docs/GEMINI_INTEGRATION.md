# Gemini Integration

This project supports a dedicated Gemini profile that persists login state and can be controlled manually or by AI takeover.

## Profile Name

- `Gemini Persistent`

## Default Data Directory

- `C:\Users\<user>\.codex\playwright-profiles\gemini`

This matches the path used by the local `gemini-persistent-browser` skill.

## Create/Ensure Profile

CLI:

```bash
npm run profile:gemini
```

API:

```bash
POST /profiles/ensure/gemini
```

## Typical Flow

1. Run Gemini skill setup/login once.
2. Ensure profile in this project.
3. Start profile from UI/API.
4. Use Gemini manually in that browser window.
5. Set profile as active.
6. Use `run_active_commands` via MCP (or API equivalent) for AI takeover.

