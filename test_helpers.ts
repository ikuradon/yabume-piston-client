import piston from "piston-client";

// テスト用の秘密鍵（テスト専用、本番には使用しないこと）
export const TEST_PRIVATE_KEY = "a".repeat(64);

export const hasEnvPermission =
  (await Deno.permissions.query({ name: "env", variable: "PISTON_SERVER" }))
    .state === "granted";

export function createPistonClient() {
  const server = hasEnvPermission ? Deno.env.get("PISTON_SERVER") : undefined;
  return piston({ server });
}
