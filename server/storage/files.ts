import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { AppError } from '../../shared/schemas.js';

export const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
export async function syncDirectory(directory: string) {
  const handle = await fs.open(directory, 'r');
  try { await handle.sync(); } catch (error: any) { if (!['EINVAL', 'ENOTSUP'].includes(error.code)) throw error; } finally { await handle.close(); }
}
export async function safeDirectory(directory: string) {
  await fs.mkdir(directory, { recursive: true });
  if ((await fs.lstat(directory)).isSymbolicLink()) throw new AppError(503, 'UNSAFE_PATH', '存储目录不能为符号链接');
}
export async function readJson(file: string): Promise<any> {
  if ((await fs.lstat(file)).isSymbolicLink()) throw new AppError(503, 'UNSAFE_PATH', '数据文件不能为符号链接');
  return JSON.parse(await fs.readFile(file, 'utf8'));
}
export async function atomicJson(file: string, value: unknown, fault?: (point: string) => void) {
  await safeDirectory(path.dirname(file));
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await fs.open(temporary, 'wx', 0o600);
    await handle.writeFile(JSON.stringify(value, null, 2) + '\n'); await handle.sync(); await handle.close(); handle = undefined;
    fault?.('afterTempWrite');
    await fs.rename(temporary, file); fault?.('afterRename'); await syncDirectory(path.dirname(file));
  } finally { await handle?.close(); await fs.rm(temporary, { force: true }).catch(() => {}); }
}
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(task: () => Promise<T>): Promise<T> { const next = this.tail.then(task); this.tail = next.catch(() => {}); return next; }
}
export async function acquireLock(root: string) {
  await safeDirectory(root);
  const directory = path.join(root, '.workspace.lock'), token = randomUUID();
  const owner = { pid: process.pid, hostname: hostname(), token, createdAt: new Date().toISOString() };
  try { await fs.mkdir(directory); }
  catch (error: any) {
    if (error.code !== 'EEXIST') throw error;
    let old;
    try { old = await readJson(path.join(directory, 'owner.json')); }
    catch { throw new AppError(503, 'LOCK_INCOMPLETE', '空间锁记录不完整，请确认没有其他服务后移走 .workspace.lock 再重启'); }
    if (old.hostname !== hostname() || !Number.isInteger(old.pid)) throw new AppError(503, 'LOCKED', '学习空间被另一台主机锁定');
    let alive = true;
    try { process.kill(old.pid, 0); } catch (e: any) { if (e.code === 'ESRCH') alive = false; }
    if (alive) throw new AppError(503, 'LOCKED', '该学习空间已有服务运行');
    // Atomic claim of the stale lock prevents two starters from deleting a fresh lock.
    const claim = path.join(directory, 'reclaim');
    try { const h = await fs.open(claim, 'wx'); await h.close(); } catch { throw new AppError(503, 'LOCKED', '另一服务正在恢复空间锁'); }
    const stale = `${directory}.stale-${token}`; await fs.rename(directory, stale);
    try { await fs.mkdir(directory); } catch { throw new AppError(503, 'LOCKED', '另一服务已获取空间锁'); }
    await fs.rm(stale, { recursive: true, force: true });
  }
  await atomicJson(path.join(directory, 'owner.json'), owner);
  return async () => { const current = await readJson(path.join(directory, 'owner.json')).catch(() => null); if (current?.token === token) await fs.rm(directory, { recursive: true, force: true }); };
}
