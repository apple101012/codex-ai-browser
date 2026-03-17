# Planning Agents

This file captures "planning bot" outputs for implementation sequencing.

## Agent A: Core Runtime Planner

Focus:
- Persistent contexts, profile lifecycle, command execution API.

Plan:
1. Implement profile store.
2. Implement runtime interface + Playwright runtime.
3. Build API endpoints for command execution.
4. Add tests with in-memory runtime.

Status: Completed in this repository.

## Agent B: Security Planner

Focus:
- Public repo safety and operational hardening.

Plan:
1. Lock down git hygiene (`.gitignore`, `.env.example`).
2. Disable risky command surface by default.
3. Define production hardening checklist.
4. Add prompt-injection and policy guidance.

Status: Baseline completed; advanced policy steps pending.

## Agent C: MCP Compatibility Planner

Focus:
- Integrate with Codex/Claude/Gemini-compatible MCP clients.

Plan:
1. Implement MCP stdio server.
2. Expose profile + command tools.
3. Document client setup and env dependencies.
4. Add tool contract tests.

Status: Tooling implemented; broader interoperability tests pending.

## Execution Priority

1. Finish core reliability tests.
2. Add policy guardrails.
3. Add remote MCP transport option (Streamable HTTP).
4. Add replay/audit UI.

