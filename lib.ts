import { finishEvent } from "npm:nostr-tools@^1.14.0";

export interface Runtime {
  language: string;
  version: string;
  aliases?: string[];
}

export interface LanguageEntry {
  language: string;
  version: string;
}

// deno-lint-ignore no-explicit-any
export type NostrEvent = any;

export const buildLanguageMap = (
  runtimes: Runtime[],
): Record<string, LanguageEntry> => {
  const languages: Record<string, LanguageEntry> = {};
  runtimes.forEach((runtime) => {
    languages[runtime.language] = {
      language: runtime.language,
      version: runtime.version,
    };
    if (!!runtime.aliases)
      runtime.aliases.forEach((alias) => {
        languages[alias] = {
          language: runtime.language,
          version: runtime.version,
        };
      });
  });
  return languages;
};

export const buildHelpMessage = (
  languages: Record<string, LanguageEntry>,
): string => {
  return (
    "I RUN C0DE.\n" +
    "Use as follows: \n" +
    "\n" +
    "/run nodejs\n" +
    'console.log("Hello world!");\n' +
    "\n" +
    `Supported languages: ${Object.keys(languages).join()}`
  );
};

export const parseRunCommand = (
  content: string,
): { language: string; code: string } | null => {
  const contentArray = content.match(/[^\r\n]+/g);
  if (!contentArray || contentArray.length === 0) return null;
  const language = contentArray.shift()!.replace("/run", "").trim();
  const code = contentArray.join("\n");
  return { language, code };
};

export const buildScript = (
  code: string,
  languages: Record<string, LanguageEntry>,
  language: string,
): { content: string; name?: string } => {
  const script: { content: string; name?: string } = { content: code };
  if (languages[language].language === "emojicode")
    script.name = "file0.emojic";
  return script;
};

// deno-lint-ignore no-explicit-any
export const formatExecutionResult = (result: any): string => {
  if (!!result.compile && !!result.compile.code) return result.compile.output;
  else
    return !!result.run
      ? result.run.output
      : !!result.message
        ? result.message
        : "Execution error";
};

export const composeReplyPost = (
  content: string,
  targetEvent: NostrEvent,
  privateKeyHex: string,
) => {
  const ev = {
    kind: 1,
    content: content,
    tags: [
      ["e", targetEvent.id],
      ["p", targetEvent.pubkey],
    ],
    created_at: targetEvent.created_at + 1,
  };

  return finishEvent(ev, privateKeyHex);
};

export const getSourceEvent = async (
  // deno-lint-ignore no-explicit-any
  relay: any,
  event: NostrEvent,
): Promise<NostrEvent | null> => {
  // deno-lint-ignore no-explicit-any
  const etags = event.tags.filter((x: any) => x[0] === "e");
  if (etags.length === 0) return null;
  const referenceId = event.tags
    // deno-lint-ignore no-explicit-any
    .filter((x: any) => x[0] === "e")
    .slice(-1)[0][1];

  const referenceEvent = await relay.get({
    ids: [referenceId],
  });
  return referenceEvent;
};
