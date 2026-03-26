import { createPistonClient, type PistonClient } from "./piston.ts";

// テスト用の秘密鍵（テスト専用、本番には使用しないこと）
export const TEST_PRIVATE_KEY = "a".repeat(64);

export const hasEnvPermission =
  (await Deno.permissions.query({ name: "env", variable: "PISTON_SERVER" }))
    .state === "granted";

const DEFAULT_PISTON_SERVER = "https://emkc.org";

export function createTestPistonClient(): PistonClient {
  const server = hasEnvPermission
    ? (Deno.env.get("PISTON_SERVER") || DEFAULT_PISTON_SERVER)
    : DEFAULT_PISTON_SERVER;
  return createPistonClient(server);
}

export async function withMockFetch(
  mockFn: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Response | Promise<Response>,
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
