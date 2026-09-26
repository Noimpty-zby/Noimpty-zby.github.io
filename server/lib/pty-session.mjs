import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';

// One program on a pseudo-terminal inside a sandbox container, driven through
// `shell-session.py terminal|pty`: framed keystrokes in, raw terminal output out. Output is
// kept (up to `keep` bytes) so a page that reconnects gets its screen back, and pages can
// come and go without ending the program.
const clamp = (value, fallback, min, max) => Number.isInteger(value) ? Math.max(min, Math.min(max, value)) : fallback;
const frame = (kind, text) => {
  const body = Buffer.from(text, 'utf8'), head = Buffer.alloc(5);
  head[0] = kind.charCodeAt(0); head.writeUInt32BE(body.length, 1);
  return Buffer.concat([head, body]);
};

export class PtySession extends EventEmitter {
  constructor({ kind, cols = 80, rows = 24, keep = 256 * 1024, detachedTimeout = 0, lifetime = 0, finalize = async () => ({}) }) {
    super();
    this.kind = kind; this.id = randomUUID(); this.cols = cols; this.rows = rows;
    this.keep = keep; this.detachedTimeout = detachedTimeout; this.lifetime = lifetime; this.finalize = finalize;
    this.chunks = []; this.start = 0; this.end = 0; this.size = 0;
    this.clients = new Set(); this.paused = new Set(); this.exited = null; this.startedAt = Date.now();
    this.done = new Promise(resolve => { this.resolveDone = resolve; });
  }
  spawn(runner, args) {
    this.child = runner.spawnProcess(runner.docker, args, { env: runner.environment(), stdio: ['pipe', 'pipe', 'ignore'], shell: false });
    this.child.stdin.on('error', () => {});
    this.child.stdout.on('data', chunk => this.output(chunk));
    const finished = code => {
      if (this.exited) return;
      this.exited = { code: Number.isInteger(code) ? code : -1, seconds: Math.round((Date.now() - this.startedAt) / 100) / 10, reason: this.reason || 'exit' };
      clearTimeout(this.detachTimer); clearTimeout(this.killTimer); clearTimeout(this.lifetimeTimer);
      this.emit('exit', this.exited);
      // A shell saves its workspace after it ends; clients hear about the end once that is done.
      Promise.resolve().then(() => this.finalize(this.exited)).catch(() => ({ warnings: ['终端结束后的收尾没有完成。'] }))
        .then(extra => this.resolveDone({ ...this.exited, ...extra }));
    };
    this.child.once('close', finished);
    this.child.once('error', () => finished(-1));
    if (this.lifetime) { this.lifetimeTimer = setTimeout(() => void this.hangup('lifetime'), this.lifetime); this.lifetimeTimer.unref?.(); }
    return this;
  }
  output(chunk) {
    this.chunks.push(chunk); this.size += chunk.length; this.end += chunk.length;
    while (this.size > this.keep && this.chunks.length > 1) { const old = this.chunks.shift(); this.size -= old.length; this.start += old.length; }
    for (const client of this.clients) client.output(chunk);
  }
  // Bytes a client is missing. A client that was here at `since` gets only what came after;
  // anyone else gets everything still kept, and should clear its screen first.
  replay(since) {
    if (Number.isSafeInteger(since) && since >= this.start && since <= this.end) {
      let skip = since - this.start;
      const parts = [];
      for (const chunk of this.chunks) {
        if (skip >= chunk.length) { skip -= chunk.length; continue; }
        parts.push(skip ? chunk.subarray(skip) : chunk); skip = 0;
      }
      return { reset: false, offset: since, bytes: Buffer.concat(parts) };
    }
    return { reset: true, offset: this.start, bytes: Buffer.concat(this.chunks) };
  }
  attach(client) { this.clients.add(client); clearTimeout(this.detachTimer); }
  detach(client) {
    this.clients.delete(client); this.resume(client);
    if (this.clients.size || this.exited) return;
    // Nobody is looking: a program run stops at once, a shell after a while (like a dropped SSH login).
    if (!this.detachedTimeout) { void this.hangup('disconnected'); return; }
    this.detachTimer = setTimeout(() => void this.hangup('idle'), this.detachedTimeout); this.detachTimer.unref?.();
  }
  write(data) { if (!this.exited && this.child) this.child.stdin.write(frame('d', data)); }
  resize(cols, rows) {
    if (this.exited || !this.child) return;
    this.cols = clamp(cols, this.cols, 2, 500); this.rows = clamp(rows, this.rows, 2, 300);
    this.child.stdin.write(frame('r', `${this.cols} ${this.rows}`));
  }
  // A slow browser pauses the program's output instead of buffering it without bound.
  pause(client) { this.paused.add(client); this.child?.stdout.pause(); }
  resume(client) { this.paused.delete(client); if (!this.paused.size) this.child?.stdout.resume(); }
  // Ends the program the way closing a terminal window does: hang up, then kill if it lingers.
  hangup(reason = 'closed') {
    if (this.exited || !this.child) return this.done;
    this.reason ||= reason;
    this.paused.clear(); this.child.stdout.resume(); this.child.stdin.end();
    if (!this.killTimer) { this.killTimer = setTimeout(() => this.child.kill('SIGKILL'), 8000); this.killTimer.unref?.(); }
    return this.done;
  }
}
