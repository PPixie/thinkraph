import type { Message } from '../../shared/schemas';

export type PendingReply = { graphId: string; nodeId: string; messageId: string; createdAt: string; requestId: string };
export type DisplayMessage = Message & { streaming?: boolean };

/** Keep a single message identity through streaming, saving and completion. */
export function conversationMessages(messages: Message[], pending: PendingReply | null, content: string, busy: boolean, graphId: string, nodeId: string): DisplayMessage[] {
  if (!busy || !pending || pending.graphId !== graphId || pending.nodeId !== nodeId || messages.some(message => message.id === pending.messageId)) return messages;
  return [...messages, { id: pending.messageId, role: 'assistant', content, createdAt: pending.createdAt, requestId: pending.requestId, sourceIds: [], status: 'complete', streaming: true }];
}
