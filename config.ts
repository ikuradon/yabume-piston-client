export interface AppConfig {
  privateKeyHex: string;
  relayUrl: string;
  pistonServer: string;
  acceptDurSec: number;
  compileTimeout: number;
  runTimeout: number;
  eventFetchTimeout: number;
}

export const parseTimeout = (
  value: string | undefined,
  fallback: number,
): number => {
  if (!value) return fallback;
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error(`タイムアウト値が不正です: ${value}`);
  }
  return parsed;
};

export function loadConfig(): AppConfig {
  const privateKeyHex = Deno.env.get("PRIVATE_KEY_HEX") || "";
  if (!/^[0-9a-fA-F]{64}$/.test(privateKeyHex)) {
    throw new Error(
      "PRIVATE_KEY_HEX は64文字の16進数文字列である必要があります",
    );
  }

  return {
    privateKeyHex,
    relayUrl: Deno.env.get("RELAY_URL") || "wss://yabu.me",
    pistonServer: Deno.env.get("PISTON_SERVER") || "https://emkc.org",
    acceptDurSec: 60,
    compileTimeout: parseTimeout(Deno.env.get("COMPILE_TIMEOUT"), 10000),
    runTimeout: parseTimeout(Deno.env.get("RUN_TIMEOUT"), 3000),
    eventFetchTimeout: parseTimeout(
      Deno.env.get("EVENT_FETCH_TIMEOUT"),
      10000,
    ),
  };
}
