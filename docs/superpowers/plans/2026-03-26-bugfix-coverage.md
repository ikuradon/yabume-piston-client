# バグ修正 + カバレッジ 95%+ 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** getSourceEvent のタイムアウトバグ修正、DEFAULT_SERVER
重複解消、CLAUDE.md 更新、テストカバレッジ 95%+ 達成

**Architecture:** config.ts に eventFetchTimeout を追加し、nostr.ts の
getSourceEvent/resolveSourceRunEvent に伝播。piston.ts の DEFAULT_SERVER
を削除して server パラメータを必須化。fetch モックヘルパーで piston.ts
のユニットテストを追加。

**Tech Stack:** Deno v2, TypeScript, @nostr/tools, @std/assert

---

### Task 1: config.ts に eventFetchTimeout を追加

**Files:**

- Modify: `config.ts:1-8` (AppConfig), `config.ts:30-37` (loadConfig)
- Test: `config_test.ts`

- [ ] **Step 1: config_test.ts に eventFetchTimeout のテストを追加**

`config_test.ts` の末尾に追加:

```typescript
Deno.test("parseTimeout - EVENT_FETCH_TIMEOUT 用に大きい値もパースできる", () => {
  assertEquals(parseTimeout("15000", 10000), 15000);
});
```

- [ ] **Step 2: テストが pass することを確認**

Run: `deno test --allow-net --allow-read config_test.ts` Expected: 7 tests PASS

- [ ] **Step 3: AppConfig に eventFetchTimeout を追加**

`config.ts` の `AppConfig` インターフェースを以下に変更:

```typescript
export interface AppConfig {
  privateKeyHex: string;
  relayUrl: string;
  pistonServer: string;
  acceptDurSec: number;
  compileTimeout: number;
  runTimeout: number;
  eventFetchTimeout: number;
}
```

`loadConfig` の return 文に追加:

```typescript
eventFetchTimeout: parseTimeout(
  Deno.env.get("EVENT_FETCH_TIMEOUT"),
  10000,
),
```

- [ ] **Step 4: テストが pass することを確認**

Run: `deno test --allow-net --allow-read config_test.ts` Expected: 7 tests PASS

---

### Task 2: nostr.ts に getSourceEvent タイムアウトを実装

**Files:**

- Modify: `nostr.ts:24-44` (resolveSourceRunEvent), `nostr.ts:46-70`
  (getSourceEvent)
- Modify: `lib.ts` (再エクスポート変更不要 — シグネチャ互換)
- Create: `nostr_test.ts`

- [ ] **Step 1: nostr_test.ts を作成しタイムアウトのテストを書く**

```typescript
import { assertEquals } from "@std/assert";

import { getSourceEvent, resolveSourceRunEvent } from "./nostr.ts";
import type { NostrEvent, SubscribableRelay } from "./types.ts";

// ============================================================
// getSourceEvent — タイムアウト
// ============================================================

Deno.test("getSourceEvent - EOSE が来ない場合にタイムアウトで null を返す", async () => {
  const mockRelay: SubscribableRelay = {
    subscribe(_filters, _callbacks) {
      // oneose を呼ばない → タイムアウトすべき
      return { close() {} };
    },
  };
  const event = {
    tags: [["e", "some_id"]],
  } as NostrEvent;

  const result = await getSourceEvent(mockRelay, event, 100);
  assertEquals(result, null);
});

Deno.test("getSourceEvent - タイムアウト前に応答すれば結果を返す", async () => {
  const refEvent = {
    id: "ref1",
    content: "/run python\nprint('hi')",
    tags: [],
  } as unknown as NostrEvent;

  const mockRelay: SubscribableRelay = {
    subscribe(_filters, callbacks) {
      queueMicrotask(() => {
        callbacks.onevent(refEvent);
        callbacks.oneose();
      });
      return { close() {} };
    },
  };
  const event = { tags: [["e", "ref1"]] } as NostrEvent;

  const result = await getSourceEvent(mockRelay, event, 5000);
  assertEquals(result?.id, "ref1");
});

// ============================================================
// resolveSourceRunEvent — タイムアウト伝播
// ============================================================

Deno.test("resolveSourceRunEvent - タイムアウト付きでチェーンをたどれる", async () => {
  const runEvent = {
    id: "run1",
    content: "/run python\nprint('hi')",
    tags: [],
  } as unknown as NostrEvent;
  const replyEvent = {
    id: "reply1",
    content: "hi\n",
    tags: [["e", "run1"]],
  } as unknown as NostrEvent;
  const rerunEvent = {
    id: "rerun1",
    content: "/rerun",
    tags: [["e", "reply1"]],
  } as unknown as NostrEvent;

  const events: Record<string, NostrEvent> = {
    run1: runEvent,
    reply1: replyEvent,
  };

  const mockRelay: SubscribableRelay = {
    subscribe(filters, callbacks) {
      const id = (filters[0] as { ids: string[] }).ids[0];
      queueMicrotask(() => {
        if (events[id]) callbacks.onevent(events[id]);
        callbacks.oneose();
      });
      return { close() {} };
    },
  };

  const result = await resolveSourceRunEvent(
    mockRelay,
    rerunEvent,
    10,
    undefined,
    5000,
  );
  assertEquals(result?.id, "run1");
});

Deno.test("resolveSourceRunEvent - タイムアウトで途中離脱すると null を返す", async () => {
  const hangRelay: SubscribableRelay = {
    subscribe(_filters, _callbacks) {
      // oneose を呼ばない
      return { close() {} };
    },
  };
  const event = {
    id: "ev1",
    content: "/rerun",
    tags: [["e", "some_ref"]],
  } as unknown as NostrEvent;

  const result = await resolveSourceRunEvent(
    hangRelay,
    event,
    10,
    undefined,
    100,
  );
  assertEquals(result, null);
});
```

- [ ] **Step 2: テストが FAIL することを確認**

Run: `deno test --allow-net --allow-read nostr_test.ts` Expected: FAIL —
`getSourceEvent` は `timeoutMs`
パラメータを受け付けない、`resolveSourceRunEvent` も同様

- [ ] **Step 3: getSourceEvent にタイムアウトを実装**

`nostr.ts` の `getSourceEvent` を以下に書き換え:

```typescript
export const getSourceEvent = async (
  relay: SubscribableRelay,
  event: NostrEvent,
  timeoutMs = 10000,
): Promise<NostrEvent | null> => {
  const etags = event.tags.filter((x) => x[0] === "e");
  if (etags.length === 0) return null;
  const referenceId = etags.at(-1)![1];

  const subscribePromise = new Promise<NostrEvent | null>((resolve) => {
    let found: NostrEvent | null = null;
    const sub = relay.subscribe(
      [{ ids: [referenceId] }],
      {
        onevent(e: NostrEvent) {
          found = e;
        },
        oneose() {
          sub.close();
          resolve(found);
        },
      },
    );
  });

  const timeoutPromise = new Promise<null>((resolve) => {
    setTimeout(() => resolve(null), timeoutMs);
  });

  return await Promise.race([subscribePromise, timeoutPromise]);
};
```

- [ ] **Step 4: resolveSourceRunEvent に timeoutMs を伝播**

`nostr.ts` の `resolveSourceRunEvent` を以下に書き換え:

```typescript
export const resolveSourceRunEvent = async (
  relay: SubscribableRelay,
  event: NostrEvent,
  maxHops = 10,
  onHop?: (event: NostrEvent) => void,
  timeoutMs = 10000,
): Promise<NostrEvent | null> => {
  const visited = new Set<string>([event.id]);
  let current: NostrEvent = event;

  for (let i = 0; i < maxHops; i++) {
    const next = await getSourceEvent(relay, current, timeoutMs);
    if (next === null) return null;
    if (visited.has(next.id)) return null; // 循環検出
    visited.add(next.id);
    onHop?.(next);
    if (next.content.startsWith("/run")) return next;
    current = next;
  }

  return null; // maxHops 超過
};
```

- [ ] **Step 5: テストが PASS することを確認**

Run: `deno test --allow-net --allow-read nostr_test.ts` Expected: 4 tests PASS

- [ ] **Step 6: 既存テストが壊れていないことを確認**

Run: `deno task test` Expected: 全テスト PASS（timeoutMs のデフォルト値 10000
により既存の呼び出しはそのまま動作）

---

### Task 3: app.ts から eventFetchTimeout を渡す

**Files:**

- Modify: `app.ts:110-121`

- [ ] **Step 1: resolveSourceRunEvent の呼び出しに config.eventFetchTimeout
      を追加**

`app.ts` の `resolveSourceRunEvent` 呼び出しを以下に変更:

```typescript
const sourceEvent = await resolveSourceRunEvent(
  relay,
  ev,
  10,
  (hop) => {
    logger.debug(
      `Source event: ${hop.id.slice(0, 8)} content=${hop.content.slice(0, 50)}`,
    );
  },
  config.eventFetchTimeout,
);
```

- [ ] **Step 2: 全テストが PASS することを確認**

Run: `deno task test` Expected: 全テスト PASS

---

### Task 4: DEFAULT_SERVER 重複解消

**Files:**

- Modify: `piston.ts:13` (定数削除), `piston.ts:32-33` (パラメータ必須化)
- Modify: `test_helpers.ts:10-12`

- [ ] **Step 1: piston.ts から DEFAULT_SERVER を削除し server を必須に**

`piston.ts` から `const DEFAULT_SERVER = "https://emkc.org";`
を削除し、`createPistonClient` のシグネチャを変更:

```typescript
export function createPistonClient(
  server: string,
): PistonClient {
```

- [ ] **Step 2: test_helpers.ts を修正**

`test_helpers.ts` の `createTestPistonClient` を以下に変更:

```typescript
const DEFAULT_PISTON_SERVER = "https://emkc.org";

export function createTestPistonClient(): PistonClient {
  const server = hasEnvPermission
    ? (Deno.env.get("PISTON_SERVER") || DEFAULT_PISTON_SERVER)
    : DEFAULT_PISTON_SERVER;
  return createPistonClient(server);
}
```

- [ ] **Step 3: 全テストが PASS することを確認**

Run: `deno task test` Expected: 全テスト PASS

---

### Task 5: test_helpers.ts に withMockFetch ヘルパーを追加

**Files:**

- Modify: `test_helpers.ts`

- [ ] **Step 1: withMockFetch を追加**

`test_helpers.ts` の末尾に追加:

```typescript
export async function withMockFetch(
  mockFn: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>,
  testFn: () => Promise<void>,
): Promise<void> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFn as typeof fetch;
  try {
    await testFn();
  } finally {
    globalThis.fetch = originalFetch;
  }
}
```

- [ ] **Step 2: deno check で型エラーがないことを確認**

Run: `deno check test_helpers.ts` Expected: エラーなし

---

### Task 6: piston.ts のユニットテストを追加

**Files:**

- Modify: `piston_test.ts`

- [ ] **Step 1: piston_test.ts の先頭に import
      を追加し、ユニットテストセクションを追加**

`piston_test.ts` の import 部分に `withMockFetch`
を追加し、統合テストの前にユニットテストセクションを挿入:

```typescript
import { assertEquals, assertExists, assertRejects } from "@std/assert";

import {
  buildLanguageMap,
  buildScript,
  formatExecutionResult,
  parseRunCommand,
  type RunCommand,
} from "./lib.ts";
import {
  createTestPistonClient,
  hasEnvPermission,
  withMockFetch,
} from "./test_helpers.ts";
import { createPistonClient } from "./piston.ts";

// ============================================================
// PistonClient ユニットテスト（fetch モック）
// ============================================================

Deno.test("PistonClient - runtimes() が正常なレスポンスを返す", async () => {
  const mockRuntimes = [
    { language: "python", version: "3.10.0", aliases: ["py"] },
  ];
  await withMockFetch(
    async (input) => {
      assertEquals(String(input), "https://test.piston/api/v2/runtimes");
      return new Response(JSON.stringify(mockRuntimes), { status: 200 });
    },
    async () => {
      const client = createPistonClient("https://test.piston");
      const runtimes = await client.runtimes();
      assertEquals(runtimes.length, 1);
      assertEquals(runtimes[0].language, "python");
    },
  );
});

Deno.test("PistonClient - runtimes() が HTTP エラーで throw する", async () => {
  await withMockFetch(
    async () =>
      new Response("Internal Server Error", {
        status: 500,
        statusText: "Internal Server Error",
      }),
    async () => {
      const client = createPistonClient("https://test.piston");
      await assertRejects(
        () => client.runtimes(),
        Error,
        "Piston API error: 500 Internal Server Error",
      );
    },
  );
});

Deno.test("PistonClient - runtimes() の2回目はキャッシュを使う", async () => {
  let fetchCount = 0;
  const mockRuntimes = [{ language: "go", version: "1.21.0" }];
  await withMockFetch(
    async () => {
      fetchCount++;
      return new Response(JSON.stringify(mockRuntimes), { status: 200 });
    },
    async () => {
      const client = createPistonClient("https://test.piston");
      await client.runtimes();
      await client.runtimes();
      assertEquals(fetchCount, 1);
    },
  );
});

Deno.test("PistonClient - execute() が正常なレスポンスを返す", async () => {
  const mockResult = { run: { output: "hello\n", code: 0 } };
  await withMockFetch(
    async (_input, init) => {
      const body = JSON.parse(init?.body as string);
      assertEquals(body.language, "python");
      assertEquals(body.version, "3.10.0");
      return new Response(JSON.stringify(mockResult), { status: 200 });
    },
    async () => {
      const client = createPistonClient("https://test.piston");
      const result = await client.execute({
        language: "python",
        version: "3.10.0",
        files: [{ content: "print('hello')" }],
      });
      assertEquals(result.run?.output, "hello\n");
    },
  );
});

Deno.test("PistonClient - execute() が HTTP エラーで message を返す", async () => {
  await withMockFetch(
    async () => new Response("rate limited", { status: 429 }),
    async () => {
      const client = createPistonClient("https://test.piston");
      const result = await client.execute({
        language: "python",
        version: "3.10.0",
        files: [{ content: "print('hello')" }],
      });
      assertEquals(result.message, "rate limited");
    },
  );
});

Deno.test("PistonClient - execute() がデフォルト引数をリクエストに含める", async () => {
  await withMockFetch(
    async (_input, init) => {
      const body = JSON.parse(init?.body as string);
      assertEquals(body.stdin, "");
      assertEquals(body.args, []);
      assertEquals(body.compile_timeout, 10000);
      assertEquals(body.run_timeout, 3000);
      assertEquals(body.compile_memory_limit, -1);
      assertEquals(body.run_memory_limit, -1);
      return new Response(JSON.stringify({ run: { output: "", code: 0 } }), {
        status: 200,
      });
    },
    async () => {
      const client = createPistonClient("https://test.piston");
      await client.execute({
        language: "python",
        version: "3.10.0",
        files: [{ content: "" }],
      });
    },
  );
});

Deno.test("PistonClient - 末尾スラッシュが正規化される", async () => {
  await withMockFetch(
    async (input) => {
      assertEquals(
        String(input),
        "https://test.piston/api/v2/runtimes",
      );
      return new Response(JSON.stringify([]), { status: 200 });
    },
    async () => {
      const client = createPistonClient("https://test.piston/");
      await client.runtimes();
    },
  );
});
```

- [ ] **Step 2: テストが PASS することを確認**

Run: `deno test --allow-net --allow-read piston_test.ts` Expected: 7
ユニットテスト PASS + 6 統合テスト ignored

---

### Task 7: config_test.ts に loadConfig のテストを追加

**Files:**

- Modify: `config_test.ts`

- [ ] **Step 1: loadConfig のテストを追加**

`config_test.ts` の末尾に追加:

```typescript
import { loadConfig } from "./config.ts";

const hasEnvPerm =
  (await Deno.permissions.query({ name: "env", variable: "PRIVATE_KEY_HEX" }))
    .state === "granted";

// ============================================================
// loadConfig
// ============================================================

Deno.test({
  ignore: !hasEnvPerm,
  name: "loadConfig - 有効な PRIVATE_KEY_HEX で正常に返す",
  fn() {
    const original = Deno.env.get("PRIVATE_KEY_HEX");
    try {
      Deno.env.set("PRIVATE_KEY_HEX", "a".repeat(64));
      const config = loadConfig();
      assertEquals(config.privateKeyHex, "a".repeat(64));
      assertEquals(
        config.relayUrl,
        Deno.env.get("RELAY_URL") || "wss://yabu.me",
      );
      assertEquals(
        config.pistonServer,
        Deno.env.get("PISTON_SERVER") || "https://emkc.org",
      );
      assertEquals(config.acceptDurSec, 60);
      assertEquals(config.eventFetchTimeout, 10000);
    } finally {
      if (original) Deno.env.set("PRIVATE_KEY_HEX", original);
      else Deno.env.delete("PRIVATE_KEY_HEX");
    }
  },
});

Deno.test({
  ignore: !hasEnvPerm,
  name: "loadConfig - PRIVATE_KEY_HEX が未設定で throw",
  fn() {
    const original = Deno.env.get("PRIVATE_KEY_HEX");
    try {
      Deno.env.delete("PRIVATE_KEY_HEX");
      assertThrows(
        () => loadConfig(),
        Error,
        "PRIVATE_KEY_HEX は64文字の16進数文字列である必要があります",
      );
    } finally {
      if (original) Deno.env.set("PRIVATE_KEY_HEX", original);
    }
  },
});

Deno.test({
  ignore: !hasEnvPerm,
  name: "loadConfig - PRIVATE_KEY_HEX が短すぎると throw",
  fn() {
    const original = Deno.env.get("PRIVATE_KEY_HEX");
    try {
      Deno.env.set("PRIVATE_KEY_HEX", "abcd");
      assertThrows(
        () => loadConfig(),
        Error,
        "PRIVATE_KEY_HEX は64文字の16進数文字列である必要があります",
      );
    } finally {
      if (original) Deno.env.set("PRIVATE_KEY_HEX", original);
      else Deno.env.delete("PRIVATE_KEY_HEX");
    }
  },
});

Deno.test({
  ignore: !hasEnvPerm,
  name: "loadConfig - PRIVATE_KEY_HEX に非hex文字が含まれると throw",
  fn() {
    const original = Deno.env.get("PRIVATE_KEY_HEX");
    try {
      Deno.env.set("PRIVATE_KEY_HEX", "g".repeat(64));
      assertThrows(
        () => loadConfig(),
        Error,
        "PRIVATE_KEY_HEX は64文字の16進数文字列である必要があります",
      );
    } finally {
      if (original) Deno.env.set("PRIVATE_KEY_HEX", original);
      else Deno.env.delete("PRIVATE_KEY_HEX");
    }
  },
});

Deno.test({
  ignore: !hasEnvPerm,
  name: "loadConfig - RUN_TIMEOUT 環境変数が反映される",
  fn() {
    const origKey = Deno.env.get("PRIVATE_KEY_HEX");
    const origTimeout = Deno.env.get("RUN_TIMEOUT");
    try {
      Deno.env.set("PRIVATE_KEY_HEX", "a".repeat(64));
      Deno.env.set("RUN_TIMEOUT", "5000");
      const config = loadConfig();
      assertEquals(config.runTimeout, 5000);
    } finally {
      if (origKey) Deno.env.set("PRIVATE_KEY_HEX", origKey);
      else Deno.env.delete("PRIVATE_KEY_HEX");
      if (origTimeout) Deno.env.set("RUN_TIMEOUT", origTimeout);
      else Deno.env.delete("RUN_TIMEOUT");
    }
  },
});
```

- [ ] **Step 2: --allow-env 付きでテストが PASS することを確認**

Run: `deno test --allow-net --allow-read --allow-env config_test.ts` Expected:
12 tests PASS

- [ ] **Step 3: --allow-env なしでは loadConfig テストが ignore
      されることを確認**

Run: `deno test --allow-net --allow-read config_test.ts` Expected: 7 passed, 5
ignored

---

### Task 8: CLAUDE.md を更新

**Files:**

- Modify: `CLAUDE.md`

- [ ] **Step 1: Source Files セクションを更新**

CLAUDE.md の `### Source Files` セクションを以下に書き換え:

```markdown
### Source Files

- **app.ts** — Entry point. Connects to Nostr relay, subscribes to kind-1
  events, dispatches `/run` and `/rerun` commands, calls Piston, and publishes
  reply events.
- **types.ts** — Shared type definitions (`NostrEvent`, `RunCommand`,
  `SubscribableRelay`, etc.).
- **commands.ts** — Command parsing (`parseRunCommand`, `parseRerunCommand`).
- **nostr.ts** — Nostr operations (`composeReplyPost`, `getSourceEvent`,
  `resolveSourceRunEvent`).
- **format.ts** — Language map building, script preparation, result formatting,
  help/language list messages.
- **piston.ts** — Piston API client and related types (`Runtime`,
  `PistonResult`, `PistonClient`).
- **config.ts** — Application configuration loading and validation.
- **lib.ts** — Barrel re-export for backward compatibility (re-exports from
  types.ts, commands.ts, nostr.ts, format.ts, piston.ts).
- **logger.ts** — Structured logging via `@std/log` with configurable level.
```

- [ ] **Step 2: Environment Variables に新しい変数を追加**

`### Environment Variables` セクションを以下に書き換え:

```markdown
### Environment Variables

- `PRIVATE_KEY_HEX` (required): Nostr private key for signing events
- `RELAY_URL` (default: `wss://yabu.me`): Nostr relay WebSocket URL
- `PISTON_SERVER` (default: `https://emkc.org`): Piston API endpoint
- `LOG_LEVEL` (default: `INFO`): Logging level (DEBUG, INFO, WARN, ERROR)
- `COMPILE_TIMEOUT` (default: `10000`): Piston compile timeout in ms
- `RUN_TIMEOUT` (default: `3000`): Piston run timeout in ms
- `EVENT_FETCH_TIMEOUT` (default: `10000`): Nostr event fetch timeout in ms
```

- [ ] **Step 3: Key Types セクションを更新**

```markdown
### Key Types (types.ts, piston.ts)

- `NostrEvent`: Nostr protocol event structure
- `SubscribableRelay` / `Subscription`: Abstractions for testable relay
  interaction
- `PistonResult`: Execution result from Piston API
- `PistonClient`: Piston API client interface
```

- [ ] **Step 4: Testing セクションを更新**

```markdown
### Testing

Test files:

- **lib_test.ts** — Unit tests for utility functions (pure, no external deps)
- **config_test.ts** — Unit tests for config parsing; `loadConfig()` tests
  require `--allow-env`
- **piston_test.ts** — Unit tests (fetch mock) and integration tests against a
  real Piston API server (conditional, requires `--allow-env`)
- **nostr_test.ts** — Unit tests for Nostr operations (timeout, event traversal)
- **relay_test.ts** — Integration tests using `@ikuradon/tsunagiya` mock relay
  library
```

- [ ] **Step 5: deno fmt で整形**

Run: `deno fmt CLAUDE.md`

---

### Task 9: 最終検証

- [ ] **Step 1: 全テスト（--allow-env なし）**

Run: `deno task test` Expected: 全 PASS, 0 FAIL

- [ ] **Step 2: 全テスト（--allow-env あり、Piston サーバー指定）**

Run:
`PISTON_SERVER=https://piston.tun.app deno test --allow-net --allow-read --allow-env`
Expected: 全 PASS, 0 FAIL, 0 ignored

- [ ] **Step 3: フォーマット・lint チェック**

Run: `deno fmt --check && deno lint` Expected: エラーなし

- [ ] **Step 4: カバレッジ確認**

Run:
`deno test --allow-net --allow-read --coverage=cov_profile && deno coverage cov_profile`
Expected: 95%+ カバレッジ
