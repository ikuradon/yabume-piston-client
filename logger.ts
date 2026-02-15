import { ConsoleHandler, getLogger, setup } from "@std/log";

const LOG_LEVEL = Deno.env.get("LOG_LEVEL") || "INFO";

setup({
  handlers: {
    console: new ConsoleHandler(LOG_LEVEL, {
      formatter: (record) => `[${record.levelName}] ${record.msg}`,
      useColors: true,
    }),
  },
  loggers: {
    default: { level: LOG_LEVEL, handlers: ["console"] },
  },
});

export const logger = getLogger();
