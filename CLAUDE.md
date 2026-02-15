# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Nostr bot that executes code snippets via the Piston API. Users post `/run <language>` commands on Nostr, the bot executes the code and replies with results. Also supports `/rerun` to re-execute a previous command with new args/stdin.

## Commands

### Run / Test / Lint

```bash
deno task start          # Run the bot (requires PRIVATE_KEY_HEX env var)
deno task test           # Run all tests
deno test lib_test.ts    # Run a single test file
deno test --filter "test name"  # Run a specific test by name
deno fmt                 # Format code
deno fmt --check         # Check formatting (used in CI)
deno lint                # Lint code
```

### Environment Variables

- `PRIVATE_KEY_HEX` (required): Nostr private key for signing events
- `RELAY_URL` (default: `wss://yabu.me`): Nostr relay WebSocket URL
- `PISTON_SERVER` (default: `https://emkc.org`): Piston API endpoint
- `LOG_LEVEL` (default: `INFO`): Logging level (DEBUG, INFO, WARN, ERROR)

### Piston Integration Tests

`piston_test.ts` requires a running Piston server and `--allow-env` permission:
```bash
deno test --allow-net --allow-read --allow-env piston_test.ts
```
Tests skip gracefully when `--allow-env` is not granted.

## Architecture

**Deno v2 TypeScript project** — no npm/package.json; uses `deno.json` for imports and tasks.

### Source Files

- **app.ts** — Entry point. Connects to Nostr relay, subscribes to kind-1 events, dispatches `/run` and `/rerun` commands, calls Piston, and publishes reply events.
- **lib.ts** — Pure utility functions and type definitions: command parsing (`parseRunCommand`, `parseRerunCommand`), language map building, script preparation, result formatting, reply event composition (`composeReplyPost`), and event chain traversal (`getSourceEvent`).
- **logger.ts** — Structured logging via `@std/log` with configurable level.

### Key Flow

1. Bot subscribes to Nostr relay for kind-1 text events (filtered by timestamp within 1 minute)
2. `/run <lang>` → `parseRunCommand()` → `buildScript()` → Piston execute → `formatExecutionResult()` → `composeReplyPost()` → publish to relay
3. `/rerun` → `parseRerunCommand()` → `getSourceEvent()` (follows e-tag chain to find original `/run`) → re-execute with new args/stdin

### Key Types (lib.ts)

- `NostrEvent`: Nostr protocol event structure
- `SubscribableRelay` / `Subscription`: Abstractions for testable relay interaction
- `PistonResult`: Execution result from Piston API

### Testing

Three test files with different scopes:

- **lib_test.ts** — Unit tests for all lib.ts functions (pure, no external deps)
- **relay_test.ts** — Integration tests using `@ikuradon/tsunagiya` mock relay library
- **piston_test.ts** — Integration tests against a real Piston API server (conditional)

Test patterns: `Deno.test()`, `@std/assert` assertions, mock relay via `@ikuradon/tsunagiya/testing`, `withMockRelay()` helper for setup/teardown.

## Conventions

- Language: Project documentation and comments are in Japanese
- Indentation: 2 spaces (TypeScript/JSON)
- Line endings: LF
- Nostr reply threading uses e-tags (event references) and p-tags (pubkey references)
- Emojicode is a special case in `buildScript()` requiring a `.emojic` file extension
