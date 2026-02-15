import { assertEquals, assertExists, assertNotEquals } from "@std/assert";
import { getPublicKey } from "@nostr/tools/pure";
import { hexToBytes } from "@noble/hashes/utils.js";

import {
  buildHelpMessage,
  buildLanguageListMessage,
  buildLanguageMap,
  buildScript,
  composeReplyPost,
  formatExecutionResult,
  getSourceEvent,
  type LanguageEntry,
  type NostrEvent,
  parseRerunCommand,
  parseRunCommand,
  resolveSourceRunEvent,
  type RunCommand,
  type Runtime,
  type SubscribableRelay,
} from "./lib.ts";
import { TEST_PRIVATE_KEY } from "./test_helpers.ts";

// ============================================================
// buildLanguageMap
// ============================================================

Deno.test("buildLanguageMap - 基本的なランタイムでマップを構築できる", () => {
  const runtimes: Runtime[] = [
    { language: "javascript", version: "18.15.0", aliases: ["js", "node"] },
    { language: "python", version: "3.10.0", aliases: ["py"] },
  ];
  const map = buildLanguageMap(runtimes);

  assertEquals(map["javascript"], {
    language: "javascript",
    version: "18.15.0",
  });
  assertEquals(map["js"], { language: "javascript", version: "18.15.0" });
  assertEquals(map["node"], { language: "javascript", version: "18.15.0" });
  assertEquals(map["python"], { language: "python", version: "3.10.0" });
  assertEquals(map["py"], { language: "python", version: "3.10.0" });
});

Deno.test("buildLanguageMap - エイリアスなしのランタイムを処理できる", () => {
  const runtimes: Runtime[] = [
    { language: "rust", version: "1.70.0" },
  ];
  const map = buildLanguageMap(runtimes);

  assertEquals(map["rust"], { language: "rust", version: "1.70.0" });
  assertEquals(Object.keys(map).length, 1);
});

Deno.test("buildLanguageMap - 空の配列で空のマップを返す", () => {
  const map = buildLanguageMap([]);
  assertEquals(Object.keys(map).length, 0);
});

Deno.test("buildLanguageMap - 空のエイリアス配列を処理できる", () => {
  const runtimes: Runtime[] = [
    { language: "go", version: "1.21.0", aliases: [] },
  ];
  const map = buildLanguageMap(runtimes);

  assertEquals(map["go"], { language: "go", version: "1.21.0" });
  assertEquals(Object.keys(map).length, 1);
});

// ============================================================
// buildHelpMessage
// ============================================================

Deno.test("buildHelpMessage - ヘルプメッセージに /run lang 案内が含まれる", () => {
  const message = buildHelpMessage();

  assertEquals(message.includes("I RUN C0DE."), true);
  assertEquals(message.includes("/run <language>"), true);
  assertEquals(message.includes("Basic Syntax:"), true);
  assertEquals(message.includes("Legacy Syntax:"), true);
  assertEquals(message.includes("/run lang"), true);
});

Deno.test("buildHelpMessage - Rerun セクションに args/stdin 書式が含まれる", () => {
  const message = buildHelpMessage();

  assertEquals(message.includes("Rerun:"), true);
  assertEquals(message.includes("---"), true);
});

// ============================================================
// buildLanguageListMessage
// ============================================================

Deno.test("buildLanguageListMessage - 言語一覧を返す", () => {
  const languages: Record<string, LanguageEntry> = {
    javascript: { language: "javascript", version: "18.15.0" },
    python: { language: "python", version: "3.10.0" },
  };
  const message = buildLanguageListMessage(languages);

  assertEquals(message.includes("Supported languages:"), true);
  assertEquals(message.includes("javascript"), true);
  assertEquals(message.includes("python"), true);
});

Deno.test("buildLanguageListMessage - 言語が空でもエラーにならない", () => {
  const message = buildLanguageListMessage({});
  assertEquals(message, "Supported languages:\n");
});

// ============================================================
// parseRunCommand
// ============================================================

Deno.test("parseRunCommand - /run コマンドを正しくパースできる (Legacy)", () => {
  const content = "/run javascript\nconsole.log('hello');";
  const result = parseRunCommand(content);

  assertExists(result);
  assertEquals(result.type, "run");
  const cmd = result as RunCommand;
  assertEquals(cmd.language, "javascript");
  assertEquals(cmd.code, "console.log('hello');");
  assertEquals(cmd.args, []);
  assertEquals(cmd.stdin, "");
});

Deno.test("parseRunCommand - 複数行のコードをパースできる (Legacy)", () => {
  const content = "/run python\nprint('line1')\nprint('line2')\nprint('line3')";
  const result = parseRunCommand(content);

  assertExists(result);
  assertEquals(result.type, "run");
  const cmd = result as RunCommand;
  assertEquals(cmd.language, "python");
  assertEquals(cmd.code, "print('line1')\nprint('line2')\nprint('line3')");
  assertEquals(cmd.args, []);
  assertEquals(cmd.stdin, "");
});

Deno.test("parseRunCommand - help コマンドをパースできる", () => {
  const content = "/run help";
  const result = parseRunCommand(content);

  assertExists(result);
  assertEquals(result.type, "help");
});

Deno.test("parseRunCommand - lang コマンドをパースできる", () => {
  const content = "/run lang";
  const result = parseRunCommand(content);

  assertExists(result);
  assertEquals(result.type, "lang");
});

Deno.test("parseRunCommand - コードなしの場合コードが空文字列になる", () => {
  const content = "/run javascript";
  const result = parseRunCommand(content);

  assertExists(result);
  assertEquals(result.type, "run");
  const cmd = result as RunCommand;
  assertEquals(cmd.language, "javascript");
  assertEquals(cmd.code, "");
  assertEquals(cmd.args, []);
  assertEquals(cmd.stdin, "");
});

Deno.test("parseRunCommand - 空文字列で null を返す", () => {
  const result = parseRunCommand("");
  assertEquals(result, null);
});

Deno.test("parseRunCommand - 言語名の前後の空白を除去する", () => {
  const content = "/run   python  \nprint('hello')";
  const result = parseRunCommand(content);

  assertExists(result);
  assertEquals(result.type, "run");
  const cmd = result as RunCommand;
  assertEquals(cmd.language, "python");
});

// ============================================================
// buildScript
// ============================================================

Deno.test("buildScript - 通常の言語でスクリプトオブジェクトを作成できる", () => {
  const languages: Record<string, LanguageEntry> = {
    javascript: { language: "javascript", version: "18.15.0" },
  };
  const script = buildScript("console.log('hi')", languages, "javascript");

  assertEquals(script.content, "console.log('hi')");
  assertEquals(script.name, undefined);
});

Deno.test("buildScript - emojicode の場合ファイル名が設定される", () => {
  const languages: Record<string, LanguageEntry> = {
    emojicode: { language: "emojicode", version: "1.0.0" },
  };
  const script = buildScript("code here", languages, "emojicode");

  assertEquals(script.content, "code here");
  assertEquals(script.name, "file0.emojic");
});

// ============================================================
// formatExecutionResult
// ============================================================

Deno.test("formatExecutionResult - 実行成功時の出力を返す", () => {
  const result = {
    run: { output: "Hello World\n", code: 0 },
  };
  assertEquals(formatExecutionResult(result), "Hello World\n");
});

Deno.test("formatExecutionResult - コンパイルエラー時の出力を返す", () => {
  const result = {
    compile: { output: "error: expected ';'", code: 1 },
    run: { output: "", code: 0 },
  };
  assertEquals(formatExecutionResult(result), "error: expected ';'");
});

Deno.test("formatExecutionResult - コンパイル成功（code=0）の場合は実行結果を返す", () => {
  const result = {
    compile: { output: "", code: 0 },
    run: { output: "compiled output", code: 0 },
  };
  assertEquals(formatExecutionResult(result), "compiled output");
});

Deno.test("formatExecutionResult - message がある場合はそれを返す", () => {
  const result = {
    message: "Rate limit exceeded",
  };
  assertEquals(formatExecutionResult(result), "Rate limit exceeded");
});

Deno.test("formatExecutionResult - run も message もない場合はエラー文を返す", () => {
  const result = {};
  assertEquals(formatExecutionResult(result), "Execution error");
});

Deno.test("formatExecutionResult - run が null の場合はエラー文を返す", () => {
  const result = { run: null };
  assertEquals(formatExecutionResult(result), "Execution error");
});

// ============================================================
// composeReplyPost
// ============================================================

Deno.test("composeReplyPost - 正しい構造のイベントを生成する", () => {
  const targetEvent = {
    id: "abc123",
    pubkey: "def456",
    created_at: 1700000000,
  } as NostrEvent;

  const event = composeReplyPost(
    "reply content",
    targetEvent,
    TEST_PRIVATE_KEY,
  );

  assertEquals(event.kind, 1);
  assertEquals(event.content, "reply content");
  assertEquals(event.created_at, 1700000001);
  assertEquals(event.tags.length, 2);
  assertEquals(event.tags[0], ["e", "abc123"]);
  assertEquals(event.tags[1], ["p", "def456"]);
});

Deno.test("composeReplyPost - イベントに署名が付与される", () => {
  const targetEvent = {
    id: "abc123",
    pubkey: "def456",
    created_at: 1700000000,
  } as NostrEvent;

  const event = composeReplyPost("test", targetEvent, TEST_PRIVATE_KEY);

  assertExists(event.sig);
  assertNotEquals(event.sig, "");
  assertExists(event.id);
  assertEquals(event.pubkey, getPublicKey(hexToBytes(TEST_PRIVATE_KEY)));
});

// ============================================================
// getSourceEvent
// ============================================================

Deno.test("getSourceEvent - e タグがない場合は null を返す", async () => {
  const mockRelay: SubscribableRelay = {
    subscribe: () => ({ close() {} }),
  };
  const event = { tags: [["p", "somepubkey"]] } as NostrEvent;

  const result = await getSourceEvent(mockRelay, event);
  assertEquals(result, null);
});

Deno.test("getSourceEvent - e タグから参照イベントを取得できる", async () => {
  const referenceEvent = {
    id: "ref123",
    content: "/run python\nprint('hi')",
    tags: [],
  } as unknown as NostrEvent;
  const mockRelay: SubscribableRelay = {
    subscribe(filters, callbacks) {
      assertEquals(filters, [{ ids: ["ref123"] }]);
      queueMicrotask(() => {
        callbacks.onevent(referenceEvent);
        callbacks.oneose();
      });
      return { close() {} };
    },
  };
  const event = { tags: [["e", "ref123"]] } as NostrEvent;

  const result = await getSourceEvent(mockRelay, event);
  assertEquals(result, referenceEvent);
});

Deno.test("getSourceEvent - 複数の e タグがある場合最後のものを使用する", async () => {
  const referenceEvent = {
    id: "ref456",
    content: "found",
    tags: [],
  } as unknown as NostrEvent;
  const mockRelay: SubscribableRelay = {
    subscribe(filters, callbacks) {
      assertEquals(filters, [{ ids: ["ref456"] }]);
      queueMicrotask(() => {
        callbacks.onevent(referenceEvent);
        callbacks.oneose();
      });
      return { close() {} };
    },
  };
  const event = {
    tags: [
      ["e", "ref123"],
      ["p", "somepubkey"],
      ["e", "ref456"],
    ],
  } as NostrEvent;

  const result = await getSourceEvent(mockRelay, event);
  assertEquals(result, referenceEvent);
});

// ============================================================
// parseRunCommand - Basic Syntax (コードブロック記法)
// ============================================================

Deno.test("parseRunCommand - Basic Syntax: コードブロック＋argsのみ", () => {
  const content = "/run python\narg1\narg2\n```\nprint('hello')\n```";
  const result = parseRunCommand(content);

  assertExists(result);
  assertEquals(result.type, "run");
  const cmd = result as RunCommand;
  assertEquals(cmd.language, "python");
  assertEquals(cmd.args, ["arg1", "arg2"]);
  assertEquals(cmd.code, "print('hello')");
  assertEquals(cmd.stdin, "");
});

Deno.test("parseRunCommand - Basic Syntax: コードブロック＋args＋stdin", () => {
  const content =
    "/run python\narg1\narg2\n```\nprint(input())\n```\nhello world";
  const result = parseRunCommand(content);

  assertExists(result);
  assertEquals(result.type, "run");
  const cmd = result as RunCommand;
  assertEquals(cmd.language, "python");
  assertEquals(cmd.args, ["arg1", "arg2"]);
  assertEquals(cmd.code, "print(input())");
  assertEquals(cmd.stdin, "hello world");
});

Deno.test("parseRunCommand - Basic Syntax: コードブロック＋stdinのみ（argsなし）", () => {
  const content = "/run python\n```\nprint(input())\n```\ntest input";
  const result = parseRunCommand(content);

  assertExists(result);
  assertEquals(result.type, "run");
  const cmd = result as RunCommand;
  assertEquals(cmd.language, "python");
  assertEquals(cmd.args, []);
  assertEquals(cmd.code, "print(input())");
  assertEquals(cmd.stdin, "test input");
});

Deno.test("parseRunCommand - Basic Syntax: コードブロックのみ（args/stdinなし）", () => {
  const content = "/run python\n```\nprint('hello')\n```";
  const result = parseRunCommand(content);

  assertExists(result);
  assertEquals(result.type, "run");
  const cmd = result as RunCommand;
  assertEquals(cmd.language, "python");
  assertEquals(cmd.args, []);
  assertEquals(cmd.code, "print('hello')");
  assertEquals(cmd.stdin, "");
});

Deno.test("parseRunCommand - Basic Syntax: 複数行コード", () => {
  const content = "/run python\n```\nfor i in range(3):\n    print(i)\n```";
  const result = parseRunCommand(content);

  assertExists(result);
  assertEquals(result.type, "run");
  const cmd = result as RunCommand;
  assertEquals(cmd.language, "python");
  assertEquals(cmd.code, "for i in range(3):\n    print(i)");
  assertEquals(cmd.args, []);
  assertEquals(cmd.stdin, "");
});

// ============================================================
// parseRerunCommand
// ============================================================

Deno.test("parseRerunCommand - /rerun のみ（argsもstdinもなし）", () => {
  const result = parseRerunCommand("/rerun");

  assertEquals(result.args, []);
  assertEquals(result.stdin, "");
});

Deno.test("parseRerunCommand - argsのみ", () => {
  const result = parseRerunCommand("/rerun\narg1\narg2");

  assertEquals(result.args, ["arg1", "arg2"]);
  assertEquals(result.stdin, "");
});

Deno.test("parseRerunCommand - args + stdin（--- 区切り）", () => {
  const result = parseRerunCommand("/rerun\narg1\narg2\n---\nhello world");

  assertEquals(result.args, ["arg1", "arg2"]);
  assertEquals(result.stdin, "hello world");
});

Deno.test("parseRerunCommand - stdinのみ（--- 区切り）", () => {
  const result = parseRerunCommand("/rerun\n---\nhello world");

  assertEquals(result.args, []);
  assertEquals(result.stdin, "hello world");
});

Deno.test("parseRerunCommand - 複数行stdin", () => {
  const result = parseRerunCommand("/rerun\n---\nline1\nline2\nline3");

  assertEquals(result.args, []);
  assertEquals(result.stdin, "line1\nline2\nline3");
});

// ============================================================
// resolveSourceRunEvent
// ============================================================

Deno.test("resolveSourceRunEvent - チェーンをたどって /run イベントを発見できる", async () => {
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
    "run1": runEvent,
    "reply1": replyEvent,
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

  const result = await resolveSourceRunEvent(mockRelay, rerunEvent);
  assertExists(result);
  assertEquals(result!.id, "run1");
  assertEquals(result!.content, "/run python\nprint('hi')");
});

Deno.test("resolveSourceRunEvent - e タグなしで null を返す", async () => {
  const event = {
    id: "ev1",
    content: "/rerun",
    tags: [],
  } as unknown as NostrEvent;

  const mockRelay: SubscribableRelay = {
    subscribe(_filters, callbacks) {
      queueMicrotask(() => callbacks.oneose());
      return { close() {} };
    },
  };

  const result = await resolveSourceRunEvent(mockRelay, event);
  assertEquals(result, null);
});

Deno.test("resolveSourceRunEvent - maxHops 超過で null を返す", async () => {
  // 各イベントが次のイベントを参照する長いチェーン（/run に到達しない）
  const events: Record<string, NostrEvent> = {};
  for (let i = 0; i < 15; i++) {
    events[`ev${i}`] = {
      id: `ev${i}`,
      content: `reply ${i}`,
      tags: i > 0 ? [["e", `ev${i - 1}`]] : [],
    } as unknown as NostrEvent;
  }

  const startEvent = {
    id: "start",
    content: "/rerun",
    tags: [["e", "ev14"]],
  } as unknown as NostrEvent;

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

  const result = await resolveSourceRunEvent(mockRelay, startEvent, 3);
  assertEquals(result, null);
});

Deno.test("resolveSourceRunEvent - 循環参照で null を返す", async () => {
  // A -> B -> A の循環
  const eventA = {
    id: "a",
    content: "reply a",
    tags: [["e", "b"]],
  } as unknown as NostrEvent;
  const eventB = {
    id: "b",
    content: "reply b",
    tags: [["e", "a"]],
  } as unknown as NostrEvent;

  const startEvent = {
    id: "start",
    content: "/rerun",
    tags: [["e", "a"]],
  } as unknown as NostrEvent;

  const events: Record<string, NostrEvent> = {
    "a": eventA,
    "b": eventB,
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

  const result = await resolveSourceRunEvent(mockRelay, startEvent);
  assertEquals(result, null);
});
