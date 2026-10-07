import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import fs from 'node:fs';
import { z } from 'zod';
import { AppError, parse, uuid } from '../shared/schemas.js';
import { Repository } from './storage/repository.js';
import { config, configResponse, exportConfig, importConfig, projectRoot, updateConfig, type AppConfig } from './config.js';
import { chat, configured, generate } from './agent.js';

const mutation = z.object({ mutationId: uuid, expectedRevision: z.number().int().positive() });
const generation = (request: any) => String(request.headers['x-workspace-generation'] || '');
const params = (request: any) => parse(z.object({ id: uuid }), request.params).id;
export async function buildApp(repository: Repository, options: AppConfig = config) {
  const app = Fastify({ logger: false, bodyLimit: options.spaceMaxBytes + 1024 * 1024, requestTimeout: 120000 });
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store'); reply.header('X-Content-Type-Options', 'nosniff');
    const origin = request.headers.origin;
    const localOrigin = `http://${request.headers.host}`;
    if (origin && origin !== localOrigin && !options.origins.includes(origin)) throw new AppError(403, 'ORIGIN_REJECTED', '此来源不能访问本地学习空间');
    const host = request.hostname;
    if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)) throw new AppError(403, 'HOST_REJECTED', '只接受本机请求');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && !request.headers['content-type']?.startsWith('application/json')) throw new AppError(415, 'JSON_REQUIRED', '写操作仅接受 application/json');
  });
  app.addHook('onSend', async (_request, reply, payload) => {
    if (repository.warnings.length) reply.header('X-Thinkraph-Storage-Warnings', encodeURIComponent([...new Set(repository.warnings)].join('；')));
    return payload;
  });
  app.setErrorHandler((error: any, request, reply) => {
    const known = error instanceof AppError;
    const status = known ? error.status : error.statusCode === 413 ? 413 : error.statusCode === 400 ? 400 : 503;
    reply.status(status).send({ code: known ? error.code : status === 400 ? 'INVALID_JSON' : status === 413 ? 'TOO_LARGE' : 'SERVICE_ERROR',
      message: known ? error.message : status === 400 ? '请求 JSON 格式错误' : status === 413 ? '文件超过大小上限' : '本地文件服务暂不可用，请检查目录权限和磁盘空间', ...(known && error.details ? { details: error.details } : {}), requestId: request.id });
    if (!known && status === 503) console.error(error);
  });
  app.get('/api/health', async () => ({ status: repository.writable ? 'ok' : 'recovery_required', writable: repository.writable, agentConfigured: configured(options.ai), issues: repository.issues, warnings: repository.warnings }));
  app.get('/api/config', () => configResponse(options));
  app.get('/api/config/export', () => exportConfig(options));
  app.patch('/api/config', request => updateConfig(options, request.body));
  app.post('/api/config/import', request => {
    const body = parse(z.object({ data: z.unknown() }).strict(), request.body);
    return importConfig(options, body.data);
  });
  app.get('/api/workspace', () => repository.state());
  app.get('/api/graphs', () => repository.state());
  app.get('/api/graphs/:id', request => repository.get(params(request)));
  app.post('/api/graphs', request => {
    const body = parse(z.object({ id: uuid, mutationId: uuid, document: z.unknown() }), request.body);
    return repository.create(generation(request), body.id, body.mutationId, body.document);
  });
  app.put('/api/graphs/:id', request => {
    const body = parse(mutation.extend({ document: z.unknown() }), request.body);
    return repository.save(generation(request), params(request), body.expectedRevision, body.mutationId, body.document);
  });
  for (const restore of [false, true]) app.route({ method: restore ? 'POST' : 'DELETE', url: `/api/graphs/:id${restore ? '/restore' : ''}`, handler: request => {
    const body = parse(mutation, request.body); return repository.trash(generation(request), params(request), body.expectedRevision, body.mutationId, restore);
  } });
  app.patch('/api/workspace', request => {
    const body = parse(z.object({ expectedRevision: z.number().int().nonnegative(), patch: z.unknown() }), request.body);
    return repository.patchWorkspace(generation(request), body.expectedRevision, body.patch);
  });
  app.post('/api/imports/preview', request => {
    const body = parse(z.object({ data: z.unknown(), mode: z.enum(['merge', 'restore']).default('merge'), applyPreferences: z.boolean().default(false), browserId: z.string().min(1).max(160).optional(), titles: z.record(z.string(), z.string().min(1).max(500)).optional() }), request.body);
    return repository.preview(generation(request), body.data, body.mode, body.applyPreferences, body.browserId, body.titles);
  });
  app.post('/api/imports/:id/commit', request => repository.commit(generation(request), params(request), parse(z.object({ mutationId: uuid }), request.body).mutationId));
  app.get('/api/imports/:id', async request => ({ receipt: await repository.receipt(params(request)) }));
  app.get('/api/graphs/:id/export', async (request, reply) => {
    const query = parse(z.object({ revision: z.coerce.number().int().positive(), format: z.enum(['json', 'markdown']).default('json') }), request.query);
    const pack = await repository.exportGraph(params(request), query.revision, generation(request));
    if (query.format === 'json') return pack;
    const g = pack.graph;
    const markdown = [`# ${g.title}`, g.goal, ...g.nodes.map(n => `## ${n.data.title}\n\n${n.data.summary}\n\n${n.data.description}\n\n${(g.notes[n.id] || []).map(note => note.content).join('\n\n')}\n\n${(g.sources[n.id] || []).map(s => `- [${s.title}](${s.url})`).join('\n')}`)].join('\n\n');
    reply.type('text/markdown; charset=utf-8'); return markdown;
  });
  app.post('/api/workspace/export', request => {
    const body = parse(z.object({ expectedGenerationId: uuid, revisions: z.record(uuid, z.number().int().positive()) }), request.body);
    if (body.expectedGenerationId !== generation(request)) throw new AppError(409, 'GENERATION_CONFLICT', '导出空间版本不匹配');
    return repository.exportWorkspace(body.expectedGenerationId, body.revisions);
  });
  app.get('/api/workspace/snapshots', () => repository.snapshots());
  app.post('/api/workspace/snapshots/:id/restore', request => repository.previewSnapshot(generation(request), params(request)));
  app.get('/api/graphs/:id/backups', request => repository.backups(params(request)));
  app.post('/api/graphs/:id/backups/restore', request => {
    const body = parse(z.object({ backupRevision: z.number().int().positive(), expectedRevision: z.number().int().positive().nullable(), mutationId: uuid }), request.body);
    return repository.restoreBackup(generation(request), params(request), body.backupRevision, body.expectedRevision, body.mutationId);
  });
  const agentBase = z.object({ requestId: uuid, graphId: uuid, nodeId: z.string().min(1), baseRevision: z.number().int().positive() });
  async function agentGraph(request: any, id: string, revision: number) {
    const state = await repository.state();
    if (generation(request) !== state.generationId) throw new AppError(409, 'GENERATION_CONFLICT', '学习空间已改变，请重新发起请求');
    const graph = await repository.get(id);
    if (graph.deletedAt || graph.revision !== revision) throw new AppError(409, 'REVISION_CONFLICT', '图谱已改变，请先保存并重新发起请求');
    return graph;
  }
  app.post('/api/agent/chat', async (request, reply) => {
    const body = parse(agentBase, request.body), graph = await agentGraph(request, body.graphId, body.baseRevision);
    if (!configured(options.ai)) throw new AppError(503, 'AI_NOT_CONFIGURED', '未配置模型');
    const controller = new AbortController(); reply.raw.on('close', () => controller.abort());
    reply.hijack(); reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    const send = (event: string, data: unknown) => reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    try { for await (const delta of chat(options.ai, graph, body.nodeId, controller.signal)) { if (controller.signal.aborted) break; send('delta', { text: delta }); } if (!controller.signal.aborted) send('done', { requestId: body.requestId, graphId: body.graphId, nodeId: body.nodeId, baseRevision: body.baseRevision }); }
    catch (error: any) { if (!controller.signal.aborted) send('error', { code: error.code || 'AI_ERROR', message: error instanceof AppError ? error.message : '模型请求超时或连接失败' }); }
    finally { reply.raw.end(); }
  });
  app.post('/api/agent/generate', async (request, reply) => {
    const body = parse(z.object({ requestId: uuid, graphId: uuid.optional(), baseRevision: z.number().int().positive().optional(), nodeId: z.string().optional(), sourceIds: z.array(z.string()).optional(), prompt: z.string().max(10000).optional(), kind: z.enum(['graph', 'expand', 'summary', 'quiz']) }), request.body);
    const graph = body.graphId ? await agentGraph(request, body.graphId, body.baseRevision || 0) : null;
    if (!graph && generation(request) !== (await repository.state()).generationId) throw new AppError(409, 'GENERATION_CONFLICT', '空间已改变');
    const controller = new AbortController(); reply.raw.on('close', () => { if (!reply.raw.writableEnded) controller.abort(); });
    return { ...body, draft: await generate(options.ai, body, graph, controller.signal) };
  });
  const dist = path.join(projectRoot, 'dist');
  if (fs.existsSync(path.join(dist, 'index.html'))) {
    await app.register(fastifyStatic, { root: dist });
    app.setNotFoundHandler((request, reply) => request.url.startsWith('/api/') ? reply.code(404).send({ code: 'NOT_FOUND', message: '接口不存在', requestId: request.id }) : reply.sendFile('index.html'));
  }
  return app;
}
