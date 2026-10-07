import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppError, catalogItem, documentSchema, parse, portableGraph, settingsSchema, uuid, validateGraph, validatePackage, workspacePatchSchema, workspaceSchema, type CatalogItem, type GraphDocument, type ImportPackage, type PortableGraph, type SpacePackage, type StorageIssue, type Workspace } from '../../shared/schemas.js';
import { convertImport } from '../../shared/migrations.js';
import { acquireLock, atomicJson, hash, missing, readJson, safeDirectory, SerialQueue } from './files.js';

type Options = { dataDir: string; graphMaxBytes: number; spaceMaxBytes: number; maxGraphs: number; fault?: (point: string) => void };
type Base = { generationId: string; workspaceRevision: number; graphs: Record<string, number> };
type Receipt = { importId: string; mutationId: string; payloadHash: string; generationId: string; graphIds: string[]; idMap: Record<string, string>; committedAt: string };
type Preview = {
  importId: string; createdAt: string; expiresAt: string; base: Base; package: ImportPackage;
  mode: 'merge' | 'restore'; applyPreferences: boolean; idMap: Record<string, string>; warnings: string[];
  legacyIds: Record<string, string>; browserId?: string; payloadHash: string; original: unknown; sourceHash: string;
};
const date = () => new Date().toISOString();

export class Repository {
  private queue = new SerialQueue();
  private unlock?: () => Promise<void>;
  generationId = '';
  workspace!: Workspace;
  catalog: CatalogItem[] = [];
  issues: StorageIssue[] = [];
  warnings: string[] = [];
  private receiptsHealthy = true;
  private catalogRetry?: ReturnType<typeof setTimeout>;
  private closing = false;
  get writable() { return this.receiptsHealthy && this.issues.length === 0; }
  constructor(readonly options: Options) {}
  private root(...parts: string[]) { return path.join(this.options.dataDir, ...parts); }
  private generation(id = this.generationId) { return this.root('generations', parse(uuid, id)); }
  private file(id: string, generation = this.generationId) { return path.join(this.generation(generation), 'graphs', `${parse(uuid, id)}.json`); }
  private fault(point: string) { this.options.fault?.(point); }
  private guard(generation: string, allowIssues = false) {
    if (!generation) throw new AppError(400, 'GENERATION_REQUIRED', '缺少学习空间版本');
    if (generation !== this.generationId) throw new AppError(409, 'GENERATION_CONFLICT', '学习空间已被恢复或导入，请保留草稿并重新加载');
    if (!this.receiptsHealthy) throw new AppError(503, 'RECOVERY_REQUIRED', '导入回执尚未恢复，请重启服务后重试');
    if (!allowIssues && this.issues.length) throw new AppError(503, 'STORAGE_ISSUES', '空间存在损坏或不支持的文件，请先恢复', this.issues);
  }
  async open() {
    this.unlock = await acquireLock(this.options.dataDir);
    try {
      await safeDirectory(this.root('generations')); await safeDirectory(this.root('imports'));
      let current;
      try { current = await readJson(this.root('current.json')); }
      catch (error) {
        if (!missing(error)) throw new AppError(503, 'INVALID_POINTER', '空间指针损坏，请保留文件并恢复 current.json');
        if ((await fs.readdir(this.root('generations'))).length) throw new AppError(503, 'MISSING_POINTER', '存在历史空间但 current.json 丢失，拒绝创建空空间覆盖');
        this.generationId = randomUUID();
        this.workspace = parse(workspaceSchema, { schemaVersion: 2, id: randomUUID(), name: '我的学习空间', revision: 0, graphOrder: [], activeGraphId: null });
        await safeDirectory(path.join(this.generation(), 'graphs'));
        await atomicJson(path.join(this.generation(), 'workspace.json'), this.workspace);
        await atomicJson(path.join(this.generation(), 'catalog.json'), { schemaVersion: 2, graphs: [] });
        current = { schemaVersion: 2, generationId: this.generationId };
        await atomicJson(this.root('current.json'), current);
      }
      if (current.schemaVersion !== 2) throw new AppError(503, 'UNSUPPORTED_SCHEMA', '当前空间文件版本暂不支持');
      this.generationId = parse(uuid, current.generationId);
      await this.scan(); await this.recoverReceipts();
      for (const name of await fs.readdir(this.root('imports'))) {
        if (!name.endsWith('.preview.json')) continue;
        try { const preview = await readJson(this.root('imports', name)); if (Date.parse(preview.expiresAt) < Date.now()) await fs.rm(this.root('imports', name)); } catch { /* Keep unreadable records for diagnosis. */ }
      }
      return this;
    } catch (error) { await this.close(); throw error; }
  }
  async close() { this.closing = true; clearTimeout(this.catalogRetry); await this.queue.run(async () => { await this.unlock?.(); this.unlock = undefined; }); }
  private async readDocument(id: string, generation = this.generationId) {
    let raw;
    try { raw = await readJson(this.file(id, generation)); }
    catch (error) { if (missing(error)) throw new AppError(404, 'GRAPH_NOT_FOUND', '图谱不存在'); throw error; }
    if (raw.schemaVersion !== 2) throw new AppError(422, 'UNSUPPORTED_SCHEMA', '图谱文件版本暂不支持');
    const doc = parse(documentSchema, raw); validateGraph(doc, this.options.graphMaxBytes);
    if (doc.id !== id) throw new AppError(422, 'ID_MISMATCH', '文件名和图谱 ID 不一致');
    return doc;
  }
  private async scan() {
    this.workspace = parse(workspaceSchema, await readJson(path.join(this.generation(), 'workspace.json')));
    this.catalog = []; this.issues = [];
    for (const entry of await fs.readdir(path.join(this.generation(), 'graphs'))) {
      if (entry.startsWith('.') && entry.endsWith('.tmp')) continue;
      const id = entry.replace(/\.json$/, '');
      try {
        if (!entry.endsWith('.json')) throw new AppError(422, 'UNEXPECTED_FILE', '图谱目录包含未知文件');
        const graph = await this.readDocument(id); this.catalog.push(catalogItem(graph));
      } catch (error: any) { this.issues.push({ id: entry, code: error.code || 'CORRUPT_FILE', message: error.message }); }
    }
    const live = new Set(this.catalog.filter(g => !g.deletedAt).map(g => g.id));
    // Recover the derived membership if a crash happened after a graph commit.
    const order = [...new Set(this.workspace.graphOrder.filter(id => live.has(id))), ...[...live].filter(id => !this.workspace.graphOrder.includes(id))];
    if (!this.issues.length && (JSON.stringify(order) !== JSON.stringify(this.workspace.graphOrder) || (this.workspace.activeGraphId && !live.has(this.workspace.activeGraphId)))) {
      this.workspace = { ...this.workspace, revision: this.workspace.revision + 1, graphOrder: order, activeGraphId: live.has(this.workspace.activeGraphId || '') ? this.workspace.activeGraphId : order[0] || null };
      await atomicJson(path.join(this.generation(), 'workspace.json'), this.workspace);
    }
    await this.writeCatalog();
  }
  private async writeCatalog() {
    const warning = '图谱已保存，列表缓存待重建';
    try { this.fault('beforeCatalog'); await atomicJson(path.join(this.generation(), 'catalog.json'), { schemaVersion: 2, graphs: this.catalog }); this.warnings = this.warnings.filter(w => w !== warning); }
    catch {
      if (!this.warnings.includes(warning)) this.warnings.push(warning);
      if (!this.catalogRetry && !this.closing) {
        this.catalogRetry = setTimeout(() => { this.catalogRetry = undefined; if (!this.closing) void this.queue.run(() => this.writeCatalog()); }, 5000);
        this.catalogRetry.unref();
      }
    }
  }
  private async recoverReceipts() {
    this.receiptsHealthy = false;
    for (const id of await fs.readdir(this.root('generations'))) {
      if (!uuid.safeParse(id).success) continue;
      try {
        const commit = await readJson(path.join(this.generation(id), 'commit.json'));
        // Only current or explicitly committed generations can be receipts.
        if (id === this.generationId || commit.committed) {
          await this.writeReceipt(commit.receipt);
          if (!commit.committed) await atomicJson(path.join(this.generation(id), 'commit.json'), { ...commit, committed: true });
        }
      } catch (error) { if (!missing(error)) throw error; }
    }
    for (const item of this.catalog) {
      const doc = await this.readDocument(item.id); const imported = doc.provenance?.import;
      if (imported) await this.writeReceipt({ importId: imported.importId, mutationId: imported.mutationId, payloadHash: imported.payloadHash, generationId: this.generationId,
        graphIds: [doc.id], idMap: { [imported.sourceGraphId]: doc.id }, committedAt: doc.createdAt }, true);
    }
    this.receiptsHealthy = true;
  }
  private async writeReceipt(receipt: Receipt, onlyMissing = false) {
    const file = this.root('imports', `${parse(uuid, receipt.importId)}.receipt.json`);
    if (onlyMissing) { try { await readJson(file); return; } catch (e) { if (!missing(e)) throw e; } }
    await atomicJson(file, receipt);
  }
  private base(): Base { return { generationId: this.generationId, workspaceRevision: this.workspace.revision, graphs: Object.fromEntries(this.catalog.map(g => [g.id, g.revision])) }; }
  private assertBase(base: Base) { if (hash(base) !== hash(this.base())) throw new AppError(409, 'PREVIEW_STALE', '预览后空间内容已改变，请重新预览'); }
  private response() { return { workspace: this.workspace, generationId: this.generationId, graphs: this.workspace.graphOrder.map(id => this.catalog.find(g => g.id === id)).filter(Boolean), deleted: this.catalog.filter(g => g.deletedAt), issues: this.issues, warnings: this.warnings }; }
  state() { return this.queue.run(async () => this.response()); }
  get(id: string) { return this.queue.run(() => this.readDocument(id)); }
  private document(graph: PortableGraph, mutationId: string, payloadHash: string, provenance?: GraphDocument['provenance']): GraphDocument {
    const timestamp = date(); return { ...graph, revision: 1, createdAt: timestamp, updatedAt: timestamp, deletedAt: null, lastMutation: { id: mutationId, payloadHash }, ...(provenance ? { provenance } : {}) };
  }
  private async backup(doc: GraphDocument) {
    const directory = this.root('backups', this.generationId, doc.id); await atomicJson(path.join(directory, `revision-${doc.revision}.json`), doc);
  }
  private async pruneBackups(id: string) {
    const directory = this.root('backups', this.generationId, id);
    try { await fs.access(directory); } catch (error) { if (missing(error)) return; throw error; }
    const versions = (await fs.readdir(directory)).filter(n => /^revision-\d+\.json$/.test(n)).sort((a, b) => Number(b.match(/\d+/)![0]) - Number(a.match(/\d+/)![0]));
    for (const name of versions.slice(10)) await fs.rm(path.join(directory, name));
  }
  private async store(doc: GraphDocument, previous?: GraphDocument) {
    if (previous) await this.backup(previous);
    this.fault('beforeGraph');
    try { await atomicJson(this.file(doc.id), doc, point => this.fault(point)); }
    catch (error) {
      const disk = await this.readDocument(doc.id).catch(() => null);
      if (disk?.lastMutation.id !== doc.lastMutation.id || disk?.lastMutation.payloadHash !== doc.lastMutation.payloadHash) throw error;
      this.warnings.push('图谱正文已提交，目录同步未完成；请保留备份');
    }
    this.catalog = this.catalog.filter(g => g.id !== doc.id).concat(catalogItem(doc));
    await this.writeCatalog();
    await this.pruneBackups(doc.id).catch(() => { this.warnings.push('旧备份清理失败，已保留全部备份'); });
  }
  private async membership(doc: GraphDocument, activate = false) {
    const order = this.workspace.graphOrder.filter(id => id !== doc.id);
    if (!doc.deletedAt) { const index = this.workspace.graphOrder.indexOf(doc.id); order.splice(index < 0 ? order.length : index, 0, doc.id); }
    const next = { ...this.workspace, revision: this.workspace.revision + 1, graphOrder: order, graphViews: Object.fromEntries(Object.entries(this.workspace.graphViews).filter(([id]) => order.includes(id))),
      activeGraphId: activate && !doc.deletedAt ? doc.id : order.includes(this.workspace.activeGraphId || '') ? this.workspace.activeGraphId : order[0] || null };
    try { await atomicJson(path.join(this.generation(), 'workspace.json'), next); this.workspace = next; }
    catch { this.warnings.push('图谱已保存，空间列表更新失败，重启后可重建'); }
  }
  create(generation: string, id: string, mutationId: string, input: unknown) {
    return this.queue.run(async () => {
      this.guard(generation, true); parse(uuid, id); parse(uuid, mutationId);
      const body = validateGraph(input, this.options.graphMaxBytes), payloadHash = hash(body);
      try { const existing = await this.readDocument(id); if (existing.lastMutation.id === mutationId && existing.lastMutation.payloadHash === payloadHash) return existing; throw new AppError(409, 'ID_EXISTS', '图谱 ID 已存在'); }
      catch (error: any) { if (error.code !== 'GRAPH_NOT_FOUND') throw error; }
      if (this.catalog.filter(g => !g.deletedAt).length >= this.options.maxGraphs) throw new AppError(413, 'TOO_MANY_GRAPHS', '图谱数量达到上限');
      const doc = this.document({ ...body, id, schemaVersion: 2 }, mutationId, payloadHash);
      await this.store(doc); await this.membership(doc, true); return doc;
    });
  }
  private match(doc: GraphDocument, revision: number, mutationId: string, payloadHash: string) {
    parse(uuid, mutationId);
    if (doc.lastMutation.id === mutationId) {
      if (doc.lastMutation.payloadHash !== payloadHash) throw new AppError(409, 'MUTATION_REUSED', '同一次保存标识不能用于不同内容');
      return true;
    }
    if (!Number.isInteger(revision)) throw new AppError(400, 'REVISION_REQUIRED', '缺少 expectedRevision');
    if (doc.revision !== revision) throw new AppError(409, 'REVISION_CONFLICT', '图谱已被其他页面修改，请先处理冲突', { revision: doc.revision });
    return false;
  }
  save(generation: string, id: string, revision: number, mutationId: string, input: unknown) {
    return this.queue.run(async () => {
      this.guard(generation, true); const doc = await this.readDocument(id), body = validateGraph(input, this.options.graphMaxBytes), payloadHash = hash(body);
      if (this.match(doc, revision, mutationId, payloadHash)) return doc;
      if (doc.deletedAt) throw new AppError(409, 'GRAPH_DELETED', '该图谱已移入回收站');
      const next = { ...doc, ...body, revision: doc.revision + 1, updatedAt: date(), lastMutation: { id: mutationId, payloadHash } };
      await this.store(next, doc); return next;
    });
  }
  trash(generation: string, id: string, revision: number, mutationId: string, restore = false) {
    return this.queue.run(async () => {
      this.guard(generation, true); const doc = await this.readDocument(id), payloadHash = hash({ action: restore ? 'restore' : 'delete' });
      if (this.match(doc, revision, mutationId, payloadHash)) return doc;
      if (restore && this.catalog.filter(g => !g.deletedAt).length >= this.options.maxGraphs) throw new AppError(413, 'TOO_MANY_GRAPHS', '图谱数量达到上限');
      const next = { ...doc, revision: doc.revision + 1, updatedAt: date(), deletedAt: restore ? null : date(), lastMutation: { id: mutationId, payloadHash } };
      await this.store(next, doc); await this.membership(next, restore); return next;
    });
  }
  patchWorkspace(generation: string, revision: number, input: unknown) {
    return this.queue.run(async () => {
      this.guard(generation, true); const patch = parse(workspacePatchSchema, input);
      if (revision !== this.workspace.revision) throw new AppError(409, 'WORKSPACE_CONFLICT', '学习空间设置已改变，请重试');
      const next = { ...this.workspace, ...patch, graphViews: { ...this.workspace.graphViews, ...patch.graphViews }, revision: revision + 1 };
      const live = this.catalog.filter(g => !g.deletedAt).map(g => g.id);
      const known = [...new Set([...live, ...this.workspace.graphOrder.filter(id => this.issues.some(issue => issue.id === `${id}.json`))])];
      if (new Set(next.graphOrder).size !== known.length || next.graphOrder.length !== known.length || next.graphOrder.some(id => !known.includes(id)) || (next.activeGraphId && !known.includes(next.activeGraphId))) throw new AppError(422, 'INVALID_CATALOG', '空间列表或当前图谱无效');
      for (const [id, view] of Object.entries(next.graphViews)) {
        if (!live.includes(id)) { delete next.graphViews[id]; continue; }
        if (view.selectedNodeId && !(await this.readDocument(id)).nodes.some(n => n.id === view.selectedNodeId)) next.graphViews[id] = { ...view, selectedNodeId: null };
      }
      await atomicJson(path.join(this.generation(), 'workspace.json'), next); this.workspace = next; return this.response();
    });
  }
  private async exportSpace(): Promise<SpacePackage> {
    if (this.issues.length) throw new AppError(503, 'STORAGE_ISSUES', '部分图谱不可读取，无法导出完整空间', this.issues);
    const graphs = []; let bytes = 0;
    for (const id of this.workspace.graphOrder) {
      const graph = await this.readDocument(id); if (graph.deletedAt) throw new AppError(503, 'INVALID_CATALOG', '空间索引需要重建');
      const portable = portableGraph(graph); bytes += Buffer.byteLength(JSON.stringify(portable));
      if (bytes > this.options.spaceMaxBytes) throw new AppError(413, 'PACKAGE_TOO_LARGE', '空间导出内容超过大小上限，请调整配置或分别导出图谱');
      graphs.push(portable);
    }
    const settings = parse(settingsSchema, this.workspace);
    for (const [id, view] of Object.entries(settings.graphViews)) { const graph = graphs.find(g => g.id === id); if (!graph) delete settings.graphViews[id]; else if (view.selectedNodeId && !graph.nodes.some(n => n.id === view.selectedNodeId)) view.selectedNodeId = null; }
    return { format: 'thinkraph.workspace', formatVersion: 1, exportId: randomUUID(), exportedAt: date(),
      workspace: { id: this.workspace.id, name: this.workspace.name, activeGraphId: this.workspace.activeGraphId, settings }, catalog: { graphIds: this.workspace.graphOrder }, graphs };
  }
  exportWorkspace(generation: string, revisions: Record<string, number>) {
    return this.queue.run(async () => {
      this.guard(generation);
      for (const [id, revision] of Object.entries(revisions)) if (this.catalog.find(g => g.id === id)?.revision !== revision) throw new AppError(409, 'EXPORT_CONFLICT', '图谱版本已更新，请刷新后导出');
      return this.exportSpace();
    });
  }
  exportGraph(id: string, revision: number, generation: string) {
    return this.queue.run(async () => {
      this.guard(generation, true); const doc = await this.readDocument(id);
      if (doc.deletedAt || doc.revision !== revision) throw new AppError(409, 'EXPORT_CONFLICT', '图谱版本已更新，请重新导出');
      return { format: 'thinkraph.graph' as const, formatVersion: 1 as const, exportId: randomUUID(), exportedAt: date(), graph: portableGraph(doc) };
    });
  }
  private previewResponse(preview: Preview) {
    const graphs = preview.package.format === 'thinkraph.graph' ? [preview.package.graph] : preview.package.graphs;
    return { importId: preview.importId, expiresAt: preview.expiresAt, format: preview.package.format, mode: preview.mode, applyPreferences: preview.applyPreferences,
      graphCount: graphs.length, nodeCount: graphs.reduce((sum, g) => sum + g.nodes.length, 0), currentGraphCount: this.workspace.graphOrder.length,
      titles: graphs.map(g => ({ id: g.id, title: g.title, duplicate: this.catalog.some(c => !c.deletedAt && c.title === g.title) })), warnings: preview.warnings, idMap: preview.idMap, base: preview.base };
  }
  private async makePreview(input: unknown, mode: 'merge' | 'restore', applyPreferences: boolean, browserId?: string, titles?: Record<string, string>) {
    if (Buffer.byteLength(JSON.stringify(input)) > this.options.spaceMaxBytes) throw new AppError(413, 'PACKAGE_TOO_LARGE', '导入文件超过大小上限');
    const converted = convertImport(input, this.options.graphMaxBytes), pack = converted.package;
    if (pack.format === 'thinkraph.graph' && Buffer.byteLength(JSON.stringify(input)) > this.options.graphMaxBytes + 2 * 1024 * 1024) throw new AppError(413, 'PACKAGE_TOO_LARGE', '单图导入文件超过大小上限');
    if (pack.format === 'thinkraph.graph' && mode === 'restore') throw new AppError(422, 'INVALID_MODE', '单张图谱只支持追加导入');
    const graphs = pack.format === 'thinkraph.graph' ? [pack.graph] : pack.graphs;
    const count = graphs.length + (mode === 'restore' ? 0 : this.workspace.graphOrder.length);
    if (count > this.options.maxGraphs) throw new AppError(413, 'TOO_MANY_GRAPHS', `导入后图谱数超过 ${this.options.maxGraphs}`);
    for (const graph of graphs) if (titles?.[graph.id]) { graph.title = titles[graph.id]; validateGraph(graph, this.options.graphMaxBytes); }
    const importedExports = new Set<string>();
    for (const item of this.catalog) {
      const doc = await this.readDocument(item.id); const prior = doc.provenance;
      if (prior?.import?.exportId) importedExports.add(prior.import.exportId);
      if (browserId && prior?.legacyBrowserId === browserId && Object.values(converted.legacyIds).includes(prior.legacyGraphId || '')) throw new AppError(409, 'ALREADY_MIGRATED', '该浏览器图谱已经迁移，未重复创建');
    }
    if (importedExports.has(pack.exportId)) converted.warnings.push('该导出包曾被导入。本次执行将按所选模式再次创建副本或恢复空间。');
    const preview: Preview = { importId: randomUUID(), createdAt: date(), expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(), base: this.base(), package: pack, mode, applyPreferences,
      idMap: Object.fromEntries(graphs.map(g => [g.id, mode === 'restore' ? g.id : randomUUID()])), warnings: converted.warnings,
      legacyIds: converted.legacyIds, browserId, original: input, sourceHash: hash(input), payloadHash: hash({ pack, mode, applyPreferences, browserId }) };
    await atomicJson(this.root('imports', `${preview.importId}.preview.json`), preview);
    return this.previewResponse(preview);
  }
  preview(generation: string, input: unknown, mode: 'merge' | 'restore' = 'merge', applyPreferences = false, browserId?: string, titles?: Record<string, string>) {
    return this.queue.run(async () => { this.guard(generation); return this.makePreview(input, mode, applyPreferences, browserId, titles); });
  }
  receipt(id: string) { return this.queue.run(() => this.readReceipt(id)); }
  private async readReceipt(id: string): Promise<Receipt | null> { try { return await readJson(this.root('imports', `${parse(uuid, id)}.receipt.json`)); } catch (e) { if (missing(e)) return null; throw e; } }
  commit(generation: string, id: string, mutationId: string) {
    return this.queue.run(async () => {
      parse(uuid, mutationId); const existing = await this.readReceipt(id);
      if (existing) { if (existing.mutationId !== mutationId) throw new AppError(409, 'IMPORT_COMMITTED', '此预览已提交', existing); return existing; }
      this.guard(generation);
      let preview: Preview;
      try { preview = await readJson(this.root('imports', `${parse(uuid, id)}.preview.json`)); } catch (e) { if (missing(e)) throw new AppError(410, 'PREVIEW_EXPIRED', '预览不存在或已过期，请重新选择文件'); throw e; }
      if (Date.parse(preview.expiresAt) < Date.now()) throw new AppError(410, 'PREVIEW_EXPIRED', '预览已过期，请重新选择文件');
      this.assertBase(preview.base);
      if (hash(preview.original) !== preview.sourceHash || hash({ pack: preview.package, mode: preview.mode, applyPreferences: preview.applyPreferences, browserId: preview.browserId }) !== preview.payloadHash) throw new AppError(422, 'PREVIEW_CORRUPT', '预览记录完整性校验失败，请重新选择文件');
      validatePackage(preview.package, this.options.graphMaxBytes);
      const pack = preview.package, incoming = pack.format === 'thinkraph.graph' ? [pack.graph] : pack.graphs;
      if (incoming.length + (preview.mode === 'restore' ? 0 : this.workspace.graphOrder.length) > this.options.maxGraphs) throw new AppError(413, 'TOO_MANY_GRAPHS', '导入后图谱数量超过当前配置上限');
      const documents = incoming.map(graph => this.document({ ...graph, id: preview.idMap[graph.id] }, mutationId, hash(graph), {
        ...(preview.browserId ? { legacyBrowserId: preview.browserId, legacyGraphId: preview.legacyIds[graph.id], migratedAt: date() } : {}),
        import: { importId: id, mutationId, payloadHash: preview.payloadHash, exportId: pack.exportId, sourceGraphId: graph.id, ...(pack.format === 'thinkraph.workspace' ? { sourceWorkspaceId: pack.workspace.id } : {}) }
      }));
      const receipt: Receipt = { importId: id, mutationId, payloadHash: preview.payloadHash, generationId: this.generationId, graphIds: documents.map(g => g.id), idMap: preview.idMap, committedAt: date() };
      if (pack.format === 'thinkraph.graph') {
        await this.store(documents[0]); this.receiptsHealthy = false;
        await this.membership(documents[0], true);
        try { this.fault('beforeReceipt'); await this.writeReceipt(receipt); this.receiptsHealthy = true; }
        catch { throw new AppError(503, 'RECOVERY_REQUIRED', '图谱已写入，回执待恢复；请重启后查询本次导入'); }
        return receipt;
      }
      const currentDocs: GraphDocument[] = [];
      if (preview.mode === 'merge') for (const item of this.catalog) currentDocs.push(await this.readDocument(item.id));
      const settings = parse(settingsSchema, pack.workspace.settings);
      settings.graphViews = Object.fromEntries(Object.entries(settings.graphViews).map(([oldId, view]) => [preview.idMap[oldId], view]));
      const importedOrder = pack.catalog.graphIds.map(oldId => preview.idMap[oldId]);
      const incomingActive = pack.workspace.activeGraphId ? preview.idMap[pack.workspace.activeGraphId] : null;
      const workspace: Workspace = preview.mode === 'restore'
        ? { schemaVersion: 2, id: pack.workspace.id, name: pack.workspace.name, revision: 1, ...settings, graphOrder: importedOrder, activeGraphId: incomingActive }
        : { ...this.workspace, ...(preview.applyPreferences ? { ...settings, graphViews: { ...this.workspace.graphViews, ...settings.graphViews } } : {}),
            revision: this.workspace.revision + 1, graphOrder: [...this.workspace.graphOrder, ...importedOrder],
            activeGraphId: preview.applyPreferences ? incomingActive : this.workspace.activeGraphId || importedOrder[0] || null };
      const newGeneration = randomUUID(); receipt.generationId = newGeneration;
      await this.switchGeneration(newGeneration, workspace, [...currentDocs, ...documents], receipt);
      return receipt;
    });
  }
  private async switchGeneration(id: string, workspace: Workspace, documents: GraphDocument[], receipt: Receipt) {
    const previous = this.generationId, directory = this.generation(id);
    await safeDirectory(path.join(directory, 'graphs'));
    try {
      for (const doc of documents) { this.fault('stageGraph'); validateGraph(doc, this.options.graphMaxBytes); await atomicJson(this.file(doc.id, id), doc); }
      await atomicJson(path.join(directory, 'workspace.json'), parse(workspaceSchema, workspace));
      await atomicJson(path.join(directory, 'catalog.json'), { schemaVersion: 2, graphs: documents.map(catalogItem) });
      await atomicJson(path.join(directory, 'commit.json'), { previousGenerationId: previous, receipt, committed: false });
      this.fault('beforePointer');
      await atomicJson(this.root('current.json'), { schemaVersion: 2, generationId: id });
    } catch (error) {
      const pointer = await readJson(this.root('current.json')).catch(() => null);
      if (pointer?.generationId !== id) { await fs.rm(directory, { recursive: true, force: true }); throw error; }
      // A failure after rename can still mean the commit point was reached.
    }
    this.generationId = id; this.workspace = workspace; this.catalog = documents.map(catalogItem); this.issues = []; this.receiptsHealthy = false;
    try {
      this.fault('afterPointer'); await this.writeReceipt(receipt);
      await atomicJson(path.join(directory, 'commit.json'), { previousGenerationId: previous, receipt, committed: true });
      this.receiptsHealthy = true;
      await this.pruneGenerations().catch(() => { this.warnings.push('旧空间快照清理失败，已保留全部快照'); });
    } catch { throw new AppError(503, 'RECOVERY_REQUIRED', '空间已经切换，回执待恢复；请重启后查询本次导入'); }
  }
  private async snapshotsInternal() {
    const result = [];
    for (const id of await fs.readdir(this.root('generations'))) {
      if (id === this.generationId || !uuid.safeParse(id).success) continue;
      const directory = this.generation(id);
      try {
        const commit = await readJson(path.join(directory, 'commit.json')).catch(e => { if (missing(e)) return null; throw e; });
        // Interrupted staging directories were never active and cannot be recovery points.
        if (commit && !commit.committed) continue;
        const workspace = parse(workspaceSchema, await readJson(path.join(directory, 'workspace.json'))), stat = await fs.stat(directory);
        result.push({ id, name: workspace.name, graphCount: workspace.graphOrder.length, createdAt: stat.mtime.toISOString() });
      } catch { /* Corrupt snapshots stay on disk for manual recovery. */ }
    }
    return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  snapshots() { return this.queue.run(() => this.snapshotsInternal()); }
  private async pruneGenerations() { for (const item of (await this.snapshotsInternal()).slice(3)) await fs.rm(this.generation(item.id), { recursive: true, force: true }); }
  previewSnapshot(generation: string, id: string) {
    return this.queue.run(async () => {
      this.guard(generation); if (!(await this.snapshotsInternal()).some(s => s.id === id)) throw new AppError(404, 'SNAPSHOT_NOT_FOUND', '回退点不存在');
      const workspace = parse(workspaceSchema, await readJson(path.join(this.generation(id), 'workspace.json'))), graphs = [];
      for (const graphId of workspace.graphOrder) graphs.push(portableGraph(await this.readDocument(graphId, id)));
      return this.makePreview({ format: 'thinkraph.workspace', formatVersion: 1, exportId: randomUUID(), exportedAt: date(),
        workspace: { id: workspace.id, name: workspace.name, activeGraphId: workspace.activeGraphId, settings: parse(settingsSchema, workspace) }, catalog: { graphIds: workspace.graphOrder }, graphs }, 'restore', true);
    });
  }
  backups(id: string) {
    return this.queue.run(async () => {
      const directory = this.root('backups', this.generationId, parse(uuid, id));
      const files = await fs.readdir(directory).catch(e => { if (missing(e)) return []; throw e; });
      const versions = [];
      for (const file of files) {
        if (!/^revision-\d+\.json$/.test(file)) continue;
        try { const doc = parse(documentSchema, await readJson(path.join(directory, file))); validateGraph(doc); versions.push({ revision: doc.revision, updatedAt: doc.updatedAt, title: doc.title }); } catch { /* Never offer an invalid backup. */ }
      }
      return versions.sort((a, b) => b.revision - a.revision);
    });
  }
  restoreBackup(generation: string, id: string, backupRevision: number, expectedRevision: number | null, mutationId: string) {
    return this.queue.run(async () => {
      this.guard(generation, true); parse(uuid, id); parse(uuid, mutationId);
      if (!Number.isSafeInteger(backupRevision) || backupRevision < 1) throw new AppError(400, 'INVALID_REVISION', '备份版本无效');
      const old = await this.readDocument(id).catch((error: any) => { if (error.code === 'UNSUPPORTED_SCHEMA') throw error; return null; });
      if (old && old.revision !== expectedRevision) throw new AppError(409, 'REVISION_CONFLICT', '当前图谱版本已更新');
      const backup = parse(documentSchema, await readJson(this.root('backups', this.generationId, id, `revision-${backupRevision}.json`))); validateGraph(backup, this.options.graphMaxBytes);
      if (backup.id !== id) throw new AppError(422, 'ID_MISMATCH', '备份 ID 不一致');
      if (!old) { const quarantined = this.root('backups', this.generationId, id, `corrupt-${randomUUID()}.json`); await fs.copyFile(this.file(id), quarantined); }
      const versions = (await fs.readdir(this.root('backups', this.generationId, id))).filter(name => /^revision-\d+\.json$/.test(name)).map(name => Number(name.match(/\d+/)![0]));
      const next = { ...backup, revision: Math.max(old?.revision || 0, backupRevision, !old ? Math.max(...versions) + 1 : 0) + 1, updatedAt: date(), lastMutation: { id: mutationId, payloadHash: hash(backup) } };
      await this.store(next, old || undefined); await this.scan(); return next;
    });
  }
}
