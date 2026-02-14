import "@std/dotenv/load";

import { getPublicKey, relayInit } from "npm:nostr-tools@^1.14.0";

import piston from "npm:piston-client@^1.0.2";

import {
  buildLanguageMap,
  buildHelpMessage,
  buildScript,
  parseRunCommand,
  parseRerunCommand,
  formatExecutionResult,
  composeReplyPost,
  getSourceEvent,
} from "./lib.ts";

const PISTON_SERVER = Deno.env.get("PISTON_SERVER");
const RELAY_URL = Deno.env.get("RELAY_URL") || "wss://yabu.me";
const PRIVATE_KEY_HEX = Deno.env.get("PRIVATE_KEY_HEX") || "";
const ACCEPT_DUR_SEC = 1 * 60;

const unixNow = () => Math.floor(Date.now() / 1000);

const pistonClient = piston({ server: PISTON_SERVER });
const runtimes = await pistonClient.runtimes();
const languages = buildLanguageMap(runtimes);
const helpMessage = buildHelpMessage(languages);

const executePiston = async (
  content: string,
  argsOverride?: string[],
  stdinOverride?: string,
): Promise<string> => {
  const parsed = parseRunCommand(content);
  if (!parsed) return "Execution error";
  const { language, code, args, stdin } = parsed;
  console.log(language);
  if (language === "help") return helpMessage;
  if (!languages[language]) return "Language not found.";

  const script = buildScript(code, languages, language);

  const result = await pistonClient.execute({
    language: languages[language].language,
    version: languages[language].version,
    files: [script],
    args: argsOverride ?? args,
    stdin: stdinOverride ?? stdin,
    compile_timeout: 10000,
    run_timeout: 10000,
  });

  return formatExecutionResult(result);
};

// deno-lint-ignore no-explicit-any
const publishToRelay = async (relay: any, ev: any) => {
  await relay
    .publish(ev)
    .then(() => console.log("post ok"))
    // deno-lint-ignore no-explicit-any
    .catch((e: any) => console.log(`post error: ${e}`));
};

try {
  const relay = relayInit(RELAY_URL);
  relay.on("error", () => {
    console.error("failed to connect");
    Deno.exit(0);
  });

  relay.connect();

  const sub = relay.sub([{ kinds: [1], since: unixNow() }]);

  // deno-lint-ignore no-explicit-any
  sub.on("event", async (ev: any) => {
    if (ev.created_at < unixNow() - ACCEPT_DUR_SEC) return false;
    if (ev.pubkey === getPublicKey(PRIVATE_KEY_HEX)) return false; // 自分の投稿は無視する

    if (ev.content.startsWith("/run")) {
      console.log("/run");
      const message = await executePiston(ev.content);
      const replyPost = composeReplyPost(message, ev, PRIVATE_KEY_HEX);
      await publishToRelay(relay, replyPost);
    } else if (ev.content.startsWith("/rerun")) {
      console.log("/rerun");
      const { args, stdin } = parseRerunCommand(ev.content);
      let sourceEvent = ev;
      while (true) {
        sourceEvent = await getSourceEvent(relay, sourceEvent);
        console.log(sourceEvent.content);
        if (sourceEvent === null) break;
        if (sourceEvent.content.startsWith("/run")) {
          break;
        }
      }
      if (sourceEvent !== null && sourceEvent.content.startsWith("/run")) {
        const message = await executePiston(
          sourceEvent.content,
          args.length > 0 ? args : undefined,
          stdin !== "" ? stdin : undefined,
        );
        const replyPost = composeReplyPost(message, ev, PRIVATE_KEY_HEX);
        await publishToRelay(relay, replyPost);
      }
    }
  });
} catch (e) {
  console.error(e);
}
