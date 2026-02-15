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
import { logger } from "./logger.ts";

const PISTON_SERVER = Deno.env.get("PISTON_SERVER") || "https://emkc.org";
const RELAY_URL = Deno.env.get("RELAY_URL") || "wss://yabu.me";
const PRIVATE_KEY_HEX = Deno.env.get("PRIVATE_KEY_HEX") || "";
const ACCEPT_DUR_SEC = 1 * 60;

const unixNow = () => Math.floor(Date.now() / 1000);

logger.info(`Starting... piston=${PISTON_SERVER} relay=${RELAY_URL}`);

const pistonClient = piston({ server: PISTON_SERVER });
const runtimes = await pistonClient.runtimes();
const languages = buildLanguageMap(runtimes);
const helpMessage = buildHelpMessage();

logger.info(`Loaded ${runtimes.length} runtimes`);

const executePiston = async (
  content: string,
  argsOverride?: string[],
  stdinOverride?: string,
): Promise<string> => {
  const parsed = parseRunCommand(content);
  if (!parsed) return "Execution error";
  const { language, code, args, stdin } = parsed;
  logger.debug(`Language: ${language}`);
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
    logger.info(`Published reply event=${ev.id.slice(0, 8)}`);
  } catch (e) {
    logger.error(`Publish failed: ${e}`);
  }
};

try {
  const secretKey = hexToBytes(PRIVATE_KEY_HEX);
  const relay = await Relay.connect(RELAY_URL);

  logger.info(`Connected to relay: ${RELAY_URL}`);

  relay.subscribe([{ kinds: [1], since: unixNow() }], {
    async onevent(ev: NostrEvent) {
      if (ev.created_at < unixNow() - ACCEPT_DUR_SEC) return;
      if (ev.pubkey === getPublicKey(secretKey)) return; // 自分の投稿は無視する

      if (ev.content.startsWith("/run")) {
        logger.info(
          `Received /run from ${ev.pubkey.slice(0, 8)} event=${
            ev.id.slice(0, 8)
          }`,
        );
        const message = await executePiston(ev.content);
        const replyPost = composeReplyPost(message, ev, PRIVATE_KEY_HEX);
        await publishToRelay(relay, replyPost);
      } else if (ev.content.startsWith("/rerun")) {
        logger.info(
          `Received /rerun from ${ev.pubkey.slice(0, 8)} event=${
            ev.id.slice(0, 8)
          }`,
        );
        const { args, stdin } = parseRerunCommand(ev.content);
        let sourceEvent = ev;
        while (true) {
          sourceEvent = await getSourceEvent(relay, sourceEvent);
          if (sourceEvent === null) break;
          logger.debug(
            `Source event: ${sourceEvent.id.slice(0, 8)} content=${
              sourceEvent.content.slice(0, 50)
            }`,
          );
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
  logger.critical(`Fatal: ${e}`);
}
