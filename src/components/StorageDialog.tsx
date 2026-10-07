import React, { useEffect, useState } from 'react';
import { Dialog, Button, Checkbox, Select, TextField } from '@radix-ui/themes';
import { api, type WorkspaceClient } from '../state/workspace.js';

export type StorageMode = 'graph' | 'workspace' | 'migration' | 'recovery' | null;
export function StorageDialog({ client, mode, close, notify }: { client: WorkspaceClient; mode: StorageMode; close: () => void; notify: (text: string) => void }) {
  const [raw, setRaw] = useState<any>(null), [fileName, setFileName] = useState(''), [preview, setPreview] = useState<any>(null);
  const [importMode, setImportMode] = useState<'merge' | 'restore'>('merge'), [preferences, setPreferences] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [snapshots, setSnapshots] = useState<any[]>([]), [backups, setBackups] = useState<any[]>([]);
  const [recoveryId, setRecoveryId] = useState(client.activeId || ''), [titles, setTitles] = useState<Record<string, string>>({});
  const [attempt, setAttempt] = useState<{ importId: string; mutationId: string } | null>(null);
  const [browserId, setBrowserId] = useState<string>();
  const [previewDirty, setPreviewDirty] = useState(false);
  const message = (error: any) => `${error.message || '操作失败'}${error.details ? `\n${JSON.stringify(error.details, null, 2)}` : ''}`;
  useEffect(() => {
    if (!mode) return;
    setRaw(null); setPreview(null); setAttempt(null); setError(''); setTitles({}); setPreviewDirty(false); setImportMode('merge'); setPreferences(false); setBrowserId(undefined);
    if (mode === 'migration') {
      try {
        const library = localStorage.getItem('thinkraph-maps-v1'), single = localStorage.getItem('thinkraph-prototype-v1');
        if (!library && !single) throw new Error('当前浏览器没有发现旧版图谱数据');
        const data = JSON.parse(library || single!);
        let identity = localStorage.getItem('thinkraph-browser-id'); if (!identity) { identity = crypto.randomUUID(); localStorage.setItem('thinkraph-browser-id', identity); }
        setBrowserId(identity); setRaw(data); setFileName(library ? '此浏览器的图谱库' : '此浏览器的单张图谱');
      } catch (error) { setError(message(error)); }
    }
    if (mode === 'recovery') {
      api<any[]>('/workspace/snapshots').then(setSnapshots).catch(e => setError(message(e)));
    }
  }, [mode]);
  useEffect(() => { if (mode === 'recovery' && recoveryId) api<any[]>(`/graphs/${recoveryId}/backups`).then(setBackups).catch(e => setError(message(e))); }, [mode, recoveryId]);
  async function run(task: () => Promise<void>) { setBusy(true); setError(''); try { await task(); } catch (error) { setError(message(error)); } finally { setBusy(false); } }
  async function load(file?: File) {
    if (!file) return;
    await run(async () => {
      if (file.size > 100 * 1024 * 1024) throw new Error('文件不能超过 100 MiB');
      const data = JSON.parse(await file.text());
      if (mode === 'graph' && (data.format === 'thinkraph.workspace' || data.maps)) throw new Error('这是学习空间文件，请从“导入学习空间”打开');
      if (mode === 'workspace' && data.format !== 'thinkraph.workspace' && !data.maps) throw new Error('这是单张图谱文件，请从“导入知识图谱”打开');
      setRaw(data); setFileName(file.name); setPreview(null); setTitles({}); setAttempt(null);
    });
  }
  function resetPreview() { setPreview(null); setAttempt(null); }
  const isSpace = raw?.format === 'thinkraph.workspace' || Array.isArray(raw?.maps);
  async function makePreview() {
    await run(async () => {
      await client.flushAll();
      setPreview(await api('/imports/preview', { method: 'POST', generation: client.generation, body: { data: raw, mode: importMode, applyPreferences: preferences, browserId, titles } }));
      setAttempt(null); setPreviewDirty(false);
    });
  }
  async function commit() {
    const request = attempt || { importId: preview.importId, mutationId: crypto.randomUUID() }; setAttempt(request);
    await run(async () => {
      await client.flushAll();
      let receipt;
      try { receipt = await api(`/imports/${request.importId}/commit`, { method: 'POST', generation: client.generation, body: { mutationId: request.mutationId } }); }
      catch (error) { const check = await api(`/imports/${request.importId}`).catch(() => null); if (!check?.receipt) throw error; receipt = check.receipt; }
      await client.bootstrap(true); notify(`导入完成，共 ${receipt.graphIds.length} 张图谱`); close();
    });
  }
  const data = client.snapshot.data;
  return <Dialog.Root open={Boolean(mode)} onOpenChange={open => { if (!open && !busy) close(); }}><Dialog.Content maxWidth="620px">
    <Dialog.Title>{mode === 'recovery' ? '本地恢复与回收站' : mode === 'migration' ? '迁移浏览器旧数据' : mode === 'workspace' ? '导入学习空间' : '导入知识图谱'}</Dialog.Title>
    <Dialog.Description>{mode === 'recovery' ? '恢复会保留当前文件的备份。空间回退会先展示影响预览。' : '先校验并查看影响，再写入本地文件。原始文件和浏览器数据会保留。'}</Dialog.Description>
    {mode !== 'recovery' && <div className="storage-form">
      {mode !== 'migration' && <label className="file-choice">选择 JSON 文件<input type="file" accept=".json,application/json" disabled={busy} onChange={e => void load(e.target.files?.[0])}/></label>}
      {fileName && <p>{fileName}</p>}
      {isSpace && <><label>导入方式<Select.Root value={importMode} disabled={busy || Boolean(attempt)} onValueChange={value => { setImportMode(value as 'merge' | 'restore'); resetPreview(); }}><Select.Trigger/><Select.Content><Select.Item value="merge">合并追加（保留当前空间）</Select.Item><Select.Item value="restore">整体恢复（替换当前空间）</Select.Item></Select.Content></Select.Root></label>
        {importMode === 'merge' && <label className="check-line"><Checkbox checked={preferences} disabled={busy || Boolean(attempt)} onCheckedChange={value => { setPreferences(value === true); resetPreview(); }}/>同时应用导入包的界面偏好与当前图谱</label>}</>}
      {raw && !attempt && <Button disabled={busy} onClick={() => void makePreview()}>{busy ? '正在校验…' : preview ? '重新校验预览' : '校验并预览'}</Button>}
    </div>}
    {mode === 'recovery' && !preview && <div className="storage-form">
      {data?.issues.map(issue => <p className="form-error" key={issue.id}>{issue.id}：{issue.message}</p>)}
      <h3>图谱历史版本</h3>
      <Select.Root value={recoveryId} onValueChange={setRecoveryId}><Select.Trigger placeholder="选择图谱"/><Select.Content>
        {[...(data?.graphs || []), ...(data?.deleted || []), ...(data?.issues || []).map(i => ({ id: i.id.replace(/\.json$/, ''), title: i.id }))].map(g => <Select.Item key={g.id} value={g.id}>{g.title}</Select.Item>)}
      </Select.Content></Select.Root>
      {backups.length === 0 && <p>这张图谱暂无历史版本。</p>}
      {backups.map(b => <div className="recovery-row" key={b.revision}><span>版本 {b.revision} · {new Date(b.updatedAt).toLocaleString()}</span><Button size="1" variant="soft" disabled={busy} onClick={() => void run(async () => {
        await client.flushAll(); const current = await api(`/graphs/${recoveryId}`).catch(() => null);
        await api(`/graphs/${recoveryId}/backups/restore`, { method: 'POST', generation: client.generation, body: { backupRevision: b.revision, expectedRevision: current?.revision || null, mutationId: crypto.randomUUID() } });
        await client.bootstrap(true); notify('已恢复图谱历史版本'); close();
      })}>恢复此版本</Button></div>)}
      <h3>回收站</h3>
      {!data?.deleted.length && <p>回收站为空。</p>}
      {data?.deleted.map(g => <div className="recovery-row" key={g.id}><span>{g.title}</span><Button size="1" variant="soft" disabled={busy} onClick={() => void run(async () => {
        await api(`/graphs/${g.id}/restore`, { method: 'POST', generation: client.generation, body: { expectedRevision: g.revision, mutationId: crypto.randomUUID() } }); await client.bootstrap(true); notify('已恢复图谱'); close();
      })}>恢复图谱</Button></div>)}
      <h3>空间回退点</h3>{!snapshots.length && <p>导入学习空间后会自动保留最近 3 个回退点。</p>}
      {snapshots.map(s => <div className="recovery-row" key={s.id}><span>{s.name} · {s.graphCount} 张图谱<br/><small>{new Date(s.createdAt).toLocaleString()}</small></span><Button size="1" variant="soft" disabled={busy} onClick={() => void run(async () => { await client.flushAll(); setPreview(await api(`/workspace/snapshots/${s.id}/restore`, { method: 'POST', generation: client.generation, body: {} })); })}>预览恢复</Button></div>)}
    </div>}
    {preview && <div className="import-preview">
      <p><strong>{preview.graphCount} 张图谱 · {preview.nodeCount} 个节点</strong></p>
      <p>{preview.mode === 'restore' ? `当前 ${preview.currentGraphCount} 张图谱将退出当前空间，恢复导入包的空间名称、图谱顺序和界面偏好。导入前内容保留为回退点。${preview.graphCount === 0 ? '此次恢复后空间为空。' : ''}` : `追加到当前 ${preview.currentGraphCount} 张图谱之后，生成新的图谱 ID。${preview.applyPreferences ? '同时应用导入包的界面偏好。' : '保留当前空间名称与界面偏好。'}`}</p>
      {preview.warnings.map((warning: string) => <p className="form-warning" key={warning}>{warning}</p>)}
      {preview.titles.map((g: any) => <div className="import-title-row" key={g.id}><TextField.Root aria-label={`导入图谱名称 ${g.title}`} value={titles[g.id] ?? g.title} disabled={busy || Boolean(attempt) || mode === 'recovery'} onChange={e => { setTitles({ ...titles, [g.id]: e.target.value }); setPreviewDirty(true); }}/>{g.duplicate && <small>存在同名图谱，将独立保留</small>}</div>)}
      {previewDirty && <p>名称已修改，请先点击“重新校验预览”。</p>}
      <Button color={preview.mode === 'restore' ? 'orange' : undefined} disabled={busy || previewDirty} onClick={() => void commit()}>{busy ? '正在执行…' : attempt ? '查询并重试本次导入' : preview.mode === 'restore' ? '执行整体恢复' : '执行导入'}</Button>
    </div>}
    {error && <pre className="storage-error" role="alert">{error}</pre>}
    <div className="dialog-actions"><Button variant="soft" color="gray" disabled={busy} onClick={close}>关闭</Button></div>
  </Dialog.Content></Dialog.Root>;
}
