import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { WorkspaceClient, ApiError } from '../src/state/workspace.js';
import { validateGraph, workspaceSchema } from '../shared/schemas.js';

function setup(transport?: (url: string, options: any) => any) {
  const id = randomUUID(), generationId = randomUUID(), date = new Date().toISOString();
  const document = { schemaVersion: 2 as const, id, ...validateGraph({ title: 'original', nodes: [], edges: [] }), revision: 1, createdAt: date, updatedAt: date, deletedAt: null, lastMutation: { id: randomUUID(), payloadHash: '' } };
  const data = { generationId, workspace: workspaceSchema.parse({ schemaVersion: 2, id: randomUUID(), name: '测试', revision: 1, graphOrder: [id], activeGraphId: id }), graphs: [], deleted: [], issues: [], warnings: [] };
  const calls: any[] = [];
  const client = new WorkspaceClient((async (url: string, options: any) => {
    if (url === '/workspace') return data;
    if (url === '/health') return { agentConfigured: false };
    if (options?.method === 'PUT') { calls.push(options); return transport ? transport(url, options) : { ...document, ...options.body.document, revision: options.body.expectedRevision + 1 }; }
    return document;
  }) as any, 10_000);
  return { client, id, calls, document };
}
test('acknowledging an in-flight save never overwrites later edits; one request in flight', async () => {
  const resolvers: ((value: any) => void)[] = [];
  const { client, id, calls, document } = setup(() => new Promise(resolve => resolvers.push(resolve)));
  await client.bootstrap(); client.update(id, g => ({ ...g, title: 'first' })); const saving = client.flush(id);
  client.update(id, g => ({ ...g, title: 'second' })); assert.equal(calls.length, 1);
  resolvers[0]({ ...document, title: 'first', revision: 2 }); await new Promise(resolve => setImmediate(resolve));
  assert.equal(client.graph(id)?.title, 'second'); assert.equal(calls.length, 2); assert.equal(calls[1].body.expectedRevision, 2);
  resolvers[1]({ ...document, title: 'second', revision: 3 }); await saving;
  assert.equal(client.graph(id)?.revision, 3); assert.equal(client.sessions.get(id)?.status, 'saved'); assert.equal(client.dirty, false);
});
test('retry preserves mutation ID after lost response and saves newer edits afterward', async () => {
  let count = 0;
  const { client, id, calls, document } = setup((_url, options) => { if (++count === 1) throw new Error('lost response'); return { ...document, ...options.body.document, revision: options.body.expectedRevision + 1 }; });
  await client.bootstrap(); client.update(id, g => ({ ...g, title: 'first' })); await assert.rejects(client.flush(id));
  client.update(id, g => ({ ...g, title: 'second' })); await client.flush(id);
  assert.equal(calls[0].body.mutationId, calls[1].body.mutationId); assert.notEqual(calls[1].body.mutationId, calls[2].body.mutationId);
  assert.equal(client.graph(id)?.title, 'second'); assert.equal(client.graph(id)?.revision, 3);
});
test('conflict retains local draft and blocks export/switch flushing', async () => {
  const { client, id } = setup(() => { throw new ApiError(409, 'REVISION_CONFLICT', 'changed elsewhere'); });
  await client.bootstrap(); client.update(id, g => ({ ...g, title: 'unsaved' }));
  await assert.rejects(client.flushAll()); assert.equal(client.graph(id)?.title, 'unsaved'); assert.equal(client.dirty, true);
  assert.equal(client.sessions.get(id)?.status, 'error');
});
test('React Flow view-only properties do not cause document saves', async () => {
  const { client, id, calls } = setup(); await client.bootstrap();
  client.update(id, g => ({ ...g, selected: true, viewport: { x: 1, y: 2, zoom: 1 } })); await client.flush(id); assert.equal(calls.length, 0);
});
