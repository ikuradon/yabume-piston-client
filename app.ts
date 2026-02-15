import "@std/dotenv/load";

import { getPublicKey } from "@nostr/tools/pure";
import { Relay } from "@nostr/tools/relay";
import { hexToBytes } from "@noble/hashes/utils.js";

import piston from "piston-client";

import {
  buildHelpMessage,
  buildLanguageListMessage,
  buildLanguageMap,
  buildScript,
  composeReplyPost,
  formatExecutionResult,
  getSourceEvent,
  type NostrEvent,
  parseRerunCommand,
  parseRunCommand,
} from "./lib.ts";

const PISTON_SERVER = Deno.env.get("PISTON_SERVER");
const RELAY_URL = Deno.env.get("RELAY_URL") || "wss://yabu.me";
const PRIVATE_KEY_HEX = Deno.env.get("PRIVATE_KEY_HEX") || "";
const ACCEPT_DUR_SEC = 1 * 60;

const unixNow = () => Math.floor(Date.now() / 1000);

const pistonClient = piston({ server: PISTON_SERVER });
const runtimes = await pistonClient.runtimes();
const languages = buildLanguageMap(runtimes);
const helpMessage = buildHelpMessage();

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
  if (language === "lang") return buildLanguageListMessage(languages);
  if (!languages[language]) {
    return "Language not found.\n\n" + buildLanguageListMessage(languages);
  }

  const script = buildScript(code, languages, language);

  const result = await pistonClient.execute({
    language: languages[language].language,
    version: languages[language].version,
    files: [script],
    args: argsOverride ?? args,
    stdin: stdinOverride ?? stdin,
    compileTimeout: 10000,
    runTimeout: 10000,
  });

  return formatExecutionResult(result);
};

const publishToRelay = async (relay: Relay, ev: NostrEvent) => {
  try {
    await relay.publish(ev);
    console.log("post ok");
  } catch (e) {
    console.log(`post error: ${e}`);
  }
};

try {
  const secretKey = hexToBytes(PRIVATE_KEY_HEX);
  const relay = await Relay.connect(RELAY_URL);

  relay.subscribe([{ kinds: [1], since: unixNow() }], {
    async onevent(ev: NostrEvent) {
      if (ev.created_at < unixNow() - ACCEPT_DUR_SEC) return;
      if (ev.pubkey === getPublicKey(secretKey)) return; // 自分の投稿は無視する

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
          if (sourceEvent === null) break;
          console.log(sourceEvent.content);
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
    },
  });
} catch (e) {
  console.error(e);
}
