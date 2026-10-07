import { AppError, parse, portableGraphSchema, settingsSchema, uuid, validateGraph, validatePackage, type ImportPackage, type PortableGraph } from './schemas.js';
import { seedNodes, seedEdges, ragMessages, sourceMap, quizMap } from './templates.js';

const newId = () => crypto.randomUUID();
const now = () => new Date().toISOString();
export function fromLegacy(value: any, id = newId(), template = false): PortableGraph {
  if (!value || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) throw new AppError(422, 'INVALID_LEGACY', '旧版图谱缺少 nodes 或 edges');
  if (value.schemaVersion && value.schemaVersion !== 1 && value.schemaVersion !== 2) throw new AppError(422, 'UNSUPPORTED_SCHEMA', '不支持此图谱版本');
  if (value.schemaVersion === 2) return parse(portableGraphSchema, { ...value, id });
  const date = now();
  const sources: Record<string, any[]> = {};
  for (const [nodeId, records] of Object.entries(value.sources || (template ? sourceMap : {}))) {
    if (!Array.isArray(records)) throw new AppError(422, 'INVALID_LEGACY', '资料必须为数组', nodeId);
    sources[nodeId] = records.map(source => ({ ...source, id: source.id || newId() }));
  }
  const notes = Object.fromEntries(Object.entries(value.notes || {}).map(([nodeId, records]) => {
    if (!Array.isArray(records)) throw new AppError(422, 'INVALID_LEGACY', '笔记必须为数组', nodeId);
    return [nodeId, records.map(record => typeof record === 'string' ? { id: newId(), content: record, createdAt: date, updatedAt: date } : record)];
  }));
  const messages = Object.fromEntries(Object.entries(value.messages || {}).map(([nodeId, records]) => {
    if (!Array.isArray(records)) throw new AppError(422, 'INVALID_LEGACY', '对话必须为数组', nodeId);
    return [nodeId, records.map(message => ({
      ...message, id: message.id || newId(), content: message.content ?? message.text,
      createdAt: message.createdAt || date, sourceIds: message.sourceIds || (message.source ? (sources[nodeId] || []).map(s => s.id) : [])
    }))];
  }));
  const quizzes: Record<string, any[]> = {};
  for (const [nodeId, records] of Object.entries(value.quizzes || (template ? quizMap : {}))) {
    quizzes[nodeId] = (Array.isArray(records) ? records : [records]).map((quiz: any) => ({ ...quiz, id: quiz.id || newId(), attempts: quiz.attempts || [] }));
  }
  const body = validateGraph({ ...value, notes, messages, sources, quizzes,
    nodes: value.nodes.map((node: any) => ({ ...node, data: { ...node.data, createdBy: template ? 'template' : 'legacy' } })) });
  return { schemaVersion: 2, id, ...body };
}

export function templateGraph(): PortableGraph {
  return fromLegacy({ title: '大模型应用入门', goal: '理解核心原理，独立搭建一个知识库问答助手', nodes: seedNodes, edges: seedEdges,
    notes: { rag: ['RAG 的核心是先检索，再生成。外部知识库可以更新，不必为每次知识更新重新训练模型。'] }, messages: { rag: ragMessages } }, newId(), true);
}

export type ConvertedImport = { package: ImportPackage; warnings: string[]; legacyIds: Record<string, string> };
export function convertImport(input: any, maxBytes?: number): ConvertedImport {
  const warnings: string[] = [], legacyIds: Record<string, string> = {};
  let pack: ImportPackage;
  if (input?.format) pack = validatePackage(input, maxBytes);
  else {
    warnings.push('旧版 JSON 已转换：补齐记录 ID 和时间；原浏览器数据不会删除。旧格式未提供的资料和测验保持为空。');
    if (Array.isArray(input?.maps)) {
      const seen = new Set<string>();
      const graphs = input.maps.map((item: any, index: number) => {
        const legacyId = String(item.id || `legacy-${index}`);
        if (seen.has(legacyId)) throw new AppError(422, 'DUPLICATE_GRAPH', '旧版图谱 ID 重复', legacyId);
        seen.add(legacyId); const id = newId(); legacyIds[id] = legacyId;
        return fromLegacy(item.graph || item, id);
      });
      const active = Object.keys(legacyIds).find(id => legacyIds[id] === input.activeId) || graphs[0]?.id || null;
      pack = { format: 'thinkraph.workspace', formatVersion: 1, exportId: newId(), exportedAt: now(),
        workspace: { id: newId(), name: input.name || '我的学习空间', activeGraphId: active, settings: parse(settingsSchema, input.settings || {}) },
        catalog: { graphIds: graphs.map((g: PortableGraph) => g.id) }, graphs };
    } else {
      const id = uuid.safeParse(input?.id).success ? input.id : newId();
      legacyIds[id] = String(input?.id || 'starter-map');
      pack = { format: 'thinkraph.graph', formatVersion: 1, exportId: newId(), exportedAt: now(), graph: fromLegacy(input?.graph || input, id) };
    }
    pack = validatePackage(pack, maxBytes);
  }
  if (pack.format === 'thinkraph.workspace') {
    for (const [id, view] of Object.entries(pack.workspace.settings.graphViews)) {
      const graph = pack.graphs.find(g => g.id === id);
      if (!graph) { delete pack.workspace.settings.graphViews[id]; warnings.push(`忽略已失效的图谱视图：${id}`); }
      else if (view.selectedNodeId && !graph.nodes.some(n => n.id === view.selectedNodeId)) { view.selectedNodeId = null; warnings.push(`重置「${graph.title}」已失效的选中节点`); }
    }
  }
  return { package: pack, warnings, legacyIds };
}
