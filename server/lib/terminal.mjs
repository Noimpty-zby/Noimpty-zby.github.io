import { randomBytes } from 'node:crypto';
import { ApiError, invariant } from './errors.mjs';
import { TASKS } from './sessions.mjs';

// Browser side of the terminals. A page asks for a one-time ticket with its token, then opens
// a WebSocket with it: browsers cannot put the token on a socket, and the long-lived token
// must never go into a URL. `shell` attaches to a workspace's Git/Linux shell (shared by all
// pages, replaying what a reconnecting page missed); `task` runs the editor's program.
const size = (value, fallback, min, max) => Number.isInteger(value) ? Math.max(min, Math.min(max, value)) : fallback;
const FILE_LIMIT = 1024 * 1024;
const utf8 = new TextDecoder('utf-8', { fatal: true });
const validPath = value => typeof value === 'string' && value.startsWith('/') && value.length <= 4096 && !value.includes('\0');

export class TerminalManager {
  constructor(sessions, { now = Date.now, ttl = 30000 } = {}) {
    this.sessions = sessions; this.now = now; this.ttl = ttl; this.tickets = new Map(); this.sockets = new Set();
  }
  issue(body) {
    invariant(body && typeof body === 'object' && !Array.isArray(body), 400, 'INVALID_REQUEST', '请求必须是对象。');
    const kind = body.kind === 'task' ? 'task' : 'shell';
    if (kind === 'shell') invariant(['git', 'linux'].includes(body.language), 400, 'INVALID_LANGUAGE', '终端只支持 Git 和 Linux。');
    else {
      invariant(Object.hasOwn(TASKS, body.language), 400, 'INVALID_LANGUAGE', '这个语言不能在终端里运行。');
      invariant(typeof body.code === 'string' && body.code.trim() && Buffer.byteLength(body.code) <= 65536 && !body.code.includes('\0'), 400, 'INVALID_CODE', '代码不能为空且不能超过 64 KiB。');
    }
    invariant(body.workspaceId === undefined || (typeof body.workspaceId === 'string' && /^[a-f0-9-]{36}$/.test(body.workspaceId)), 400, 'INVALID_WORKSPACE', '工作区编号无效。');
    invariant(body.sessionId === undefined || (typeof body.sessionId === 'string' && /^[a-f0-9-]{36}$/.test(body.sessionId)), 400, 'INVALID_SESSION', '终端会话编号无效。');
    invariant(body.since === undefined || (Number.isSafeInteger(body.since) && body.since >= 0), 400, 'INVALID_SESSION', '终端输出位置无效。');
    const stamp = this.now();
    for (const [key, value] of this.tickets) if (value.expires <= stamp) this.tickets.delete(key);
    invariant(this.tickets.size < 16, 429, 'RATE_LIMIT', '请求过于频繁，请稍后重试。');
    const ticket = randomBytes(24).toString('hex');
    this.tickets.set(ticket, { kind, language: body.language, code: kind === 'task' ? body.code : undefined, workspaceId: body.workspaceId, sessionId: body.sessionId, since: body.since,
      cols: size(body.cols, 80, 2, 500), rows: size(body.rows, 24, 2, 300), expires: stamp + this.ttl });
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
    let session = null, gone = false;
    const client = { output: chunk => { ws.send(chunk); if (ws.buffered > 1024 * 1024) session?.pause(client); } };
    ws.on('message', (data, binary) => {
      let message;
      try { message = binary ? null : JSON.parse(data); } catch {}
      if (!message || typeof message !== 'object') return;
      if (!session) {
        if (message.type === 'resize') { claim.cols = size(message.cols, claim.cols, 2, 500); claim.rows = size(message.rows, claim.rows, 2, 300); }
        return;
      }
      if (message.type === 'input' && typeof message.data === 'string' && message.data.length <= 65536) session.write(message.data);
      else if (message.type === 'resize') session.resize(message.cols, message.rows);
      else if (message.type === 'terminate') void session.hangup(session.kind === 'task' ? 'stopped' : 'closed');
      else if (message.type === 'read' && session.kind === 'shell') void this.read(session.host, message).then(send);
      else if (message.type === 'write' && session.kind === 'shell') void this.write(session.host, message).then(send);
    });
    ws.on('close', () => { gone = true; this.sockets.delete(ws); session?.detach(client); });
    send({ type: 'status', phase: 'starting' });
    return (async () => {
      try {
        session = claim.kind === 'task' ? await this.sessions.task(claim) : await this.sessions.shell(claim);
      } catch (error) {
        send({ type: 'error', code: error?.code || 'TERMINAL_FAILED', message: error instanceof ApiError ? error.message : '终端启动失败，请稍后重试。' });
        ws.close(1000); return;
      }
      // Attach and detach so an abandoned new shell still times out like any other.
      if (gone) { session.attach(client); session.detach(client); return; }
      const replay = session.replay(claim.sessionId === session.id ? claim.since : undefined);
      const workspace = session.host.workspace;
      // `replay` bytes follow at once; the page re-draws them but must not act on them again.
      send({ type: 'ready', kind: session.kind, sessionId: session.id, reset: replay.reset, offset: replay.offset, replay: replay.bytes.length,
        ...(workspace ? { language: workspace.language, workspaceId: workspace.workspaceId, workspaceRevision: workspace.revision } : { language: claim.language }) });
      if (replay.bytes.length) ws.send(replay.bytes);
      session.attach(client);
      session.resize(claim.cols, claim.rows);
      ws.on('drain', () => session.resume(client));
      session.done.then(exit => { send({ type: 'exit', ...exit }); ws.close(1000); });
    })();
  }
  // `code FILE` in the terminal opens the file in the page's editor; these read and save it
  // inside the shell's own sandbox, as the learner.
  async read(host, { id, path }) {
    if (!validPath(path)) return { type: 'file', id, path, error: '文件路径无效。' };
    const result = await host.exec(['sh', '-c', 'test -f "$1" || { echo "不是普通文件" >&2; exit 2; }; head -c 1048577 -- "$1"', 'sh', path], { limit: FILE_LIMIT + 4096 });
    if (result.code !== 0) return { type: 'file', id, path, error: result.stderr.toString('utf8').trim().slice(0, 300) || '读取失败。' };
    if (result.stdout.length > FILE_LIMIT) return { type: 'file', id, path, error: '文件超过 1 MB，请用 nano 或 vim 编辑。' };
    if (result.stdout.includes(0)) return { type: 'file', id, path, error: '这是二进制文件，不能在编辑器里打开。' };
    try { return { type: 'file', id, path, content: utf8.decode(result.stdout) }; }
    catch { return { type: 'file', id, path, error: '文件不是 UTF-8 文本，不能在编辑器里打开。' }; }
  }
  async write(host, { id, path, content }) {
    if (!validPath(path) || typeof content !== 'string' || Buffer.byteLength(content) > FILE_LIMIT) return { type: 'written', id, path, error: '文件路径或内容无效。' };
    const result = await host.exec(['sh', '-c', 'cat > "$1"', 'sh', path], { input: content });
    return result.code === 0 ? { type: 'written', id, path } : { type: 'written', id, path, error: result.stderr.toString('utf8').trim().slice(0, 300) || '保存失败。' };
  }
  close() {
    for (const ws of this.sockets) {
      ws.close(1012, 'restart');
    }
  }
}
