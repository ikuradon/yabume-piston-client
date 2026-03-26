import type { LanguageEntry } from "./types.ts";
import type { PistonResult, Runtime } from "./piston.ts";

export const buildLanguageMap = (
  runtimes: Runtime[],
): Record<string, LanguageEntry> =>
  Object.fromEntries(
    runtimes.flatMap((runtime) => {
      const entry: LanguageEntry = {
        language: runtime.language,
        version: runtime.version,
      };
      const keys = [runtime.language, ...(runtime.aliases ?? [])];
      return keys.map((key) => [key, entry]);
    }),
  );

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

export const buildScript = (
  code: string,
  languages: Record<string, LanguageEntry>,
  language: string,
): { content: string; name?: string } =>
  languages[language].language === "emojicode"
    ? { content: code, name: "file0.emojic" }
    : { content: code };

export const formatExecutionResult = (result: PistonResult): string => {
  if (result.compile?.code) return result.compile.output;
  if (result.run) return result.run.output;
  if (result.message) return result.message;
  return "Execution error";
};
