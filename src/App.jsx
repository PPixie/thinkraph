import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Theme, Button, IconButton, Dialog, TextField, TextArea, Select, Tooltip, DropdownMenu, SegmentedControl, Checkbox } from '@radix-ui/themes';
import { ReactFlow, ReactFlowProvider, Background, MiniMap, Handle, Position, MarkerType, ConnectionLineType, SelectionMode, useReactFlow, applyNodeChanges, applyEdgeChanges } from '@xyflow/react';
import { Graph, ArrowUpRight, ArrowRight, ArrowUp, ArrowLeft, Plus, MagnifyingGlass, CaretDown, CaretRight, CaretUp, Check, CheckCircle, Circle, CircleHalf, BookOpen, Books, Path, NotePencil, FileText, DotsThree, SidebarSimple, Moon, Sun, Target, Clock, Brain, Cube, VectorThree, TextT, Stack, TreeStructure, FlowArrow, Sparkle, X, CornersOut, Minus, ArrowCounterClockwise, ArrowClockwise, LinkSimple, DownloadSimple, UploadSimple, Question, Cursor, Hand, GitBranch, PaperPlaneTilt, List, BookmarkSimple, SlidersHorizontal, WarningCircle, CheckSquare, ArrowBendDownRight, Trash, Keyboard, Lightbulb } from '@phosphor-icons/react';
import { statusLabel } from './data.js';
import { templateGraph } from '../shared/migrations.ts';
import { validateGraph, sourceSchema, parse } from '../shared/schemas.ts';
import { workspaceClient as client, useWorkspace, api } from './state/workspace.ts';
import { StorageDialog } from './components/StorageDialog.tsx';
import { NodeDetails } from './components/NodeDetails.tsx';
import { AssistantMessage } from './components/AssistantMessage.tsx';
import { MarkdownContent } from './components/MarkdownContent.tsx';
import { conversationMessages } from './state/conversation.ts';
import { ancestors, availableNodes, autoLayout, connectionProblem, learningOrder, createSummaryDraft, addSummaryNode, removeNodeContent } from './graph.js';

const CURVED_EDGE_OPTIONS = { type: 'default', pathOptions: { curvature: .35 } };
const PANEL_LIMITS = { left: { min: 180, max: 360 }, right: { min: 300 } };
const NODE_KIND_OPTIONS = ['基础', '方法', '概念', '核心方法', '应用', '实践', '自建知识'];
const icons = { brain: Brain, vector: VectorThree, text: TextT, cube: Cube, stack: Stack, tree: TreeStructure, flow: FlowArrow };
const clone = value => JSON.parse(JSON.stringify(value));
const starter = templateGraph;
const makeMapId = () => crypto.randomUUID();
const EMPTY_GRAPH = validateGraph({ title: '开始你的学习空间', goal: '新建图谱、导入文件，或迁移浏览器中的旧数据', nodes: [], edges: [] });
function clampPanelWidth(side, value, maxWidth = PANEL_LIMITS[side].max ?? window.innerWidth) { const limits = PANEL_LIMITS[side]; return Math.round(Math.min(maxWidth, Math.max(limits.min, Number(value) || limits.min))); }
const KnowledgeNode = memo(function KnowledgeNode({ data }) {
  const Icon = icons[data.icon] || BookOpen;
  const Status = data.status === 'mastered' ? CheckCircle : data.status === 'learning' ? CircleHalf : data.status === 'draft' ? Sparkle : Circle;
  return <div className={`knowledge-node ${data.summarySources ? 'summary-node' : ''} ${data.status} ${data.focused ? 'focused' : ''} ${data.multiSelected ? 'multi-selected' : ''} ${data.dimmed ? 'dimmed' : ''}`}>
    <Handle role="img" type="target" position={Position.Left} aria-label={`连接到${data.title}`} />
    <div className="node-top"><span className="node-icon"><Icon size={20} /></span><span className="node-kind">{data.kind}</span>{data.multiSelected ? <span className="selected-hint"><CheckSquare size={14}/>已选中</span> : data.focused && <span className="selected-hint">当前节点</span>}</div>
    <h2>{data.title}</h2><p>{data.subtitle}</p>
    <div className="node-footer"><span className={`node-status ${data.status}`}><Status size={14} weight={data.status === 'mastered' ? 'fill' : 'regular'} />{statusLabel[data.status]}</span><span><Clock size={13}/>{data.minutes} 分钟</span></div>
    {data.focused && <div className="node-selected-footer"><span>打开节点学习</span><ArrowUpRight size={15}/></div>}
    <Handle role="img" type="source" position={Position.Right} aria-label={`从${data.title}创建依赖`} />
  </div>;
});
const nodeTypes = { knowledge: KnowledgeNode };

function TipButton({ label, children, ...props }) { return <Tooltip content={label}><IconButton size="2" variant="ghost" color="gray" aria-label={label} {...props}>{children}</IconButton></Tooltip>; }
function Empty({ icon: Icon = BookOpen, title, children, action }) { return <div className="empty"><span className="empty-icon"><Icon size={30}/></span><h3>{title}</h3><p>{children}</p>{action}</div>; }
function PanelResizer({ side, width, maxWidth = PANEL_LIMITS[side].max, onResize, onToggle }) {
  const limits = { ...PANEL_LIMITS[side], max: maxWidth };
  const label = side === 'left' ? '导航面板宽度' : '学习助手宽度';
  const setByKeyboard = event => {
    const step = event.shiftKey ? 32 : 16;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      const direction = side === 'left' ? (event.key === 'ArrowRight' ? 1 : -1) : (event.key === 'ArrowLeft' ? 1 : -1);
      const currentWidth = event.currentTarget.parentElement.getBoundingClientRect().width;
      onResize(clampPanelWidth(side, currentWidth + direction * step, limits.max));
    }
    if (event.key === 'Home') { event.preventDefault(); onResize(limits.min); }
    if (event.key === 'End') { event.preventDefault(); onResize(limits.max); }
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onToggle(); }
  };
  const startPointer = event => {
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = event.currentTarget.parentElement.getBoundingClientRect().width;
    const move = moveEvent => {
      const delta = moveEvent.clientX - startX;
      onResize(clampPanelWidth(side, startWidth + (side === 'left' ? delta : -delta), limits.max), false);
    };
    const finish = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      onResize(undefined, true);
      document.body.classList.remove('is-resizing-panel');
    };
    document.body.classList.add('is-resizing-panel');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish, { once: true });
    window.addEventListener('pointercancel', finish, { once: true });
  };
  return <div className={`panel-resizer panel-resizer-${side}`} role="separator" aria-orientation="vertical" aria-label={label} aria-valuemin={limits.min} aria-valuemax={limits.max} aria-valuenow={width} aria-valuetext={`${width} 像素，可拖拽调整`} tabIndex="0" onPointerDown={startPointer} onDoubleClick={onToggle} onKeyDown={setByKeyboard} title="拖拽调整宽度，双击收起">
    <span className="panel-resizer-grip" aria-hidden="true"><i/><i/><i/></span>
  </div>;
}

function Workbench({ theme, toggleTheme }) {
  const state = useWorkspace();
  const workspace = state.data.workspace;
  const activeMapId = workspace.activeGraphId;
  const mapLibrary = { activeId: activeMapId, maps: state.data.graphs };
  const graph = client.graph() || (activeMapId ? { ...EMPTY_GRAPH, title: '当前图谱无法读取', goal: '请查看本地恢复面板中的文件问题，原文件已保留' } : EMPTY_GRAPH);
  const session = client.sessions.get(activeMapId);
  const [storageMode, setStorageModeRaw] = useState(null);
  const [selectedId, setSelectedId] = useState(() => workspace.graphViews[activeMapId]?.selectedNodeId || graph.nodes[0]?.id || null);
  const [selectedIds, setSelectedIds] = useState(() => selectedId ? [selectedId] : []);
  const [isSelecting, setIsSelecting] = useState(false);
  const [summaryDraft, setSummaryDraft] = useState(null);
  const [page, setPage] = useState('graph');
  const [tab, setTab] = useState('chat');
  const [leftOpen, setLeftOpen] = useState(() => window.innerWidth >= 1024);
  const [rightOpen, setRightOpen] = useState(() => window.innerWidth >= 768);
  const [headingCollapsed, setHeadingCollapsed] = useState(workspace.headerCollapsed);
  const [nodeDetailsCollapsed, setNodeDetailsCollapsed] = useState(false);
  const [panelWidths, setPanelWidths] = useState(workspace.panelWidths);
  const [contentWidth, setContentWidth] = useState(() => window.innerWidth);
  const [focusPath, setFocusPath] = useState(false);
  const [tool, setTool] = useState('cursor');
  const [zoom, setZoom] = useState(1);
  const [draggingNodes, setDraggingNodes] = useState(null);
  const [filter, setFilter] = useState('all');
  const [dialog, setDialog] = useState(null);
  const [search, setSearch] = useState('');
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [pendingRequest, setPendingRequest] = useState(null);
  const [chatError, setChatError] = useState(false);
  const [proposal, setProposal] = useState(null);
  const [proposalChecks, setProposalChecks] = useState([true, true]);
  const [toast, setToast] = useState('');
  const [streamText, setStreamText] = useState('');
  const [generatedDraft, setGeneratedDraft] = useState(null);
  const [workspaceName, setWorkspaceName] = useState(workspace.name);
  const [sourceTitle, setSourceTitle] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [noteDraft, setNoteDraft] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newGoal, setNewGoal] = useState('');
  const [newKnowledge, setNewKnowledge] = useState('');
  const [newSubtitle, setNewSubtitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newKind, setNewKind] = useState('自建知识');
  const [newLevel, setNewLevel] = useState('starter');
  const [newDuration, setNewDuration] = useState('30');
  const [createState, setCreateState] = useState('idle');
  const [formError, setFormError] = useState('');
  const [edgeSource, setEdgeSource] = useState('');
  const [edgeTarget, setEdgeTarget] = useState('');
  const [quizAnswer, setQuizAnswer] = useState(null);
  const [quizChecked, setQuizChecked] = useState(false);
  const [modelConfig, setModelConfig] = useState({ baseUrl: '', model: '', timeoutMs: 60000, apiKeyConfigured: false, source: 'default' });
  const [configBusy, setConfigBusy] = useState(false);
  const setGraph = useCallback(updater => { if (activeMapId) client.update(activeMapId, updater); }, [activeMapId]);
  const { past: history, future } = client.history(activeMapId);
  const toastTimer = useRef(null), shellRef = useRef(null), topbarRef = useRef(null), canvasRef = useRef(null), resizeCommitRef = useRef(null), agentController = useRef(null), agentTask = useRef(null);
  const chatScroll = useRef(null), followReply = useRef(true);
  async function setStorageMode(mode) { agentController.current?.abort(); await agentTask.current; setStorageModeRaw(mode); }

  const { fitView, zoomIn, zoomOut, getZoom, getNodes, setViewport } = useReactFlow();
  const active = graph.nodes.find(n => n.id === selectedId);
  const messages = graph.messages[selectedId] || [];
  const displayMessages = conversationMessages(messages, pendingRequest, streamText, busy, activeMapId, selectedId);
  const mastered = graph.nodes.filter(n => n.data.status === 'mastered').length;
  const ordered = useMemo(() => learningOrder(graph.nodes, graph.edges), [graph.nodes, graph.edges]);
  const selectedNodes = ordered.filter(node => selectedIds.includes(node.id));
  const summaryAnchor = selectedNodes[0];
  const summarySourceIds = new Set(summaryDraft?.sourceIds || []);
  const summaryParentNames = graph.edges.filter(edge => edge.target === summaryDraft?.sourceIds[0] && !summarySourceIds.has(edge.source)).map(edge => graph.nodes.find(node => node.id === edge.source)?.data.title).filter(Boolean);
  const summaryChildCount = new Set(graph.edges.filter(edge => summarySourceIds.has(edge.source) && !summarySourceIds.has(edge.target)).map(edge => edge.target)).size;
  const ready = availableNodes(graph.nodes, graph.edges);
  const pathIds = useMemo(() => new Set([selectedId, ...ancestors(selectedId, graph.edges)]), [selectedId, graph.edges]);
  const prerequisites = graph.edges.filter(e => e.target === selectedId).map(e => graph.nodes.find(n => n.id === e.source)).filter(Boolean);
  const sources = graph.sources[selectedId] || [];
  const quiz = active ? graph.quizzes[selectedId]?.at(-1) : null;
  const notify = useCallback(text => { setToast(text); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(''), 4500); }, []);
  const commit = useCallback(updater => {
    setGraph(current => { history.current.push(clone(current)); if (history.current.length > 40) history.current.shift(); future.current = []; return typeof updater === 'function' ? updater(current) : updater; });
  }, [setGraph, history, future]);
  const fit = useCallback(() => setTimeout(async () => { const target = getNodes().find(n => n.selected) || getNodes()[0]; await fitView(window.innerWidth < 768 && target ? { nodes: [{ id: target.id }], padding: .25, minZoom: .85, maxZoom: .9, duration: 0 } : { padding: .14, minZoom: .1, maxZoom: 1.1, duration: 0 }); setZoom(getZoom()); }, 90), [fitView, getZoom, getNodes]);
  const select = useCallback((id, preserveSelection = false) => { setSelectedId(id); if (!preserveSelection) setSelectedIds([id]); setRightOpen(true); setTab('chat'); setNoteDraft(''); setProposal(null); setChatError(false); setPrompt('');
    if (window.innerWidth < 1024) setLeftOpen(false);
    const graphId = client.activeId, data = client.snapshot.data;
    if (graphId && client.graph(graphId)?.nodes.some(n => n.id === id)) void client.patch({ graphViews: { [graphId]: { ...data.workspace.graphViews[graphId], selectedNodeId: id } } }).catch(error => notify(error.message));
  }, [notify]);
  const undo = useCallback(() => { if (!history.current.length) return; const prev = history.current.pop(); future.current.push(clone(graph)); setGraph(prev); setSelectedIds([]); setProposal(null); notify('已撤销上一步修改'); }, [graph, notify, setGraph]);
  const redo = useCallback(() => { if (!future.current.length) return; const next = future.current.pop(); history.current.push(clone(graph)); setGraph(next); setSelectedIds([]); notify('已恢复修改'); }, [graph, notify, setGraph]);

  const updatePanelWidth = useCallback((side, nextWidth, commit = true) => {
    if (nextWidth !== undefined) {
      const width = clampPanelWidth(side, nextWidth);
      if (shellRef.current) shellRef.current.style.setProperty(side === 'left' ? '--sidebar-width' : '--inspector-width', `${width}px`);
      if (!commit) return;
      setPanelWidths(current => current[side] === width ? current : { ...current, [side]: width });
      return;
    }
    const width = panelWidths[side];
    if (resizeCommitRef.current?.side === side) {
      const finalWidth = resizeCommitRef.current.width;
      setPanelWidths(current => current[side] === finalWidth ? current : { ...current, [side]: finalWidth });
      resizeCommitRef.current = null;
    } else if (width) {
      setPanelWidths(current => ({ ...current, [side]: width }));
    }
  }, [panelWidths]);
  const handlePanelResize = useCallback((side, nextWidth, commit = true) => {
    if (nextWidth === undefined) {
      updatePanelWidth(side, undefined, true);
      return;
    }
    const width = clampPanelWidth(side, nextWidth);
    resizeCommitRef.current = { side, width };
    updatePanelWidth(side, width, commit);
  }, [updatePanelWidth]);
  const persistPanelWidths = useCallback(next => {
    if (JSON.stringify(next) !== JSON.stringify(client.snapshot.data.workspace.panelWidths)) void client.patch({ panelWidths: next }).catch(error => notify(error.message));
  }, [notify]);
  const togglePanel = useCallback(side => {
    if (side === 'left') setLeftOpen(open => !open);
    else {
      if (!rightOpen && window.innerWidth < 1024) setLeftOpen(false);
      setRightOpen(open => !open);
    }
  }, [rightOpen]);
  const toggleHeading = useCallback(() => {
    const next = !headingCollapsed; setHeadingCollapsed(next);
    void client.patch({ headerCollapsed: next }).catch(error => notify(error.message));
  }, [headingCollapsed, notify]);
  useEffect(() => { persistPanelWidths(panelWidths); }, [panelWidths, persistPanelWidths]);
  useEffect(() => { setHeadingCollapsed(workspace.headerCollapsed); setPanelWidths(workspace.panelWidths); }, [workspace.headerCollapsed, workspace.panelWidths.left, workspace.panelWidths.right]);
  useEffect(() => {
    const topbar = topbarRef.current;
    const observer = new ResizeObserver(() => setContentWidth(topbar.clientWidth));
    observer.observe(topbar);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const compact = window.matchMedia('(max-width: 1023px)');
    const collapseNavigation = () => { if (compact.matches) setLeftOpen(false); };
    collapseNavigation();
    compact.addEventListener('change', collapseNavigation);
    return () => compact.removeEventListener('change', collapseNavigation);
  }, []);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let previousSize, fitTimer;
    // Panel changes resize the canvas without a window resize. Refit only when
    // its dimensions change, preserving saved views and zoom during node/chat updates.
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (!width || !height) return;
      if (previousSize && (width !== previousSize.width || height !== previousSize.height)) {
        clearTimeout(fitTimer);
        fitTimer = fit();
      }
      previousSize = { width, height };
    });
    observer.observe(canvas);
    return () => { observer.disconnect(); clearTimeout(fitTimer); };
  }, [page, fit]);
  useEffect(() => {
    const next = client.graph(); const view = workspace.graphViews[activeMapId];
    setSelectedId(view?.selectedNodeId || next?.nodes[0]?.id || null);
    setProposal(null); setGeneratedDraft(null);
    if (view?.viewport) setTimeout(() => setViewport(view.viewport), 150);
  }, [activeMapId, state.data.generationId]);
  useEffect(() => {
    if (dialog !== 'config') return;
    let cancelled = false;
    setConfigBusy(true); setFormError('');
    client.getConfig().then(result => { if (!cancelled) setModelConfig(result.ai); }).catch(error => { if (!cancelled) setFormError(error.message); }).finally(() => { if (!cancelled) setConfigBusy(false); });
    return () => { cancelled = true; };
  }, [dialog]);
  useEffect(() => {
    const beforeUnload = event => { if (client.dirty || busy) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', beforeUnload); return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [busy]);
  useEffect(() => { if (selectedId && !graph.nodes.some(n => n.id === selectedId)) setSelectedId(graph.nodes[0]?.id || null); }, [graph.nodes, selectedId]);
  useEffect(() => { setSelectedIds([]); setSummaryDraft(null); setIsSelecting(false); }, [activeMapId]);
  useEffect(() => { setSelectedIds(ids => ids.every(id => graph.nodes.some(node => node.id === id)) ? ids : ids.filter(id => graph.nodes.some(node => node.id === id))); }, [graph.nodes]);
  useEffect(() => { followReply.current = true; }, [selectedId, activeMapId, tab]);
  useEffect(() => {
    if (tab === 'chat' && followReply.current && chatScroll.current) chatScroll.current.scrollTop = chatScroll.current.scrollHeight;
  }, [streamText, messages.length, busy, selectedId, tab]);
  useEffect(() => () => { clearTimeout(toastTimer.current); agentController.current?.abort(); }, []);
  useEffect(() => {
    const handler = e => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setDialog('search'); }
      if (e.key === 'Escape' && !dialog) { setProposal(null); setSelectedIds([]); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !dialog && !['INPUT', 'TEXTAREA'].includes(e.target.tagName)) { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    };
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler);
  }, [undo, redo, dialog]);

  async function exportModelConfig() {
    setConfigBusy(true); setFormError('');
    try { await client.exportConfig(); notify('配置已导出，导出文件不包含密钥'); } catch (error) { setFormError(error.message); } finally { setConfigBusy(false); }
  }
  async function importModelConfig(event) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    setConfigBusy(true); setFormError('');
    try {
      const result = await client.importConfig(JSON.parse(await file.text()));
      setModelConfig(result.ai); notify(result.ai.apiKeyConfigured ? '配置已导入，密钥保持隐藏' : '配置已导入，导出文件未包含密钥');
    } catch (error) { setFormError(error.message); } finally { setConfigBusy(false); }
  }

  async function switchMap(id) {
    if (id === activeMapId) return;
    try {
      agentController.current?.abort(); await agentTask.current;
      await client.switch(id);
      setPage('graph'); setTab('chat'); setProposal(null); setNoteDraft(''); setChatError(false); setPrompt('');
      setRightOpen(client.graph()?.nodes.length > 0);
      if (window.innerWidth < 1024) setLeftOpen(false);
      fit();
    } catch (error) { notify(error.message); }
  }
  function persistView(viewport) {
    setZoom(viewport.zoom); const id = activeMapId; if (!id) return;
    const data = client.snapshot.data; if (!data?.graphs.some(g => g.id === id)) return;
    const nodeId = client.graph(id)?.nodes.some(n => n.id === selectedId) ? selectedId : null;
    void client.patch({ graphViews: { ...data.workspace.graphViews, [id]: { viewport, selectedNodeId: nodeId } } }).catch(error => notify(error.message));
  }
  const openDialog = name => { setDialog(name); setFormError(''); setQuizAnswer(null); setQuizChecked(false); if (name === 'edit') { setNewKnowledge(active.data.title); setNewKind(active.data.kind); setNewSubtitle(active.data.summary); setNewDescription(active.data.description || ''); } if (name === 'add') { if (activeMapId && !session) { setDialog(null); notify('请先恢复当前图谱'); return; } if (!activeMapId) { setDialog('new'); return; } setNewKnowledge(''); setNewSubtitle(''); setNewDescription(''); setNewKind('自建知识'); } if (name === 'settings') { setNewTitle(graph.title); setNewGoal(graph.goal); setWorkspaceName(workspace.name); } if (name === 'config') { setModelApiKey(''); setClearModelApiKey(false); } if (name === 'connect') { setEdgeSource(selectedId || graph.nodes[0]?.id || ''); setEdgeTarget(''); } };
  const changeNodeStatus = (id, status) => { commit(g => ({ ...g, nodes: g.nodes.map(n => n.id === id ? { ...n, data: { ...n.data, status, evidence: 'self_report' } } : n) })); notify(`已更新为${statusLabel[status]}（自评）`); };
  const onNodesChange = changes => {
    const selections = changes.filter(change => change.type === 'select');
    if (selections.length) setSelectedIds(current => {
      const ids = new Set(current);
      selections.forEach(change => { if (change.selected) ids.add(change.id); else ids.delete(change.id); });
      return [...ids];
    });
    const updates = changes.filter(change => change.type === 'position' && graph.nodes.some(node => node.id === change.id));
    if (updates.length) {
      setDraggingNodes(current => applyNodeChanges(updates, current || graph.nodes));
      if (updates.every(change => !change.dragging)) {
        setGraph(g => ({ ...g, nodes: applyNodeChanges(updates, g.nodes) }));
        setDraggingNodes(null);
      }
    }
  };
  const connect = ({ source, target }) => {
    const problem = connectionProblem(source, target, graph.edges);
    if (problem) { setFormError(problem); notify(problem); return false; }
    commit(g => ({ ...g, edges: [...g.edges, { id: `${source}-${target}`, source, target, ...CURVED_EDGE_OPTIONS }] }));
    notify('学习依赖已建立'); return true;
  };
  const draftNodes = proposal ? proposal.items.filter((_, i) => proposalChecks[i]).map((item, i) => ({ id: `draft-${i}`, type: 'knowledge', width: 232, height: 167, handles: [{ type: 'target', position: Position.Left, x: 0, y: 83.5, width: 7, height: 7 }, { type: 'source', position: Position.Right, x: 232, y: 83.5, width: 7, height: 7 }], position: { x: (active?.position.x || 0) + 292, y: (active?.position.y || 0) - 80 + i * 235 }, data: { ...item, status: 'draft', kind: '延伸知识', icon: 'stack', minutes: 15 } })) : [];
  const displayNodes = [...(draggingNodes || graph.nodes).filter(n => !proposal || pathIds.has(n.id)).map(n => ({ ...n, type: 'knowledge', domAttributes: { onKeyDownCapture: event => handleNodeKeyDown(event, n.id) }, selected: selectedIds.includes(n.id), data: { ...n.data, focused: n.id === selectedId && selectedNodes.length < 2, multiSelected: selectedNodes.length > 1 && selectedIds.includes(n.id), dimmed: !selectedIds.includes(n.id) && ((focusPath && !pathIds.has(n.id)) || (filter !== 'all' && n.data.status !== filter)) } })), ...draftNodes.map(node => ({ ...node, selectable: false }))];
  const displayEdges = [...graph.edges.filter(e => !proposal || (pathIds.has(e.source) && pathIds.has(e.target))).map(e => ({ ...e, selected: false, style: { stroke: e.target === selectedId ? 'var(--accent)' : 'var(--edge)', strokeWidth: e.target === selectedId ? 1.8 : 1.4, opacity: focusPath && !(pathIds.has(e.source) && pathIds.has(e.target)) ? .17 : 1 }, markerEnd: { type: MarkerType.ArrowClosed, color: e.target === selectedId ? (theme === 'dark' ? '#7bccac' : '#397e62') : (theme === 'dark' ? '#5d7269' : '#aebdb5'), width: 15, height: 15 }, ...CURVED_EDGE_OPTIONS })), ...draftNodes.map(n => ({ id: `edge-${n.id}`, source: proposal.parentId, target: n.id, ...CURVED_EDGE_OPTIONS, style: { stroke: 'var(--accent)', strokeDasharray: '5 5' } }))];

  async function requestExpansion() {
    if (!active || busy) return;
    const graphId = activeMapId, nodeId = selectedId, requestGeneration = client.generation;
    setBusy(true);
    try {
      await client.flush(graphId);
      const baseVersion = client.sessions.get(graphId).version;
      const result = await api('/agent/generate', { method: 'POST', generation: client.generation, body: { requestId: crypto.randomUUID(), kind: 'expand', graphId, nodeId, baseRevision: client.graph(graphId).revision } });
      if (client.generation !== requestGeneration || client.activeId !== graphId || client.sessions.get(graphId).version !== baseVersion) throw new Error('生成期间图谱已改变，请重新生成建议');
      const items = result.draft.nodes.map(node => node.data);
      setProposal({ parentId: nodeId, items, draft: result.draft, baseRevision: result.baseRevision, baseVersion, generationId: requestGeneration });
      setProposalChecks(items.map(() => true)); setSelectedIds([nodeId]); setPage('graph'); setRightOpen(true); setTab('chat'); fit();
    } catch (error) { notify(error.message); } finally { setBusy(false); }
  }
  function acceptProposal() {
    try {
      if (client.generation !== proposal.generationId || client.graph().revision !== proposal.baseRevision || session.version !== proposal.baseVersion) throw new Error('图谱已变化，请重新生成分支');
      const created = proposal.draft.nodes.filter((_, i) => proposalChecks[i]);
      if (!created.length) return;
      const ids = new Set([...graph.nodes, ...created].map(n => n.id));
      const edges = proposal.draft.edges.filter(edge => ids.has(edge.source) && ids.has(edge.target));
      commit(g => ({ ...g, nodes: autoLayout([...g.nodes, ...created], [...g.edges, ...edges]), edges: [...g.edges, ...edges] }));
      setProposal(null); fit(); notify(`已加入 ${created.length} 个节点，可撤销`);
    } catch (error) { notify(error.message); }
  }
  async function send(text = prompt, isRetry = false) {
    if (!text.trim() || !active || busy) return;
    if (!state.agentConfigured) { notify('未配置模型，请在空间设置中配置模型端点'); return; }
    const graphId = activeMapId, requestGeneration = client.generation, nodeId = selectedId, question = text.trim(), requestId = crypto.randomUUID(), messageId = crypto.randomUUID(), createdAt = new Date().toISOString();
    const controller = new AbortController(); agentController.current = controller;
    followReply.current = true;
    setPendingRequest({ graphId, nodeId, question, requestId, messageId, createdAt }); setChatError(false); setBusy(true); setPrompt(''); setStreamText('');
    let answer = '', status = 'complete';
    const work = async () => {
      try {
        if (!isRetry) client.update(graphId, g => ({ ...g, messages: { ...g.messages, [nodeId]: [...(g.messages[nodeId] || []), { id: crypto.randomUUID(), role: 'user', content: question, createdAt: new Date().toISOString(), status: 'complete', sourceIds: [], requestId }] } }));
        await client.flush(graphId);
        const response = await fetch('/api/agent/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Workspace-Generation': client.generation }, body: JSON.stringify({ requestId, graphId, nodeId, baseRevision: client.graph(graphId).revision }), signal: controller.signal });
        if (!response.ok) throw new Error((await response.json()).message);
        const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '', doneEvent = false;
        while (true) {
          const chunk = await reader.read(); if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          let end;
          while ((end = buffer.indexOf('\n\n')) >= 0) {
            const event = buffer.slice(0, end); buffer = buffer.slice(end + 2);
            const type = event.split('\n').find(line => line.startsWith('event:'))?.slice(6).trim();
            const value = JSON.parse(event.split('\n').find(line => line.startsWith('data:'))?.slice(5) || '{}');
            if (type === 'delta') { answer += value.text; setStreamText(answer); }
            if (type === 'error') throw new Error(value.message);
            if (type === 'done') doneEvent = true;
          }
        }
        if (!doneEvent) throw new Error('回复连接中断');
      } catch (error) {
        status = controller.signal.aborted ? 'stopped' : 'error';
        if (status === 'error') { setChatError(true); notify(error.message); }
      } finally {
        if (answer && client.generation === requestGeneration && client.graph(graphId)?.nodes.some(n => n.id === nodeId)) {
          client.update(graphId, g => ({ ...g, messages: { ...g.messages, [nodeId]: [...(g.messages[nodeId] || []), { id: messageId, role: 'assistant', content: answer, createdAt, status, sourceIds: [], requestId }] } }));
          await client.flush(graphId).catch(error => notify(error.message));
        }
        setBusy(false); setStreamText(''); if (status !== 'error') setPendingRequest(null);
      }
    };
    agentTask.current = work(); await agentTask.current; agentTask.current = null;
  }
  function saveNote(text) {
    if (!text.trim()) return;
    if ((graph.notes[selectedId] || []).some(note => note.content === text.trim())) { notify('这条内容已经在笔记中'); return; }
    const date = new Date().toISOString();
    commit(g => ({ ...g, notes: { ...g.notes, [selectedId]: [...(g.notes[selectedId] || []), { id: crypto.randomUUID(), content: text.trim(), createdAt: date, updatedAt: date }] } }));
    setNoteDraft(''); notify('已加入当前节点笔记');
  }
  async function exportGraph(format) { try { agentController.current?.abort(); await agentTask.current; await client.exportGraph(format === 'md' ? 'markdown' : format); notify('图谱已导出'); } catch (error) { notify(error.message); } }
  async function createMap(empty = false, useAI = false) {
    if (!newTitle.trim()) { setFormError('请填写想学习的领域'); return; }
    setFormError(''); setCreateState('loading');
    try {
      if (useAI) {
        const requestGeneration = client.generation;
        const result = await api('/agent/generate', { method: 'POST', generation: client.generation, body: { requestId: crypto.randomUUID(), kind: 'graph', prompt: `领域：${newTitle}；目标：${newGoal}；基础：${newLevel}；每日 ${newDuration} 分钟` } });
        if (client.generation !== requestGeneration) throw new Error('生成期间空间已变化，请重新生成');
        setGeneratedDraft({ ...result, generationId: requestGeneration }); return;
      }
      const topic = newTitle.trim();
      const nodes = empty ? [] : [
        { id: 'start', position: { x: 0, y: 100 }, data: { title: `${topic}的核心概念`, subtitle: '先建立基本词汇与边界', summary: `列出${topic}的关键术语、使用场景与常见误解。这是通用模板，请结合可靠资料细化。`, description: `这个通用模板用于建立${topic}的概念地图。先从可靠资料中选出几个关键术语，用自己的话解释各自的含义，再记录它们之间的联系与区别。例如，可以为一个术语整理一个典型用例和一个反例，以检验自己是否理解适用边界。这里提供学习步骤，请在学习过程中用具体的领域知识补充。`, status: newLevel === 'some' ? 'learning' : 'todo', kind: '基础', icon: 'brain', minutes: 20, createdBy: 'template' } },
        { id: 'method', position: { x: 295, y: 100 }, data: { title: `${topic}的常用方法`, subtitle: '理解方法为何有效', summary: `选择${topic}中的一个方法，记录它的前提、步骤和局限。`, description: `方法学习关注如何从问题出发，经过明确步骤得到可以检查的结果。选择${topic}中的一种常用方法，先说明它解决什么问题，再逐步记录所需条件、输入、执行过程与结果。用一个小例子实际完成流程，并比较条件变化时哪些步骤仍然适用、哪些需要调整。这个模板提供整理框架，具体原理与限制需要结合所学方法补充。`, status: 'todo', kind: '方法', icon: 'tree', minutes: 25, createdBy: 'template' } },
        { id: 'practice', position: { x: 590, y: 100 }, data: { title: '完成一个最小实践', subtitle: newGoal.trim() || '用真实问题检验所学', summary: newGoal.trim() || `使用${topic}解决一个小问题，并记录结果。`, description: `最小实践是用较小、可验证的任务检查概念与方法能否真正用于解决问题。围绕${topic}选定一个目标，明确成功标准，准备必要材料，再完成一次从输入到结果的完整过程。记录预期与实际结果的差异，追溯到相关概念或步骤，并提出下一次改进。任务不必复杂，但应能复现过程并说明结果为何满足目标。`, status: 'todo', kind: '实践', icon: 'flow', minutes: 30, createdBy: 'template' } }
      ];
      const created = await client.create({ title: topic, goal: newGoal.trim() || `建立${topic}的知识体系`, nodes, edges: empty ? [] : [{ id: 'start-method', source: 'start', target: 'method' }, { id: 'method-practice', source: 'method', target: 'practice' }], preferences: { level: newLevel, dailyMinutes: Number(newDuration) } });
      setSelectedId(created.nodes[0]?.id || null); setPage('graph'); setDialog(null); setRightOpen(!empty); fit(); notify(empty ? '空白图谱已创建' : '通用学习模板已创建');
    } catch (error) { setFormError(error.message); } finally { setCreateState('idle'); }
  }
  async function requestQuiz() {
    if (!active) return;
    if (quiz) { openDialog('quiz'); return; }
    const graphId = activeMapId, nodeId = selectedId, requestGeneration = client.generation; setBusy(true);
    try {
      await client.flush(graphId); const baseVersion = session.version;
      const result = await api('/agent/generate', { method: 'POST', generation: client.generation, body: { requestId: crypto.randomUUID(), kind: 'quiz', graphId, nodeId, baseRevision: client.graph(graphId).revision } });
      if (client.generation !== requestGeneration || client.activeId !== graphId || session.version !== baseVersion) throw new Error('图谱已变化，请重新生成测验');
      setGeneratedDraft({ ...result, baseVersion, generationId: requestGeneration }); openDialog('quiz');
    } catch (error) { notify(error.message); } finally { setBusy(false); }
  }
  function saveSource() {
    try {
      const source = parse(sourceSchema, { id: crypto.randomUUID(), title: sourceTitle.trim(), url: sourceUrl.trim(), type: '参考资料' });
      commit(g => ({ ...g, sources: { ...g.sources, [selectedId]: [...(g.sources[selectedId] || []), source] } }));
      setSourceTitle(''); setSourceUrl(''); notify('参考资料已添加');
    } catch (error) { notify(error.message); }
  }
  function addNode() {
    if (!newKnowledge.trim()) { setFormError('请填写知识点名称'); return; }
    if (dialog === 'edit') { try { commit(g => ({ ...g, nodes: g.nodes.map(n => n.id === selectedId ? { ...n, data: { ...n.data, title: newKnowledge.trim(), kind: newKind, summary: newSubtitle.trim(), description: newDescription.trim() } } : n) })); setDialog(null); notify('知识点已更新'); } catch (error) { setFormError(error.message); } return; }
    const node = { id: crypto.randomUUID(), type: 'knowledge', position: { x: active ? active.position.x + 292 : 0, y: active?.position.y || 100 }, data: { title: newKnowledge.trim(), subtitle: newSubtitle.trim() || '记录一个值得探索的问题', summary: newSubtitle.trim() || '从一个定义、一个例子或一个问题开始学习。', description: newDescription.trim(), kind: newKind, icon: 'stack', status: 'todo', minutes: 15 } };
    commit(g => ({ ...g, nodes: [...g.nodes, node], edges: [...g.edges, ...(active ? [{ id: `${active.id}-${node.id}`, source: active.id, target: node.id, ...CURVED_EDGE_OPTIONS }] : [])] }));
    select(node.id); setNewKnowledge(''); setNewSubtitle(''); setNewDescription(''); setNewKind('自建知识'); setDialog(null); fit(); notify(`已添加${newKind}节点`);
  }
  function previewSummary() {
    try {
      setSummaryDraft({ ...createSummaryDraft(graph, selectedIds), baseVersion: session.version, baseRevision: graph.revision, generationId: client.generation });
      setFormError(''); setDialog('summary');
    } catch (error) { notify(error.message); }
  }
  function handleNodeKeyDown(event, id) {
    if ((event.metaKey || event.ctrlKey) && ['Enter', ' '].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      setSelectedIds(ids => ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id]);
    } else if (event.key === 'Enter') {
      event.preventDefault(); event.stopPropagation(); select(id);
    }
  }
  function acceptSummary() {
    try {
      if (summaryDraft.generationId !== client.generation || summaryDraft.baseVersion !== session.version) throw new Error('图谱已变化，请重新预览汇总');
      const id = makeMapId();
      const next = addSummaryNode(graph, summaryDraft, id);
      if (summaryDraft.sourceIds.includes(pendingRequest?.nodeId)) {
        agentController.current?.abort(); setChatError(false);
      }
      commit(next); select(id); setTab('notes'); setDialog(null); setSummaryDraft(null); fit();
      notify(`已用汇总节点替换 ${summaryDraft.sourceIds.length} 个知识点，并重新连接父子节点。可撤销恢复。`);
    } catch (error) { setFormError(error.message); }
  }

  return <div ref={shellRef} className={`app-shell ${leftOpen ? '' : 'left-closed'} ${rightOpen && active ? '' : 'right-closed'}`} style={{ '--sidebar-width': `${panelWidths.left}px`, '--inspector-width': `${panelWidths.right}px` }}>
    <aside className={`sidebar ${leftOpen ? 'open' : ''}`} aria-label="工作空间导航">
      <a href="#" className="brand" onClick={e => { e.preventDefault(); setPage('graph'); }}><span className="brand-mark"><Graph size={26} weight="bold"/></span>thinkraph<span className="brand-period">.</span></a>
      <DropdownMenu.Root><DropdownMenu.Trigger><button className="workspace workspace-trigger"><span className="workspace-avatar">我</span><span>{workspace.name}<small>本地学习空间</small></span><CaretDown size={17}/></button></DropdownMenu.Trigger><DropdownMenu.Content>
        <DropdownMenu.Item onSelect={() => setStorageMode('workspace')}>导入学习空间</DropdownMenu.Item>
        <DropdownMenu.Item onSelect={async () => { agentController.current?.abort(); await agentTask.current; client.exportSpace().then(() => notify('学习空间已导出')).catch(error => notify(error.message)); }}>导出学习空间</DropdownMenu.Item>
        <DropdownMenu.Separator/>
        <DropdownMenu.Item onSelect={() => setStorageMode('migration')}>迁移浏览器旧数据</DropdownMenu.Item>
        <DropdownMenu.Item onSelect={() => setStorageMode('recovery')}>恢复与回收站</DropdownMenu.Item>
        <DropdownMenu.Item onSelect={() => openDialog('settings')}>空间与图谱设置</DropdownMenu.Item>
      </DropdownMenu.Content></DropdownMenu.Root>
      <button className="search-launch" onClick={() => openDialog('search')}><MagnifyingGlass size={17}/><span>搜索知识</span><kbd>⌘ K</kbd></button>
      <nav className="main-nav">
        {[[Graph, 'graph', '知识图谱'], [Path, 'path', '学习路径'], [NotePencil, 'notes', '我的笔记'], [Books, 'sources', '参考资料']].map(([Icon, id, label]) => <button key={id} className={page === id ? 'active' : ''} onClick={() => { setPage(id); if (id === 'graph') fit(); }}><Icon size={19} weight={page === id ? 'duotone' : 'regular'}/>{label}{id === 'notes' && <span className="nav-count">{Object.values(graph.notes).flat().length}</span>}</button>)}
      </nav>
      <div className="sidebar-section-title"><span>我的图谱 <small>{mapLibrary.maps.length}</small></span><span className="map-actions"><TipButton label="新建图谱" onClick={() => openDialog('new')}><Plus size={15}/></TipButton></span></div>
      <div className="map-list" aria-label="图谱列表">{mapLibrary.maps.map(map => <button key={map.id} className={`map-item ${map.id === activeMapId ? 'active' : ''}`} aria-current={map.id === activeMapId ? 'page' : undefined} onClick={() => switchMap(map.id)}><span className="map-line"/><span>{map.title}</span>{map.id === activeMapId ? <Check size={14}/> : <CaretRight size={14}/>}</button>)}</div>
      <button className="add-map" onClick={() => setStorageMode('graph')}><DownloadSimple size={16}/>导入知识图谱</button>
      <button className="add-map" onClick={() => openDialog('new')}><Plus size={16}/>开始新的探索</button>
      <div className="sidebar-bottom">
        <div className="learning-progress"><div className="progress-title"><span>理解一点，连接一点</span><Sparkle size={17}/></div><div className="progress-value">{mastered}<span> / {graph.nodes.length}</span><small>节点已掌握</small></div><div className="progress-segments" role="img" aria-label={`已掌握 ${mastered} 个，共 ${graph.nodes.length} 个知识点`}>{graph.nodes.map(n => <span key={n.id} className={n.data.status === 'mastered' ? 'filled' : ''}/>)}</div><p>按自己的节奏，把知识连起来。</p></div>
        <div className="sidebar-footer"><button onClick={() => openDialog('help')}><Question size={18}/>使用指南</button><TipButton label={theme === 'dark' ? '切换浅色模式' : '切换深色模式'} onClick={toggleTheme}>{theme === 'dark' ? <Sun/> : <Moon/>}</TipButton></div>
      </div>
      <PanelResizer side="left" width={panelWidths.left} onResize={(width, commit) => handlePanelResize('left', width, commit)} onToggle={() => togglePanel('left')} />
    </aside>

    <header ref={topbarRef} className="topbar"><div className="breadcrumbs"><TipButton label={leftOpen ? '收起导航' : '展开导航'} onClick={() => setLeftOpen(v => !v)}><SidebarSimple/></TipButton><span className="breadcrumb-parent">我的图谱</span><CaretRight size={13}/><span>{graph.title}</span></div><div className="top-actions"><span className="save-status" role="status">{session?.status === 'error' || state.workspaceError ? <WarningCircle size={14}/> : <Check size={14}/>} {state.workspaceError ? '设置未保存' : state.workspacePending ? '设置保存中…' : ({ saved: '已保存到本地文件', pending: '等待保存', saving: '保存中…', error: '保存失败' })[session?.status] || '本地 JSON 空间'}</span><DropdownMenu.Root><DropdownMenu.Trigger><Button aria-label="导出" variant="surface" color="gray" size="2"><UploadSimple size={16}/><span className="export-label">导出</span><CaretDown size={12}/></Button></DropdownMenu.Trigger><DropdownMenu.Content><DropdownMenu.Item onSelect={() => exportGraph('md')}>导出 Markdown 笔记</DropdownMenu.Item><DropdownMenu.Item onSelect={() => exportGraph('json')}>导出 JSON 图谱</DropdownMenu.Item></DropdownMenu.Content></DropdownMenu.Root></div></header>

    <main className="main-content" inert={Boolean(rightOpen && active && panelWidths.right >= contentWidth && window.innerWidth >= 768)}>
      {(session?.error || state.workspaceError || state.data.issues.length > 0) && <div className="save-error-banner" role="alert"><span>{session?.error?.message || state.workspaceError?.message || '本地文件存在问题，请从恢复面板查看'}</span>{state.workspaceError && <button onClick={() => client.retryWorkspace().catch(error => notify(error.message))}>重试设置保存</button>}{session?.error && <><button onClick={() => client.flush(activeMapId).catch(error => notify(error.message))}>重试保存</button><button onClick={() => client.downloadDraft(activeMapId)}>下载本地草稿</button><button onClick={() => { client.downloadDraft(activeMapId); void client.reloadGraph(activeMapId).catch(error => notify(error.message)); }}>备份草稿并加载服务器版本</button></>}<button onClick={() => setStorageMode('recovery')}>查看恢复</button></div>}
      {!activeMapId && <div className="welcome-actions"><Button onClick={() => openDialog('new')}><Plus/>新建知识图谱</Button><Button variant="soft" onClick={() => client.create(starter()).then(() => fit()).catch(error => notify(error.message))}>载入大模型学习示例</Button><Button variant="ghost" onClick={() => setStorageMode('migration')}>迁移浏览器旧数据</Button></div>}

      <div className={`page-heading ${headingCollapsed ? 'is-collapsed' : ''}`}>
        <div className="heading-copy">
          {!headingCollapsed && <div className="page-context"><span className="topic-icon"><BookOpen size={16}/></span><span>我的学习计划</span></div>}
          <div className="heading-title-row"><h1>{graph.title}</h1>{headingCollapsed && <span className="heading-goal-compact" title={graph.goal}><Target size={14}/><span>{graph.goal}</span></span>}</div>
          {!headingCollapsed && <p><Target size={15}/>{graph.goal}</p>}
        </div>
        <div className="heading-actions"><TipButton className="heading-collapse" label={headingCollapsed ? '展开标题区' : '收起标题区'} aria-expanded={!headingCollapsed} onClick={toggleHeading}>{headingCollapsed ? <CaretDown/> : <CaretUp/>}</TipButton><TipButton className="heading-settings" label="图谱设置" onClick={() => openDialog('settings')}><SlidersHorizontal/></TipButton><Button size="2" onClick={requestExpansion} disabled={!active}><Sparkle size={16}/>Agent 扩展</Button></div>
      </div>
      <div className="view-toolbar"><SegmentedControl.Root value={page === 'graph' ? 'graph' : page === 'path' ? 'path' : 'list'} onValueChange={value => { setPage(value === 'list' ? 'notes' : value); if (value === 'graph') fit(); }} size="1"><SegmentedControl.Item value="graph"><Graph size={15}/>图谱</SegmentedControl.Item><SegmentedControl.Item value="path"><Path size={15}/>路径</SegmentedControl.Item>{['notes', 'sources'].includes(page) && <SegmentedControl.Item value="list"><List size={15}/>{page === 'notes' ? '笔记' : '资料'}</SegmentedControl.Item>}</SegmentedControl.Root><span className="node-total">{graph.nodes.length} 个知识节点</span><div className="toolbar-right">{page === 'graph' && <><button aria-label="聚焦前置路径" className={`focus-toggle ${focusPath ? 'active' : ''}`} onClick={() => setFocusPath(v => !v)}><GitBranch size={15}/><span>聚焦前置路径</span></button><Select.Root value={filter} onValueChange={setFilter}><Select.Trigger variant="ghost" color="gray" aria-label="筛选掌握状态"/><Select.Content><Select.Item value="all">全部状态</Select.Item><Select.Item value="learning">学习中</Select.Item><Select.Item value="mastered">已掌握</Select.Item><Select.Item value="todo">未开始</Select.Item></Select.Content></Select.Root></>}{!rightOpen && active && <TipButton label="打开学习助手" onClick={() => togglePanel('right')}><SidebarSimple/></TipButton>}</div></div>

      {page === 'graph' ? <div ref={canvasRef} className="canvas-area">
        {graph.nodes.length ? <><div className="canvas-caption"><span>从基础出发，向应用延伸</span><ArrowRight size={15}/><span>{proposal ? '连线表示学习依赖' : tool === 'cursor' ? '拖动空白处圈选 · ⌘ / Ctrl 点选' : '拖动画布 · Shift 圈选'}</span></div><ReactFlow nodes={displayNodes} edges={displayEdges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={changes => { const updates = changes.filter(change => change.type !== 'select'); if (updates.length) setGraph(g => ({ ...g, edges: applyEdgeChanges(updates, g.edges) })); }} onNodeClick={(event, n) => { if (graph.nodes.some(node => node.id === n.id) && !event.metaKey && !event.ctrlKey) select(n.id, true); }} onConnect={connect} isValidConnection={connection => !connectionProblem(connection.source, connection.target, graph.edges)} onNodeDragStart={() => { history.current.push(clone(graph)); future.current = []; }} onSelectionDragStart={() => { history.current.push(clone(graph)); future.current = []; }} onMoveEnd={(_, viewport) => persistView(viewport)} onInit={fit} fitView fitViewOptions={{ padding: .14, minZoom: .1, maxZoom: 1.1 }} nodesDraggable={!proposal} nodesConnectable={!proposal} panOnDrag={tool === 'hand' ? true : [1, 2]} selectionOnDrag={tool === 'cursor' && !proposal} selectionMode={SelectionMode.Partial} multiSelectionKeyCode={['Meta', 'Control']} selectionKeyCode={proposal ? null : 'Shift'} onSelectionStart={() => setIsSelecting(true)} onSelectionEnd={() => setIsSelecting(false)} panOnScroll zoomOnScroll={false} zoomOnPinch minZoom={.1} maxZoom={1.5} deleteKeyCode={null} colorMode={theme} aria-label="知识学习依赖图" defaultEdgeOptions={CURVED_EDGE_OPTIONS} connectionLineType={ConnectionLineType.Bezier}>
          <Background gap={20} size={1} color={theme === 'dark' ? '#33453c' : '#d9e1dc'}/><MiniMap nodeColor={n => n.id === selectedId ? (theme === 'dark' ? '#7bccac' : '#4c8c6f') : (theme === 'dark' ? '#3d5046' : '#d3dfd7')} nodeStrokeColor="transparent" nodeBorderRadius={3} maskColor={theme === 'dark' ? '#18241d90' : '#f8faf980'} pannable zoomable position="bottom-right" ariaLabel="图谱缩略图"/>
        </ReactFlow><div className="canvas-legend" style={selectedNodes.length > 1 ? { visibility: 'hidden' } : undefined}><span><CheckCircle size={14} weight="fill"/>已掌握</span><span><CircleHalf size={14}/>学习中</span><span><Circle size={14}/>未开始</span>{proposal && <span><Sparkle size={14}/>待采纳</span>}</div></> : <Empty icon={Graph} title="从第一个知识点开始" action={<Button onClick={() => openDialog('add')}><Plus/>添加节点</Button>}>把一个概念放到画布上，再逐步连接它的前置知识与应用。</Empty>}
        <div className="canvas-controls"><div className="control-group"><TipButton label="圈选节点" data-active={tool === 'cursor'} onClick={() => setTool('cursor')}><Cursor size={19}/></TipButton><TipButton label="拖动画布" data-active={tool === 'hand'} onClick={() => setTool('hand')}><Hand size={19}/></TipButton><span className="control-divider"/><TipButton label="添加节点" onClick={() => openDialog('add')}><Plus size={20}/></TipButton><TipButton label="汇总选中节点" onClick={previewSummary} disabled={selectedNodes.length < 2 || !!proposal}><Stack size={19}/></TipButton><TipButton label="建立学习依赖" onClick={() => openDialog('connect')} disabled={graph.nodes.length < 2}><LinkSimple size={19}/></TipButton></div><div className="control-group"><TipButton label="缩小" onClick={() => zoomOut()}><Minus size={16}/></TipButton><button className="zoom-label" onClick={fit} aria-label={`${Math.round(zoom * 100)}% 适应画布`}>{Math.round(zoom * 100)}%</button><TipButton label="放大" onClick={() => zoomIn()}><Plus size={16}/></TipButton><TipButton label="适应画布" onClick={fit}><CornersOut size={17}/></TipButton></div><div className="control-group history-controls"><TipButton label="撤销修改" onClick={undo} disabled={!history.current.length}><ArrowCounterClockwise size={17}/></TipButton><TipButton label="恢复修改" onClick={redo} disabled={!future.current.length}><ArrowClockwise size={17}/></TipButton></div></div>
        {selectedNodes.length > 1 && !proposal && !isSelecting && <div className="selection-bar" aria-label="已选节点操作"><div><strong role="status">已选 {selectedNodes.length} 个知识点</strong><span title={summaryAnchor.data.title}>将替换「{summaryAnchor.data.title}」的位置</span></div><TipButton label="取消多选" onClick={() => setSelectedIds([])}><X size={17}/></TipButton><Button size="2" onClick={previewSummary}><Stack size={16}/>汇总为节点</Button></div>}
        {proposal && <div className="proposal-bar"><Sparkle size={19}/><div><strong>预览新的知识分支</strong><span>选中 {proposalChecks.filter(Boolean).length} 个节点，采纳后加入图谱</span></div><Button variant="ghost" color="gray" onClick={() => { setProposal(null); fit(); }}>取消</Button><Button onClick={acceptProposal} disabled={!proposalChecks.some(Boolean)}>采纳分支<Check size={16}/></Button></div>}
      </div> : page === 'path' ? <div className="content-scroll path-view"><div className="section-intro"><h2>下一步，学什么？</h2><p>按前置知识排序。你可以随时探索，也可以顺着路径继续。</p></div>{ready.length > 0 && <div className="next-learning"><span className="next-icon"><Path size={27}/></span><div><small>现在可以开始</small><h3>{ready[0].data.title}</h3><p>前置知识已掌握，适合继续深入。</p></div><Button onClick={() => { select(ready[0].id); setPage('graph'); fit(); }}>开始学习<ArrowRight size={16}/></Button></div>}<div className="path-list">{ordered.map((n, i) => { const incoming = graph.edges.filter(e => e.target === n.id).map(e => graph.nodes.find(p => p.id === e.source)?.data.title); return <button key={n.id} className={`path-item ${n.data.status}`} onClick={() => select(n.id)}><span className="path-status">{n.data.status === 'mastered' ? <Check size={18}/> : i + 1}</span><div><h3>{n.data.title}<span>{statusLabel[n.data.status]}</span></h3><p>{incoming.length ? `前置知识：${incoming.join('、')}` : '可以直接开始'}</p></div><span className="path-time">{n.data.minutes} 分钟</span><ArrowUpRight size={18}/></button>; })}</div>{!graph.nodes.length && <Empty title="还没有学习路径">先添加知识点与它们之间的依赖。</Empty>}<div className="path-note"><Lightbulb size={18}/><p>「已掌握」由你自评确认。完成一次自测能帮助判断，但不代表已经全面掌握。</p></div></div> : page === 'notes' ? <div className="content-scroll"><div className="section-intro"><h2>把答案，变成自己的理解</h2><p>笔记保存在知识节点上，回到图谱时仍有上下文。</p></div>{graph.nodes.filter(n => graph.notes[n.id]?.length).map(n => <section className="notebook-group" key={n.id}><button onClick={() => { select(n.id); setTab('notes'); }}><NotePencil size={18}/><h3>{n.data.title}</h3><ArrowUpRight size={16}/></button>{graph.notes[n.id].map(note => <MarkdownContent key={note.id} content={note.content}/>)}</section>)}{!Object.values(graph.notes).flat().length && <Empty icon={NotePencil} title="还没有学习笔记">在节点对话中选择「记到笔记」，或直接写下你的理解。</Empty>}</div> : <div className="content-scroll"><div className="section-intro"><h2>理解，也需要依据</h2><p>参考资料连接到对应的知识节点，可直接访问原文。</p></div>{graph.nodes.filter(n => graph.sources[n.id]?.length).map(n => <div className="source-group" key={n.id}><button onClick={() => { select(n.id); setTab('sources'); }}>{n.data.title}<ArrowUpRight size={15}/></button>{graph.sources[n.id].map((source, i) => <SourceCard key={i} source={source}/>)}</div>)}{!graph.nodes.some(n => graph.sources[n.id]?.length) && <Empty icon={Books} title="还没有参考资料">通用模板不附带未经核实的资料链接。</Empty>}</div>}
      <footer className="canvas-footer"><span><span className="footer-square"/>个人知识图谱</span><span className="desktop-hint">拖拽节点整理思路<span className="footer-separator">/</span>拖动分隔条调整面板<span className="footer-separator">/</span>双指移动画布</span><button onClick={() => openDialog('help')}><Keyboard size={15}/><span>快捷键</span></button></footer>
    </main>

    {active && <aside className={`inspector ${rightOpen ? 'open' : ''}`} aria-label="节点学习助手"><PanelResizer side="right" width={Math.min(panelWidths.right, contentWidth)} maxWidth={contentWidth} onResize={(width, commit) => handlePanelResize('right', width, commit)} onToggle={() => togglePanel('right')} /><div className="inspector-top"><span><Sparkle size={19} weight="duotone"/>学习助手</span><span className="demo-label">{state.agentConfigured ? '模型已配置' : '未配置模型'}</span><TipButton label="收起学习助手" onClick={() => togglePanel('right')}><SidebarSimple size={18}/></TipButton></div><NodeDetails node={active} collapsed={nodeDetailsCollapsed} onToggle={() => setNodeDetailsCollapsed(value => !value)} onEdit={() => openDialog('edit')} onDelete={() => openDialog('delete')} onQuiz={requestQuiz} onStatus={status => changeNodeStatus(selectedId, status)}/>
      <div className="inspector-tabs" role="tablist" aria-label="节点内容">{[['chat', '对话'], ['notes', '笔记'], ['sources', '资料']].map(([id, label]) => <button role="tab" id={`tab-${id}`} aria-controls={`panel-${id}`} aria-selected={tab === id} tabIndex={tab === id ? 0 : -1} key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)} onKeyDown={e => { if (['ArrowRight', 'ArrowLeft'].includes(e.key)) { const tabs = ['chat', 'notes', 'sources']; const next = tabs[(tabs.indexOf(tab) + (e.key === 'ArrowRight' ? 1 : 2)) % 3]; setTab(next); setTimeout(() => document.getElementById(`tab-${next}`)?.focus(), 0); } }}>{label}{id === 'notes' && graph.notes[selectedId]?.length > 0 && <span>{graph.notes[selectedId].length}</span>}{id === 'sources' && sources.length > 0 && <span>{sources.length}</span>}</button>)}</div>
      <div className="inspector-body" ref={chatScroll} onScroll={e => { const el = e.currentTarget; followReply.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }} role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'chat' ? <>{proposal ? <div className="proposal-detail"><span className="proposal-kicker"><GitBranch size={18}/>Agent 分支建议</span><h3>把这个知识点再展开一点</h3><p>建议增加以下内容，帮助你从原理走向实践。</p><div className="proposal-context"><span>连接到</span><strong>{active.data.title}</strong><ArrowBendDownRight size={18}/></div>{proposal.items.map((item, i) => <label className="proposal-option" key={item.title}><Checkbox checked={proposalChecks[i]} onCheckedChange={value => setProposalChecks(c => c.map((v, j) => j === i ? !!value : v))}/><span><strong>{item.title}</strong><small>{item.summary}</small><em>关系：后续学习</em></span></label>)}<p className="proposal-footnote">虚线节点是预览。采纳不会修改已有笔记和对话。</p><Button onClick={acceptProposal} disabled={!proposalChecks.some(Boolean)} style={{ width: '100%' }}>采纳分支<Check size={16}/></Button><button className="text-button full-width" onClick={() => { setProposal(null); fit(); }}>暂不添加</button></div> : <><button className="context-strip" onClick={() => openDialog('context')}><Stack size={15}/><span>当前节点 + {prerequisites.length} 个前置知识</span><CaretDown size={13}/></button>{displayMessages.length ? <div className="messages">{displayMessages.map(m => m.role === 'user' ? <div className="user-message" key={m.id}><span>你</span><p>{m.content}</p></div> : <AssistantMessage key={m.id} message={m} streaming={m.streaming} onSave={saveNote} onExpand={requestExpansion} onSources={() => setTab('sources')}/>)}</div> : <div className="conversation-empty"><span className="assistant-avatar"><Graph size={18}/></span><h3>从一个好问题开始</h3><p>关于「{active.data.title}」，你想先理解什么？</p><button onClick={() => send('请用一个例子解释这个概念')}><Lightbulb size={16}/>用一个例子解释<ArrowUpRight size={14}/></button><button onClick={() => send('学习它需要什么前置知识？')}><GitBranch size={16}/>我需要什么基础<ArrowUpRight size={14}/></button></div>}{chatError && pendingRequest?.graphId === activeMapId && pendingRequest?.nodeId === selectedId && <div className="inline-error" role="alert"><WarningCircle size={18}/><div>回复暂时中断，问题已保留。<button onClick={() => send(pendingRequest.question, true)}>重新尝试</button></div></div>}</>}</> : tab === 'notes' ? <div className="node-notes"><h3>{active.data.summarySources ? '知识点汇总总结' : '用自己的话，记住它'}</h3>{active.data.summarySources && <div className="summary-source-links"><span>汇总来源 · {active.data.summarySources.length} 个知识点</span>{active.data.summarySources.map(source => graph.nodes.some(node => node.id === source.id) ? <button key={source.id} onClick={() => select(source.id)}>{source.title}<ArrowUpRight size={13}/></button> : <span className="summary-source-tag" key={source.id}>{source.title}</span>)}</div>}{active.data.summarySources && !(graph.notes[selectedId] || []).some(note => note.content === active.data.summary) && <article className="note-entry"><div><Stack size={15}/><span>汇总正文</span></div><MarkdownContent content={active.data.summary}/></article>}{(graph.notes[selectedId] || []).map((note, i) => <article className="note-entry" key={i}><div><NotePencil size={15}/><span>我的笔记</span><TipButton label={`删除第 ${i + 1} 条笔记`} onClick={() => commit(g => ({ ...g, notes: { ...g.notes, [selectedId]: g.notes[selectedId].filter((_, index) => index !== i) } }))}><Trash size={14}/></TipButton></div><MarkdownContent content={note.content}/></article>)}{!graph.notes[selectedId]?.length && <p className="muted">还没有笔记。可以保存对话片段，也可以写下自己的理解。</p>}<label className="field-label" htmlFor="note-draft">添加笔记</label><TextArea id="note-draft" placeholder="我现在的理解是……" rows={5} value={noteDraft} onChange={e => setNoteDraft(e.target.value)}/><Button onClick={() => saveNote(noteDraft)} disabled={!noteDraft.trim()}><Plus size={15}/>保存笔记</Button></div> : <div className="node-sources"><h3>这个概念的参考资料</h3><p className="muted">打开原文核对定义、前提和结论。</p>{sources.map((source, i) => <SourceCard key={i} source={source}/>)}{!sources.length && <Empty icon={Books} title="暂未收录资料">可以在下方添加可信资料链接。</Empty>}<div className="source-form"><label htmlFor="source-title">资料标题</label><TextField.Root id="source-title" value={sourceTitle} onChange={e => setSourceTitle(e.target.value)} placeholder="例如：官方使用文档"/><label htmlFor="source-url">资料链接</label><TextField.Root id="source-url" value={sourceUrl} onChange={e => setSourceUrl(e.target.value)} placeholder="https://…"/><Button onClick={saveSource} disabled={!sourceTitle.trim() || !sourceUrl.trim()}><Plus size={14}/>添加参考资料</Button></div></div>}
      </div>
      {tab === 'chat' && !proposal && <div className="composer-wrap"><div className="quick-prompts"><button onClick={() => send('举个实际例子')} disabled={busy}>举个实际例子<ArrowUpRight size={12}/></button><button onClick={requestExpansion}>扩展这个知识点<GitBranch size={13}/></button></div><form className="composer" onSubmit={e => { e.preventDefault(); send(); }}><label htmlFor="agent-prompt">围绕这个节点提问</label><textarea id="agent-prompt" placeholder="哪里还没理解？接着问……" rows={2} value={prompt} onChange={e => setPrompt(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }}/><div className="composer-bottom"><button type="button" className="scope-button" onClick={() => openDialog('context')}><TreeStructure size={14}/>节点上下文</button>{busy ? <button type="button" className="stop-button" onClick={() => { agentController.current?.abort(); notify('已停止生成，已收到的内容会保存'); }}>停止</button> : <IconButton type="submit" size="1" disabled={!prompt.trim()} aria-label="发送问题"><ArrowUp size={17} weight="bold"/></IconButton>}</div></form><div className="composer-disclaimer">{state.agentConfigured ? '回答由已配置的模型生成，请核对依据' : '未配置模型 · 手工编辑与本地汇总仍可使用'}<span>Shift + Enter 换行</span></div></div>}
    </aside>}

    <Dialog.Root open={!!dialog} onOpenChange={open => { if (!open && createState !== 'loading' && !configBusy) { setDialog(null); setSearch(''); } }}><Dialog.Content maxWidth={dialog === 'new' || dialog === 'summary' ? '660px' : dialog === 'help' || dialog === 'config' ? '600px' : '540px'} className={`app-dialog ${dialog === 'new' ? 'new-map-dialog' : ''}`}><Dialog.Title>{({ new: '你的下一次探索，从这里开始', add: '添加一个知识点', edit: '编辑知识点', summary: '汇总为一个知识节点', search: '搜索你的知识图谱', context: '这次对话参考什么', quiz: '用一个问题，检查理解', connect: '建立学习依赖', settings: '图谱设置', config: '模型与服务配置', help: '把知识连接起来', delete: '删除这个节点？', deleteGraph: '将图谱移入回收站？' })[dialog] || ''}</Dialog.Title><Dialog.Description size="2" color="gray">{({ new: '告诉学习伙伴你想理解什么，把模糊的兴趣变成清楚的学习起点。', add: active ? `新节点将作为「${active.data.title}」的后续学习内容。` : '从一个概念、方法或问题开始。', edit: '编辑知识点的名称、类别、简短摘要与详细概念介绍。', summary: '根据所选节点的说明、笔记与学习关系整理，可修改后替换原始节点。', search: '按标题或说明查找，选中后回到对应节点。', context: '对话按节点保存。当前节点的定义与前置知识构成学习上下文。', quiz: '自测帮助你发现遗漏，掌握状态仍由你自己判断。', connect: '箭头从前置知识指向后续知识，允许多个前置节点。', settings: '修改名称、整理布局，或管理本地学习内容。', config: '配置保存在本机 JSON 文件中；API Key 仅以密码框掩码显示。', help: '概念是节点，学习依赖是连线，对话围绕当前知识点展开。', delete: '将移除这个节点及其连线、笔记、对话、资料与测验，其他节点会保留。你可以撤销。', deleteGraph: '图谱将从当前列表移除，可从空间菜单的恢复与回收站中找回。' })[dialog]}</Dialog.Description><TipButton label="关闭弹窗" className="dialog-close" disabled={createState === 'loading' || configBusy} onClick={() => setDialog(null)}><X/></TipButton>
      {dialog === 'new' && <div className="new-map-form">{createState === 'loading' ? <div className="creating-map" role="status"><Graph size={40}/><h3>正在整理学习起点</h3><p>连接核心概念、常用方法与最小实践……</p><div className="loading-answer"><span/><span/><span/></div></div> : <><label className="field-label" htmlFor="topic">我想学习的领域</label><TextField.Root id="topic" size="3" placeholder="例如：大模型应用、行为经济学、摄影构图" value={newTitle} onChange={e => setNewTitle(e.target.value)}/><div className="topic-suggestions">{['大模型应用', '行为经济学', '摄影构图'].map(t => <button key={t} onClick={() => setNewTitle(t)}>{t}<Plus size={12}/></button>)}</div><label className="field-label" htmlFor="goal">学完后，我希望能够 <span>选填</span></label><TextArea id="goal" size="3" rows={3} placeholder="例如：独立搭建一个能回答团队文档问题的助手" value={newGoal} onChange={e => setNewGoal(e.target.value)}/><div className="form-two-col"><div><label className="field-label" htmlFor="level">现在的基础</label><Select.Root value={newLevel} onValueChange={setNewLevel}><Select.Trigger id="level" style={{ width: '100%' }} size="3"/><Select.Content><Select.Item value="starter">刚刚开始接触</Select.Item><Select.Item value="some">了解一些概念</Select.Item></Select.Content></Select.Root></div><div><label className="field-label" htmlFor="duration">每天愿意投入</label><Select.Root value={newDuration} onValueChange={setNewDuration}><Select.Trigger id="duration" style={{ width: '100%' }} size="3"/><Select.Content><Select.Item value="15">15 分钟</Select.Item><Select.Item value="30">30 分钟</Select.Item><Select.Item value="60">60 分钟</Select.Item></Select.Content></Select.Root></div></div><div className="onboarding-note"><GitBranch size={21}/><div><strong>先有骨架，再长出自己的理解</strong><p>可选择通用模板快速开始，或使用已配置模型生成专属图谱草稿。生成的草稿需预览后采纳。</p></div></div>{formError && <p className="form-error" role="alert">{formError}</p>}<div className="dialog-actions"><Button variant="ghost" color="gray" onClick={() => createMap(true)}>从空白开始</Button><Button variant="soft" onClick={() => createMap()}>使用通用模板</Button><Button size="3" disabled={!state.agentConfigured} onClick={() => createMap(false, true)}><Sparkle size={18}/>AI 生成草稿<ArrowRight size={17}/></Button></div></>}</div>}
      {['add', 'edit'].includes(dialog) && <div className="dialog-form"><label className="field-label" htmlFor="knowledge-title">知识点名称</label><TextField.Root id="knowledge-title" placeholder="例如：检索质量评估" value={newKnowledge} onChange={e => setNewKnowledge(e.target.value)}/><label className="field-label" htmlFor="knowledge-kind">节点类别</label><Select.Root value={newKind} onValueChange={setNewKind}><Select.Trigger id="knowledge-kind" style={{ width: '100%' }}/><Select.Content>{[...new Set([...NODE_KIND_OPTIONS, newKind])].map(kind => <Select.Item key={kind} value={kind}>{kind}{kind === '自建知识' ? '（默认）' : ''}</Select.Item>)}</Select.Content></Select.Root><p className="field-help">类别用于节点卡片上的识别标签，不会改变学习依赖关系。</p><label className="field-label" htmlFor="knowledge-summary">知识摘要</label><TextArea id="knowledge-summary" placeholder="用一句话概括这个知识点" rows={2} value={newSubtitle} onChange={e => setNewSubtitle(e.target.value)}/><label className="field-label" htmlFor="knowledge-description">概念介绍</label><TextArea id="knowledge-description" placeholder="详细解释概念的定义、工作原理、使用场景，并举一个例子" rows={5} value={newDescription} onChange={e => setNewDescription(e.target.value)}/>{formError && <p className="form-error" role="alert">{formError}</p>}<div className="dialog-actions"><Button onClick={addNode}>{dialog === 'edit' ? '保存修改' : '添加节点'}<Plus size={16}/></Button></div></div>}
      {dialog === 'summary' && summaryDraft && <div className="dialog-form summary-form"><div className="summary-selection"><span>已选 {summaryDraft.sourceIds.length} 个知识点 · 按学习依赖排序</span><div>{summaryDraft.sourceIds.map((id, index) => <span key={id}>{index + 1}. {graph.nodes.find(node => node.id === id)?.data.title}</span>)}</div></div><div className="summary-connection"><GitBranch size={19}/><div><p>新节点将替换<strong>「{graph.nodes.find(node => node.id === summaryDraft.sourceIds[0])?.data.title}」</strong>的位置。</p><p>父节点：<strong>{summaryParentNames.length ? summaryParentNames.join('、') : '无，汇总节点将作为根节点'}</strong>。{summaryChildCount} 个外部子节点将连接到汇总节点。</p><p>将删除这 {summaryDraft.sourceIds.length} 个原始节点及其独立笔记、对话；节点说明与笔记已整理到下方。可撤销恢复。</p></div></div><label className="field-label" htmlFor="summary-title">汇总节点名称</label><TextField.Root id="summary-title" value={summaryDraft.title} onChange={event => setSummaryDraft(draft => ({ ...draft, title: event.target.value }))}/><label className="field-label" htmlFor="summary-content">汇总内容 <span>可编辑</span></label><TextArea id="summary-content" rows={10} value={summaryDraft.content} onChange={event => setSummaryDraft(draft => ({ ...draft, content: event.target.value }))}/><p className="muted summary-method">{summaryDraft.ai ? '已根据选中内容生成 AI 汇总草稿，请核对后采纳。' : '使用已有内容整理要点。完整汇总会同时保存为新节点的笔记。'}</p><Button variant="soft" disabled={!state.agentConfigured || busy} onClick={async () => { setBusy(true); try {
          const requestGeneration = client.generation; await client.flush(activeMapId); const baseVersion = session.version, baseRevision = client.graph().revision;
          const result = await api('/agent/generate', { method: 'POST', generation: client.generation, body: { requestId: crypto.randomUUID(), kind: 'summary', graphId: activeMapId, sourceIds: summaryDraft.sourceIds, baseRevision } });
          if (client.generation !== requestGeneration || session.version !== baseVersion) throw new Error('图谱已改变，请重新汇总');
          setSummaryDraft(draft => ({ ...draft, ...result.draft, ai: true, baseVersion, baseRevision }));
        } catch (error) { setFormError(error.message); } finally { setBusy(false); } }}>使用 AI 整理汇总</Button>{formError && <p className="form-error" role="alert">{formError}</p>}<div className="dialog-actions"><Button variant="surface" color="gray" onClick={() => setDialog(null)}>返回圈选</Button><Button onClick={acceptSummary} disabled={!summaryDraft.title.trim() || !summaryDraft.content.trim()}><Stack size={16}/>汇总并替换节点</Button></div></div>}
      {dialog === 'search' && <div className="dialog-form"><label className="field-label" htmlFor="search-input">关键词</label><TextField.Root id="search-input" placeholder="输入知识点名称……" value={search} onChange={e => setSearch(e.target.value)}><TextField.Slot><MagnifyingGlass/></TextField.Slot></TextField.Root><div className="search-results">{graph.nodes.filter(n => [n.data.title, n.data.subtitle, n.data.summary, n.data.description].some(value => value?.toLowerCase().includes(search.toLowerCase()))).map(n => <button key={n.id} onClick={() => { select(n.id); setPage('graph'); setDialog(null); setSearch(''); fit(); }}><BookOpen size={18}/><span><strong>{n.data.title}</strong><small>{n.data.subtitle}</small></span><ArrowUpRight size={17}/></button>)}{!graph.nodes.some(n => [n.data.title, n.data.subtitle, n.data.summary, n.data.description].some(value => value?.toLowerCase().includes(search.toLowerCase()))) && <Empty icon={MagnifyingGlass} title="没有找到这个知识点">换个关键词试试，或将它添加为新节点。</Empty>}</div></div>}
      {dialog === 'context' && <div className="context-list"><div><TreeStructure size={20}/><span><small>当前节点</small><strong>{active?.data.title}</strong></span><CheckCircle size={18}/></div>{prerequisites.map(n => <button key={n.id} onClick={() => { select(n.id); setDialog(null); }}><GitBranch size={18}/><span><small>前置知识</small><strong>{n.data.title}</strong></span><ArrowUpRight size={18}/></button>)}<p>模型上下文包含当前知识点、前置摘要、资料链接和当前节点已保存的对话。其他分支的对话不进入本次上下文。</p></div>}
      {dialog === 'quiz' && quiz && <div className="quiz-content"><div className="quiz-topic"><BookOpen size={16}/>{active.data.title}<span>节点自测</span></div><h3>{quiz.question}</h3><div className="quiz-options" role="radiogroup" aria-label="选择答案">{quiz.answers.map((answer, i) => <button role="radio" aria-checked={quizAnswer === i} key={answer} className={`${quizAnswer === i ? 'chosen' : ''} ${quizChecked && i === quiz.correct ? 'correct' : ''}`} onClick={() => { setQuizAnswer(i); setQuizChecked(false); }}><span>{String.fromCharCode(65 + i)}</span>{answer}{quizChecked && i === quiz.correct && <CheckCircle size={18}/>}</button>)}</div>{quizChecked && <div className={`quiz-feedback ${quizAnswer === quiz.correct ? 'success' : ''}`} role="status"><strong>{quizAnswer === quiz.correct ? '理解正确，再把它讲给自己听。' : '再想一想，关键在这一步。'}</strong><p>{quiz.explanation}</p></div>}<div className="dialog-actions">{quizChecked && quizAnswer === quiz.correct ? <Button onClick={() => { changeNodeStatus(selectedId, 'mastered'); setDialog(null); }}>标记已掌握（自评）<Check size={16}/></Button> : <Button disabled={quizAnswer === null} onClick={() => { setQuizChecked(true); commit(g => ({ ...g, quizzes: { ...g.quizzes, [selectedId]: g.quizzes[selectedId].map(q => q.id === quiz.id ? { ...q, attempts: [...q.attempts, { id: crypto.randomUUID(), selectedIndex: quizAnswer, correct: quizAnswer === q.correct, createdAt: new Date().toISOString() }] } : q) } })); }}>查看解析<ArrowRight size={16}/></Button>}</div></div>}
      {dialog === 'connect' && <div className="dialog-form"><label className="field-label" htmlFor="edge-source">先学习</label><Select.Root value={edgeSource} onValueChange={setEdgeSource}><Select.Trigger id="edge-source" style={{ width: '100%' }}/><Select.Content>{graph.nodes.map(n => <Select.Item key={n.id} value={n.id}>{n.data.title}</Select.Item>)}</Select.Content></Select.Root><label className="field-label" htmlFor="edge-target">再学习</label><Select.Root value={edgeTarget} onValueChange={value => { setEdgeTarget(value); setFormError(''); }}><Select.Trigger id="edge-target" placeholder="选择后续知识点" style={{ width: '100%' }}/><Select.Content>{graph.nodes.map(n => <Select.Item key={n.id} value={n.id}>{n.data.title}</Select.Item>)}</Select.Content></Select.Root>{formError && <p className="form-error" role="alert">{formError}</p>}<div className="dialog-actions"><Button disabled={!edgeSource || !edgeTarget} onClick={() => { if (connect({ source: edgeSource, target: edgeTarget })) setDialog(null); }}>建立依赖<LinkSimple size={16}/></Button></div></div>}
      {dialog === 'settings' && <div className="dialog-form">
        <label className="field-label" htmlFor="workspace-name">学习空间名称</label><TextField.Root id="workspace-name" value={workspaceName} onChange={e => setWorkspaceName(e.target.value)}/>
        {activeMapId && <><label className="field-label" htmlFor="graph-title">图谱名称</label><TextField.Root id="graph-title" value={newTitle} onChange={e => setNewTitle(e.target.value)}/><label className="field-label" htmlFor="graph-goal">学习目标</label><TextArea id="graph-goal" value={newGoal} onChange={e => setNewGoal(e.target.value)}/></>}
        <div className="dialog-actions"><Button disabled={!workspaceName.trim() || (activeMapId && !newTitle.trim())} onClick={async () => { try { await client.patch({ name: workspaceName.trim() }); if (activeMapId) commit(g => ({ ...g, title: newTitle.trim(), goal: newGoal.trim() })); setDialog(null); } catch (error) { notify(error.message); } }}>保存设置</Button></div>
        <div className="settings-list"><button onClick={() => setDialog('config')}><Sparkle/><span><strong>模型与服务配置</strong><small>{state.agentConfigured ? '模型已配置，可查看、导出或导入连接' : '尚未配置模型，可从本机 JSON 导入'}</small></span><ArrowUpRight/></button>
        <button disabled={!activeMapId} onClick={() => { commit(g => ({ ...g, nodes: autoLayout(g.nodes, g.edges) })); setPage('graph'); setDialog(null); fit(); }}><TreeStructure/><span><strong>自动整理布局</strong><small>按学习依赖重新排列，可以撤销</small></span><ArrowUpRight/></button>
        <button onClick={() => { setDialog(null); setStorageMode('recovery'); }}><ArrowCounterClockwise/><span><strong>历史版本与空间回退点</strong><small>恢复图谱、整个学习空间或回收站条目</small></span><ArrowUpRight/></button>
        {activeMapId && <button onClick={() => setDialog('deleteGraph')}><Trash/><span><strong>将当前图谱移入回收站</strong><small>保留文件，可从回收站恢复</small></span><ArrowUpRight/></button>}</div>
        <p className="field-help">模板类别来自模板定义；AI 类别由模型按内容生成；手工节点默认“自建知识”，可自行选择。模型连接配置可在“模型与服务配置”中查看、导入和导出。</p>
      </div>}
      {dialog === 'config' && <div className="dialog-form config-form">
        {configBusy && !modelConfig.baseUrl && <p className="field-help">正在读取本地配置…</p>}
        <label className="field-label" htmlFor="model-base-url">模型端点</label><TextField.Root id="model-base-url" placeholder="例如：https://api.example.com/v1" value={modelConfig.baseUrl} readOnly disabled={configBusy}/>
        <label className="field-label" htmlFor="model-name">模型名称</label><TextField.Root id="model-name" placeholder="例如：gpt-4o-mini" value={modelConfig.model} readOnly disabled={configBusy}/>
        <label className="field-label" htmlFor="model-timeout">请求超时（毫秒）</label><TextField.Root id="model-timeout" type="number" value={modelConfig.timeoutMs} readOnly disabled={configBusy}/>
        <label className="field-label" htmlFor="model-api-key">API Key</label><TextField.Root id="model-api-key" type="password" autoComplete="off" value={modelConfig.apiKeyConfigured ? 'configured-key' : ''} placeholder={modelConfig.apiKeyConfigured ? undefined : '未配置'} readOnly disabled={configBusy}/>
        {formError && <p className="form-error" role="alert">{formError}</p>}
        <div className="config-actions"><Button variant="soft" color="gray" disabled={configBusy} onClick={() => void exportModelConfig()}><UploadSimple size={16}/>导出配置</Button><label className="config-file-choice"><DownloadSimple size={16}/>导入配置<input type="file" accept=".json,application/json" disabled={configBusy} onChange={event => void importModelConfig(event)}/></label></div>
        <p className="field-help">导出文件不会包含 API Key；导入不含密钥的配置时，会保留当前本地密钥。配置文件位于本地数据目录，并限制为当前用户可读写。</p>
      </div>}
      {dialog === 'help' && <div className="help-content"><div><Graph size={23}/><span><strong>在图里探索</strong><p>点击节点打开学习助手。拖动节点整理布局，拖动侧边分隔条调整面板宽度，双击或按 Enter 收起面板。</p></span></div><div><GitBranch size={23}/><span><strong>把建议变成知识</strong><p>选择「Agent 扩展」预览新分支。虚线表示尚未采纳，确认后才进入图谱。</p></span></div><div><Stack size={23}/><span><strong>把多个知识点汇总起来</strong><p>使用选择工具在空白处拖动圈选，或按住 ⌘ / Ctrl 点击多个节点（键盘聚焦节点后可按 ⌘ / Ctrl + Enter 多选）。选择「汇总为节点」，编辑总结后替换原节点。新节点继承最早选中节点的位置和父节点，原节点的外部子节点改接到新节点，可撤销恢复。</p></span></div><div><NotePencil size={23}/><span><strong>留下自己的理解</strong><p>每个节点有独立的对话、笔记和参考资料。自测后可由你确认掌握状态。</p></span></div><div className="shortcuts"><span>搜索知识<kbd>⌘ / Ctrl K</kbd></span><span>撤销修改<kbd>⌘ / Ctrl Z</kbd></span><span>恢复修改<kbd>⌘ / Ctrl ⇧ Z</kbd></span></div><p className="prototype-explainer">图谱列表、节点和学习记录以 JSON 文件保存在本机。顶部菜单导出单张图谱，空间菜单导入导出整个学习空间，也可管理回退点。模型配置保存在本机 JSON；未配置时可继续手工编辑。</p></div>}
      {dialog === 'delete' && <div className="dialog-actions"><Button variant="surface" color="gray" onClick={() => setDialog(null)}>保留节点</Button><Button color="red" onClick={() => { commit(g => { return { ...g, ...removeNodeContent(g, [selectedId]), nodes: g.nodes.filter(n => n.id !== selectedId), edges: g.edges.filter(e => e.source !== selectedId && e.target !== selectedId) }; }); setDialog(null); notify('节点已删除，可使用撤销恢复'); }}>删除节点</Button></div>}
      {dialog === 'deleteGraph' && <div className="dialog-actions"><Button color="gray" variant="soft" onClick={() => setDialog(null)}>保留图谱</Button><Button color="red" onClick={async () => { try { await client.flush(activeMapId); await api(`/graphs/${activeMapId}`, { method: 'DELETE', generation: client.generation, body: { expectedRevision: client.graph().revision, mutationId: crypto.randomUUID() } }); await client.bootstrap(true); setDialog(null); notify('图谱已移入回收站'); } catch (error) { notify(error.message); } }}>移入回收站</Button></div>}
      {generatedDraft && ((dialog === 'new' && generatedDraft.kind === 'graph') || (dialog === 'quiz' && generatedDraft.kind === 'quiz')) && <div className="generated-preview"><h3>待采纳草稿</h3>{generatedDraft.kind === 'graph' ? <><p>{generatedDraft.draft.title} · {generatedDraft.draft.nodes.length} 个节点</p><ul>{generatedDraft.draft.nodes.map(node => <li key={node.id}>{node.data.title} · {node.data.kind}</li>)}</ul></> : <><p>{generatedDraft.draft.question}</p><ol>{generatedDraft.draft.answers.map(answer => <li key={answer}>{answer}</li>)}</ol><p>{generatedDraft.draft.explanation}</p></>}
        <Button onClick={async () => { try {
          if (generatedDraft.kind === 'graph') { if (generatedDraft.generationId !== client.generation) throw new Error('空间已改变，请重新生成'); await client.create(generatedDraft.draft); setDialog(null); fit(); }
          else { if (generatedDraft.generationId !== client.generation || generatedDraft.baseRevision !== graph.revision || generatedDraft.baseVersion !== session.version || generatedDraft.nodeId !== selectedId) throw new Error('知识点已变化，请重新生成'); commit(g => ({ ...g, quizzes: { ...g.quizzes, [selectedId]: [...(g.quizzes[selectedId] || []), generatedDraft.draft] } })); }
          setGeneratedDraft(null); notify('草稿已采纳');
        } catch (error) { notify(error.message); } }}>采纳草稿</Button><Button variant="ghost" color="gray" onClick={() => setGeneratedDraft(null)}>放弃</Button></div>}
    </Dialog.Content></Dialog.Root>
    <StorageDialog client={client} mode={storageMode} close={() => setStorageModeRaw(null)} notify={notify}/>
    {toast && <div className="toast" role="status"><CheckCircle size={18}/>{toast}<button onClick={() => setToast('')} aria-label="关闭提示"><X size={15}/></button></div>}
  </div>;
}

function SourceCard({ source }) { return <a className="source-card" href={source.url} target="_blank" rel="noreferrer"><span className="source-icon"><FileText size={22}/></span><div><span className="source-type">{source.type}</span><h4>{source.title}</h4><small>{source.meta}</small><p>{source.note}</p></div><ArrowUpRight size={17}/></a>; }

export default function App() {
  const state = useWorkspace();
  const theme = state.data?.workspace.theme || 'light';
  const toggleTheme = () => { void client.patch({ theme: theme === 'dark' ? 'light' : 'dark' }).catch(() => {}); };
  useEffect(() => { void client.bootstrap().catch(() => {}); }, []);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  return <Theme appearance={theme} accentColor="jade" grayColor="sage" radius="medium" scaling="100%" panelBackground="solid">
    {state.data ? <ReactFlowProvider><Workbench theme={theme} toggleTheme={toggleTheme}/></ReactFlowProvider> : <div className="startup-screen"><Graph size={40}/><h1>Thinkraph</h1><p>{state.error?.message || '正在打开本地学习空间…'}</p>{state.error && <Button onClick={() => client.bootstrap().catch(() => {})}>重新连接</Button>}</div>}
  </Theme>;
}
