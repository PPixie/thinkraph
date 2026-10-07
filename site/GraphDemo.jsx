import { useEffect, useMemo, useState } from 'react';
import { ReactFlow, Background, Handle, Position, MarkerType, useReactFlow, ReactFlowProvider } from '@xyflow/react';
import { Brain, Cube, TreeStructure, TextT, VectorThree, CheckCircle, BookmarkSimple, ArrowCounterClockwise, ArrowsOutSimple } from '@phosphor-icons/react';
import { seedNodes, seedEdges, quizMap } from '../shared/templates.js';
import { ancestors } from '../shared/domain/graph.js';
import '@xyflow/react/dist/style.css';

// A working, reduced knowledge explorer using the workspace's real sample data.
// This demonstration keeps state in memory and never calls the model or file API.
const icons = { brain: Brain, text: TextT, cube: Cube, vector: VectorThree, tree: TreeStructure };
const positions = { llm: { x: 0, y: 0 }, vector: { x: 0, y: 150 }, prompt: { x: 228, y: 0 }, embedding: { x: 228, y: 150 }, rag: { x: 456, y: 75 } };
const exampleNodes = seedNodes.filter(node => positions[node.id]);
const exampleEdges = seedEdges.filter(edge => positions[edge.source] && positions[edge.target]);

function KnowledgeNode({ id, data }) {
  const Icon = icons[data.icon];
  return <div className={`demo-node ${data.focused ? 'is-focused' : ''} ${data.inPath ? 'in-path' : ''}`}>
    <Handle type="target" position={Position.Left} isConnectable={false} />
    <button className="nodrag" onClick={() => data.onSelect(id)} aria-pressed={data.focused} aria-label={`学习 ${data.title}`}>
      <span className="node-kind"><Icon size={17} weight="regular" />{data.kind}</span>
      <strong>{data.title}</strong>
      <span className="node-status">{data.status === 'mastered' ? <CheckCircle size={12} weight="fill" /> : null}{data.status === 'mastered' ? '已掌握' : '学习中'}</span>
    </button>
    <Handle type="source" position={Position.Right} isConnectable={false} />
  </div>;
}
const nodeTypes = { demo: KnowledgeNode };

function Explorer() {
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 767px)').matches);
  const [selectedId, setSelectedId] = useState('rag');
  const [activeTab, setActiveTab] = useState('concept');
  const [notes, setNotes] = useState({});
  const [answers, setAnswers] = useState({});
  const [checked, setChecked] = useState({});
  const [notice, setNotice] = useState('');
  const { fitView } = useReactFlow();
  useEffect(() => {
    const query = window.matchMedia('(max-width: 767px)');
    const update = event => { setNarrow(event.matches); setSelectedId('rag'); setActiveTab('concept'); };
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => fitView({ padding: .12 }), 120);
    return () => clearTimeout(timer);
  }, [narrow, fitView]);
  const current = exampleNodes.find(node => node.id === selectedId);
  const quiz = quizMap[selectedId];
  const selectNode = id => {
    setSelectedId(id);
    setActiveTab('concept');
    setNotice('');
  };
  const path = useMemo(() => new Set([selectedId, ...ancestors(selectedId, exampleEdges)]), [selectedId]);
  const visibleNodes = narrow ? exampleNodes.filter(node => !['llm', 'vector'].includes(node.id)) : exampleNodes;
  const narrowPositions = { prompt: { x: 0, y: 0 }, embedding: { x: 0, y: 142 }, rag: { x: 190, y: 71 } };
  const nodes = visibleNodes.map(node => ({
    ...node, type: 'demo', position: narrow ? narrowPositions[node.id] : positions[node.id],
    style: { width: narrow ? 138 : 168 },
    data: { ...node.data, focused: node.id === selectedId, inPath: path.has(node.id), onSelect: selectNode },
  }));
  const edges = exampleEdges.filter(edge => visibleNodes.some(node => node.id === edge.source) && visibleNodes.some(node => node.id === edge.target)).map(edge => ({
    ...edge, type: 'default',
    style: { stroke: path.has(edge.source) && path.has(edge.target) ? 'var(--accent)' : 'var(--edge)', strokeWidth: path.has(edge.source) && path.has(edge.target) ? 1.7 : 1.2 },
    markerEnd: { type: MarkerType.ArrowClosed, color: path.has(edge.target) ? 'var(--accent)' : 'var(--edge)', width: 14, height: 14 },
  }));
  const directParents = exampleEdges.filter(edge => edge.target === selectedId).map(edge => exampleNodes.find(node => node.id === edge.source).data.title);
  const tabs = [{ id: 'concept', label: '概念' }, { id: 'notes', label: '笔记' }, ...(quiz ? [{ id: 'quiz', label: '自测' }] : [])];
  function changeTab(tab) { setActiveTab(tab.id); setNotice(''); }
  function reset() {
    setSelectedId('rag'); setActiveTab('concept'); setNotes({}); setAnswers({}); setChecked({});
    setNotice('示例已重置。'); fitView({ padding: .16 });
  }
  return <>
    <div className="demo-canvas">
      <div className="canvas-graph"><ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: .12 }} onNodeClick={(_, node) => selectNode(node.id)}
        minZoom={.35} maxZoom={1.3} nodesDraggable={false} nodesConnectable={false} nodesFocusable={false}
        edgesFocusable={false} elementsSelectable={false} zoomOnScroll={false} zoomOnDoubleClick={false}
        panOnDrag={false} preventScrolling={false}>
        <Background color="var(--dot)" gap={18} size={1} />
      </ReactFlow></div>
      <div className="canvas-bottom"><span>连线表示前置知识 → 后续知识</span><button type="button" onClick={() => fitView({ padding: .16 })} aria-label="适应图谱视图"><ArrowsOutSimple size={15} /></button></div>
    </div>
    <div className="demo-details">
      <div className="demo-detail-header"><strong>{current.data.title}</strong><div role="tablist" aria-label="示例节点内容">
        {tabs.map((tab, index) => <button key={tab.id} id={`demo-tab-${tab.id}`} role="tab" aria-selected={activeTab === tab.id} aria-controls="demo-content" tabIndex={activeTab === tab.id ? 0 : -1}
          onClick={() => changeTab(tab)} onKeyDown={event => {
            let next;
            if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
            else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
            else if (event.key === 'Home') next = 0;
            else if (event.key === 'End') next = tabs.length - 1;
            else return;
            event.preventDefault(); changeTab(tabs[next]); document.getElementById(`demo-tab-${tabs[next].id}`).focus();
          }}>{tab.label}{tab.id === 'notes' && notes[selectedId] ? ' 1' : ''}</button>)}
      </div></div>
      <div id="demo-content" role="tabpanel" aria-labelledby={`demo-tab-${activeTab}`} tabIndex="0">
        {activeTab === 'concept' && <div className="demo-concept">
          <p>{current.data.summary}</p>
          <div className="demo-context"><span>前置知识</span><strong>{directParents.length ? directParents.join('、') : '从这里建立基础'}</strong>
            <button className="save-note" type="button" disabled={!!notes[selectedId]} onClick={() => {
              setNotes(existing => ({ ...existing, [selectedId]: current.data.summary }));
              setNotice(`「${current.data.title}」的概念已存入示例笔记。`);
            }}><BookmarkSimple size={14} />{notes[selectedId] ? '已存入笔记' : '记到笔记'}</button>
          </div>
        </div>}
        {activeTab === 'notes' && <div className="demo-note"><p>{notes[selectedId] || '这个节点还没有笔记。返回「概念」，点击「记到笔记」试试看。'}</p><span>示例笔记只在本次页面中保留。</span></div>}
        {activeTab === 'quiz' && <div className="demo-quiz">
          <p>{quiz.question}</p>
          <div className="demo-answers" role="radiogroup" aria-label="选择自测答案">{quiz.answers.map((answer, index) => <label key={answer}>
            <input type="radio" name={`quiz-${selectedId}`} checked={answers[selectedId] === index} onChange={() => {
              setAnswers(old => ({ ...old, [selectedId]: index })); setChecked(old => ({ ...old, [selectedId]: false }));
            }} /><span>{answer}</span>
          </label>)}</div>
          {checked[selectedId] ? <p className="quiz-feedback" role="status"><strong>{answers[selectedId] === quiz.correct ? '回答正确。' : '再想一想。'}</strong>{quiz.explanation}</p>
            : <button className="quiz-check" disabled={answers[selectedId] === undefined} onClick={() => setChecked(old => ({ ...old, [selectedId]: true }))}>查看解析</button>}
        </div>}
      </div>
      <p className="demo-notice" role="status">{notice}</p>
    </div>
    <div className="demo-footer"><span>点击知识点，切换属于它的学习内容。</span><button type="button" onClick={reset}><ArrowCounterClockwise size={13} />重置示例</button></div>
  </>;
}
export default function GraphDemo() {
  return <ReactFlowProvider><Explorer /></ReactFlowProvider>;
}
