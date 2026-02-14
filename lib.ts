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

export const buildHelpMessage = (): string => {
  return (
    "I RUN C0DE.\n" +
    "\n" +
    "Basic Syntax:\n" +
    "/run <language>\n" +
    "<args (optional, one per line)>\n" +
    "```\n" +
    "<code>\n" +
    "```\n" +
    "<stdin (optional)>\n" +
    "\n" +
    "Legacy Syntax:\n" +
    "/run <language>\n" +
    "<code>\n" +
    "\n" +
    "Rerun:\n" +
    "/rerun\n" +
    "<args (optional, one per line)>\n" +
    "---\n" +
    "<stdin (optional)>\n" +
    "\n" +
    "Language List:\n" +
    "/run lang"
  );
};

export const buildLanguageListMessage = (
  languages: Record<string, LanguageEntry>,
): string => {
  return `Supported languages:\n${Object.keys(languages).join(", ")}`;
};

export const parseRunCommand = (
  content: string,
): { language: string; args: string[]; code: string; stdin: string } | null => {
  const contentArray = content.match(/[^\r\n]+/g);
  if (!contentArray || contentArray.length === 0) return null;
  const language = contentArray.shift()!.replace("/run", "").trim();
  const rest = contentArray.join("\n");

  // Basic Syntax: コードブロック(```)が2つある場合
  const firstBacktick = rest.indexOf("```");
  const secondBacktick = rest.indexOf("```", firstBacktick + 3);
  if (firstBacktick !== -1 && secondBacktick !== -1) {
    const parts = rest.split("```");
    const args = parts[0]
      .split("\n")
      .filter((line) => line.trim() !== "");
    const code = parts[1].replace(/^\n/, "").replace(/\n$/, "");
    const stdin = parts.slice(2).join("```").replace(/^\n/, "");
    return { language, args, code, stdin };
  }

  // Legacy Syntax: コードブロックなし（後方互換）
  return { language, args: [], code: rest, stdin: "" };
};

export const parseRerunCommand = (
  content: string,
): { args: string[]; stdin: string } => {
  const lines = content.split("\n").slice(1); // /rerun 行を除去
  if (lines.length === 0 || lines.every((line) => line.trim() === "")) {
    return { args: [], stdin: "" };
  }

  const separatorIndex = lines.indexOf("---");
  if (separatorIndex === -1) {
    // --- がなければ全行を args として扱う
    const args = lines.filter((line) => line.trim() !== "");
    return { args, stdin: "" };
  }

  // --- の前が args、後が stdin
  const args = lines
    .slice(0, separatorIndex)
    .filter((line) => line.trim() !== "");
  const stdin = lines.slice(separatorIndex + 1).join("\n");
  return { args, stdin };
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
