import { useSyncExternalStore } from 'react';
import { graphBodySchema, parse, validateGraph, type GraphBody, type GraphDocument, type Workspace, type CatalogItem, type WorkspacePatch } from '../../shared/schemas.js';

export class ApiError extends Error { constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); } }
export async function api<T = any>(url: string, options: { method?: string; body?: unknown; generation?: string; signal?: AbortSignal; text?: boolean } = {}): Promise<T> {
  const response = await fetch(`/api${url}`, { method: options.method || 'GET', headers: { ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(options.generation ? { 'X-Workspace-Generation': options.generation } : {}) },
    body: options.body === undefined ? undefined : JSON.stringify(options.body), signal: options.signal });
  if (!response.ok) { const error = await response.json().catch(() => ({})); throw new ApiError(response.status, error.code || 'NETWORK_ERROR', error.message || '本地服务连接失败', error.details); }
  return options.text ? await response.text() as T : response.json();
}
export function download(name: string, value: unknown, markdown = false) {
  const blob = new Blob([markdown ? String(value) : JSON.stringify(value, null, 2)], { type: markdown ? 'text/markdown;charset=utf-8' : 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob), anchor = document.createElement('a'); anchor.href = url; anchor.download = name.replace(/[\\/:*?"<>|]/g, '_'); anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export type Bootstrap = { workspace: Workspace; generationId: string; graphs: CatalogItem[]; deleted: CatalogItem[]; issues: { id: string; message: string; code: string }[]; warnings: string[] };
type Pending = { mutationId: string; expectedRevision: number; document: GraphBody; version: number };
export type Session = { document: GraphDocument; draft: GraphBody; version: number; savedVersion: number; status: 'saved' | 'pending' | 'saving' | 'error'; error?: Error; pending?: Pending; inflight?: Promise<void>; timer?: ReturnType<typeof setTimeout>; firstDirty?: number };
export class WorkspaceClient {
  sessions = new Map<string, Session>();
  private listeners = new Set<() => void>();
  private workspaceQueue = Promise.resolve();
  private failedWorkspacePatch: WorkspacePatch | null = null;
  private pendingCreate: { id: string; mutationId: string; document: GraphBody } | null = null;
  private histories = new Map<string, { past: { current: GraphBody[] }; future: { current: GraphBody[] } }>();
  snapshot: { data: Bootstrap | null; error: Error | null; workspaceError: Error | null; workspacePending: number; agentConfigured: boolean; version: number } = { data: null, error: null, workspaceError: null, workspacePending: 0, agentConfigured: false, version: 0 };
  constructor(private transport: typeof api = api, private delay = 500) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.snapshot;
  private emit(patch = {}) { this.snapshot = { ...this.snapshot, ...patch, version: this.snapshot.version + 1 }; this.listeners.forEach(listener => listener()); }
  get generation() { return this.snapshot.data?.generationId || ''; }
  get activeId() { return this.snapshot.data?.workspace.activeGraphId || null; }
  get dirty() { return [...this.sessions.values()].some(s => s.version !== s.savedVersion || s.inflight) || Boolean(this.snapshot.workspaceError) || this.snapshot.workspacePending > 0; }
  history(id: string | null) { const key = id || ''; if (!this.histories.has(key)) this.histories.set(key, { past: { current: [] }, future: { current: [] } }); return this.histories.get(key)!; }
  async bootstrap(discard = false) {
    try {
      const data = await this.transport<Bootstrap>('/workspace');
      if (this.generation && this.generation !== data.generationId && this.dirty && !discard) throw new ApiError(409, 'GENERATION_CONFLICT', '空间已改变，本地仍有未保存草稿，请先下载草稿');
      if (discard || this.generation !== data.generationId) { for (const s of this.sessions.values()) clearTimeout(s.timer); this.sessions.clear(); this.histories.clear(); this.failedWorkspacePatch = null; }
      if (data.workspace.activeGraphId) {
        try { await this.load(data.workspace.activeGraphId); }
        catch (error) { if (!data.issues.length) throw error; }
      }
      const health = await this.transport<{ agentConfigured: boolean }>('/health');
      this.emit({ data, agentConfigured: health.agentConfigured, error: null, ...(discard ? { workspaceError: null } : {}) });
    } catch (error) { this.emit({ error }); throw error; }
  }
  async load(id: string) {
    if (this.sessions.has(id)) return this.sessions.get(id)!;
    const document = await this.transport<GraphDocument>(`/graphs/${id}`);
    const session: Session = { document, draft: parse(graphBodySchema, document), version: 0, savedVersion: 0, status: 'saved' };
    this.sessions.set(id, session); this.emit(); return session;
  }
  graph(id: string | null = this.activeId) { const session = id ? this.sessions.get(id) : null; return session ? { ...session.document, ...session.draft } : null; }
  update(id: string, updater: GraphBody | ((body: GraphBody) => GraphBody)) {
    const session = this.sessions.get(id); if (!session) throw new Error('图谱尚未加载');
    const next = validateGraph(typeof updater === 'function' ? updater(session.draft) : updater);
    if (JSON.stringify(next) === JSON.stringify(session.draft)) return;
    session.draft = next; session.version++; session.status = session.error ? 'error' : 'pending';
    if (!session.firstDirty) session.firstDirty = Date.now();
    clearTimeout(session.timer);
    if (!session.error) session.timer = setTimeout(() => { void this.flush(id).catch(() => {}); }, Math.max(0, Math.min(this.delay, 2000 - (Date.now() - session.firstDirty))));
    this.emit();
  }
  flush(id: string): Promise<void> {
    const session = this.sessions.get(id); if (!session) return Promise.resolve();
    clearTimeout(session.timer); if (session.inflight) return session.inflight;
    if (session.version === session.savedVersion) return Promise.resolve();
    const generation = this.generation;
    const work = async () => {
      try {
        while (session.version !== session.savedVersion) {
          const pending = session.pending || { mutationId: crypto.randomUUID(), expectedRevision: session.document.revision, document: structuredClone(session.draft), version: session.version };
          session.pending = pending; session.status = 'saving'; session.error = undefined; this.emit();
          const saved = await this.transport<GraphDocument>(`/graphs/${id}`, { method: 'PUT', generation, body: pending });
          session.document = saved; session.savedVersion = pending.version; session.pending = undefined;
          if (session.version === pending.version) session.draft = parse(graphBodySchema, saved);
          const data = this.snapshot.data;
          if (data) this.snapshot = { ...this.snapshot, data: { ...data, graphs: data.graphs.map(g => g.id === id ? { ...g, title: saved.title, goal: saved.goal, revision: saved.revision, updatedAt: saved.updatedAt, nodeCount: saved.nodes.length, masteredCount: saved.nodes.filter(n => n.data.status === 'mastered').length } : g) } };
        }
        session.status = 'saved'; session.firstDirty = undefined;
      } catch (error) { session.status = 'error'; session.error = error as Error; throw error; }
      finally { session.inflight = undefined; this.emit(); }
    };
    session.inflight = work(); return session.inflight;
  }
  async flushAll() { await Promise.all([...this.sessions.keys()].map(id => this.flush(id))); await this.workspaceQueue; if (this.snapshot.workspaceError) throw this.snapshot.workspaceError; }
  patch(patch: WorkspacePatch): Promise<void> {
    const generation = this.generation;
    this.emit({ workspacePending: this.snapshot.workspacePending + 1 });
    const work = async () => {
      const changes = { ...this.failedWorkspacePatch, ...patch };
      try {
        if (!this.snapshot.data) return;
        let result;
        try { result = await this.transport<Bootstrap>('/workspace', { method: 'PATCH', generation, body: { expectedRevision: this.snapshot.data.workspace.revision, patch: changes } }); }
        catch (error) {
          if (!(error instanceof ApiError) || error.code !== 'WORKSPACE_CONFLICT') throw error;
          const fresh = await this.transport<Bootstrap>('/workspace');
          if (fresh.generationId !== generation) throw new ApiError(409, 'GENERATION_CONFLICT', '空间已改变，请重新加载');
          result = await this.transport<Bootstrap>('/workspace', { method: 'PATCH', generation, body: { expectedRevision: fresh.workspace.revision, patch: changes } });
        }
        this.failedWorkspacePatch = null; this.emit({ data: result, workspaceError: null });
      } catch (error) { this.failedWorkspacePatch = changes; this.emit({ workspaceError: error }); throw error; }
      finally { this.emit({ workspacePending: this.snapshot.workspacePending - 1 }); }
    };
    const result = this.workspaceQueue.then(work); this.workspaceQueue = result.catch(() => {}); return result;
  }
  retryWorkspace() { return this.failedWorkspacePatch ? this.patch(this.failedWorkspacePatch) : Promise.resolve(); }
  async switch(id: string) { if (this.activeId) await this.flush(this.activeId); await this.load(id); await this.patch({ activeGraphId: id }); }
  async create(body: unknown) {
    await this.flushAll();
    const content = validateGraph(body);
    if (!this.pendingCreate || JSON.stringify(this.pendingCreate.document) !== JSON.stringify(content)) this.pendingCreate = { id: crypto.randomUUID(), mutationId: crypto.randomUUID(), document: content };
    const pending = this.pendingCreate;
    const document = await this.transport<GraphDocument>('/graphs', { method: 'POST', generation: this.generation, body: pending });
    this.sessions.set(document.id, { document, draft: parse(graphBodySchema, document), version: 0, savedVersion: 0, status: 'saved' });
    await this.bootstrap(); this.pendingCreate = null; return document;
  }
  async reloadGraph(id: string) {
    const session = this.sessions.get(id); if (session?.inflight) await session.inflight.catch(() => {});
    const latest = await this.transport<Bootstrap>('/workspace');
    if (latest.generationId !== this.generation || !latest.graphs.some(g => g.id === id)) { await this.bootstrap(true); return; }
    clearTimeout(session?.timer); this.sessions.delete(id); this.histories.delete(id); await this.load(id); await this.bootstrap();
  }
  downloadDraft(id: string) { const graph = this.graph(id); if (graph) download(`${graph.title}.draft.thinkraph-graph.json`, { format: 'thinkraph.graph', formatVersion: 1, exportId: crypto.randomUUID(), exportedAt: new Date().toISOString(), graph: { schemaVersion: 2, id, ...parse(graphBodySchema, graph) } }); }
  async exportGraph(format = 'json') {
    const id = this.activeId; if (!id) throw new Error('请先选择图谱'); await this.flush(id);
    const graph = this.graph(id)!;
    const content = await this.transport(`/graphs/${id}/export?format=${format}&revision=${graph.revision}`, { generation: this.generation, text: format === 'markdown' });
    download(`${graph.title}.${format === 'markdown' ? 'md' : 'thinkraph-graph.json'}`, content, format === 'markdown');
  }
  async exportSpace() {
    await this.flushAll();
    const content = await this.transport('/workspace/export', { method: 'POST', generation: this.generation, body: { expectedGenerationId: this.generation, revisions: Object.fromEntries([...this.sessions].map(([id, s]) => [id, s.document.revision])) } });
    download(`${this.snapshot.data!.workspace.name}.thinkraph-space.json`, content);
  }
  async getConfig() { return this.transport('/config'); }
  async saveConfig(input: unknown) {
    const result = await this.transport<any>('/config', { method: 'PATCH', body: input });
    this.emit({ agentConfigured: result.agentConfigured }); return result;
  }
  async exportConfig() {
    const content = await this.transport('/config/export');
    download('thinkraph-config.json', content);
  }
  async importConfig(data: unknown) {
    const result = await this.transport<any>('/config/import', { method: 'POST', body: { data } });
    this.emit({ agentConfigured: result.agentConfigured }); return result;
  }
}
export const workspaceClient = new WorkspaceClient();
export function useWorkspace(client = workspaceClient) { return useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot); }
