import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { ApiError, invariant } from './errors.mjs';

const checksum = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const emptyState = () => ({ memories: [], goals: [], notes: [], experiences: [], events: [] });
export function validateData(data) {
  invariant(data && typeof data === 'object' && !Array.isArray(data), 400, 'INVALID_STATE', 'data 必须是对象。');
  invariant(Buffer.byteLength(JSON.stringify(data)) <= 1024 * 1024, 413, 'STATE_TOO_LARGE', '私有状态不能超过 1 MiB。');
  for (const key of ['memories', 'goals', 'notes', 'experiences', 'events']) invariant(data[key] === undefined || Array.isArray(data[key]), 400, 'INVALID_STATE', key + ' 必须是数组。');
  let count = 0;
  const visit = (value, depth) => {
    invariant(depth < 25 && ++count <= 30000, 400, 'INVALID_STATE', '状态结构过深或过大。');
    if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
      invariant(!['__proto__', 'prototype', 'constructor'].includes(key), 400, 'INVALID_STATE', '状态包含不支持的字段。');
      visit(child, depth + 1);
    }
  };
  visit(data, 0);
}
export async function atomicWrite(file, bytes) {
  const temp = file + '.' + randomUUID() + '.tmp';
  let handle;
  try {
    handle = await fs.open(temp, 'wx', 0o600);
    await handle.writeFile(bytes); await handle.sync(); await handle.close(); handle = null;
    await fs.rename(temp, file);
    const directory = await fs.open(path.dirname(file), 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  } finally { await handle?.close(); await fs.rm(temp, { force: true }); }
}
export class PrivateStore {
  constructor(directory, { repoRoot, maxWorkspaces = 12 } = {}) {
    this.directory = path.resolve(directory || path.join(os.homedir(), '.local/share/nanaly'));
    this.repoRoot = repoRoot && path.resolve(repoRoot);
    this.maxWorkspaces = maxWorkspaces;
    this.tail = Promise.resolve();
    this.recovered = false;
  }
  async init() {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    const actual = await fs.realpath(this.directory);
    if (this.repoRoot) {
      const root = await fs.realpath(this.repoRoot);
      invariant(actual !== root && !actual.startsWith(root + path.sep), 500, 'PRIVATE_PATH_REQUIRED', '私有数据目录必须位于公开仓库之外。');
    }
    invariant(!(await fs.lstat(this.directory)).isSymbolicLink(), 500, 'PRIVATE_PATH_REQUIRED', '私有数据目录不能是符号链接。');
    await fs.chmod(this.directory, 0o700);
    this.lockFile = path.join(this.directory, 'server.lock');
    try {
      this.lock = await fs.open(this.lockFile, 'wx', 0o600);
      await this.lock.writeFile(JSON.stringify({ pid: process.pid }));
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let owner;
      try { owner = JSON.parse(await fs.readFile(this.lockFile, 'utf8')).pid; } catch { /* refuse unknown lock */ }
      invariant(Number.isInteger(owner) && owner > 0, 500, 'STORE_LOCKED', '私有存储锁无效，需要管理员检查。');
      let alive = true;
      try { process.kill(owner, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; }
      invariant(!alive, 500, 'STORE_LOCKED', '该私有存储已被另一个后端占用。');
      await fs.unlink(this.lockFile);
      this.lock = await fs.open(this.lockFile, 'wx', 0o600);
      await this.lock.writeFile(JSON.stringify({ pid: process.pid }));
    }
    await fs.mkdir(path.join(this.directory, 'workspaces'), { recursive: true, mode: 0o700 });
    await fs.mkdir(path.join(this.directory, 'jobs'), { recursive: true, mode: 0o700 });
    this.state = await this.readRecord('state', { revision: 0, data: emptyState() });
    validateData(this.state.data);
    this.history = await this.readRecord('history', { runs: [] });
    this.workspaces = await this.readRecord('workspaces', { items: {} });
    return this;
  }
  async readRecord(name, fallback) {
    const file = path.join(this.directory, name + '.json');
    let absent = false, backupAbsent = false;
    for (const suffix of ['', '.bak']) {
      try {
        const raw = JSON.parse(await fs.readFile(file + suffix, 'utf8'));
        if (raw.format !== 1 || checksum(raw.value) !== raw.checksum) throw new Error('checksum');
        if (suffix) { this.recovered = true; await atomicWrite(file, JSON.stringify(raw)); }
        return raw.value;
      } catch (error) { if (!suffix) absent = error.code === 'ENOENT'; else backupAbsent = error.code === 'ENOENT'; }
    }
    if (absent && backupAbsent) return fallback;
    throw new ApiError(500, 'STORE_CORRUPT', '私有数据及备份均无法读取；为避免覆盖，后端已停止。');
  }
  async writeRecord(name, value) {
    const file = path.join(this.directory, name + '.json');
    const raw = JSON.stringify({ format: 1, value, checksum: checksum(value) });
    try {
      const previous = await fs.readFile(file);
      await atomicWrite(file + '.bak', previous);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await atomicWrite(file, raw);
  }
  serial(operation) {
    const result = this.tail.then(operation);
    this.tail = result.catch(() => {});
    return result;
  }
  getState() { return structuredClone(this.state); }
  putState(revision, data) {
    validateData(data);
    return this.serial(async () => {
      invariant(Number.isSafeInteger(revision) && revision >= 0, 400, 'INVALID_REVISION', '缺少有效的数据版本。');
      invariant(revision === this.state.revision, 409, 'REVISION_CONFLICT', '另一设备已更新数据，请合并后重试。', this.getState());
      const next = { revision: revision + 1, data: structuredClone(data) };
      await this.writeRecord('state', next); this.state = next;
      return this.getState();
    });
  }
  getWorkspace(id) {
    invariant(/^[a-f0-9-]{36}$/.test(id || ''), 400, 'INVALID_WORKSPACE', '工作区编号无效。');
    const value = this.workspaces.items[id];
    invariant(value, 404, 'WORKSPACE_NOT_FOUND', '工作区不存在或已重置。');
    return structuredClone(value);
  }
  resetWorkspace(id, language) {
    invariant(['git', 'linux', 'mysql'].includes(language), 400, 'INVALID_LANGUAGE', '此语言不支持持续工作区。');
    return this.serial(async () => {
      if (id) {
        this.getWorkspace(id);
        invariant(!this.busy?.has(id), 409, 'WORKSPACE_BUSY', '该工作区正在执行，请稍后重置。');
      } else invariant(Object.keys(this.workspaces.items).length < this.maxWorkspaces, 409, 'WORKSPACE_LIMIT', '工作区已达上限，请先删除不使用的工作区。');
      const workspaceId = randomUUID();
      const value = { workspaceId, language, revision: 0, updatedAt: new Date().toISOString() };
      const next = structuredClone(this.workspaces);
      if (id) delete next.items[id];
      next.items[workspaceId] = value;
      await this.writeRecord('workspaces', next);
      if (id) await this.writeRecord('workspaces', next);
      this.workspaces = next;
      if (id) await this.deleteSnapshots(id);
      return value;
    });
  }
  deleteWorkspace(id) {
    return this.serial(async () => {
      this.getWorkspace(id);
      invariant(!this.busy?.has(id), 409, 'WORKSPACE_BUSY', '该工作区正在执行，请稍后删除。');
      const next = structuredClone(this.workspaces); delete next.items[id];
      await this.writeRecord('workspaces', next); await this.writeRecord('workspaces', next); this.workspaces = next;
      await this.deleteSnapshots(id);
      return { deleted: true };
    });
  }
  async deleteSnapshots(id) {
    for (const name of await fs.readdir(path.join(this.directory, 'workspaces'))) {
      if (name.startsWith(id + '.')) await fs.rm(path.join(this.directory, 'workspaces', name), { force: true });
    }
  }
  snapshotPath(workspace) { return path.join(this.directory, 'workspaces', workspace.workspaceId + '.' + workspace.revision + '.snapshot'); }
  commitWorkspace(workspace, snapshot, { signal } = {}) {
    return this.serial(async () => {
      invariant(!signal?.aborted, 499, 'RUN_CANCELLED', '本次执行已取消。');
      const current = this.getWorkspace(workspace.workspaceId);
      invariant(current.revision === workspace.revision, 409, 'WORKSPACE_CONFLICT', '工作区已被更新。', { workspaceRevision: current.revision });
      const value = { ...current, revision: current.revision + 1, updatedAt: new Date().toISOString() };
      await atomicWrite(this.snapshotPath(value), snapshot);
      invariant(!signal?.aborted, 499, 'RUN_CANCELLED', '本次执行已取消。');
      const next = structuredClone(this.workspaces); next.items[value.workspaceId] = value;
      await this.writeRecord('workspaces', next); this.workspaces = next;
      // Keep one prior snapshot for metadata backup recovery.
      if (current.revision > 1) await fs.rm(this.snapshotPath({ ...current, revision: current.revision - 1 }), { force: true });
      return value;
    });
  }
  saveRun(run) {
    return this.serial(async () => {
      const saved = structuredClone(run);
      for (const result of [saved, ...(saved.tests || [])]) {
        for (const key of ['stdout', 'stderr']) if (typeof result[key] === 'string' && result[key].length > 16384) {
          result[key] = result[key].slice(0, 16384); saved.historyOutputTruncated = true;
        }
      }
      invariant(Buffer.byteLength(JSON.stringify(saved)) <= 2 * 1024 * 1024, 413, 'HISTORY_TOO_LARGE', '该次历史记录过大。');
      const next = { runs: [...this.history.runs, saved].slice(-50) };
      while (Buffer.byteLength(JSON.stringify(next)) > 2 * 1024 * 1024 && next.runs.length > 1) next.runs.shift();
      await this.writeRecord('history', next); this.history = next;
    });
  }
  clearRuns() { return this.serial(async () => { await this.writeRecord('history', { runs: [] }); await this.writeRecord('history', { runs: [] }); this.history = { runs: [] }; }); }
  async close() {
    await this.tail;
    if (this.lock) { await this.lock.close(); this.lock = null; await fs.rm(this.lockFile, { force: true }); }
  }
}
