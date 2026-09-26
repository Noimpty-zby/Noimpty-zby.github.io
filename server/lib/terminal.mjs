import fs from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { randomBytes, randomUUID } from 'node:crypto';
import { ApiError, invariant } from './errors.mjs';

// An interactive Bash for the Git/Linux workspaces. The container gets the same limits as
// a script run but lives as long as the page keeps the connection; the workspace is locked
// for the whole session and saved (with CAS) when it ends, however it ends.
export const TERMINAL_IDLE = 30 * 60 * 1000;
export const TERMINAL_LIFETIME = 3 * 60 * 60 * 1000;
const SNAPSHOT_LIMIT = 32 * 1024 * 1024;
const frame = (kind, text) => {
  const body = Buffer.from(text, 'utf8'), head = Buffer.alloc(5);
  head[0] = kind.charCodeAt(0); head.writeUInt32BE(body.length, 1);
  return Buffer.concat([head, body]);
};
const size = (value, fallback, min, max) => Number.isInteger(value) ? Math.max(min, Math.min(max, value)) : fallback;
const REASONS = {
  replaced: '终端已在另一个窗口打开，这里的会话已保存并关闭。',
  idle: '终端闲置 30 分钟，已自动保存并关闭。',
  lifetime: '终端已连续使用 3 小时，已保存并关闭。',
  shutdown: '后端正在更新，终端已保存并关闭。',
  exit: 'Shell 已退出，改动已保存。',
  closed: '终端已保存并关闭。',
  disconnected: '连接已断开，改动已保存。',
  failed: '终端启动失败。'
};

export class TerminalSession extends EventEmitter {
  constructor(runner, workspace, { idle = TERMINAL_IDLE, lifetime = TERMINAL_LIFETIME } = {}) {
    super();
    this.runner = runner; this.workspace = workspace; this.language = workspace.language;
    this.id = randomUUID(); this.name = 'nanaly-term-' + this.id;
    this.idle = idle; this.lifetime = lifetime;
    this.backlog = []; this.sink = null; this.ending = null; this.ended = null;
    this.done = new Promise(resolve => { this.resolveDone = resolve; });
  }
  exec(args, input = null, timeout = 5000, limit = 131072) {
    return this.runner.cli(['exec', '-i', this.name, ...args], { input, timeout, limit });
  }
  async start(cols, rows) {
    const { runner, workspace } = this;
    this.directory = path.join(runner.store.directory, 'jobs', this.id);
    await fs.mkdir(this.directory, { mode: 0o755 }); await fs.chmod(this.directory, 0o755);
    if (workspace.revision) {
      const copy = path.join(this.directory, 'workspace.snapshot');
      await fs.copyFile(runner.store.snapshotPath(workspace), copy); await fs.chmod(copy, 0o444);
    }
    runner.containers.add(this.name); this.created = true;
    const seconds = Math.ceil(this.lifetime / 1000) + 120;
    const created = await runner.cli(runner.containerArgs(this.name, this.directory, { seconds, hostname: 'nanaly' }), { timeout: 10000 });
    invariant(created.code === 0, 503, 'RUNNER_CREATE_FAILED', '终端容器创建失败，请检查后端运行环境。');
    invariant((await runner.cli(['start', this.name], { timeout: 10000 })).code === 0, 503, 'RUNNER_START_FAILED', '终端容器启动失败。');
    const guard = await this.exec(['python3', '/opt/nanaly/check-limits.py']);
    invariant(guard.code === 0, 503, 'LIMITS_UNAVAILABLE', '容器资源限制未生效，已拒绝打开终端。');
    if (workspace.revision) {
      const restored = await this.exec(['tar', '-xzf', '/input/workspace.snapshot', '--no-same-owner', '--same-permissions', '-C', '/work'], null, 10000);
      invariant(restored.code === 0, 500, 'WORKSPACE_RESTORE_FAILED', '工作区快照恢复失败，请重置工作区。');
    } else if (this.language === 'git') {
      const init = await this.exec(['git', 'init', '-q', '-b', 'main', '/work']);
      invariant(init.code === 0, 500, 'WORKSPACE_INIT_FAILED', '练习仓库初始化失败。');
    }
    invariant(!this.ending, 499, 'TERMINAL_CLOSED', '终端在启动前已关闭。');
    this.child = runner.spawnProcess(runner.docker, ['exec', '-i', this.name, 'python3', '/opt/nanaly/shell-session.py', 'terminal', '--cols', String(cols), '--rows', String(rows)],
      { env: runner.environment(), stdio: ['pipe', 'pipe', 'ignore'], shell: false });
    this.child.stdin.on('error', () => {});
    this.child.stdout.on('data', chunk => this.sink ? this.sink(chunk) : this.backlog.push(chunk));
    this.exited = new Promise(resolve => { this.child.once('close', resolve); this.child.once('error', () => resolve(-1)); });
    this.exited.then(code => { if (!this.ending) { this.emit('exit', code); void this.end('exit'); } });
    this.started = true;
    this.touch();
    this.lifetimeTimer = setTimeout(() => void this.end('lifetime'), this.lifetime); this.lifetimeTimer.unref?.();
  }
  onOutput(sink) { this.sink = sink; for (const chunk of this.backlog.splice(0)) sink(chunk); }
  touch() {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => void this.end('idle'), this.idle); this.idleTimer.unref?.();
  }
  write(data) { if (this.started && !this.ending) { this.touch(); this.child.stdin.write(frame('d', data)); } }
  resize(cols, rows) { if (this.started && !this.ending) this.child.stdin.write(frame('r', `${size(cols, 80, 2, 500)} ${size(rows, 24, 2, 300)}`)); }
  pause() { this.child?.stdout.pause(); }
  resume() { this.child?.stdout.resume(); }
  end(reason = 'closed') {
    if (!this.ended) { this.ending = reason; this.ended = this.finish(reason); }
    return this.ended;
  }
  async finish(reason) {
    // Ended while still starting (another window took over): let the start stop at its next
    // check, so the container is never removed while `docker create` is still running.
    await this.starting?.catch(() => {});
    clearTimeout(this.idleTimer); clearTimeout(this.lifetimeTimer);
    const { runner, workspace } = this;
    let outcome = { committed: false, workspaceId: workspace.workspaceId, workspaceRevision: workspace.revision, warnings: [] };
    try {
      if (this.child) {
        // End of input hangs the shell up; the helper then captures state and exits.
        this.child.stdout.resume(); this.child.stdin.end();
        let timer;
        const stopped = await Promise.race([this.exited.then(() => true), new Promise(resolve => { timer = setTimeout(resolve, 8000, false); })]);
        clearTimeout(timer);
        if (!stopped) { this.child.kill('SIGKILL'); throw new ApiError(500, 'TERMINAL_STUCK', '终端没有按时退出。'); }
      }
      if (this.started) outcome = { ...outcome, ...await this.save() };
    } catch (error) {
      outcome.warnings.push(error instanceof ApiError ? error.message : '终端的改动没能保存。');
    } finally {
      if (this.created) await runner.cli(['rm', '-f', this.name], { timeout: 10000 });
      runner.containers.delete(this.name); runner.terminals.delete(this); runner.busy.delete(workspace.workspaceId);
      if (this.directory) await fs.rm(this.directory, { recursive: true, force: true });
    }
    const result = { ...outcome, reason, message: REASONS[reason] || REASONS.closed };
    if (!result.committed && this.started) result.warnings.push('这次终端里的改动没有保存；下次打开时从上次保存的版本继续。');
    this.resolveDone(result);
    return result;
  }
  async save() {
    const cleaned = await this.exec(['python3', '/opt/nanaly/cleanup.py']);
    const metadata = await this.exec(['cat', '/tmp/nanaly-shell-result.json'], null, 2000, 16384);
    let session;
    try { if (metadata.code === 0 && !metadata.reason) session = JSON.parse(metadata.stdout.toString('utf8')); } catch {}
    const warnings = Array.isArray(session?.warnings) ? session.warnings.filter(value => typeof value === 'string').slice(0, 5).map(value => value.slice(0, 2000)) : [];
    const cwd = typeof session?.cwd === 'string' && session.cwd.startsWith('/') && session.cwd.length <= 4096 && !session.cwd.includes('\0') ? session.cwd : '/work';
    if (cleaned.code !== 0 || cleaned.reason || session?.shellStateSaved !== true) return { committed: false, warnings };
    const persisted = await this.exec(['python3', '/opt/nanaly/shell-session.py', 'persist']);
    if (persisted.code !== 0 || persisted.reason) return { committed: false, warnings };
    const archive = await this.exec(['tar', '-czf', '-', '-C', '/work', '.'], null, 10000, SNAPSHOT_LIMIT);
    if (archive.code !== 0 || archive.reason) return { committed: false, warnings: [...warnings, '工作区文件超过 32 MB 或无法打包，没有保存。'] };
    const committed = await this.runner.store.commitWorkspace(this.workspace, archive.stdout);
    return { committed: true, workspaceRevision: committed.revision, cwd, warnings };
  }
}

// Tickets let a browser open the socket without putting the long-lived token in a URL:
// they are single use, expire in 30 seconds and carry what the terminal is for.
export class TerminalManager {
  constructor(runner, { now = Date.now, ttl = 30000 } = {}) {
    this.runner = runner; this.now = now; this.ttl = ttl; this.tickets = new Map(); this.sockets = new Set();
  }
  issue(body) {
    invariant(body && typeof body === 'object' && !Array.isArray(body), 400, 'INVALID_REQUEST', '请求必须是对象。');
    invariant(['git', 'linux'].includes(body.language), 400, 'INVALID_LANGUAGE', '终端只支持 Git 和 Linux。');
    invariant(body.workspaceId === undefined || /^[a-f0-9-]{36}$/.test(body.workspaceId), 400, 'INVALID_WORKSPACE', '工作区编号无效。');
    const stamp = this.now();
    for (const [key, value] of this.tickets) if (value.expires <= stamp) this.tickets.delete(key);
    invariant(this.tickets.size < 16, 429, 'RATE_LIMIT', '请求过于频繁，请稍后重试。');
    const ticket = randomBytes(24).toString('hex');
    this.tickets.set(ticket, { language: body.language, workspaceId: body.workspaceId, cols: size(body.cols, 80, 2, 500), rows: size(body.rows, 24, 2, 300), expires: stamp + this.ttl });
    return { ticket, expiresIn: Math.round(this.ttl / 1000) };
  }
  claim(ticket) {
    if (typeof ticket !== 'string' || !/^[a-f0-9]{48}$/.test(ticket)) return null;
    const value = this.tickets.get(ticket);
    this.tickets.delete(ticket);
    return value && value.expires > this.now() ? value : null;
  }
  attach(ws, claim) {
    this.sockets.add(ws);
    const send = value => { if (!ws.closed) ws.send(JSON.stringify(value)); };
    let session = null, gone = false, early = [], earlySize = 0;
    ws.on('message', (data, binary) => {
      let message;
      try { message = binary ? null : JSON.parse(data); } catch {}
      if (message?.type === 'input' && typeof message.data === 'string' && message.data.length <= 65536) {
        if (session) session.write(message.data);
        else if (earlySize + message.data.length <= 65536) { early.push(message.data); earlySize += message.data.length; }
      } else if (message?.type === 'resize') {
        if (session) session.resize(message.cols, message.rows);
        else { claim.cols = size(message.cols, claim.cols, 2, 500); claim.rows = size(message.rows, claim.rows, 2, 300); }
      } else if (message?.type === 'close') {
        // Before the session exists this only marks it; it is saved and confirmed once started.
        gone = true; if (session) void session.end('closed');
      }
    });
    ws.on('close', () => { gone = true; this.sockets.delete(ws); if (session) void session.end('disconnected'); });
    send({ type: 'status', phase: 'starting' });
    return (async () => {
      try { session = await this.runner.startTerminal(claim); }
      catch (error) {
        send({ type: 'error', code: error?.code || 'TERMINAL_FAILED', message: error instanceof ApiError ? error.message : '终端启动失败，请稍后重试。' });
        ws.close(1000); return;
      }
      session.done.then(outcome => { send({ type: 'saved', ...outcome }); ws.close(1000); });
      if (gone) { void session.end(ws.closed ? 'disconnected' : 'closed'); return; }
      session.onOutput(chunk => { ws.send(chunk); if (ws.buffered > 1024 * 1024) session.pause(); });
      ws.on('drain', () => session.resume());
      session.on('exit', code => send({ type: 'exit', code }));
      send({ type: 'ready', language: session.language, workspaceId: session.workspace.workspaceId, workspaceRevision: session.workspace.revision });
      for (const data of early.splice(0)) session.write(data);
    })();
  }
  close() { for (const ws of this.sockets) ws.close(1001, 'shutdown'); }
}
