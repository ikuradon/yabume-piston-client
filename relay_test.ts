import { assertEquals, assertExists } from "@std/assert";
import { Relay, useWebSocketImplementation } from "@nostr/tools/relay";
import { MockPool } from "@ikuradon/tsunagiya";
import { EventBuilder } from "@ikuradon/tsunagiya/testing";

import { composeReplyPost, getSourceEvent } from "./lib.ts";

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
// deno-lint-ignore no-explicit-any
async function connectRelay(url: string): Promise<any> {
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
// deno-lint-ignore no-explicit-any
async function safeClose(relay: any, ...subs: any[]): Promise<void> {
  for (const sub of subs) {
    sub?.close();
  }
  await Promise.resolve();
  relay.close();
}

// ============================================================
// getSourceEvent - mock relay 統合テスト
// ============================================================

Deno.test("getSourceEvent (relay) - mock relay から参照イベントを取得できる", async () => {
  const pool = new MockPool();
  const mockRelay = pool.relay(RELAY_URL);

  const refEvent = EventBuilder.kind1()
    .content("/run python\nprint('hello')")
    .build();
  mockRelay.store(refEvent);

  installMock(pool);
  try {
    const relay = await connectRelay(RELAY_URL);
    const event = { tags: [["e", refEvent.id]] };

    const result = await getSourceEvent(relay, event);
    assertExists(result);
    assertEquals(result!.id, refEvent.id);
    assertEquals(result!.content, "/run python\nprint('hello')");

    await safeClose(relay);
  } finally {
    uninstallMock(pool);
  }
});

Deno.test("getSourceEvent (relay) - 存在しないイベントIDの場合 null を返す", async () => {
  const pool = new MockPool();
  pool.relay(RELAY_URL);

  installMock(pool);
  try {
    const relay = await connectRelay(RELAY_URL);
    const event = { tags: [["e", "nonexistent_id"]] };

    const result = await getSourceEvent(relay, event);
    assertEquals(result, null);

    await safeClose(relay);
  } finally {
    uninstallMock(pool);
  }
});

Deno.test("getSourceEvent (relay) - 複数の e タグがある場合最後のものを使用する", async () => {
  const pool = new MockPool();
  const mockRelay = pool.relay(RELAY_URL);

  const oldEvent = EventBuilder.kind1()
    .content("old event")
    .build();
  const targetEvent = EventBuilder.kind1()
    .content("/run python\nprint('target')")
    .build();

  mockRelay.store(oldEvent);
  mockRelay.store(targetEvent);

  installMock(pool);
  try {
    const relay = await connectRelay(RELAY_URL);
    const event = {
      tags: [
        ["e", oldEvent.id],
        ["p", "somepubkey"],
        ["e", targetEvent.id],
      ],
    };

    const result = await getSourceEvent(relay, event);
    assertExists(result);
    assertEquals(result!.id, targetEvent.id);
    assertEquals(result!.content, "/run python\nprint('target')");

    await safeClose(relay);
  } finally {
    uninstallMock(pool);
  }
});

Deno.test("getSourceEvent (relay) - 返信チェーンをたどって元の /run イベントを取得できる", async () => {
  const pool = new MockPool();
  const mockRelay = pool.relay(RELAY_URL);

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

  installMock(pool);
  try {
    const relay = await connectRelay(RELAY_URL);

    // botReply から元の /run イベントをたどる
    const sourceEvent = await getSourceEvent(relay, botReply);
    assertExists(sourceEvent);
    assertEquals(sourceEvent!.id, runEvent.id);
    assertEquals(sourceEvent!.content.startsWith("/run"), true);

    await safeClose(relay);
  } finally {
    uninstallMock(pool);
  }
});

Deno.test("getSourceEvent (relay) - /rerun チェーン全体をたどって元の /run に到達できる", async () => {
  const pool = new MockPool();
  const mockRelay = pool.relay(RELAY_URL);

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

  installMock(pool);
  try {
    const relay = await connectRelay(RELAY_URL);

    // app.ts の /rerun ロジックをシミュレート
    // deno-lint-ignore no-explicit-any
    let sourceEvent: any = rerunEvent;
    while (true) {
      sourceEvent = await getSourceEvent(relay, sourceEvent);
      if (sourceEvent === null) break;
      if (sourceEvent.content.startsWith("/run")) break;
    }

    assertExists(sourceEvent);
    assertEquals(sourceEvent.content, "/run python\nprint('hello')");
    assertEquals(sourceEvent.id, runEvent.id);

    await safeClose(relay);
  } finally {
    uninstallMock(pool);
  }
});

// ============================================================
// composeReplyPost - relay 公開テスト
// ============================================================

Deno.test("composeReplyPost (relay) - mock relay にイベントを公開できる", async () => {
  const pool = new MockPool();
  const mockRelay = pool.relay(RELAY_URL);

  installMock(pool);
  try {
    const relay = await connectRelay(RELAY_URL);

    const targetEvent = EventBuilder.kind1()
      .content("test post")
      .build();

    const replyEvent = composeReplyPost(
      "reply content",
      targetEvent,
      TEST_PRIVATE_KEY,
    );

    await relay.publish(replyEvent);

    assertEquals(mockRelay.hasEvent(replyEvent.id), true);
    const received = mockRelay.findEvent(replyEvent.id);
    assertExists(received);
    assertEquals(received!.content, "reply content");

    await safeClose(relay);
  } finally {
    uninstallMock(pool);
  }
});

Deno.test("composeReplyPost (relay) - 公開イベントの e/p タグが正しい", async () => {
  const pool = new MockPool();
  const mockRelay = pool.relay(RELAY_URL);

  installMock(pool);
  try {
    const relay = await connectRelay(RELAY_URL);

    const targetEvent = EventBuilder.kind1()
      .content("original post")
      .createdAt(1700000000)
      .build();

    const replyEvent = composeReplyPost(
      "response",
      targetEvent,
      TEST_PRIVATE_KEY,
    );

    await relay.publish(replyEvent);

    const received = mockRelay.findEvent(replyEvent.id);
    assertExists(received);
    assertEquals(received!.kind, 1);
    assertEquals(received!.created_at, 1700000001);

    // e タグと p タグを検証
    // deno-lint-ignore no-explicit-any
    const eTags = received!.tags.filter((t: any) => t[0] === "e");
    // deno-lint-ignore no-explicit-any
    const pTags = received!.tags.filter((t: any) => t[0] === "p");
    assertEquals(eTags.length, 1);
    assertEquals(eTags[0][1], targetEvent.id);
    assertEquals(pTags.length, 1);
    assertEquals(pTags[0][1], targetEvent.pubkey);

    await safeClose(relay);
  } finally {
    uninstallMock(pool);
  }
});

Deno.test("composeReplyPost (relay) - 公開したイベントを再取得できる", async () => {
  const pool = new MockPool();
  pool.relay(RELAY_URL);

  installMock(pool);
  try {
    const relay = await connectRelay(RELAY_URL);

    const targetEvent = EventBuilder.kind1()
      .content("original")
      .build();

    const replyEvent = composeReplyPost(
      "bot response",
      targetEvent,
      TEST_PRIVATE_KEY,
    );

    await relay.publish(replyEvent);

    // 公開したイベントを getSourceEvent で取得できることを確認
    const queryEvent = { tags: [["e", replyEvent.id]] };
    const fetched = await getSourceEvent(relay, queryEvent);
    assertExists(fetched);
    assertEquals(fetched!.id, replyEvent.id);
    assertEquals(fetched!.content, "bot response");

    await safeClose(relay);
  } finally {
    uninstallMock(pool);
  }
});

// ============================================================
// サブスクリプション - イベントフィルタリング
// ============================================================

Deno.test("サブスクリプション - kind 1 イベントをフィルタリングして受信できる", async () => {
  const pool = new MockPool();
  const mockRelay = pool.relay(RELAY_URL);

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

  installMock(pool);
  try {
    const relay = await connectRelay(RELAY_URL);

    // app.ts と同じフィルタパターン
    // deno-lint-ignore no-explicit-any
    let sub: any;
    // deno-lint-ignore no-explicit-any
    const receivedEvents = await new Promise<any[]>((resolve) => {
      // deno-lint-ignore no-explicit-any
      const events: any[] = [];
      sub = relay.subscribe(
        [{ kinds: [1], since: now - 60 }],
        {
          // deno-lint-ignore no-explicit-any
          onevent(ev: any) {
            events.push(ev);
          },
          oneose() {
            resolve(events);
          },
        },
      );
    });

    // kind 1 のイベントのみ受信する
    assertEquals(receivedEvents.length, 1);
    assertEquals(receivedEvents[0].content, "/run python\nprint('hello')");

    await safeClose(relay, sub);
  } finally {
    uninstallMock(pool);
  }
});

Deno.test("サブスクリプション - since より古いイベントは受信しない", async () => {
  const pool = new MockPool();
  const mockRelay = pool.relay(RELAY_URL);

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

  installMock(pool);
  try {
    const relay = await connectRelay(RELAY_URL);

    // deno-lint-ignore no-explicit-any
    let sub: any;
    // deno-lint-ignore no-explicit-any
    const receivedEvents = await new Promise<any[]>((resolve) => {
      // deno-lint-ignore no-explicit-any
      const events: any[] = [];
      sub = relay.subscribe(
        [{ kinds: [1], since: now - 60 }],
        {
          // deno-lint-ignore no-explicit-any
          onevent(ev: any) {
            events.push(ev);
          },
          oneose() {
            resolve(events);
          },
        },
      );
    });

    assertEquals(receivedEvents.length, 1);
    assertEquals(receivedEvents[0].content, "new event");

    await safeClose(relay, sub);
  } finally {
    uninstallMock(pool);
  }
});

// ============================================================
// リレー検証ヘルパー
// ============================================================

Deno.test("リレー検証 - REQ メッセージの受信を確認できる", async () => {
  const pool = new MockPool();
  const mockRelay = pool.relay(RELAY_URL);

  installMock(pool);
  try {
    const relay = await connectRelay(RELAY_URL);

    // サブスクリプション前は REQ なし
    assertEquals(mockRelay.countREQs(), 0);

    // deno-lint-ignore no-explicit-any
    let sub: any;
    await new Promise<void>((resolve) => {
      sub = relay.subscribe(
        [{ kinds: [1] }],
        {
          onevent() {},
          oneose() {
            resolve();
          },
        },
      );
    });

    // サブスクリプション後は REQ が 1 つ
    assertEquals(mockRelay.countREQs(), 1);

    await safeClose(relay, sub);
  } finally {
    uninstallMock(pool);
  }
});

Deno.test("リレー検証 - EVENT メッセージの受信を確認できる", async () => {
  const pool = new MockPool();
  const mockRelay = pool.relay(RELAY_URL);

  installMock(pool);
  try {
    const relay = await connectRelay(RELAY_URL);

    assertEquals(mockRelay.countEvents(), 0);

    const targetEvent = EventBuilder.kind1().content("test").build();
    const replyEvent = composeReplyPost("reply", targetEvent, TEST_PRIVATE_KEY);
    await relay.publish(replyEvent);

    assertEquals(mockRelay.countEvents(), 1);

    await safeClose(relay);
  } finally {
    uninstallMock(pool);
  }
});

// ============================================================
// リレー障害シナリオ
// ============================================================

Deno.test("リレー障害 - 接続拒否時に Relay.connect が失敗する", async () => {
  const pool = new MockPool();
  const relay = pool.relay(RELAY_URL);
  relay.refuse();

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
  const pool = new MockPool();
  const mockRelay = pool.relay(RELAY_URL);

  installMock(pool);
  try {
    const relay = await connectRelay(RELAY_URL);

    const notices: string[] = [];
    relay.onnotice = (msg: string) => {
      notices.push(msg);
    };

    mockRelay.sendNotice("rate limit exceeded");

    // 非同期処理の完了を待つ
    await new Promise((resolve) => setTimeout(resolve, 50));

    assertEquals(notices.length, 1);
    assertEquals(notices[0], "rate limit exceeded");

    await safeClose(relay);
  } finally {
    uninstallMock(pool);
  }
});
