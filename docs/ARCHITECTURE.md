# Architecture

## Components

1. API Server (`src/api/server.ts`)
- Profile CRUD
- Runtime start/stop
- Command execution endpoint

2. Profile Store (`src/storage/profileStore.ts`)
- Persists profile metadata and profile directories
- Supports unlimited profile records bounded only by disk

3. Browser Runtime (`src/browser/playwrightRuntime.ts`)
- Launches persistent browser contexts by profile
- Applies per-profile proxy and user-agent settings
- Executes deterministic command set

4. MCP Server (`src/mcp.ts`)
- Exposes browser control tools to MCP-compatible clients
- Delegates to API via `API_BASE_URL`

## Data Flow

1. Agent/client calls API or MCP tool.
2. Profile metadata is resolved from persistent store.
3. Runtime starts/reuses persistent context for profile.
4. Commands execute against active page.
5. Structured results return to caller.

## State Persistence

- Profile metadata: JSON index in data directory
- Browser session state: Playwright persistent context directory (`userDataDir`)
- Artifacts (screenshots): artifact directory

