import { useEffect, useRef, useState } from "react";
import { useSdk } from "@get-bb/plugin-sdk/app";
import type { experimental_useSidebarThreads as useSidebarThreads } from "@get-bb/plugin-sdk/app";
import { latestMessageTime } from "./model.mjs";

type SidebarThread = ReturnType<typeof useSidebarThreads>["threads"][number];

/** Fetch one deferred tail segment, once per thread revision, without reading whole histories. */
export function useMessageTimes(threads: readonly SidebarThread[], now: number) {
  const sdk = useSdk();
  const cache = useRef(new Map<string, { revision: string; time: number | null; minute: number }>());
  const [times, setTimes] = useState<ReadonlyMap<string, number | null>>(new Map());
  const visible = threads.filter(thread => !thread.isHidden);
  // Execution transitions cover messages sent to a running/idle thread; metadata
  // edits and read receipts are deliberately excluded from the message clock.
  const revision = visible.map(thread => `${thread.id}:${thread.latestAttentionAt}:${thread.status}`).sort().join("|");

  useEffect(() => {
    const controller = new AbortController();
    const minute = Math.floor(now / 60_000);
    const candidates = visible.map(thread => ({ threadId: thread.id, revision: `${thread.latestAttentionAt}:${thread.status}`, busy: ["starting", "active", "stopping"].includes(thread.status) }))
      .filter(thread => {
        const entry = cache.current.get(thread.threadId);
        return entry?.revision !== thread.revision || (thread.busy && entry.minute !== minute);
      });
    const ids = new Set(visible.map(thread => thread.id));
    for (const id of cache.current.keys()) if (!ids.has(id)) cache.current.delete(id);
    let index = 0;
    async function worker() {
      while (!controller.signal.aborted && index < candidates.length) {
        const thread = candidates[index++];
        try {
          const timeline = await sdk.threads.timeline({ threadId: thread.threadId, segmentLimit: "1", deferContent: "true", includeNestedRows: "false", summaryOnly: "false", signal: controller.signal });
          if (controller.signal.aborted) return;
          const time = latestMessageTime(timeline.rows);
          cache.current.set(thread.threadId, { revision: thread.revision, time, minute });
          setTimes(new Map(Array.from(cache.current, ([id, entry]) => [id, entry.time])));
        } catch {
          // Keep any previous timestamp and retry on the next minute or revision.
          // An unavailable timestamp is rendered as a dash, never as thread.updatedAt.
          if (controller.signal.aborted) return;
        }
      }
    }
    void Promise.all(Array.from({ length: Math.min(3, candidates.length) }, worker));
    return () => controller.abort();
  }, [sdk, revision, now]);

  return times;
}
