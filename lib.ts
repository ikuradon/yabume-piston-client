import { finalizeEvent } from "@nostr/tools/pure";
import { hexToBytes } from "@noble/hashes/utils.js";

export interface Runtime {
  language: string;
  version: string;
  aliases?: string[];
}

export interface LanguageEntry {
  language: string;
  version: string;
}

export interface NostrEvent {
  id: string;
  pubkey: string;
  kind: number;
  content: string;
  created_at: number;
  tags: string[][];
  sig: string;
}

export interface PistonResult {
  compile?: { output: string; code: number } | null;
  run?: { output: string; code: number } | null;
  message?: string;
}

export interface Subscription {
  close(): void;
}

export interface SubscribableRelay {
  subscribe(
    filters: Record<string, unknown>[],
    callbacks: {
      onevent: (event: NostrEvent) => void;
      oneose: () => void;
    },
  ): Subscription;
}

export const buildLanguageMap = (
  runtimes: Runtime[],
): Record<string, LanguageEntry> => {
  const languages: Record<string, LanguageEntry> = {};
  runtimes.forEach((runtime) => {
    languages[runtime.language] = {
      language: runtime.language,
      version: runtime.version,
    };
    if (runtime.aliases) {
      runtime.aliases.forEach((alias) => {
        languages[alias] = {
          language: runtime.language,
          version: runtime.version,
        };
      });
    }
  });
  return languages;
};

export const buildHelpMessage = (): string => {
  return `I RUN C0DE.

Basic Syntax:
/run <language>
<args (optional, one per line)>
\`\`\`
<code>
\`\`\`
<stdin (optional)>

Legacy Syntax:
/run <language>
<code>

Rerun:
/rerun
<args (optional, one per line)>
---
<stdin (optional)>

Language List:
/run lang`;
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
  if (languages[language].language === "emojicode") {
    script.name = "file0.emojic";
  }
  return script;
};

export const formatExecutionResult = (result: PistonResult): string => {
  if (result.compile?.code) return result.compile.output;
  if (result.run) return result.run.output;
  if (result.message) return result.message;
  return "Execution error";
};

export const composeReplyPost = (
  content: string,
  targetEvent: NostrEvent,
  privateKeyHex: string,
) => {
  const ev = {
    kind: 1,
    content,
    tags: [
      ["e", targetEvent.id],
      ["p", targetEvent.pubkey],
    ],
    created_at: targetEvent.created_at + 1,
  };

  return finalizeEvent(ev, hexToBytes(privateKeyHex));
};

export const getSourceEvent = async (
  relay: SubscribableRelay,
  event: NostrEvent,
): Promise<NostrEvent | null> => {
  const etags = event.tags.filter((x) => x[0] === "e");
  if (etags.length === 0) return null;
  const referenceId = etags.at(-1)![1];

  const referenceEvent: NostrEvent | null = await new Promise((resolve) => {
    let found: NostrEvent | null = null;
    const sub = relay.subscribe(
      [{ ids: [referenceId] }],
      {
        onevent(e: NostrEvent) {
          found = e;
        },
        oneose() {
          sub.close();
          resolve(found);
        },
      },
    );
  });
  return referenceEvent;
};
