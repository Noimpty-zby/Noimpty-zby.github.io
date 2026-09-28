import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ApiError, invariant } from './errors.mjs';
import { diagnostics } from './validation.mjs';
import { PtySession } from './pty-session.mjs';

// Interactive terminals on the same sandbox as script runs (runner.mjs): no network, no root,
// fixed CPU/memory/pids limits. A Git/Linux shell holds its workspace while it lives and saves
// it (CAS) when it ends; a C/C++/Go/Python run gets a throwaway container of its own.
export const SHELL_DETACHED = 30 * 60 * 1000;
export const SHELL_LIFETIME = 3 * 60 * 60 * 1000;
const TASK_LIFETIME = 30 * 60 * 1000;
const SNAPSHOT_LIMIT = 32 * 1024 * 1024;
const PIDFILE = '/tmp/nanaly-shell.pid';
const HELPER = '/opt/nanaly/shell-session.py';
const quote = value => "'" + String(value).replace(/'/g, "'\\''") + "'";
// The service runs with umask 077; the sandbox user is another uid under rootless Docker, so
// every file it must read gets an explicit world-readable mode.
const readable = async (file, write) => { await write(); await fs.chmod(file, 0o444); };
export const TASKS = {
  c: { file: 'main.c', command: 'gcc -std=c17 -Wall -Wextra -g main.c -o main -lm && ./main' },
  cpp: { file: 'main.cpp', command: 'g++ -std=c++20 -Wall -Wextra -g main.cpp -o main && ./main' },
  go: { file: 'main.go', command: 'go build -o main main.go && ./main', prepare: 'cp -r /opt/go-cache /tmp/go-cache 2>/dev/null' },
  python: { file: 'main.py', command: 'python3 main.py' }
};
const MESSAGES = {
  closed: '终端已保存并关闭。', input_limit: '输入积压过多，终端已关闭；请重新打开。', idle: '网页离开超过 30 分钟，终端已保存并关闭。', lifetime: '终端已连续开了 3 小时，已保存；会自动重新打开。',
  run_failed: '脚本监督异常，终端已关闭；请重新打开。',
  shutdown: '后端正在更新，终端已保存；稍后会自动重新连接。', reset: '运行环境已重置。', exit: '', disconnected: '连接断开，终端已保存。'
};

class Container {
  constructor(manager, prefix) {
    this.manager = manager; this.runner = manager.runner; this.id = randomUUID(); this.name = prefix + this.id;
    this.directory = path.join(this.runner.store.directory, 'jobs', this.id);
  }
  exec(args, { input = null, timeout = 5000, limit = 131072, cwd = null, signal, control = false } = {}) {
    return this.runner.cli(['exec', '-i', ...(cwd ? ['-w', cwd] : []), this.name, ...args], { input, timeout, limit, signal, control });
  }
  async create(seconds) {
    await fs.mkdir(this.directory, { mode: 0o755 }); await fs.chmod(this.directory, 0o755);
    this.runner.containers.add(this.name); this.created = true;
    const args = this.runner.containerArgs(this.name, this.directory, { seconds, hostname: 'nanaly' });
    invariant((await this.runner.cli(args, { timeout: 10000 })).code === 0, 503, 'RUNNER_CREATE_FAILED', '终端容器创建失败，请检查后端运行环境。');
    invariant((await this.runner.cli(['start', this.name], { timeout: 10000 })).code === 0, 503, 'RUNNER_START_FAILED', '终端容器启动失败。');
    const guard = await this.exec(['python3', '/opt/nanaly/check-limits.py']);
    invariant(guard.code === 0, 503, 'LIMITS_UNAVAILABLE', '容器资源限制未生效，已拒绝打开终端。');
  }
  async remove() {
    try { if (this.created) await this.runner.removeContainer(this.name); }
    finally { await fs.rm(this.directory, { recursive: true, force: true }); }
  }
}

// The Git/Linux shell of one workspace. Its files, directory, exports and history come from
// the workspace snapshot and go back into it when the shell ends.
class ShellHost extends Container {
  constructor(manager, workspace) { super(manager, 'nanaly-term-'); this.workspace = workspace; this.language = workspace.language; }
  async start(cols, rows) {
    const { runner, workspace } = this;
    try {
      await this.create(Math.ceil(this.manager.lifetime / 1000) + 120);
      if (workspace.revision) {
        const snapshot = path.join(this.directory, 'workspace.snapshot');
        await readable(snapshot, () => fs.copyFile(runner.store.snapshotPath(workspace), snapshot));
        const restored = await this.exec(['tar', '-xzf', '/input/workspace.snapshot', '--no-same-owner', '--same-permissions', '-C', '/work'], { timeout: 10000 });
        invariant(restored.code === 0, 500, 'WORKSPACE_RESTORE_FAILED', '工作区快照恢复失败，请重置运行环境。');
      } else if (this.language === 'git') {
        const init = await this.exec(['git', 'init', '-q', '-b', 'main', '/work']);
        invariant(init.code === 0, 500, 'WORKSPACE_INIT_FAILED', '练习仓库初始化失败。');
      }
      this.pty = new PtySession({ kind: 'shell', cols, rows, keep: this.manager.keep, detachedTimeout: this.manager.detachedTimeout, lifetime: this.manager.lifetime, finalize: () => this.finish() });
      this.pty.host = this;
      this.pty.spawn(runner, ['exec', '-i', this.name, 'python3', HELPER, 'terminal', '--cols', String(cols), '--rows', String(rows), '--pidfile', PIDFILE]);
      return this.pty;
    } catch (error) { await this.remove(); throw error; }
  }
  // Runs after the shell has exited, however it ended: stop leftovers, capture, snapshot, commit.
  async finish() {
    const outcome = { committed: false, workspaceId: this.workspace.workspaceId, workspaceRevision: this.workspace.revision, warnings: [] };
    try { await this.fileQueue?.close(); Object.assign(outcome, await this.save()); }
    catch (error) { outcome.warnings.push(error instanceof ApiError ? error.message : '终端的改动没能保存。'); }
    finally {
      try { await this.remove(); }
      catch { outcome.warnings.push('终端容器暂未清理完成，后端关闭时会重试。'); }
      finally {
        this.manager.shells.delete(this.workspace.workspaceId);
        this.runner.busy.delete(this.workspace.workspaceId);
      }
    }
    if (!outcome.committed) outcome.warnings.push('这次终端里的改动没有保存；下次打开时从上次保存的版本继续。');
    return { ...outcome, message: MESSAGES[this.pty.exited.reason] ?? '' };
  }
  async save() {
    const cleaned = await this.exec(['python3', '/opt/nanaly/cleanup.py'], { control: true });
    const metadata = await this.exec(['cat', '/tmp/nanaly-shell-result.json'], { timeout: 2000, limit: 16384, control: true });
    let session;
    try { if (metadata.code === 0 && !metadata.reason) session = JSON.parse(metadata.stdout.toString('utf8')); } catch {}
    const warnings = Array.isArray(session?.warnings) ? session.warnings.filter(value => typeof value === 'string').slice(0, 5).map(value => value.slice(0, 2000)) : [];
    const cwd = typeof session?.cwd === 'string' && session.cwd.startsWith('/') && session.cwd.length <= 4096 && !session.cwd.includes('\0') ? session.cwd : '/work';
    if (cleaned.code !== 0 || cleaned.reason || session?.shellStateSaved !== true) return { committed: false, warnings };
    const persisted = await this.exec(['python3', HELPER, 'persist'], { control: true });
    if (persisted.code !== 0 || persisted.reason) return { committed: false, warnings };
    const archive = await this.exec(['tar', '-czf', '-', '-C', '/work', '.'], { timeout: 10000, limit: SNAPSHOT_LIMIT, control: true });
    if (archive.code !== 0 || archive.reason) return { committed: false, warnings: [...warnings, '工作区文件超过 32 MB 或无法打包，没有保存。'] };
    const committed = await this.runner.store.commitWorkspace(this.workspace, archive.stdout);
    return { committed: true, workspaceRevision: committed.revision, cwd, warnings };
  }
  async cwd() {
    const result = await this.exec(['sh', '-c', `readlink "/proc/$(cat ${PIDFILE})/cwd"`], { timeout: 3000 });
    const cwd = result.stdout.toString('utf8').trim();
    return result.code === 0 && cwd.startsWith('/') && !cwd.includes('\n') && !cwd.endsWith(' (deleted)') ? cwd : '/work';
  }
}

// One press of "Run" for C/C++/Go/Python: compile and run on a terminal of its own, so the
// program reads what the learner types. The container goes when the program ends.
class TaskHost extends Container {
  constructor(manager, language, code) { super(manager, 'nanaly-task-'); this.language = language; this.code = code; }
  async start(cols, rows) {
    const spec = TASKS[this.language];
    try {
      await this.create(Math.ceil(TASK_LIFETIME / 1000) + 60);
      const file = path.join(this.directory, spec.file);
      await readable(file, () => fs.writeFile(file, this.code));
      // Shown as if typed at a prompt, then run for real; the copy into ~ is not shown.
      const prompt = '\\033[01;32mlearner@nanaly\\033[00m:\\033[01;34m~\\033[00m$ ';
      const script = [spec.prepare, `cp /input/${spec.file} ${spec.file} || exit 1`, `printf '${prompt}%s\\n' ${quote(spec.command)}`, spec.command].filter(Boolean).join('\n');
      this.pty = new PtySession({ kind: 'task', cols, rows, keep: this.manager.keep, lifetime: TASK_LIFETIME, finalize: async () => { try { await this.remove(); return {}; } finally { this.manager.tasks.delete(this); } } });
      this.pty.host = this;
      this.pty.spawn(this.runner, ['exec', '-i', '-w', '/work', this.name, 'python3', HELPER, 'pty', '--cols', String(cols), '--rows', String(rows), '--cwd', '/work', '--', '/bin/bash', '-c', script]);
      return this.pty;
    } catch (error) { await this.remove(); throw error; }
  }
}

export class SessionManager {
  constructor(runner, { maxShells = 2, maxTasks = 2, detachedTimeout = SHELL_DETACHED, lifetime = SHELL_LIFETIME, keep = 256 * 1024 } = {}) {
    this.runner = runner; this.store = runner.store;
    this.maxShells = maxShells; this.maxTasks = maxTasks; this.detachedTimeout = detachedTimeout; this.lifetime = lifetime; this.keep = keep;
    this.shells = new Map(); this.tasks = new Set();
    this.starts = { shell: Promise.resolve(), task: Promise.resolve() }; this.closing = false;
  }
  // Serialize admission and startup, not the session lifetime. This reserves capacity
  // across health/create awaits and lets a second page join a shell still starting.
  start(kind, operation) {
    const pending = this.starts[kind].then(() => {
      invariant(!this.closing && !this.runner.closing, 503, 'SERVER_CLOSING', '后端正在停止，请稍后重试。');
      return operation();
    });
    this.starts[kind] = pending.catch(() => {});
    return pending;
  }
  shell(request) { return this.start('shell', () => this.openShell(request)); }
  task(request) { return this.start('task', () => this.openTask(request)); }
  shellFor(workspaceId) { const host = this.shells.get(workspaceId); return host && !host.pty?.exited ? host : null; }
  // The shell of a Git/Linux workspace: the running one if there is one (every page shares
  // it), otherwise a new one on the latest saved state.
  async openShell({ language, workspaceId, cols = 80, rows = 24 }) {
    invariant(!this.runner.closing, 503, 'SERVER_CLOSING', '后端正在停止，请稍后重试。');
    let workspace = null;
    if (workspaceId) { try { workspace = this.store.getWorkspace(workspaceId); } catch (error) { if (error.code !== 'WORKSPACE_NOT_FOUND') throw error; } }
    workspace ||= this.store.listWorkspaces().find(item => item.language === language) || null;
    if (workspace) {
      invariant(workspace.language === language, 400, 'WORKSPACE_LANGUAGE', '工作区语言不匹配。');
      const live = this.shells.get(workspace.workspaceId);
      if (live) { await live.starting; if (!live.pty.exited) return live.pty; await live.pty.done; }
      workspace = this.store.getWorkspace(workspace.workspaceId);
      invariant(!this.runner.busy.has(workspace.workspaceId), 409, 'WORKSPACE_BUSY', '这个工作区正在执行脚本，请等它结束后再打开终端。');
    }
    invariant(this.shells.size < this.maxShells, 429, 'TERMINAL_LIMIT', '同时打开的终端已达上限，请先关掉另一个。');
    invariant((await this.runner.health()).ready, 503, 'RUNNER_UNAVAILABLE', '隔离执行环境尚未就绪，请完成后端 Docker 配置。');
    workspace ||= await this.store.resetWorkspace(null, language);
    invariant(!this.runner.busy.has(workspace.workspaceId) && !this.shells.has(workspace.workspaceId), 409, 'WORKSPACE_BUSY', '这个工作区正在使用，请稍后再试。');
    this.runner.busy.add(workspace.workspaceId);
    const host = new ShellHost(this, workspace);
    this.shells.set(workspace.workspaceId, host);
    host.starting = host.start(cols, rows);
    try { return await host.starting; }
    catch (error) { this.shells.delete(workspace.workspaceId); this.runner.busy.delete(workspace.workspaceId); throw error; }
  }
  async openTask({ language, code, cols = 80, rows = 24 }) {
    invariant(!this.runner.closing, 503, 'SERVER_CLOSING', '后端正在停止，请稍后重试。');
    invariant(Object.hasOwn(TASKS, language), 400, 'INVALID_LANGUAGE', '这个语言不能在终端里运行。');
    // A new run replaces the one still going, as pressing Run again in an IDE does.
    for (const old of [...this.tasks]) if (old.language === language) await old.pty.hangup('replaced');
    while (this.tasks.size >= this.maxTasks) await this.tasks.values().next().value.pty.hangup('replaced');
    invariant((await this.runner.health()).ready, 503, 'RUNNER_UNAVAILABLE', '隔离执行环境尚未就绪，请完成后端 Docker 配置。');
    const host = new TaskHost(this, language, code);
    this.tasks.add(host);
    host.starting = host.start(cols, rows);
    try { return await host.starting; }
    catch (error) { this.tasks.delete(host); throw error; }
  }
  // A script sent to /api/run while the workspace's shell is open runs inside that shell's
  // container, in the directory the shell is in; its file changes are saved with the shell.
  async runInShell(host, request, { signal } = {}) {
    const notCancelled = () => invariant(!signal?.aborted, 499, 'RUN_CANCELLED', '本次执行已取消。');
    notCancelled();
    invariant(!host.pty?.exited && !host.pty?.reason, 409, 'WORKSPACE_BUSY', '终端正在关闭，请稍后重试。');
    invariant(host.workspace.language === request.language, 400, 'WORKSPACE_LANGUAGE', '工作区语言不匹配。');
    invariant(!request.workspaceId || request.workspaceId === host.workspace.workspaceId, 400, 'INVALID_WORKSPACE', '工作区编号无效。');
    invariant(!request.workspaceId || request.workspaceRevision === host.workspace.revision, 409, 'WORKSPACE_CONFLICT', '工作区已被另一设备修改，请刷新。', { workspaceRevision: host.workspace.revision });
    const id = randomUUID(), script = path.join(host.directory, `run-${id}.sh`);
    // The helper watches this read-only mounted source. Removing it also cancels a
    // Docker exec that has not started yet, without a pkill/startup race.
    let stopping;
    const stop = () => { stopping ||= fs.rm(script, { force: true }).catch(() => {}); };
    signal?.addEventListener('abort', stop, { once: true });
    try {
      await readable(script, () => fs.writeFile(script, request.code));
      notCancelled();
      const cwd = await host.cwd();
      // Cancellation while the source or cwd was being prepared must not start code.
      notCancelled();
      const executed = await this.runner.cli(['exec', '-i', '-w', cwd, host.name, 'python3', '/opt/nanaly/run-in-shell.py', `/input/run-${id}.sh`],
        { input: request.stdin, timeout: 40000, limit: 131072, onLimit: stop, signal });
      // Learner code shares the supervisor's uid and can kill it. A signal exit
      // (including an explicit exit >= 128), supervisor failure, or lost Docker
      // exec makes cleanup uncertain: finish the whole shell before replying.
      // Normal cancellation uses helper code 126; timeout 124 cleans up itself.
      const closed = executed.reason || executed.code === 125 || executed.code >= 128
        ? await host.pty.hangup('run_failed') : null;
      notCancelled();
      const stderr = executed.stderr.toString('utf8').replaceAll(`/input/run-${id}.sh`, 'main.sh');
      const status = executed.reason || (executed.code === 124 ? 'timeout' : executed.code === 0 ? 'accepted' : 'runtime_error');
      const summary = closed ? null : await host.exec(request.language === 'git' ? ['git', '-C', cwd, '-c', 'core.fsmonitor=false', 'status', '--short', '--branch'] : ['find', cwd, '-maxdepth', '2', '-not', '-path', '*/.git/*'], { timeout: 2000, limit: 8192 });
      notCancelled();
      return { runId: id, revision: request.revision, status, stdout: executed.stdout.toString('utf8'), stderr, diagnostics: diagnostics(stderr), tests: [],
        exitCode: executed.code, cwd: closed?.cwd || cwd, workspaceSummary: summary?.stdout.toString('utf8') || '', workspaceId: host.workspace.workspaceId,
        workspaceRevision: closed?.workspaceRevision ?? host.workspace.revision, workspaceCommitted: closed?.committed === true,
        warnings: closed ? [...(closed.warnings || []), MESSAGES.run_failed] : ['终端开着：这次的改动在终端的环境里，终端关闭时一起保存。'] };
    } catch (error) { notCancelled(); throw error; }
    finally {
      signal?.removeEventListener('abort', stop);
      await stopping;
      await fs.rm(script, { force: true });
    }
  }
  async endShell(workspaceId, reason = 'reset') {
    const host = this.shells.get(workspaceId);
    if (!host) return;
    await host.starting?.catch(() => {});
    if (host.pty) await host.pty.hangup(reason);
  }
  close() {
    this.closing = true;
    return this.closePromise ||= (async () => {
      // Finish startup before taking the snapshot: an admitted task may not yet have a PTY.
      await Promise.all(Object.values(this.starts));
      await Promise.all([...this.shells.values(), ...this.tasks].map(host => host.pty?.hangup('shutdown')));
    })();
  }
}
