import "@std/dotenv/load";

import { getPublicKey } from "@nostr/tools/pure";
import { Relay } from "@nostr/tools/relay";
import { hexToBytes } from "@noble/hashes/utils.js";

import piston from "piston-client";

import { loadConfig } from "./config.ts";
import {
  buildHelpMessage,
  buildLanguageListMessage,
  buildLanguageMap,
  buildScript,
  composeReplyPost,
  formatExecutionResult,
  type NostrEvent,
  parseRerunCommand,
  parseRunCommand,
  resolveSourceRunEvent,
  type RunCommand,
} from "./lib.ts";
import { logger } from "./logger.ts";

const unixNow = () => Math.floor(Date.now() / 1000);

try {
  const config = loadConfig();

  logger.info(
    `Starting... piston=${config.pistonServer} relay=${config.relayUrl}`,
  );

  const pistonClient = piston({ server: config.pistonServer });
  const runtimes = await pistonClient.runtimes();
  const languages = buildLanguageMap(runtimes);
  const helpMessage = buildHelpMessage();

  logger.info(`Loaded ${runtimes.length} runtimes`);

  const executePiston = async (
    cmd: RunCommand,
    argsOverride?: string[],
    stdinOverride?: string,
  ): Promise<string> => {
    logger.debug(`Language: ${cmd.language}`);
    if (!languages[cmd.language]) {
      return "Language not found.\n\n" + buildLanguageListMessage(languages);
    }

    const script = buildScript(cmd.code, languages, cmd.language);

    const result = await pistonClient.execute({
      language: languages[cmd.language].language,
      version: languages[cmd.language].version,
      files: [script],
      args: argsOverride ?? cmd.args,
      stdin: stdinOverride ?? cmd.stdin,
      compileTimeout: config.compileTimeout,
      runTimeout: config.runTimeout,
    });

    return formatExecutionResult(result);
  };

  const dispatchRunCommand = async (content: string): Promise<string> => {
    const parsed = parseRunCommand(content);
    if (!parsed) return "Execution error";
    if (parsed.type === "help") return helpMessage;
    if (parsed.type === "lang") return buildLanguageListMessage(languages);
    return await executePiston(parsed);
  };

  const publishToRelay = async (relay: Relay, ev: NostrEvent) => {
    try {
      await relay.publish(ev);
      logger.info(`Published reply event=${ev.id.slice(0, 8)}`);
    } catch (e) {
      logger.error(`Publish failed: ${e}`);
    }
  };

  const secretKey = hexToBytes(config.privateKeyHex);
  const relay = await Relay.connect(config.relayUrl);

  logger.info(`Connected to relay: ${config.relayUrl}`);

  relay.subscribe([{ kinds: [1], since: unixNow() }], {
    async onevent(ev: NostrEvent) {
      if (ev.created_at < unixNow() - config.acceptDurSec) return;
      if (ev.pubkey === getPublicKey(secretKey)) return; // 自分の投稿は無視する

      if (ev.content.startsWith("/run")) {
        logger.info(
          `Received /run from ${ev.pubkey.slice(0, 8)} event=${
            ev.id.slice(0, 8)
          }`,
        );
        const message = await dispatchRunCommand(ev.content);
        const replyPost = composeReplyPost(message, ev, config.privateKeyHex);
        await publishToRelay(relay, replyPost);
      } else if (ev.content.startsWith("/rerun")) {
        logger.info(
          `Received /rerun from ${ev.pubkey.slice(0, 8)} event=${
            ev.id.slice(0, 8)
          }`,
        );
        const { args, stdin } = parseRerunCommand(ev.content);
        const sourceEvent = await resolveSourceRunEvent(
          relay,
          ev,
          10,
          (hop) => {
            logger.debug(
              `Source event: ${hop.id.slice(0, 8)} content=${
                hop.content.slice(0, 50)
              }`,
            );
          },
        );
        if (sourceEvent !== null) {
          const parsed = parseRunCommand(sourceEvent.content);
          let message: string;
          if (!parsed) {
            message = "Execution error";
          } else if (parsed.type === "help") {
            message = helpMessage;
          } else if (parsed.type === "lang") {
            message = buildLanguageListMessage(languages);
          } else {
            message = await executePiston(
              parsed,
              args.length > 0 ? args : undefined,
              stdin !== "" ? stdin : undefined,
            );
          }
          const replyPost = composeReplyPost(
            message,
            ev,
            config.privateKeyHex,
          );
          await publishToRelay(relay, replyPost);
        }
      }
    },
  });
} catch (e) {
  logger.critical(`Fatal: ${e}`);
}
