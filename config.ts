export interface AppConfig {
  privateKeyHex: string;
  relayUrl: string;
  pistonServer: string;
  acceptDurSec: number;
  compileTimeout: number;
  runTimeout: number;
}

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
    compileTimeout: 10000,
    runTimeout: 10000,
  };
}
