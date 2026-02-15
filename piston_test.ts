import { assertEquals, assertExists } from "@std/assert";
import piston from "piston-client";

import {
  buildLanguageMap,
  buildScript,
  formatExecutionResult,
  parseRunCommand,
} from "./lib.ts";

const PISTON_SERVER = Deno.env.get("PISTON_SERVER");

// ============================================================
// Piston API 統合テスト
// ============================================================

Deno.test({
  name: "Piston - ランタイム一覧を取得できる",

  async fn() {
    const client = piston({ server: PISTON_SERVER });
    const runtimes = await client.runtimes();

    assertExists(runtimes);
    assertEquals(Array.isArray(runtimes), true);
    assertEquals(runtimes.length > 0, true);

    // 各ランタイムが必要なフィールドを持つことを確認
    for (const runtime of runtimes) {
      assertExists(runtime.language);
      assertExists(runtime.version);
    }
  },
});

Deno.test({
  name: "Piston - Python でコードを実行できる",

  async fn() {
    const client = piston({ server: PISTON_SERVER });
    const runtimes = await client.runtimes();
    const languages = buildLanguageMap(runtimes);

    assertExists(languages["python"]);

    const result = await client.execute({
      language: languages["python"].language,
      version: languages["python"].version,
      files: [{ content: "print('hello piston')" }],
      args: [],
      stdin: "",
      compileTimeout: 10000,
      runTimeout: 10000,
    });

    assertExists(result);
    assertEquals(formatExecutionResult(result), "hello piston\n");
  },
});

Deno.test({
  name: "Piston - stdin を使ったコード実行ができる",

  async fn() {
    const client = piston({ server: PISTON_SERVER });
    const runtimes = await client.runtimes();
    const languages = buildLanguageMap(runtimes);

    const result = await client.execute({
      language: languages["python"].language,
      version: languages["python"].version,
      files: [{ content: "print(input())" }],
      args: [],
      stdin: "test input",
      compileTimeout: 10000,
      runTimeout: 10000,
    });

    assertExists(result);
    assertEquals(formatExecutionResult(result), "test input\n");
  },
});

Deno.test({
  name: "Piston - コマンドライン引数を使ったコード実行ができる",

  async fn() {
    const client = piston({ server: PISTON_SERVER });
    const runtimes = await client.runtimes();
    const languages = buildLanguageMap(runtimes);

    const result = await client.execute({
      language: languages["python"].language,
      version: languages["python"].version,
      files: [{ content: "import sys\nprint(sys.argv[1])" }],
      args: ["hello_arg"],
      stdin: "",
      compileTimeout: 10000,
      runTimeout: 10000,
    });

    assertExists(result);
    assertEquals(formatExecutionResult(result), "hello_arg\n");
  },
});

Deno.test({
  name: "Piston - parseRunCommand と連携してコードを実行できる",

  async fn() {
    const client = piston({ server: PISTON_SERVER });
    const runtimes = await client.runtimes();
    const languages = buildLanguageMap(runtimes);

    const content = "/run python\n```\nprint(2 + 3)\n```";
    const parsed = parseRunCommand(content);
    assertExists(parsed);

    const lang = parsed!.language;
    assertExists(languages[lang]);

    const script = buildScript(parsed!.code, languages, lang);

    const result = await client.execute({
      language: languages[lang].language,
      version: languages[lang].version,
      files: [script],
      args: parsed!.args,
      stdin: parsed!.stdin,
      compileTimeout: 10000,
      runTimeout: 10000,
    });

    assertExists(result);
    assertEquals(formatExecutionResult(result), "5\n");
  },
});

Deno.test({
  name: "Piston - 存在しない言語でエラーメッセージを返す",

  async fn() {
    const client = piston({ server: PISTON_SERVER });

    const result = await client.execute({
      language: "nonexistent_language",
      version: "*",
      files: [{ content: "test" }],
      compileTimeout: 10000,
      runTimeout: 10000,
    });

    assertExists(result);
    // Piston はエラー時に message フィールドを返す
    assertExists(result.message);
  },
});
