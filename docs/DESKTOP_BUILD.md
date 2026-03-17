# Desktop Build Notes

## What is included

- Electron shell that starts the API backend and opens `/app`.
- Main entry: `electron/main.cjs`

## Build Commands

- Dev desktop run: `npm run desktop:dev`
- Windows portable build: `npm run desktop:build`

## Windows Privilege Issue

Some Windows environments block symlink extraction required by electron-builder's signing helper package.

Error pattern:
- `Cannot create symbolic link : A required privilege is not held by the client.`

If this occurs:
1. Use unpacked executable: `release\win-unpacked\Codex AI Browser.exe`
2. Optional: rerun packaging from elevated terminal or with Developer Mode enabled in Windows.

