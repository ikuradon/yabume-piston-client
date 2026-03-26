# バグ修正 + カバレッジ 95%+ 設計

## 概要

コードレビューで発見された5件の問題を修正し、テストカバレッジを95%以上に引き上げる。

## 1. `getSourceEvent` タイムアウト追加

### 問題

`nostr.ts:54-68` — `getSourceEvent` は `oneose` コールバックでのみ resolve する
Promise を使用。リレーが EOSE を返さない場合、Promise が永久にハングする。

### 設計

- `config.ts` の `AppConfig` に `eventFetchTimeout: number` を追加
  - 環境変数: `EVENT_FETCH_TIMEOUT`
  - デフォルト: 10000 (10秒)
  - `parseTimeout` で検証
- `nostr.ts` の `getSourceEvent` に `timeoutMs: number` パラメータを追加
  - `Promise.race([subscribePromise, timeoutPromise])` で実装
  - タイムアウト時は `sub.close()` してから `null` を返す
- `resolveSourceRunEvent` にも `timeoutMs` を伝播
- `app.ts` から `config.eventFetchTimeout` を渡す

## 2. `DEFAULT_SERVER` 重複解消

### 問題

`piston.ts:13` と `config.ts:33` の両方に `"https://emkc.org"`
がハードコードされている。

### 設計

- `piston.ts` から `DEFAULT_SERVER` 定数を削除
- `createPistonClient(server)` の `server`
  パラメータを必須に変更（デフォルト値なし）
- `config.ts` が唯一のデフォルト定義元
- `test_helpers.ts` ではテスト側で明示的にサーバーURLを渡す

## 3. CLAUDE.md 更新

### 変更内容

- Source Files セクション: 新モジュール（`types.ts`, `commands.ts`, `nostr.ts`,
  `format.ts`, `piston.ts`, `config.ts`）を追加。`lib.ts`
  の説明をバレル再エクスポートに修正
- Environment Variables: `COMPILE_TIMEOUT`, `RUN_TIMEOUT`, `EVENT_FETCH_TIMEOUT`
  を追加
- Testing: `config_test.ts` を追加（4つのテストファイル）

## 4. テスト追加

### fetch モックヘルパー

`test_helpers.ts` に `withMockFetch(mockFn, testFn)` を追加:

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

### config_test.ts 拡充

`loadConfig()` のテスト追加:

- 有効な PRIVATE_KEY_HEX で正常に AppConfig を返す
- 不正な PRIVATE_KEY_HEX（短すぎ、非hex）で throw
- 未設定の PRIVATE_KEY_HEX で throw
- RELAY_URL / PISTON_SERVER / EVENT_FETCH_TIMEOUT のデフォルト値検証
- COMPILE_TIMEOUT / RUN_TIMEOUT 環境変数の統合パス

注: `loadConfig` は `Deno.env.get` を使うため `--allow-env` が必要。テストの
`ignore` フラグで管理。

### piston_test.ts にユニットテスト追加

`withMockFetch` を使用:

- `runtimes()` 正常レスポンス → Runtime[] を返す
- `runtimes()` HTTP エラー → Error を throw
- `runtimes()` 2回目呼び出し → fetch が1回のみ（キャッシュ検証）
- `execute()` 正常レスポンス → PistonResult を返す
- `execute()` HTTP エラー → `{ message: ... }` を返す
- `execute()` デフォルト引数がリクエストボディに含まれる

### nostr_test.ts 新規作成

タイムアウト関連テスト:

- `getSourceEvent` — EOSE が来ない場合にタイムアウトで null を返す
- `getSourceEvent` — タイムアウト前に正常応答すれば結果を返す
- `resolveSourceRunEvent` — タイムアウト付きで正常にチェーンを辿れる

## 成功基準

- `deno task test` で全テスト pass
- `PISTON_SERVER=https://piston.tun.app deno test --allow-net --allow-read --allow-env`
  で全テスト pass（0 ignored）
- `deno fmt --check` pass
- `deno lint` pass
- テストカバレッジ 95%+
