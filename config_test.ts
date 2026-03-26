import { assertEquals, assertThrows } from "@std/assert";
import { loadConfig, parseTimeout } from "./config.ts";

const hasEnvPerm =
  (await Deno.permissions.query({ name: "env", variable: "PRIVATE_KEY_HEX" }))
    .state === "granted";

// ============================================================
// parseTimeout
// ============================================================

Deno.test("parseTimeout - 未指定の場合フォールバック値を返す", () => {
  assertEquals(parseTimeout(undefined, 3000), 3000);
});

Deno.test("parseTimeout - 正の整数文字列を正しくパースする", () => {
  assertEquals(parseTimeout("5000", 3000), 5000);
});

Deno.test("parseTimeout - NaN の場合エラーをスローする", () => {
  assertThrows(
    () => parseTimeout("abc", 3000),
    Error,
    "タイムアウト値が不正です: abc",
  );
});

Deno.test("parseTimeout - 0 の場合エラーをスローする", () => {
  assertThrows(
    () => parseTimeout("0", 3000),
    Error,
    "タイムアウト値が不正です: 0",
  );
});

Deno.test("parseTimeout - 負数の場合エラーをスローする", () => {
  assertThrows(
    () => parseTimeout("-100", 3000),
    Error,
    "タイムアウト値が不正です: -100",
  );
});

Deno.test("parseTimeout - 空文字列の場合フォールバック値を返す", () => {
  assertEquals(parseTimeout("", 10000), 10000);
});

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
