/**
 * Conversation Resume (crash recovery)
 *
 * Reload a conversation transcript from disk so the dialog can continue after
 * a crash or restart. Durable work recovery (Task/Run state) is owned by the
 * product database (storage/product-store.ts), not by the transcript store.
 */

import type { Message } from "@penglai/protocol";
import { loadMessages } from "./conversation-store.js";

/** Result of resuming a conversation: its transcript. */
export interface ResumeResult {
  messages: Message[];
}

/**
 * Load a conversation from disk and prepare to continue it.
 *
 * @param conversationId the conversation to resume
 * @returns the transcript messages
 */
export async function resumeConversation(conversationId: string): Promise<ResumeResult> {
  const messages = loadMessages(conversationId);
  return { messages };
}
