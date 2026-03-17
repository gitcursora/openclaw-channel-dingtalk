/**
 * Dynamic ack-reaction decorator for ReplyStrategy.
 *
 * When ackReaction is set to "emoji", wraps an inner strategy to switch
 * the native ack-reaction emoji based on runtime tool execution events.
 *
 * Usage:
 *   let strategy = createReplyStrategy({ ... });
 *   if (ackReaction === "emoji" && runtimeEvents) {
 *     strategy = withDynamicReaction(strategy, { ... });
 *   }
 *
 * This decorator:
 * - Subscribes to rt.events.onAgentEvent before dispatch
 * - Maps tool_execution_start events to emoji via resolveToolReactionEmoji
 * - Recalls the previous reaction and attaches the new one
 * - Fires a heartbeat reaction if no tool event arrives for 55+ seconds
 * - Cleans up (unsubscribe + clear timer) on finalize/abort
 *
 * Important: the subscription MUST filter by runId or sessionKey to avoid
 * cross-session reaction contamination when multiple messages are processed
 * concurrently. The `sessionFilter` parameter is required for this reason.
 */

import type { DeliverPayload, ReplyOptions, ReplyStrategy } from "./reply-strategy";
import type { DingTalkConfig, Logger } from "./types";

const TOOL_REACTION_SILENCE_MS = 55_000;
const TOOL_HEARTBEAT_INTERVAL_MS = 60_000;
const TOOL_HEARTBEAT_REACTION = "⏳";

export interface DynamicReactionParams {
  config: DingTalkConfig;
  msgId: string;
  conversationId?: string;
  initialReaction: string;
  /** Only process events matching this predicate (session isolation). */
  sessionFilter: (event: unknown) => boolean;
  onAttachReaction: (reactionName: string) => Promise<boolean>;
  onRecallReaction: (reactionName: string) => Promise<void>;
  subscribeAgentEvents: (listener: (event: unknown) => void) => () => void;
  log?: Logger;
}

function resolveToolReactionEmoji(toolName: unknown): string {
  const name = typeof toolName === "string" ? toolName.trim().toLowerCase() : "";
  switch (name) {
    case "bash":
    case "exec":
    case "process":
      return "🛠️";
    case "read":
    case "view":
      return "📂";
    case "write":
    case "edit":
    case "patch":
      return "✍️";
    case "web_search":
    case "search":
    case "browser.search":
    case "browser_search":
      return "🌐";
    case "fetch":
    case "open":
    case "open_url":
    case "browser.open":
    case "browser_open":
      return "🔗";
    default:
      return "🛠️";
  }
}

export function withDynamicReaction(
  inner: ReplyStrategy,
  params: DynamicReactionParams,
): ReplyStrategy {
  const { log } = params;
  let currentReaction = params.initialReaction;
  let disposed = false;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let lastEventAt = 0;
  let updateChain: Promise<void> = Promise.resolve();

  const switchReaction = async (nextReaction: string) => {
    if (disposed || nextReaction === currentReaction) return;
    const prev = currentReaction;
    await params.onRecallReaction(prev);
    const ok = await params.onAttachReaction(nextReaction);
    if (ok) {
      currentReaction = nextReaction;
      lastEventAt = Date.now();
    }
  };

  const queueSwitch = (nextReaction: string) => {
    updateChain = updateChain
      .then(() => switchReaction(nextReaction))
      .catch((err: any) => {
        log?.warn?.(`[DingTalk] Dynamic reaction update failed: ${err.message}`);
      });
  };

  const handleEvent = (event: unknown) => {
    if (disposed) return;
    if (!params.sessionFilter(event)) return;
    const toolEvent = event as { stream?: string; data?: { phase?: string; name?: string } };
    if (toolEvent?.stream !== "tool" || toolEvent?.data?.phase !== "start") return;
    lastEventAt = Date.now();
    queueSwitch(resolveToolReactionEmoji(toolEvent.data?.name));
  };

  const unsubscribe = params.subscribeAgentEvents(handleEvent);

  heartbeatTimer = setInterval(() => {
    if (disposed || lastEventAt === 0) return;
    if (Date.now() - lastEventAt >= TOOL_REACTION_SILENCE_MS) {
      queueSwitch(TOOL_HEARTBEAT_REACTION);
    }
  }, TOOL_HEARTBEAT_INTERVAL_MS);

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    unsubscribe();
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = undefined;
    }
  };

  return {
    getReplyOptions(): ReplyOptions {
      return inner.getReplyOptions();
    },

    async deliver(payload: DeliverPayload): Promise<void> {
      await inner.deliver(payload);
    },

    async finalize(): Promise<void> {
      dispose();
      // Wait for any in-flight reaction update to complete before inner.finalize(),
      // otherwise the ack reaction recall in the finally block may race with
      // an ongoing onRecallReaction from the update chain.
      await updateChain.catch(() => undefined);
      await inner.finalize();
    },

    async abort(error: Error): Promise<void> {
      dispose();
      await updateChain.catch(() => undefined);
      await inner.abort(error);
    },

    getFinalText(): string | undefined {
      return inner.getFinalText();
    },
  };
}
