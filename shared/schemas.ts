import { z } from 'zod';
import { learningOrder } from './domain/graph.js';

export class AppError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}
export const uuid = z.string().uuid();
export const key = z.string().min(1).max(160).refine(value => !['__proto__', 'constructor', 'prototype'].includes(value), '不允许的标识');
const timestamp = z.string().datetime();
const text = z.string().max(2_000_000);
export const noteSchema = z.object({ id: key, content: text, createdAt: timestamp, updatedAt: timestamp });
export const messageSchema = z.object({
  id: key, role: z.enum(['user', 'assistant']), content: text, createdAt: timestamp,
  status: z.enum(['complete', 'stopped', 'error']).default('complete'), sourceIds: z.array(key).default([]), requestId: key.optional()
});
export const sourceSchema = z.object({
  id: key, title: z.string().min(1).max(500), url: z.string().url().refine(v => /^https?:\/\//i.test(v), '仅支持 HTTP(S) 资料链接'),
  type: z.string().max(80).default('参考资料'), meta: z.string().max(500).default(''), note: text.default('')
});
export const quizSchema = z.object({
  id: key, question: z.string().min(1).max(5000), answers: z.array(z.string().min(1).max(2000)).min(2).max(10),
  correct: z.number().int().nonnegative(), explanation: text,
  attempts: z.array(z.object({ id: key, selectedIndex: z.number().int().nonnegative(), correct: z.boolean(), createdAt: timestamp })).default([])
}).refine(v => v.correct < v.answers.length && v.attempts.every(a => a.selectedIndex < v.answers.length), '测验选项索引无效');
export const nodeSchema = z.object({
  id: key, position: z.object({ x: z.number().finite(), y: z.number().finite() }),
  data: z.object({
    title: z.string().trim().min(1).max(500), subtitle: z.string().max(2000).default(''), summary: text.default(''), description: text.default(''),
    kind: z.string().trim().min(1).max(80).default('自建知识'),
    icon: z.enum(['brain', 'vector', 'text', 'cube', 'stack', 'tree', 'flow']).default('stack'),
    status: z.enum(['todo', 'learning', 'mastered']).default('todo'), minutes: z.number().int().min(1).max(100000).default(15),
    createdBy: z.enum(['manual', 'template', 'agent', 'summary', 'legacy']).default('manual'),
    evidence: z.enum(['self_report']).optional(), question: text.optional(),
    summarySources: z.array(z.object({ id: key, title: z.string().min(1).max(500) })).optional(), summaryAnchorId: key.optional()
  })
});
export const graphBodySchema = z.object({
  title: z.string().trim().min(1).max(500), goal: z.string().max(5000).default(''),
  preferences: z.object({ level: z.enum(['starter', 'some', 'experienced']).default('starter'), dailyMinutes: z.number().int().min(1).max(1440).default(30) }).default({ level: 'starter', dailyMinutes: 30 }),
  nodes: z.array(nodeSchema).max(1000),
  edges: z.array(z.object({ id: key, source: key, target: key, relation: z.literal('prerequisite').default('prerequisite') })).max(5000),
  notes: z.record(key, z.array(noteSchema)).default({}), messages: z.record(key, z.array(messageSchema)).default({}),
  sources: z.record(key, z.array(sourceSchema)).default({}), quizzes: z.record(key, z.array(quizSchema)).default({})
});
export type GraphBody = z.infer<typeof graphBodySchema>;
export type GraphNode = GraphBody['nodes'][number];
export type Note = z.infer<typeof noteSchema>;
export type Message = z.infer<typeof messageSchema>;
export type Quiz = z.infer<typeof quizSchema>;
export type Source = z.infer<typeof sourceSchema>;
export const portableGraphSchema = graphBodySchema.extend({ schemaVersion: z.literal(2), id: uuid });
// Portable files reject unfamiliar fields instead of silently losing newer data.
const importGraphSchema = portableGraphSchema.extend({
  nodes: z.array(nodeSchema.extend({ data: nodeSchema.shape.data.strict() }).strict()).max(1000),
  edges: z.array(graphBodySchema.shape.edges.element.strict()).max(5000),
  notes: z.record(key, z.array(noteSchema.strict())).default({}),
  messages: z.record(key, z.array(messageSchema.strict())).default({}),
  sources: z.record(key, z.array(sourceSchema.strict())).default({}),
  quizzes: z.record(key, z.array(quizSchema.strict())).default({})
}).strict();
export type PortableGraph = z.infer<typeof portableGraphSchema>;
export const documentSchema = portableGraphSchema.extend({
  revision: z.number().int().positive(), createdAt: timestamp, updatedAt: timestamp, deletedAt: timestamp.nullable(),
  lastMutation: z.object({ id: uuid, payloadHash: z.string() }),
  provenance: z.object({
    legacyBrowserId: key.optional(), legacyGraphId: key.optional(), migratedAt: timestamp.optional(),
    import: z.object({ importId: uuid, mutationId: uuid, payloadHash: z.string(), exportId: uuid.optional(), sourceGraphId: z.string(), sourceWorkspaceId: z.string().optional() }).optional()
  }).optional()
});
export type GraphDocument = z.infer<typeof documentSchema>;
export const graphViewSchema = z.object({
  viewport: z.object({ x: z.number().finite(), y: z.number().finite(), zoom: z.number().min(0.1).max(4) }).optional(),
  selectedNodeId: key.nullable().optional()
});
export const settingsSchema = z.object({
  theme: z.enum(['light', 'dark']).default('light'), headerCollapsed: z.boolean().default(false),
  panelWidths: z.object({ left: z.number().min(180).max(360), right: z.number().finite().min(300) }).default({ left: 220, right: 374 }),
  graphViews: z.record(uuid, graphViewSchema).default({})
});
export const workspaceSchema = settingsSchema.extend({
  schemaVersion: z.literal(2), id: uuid, name: z.string().trim().min(1).max(200), revision: z.number().int().nonnegative(),
  graphOrder: z.array(uuid), activeGraphId: uuid.nullable()
});
export type Workspace = z.infer<typeof workspaceSchema>;
// PATCH must not reapply creation defaults for omitted fields (including Zod 4
// defaults nested inside optional schemas).
export const workspacePatchSchema = z.object({
  name: workspaceSchema.shape.name.optional(), graphOrder: workspaceSchema.shape.graphOrder.optional(), activeGraphId: uuid.nullable().optional(),
  theme: z.enum(['light', 'dark']).optional(), headerCollapsed: z.boolean().optional(),
  panelWidths: settingsSchema.shape.panelWidths.removeDefault().optional(), graphViews: z.record(uuid, graphViewSchema).optional()
}).strict();
export type WorkspacePatch = z.infer<typeof workspacePatchSchema>;
export const graphPackageSchema = z.object({
  format: z.literal('thinkraph.graph'), formatVersion: z.literal(1), exportId: uuid, exportedAt: timestamp, graph: importGraphSchema
}).strict();
export const spacePackageSchema = z.object({
  format: z.literal('thinkraph.workspace'), formatVersion: z.literal(1), exportId: uuid, exportedAt: timestamp,
  workspace: z.object({ id: uuid, name: z.string().trim().min(1).max(200), activeGraphId: uuid.nullable(), settings: settingsSchema }),
  catalog: z.object({ graphIds: z.array(uuid) }).strict(), graphs: z.array(importGraphSchema)
}).strict();
export type GraphPackage = z.infer<typeof graphPackageSchema>;
export type SpacePackage = z.infer<typeof spacePackageSchema>;
export type ImportPackage = GraphPackage | SpacePackage;
export type CatalogItem = { id: string; title: string; goal: string; nodeCount: number; masteredCount: number; revision: number; createdAt: string; updatedAt: string; deletedAt: string | null };
export type StorageIssue = { id: string; code: string; message: string };

export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(422, 'VALIDATION', '数据格式不正确，请查看具体字段', result.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })));
  return result.data;
}
export function validateGraph(value: unknown, maxBytes = 10 * 1024 * 1024): GraphBody {
  const graph = parse(graphBodySchema, value);
  if (new TextEncoder().encode(JSON.stringify(graph)).length > maxBytes) throw new AppError(413, 'GRAPH_TOO_LARGE', '图谱内容超过大小上限');
  const ids = new Set(graph.nodes.map(n => n.id));
  if (ids.size !== graph.nodes.length) throw new AppError(422, 'DUPLICATE_NODE', '节点标识重复');
  const edgeIds = new Set(), pairs = new Set();
  for (const edge of graph.edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) throw new AppError(422, 'DANGLING_EDGE', '依赖引用了不存在的节点', edge.id);
    const pair = JSON.stringify([edge.source, edge.target]);
    if (edgeIds.has(edge.id) || pairs.has(pair)) throw new AppError(422, 'DUPLICATE_EDGE', '依赖标识或关系重复', edge.id);
    edgeIds.add(edge.id); pairs.add(pair);
  }
  try { learningOrder(graph.nodes, graph.edges); } catch { throw new AppError(422, 'CYCLE', '知识依赖存在循环'); }
  for (const field of ['notes', 'messages', 'sources', 'quizzes'] as const) {
    const recordIds = new Set();
    for (const [nodeId, records] of Object.entries(graph[field])) {
      if (!ids.has(nodeId)) throw new AppError(422, 'DANGLING_CONTENT', '学习内容引用了不存在的节点', `${field}.${nodeId}`);
      for (const record of records) {
        if (recordIds.has(record.id)) throw new AppError(422, 'DUPLICATE_CONTENT', '学习记录标识重复', `${field}.${record.id}`);
        recordIds.add(record.id);
      }
    }
  }
  const sourceIds = new Set(Object.values(graph.sources).flat().map(s => s.id));
  for (const message of Object.values(graph.messages).flat()) if (message.sourceIds.some(id => !sourceIds.has(id))) throw new AppError(422, 'DANGLING_CITATION', '对话引用了不存在的资料', message.id);
  return graph;
}
export function portableGraph(graph: GraphDocument | PortableGraph): PortableGraph { return { schemaVersion: 2, id: graph.id, ...parse(graphBodySchema, graph) }; }
export function validatePackage(input: unknown, graphMaxBytes?: number): ImportPackage {
  const raw = input as { format?: string; formatVersion?: number };
  if (raw?.formatVersion !== 1) throw new AppError(422, 'UNSUPPORTED_FORMAT', '不支持此导出文件版本');
  if (raw.format === 'thinkraph.graph') {
    const pack = parse(graphPackageSchema, raw); validateGraph(pack.graph, graphMaxBytes); return pack;
  }
  if (raw.format !== 'thinkraph.workspace') throw new AppError(422, 'UNSUPPORTED_FORMAT', '请选择 Thinkraph 图谱或学习空间 JSON 文件');
  const pack = parse(spacePackageSchema, raw);
  const ids = new Set(pack.graphs.map(g => g.id));
  if (ids.size !== pack.graphs.length || new Set(pack.catalog.graphIds).size !== ids.size || pack.catalog.graphIds.length !== ids.size || pack.catalog.graphIds.some(id => !ids.has(id))) throw new AppError(422, 'INVALID_CATALOG', '图谱列表必须与包内图谱一一对应');
  if ((ids.size === 0 && pack.workspace.activeGraphId !== null) || (pack.workspace.activeGraphId !== null && !ids.has(pack.workspace.activeGraphId))) throw new AppError(422, 'INVALID_ACTIVE_GRAPH', '当前图谱不在导入包中');
  for (const graph of pack.graphs) validateGraph(graph, graphMaxBytes);
  return pack;
}
export function catalogItem(graph: GraphDocument): CatalogItem {
  return { id: graph.id, title: graph.title, goal: graph.goal, revision: graph.revision, createdAt: graph.createdAt, updatedAt: graph.updatedAt, deletedAt: graph.deletedAt, nodeCount: graph.nodes.length, masteredCount: graph.nodes.filter(n => n.data.status === 'mastered').length };
}
