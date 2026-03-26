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
