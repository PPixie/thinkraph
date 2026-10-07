import test from 'node:test';
import assert from 'node:assert/strict';
import { connectionProblem, ancestors, availableNodes, learningOrder, autoLayout, summarySources, createSummaryDraft, addSummaryNode } from '../src/graph.js';
import { seedNodes, seedEdges } from '../src/data.js';

test('reject self links, duplicate edges and transitive cycles', () => {
  assert.ok(connectionProblem('llm', 'llm', seedEdges));
  assert.ok(connectionProblem('llm', 'prompt', seedEdges));
  assert.ok(connectionProblem('rag', 'llm', seedEdges));
  assert.equal(connectionProblem('embedding', 'agent', seedEdges), '');
});
test('multi-parent concepts preserve every prerequisite', () => {
  assert.deepEqual([...ancestors('rag', seedEdges)].sort(), ['embedding', 'llm', 'prompt', 'vector']);
});
test('a node is ready only when all prerequisites are mastered', () => {
  assert.deepEqual(availableNodes(seedNodes, seedEdges).map(n => n.id), ['context', 'rag']);
  const blocked = seedNodes.map(n => n.id === 'embedding' ? { ...n, data: { ...n.data, status: 'learning' } } : n);
  assert.ok(!availableNodes(blocked, seedEdges).some(n => n.id === 'rag'));
});
test('learning path puts all prerequisites before downstream concepts', () => {
  const order = learningOrder(seedNodes, seedEdges).map(n => n.id);
  for (const edge of seedEdges) assert.ok(order.indexOf(edge.source) < order.indexOf(edge.target));
  assert.throws(() => learningOrder(seedNodes, [...seedEdges, { source: 'rag', target: 'llm' }]));
});
test('layout remains topological and handles an empty graph', () => {
  const layout = autoLayout(seedNodes, seedEdges);
  for (const edge of seedEdges) assert.ok(layout.find(n => n.id === edge.source).position.x < layout.find(n => n.id === edge.target).position.x);
  assert.deepEqual(autoLayout([], []), []);
});

test('summary anchor follows dependencies even when selection and canvas order are reversed', () => {
  const graph = { nodes: [...seedNodes].reverse().map(node => ({ ...node, position: { x: -node.position.x, y: node.position.y } })), edges: seedEdges, notes: {}, messages: {} };
  const draft = createSummaryDraft(graph, ['rag', 'llm']);
  const result = addSummaryNode(graph, draft, 'summary');
  assert.deepEqual(draft.sourceIds, ['llm', 'rag']);
  assert.deepEqual(result.nodes.find(node => node.id === 'summary').position, graph.nodes.find(node => node.id === 'llm').position);
  assert.equal(result.edges.filter(edge => edge.target === 'summary').length, 0);
  assert.deepEqual(result.edges.filter(edge => edge.source === 'summary').map(edge => edge.target).sort(), ['context', 'prompt']);
  assert.equal(result.nodes.length, graph.nodes.length - 1);
  assert.ok(!result.nodes.some(node => draft.sourceIds.includes(node.id)));
  assert.doesNotThrow(() => learningOrder(result.nodes, result.edges));
});

test('summary handles multiple roots and parents using the same stable order as the learning path', () => {
  const ids = ['rag', 'embedding', 'prompt', 'vector'];
  const result = summarySources(seedNodes, seedEdges, ids);
  assert.deepEqual(result.map(node => node.id), learningOrder(seedNodes, seedEdges).filter(node => ids.includes(node.id)).map(node => node.id));
  assert.equal(result[0].id, 'vector');
});

test('summary includes real content, unique notes and only existing direct relationships', () => {
  const graph = { nodes: seedNodes, edges: seedEdges, notes: { rag: ['检查检索依据', '检查检索依据', seedNodes.find(node => node.id === 'rag').data.summary], llm: ['不应包含的笔记'] } };
  const draft = createSummaryDraft(graph, ['rag', 'embedding', 'prompt']);
  for (const id of draft.sourceIds) assert.ok(draft.content.includes(seedNodes.find(node => node.id === id).data.summary));
  for (const id of draft.sourceIds) assert.ok(draft.content.includes(seedNodes.find(node => node.id === id).data.description));
  assert.equal(draft.content.match(/检查检索依据/g).length, 1);
  assert.equal(draft.content.split(seedNodes.find(node => node.id === 'rag').data.summary).length - 1, 1);
  assert.ok(!draft.content.includes('不应包含的笔记'));
  assert.ok(draft.content.includes('Embedding → RAG 检索增强生成'));
  assert.ok(draft.content.includes('提示词工程 → RAG 检索增强生成'));
  assert.ok(!draft.content.includes('提示词工程 → Embedding'));
});

test('summary replacement removes source records, preserves unrelated content and never mutates the undo snapshot', () => {
  const graph = { nodes: structuredClone(seedNodes), edges: structuredClone(seedEdges), notes: { rag: ['原始笔记'], llm: ['其他笔记'] }, messages: { rag: [{ role: 'user', text: '原始问题' }], llm: [{ role: 'user', text: '其他问题' }] } };
  const before = structuredClone(graph);
  const draft = { ...createSummaryDraft(graph, ['embedding', 'rag']), title: '  检索过程总结  ', content: '  整理后的知识总结。  ' };
  const result = addSummaryNode(graph, draft, 'summary');
  const node = result.nodes.find(node => node.id === 'summary');
  assert.deepEqual(graph, before);
  assert.deepEqual(result.nodes.filter(node => node.id !== 'summary'), graph.nodes.filter(node => !draft.sourceIds.includes(node.id)));
  assert.deepEqual(result.edges.filter(edge => edge.source !== 'summary' && edge.target !== 'summary'), graph.edges.filter(edge => !draft.sourceIds.includes(edge.source) && !draft.sourceIds.includes(edge.target)));
  assert.deepEqual(result.notes, { llm: ['其他笔记'], summary: ['整理后的知识总结。'] });
  assert.deepEqual(result.messages, { llm: [{ role: 'user', text: '其他问题' }] });
  assert.equal(node.data.title, '检索过程总结');
  assert.equal(node.data.summary, '整理 2 个知识点的概念、笔记与学习联系。');
  assert.equal(node.data.description, '整理后的知识总结。');
  assert.deepEqual(result.notes.summary, ['整理后的知识总结。']);
  assert.deepEqual(node.data.summarySources.map(source => source.id), ['embedding', 'rag']);
  assert.equal(node.data.status, 'todo');
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
});

test('summary takes the earliest selected node’s position and preserves sibling order', () => {
  const graph = { nodes: seedNodes, edges: seedEdges, notes: {} };
  const draft = createSummaryDraft(graph, ['llm', 'prompt', 'embedding']);
  const result = addSummaryNode(graph, draft, 'summary');
  assert.deepEqual(result.nodes[0].position, seedNodes[0].position);
  assert.deepEqual(result.nodes.map(node => node.id), ['summary', 'vector', 'context', 'rag', 'agent']);
});

function fixture(ids, pairs) {
  return {
    nodes: ids.map((id, index) => ({ id, position: { x: index * 100, y: 50 }, data: { title: id, summary: `${id} 的说明`, status: 'todo' } })),
    edges: pairs.map(([source, target]) => ({ id: `${source}-${target}`, source, target, type: 'default' })),
    notes: {}, messages: {}
  };
}

test('summary inherits every anchor parent and redirects all external children with shared children deduplicated', () => {
  const graph = fixture(['p1', 'p2', 'other', 'a', 'b', 'x', 'y', 'z'], [
    ['p1', 'a'], ['p2', 'a'], ['a', 'b'], ['other', 'b'],
    ['a', 'x'], ['b', 'x'], ['b', 'y'], ['other', 'x'], ['other', 'z']
  ]);
  const result = addSummaryNode(graph, createSummaryDraft(graph, ['b', 'a']), 'summary');
  const pairs = result.edges.map(edge => `${edge.source}>${edge.target}`).sort();
  assert.deepEqual(pairs, ['other>x', 'other>z', 'p1>summary', 'p2>summary', 'summary>x', 'summary>y']);
  assert.ok(!result.edges.some(edge => ['a', 'b'].includes(edge.source) || ['a', 'b'].includes(edge.target)));
  assert.equal(new Set(result.edges.map(edge => edge.id)).size, result.edges.length);
  assert.doesNotThrow(() => learningOrder(result.nodes, result.edges));
});

test('non-contiguous selections keep intermediate children and remain acyclic', () => {
  const graph = fixture(['p', 'a', 'between', 'b', 'child'], [['p', 'a'], ['a', 'between'], ['between', 'b'], ['b', 'child']]);
  const result = addSummaryNode(graph, createSummaryDraft(graph, ['b', 'a']), 'summary');
  assert.deepEqual(result.edges.map(edge => `${edge.source}>${edge.target}`).sort(), ['p>summary', 'summary>between', 'summary>child']);
  assert.doesNotThrow(() => learningOrder(result.nodes, result.edges));
});

test('selecting the entire graph produces one root without self links, orphan records or stale handles', () => {
  const graph = fixture(['a', 'b', 'c'], [['a', 'b'], ['b', 'c']]);
  graph.notes.b = ['笔记']; graph.messages.c = [{ role: 'user', text: '问题' }];
  const result = addSummaryNode(graph, createSummaryDraft(graph, ['c', 'a', 'b']), 'summary');
  assert.deepEqual(result.nodes.map(node => node.id), ['summary']);
  assert.deepEqual(result.edges, []);
  assert.deepEqual(Object.keys(result.notes), ['summary']);
  assert.deepEqual(result.messages, {});
});

test('rewired edges preserve external endpoint metadata and get unique IDs', () => {
  const graph = fixture(['p', 'a', 'b', 'x', 'u', 'v'], [['p', 'a'], ['a', 'b'], ['b', 'x'], ['u', 'v']]);
  graph.edges[0] = { ...graph.edges[0], sourceHandle: 'external-source', targetHandle: 'old-target', label: '前置' };
  graph.edges[2] = { ...graph.edges[2], sourceHandle: 'old-source', targetHandle: 'external-target', label: '后续' };
  graph.edges[3].id = 'p-summary';
  const result = addSummaryNode(graph, createSummaryDraft(graph, ['a', 'b']), 'summary');
  const incoming = result.edges.find(edge => edge.target === 'summary');
  const outgoing = result.edges.find(edge => edge.source === 'summary');
  assert.equal(incoming.sourceHandle, 'external-source'); assert.equal(incoming.targetHandle, undefined);
  assert.equal(outgoing.targetHandle, 'external-target'); assert.equal(outgoing.sourceHandle, undefined);
  assert.equal(incoming.label, '前置'); assert.equal(outgoing.label, '后续');
  assert.equal(new Set(result.edges.map(edge => edge.id)).size, result.edges.length);
});

test('invalid, stale, duplicate-only and preview selections cannot create a summary', () => {
  const graph = { nodes: seedNodes, edges: seedEdges, notes: {} };
  for (const ids of [[], ['llm'], ['llm', 'llm'], ['llm', 'missing']]) assert.throws(() => createSummaryDraft(graph, ids));
  const previewNodes = [...seedNodes, { id: 'draft', data: { status: 'draft' } }];
  assert.throws(() => summarySources(previewNodes, seedEdges, ['llm', 'draft']));
  const draft = createSummaryDraft(graph, ['llm', 'rag', 'rag']);
  assert.equal(draft.sourceIds.length, 2);
  assert.throws(() => addSummaryNode(graph, { ...draft, title: ' ' }, 'summary'));
  assert.throws(() => addSummaryNode(graph, { ...draft, content: ' ' }, 'summary'));
  assert.throws(() => addSummaryNode(graph, draft, 'llm'));
  assert.throws(() => addSummaryNode({ ...graph, nodes: seedNodes.filter(node => node.id !== 'rag') }, draft, 'summary'));
});
