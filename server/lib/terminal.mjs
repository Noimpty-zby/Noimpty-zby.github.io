import { randomBytes } from 'node:crypto';
import { ApiError, invariant } from './errors.mjs';
import { TASKS } from './sessions.mjs';
import { BoundedQueue } from './process.mjs';

// Browser side of the terminals. A page asks for a one-time ticket with its token, then opens
// a WebSocket with it: browsers cannot put the token on a socket, and the long-lived token
// must never go into a URL. `shell` attaches to a workspace's Git/Linux shell (shared by all
// pages, replaying what a reconnecting page missed); `task` runs the editor's program.
const size = (value, fallback, min, max) => Number.isInteger(value) ? Math.max(min, Math.min(max, value)) : fallback;
const FILE_LIMIT = 1024 * 1024;
// JSON can expand a 1 MiB UTF-8 file to six times its size (escaped controls).
// Permit one complete file reply, but never retain an unbounded socket backlog.
const SEND_LIMIT = 8 * 1024 * 1024;
const validId = value => (Number.isSafeInteger(value) && value >= 0) || (typeof value === 'string' && value.length > 0 && value.length <= 128 && !value.includes('\0'));
// Receive the complete UTF-8 file before replacing it. A failed/disconnected Docker
// exec must not truncate the learner's original file. Follow symlinks like an editor
// save, and preserve executable bits on existing regular files.
const WRITE_FILE = `import os, stat, sys, tempfile
target = os.path.realpath(sys.argv[1])
expected = int(sys.argv[2])
data = sys.stdin.buffer.read(expected + 1)
if len(data) != expected:
    raise OSError('文件内容传输不完整')
try:
    current = os.stat(target)
except FileNotFoundError:
    current = None
if current and not stat.S_ISREG(current.st_mode):
    raise OSError('不是普通文件')
mask = os.umask(0)
os.umask(mask)
fd, temporary = tempfile.mkstemp(prefix='.nanaly-edit-', dir=os.path.dirname(target))
try:
    with os.fdopen(fd, 'wb') as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
        os.fchmod(stream.fileno(), stat.S_IMODE(current.st_mode) if current else 0o666 & ~mask)
    os.replace(temporary, target)
finally:
    if os.path.exists(temporary):
        os.unlink(temporary)
`;
const utf8 = new TextDecoder('utf-8', { fatal: true });
const validPath = value => typeof value === 'string' && value.startsWith('/') && value.length <= 4096 && !value.includes('\0');

export class TerminalManager {
  constructor(sessions, { now = Date.now, ttl = 30000, fileQueueLimit = 8, fileQueueWait = 10000 } = {}) {
    this.fileQueueLimit = fileQueueLimit; this.fileQueueWait = fileQueueWait;
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
    let session = null, gone = false, detached = false;
    const controller = new AbortController();
    const detach = () => { if (session && !detached) { detached = true; session.detach(client); } };
    const close = (code, reason) => {
      if (gone) return;
      gone = true; controller.abort(); this.sockets.delete(ws); detach();
      ws.close(code, reason);
    };
    const transmit = data => {
      if (gone || ws.closed || ws.closeSent) return false;
      if (ws.buffered + Buffer.byteLength(data) > SEND_LIMIT) { close(1013, 'terminal output backlog'); return false; }
      try { ws.send(data); return true; }
      catch { close(1011, 'terminal response failed'); return false; }
    };
    const send = value => {
      try { return transmit(JSON.stringify(value)); }
      catch { close(1011, 'terminal response failed'); return false; }
    };
    const client = { output: chunk => {
      if (transmit(chunk) && ws.buffered > 1024 * 1024) session?.pause(client);
    } };
    ws.on('message', (data, binary) => {
      if (gone || ws.closed || ws.closeSent) return;
      let message;
      try { message = binary ? null : JSON.parse(data); } catch {}
      if (!message || typeof message !== 'object' || Array.isArray(message)) return;
      if (!session) {
        if (message.type === 'resize') { claim.cols = size(message.cols, claim.cols, 2, 500); claim.rows = size(message.rows, claim.rows, 2, 300); }
        return;
      }
      if (message.type === 'input' && typeof message.data === 'string' && message.data.length <= 65536) session.write(message.data);
      else if (message.type === 'resize') session.resize(message.cols, message.rows);
      else if (message.type === 'terminate') void session.hangup(session.kind === 'task' ? 'stopped' : 'closed').catch(() => close(1011, 'terminal close failed'));
      else if (['read', 'write'].includes(message.type) && session.kind === 'shell') {
        void this[message.type](session.host, message, { signal: controller.signal }).then(send).catch(() => close(1011, 'terminal file failed'));
      }
    });
    ws.on('close', () => { gone = true; controller.abort(); this.sockets.delete(ws); detach(); });
    send({ type: 'status', phase: 'starting' });
    return (async () => {
      try {
        session = claim.kind === 'task' ? await this.sessions.task(claim) : await this.sessions.shell(claim);
      } catch (error) {
        send({ type: 'error', code: error?.code || 'TERMINAL_FAILED', message: error instanceof ApiError ? error.message : '终端启动失败，请稍后重试。' });
        ws.close(1000); return;
      }
      // Attach and detach so an abandoned new shell still times out like any other.
      if (gone) { session.attach(client); detach(); return; }
      const replay = session.replay(claim.sessionId === session.id ? claim.since : undefined);
      const workspace = session.host.workspace;
      // `replay` bytes follow at once; the page re-draws them but must not act on them again.
      send({ type: 'ready', kind: session.kind, sessionId: session.id, reset: replay.reset, offset: replay.offset, replay: replay.bytes.length,
        ...(workspace ? { language: workspace.language, workspaceId: workspace.workspaceId, workspaceRevision: workspace.revision } : { language: claim.language }) });
      if (replay.bytes.length) transmit(replay.bytes);
      if (gone) return;
      session.attach(client);
      session.resize(claim.cols, claim.rows);
      ws.on('drain', () => session.resume(client));
      session.done.then(exit => { send({ type: 'exit', ...exit }); close(1000); }).catch(() => close(1011, 'terminal close failed'));
    })().catch(() => close(1011, 'terminal attach failed'));
  }
  // `code FILE` in the terminal opens the file in the page's editor; these read and save it
  // inside the shell's own sandbox, as the learner.
  read(host, message, options) { return this.file(host, 'read', message, options); }
  write(host, message, options) { return this.file(host, 'write', message, options); }
  async file(host, kind, message, { signal } = {}) {
    const { id, path, content } = message || {};
    // Error responses contain only validated scalar fields, never arbitrary input
    // objects that could fail serialization or retain an entire incoming message.
    const reply = { type: kind === 'read' ? 'file' : 'written', id: validId(id) ? id : null, path: validPath(path) ? path : '' };
    if (!validId(id) || !validPath(path) || (kind === 'write' && (typeof content !== 'string' || Buffer.byteLength(content) > FILE_LIMIT))) {
      return { ...reply, error: '文件请求编号、路径或内容无效。' };
    }
    if (host.pty?.exited) return { ...reply, error: '终端已经关闭。' };
    // Shared by every page attached to this shell, not just one WebSocket.
    host.fileQueue ||= new BoundedQueue({ concurrency: 1, maxQueued: this.fileQueueLimit, wait: this.fileQueueWait });
    try {
      return await host.fileQueue.run(async () => {
        if (host.pty?.exited) return { ...reply, error: '终端已经关闭。' };
        const result = kind === 'read'
          ? await host.exec(['sh', '-c', 'test -f "$1" || { echo "不是普通文件" >&2; exit 2; }; head -c 1048577 -- "$1"', 'sh', path], { limit: FILE_LIMIT + 4096, signal })
          : await host.exec(['python3', '-c', WRITE_FILE, path, String(Buffer.byteLength(content))], { input: content, signal });
        if (result.code !== 0 || result.reason) return { ...reply, error: result.stderr.toString('utf8').trim().slice(0, 300) || '文件操作失败。' };
        if (kind === 'write') return reply;
        if (result.stdout.length > FILE_LIMIT) return { ...reply, error: '文件超过 1 MB，请用 nano 或 vim 编辑。' };
        if (result.stdout.includes(0)) return { ...reply, error: '这是二进制文件，不能在编辑器里打开。' };
        try { return { ...reply, content: utf8.decode(result.stdout) }; }
        catch { return { ...reply, error: '文件不是 UTF-8 文本，不能在编辑器里打开。' }; }
      }, { signal });
    } catch (error) {
      return { ...reply, error: error?.code === 'EXEC_BUSY' ? '文件操作繁忙，请稍后重试。' : '文件操作未完成；请求已取消或终端已关闭。' };
    }
  }
  close() {
    for (const ws of this.sockets) {
      ws.close(1012, 'restart');
    }
  }
}
