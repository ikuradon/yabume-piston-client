import {
  assertEquals,
  assertExists,
  assertNotEquals,
} from "@std/assert";
import { getPublicKey } from "npm:nostr-tools@^1.14.0";

import {
  buildLanguageMap,
  buildHelpMessage,
  parseRunCommand,
  buildScript,
  formatExecutionResult,
  composeReplyPost,
  getSourceEvent,
  type Runtime,
  type LanguageEntry,
} from "./lib.ts";

// テスト用の秘密鍵（テスト専用、本番には使用しないこと）
const TEST_PRIVATE_KEY =
  "a".repeat(64);

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

Deno.test("buildHelpMessage - ヘルプメッセージに言語一覧が含まれる", () => {
  const languages: Record<string, LanguageEntry> = {
    javascript: { language: "javascript", version: "18.15.0" },
    python: { language: "python", version: "3.10.0" },
  };
  const message = buildHelpMessage(languages);

  assertEquals(message.includes("I RUN C0DE."), true);
  assertEquals(message.includes("/run nodejs"), true);
  assertEquals(message.includes("javascript,python"), true);
});

Deno.test("buildHelpMessage - 言語が空でもエラーにならない", () => {
  const message = buildHelpMessage({});
  assertEquals(message.includes("Supported languages: "), true);
});

// ============================================================
// parseRunCommand
// ============================================================

Deno.test("parseRunCommand - /run コマンドを正しくパースできる", () => {
  const content = "/run javascript\nconsole.log('hello');";
  const result = parseRunCommand(content);

  assertExists(result);
  assertEquals(result!.language, "javascript");
  assertEquals(result!.code, "console.log('hello');");
});

Deno.test("parseRunCommand - 複数行のコードをパースできる", () => {
  const content = "/run python\nprint('line1')\nprint('line2')\nprint('line3')";
  const result = parseRunCommand(content);

  assertExists(result);
  assertEquals(result!.language, "python");
  assertEquals(result!.code, "print('line1')\nprint('line2')\nprint('line3')");
});

Deno.test("parseRunCommand - help コマンドをパースできる", () => {
  const content = "/run help";
  const result = parseRunCommand(content);

  assertExists(result);
  assertEquals(result!.language, "help");
  assertEquals(result!.code, "");
});

Deno.test("parseRunCommand - コードなしの場合コードが空文字列になる", () => {
  const content = "/run javascript";
  const result = parseRunCommand(content);

  assertExists(result);
  assertEquals(result!.language, "javascript");
  assertEquals(result!.code, "");
});

Deno.test("parseRunCommand - 空文字列で null を返す", () => {
  const result = parseRunCommand("");
  assertEquals(result, null);
});

Deno.test("parseRunCommand - 言語名の前後の空白を除去する", () => {
  const content = "/run   python  \nprint('hello')";
  const result = parseRunCommand(content);

  assertExists(result);
  assertEquals(result!.language, "python");
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
  };

  const event = composeReplyPost("reply content", targetEvent, TEST_PRIVATE_KEY);

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
  };

  const event = composeReplyPost("test", targetEvent, TEST_PRIVATE_KEY);

  assertExists(event.sig);
  assertNotEquals(event.sig, "");
  assertExists(event.id);
  assertEquals(event.pubkey, getPublicKey(TEST_PRIVATE_KEY));
});

// ============================================================
// getSourceEvent
// ============================================================

Deno.test("getSourceEvent - e タグがない場合は null を返す", async () => {
  const mockRelay = {
    get: () => Promise.resolve(null),
  };
  const event = {
    tags: [["p", "somepubkey"]],
  };

  const result = await getSourceEvent(mockRelay, event);
  assertEquals(result, null);
});

Deno.test("getSourceEvent - e タグから参照イベントを取得できる", async () => {
  const referenceEvent = {
    id: "ref123",
    content: "/run python\nprint('hi')",
    tags: [],
  };
  const mockRelay = {
    get: (filter: { ids: string[] }) => {
      assertEquals(filter.ids, ["ref123"]);
      return Promise.resolve(referenceEvent);
    },
  };
  const event = {
    tags: [["e", "ref123"]],
  };

  const result = await getSourceEvent(mockRelay, event);
  assertEquals(result, referenceEvent);
});

Deno.test("getSourceEvent - 複数の e タグがある場合最後のものを使用する", async () => {
  const referenceEvent = { id: "ref456", content: "found", tags: [] };
  const mockRelay = {
    get: (filter: { ids: string[] }) => {
      assertEquals(filter.ids, ["ref456"]);
      return Promise.resolve(referenceEvent);
    },
  };
  const event = {
    tags: [
      ["e", "ref123"],
      ["p", "somepubkey"],
      ["e", "ref456"],
    ],
  };

  const result = await getSourceEvent(mockRelay, event);
  assertEquals(result, referenceEvent);
});
