export interface Runtime {
  language: string;
  version: string;
  aliases?: string[];
}

export interface PistonResult {
  compile?: { output: string; code: number } | null;
  run?: { output: string; code: number } | null;
  message?: string;
}

export interface PistonExecuteOptions {
  language: string;
  version: string;
  files: { name?: string; content: string }[];
  args?: string[];
  stdin?: string;
  compileTimeout?: number;
  runTimeout?: number;
  compileMemoryLimit?: number;
  runMemoryLimit?: number;
}

export interface PistonClient {
  runtimes(): Promise<Runtime[]>;
  execute(options: PistonExecuteOptions): Promise<PistonResult>;
}

export function createPistonClient(
  server: string,
): PistonClient {
  const normalizedServer = server.replace(/\/$/, "");
  let cachedRuntimes: Runtime[] | null = null;

  return {
    async runtimes(): Promise<Runtime[]> {
      if (cachedRuntimes) return cachedRuntimes;

      const url = `${normalizedServer}/api/v2/runtimes`;
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Piston API error: ${res.status} ${res.statusText}`);
      }
      cachedRuntimes = await res.json() as Runtime[];
      return cachedRuntimes;
    },

    async execute(options: PistonExecuteOptions): Promise<PistonResult> {
      const url = `${normalizedServer}/api/v2/execute`;
      const body = {
        language: options.language,
        version: options.version,
        files: options.files,
        stdin: options.stdin ?? "",
        args: options.args ?? [],
        compile_timeout: options.compileTimeout ?? 10000,
        run_timeout: options.runTimeout ?? 3000,
        compile_memory_limit: options.compileMemoryLimit ?? -1,
        run_memory_limit: options.runMemoryLimit ?? -1,
      };

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text();
        return { message: text || `${res.status} ${res.statusText}` };
      }

      return await res.json() as PistonResult;
    },
  };
}
