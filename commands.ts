import type { ParsedRunCommand } from "./types.ts";

export const parseRunCommand = (
  content: string,
): ParsedRunCommand | null => {
  const contentArray = content.match(/[^\r\n]+/g);
  if (!contentArray || contentArray.length === 0) return null;
  const language = contentArray.shift()!.replace("/run", "").trim();

  if (language === "help") return { type: "help" };
  if (language === "lang") return { type: "lang" };

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
    return { type: "run", language, args, code, stdin };
  }

  // Legacy Syntax: コードブロックなし（後方互換）
  return { type: "run", language, args: [], code: rest, stdin: "" };
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
