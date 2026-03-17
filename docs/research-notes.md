# Research Notes (Primary Sources)

## 1) Persistent profile sessions

Source:
- Playwright `launchPersistentContext` docs:
  - https://playwright.dev/docs/api/class-browsertype#browser-type-launch-persistent-context

Takeaway:
- Playwright supports persistent browser contexts through a `userDataDir`, which is the foundation for saved profile state across runs.

## 2) MCP compatibility path

Sources:
- MCP spec landing page:
  - https://modelcontextprotocol.io/specification/2025-06-18
- MCP TypeScript SDK:
  - https://github.com/modelcontextprotocol/typescript-sdk

Takeaway:
- MCP server tooling over stdio/HTTP is standardized, so exposing profile/control tools via MCP is the right compatibility layer for Codex/Claude/Gemini-style clients.

## 3) Implementation direction

Takeaway:
- Best practical architecture is:
  - Persistent runtime (Playwright)
  - Deterministic command API
  - MCP wrapper over API
  - Security defaults (disabled eval, optional auth, isolated profile storage)

