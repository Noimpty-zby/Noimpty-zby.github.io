import { spawn } from 'node:child_process';
import { ApiError } from './errors.mjs';

// Bound both running host processes and retained requests. Cancellation only removes
// work that has not started; an admitted atomic file save is allowed to finish.
export class BoundedQueue {
  constructor({ concurrency = 4, maxQueued = 16, wait = 10000 } = {}) {
    this.concurrency = concurrency; this.maxQueued = maxQueued; this.wait = wait;
    this.active = 0; this.pending = []; this.idleWaiters = new Set(); this.closed = false;
  }
  run(operation, { signal } = {}) {
    if (signal?.aborted) return Promise.reject(new ApiError(499, 'RUN_CANCELLED', '操作已取消。'));
    if (this.closed) return Promise.reject(new ApiError(503, 'EXEC_CLOSED', '执行队列已关闭。'));
    if (this.active >= this.concurrency && this.pending.length >= this.maxQueued) return Promise.reject(new ApiError(429, 'EXEC_BUSY', '执行队列已满，请稍后重试。'));
    return new Promise((resolve, reject) => {
      const item = { operation, resolve, reject, signal };
      if (this.active < this.concurrency) { this.start(item); return; }
      const remove = error => {
        const index = this.pending.indexOf(item);
        if (index < 0) return;
        this.pending.splice(index, 1); this.clear(item); reject(error);
      };
      item.abort = () => remove(new ApiError(499, 'RUN_CANCELLED', '操作已取消。'));
      item.timer = setTimeout(() => remove(new ApiError(429, 'EXEC_BUSY', '等待执行超时，请稍后重试。')), this.wait);
      this.pending.push(item);
      signal?.addEventListener('abort', item.abort, { once: true });
    });
  }
  clear(item) { clearTimeout(item.timer); if (item.abort) item.signal?.removeEventListener('abort', item.abort); }
  start(item) {
    this.clear(item); this.active++;
    let result;
    try { result = item.operation(); } catch (error) { result = Promise.reject(error); }
    Promise.resolve(result).then(value => { this.release(); item.resolve(value); }, error => { this.release(); item.reject(error); });
  }
  release() {
    this.active--;
    while (!this.closed && this.active < this.concurrency && this.pending.length) this.start(this.pending.shift());
    if (!this.active && !this.pending.length) { for (const resolve of this.idleWaiters) resolve(); this.idleWaiters.clear(); }
  }
  close() {
    this.closed = true;
    for (const item of this.pending.splice(0)) { this.clear(item); item.reject(new ApiError(503, 'EXEC_CLOSED', '执行队列已关闭。')); }
    return this.idle();
  }
  idle() { return this.active ? new Promise(resolve => this.idleWaiters.add(resolve)) : Promise.resolve(); }
}

// No host shell. Callers only pass the Docker CLI and argument arrays.
export function processResult(command, args, { input, timeout = 10000, limit = 131072, env, onLimit } = {}) {
  return new Promise(resolve => {
    let child;
    try { child = spawn(command, args, { env, stdio: ['pipe', 'pipe', 'pipe'], shell: false }); }
    catch { resolve({ code: -1, stdout: Buffer.alloc(0), stderr: Buffer.from('运行依赖无法启动。'), reason: 'unavailable' }); return; }
    const output = [], errors = [];
    let used = 0, reason, complete = false;
    const stop = why => {
      if (reason) return; reason = why;
      try { onLimit?.(); } catch {}
      child.kill('SIGKILL');
    };
    const capture = target => bytes => {
      const room = Math.max(0, limit - used);
      if (room) target.push(bytes.subarray(0, room));
      used += bytes.length;
      if (used > limit) stop('output_limit');
    };
    child.stdout.on('data', capture(output)); child.stderr.on('data', capture(errors));
    child.stdin.on('error', () => {});
    const timer = setTimeout(() => stop('timeout'), timeout);
    const finish = code => {
      if (complete) return; complete = true; clearTimeout(timer);
      resolve({ code: code ?? -1, stdout: Buffer.concat(output), stderr: Buffer.concat(errors), reason });
    };
    child.on('error', () => { reason = 'unavailable'; finish(-1); });
    child.on('close', finish);
    child.stdin.end(input);
  });
}
