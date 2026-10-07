import { useId } from 'react';
import { DropdownMenu, IconButton, Tooltip } from '@radix-ui/themes';
import { ArrowUpRight, CaretDown, CaretUp, CheckCircle, Circle, CircleHalf, Clock, DotsThree } from '@phosphor-icons/react';
import type { GraphNode } from '../../shared/schemas';
import { statusLabel } from '../data.js';

type Props = {
  node: GraphNode;
  collapsed: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onQuiz: () => void;
  onStatus: (status: GraphNode['data']['status']) => void;
};

export function NodeDetails({ node, collapsed, onToggle, onEdit, onDelete, onQuiz, onStatus }: Props) {
  const contentId = useId();
  const { title, kind, summary, description, status, minutes } = node.data;
  const Status = status === 'mastered' ? CheckCircle : status === 'learning' ? CircleHalf : Circle;
  return <section className={`node-detail ${collapsed ? 'is-collapsed' : ''}`} aria-label="知识点介绍">
    <div className="node-detail-heading">
      <span className="detail-kind" title={kind}>{kind}</span>
      <h2 title={title}>{title}</h2>
      {collapsed && <span className="detail-summary-inline" title={summary}>{summary}</span>}
      <div className="node-detail-actions">
        <Tooltip content={collapsed ? '展开概念介绍' : '收起概念介绍'}>
          <IconButton size="1" variant="ghost" color="gray" aria-label={collapsed ? '展开概念介绍' : '收起概念介绍'} aria-expanded={!collapsed} aria-controls={contentId} onClick={onToggle}>
            {collapsed ? <CaretDown size={16}/> : <CaretUp size={16}/>}
          </IconButton>
        </Tooltip>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger><IconButton size="1" variant="ghost" color="gray" aria-label="节点操作"><DotsThree size={20}/></IconButton></DropdownMenu.Trigger>
          <DropdownMenu.Content>
            <DropdownMenu.Item onSelect={onEdit}>编辑知识点</DropdownMenu.Item>
            <DropdownMenu.Item onSelect={() => onStatus('learning')}>标记为学习中</DropdownMenu.Item>
            <DropdownMenu.Item onSelect={() => onStatus('mastered')}>标记为已掌握（自评）</DropdownMenu.Item>
            <DropdownMenu.Item onSelect={() => onStatus('todo')}>标记为未开始</DropdownMenu.Item>
            <DropdownMenu.Separator/>
            <DropdownMenu.Item onSelect={onDelete} color="red">删除节点</DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      </div>
    </div>
    <div id={contentId} hidden={collapsed}>
      <div key={node.id} className="node-detail-copy" role="region" aria-label="概念介绍正文" tabIndex={collapsed ? -1 : 0}>
        {summary && <p className="node-summary">{summary}</p>}
        {description ? <p className="node-description">{description}</p> : <button className="add-description" onClick={onEdit}>补充概念介绍<ArrowUpRight size={12}/></button>}
      </div>
      <div className="detail-meta">
        <span><Status size={13}/>{statusLabel[status]}</span>
        <span><Clock size={13}/>{minutes} 分钟</span>
        <button onClick={onQuiz}>测测理解<ArrowUpRight size={13}/></button>
      </div>
    </div>
  </section>;
}
