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
    (input) => {
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
    () =>
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
    () => {
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
    (_input, init) => {
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
    () => new Response("rate limited", { status: 429 }),
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
    (_input, init) => {
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
    (input) => {
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

// ============================================================
// Piston API 統合テスト
// ============================================================

Deno.test({
  ignore: !hasEnvPermission,
  name: "Piston - ランタイム一覧を取得できる",

  async fn() {
    const client = createTestPistonClient();
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
  ignore: !hasEnvPermission,
  name: "Piston - Python でコードを実行できる",

  async fn() {
    const client = createTestPistonClient();
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
      runTimeout: 3000,
    });

    assertExists(result);
    assertEquals(formatExecutionResult(result), "hello piston\n");
  },
});

Deno.test({
  ignore: !hasEnvPermission,
  name: "Piston - stdin を使ったコード実行ができる",

  async fn() {
    const client = createTestPistonClient();
    const runtimes = await client.runtimes();
    const languages = buildLanguageMap(runtimes);

    const result = await client.execute({
      language: languages["python"].language,
      version: languages["python"].version,
      files: [{ content: "print(input())" }],
      args: [],
      stdin: "test input",
      compileTimeout: 10000,
      runTimeout: 3000,
    });

    assertExists(result);
    assertEquals(formatExecutionResult(result), "test input\n");
  },
});

Deno.test({
  ignore: !hasEnvPermission,
  name: "Piston - コマンドライン引数を使ったコード実行ができる",

  async fn() {
    const client = createTestPistonClient();
    const runtimes = await client.runtimes();
    const languages = buildLanguageMap(runtimes);

    const result = await client.execute({
      language: languages["python"].language,
      version: languages["python"].version,
      files: [{ content: "import sys\nprint(sys.argv[1])" }],
      args: ["hello_arg"],
      stdin: "",
      compileTimeout: 10000,
      runTimeout: 3000,
    });

    assertExists(result);
    assertEquals(formatExecutionResult(result), "hello_arg\n");
  },
});

Deno.test({
  ignore: !hasEnvPermission,
  name: "Piston - parseRunCommand と連携してコードを実行できる",

  async fn() {
    const client = createTestPistonClient();
    const runtimes = await client.runtimes();
    const languages = buildLanguageMap(runtimes);

    const content = "/run python\n```\nprint(2 + 3)\n```";
    const parsed = parseRunCommand(content);
    assertExists(parsed);
    assertEquals(parsed.type, "run");
    const cmd = parsed as RunCommand;

    assertExists(languages[cmd.language]);

    const script = buildScript(cmd.code, languages, cmd.language);

    const result = await client.execute({
      language: languages[cmd.language].language,
      version: languages[cmd.language].version,
      files: [script],
      args: cmd.args,
      stdin: cmd.stdin,
      compileTimeout: 10000,
      runTimeout: 3000,
    });

    assertExists(result);
    assertEquals(formatExecutionResult(result), "5\n");
  },
});

Deno.test({
  ignore: !hasEnvPermission,
  name: "Piston - 存在しない言語でエラーメッセージを返す",

  async fn() {
    const client = createTestPistonClient();

    const result = await client.execute({
      language: "nonexistent_language",
      version: "*",
      files: [{ content: "test" }],
      compileTimeout: 10000,
      runTimeout: 3000,
    });

    assertExists(result);
    // Piston はエラー時に message フィールドを返す
    assertExists(result.message);
  },
});
