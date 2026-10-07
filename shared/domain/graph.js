// Shared learning rules. Learning dependencies are directed and acyclic.
export function connectionProblem(source, target, edges) {
  if (!source || !target) return '请选择两个知识节点';
  if (source === target) return '节点不能依赖自身';
  if (edges.some(e => e.source === source && e.target === target)) return '这条学习依赖已经存在';
  const visited = new Set();
  const reaches = id => {
    if (id === source) return true;
    if (visited.has(id)) return false;
    visited.add(id);
    return edges.filter(e => e.source === id).some(e => reaches(e.target));
  };
  return reaches(target) ? '这条连线会形成循环。请调整前置知识的方向。' : '';
}

export function ancestors(id, edges) {
  const result = new Set();
  const visit = current => edges.filter(e => e.target === current).forEach(e => {
    if (!result.has(e.source)) { result.add(e.source); visit(e.source); }
  });
  visit(id);
  return result;
}

export function learningOrder(nodes, edges) {
  const result = [], pending = [...nodes];
  while (pending.length) {
    const index = pending.findIndex(n => edges.filter(e => e.target === n.id).every(e => result.some(p => p.id === e.source)));
    if (index < 0) throw new Error('知识依赖存在循环或缺失节点');
    result.push(pending.splice(index, 1)[0]);
  }
  return result;
}

export function availableNodes(nodes, edges) {
  return nodes.filter(n => n.data.status !== 'mastered' && edges.filter(e => e.target === n.id).every(e => nodes.find(x => x.id === e.source)?.data.status === 'mastered'));
}

export function autoLayout(nodes, edges) {
  const ordered = learningOrder(nodes, edges);
  const ranks = new Map(), rows = new Map();
  return ordered.map(node => {
    const incoming = edges.filter(e => e.target === node.id);
    const rank = incoming.length ? Math.max(...incoming.map(e => ranks.get(e.source) + 1)) : 0;
    const row = rows.get(rank) || 0;
    ranks.set(node.id, rank); rows.set(rank, row + 1);
    return { ...node, position: { x: rank * 292, y: row * 220 + (rank % 2) * 60 } };
  });
}

export function summarySources(nodes, edges, sourceIds) {
  const ids = new Set(sourceIds);
  if (ids.size < 2) throw new Error('请至少选择两个知识节点');
  const sources = learningOrder(nodes, edges).filter(node => ids.has(node.id) && node.data.status !== 'draft');
  if (sources.length !== ids.size) throw new Error('选中的节点已发生变化，请重新圈选');
  return sources;
}

// The prototype uses an extractive summary of the user's content, without a model request.
export function createSummaryDraft(graph, sourceIds) {
  const sources = summarySources(graph.nodes, graph.edges, sourceIds);
  const ids = new Set(sourceIds);
  const titles = new Map(sources.map(node => [node.id, node.data.title]));
  const connections = graph.edges.filter(edge => ids.has(edge.source) && ids.has(edge.target));
  const points = sources.map((node, index) => {
    const sections = new Set([node.data.summary || node.data.subtitle, node.data.description].filter(Boolean).map(text => text.trim()));
    const content = [...sections].join('\n\n') || '这个知识点尚未填写说明。';
    const notes = [...new Set((graph.notes?.[node.id] || []).map(note => typeof note === 'string' ? note : note.content).filter(note => typeof note === 'string' && note.trim() && !sections.has(note.trim())).map(note => note.trim()))];
    return `${index + 1}. ${node.data.title}\n${content}${notes.length ? `\n补充笔记：\n${notes.map(note => `• ${note}`).join('\n')}` : ''}`;
  });
  return {
    sourceIds: sources.map(node => node.id),
    title: `${sources[0].data.title} · ${sources.length} 个知识点总结`,
    content: [
      `本次汇总包含 ${sources.map(node => `「${node.data.title}」`).join('、')}，按学习依赖顺序整理。`,
      ...points,
      connections.length ? `学习联系\n${connections.map(edge => `${titles.get(edge.source)} → ${titles.get(edge.target)}`).join('\n')}` : '学习联系\n按原图的学习顺序复习，未选中的前置知识仍可回到原图查看。'
    ].join('\n\n')
  };
}

export function addSummaryNode(graph, draft, id) {
  const sources = summarySources(graph.nodes, graph.edges, draft.sourceIds);
  if (!draft.title.trim() || !draft.content.trim()) throw new Error('请填写汇总标题和内容');
  if (!id || graph.nodes.some(node => node.id === id)) throw new Error('汇总节点标识已存在，请重试');
  const anchor = sources[0];
  const selectedIds = new Set(sources.map(source => source.id));
  const content = draft.content.trim();
  const node = {
    id, type: 'knowledge', position: { ...anchor.position },
    data: {
      title: draft.title.trim(), subtitle: `汇总 ${sources.length} 个知识点`, summary: `整理 ${sources.length} 个知识点的概念、笔记与学习联系。`, description: content,
      kind: '知识汇总', icon: 'stack', status: 'todo', createdBy: 'summary', minutes: Math.max(5, Math.ceil(content.length / 300)),
      summarySources: sources.map(source => ({ id: source.id, title: source.data.title })), summaryAnchorId: anchor.id
    }
  };
  // Replace at the anchor's index too, keeping independent branches in their existing order.
  const nodes = graph.nodes.flatMap(original => original.id === anchor.id ? [node] : selectedIds.has(original.id) ? [] : [original]);
  const edges = graph.edges.filter(edge => !selectedIds.has(edge.source) && !selectedIds.has(edge.target));
  const edgePairs = new Set(edges.map(edge => JSON.stringify([edge.source, edge.target])));
  const edgeIds = new Set(edges.map(edge => edge.id));
  for (const edge of graph.edges) {
    let replacement;
    if (edge.target === anchor.id && !selectedIds.has(edge.source)) {
      const { targetHandle, ...incoming } = edge;
      replacement = { ...incoming, target: id };
    } else if (selectedIds.has(edge.source) && !selectedIds.has(edge.target)) {
      const { sourceHandle, ...outgoing } = edge;
      replacement = { ...outgoing, source: id };
    }
    if (!replacement) continue;
    const pair = JSON.stringify([replacement.source, replacement.target]);
    if (edgePairs.has(pair)) continue;
    const baseId = `${replacement.source}-${replacement.target}`;
    let edgeId = baseId, suffix = 1;
    while (edgeIds.has(edgeId)) edgeId = `${baseId}-${suffix++}`;
    edges.push({ ...replacement, id: edgeId });
    edgePairs.add(pair); edgeIds.add(edgeId);
  }
  // Validate the complete replacement before committing any graph changes.
  learningOrder(nodes, edges);
  const records = removeNodeContent(graph, [...selectedIds]);
  const { notes, messages } = records;
  const timestamp = new Date().toISOString();
  notes[id] = graph.schemaVersion === 2 ? [{ id: crypto.randomUUID(), content, createdAt: timestamp, updatedAt: timestamp }] : [content];
  return {
    ...graph,
    ...records, nodes, edges, notes, messages
  };
}

export function removeNodeContent(graph, ids) {
  const records = {};
  for (const field of ['notes', 'messages', 'sources', 'quizzes']) {
    if (!graph[field]) continue;
    records[field] = { ...graph[field] };
    ids.forEach(id => { delete records[field][id]; });
  }
  if (records.sources) {
    const sourceIds = new Set(Object.values(records.sources).flat().map(source => source.id));
    records.messages = Object.fromEntries(Object.entries(records.messages || {}).map(([id, messages]) => [id, messages.map(message => message.sourceIds ? { ...message, sourceIds: message.sourceIds.filter(sourceId => sourceIds.has(sourceId)) } : message)]));
  }
  return records;
}
