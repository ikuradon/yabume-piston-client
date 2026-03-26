import { finalizeEvent } from "@nostr/tools/pure";
import { hexToBytes } from "@noble/hashes/utils.js";

import type { NostrEvent, SubscribableRelay } from "./types.ts";

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
  timeoutMs = 10000,
): Promise<NostrEvent | null> => {
  const etags = event.tags.filter((x) => x[0] === "e");
  if (etags.length === 0) return null;
  const referenceId = etags.at(-1)![1];

  const subscribePromise = new Promise<NostrEvent | null>((resolve) => {
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

  let timeoutId: number;
  const timeoutPromise = new Promise<null>((resolve) => {
    timeoutId = setTimeout(() => resolve(null), timeoutMs);
  });

  const result = await Promise.race([subscribePromise, timeoutPromise]);
  clearTimeout(timeoutId!);
  return result;
};

export const resolveSourceRunEvent = async (
  relay: SubscribableRelay,
  event: NostrEvent,
  maxHops = 10,
  onHop?: (event: NostrEvent) => void,
  timeoutMs = 10000,
): Promise<NostrEvent | null> => {
  const visited = new Set<string>([event.id]);
  let current: NostrEvent = event;

  for (let i = 0; i < maxHops; i++) {
    const next = await getSourceEvent(relay, current, timeoutMs);
    if (next === null) return null;
    if (visited.has(next.id)) return null; // 循環検出
    visited.add(next.id);
    onHop?.(next);
    if (next.content.startsWith("/run")) return next;
    current = next;
  }

  return null; // maxHops 超過
};
