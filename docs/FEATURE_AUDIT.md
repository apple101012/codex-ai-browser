# Feature Audit

## Existing Features (Code Inventory)

### Sub-agent A: API Surface
- `GET /` redirects to `/app`
- `GET /app` serves web UI
- `GET /health`
- `GET /profiles`
- `POST /profiles` create profile
- `GET /profiles/:id` read profile + running status
- `PATCH /profiles/:id` update profile
- `DELETE /profiles/:id` delete profile
- `POST /profiles/:id/start`
- `POST /profiles/:id/stop`
- `POST /profiles/:id/visibility` show/hide browser mode
- `POST /profiles/:id/commands`
- `POST /profiles/stop-all`
- `POST /profiles/ensure/browser`
- `POST /profiles/ensure/gemini` (backward-compatible preset)
- `POST /control/open-url`
- `POST /control/open-gemini`
- `GET /control/state`
- `POST /control/active-profile`
- `POST /control/release`
- `POST /control/active/commands`

### Sub-agent B: Web UI Surface
- Save token
- Clear token
- Ensure Browser Profile preset
- Open Gemini preset
- Create profile (name, engine, optional UA, optional external data dir, optional hidden/headless)
- Refresh profile state
- Stop all profiles
- Release active profile
- Per-profile actions:
  - Start
  - Stop
  - Set Active
  - Open URL
  - Show Browser
  - Hide Browser
  - Delete
- Active-profile command panel:
  - Navigate active profile
  - List tabs
  - Set active tab
  - Read tab text

### Sub-agent C: Runtime + Commands + MCP
- Runtime commands:
  - `navigate`, `click`, `type`, `press`, `extractText`, `getPageState`, `screenshot`, `evaluate`
  - `listTabs`, `newTab`, `selectTab`, `closeTab`, `getTabText`
- Multi-profile runtime isolation
- Persistent profile storage and managed/unmanaged data dirs
- MCP tools:
  - `list_profiles`, `get_profile`, `create_profile`, `update_profile`
  - `ensure_gemini_profile`, `open_gemini_session`
  - `start_profile`, `stop_profile`, `run_commands`
  - `get_control_state`, `set_active_profile`, `run_active_commands`

## Candidate Features (Could Be Added)
- Import/export profile definitions (without secrets)
- Profile tags/groups and bulk actions by group
- Per-profile startup URL templates
- Optional profile-level command allowlists (safety policy)
- Better inline error detail panel with last request/response id
- Per-profile activity timeline (start/stop/command history)
- Soft-delete + restore profile
- Health watchdog for external browser disconnect with UI toast notifications

## Current High-Priority Behavior Fixes Included
- Closing the last visible browser tab/window now marks the profile session stopped in runtime state.
- Show/Hide browser mode is available from the UI and persisted per profile.
- Root URL now redirects to `/app`.
- Local runtime/profile artifacts are ignored by git.
