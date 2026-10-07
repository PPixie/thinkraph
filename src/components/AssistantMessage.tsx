import { memo } from 'react';
import { ArrowUpRight, BookmarkSimple, FileText, GitBranch, Graph } from '@phosphor-icons/react';
import type { Message } from '../../shared/schemas';
import { MarkdownContent } from './MarkdownContent';

type Props = {
  message: Message;
  streaming?: boolean;
  onSave: (content: string) => void;
  onExpand: () => void;
  onSources: () => void;
};

export const AssistantMessage = memo(function AssistantMessage({ message, streaming = false, onSave, onExpand, onSources }: Props) {
  const status = streaming ? (message.content ? '正在生成' : '正在思考') : message.status === 'stopped' ? '已停止' : message.status === 'error' ? '回复中断' : '学习伙伴';
  return <article className="assistant-message" data-message-id={message.id} aria-label="Thinkraph 的回复" aria-busy={streaming}>
    <div className="assistant-name">
      <span className="assistant-avatar"><Graph size={16} weight="bold" /></span>
      Thinkraph
      <span className="assistant-status" role="status">{streaming && <i aria-hidden="true" />}{status}</span>
    </div>
    {message.content ? <MarkdownContent content={message.content} streaming={streaming} /> : <div className="assistant-placeholder" aria-hidden="true"><span /><span /><span /></div>}
    {!!message.sourceIds?.length && <button className="citation-chip" onClick={onSources}><FileText size={13} />引用资料<ArrowUpRight size={12} /></button>}
    <div className="message-actions" aria-hidden={streaming || undefined}>
      <button disabled={streaming} onClick={() => onSave(message.content)}><BookmarkSimple size={14} />记到笔记</button>
      <button disabled={streaming} onClick={onExpand}><GitBranch size={14} />扩展</button>
    </div>
  </article>;
});
