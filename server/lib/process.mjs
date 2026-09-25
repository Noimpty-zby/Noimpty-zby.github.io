import { spawn } from 'node:child_process';
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
