import test from 'node:test';
import assert from 'node:assert/strict';
import { context, chat, generate } from '../server/agent.js';
import { templateGraph } from '../shared/migrations.js';
import type { GraphDocument } from '../shared/schemas.js';
const ai = { baseUrl: 'http://model.test/v1', model: 'test', apiKey: 'test-secret', timeoutMs: 1000 };
const graph = () => ({ ...templateGraph(), revision: 1 } as GraphDocument);
test('Agent context includes node notes and citations, excludes unrelated branch chat', () => {
  const g = graph(); g.messages.agent = [{ id: 'private', role: 'user', content: 'another branch secret', createdAt: new Date().toISOString(), status: 'complete', sourceIds: [] }];
  const text = context(g, 'rag'); assert.ok(text.includes('RAG 的核心')); assert.ok(text.includes('arxiv.org')); assert.ok(!text.includes('another branch secret'));
  assert.throws(() => context(g, 'missing'), { code: 'NODE_NOT_FOUND' });
  const current = JSON.parse(text).node.data;
  assert.equal(current.description, g.nodes.find(n => n.id === 'rag')!.data.description);
  assert.notEqual(current.description, current.summary);
});
test('graph and expansion generation require distinct description fields and retain their content', async t => {
  const description = '解释概念的定义、工作机制和适用条件。通过一个具体示例说明如何判断结果，并指出使用时容易混淆的边界。';
  const node = { id: 'detail-test', position: { x: 0, y: 0 }, data: { title: '概念', summary: '一句话摘要', description } };
  let draft: any;
  t.mock.method(globalThis, 'fetch', async (_url: unknown, options: any) => {
    assert.match(JSON.parse(options.body).messages[0].content, /description/);
    return Response.json({ choices: [{ message: { content: JSON.stringify(draft) } }] });
  });
  for (const kind of ['graph', 'expand'] as const) {
    draft = { title: '图谱', nodes: [structuredClone(node)], edges: [] };
    const result = await generate(ai, { kind, nodeId: 'rag' }, kind === 'graph' ? null : graph(), new AbortController().signal);
    assert.ok('nodes' in result);
    assert.equal(result.nodes[0].data.description, description);
    assert.equal(result.nodes[0].data.summary, '一句话摘要');
    delete draft.nodes[0].data.description;
    await assert.rejects(generate(ai, { kind }, kind === 'graph' ? null : graph(), new AbortController().signal), { code: 'VALIDATION' });
  }
});
test('chat handles split UTF-8 SSE frames and explicit completion', async t => {
  const frames = new TextEncoder().encode('data: {"choices":[{"delta":{"content":"中文回答"}}]}\n\ndata: [DONE]\n\n');
  t.mock.method(globalThis, 'fetch', async (_url: unknown, options: any) => {
    assert.equal(options.headers.Authorization, 'Bearer test-secret');
    return new Response(new ReadableStream({ start(controller) { for (let i = 0; i < frames.length; i += 3) controller.enqueue(frames.slice(i, i + 3)); controller.close(); } }));
  });
  let answer = ''; for await (const delta of chat(ai, graph(), 'rag', new AbortController().signal)) answer += delta;
  assert.equal(answer, '中文回答');
});
test('interrupted model stream is an error, not a completed reply', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'));
  await assert.rejects(async () => { for await (const _ of chat(ai, graph(), 'rag', new AbortController().signal)) { /* consume */ } }, { code: 'AI_INTERRUPTED' });
});
test('generation validates drafts and rejects malformed JSON or cyclic graphs', async t => {
  let content = 'invalid';
  t.mock.method(globalThis, 'fetch', async () => Response.json({ choices: [{ message: { content } }] }));
  await assert.rejects(generate(ai, { kind: 'summary', sourceIds: ['llm', 'prompt'] }, graph(), new AbortController().signal), { code: 'AI_INVALID_JSON' });
  const g = graph(); g.edges.push({ id: 'cycle', source: 'rag', target: 'llm', relation: 'prerequisite' }); content = JSON.stringify(g);
  await assert.rejects(generate(ai, { kind: 'graph' }, null, new AbortController().signal), { code: 'CYCLE' });
  content = JSON.stringify({ title: '概念汇总', content: '整理后的真实模型草稿' });
  assert.deepEqual(await generate(ai, { kind: 'summary', sourceIds: ['llm', 'prompt'] }, graph(), new AbortController().signal), { title: '概念汇总', content: '整理后的真实模型草稿' });
});
test('unconfigured model remains explicitly unavailable', async () => {
  await assert.rejects(generate({ ...ai, baseUrl: '' }, { kind: 'graph' }, null, new AbortController().signal), { code: 'AI_NOT_CONFIGURED' });
});
