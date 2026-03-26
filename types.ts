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

export interface RunCommand {
  type: "run";
  language: string;
  code: string;
  args: string[];
  stdin: string;
}

export type ParsedRunCommand =
  | RunCommand
  | { type: "help" }
  | { type: "lang" };

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
