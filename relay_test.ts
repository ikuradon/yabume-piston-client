import { assertEquals, assertExists } from "@std/assert";
import { Relay, useWebSocketImplementation } from "@nostr/tools/relay";
import { MockPool } from "@ikuradon/tsunagiya";
import { EventBuilder } from "@ikuradon/tsunagiya/testing";
import piston from "piston-client";

import {
  buildLanguageMap,
  buildScript,
  composeReplyPost,
  formatExecutionResult,
  getSourceEvent,
  type NostrEvent,
  parseRunCommand,
  type SubscribableRelay,
  type Subscription,
} from "./lib.ts";

// テスト用の秘密鍵（テスト専用、本番には使用しないこと）
const TEST_PRIVATE_KEY = "a".repeat(64);
// @nostr/tools は normalizeURL で URL を正規化する（末尾スラッシュ付与）
const RELAY_URL = "wss://test.relay/";

// @nostr/tools はモジュールロード時に WebSocket をキャプチャするため、
// pool.install() で globalThis.WebSocket を差し替えた後、
// useWebSocketImplementation() で明示的に反映する必要がある。
const originalWebSocket = globalThis.WebSocket;

function installMock(pool: MockPool): void {
  pool.install();
  useWebSocketImplementation(globalThis.WebSocket);
}

function uninstallMock(pool: MockPool): void {
  pool.uninstall();
  useWebSocketImplementation(originalWebSocket);
}

/**
 * @nostr/tools はイベント受信時に verifyEvent で署名を検証する。
 * EventBuilder のモック署名は検証に通らないため、テスト用に検証を無効化する。
 */
async function connectRelay(url: string): Promise<Relay> {
  // deno-lint-ignore no-explicit-any
  return await Relay.connect(url, { verifyEvent: () => true } as any);
}

/**
 * サブスクリプションを閉じた後にリレーを安全に閉じる。
 *
 * @nostr/tools の relay.send() は connectionPromise.then() で CLOSE メッセージを
 * 非同期送信するが、MockWebSocket.close() は readyState を即座に CLOSING に変更する。
 * sub.close() と relay.close() の間でマイクロタスクをフラッシュし、
 * CLOSE メッセージの送信を完了させる必要がある。
 */
async function safeClose(
  relay: { close(): void },
  ...subs: (Subscription | undefined)[]
): Promise<void> {
  for (const sub of subs) {
    sub?.close();
  }
  await Promise.resolve();
  relay.close();
}

type MockRelay = ReturnType<MockPool["relay"]>;

/**
 * MockPool → installMock → connectRelay → fn → safeClose → uninstallMock の
 * ボイラープレートを共通化するヘルパー。
 */
async function withMockRelay(
  fn: (relay: Relay, mockRelay: MockRelay) => Promise<void>,
): Promise<void> {
  const pool = new MockPool();
  const mockRelay = pool.relay(RELAY_URL);
  installMock(pool);
  try {
    const relay = await connectRelay(RELAY_URL);
    await fn(relay, mockRelay);
    await safeClose(relay);
  } finally {
    uninstallMock(pool);
  }
}

/**
 * サブスクリプションを開始し EOSE まで受信したイベントを収集する。
 * 呼び出し元で sub.close() を実行すること。
 */
function subscribeUntilEose(
  relay: SubscribableRelay,
  filters: Record<string, unknown>[],
): Promise<{ events: NostrEvent[]; sub: Subscription }> {
  return new Promise((resolve) => {
    const events: NostrEvent[] = [];
    const sub = relay.subscribe(filters, {
      onevent(ev: NostrEvent) {
        events.push(ev);
      },
      oneose() {
        resolve({ events, sub });
      },
    });
  });
}

// ============================================================
// getSourceEvent - mock relay 統合テスト
// ============================================================

Deno.test("getSourceEvent (relay) - mock relay から参照イベントを取得できる", async () => {
  await withMockRelay(async (relay, mockRelay) => {
    const refEvent = EventBuilder.kind1()
      .content("/run python\nprint('hello')")
      .build();
    mockRelay.store(refEvent);

    const event = { tags: [["e", refEvent.id]] } as NostrEvent;

    const result = await getSourceEvent(relay, event);
    assertExists(result);
    assertEquals(result!.id, refEvent.id);
    assertEquals(result!.content, "/run python\nprint('hello')");
  });
});

Deno.test("getSourceEvent (relay) - 存在しないイベントIDの場合 null を返す", async () => {
  await withMockRelay(async (relay) => {
    const event = { tags: [["e", "nonexistent_id"]] } as NostrEvent;

    const result = await getSourceEvent(relay, event);
    assertEquals(result, null);
  });
});

Deno.test("getSourceEvent (relay) - 複数の e タグがある場合最後のものを使用する", async () => {
  await withMockRelay(async (relay, mockRelay) => {
    const oldEvent = EventBuilder.kind1()
      .content("old event")
      .build();
    const targetEvent = EventBuilder.kind1()
      .content("/run python\nprint('target')")
      .build();

    mockRelay.store(oldEvent);
    mockRelay.store(targetEvent);

    const event = {
      tags: [
        ["e", oldEvent.id],
        ["p", "somepubkey"],
        ["e", targetEvent.id],
      ],
    } as NostrEvent;

    const result = await getSourceEvent(relay, event);
    assertExists(result);
    assertEquals(result!.id, targetEvent.id);
    assertEquals(result!.content, "/run python\nprint('target')");
  });
});

Deno.test("getSourceEvent (relay) - 返信チェーンをたどって元の /run イベントを取得できる", async () => {
  await withMockRelay(async (relay, mockRelay) => {
    // 元の /run コマンド
    const runEvent = EventBuilder.kind1()
      .content("/run python\nprint('hello')")
      .build();

    // ボットの応答（runEvent への返信）
    const botReply = EventBuilder.kind1()
      .content("hello\n")
      .tag("e", runEvent.id)
      .tag("p", runEvent.pubkey)
      .build();

    mockRelay.store(runEvent);
    mockRelay.store(botReply);

    // botReply から元の /run イベントをたどる
    const sourceEvent = await getSourceEvent(
      relay,
      botReply as NostrEvent,
    );
    assertExists(sourceEvent);
    assertEquals(sourceEvent!.id, runEvent.id);
    assertEquals(sourceEvent!.content.startsWith("/run"), true);
  });
});

Deno.test("getSourceEvent (relay) - /rerun チェーン全体をたどって元の /run に到達できる", async () => {
  await withMockRelay(async (relay, mockRelay) => {
    // 元の /run コマンド
    const runEvent = EventBuilder.kind1()
      .content("/run python\nprint('hello')")
      .build();

    // ボットの応答
    const botReply = EventBuilder.kind1()
      .content("hello\n")
      .tag("e", runEvent.id)
      .tag("p", runEvent.pubkey)
      .build();

    // ユーザーの /rerun コマンド（botReply への返信）
    const rerunEvent = EventBuilder.kind1()
      .content("/rerun\nnew_arg")
      .tag("e", botReply.id)
      .tag("p", botReply.pubkey)
      .build();

    mockRelay.store(runEvent);
    mockRelay.store(botReply);
    mockRelay.store(rerunEvent);

    // app.ts の /rerun ロジックをシミュレート
    let sourceEvent: NostrEvent | null = rerunEvent as NostrEvent;
    while (true) {
      sourceEvent = await getSourceEvent(relay, sourceEvent!);
      if (sourceEvent === null) break;
      if (sourceEvent.content.startsWith("/run")) break;
    }

    assertExists(sourceEvent);
    assertEquals(sourceEvent!.content, "/run python\nprint('hello')");
    assertEquals(sourceEvent!.id, runEvent.id);
  });
});

// ============================================================
// composeReplyPost - relay 公開テスト
// ============================================================

Deno.test("composeReplyPost (relay) - mock relay にイベントを公開できる", async () => {
  await withMockRelay(async (relay, mockRelay) => {
    const targetEvent = EventBuilder.kind1()
      .content("test post")
      .build();

    const replyEvent = composeReplyPost(
      "reply content",
      targetEvent as NostrEvent,
      TEST_PRIVATE_KEY,
    );

    await relay.publish(replyEvent);

    assertEquals(mockRelay.hasEvent(replyEvent.id), true);
    const received = mockRelay.findEvent(replyEvent.id);
    assertExists(received);
    assertEquals(received!.content, "reply content");
  });
});

Deno.test("composeReplyPost (relay) - 公開イベントの e/p タグが正しい", async () => {
  await withMockRelay(async (relay, mockRelay) => {
    const targetEvent = EventBuilder.kind1()
      .content("original post")
      .createdAt(1700000000)
      .build();

    const replyEvent = composeReplyPost(
      "response",
      targetEvent as NostrEvent,
      TEST_PRIVATE_KEY,
    );

    await relay.publish(replyEvent);

    const received = mockRelay.findEvent(replyEvent.id);
    assertExists(received);
    assertEquals(received!.kind, 1);
    assertEquals(received!.created_at, 1700000001);

    // e タグと p タグを検証
    const eTags = received!.tags.filter((t: string[]) => t[0] === "e");
    const pTags = received!.tags.filter((t: string[]) => t[0] === "p");
    assertEquals(eTags.length, 1);
    assertEquals(eTags[0][1], targetEvent.id);
    assertEquals(pTags.length, 1);
    assertEquals(pTags[0][1], targetEvent.pubkey);
  });
});

Deno.test("composeReplyPost (relay) - 公開したイベントを再取得できる", async () => {
  await withMockRelay(async (relay) => {
    const targetEvent = EventBuilder.kind1()
      .content("original")
      .build();

    const replyEvent = composeReplyPost(
      "bot response",
      targetEvent as NostrEvent,
      TEST_PRIVATE_KEY,
    );

    await relay.publish(replyEvent);

    // 公開したイベントを getSourceEvent で取得できることを確認
    const queryEvent = { tags: [["e", replyEvent.id]] } as NostrEvent;
    const fetched = await getSourceEvent(relay, queryEvent);
    assertExists(fetched);
    assertEquals(fetched!.id, replyEvent.id);
    assertEquals(fetched!.content, "bot response");
  });
});

// ============================================================
// サブスクリプション - イベントフィルタリング
// ============================================================

Deno.test("サブスクリプション - kind 1 イベントをフィルタリングして受信できる", async () => {
  await withMockRelay(async (relay, mockRelay) => {
    const now = Math.floor(Date.now() / 1000);

    // kind 1 のイベント（受信対象）
    const textEvent = EventBuilder.kind1()
      .content("/run python\nprint('hello')")
      .createdAt(now)
      .build();

    // kind 7 のイベント（フィルタで除外される）
    const reactionEvent = EventBuilder.kind7()
      .content("+")
      .createdAt(now)
      .build();

    mockRelay.store(textEvent);
    mockRelay.store(reactionEvent);

    // app.ts と同じフィルタパターン
    const { events, sub } = await subscribeUntilEose(relay, [
      { kinds: [1], since: now - 60 },
    ]);

    // kind 1 のイベントのみ受信する
    assertEquals(events.length, 1);
    assertEquals(events[0].content, "/run python\nprint('hello')");

    sub.close();
  });
});

Deno.test("サブスクリプション - since より古いイベントは受信しない", async () => {
  await withMockRelay(async (relay, mockRelay) => {
    const now = Math.floor(Date.now() / 1000);

    // 新しいイベント（受信対象）
    const newEvent = EventBuilder.kind1()
      .content("new event")
      .createdAt(now)
      .build();

    // 古いイベント（since より前なので除外）
    const oldEvent = EventBuilder.kind1()
      .content("old event")
      .createdAt(now - 120)
      .build();

    mockRelay.store(newEvent);
    mockRelay.store(oldEvent);

    const { events, sub } = await subscribeUntilEose(relay, [
      { kinds: [1], since: now - 60 },
    ]);

    assertEquals(events.length, 1);
    assertEquals(events[0].content, "new event");

    sub.close();
  });
});

// ============================================================
// リレー検証ヘルパー
// ============================================================

Deno.test("リレー検証 - REQ メッセージの受信を確認できる", async () => {
  await withMockRelay(async (relay, mockRelay) => {
    // サブスクリプション前は REQ なし
    assertEquals(mockRelay.countREQs(), 0);

    const { sub } = await subscribeUntilEose(relay, [{ kinds: [1] }]);

    // サブスクリプション後は REQ が 1 つ
    assertEquals(mockRelay.countREQs(), 1);

    sub.close();
  });
});

Deno.test("リレー検証 - EVENT メッセージの受信を確認できる", async () => {
  await withMockRelay(async (relay, mockRelay) => {
    assertEquals(mockRelay.countEvents(), 0);

    const targetEvent = EventBuilder.kind1().content("test").build();
    const replyEvent = composeReplyPost(
      "reply",
      targetEvent as NostrEvent,
      TEST_PRIVATE_KEY,
    );
    await relay.publish(replyEvent);

    assertEquals(mockRelay.countEvents(), 1);
  });
});

// ============================================================
// リレー障害シナリオ
// ============================================================

Deno.test("リレー障害 - 接続拒否時に Relay.connect が失敗する", async () => {
  const pool = new MockPool();
  const mockRelay = pool.relay(RELAY_URL);
  mockRelay.refuse();

  installMock(pool);
  try {
    let errorOccurred = false;
    try {
      await connectRelay(RELAY_URL);
    } catch {
      errorOccurred = true;
    }
    assertEquals(errorOccurred, true);
  } finally {
    uninstallMock(pool);
  }
});

Deno.test("リレー障害 - NOTICE メッセージを受信できる", async () => {
  await withMockRelay(async (relay, mockRelay) => {
    const notices: string[] = [];
    relay.onnotice = (msg: string) => {
      notices.push(msg);
    };

    mockRelay.sendNotice("rate limit exceeded");

    // 非同期処理の完了を待つ
    await new Promise((resolve) => setTimeout(resolve, 50));

    assertEquals(notices.length, 1);
    assertEquals(notices[0], "rate limit exceeded");
  });
});

// ============================================================
// E2E テスト - /run コマンドの完全なフロー
// ============================================================

const hasEnvPermission =
  (await Deno.permissions.query({ name: "env", variable: "PISTON_SERVER" }))
    .state === "granted";

Deno.test({
  name: "E2E - mock relay + Piston で /run コマンドの完全なフローを実行できる",
  ignore: !hasEnvPermission,
  async fn() {
    await withMockRelay(async (relay, mockRelay) => {
      // 1. mock relay に /run コマンドイベントを格納
      const runEvent = EventBuilder.kind1()
        .content("/run python\nprint('hello')")
        .build();
      mockRelay.store(runEvent);

      // 2. サブスクリプションでイベント受信
      const { events, sub } = await subscribeUntilEose(relay, [
        { kinds: [1] },
      ]);
      assertEquals(events.length, 1);
      const receivedEvent = events[0];
      assertEquals(receivedEvent.content, "/run python\nprint('hello')");
      sub.close();

      // 3. parseRunCommand → buildScript → piston execute → formatExecutionResult
      const parsed = parseRunCommand(receivedEvent.content);
      assertExists(parsed);

      const pistonServer = Deno.env.get("PISTON_SERVER");
      const client = piston({ server: pistonServer });
      const runtimes = await client.runtimes();
      const languages = buildLanguageMap(runtimes);
      assertExists(languages[parsed!.language]);

      const script = buildScript(parsed!.code, languages, parsed!.language);
      const result = await client.execute({
        language: languages[parsed!.language].language,
        version: languages[parsed!.language].version,
        files: [script],
        args: parsed!.args,
        stdin: parsed!.stdin,
        compileTimeout: 10000,
        runTimeout: 10000,
      });

      const message = formatExecutionResult(result);
      assertEquals(message, "hello\n");

      // 4. composeReplyPost で返信イベント作成 → relay に publish
      const replyEvent = composeReplyPost(
        message,
        receivedEvent,
        TEST_PRIVATE_KEY,
      );
      await relay.publish(replyEvent);

      // 5. mock relay 上で返信イベントの content を検証
      const received = mockRelay.findEvent(replyEvent.id);
      assertExists(received);
      assertEquals(received!.content, "hello\n");
    });
  },
});
