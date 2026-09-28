import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { PrivateStore } from '../../../server/lib/store.mjs';
import { DockerRunner } from '../../../server/lib/runner.mjs';
import { SessionManager } from '../../../server/lib/sessions.mjs';
import { PtySession } from '../../../server/lib/pty-session.mjs';
import { TerminalManager } from '../../../server/lib/terminal.mjs';
import { WebSocketConnection } from '../../../server/lib/websocket.mjs';
import { createApp } from '../../../server/app.mjs';
import { processResult } from '../../../server/lib/process.mjs';

const output = (stdout = '') => ({ code: 0, stdout: Buffer.from(stdout), stderr: Buffer.alloc(0) });
// What run-in-shell.py prints last after a supervision it fully cleaned up.
const supervised = (outcome = 'exit 0', stderr = '') => ({ ...output(), stderr: Buffer.from(stderr + '\x1eNANALY_RUN ' + outcome + '\n') });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
function childProcess({ blocked = false } = {}) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stdin = blocked ? new Writable({ write(_chunk, _encoding, _done) {} }) : new PassThrough();
  child.stdin.on('data', () => {});
  const finish = () => setImmediate(() => child.emit('close', 0));
  child.stdin.on('finish', finish);
  child.kill = finish;
  return child;
}
async function fixture(t, { hook, spawnProcess = childProcess, ...options } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'nanaly-session-boundaries-'));
  const store = await new PrivateStore(directory).init();
  const calls = [], live = new Set(); let peak = 0;
  const runner = new DockerRunner(store, { spawnProcess, execute: async (_command, args) => {
    calls.push(args);
    if (args[0] === 'create') { live.add(args[2]); peak = Math.max(peak, live.size); }
    const result = await hook?.(args);
    if (result) return result;
    if (args[0] === 'rm') live.delete(args.at(-1));
    if (args[0] === 'info') return output(JSON.stringify({ OSType: 'linux', CgroupVersion: '2', MemoryLimit: true, PidsLimit: true, CpuCfsQuota: true }));
    if (args.includes('/tmp/nanaly-shell-result.json')) return output(JSON.stringify({ cwd: '/work', shellStateSaved: true }));
    if (args.includes('/opt/nanaly/run-in-shell.py')) return supervised();
    return output();
  } });
  const sessions = new SessionManager(runner, options);
  t.after(async () => { await sessions.close(); await runner.close(); await store.close(); await fs.rm(directory, { recursive: true, force: true }); });
  return { store, runner, sessions, calls, get peak() { return peak; } };
}

test('simultaneous new shells reserve the configured capacity before starting containers', async t => {
  const api = await fixture(t, { maxShells: 1 });
  const workspaces = await Promise.all(Array.from({ length: 3 }, () => api.store.resetWorkspace(null, 'linux')));
  const results = await Promise.allSettled(workspaces.map(workspace => api.sessions.shell({ language: 'linux', workspaceId: workspace.workspaceId })));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.ok(results.filter(result => result.status === 'rejected').every(result => result.reason.code === 'TERMINAL_LIMIT'));
  assert.equal(api.peak, 1);
});

test('simultaneous pages opening the same workspace share its starting shell', async t => {
  const api = await fixture(t);
  const workspace = await api.store.resetWorkspace(null, 'linux');
  const results = await Promise.allSettled(Array.from({ length: 3 }, () => api.sessions.shell({ language: 'linux', workspaceId: workspace.workspaceId })));
  assert.ok(results.every(result => result.status === 'fulfilled'));
  assert.equal(new Set(results.map(result => result.value.id)).size, 1);
  assert.equal(api.peak, 1);
});

test('repeated Run waits for a starting task to finish cleanup before replacing it', async t => {
  const api = await fixture(t, { maxTasks: 1 });
  const sessions = await Promise.all(Array.from({ length: 3 }, () => api.sessions.task({ language: 'python', code: 'input()' })));
  assert.equal(api.peak, 1);
  assert.equal(api.sessions.tasks.size, 1);
  assert.ok(sessions.slice(0, -1).every(session => session.exited));
  assert.equal(sessions.at(-1).exited, null);
});

test('shutdown waits for an in-flight task startup and removes the task it produced', async t => {
  const entered = deferred(), release = deferred();
  const api = await fixture(t, { hook: async args => { if (args[0] === 'create') { entered.resolve(); await release.promise; } } });
  const opening = api.sessions.task({ language: 'python', code: 'input()' });
  await entered.promise;
  let finished = false;
  const closing = api.sessions.close().then(() => { finished = true; });
  try { await tick(); assert.equal(finished, false); }
  finally { release.resolve(); await opening; await closing; }
  assert.equal(api.sessions.tasks.size, 0);
  assert.equal(api.runner.containers.size, 0);
  await assert.rejects(api.sessions.task({ language: 'python', code: 'input()' }), { code: 'SERVER_CLOSING' });
});

for (const kind of ['shell', 'task']) test(`${kind} spawn failure removes its container, job and workspace reservation`, async t => {
  const api = await fixture(t, { spawnProcess: () => { throw new Error('spawn failed'); } });
  const request = kind === 'shell' ? { language: 'linux' } : { language: 'python', code: 'input()' };
  await assert.rejects(api.sessions[kind](request), /spawn failed/);
  assert.equal(api.sessions.tasks.size + api.sessions.shells.size, 0);
  assert.equal(api.runner.busy.size, 0);
  assert.equal(api.runner.containers.size, 0);
  assert.deepEqual(await fs.readdir(path.join(api.store.directory, 'jobs')), []);
});

for (const kind of ['shell', 'task']) test(`${kind} cleanup exception still releases its in-memory reservations and input files`, async t => {
  let removals = 0;
  const api = await fixture(t, { hook: args => { if (args[0] === 'rm' && ++removals === 1) throw new Error('Docker cleanup failed'); } });
  const session = await api.sessions[kind](kind === 'shell' ? { language: 'linux' } : { language: 'python', code: 'input()' });
  const result = await session.hangup();
  assert.ok(result.warnings?.length);
  assert.equal(api.sessions.tasks.size + api.sessions.shells.size, 0);
  assert.equal(api.runner.busy.size, 0);
  assert.equal(api.runner.containers.size, 1, 'failed removal stays tracked');
  assert.deepEqual(await fs.readdir(path.join(api.store.directory, 'jobs')), []);
  await api.runner.close();
  assert.equal(removals, 2, 'shutdown retries the failed removal');
  assert.equal(api.runner.containers.size, 0);
});

for (const kind of ['input', 'resize']) test(`PTY ${kind} stops accepting data when its consumer stops draining the pipe`, async () => {
  const child = childProcess({ blocked: true });
  const session = new PtySession({ kind: 'task' });
  session.spawn({ docker: 'unused', environment: () => ({}), spawnProcess: () => child }, []);
  if (kind === 'input') for (let i = 0; i < 48; i++) session.write('x'.repeat(65536));
  else for (let i = 0; i < 100000; i++) session.resize(500, 300);
  const buffered = child.stdin.writableLength;
  child.emit('close', 0); await session.done;
  assert.ok(buffered <= 1024 * 1024, `stdin retained ${buffered} bytes`);
});

class Socket extends EventEmitter {
  constructor() { super(); this.destroyed = false; this.writable = true; this.writableLength = 0; this.writes = []; }
  cork() {}
  uncork() {}
  write(value) { this.writes.push(value); return true; }
  end(value) { if (value) this.write(value); this.writable = false; }
  destroy() { this.destroyed = true; this.emit('close'); }
}
const frame = (opcode, payload = '', fin = true) => {
  const bytes = Buffer.from(payload), mask = Buffer.alloc(4);
  return Buffer.concat([Buffer.from([(fin ? 128 : 0) | opcode, 128 | bytes.length]), mask, bytes]);
};
test('WebSocket delivers a frame coalesced with the upgrade after listeners attach', async () => {
  const socket = new Socket(), ws = new WebSocketConnection(socket, frame(1, 'first'), { heartbeat: 0 });
  const messages = [];
  ws.on('message', data => messages.push(data));
  await tick(); socket.destroy();
  assert.deepEqual(messages, ['first']);
});
test('closing WebSockets release partial messages and ignore late input', () => {
  const socket = new Socket(), ws = new WebSocketConnection(socket, null, { heartbeat: 0 });
  ws.receive(frame(1, 'partial', false));
  ws.close();
  for (let i = 0; i < 10; i++) ws.receive(Buffer.alloc(65536));
  assert.equal(ws.buffer.length, 0);
  assert.equal(ws.fragments.length, 0);
  socket.destroy();
});
test('empty WebSocket continuation frames do not retain one allocation per frame', () => {
  const socket = new Socket(), ws = new WebSocketConnection(socket, null, { heartbeat: 0 });
  ws.receive(frame(1, '', false));
  for (let i = 0; i < 10000; i++) ws.receive(frame(0, '', false));
  assert.equal(ws.fragments.length, 0);
  socket.destroy();
});
for (const [payload, code] of [[Buffer.from([0]), 1002], [Buffer.from([3, 237]), 1002], [Buffer.from([3, 232, 255]), 1007]]) {
  test(`invalid WebSocket close payload ${payload.toString('hex')} receives ${code}`, () => {
    const socket = new Socket(), ws = new WebSocketConnection(socket, null, { heartbeat: 0 });
    ws.receive(frame(8, payload));
    assert.equal(socket.writes[1].readUInt16BE(0), code);
    socket.destroy();
  });
}

test('terminal file failures return protocol errors instead of rejecting an unobserved Promise', async () => {
  const terminals = new TerminalManager({}), host = { exec: async () => { throw new Error('container disappeared'); } };
  const read = await terminals.read(host, { id: 1, path: '/work/readme' });
  const write = await terminals.write(host, { id: 2, path: '/work/readme', content: 'saved' });
  assert.equal(read.type, 'file'); assert.ok(read.error);
  assert.equal(write.type, 'written'); assert.ok(write.error);
});
test('malformed WebSocket request targets receive HTTP 400 without escaping the server callback', () => {
  const server = createApp({ token: 'boundary-token-long-enough-1234', runner: {}, store: {} }), socket = new Socket();
  assert.doesNotThrow(() => server.emit('upgrade', { url: 'http://[', headers: {}, socket: { remoteAddress: 'local' } }, socket, Buffer.alloc(0)));
  assert.match(socket.writes.join(''), /^HTTP\/1\.1 400 /);
});

test('a failed Docker removal status remains tracked until a successful retry', async t => {
  let failed = false;
  const api = await fixture(t, { hook: args => {
    if (args[0] === 'rm' && !failed) { failed = true; return { ...output(), code: 1, stderr: Buffer.from('daemon unavailable') }; }
  } });
  const session = await api.sessions.task({ language: 'python', code: 'input()' });
  const result = await session.hangup();
  assert.ok(result.warnings?.length);
  assert.equal(api.runner.containers.size, 1);
  await api.runner.close();
  assert.equal(api.runner.containers.size, 0);
});
test('at task capacity a new language replaces only the oldest run', async t => {
  const api = await fixture(t, { maxTasks: 2 });
  const first = await api.sessions.task({ language: 'python', code: 'input()' });
  const second = await api.sessions.task({ language: 'c', code: 'int main(){}' });
  const third = await api.sessions.task({ language: 'go', code: 'package main\nfunc main(){}' });
  assert.ok(first.exited);
  assert.equal(second.exited, null);
  assert.equal(third.exited, null);
  assert.equal(api.peak, 2);
});
test('server close reasons stay within a control frame and end on a UTF-8 boundary', () => {
  const socket = new Socket(), ws = new WebSocketConnection(socket, null, { heartbeat: 0 });
  ws.close(1000, '终端已关闭'.repeat(40));
  assert.ok(socket.writes[1].length <= 125);
  assert.doesNotThrow(() => new TextDecoder('utf8', { fatal: true }).decode(socket.writes[1].subarray(2)));
  socket.destroy();
});
test('file saves preserve symlinks and mode, and incomplete transfers preserve original bytes', { skip: process.platform !== 'linux' }, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'nanaly-file-save-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const target = path.join(directory, 'script.sh'), link = path.join(directory, 'editor.sh');
  await fs.writeFile(target, 'original\n', { mode: 0o750 });
  await fs.symlink(target, link);
  const terminals = new TerminalManager({});
  let incomplete = true;
  const host = { exec: (args, options) => processResult(args[0], args.slice(1), { ...options, input: incomplete ? options.input.slice(0, 2) : options.input }) };
  const failed = await terminals.write(host, { id: 1, path: link, content: '完整的文件\n' });
  assert.ok(failed.error);
  assert.equal(await fs.readFile(target, 'utf8'), 'original\n');
  incomplete = false;
  const saved = await terminals.write(host, { id: 2, path: link, content: '完整的文件\n' });
  assert.equal(saved.error, undefined);
  assert.equal(await fs.readFile(target, 'utf8'), '完整的文件\n');
  assert.equal((await fs.stat(target)).mode & 0o777, 0o750);
  assert.equal((await fs.lstat(link)).isSymbolicLink(), true);
  assert.deepEqual((await fs.readdir(directory)).sort(), ['editor.sh', 'script.sh']);
});

test('an already-cancelled shared-shell run neither writes source nor starts commands', async t => {
  const api = await fixture(t), controller = new AbortController();
  const directory = path.join(api.store.directory, 'jobs', 'unused');
  let commands = 0;
  const host = { directory, cwd: async () => { commands++; return '/work'; }, exec: async () => { commands++; return output(); } };
  controller.abort();
  await assert.rejects(api.sessions.runInShell(host, { language: 'linux', code: 'touch must-not-run', stdin: '', revision: 0 }, { signal: controller.signal }), { code: 'RUN_CANCELLED' });
  assert.equal(commands, 0);
  assert.equal(api.calls.length, 0);
  assert.deepEqual(await fs.readdir(path.join(api.store.directory, 'jobs')), []);
});

test('cancelling a shared-shell run during preparation never executes its script and removes its source', async t => {
  const api = await fixture(t), controller = new AbortController(), entered = deferred(), release = deferred();
  const directory = await fs.mkdtemp(path.join(api.store.directory, 'jobs', 'preparing-'));
  const host = {
    name: 'existing-shell', directory, workspace: { workspaceId: 'workspace', language: 'linux', revision: 0 },
    cwd: async () => { entered.resolve(); await release.promise; return '/work'; },
    exec: async () => output()
  };
  const running = api.sessions.runInShell(host, { language: 'linux', code: 'touch must-not-run', stdin: '', revision: 0 }, { signal: controller.signal });
  await entered.promise;
  controller.abort(); release.resolve();
  await assert.rejects(running, { code: 'RUN_CANCELLED' });
  assert.equal(api.calls.some(args => args.includes('bash')), false, 'cancelled script must never reach docker exec');
  assert.deepEqual(await fs.readdir(directory), []);
});


test('shell shutdown waits for an admitted atomic file save and cancels queued saves before snapshotting', async t => {
  const entered = deferred(), release = deferred(); let writes = 0, completed = false;
  const api = await fixture(t, { hook: async args => {
    if (args.some(value => value.startsWith('import os, stat, sys, tempfile'))) {
      writes++; entered.resolve(); await release.promise; completed = true;
    }
    if (args.includes('-czf')) assert.equal(completed, true, 'snapshot follows the admitted file save');
  } });
  const terminals = new TerminalManager(api.sessions);
  const session = await api.sessions.shell({ language: 'linux' });
  const saving = terminals.write(session.host, { id: 1, path: '/work/readme', content: 'admitted' });
  await entered.promise;
  const queued = terminals.write(session.host, { id: 2, path: '/work/readme', content: 'must not start' });
  const closing = session.hangup('shutdown');
  await tick(); await tick();
  assert.equal(api.calls.some(args => args.includes('-czf')), false);
  assert.ok((await queued).error);
  release.resolve();
  assert.equal((await saving).error, undefined);
  assert.equal((await closing).committed, true);
  assert.equal(writes, 1);
});

test('shared-shell runs reject a mismatched language or stale revision before writing or executing', async t => {
  const api = await fixture(t), session = await api.sessions.shell({ language: 'linux' });
  const workspaceId = session.host.workspace.workspaceId;
  const before = api.calls.length;
  for (const [request, code] of [
    [{ language: 'git', workspaceId, workspaceRevision: 0 }, 'WORKSPACE_LANGUAGE'],
    [{ language: 'linux', workspaceId, workspaceRevision: 1 }, 'WORKSPACE_CONFLICT']
  ]) await assert.rejects(api.sessions.runInShell(session.host, { ...request, code: 'touch must-not-run', stdin: '', revision: 0 }), { code });
  assert.equal(api.calls.length, before);
  assert.deepEqual(await fs.readdir(session.host.directory), []);
});

test('cancelling while the shared source is made readable reports cancellation and removes the source', async t => {
  const api = await fixture(t), controller = new AbortController();
  const directory = await fs.mkdtemp(path.join(api.store.directory, 'jobs', 'source-race-'));
  const host = { directory, workspace: { workspaceId: 'workspace', language: 'linux', revision: 0 }, cwd: async () => '/work' };
  const chmod = fs.chmod;
  t.mock.method(fs, 'chmod', async (file, mode) => {
    if (path.basename(file).startsWith('run-')) { controller.abort(); await tick(); }
    return chmod(file, mode);
  });
  await assert.rejects(api.sessions.runInShell(host, { language: 'linux', code: 'touch must-not-run', stdin: '', revision: 0 }, { signal: controller.signal }), { code: 'RUN_CANCELLED' });
  assert.equal(api.calls.length, 0);
  assert.deepEqual(await fs.readdir(directory), []);
});

for (const [code, reason, spoof] of [[125], [137], [137, undefined, true], [0, 'timeout'], [0, 'output_limit']]) test(`shared supervisor failure ${reason || code}${spoof ? ' with a learner-printed outcome line' : ''} closes the container and reports the committed revision`, async t => {
  // A learner program can print the outcome line and then kill the supervisor;
  // the non-zero Docker exit code must still count as a failed supervision.
  const api = await fixture(t, { hook: args => args.includes('/opt/nanaly/run-in-shell.py') ? { ...(spoof ? supervised() : output()), code, reason } : undefined });
  const session = await api.sessions.shell({ language: 'linux' });
  const result = await api.sessions.runInShell(session.host, { language: 'linux', code: 'true', stdin: '', revision: 0 });
  assert.equal(result.exitCode, code);
  assert.equal(result.status, reason || 'runtime_error');
  assert.equal(result.workspaceCommitted, true);
  assert.equal(result.workspaceRevision, 1);
  assert.equal(api.store.getWorkspace(result.workspaceId).revision, 1);
  assert.equal(api.runner.containers.size, 0);
  assert.equal(session.exited.reason, 'run_failed');
  assert.ok(result.warnings.some(warning => warning.includes('终端已关闭')));
  assert.equal(api.calls.some(args => args.includes('find')), false, 'closed containers are not queried for a summary');
});

for (const [code, stderr] of [[137, ''], [139, 'Segmentation fault (core dumped)\n'], [200, ''], [124, 'timeout: learner used it\n']]) test(`a script exiting ${code} under a healthy supervisor keeps the terminal open`, async t => {
  const api = await fixture(t, { hook: args => args.includes('/opt/nanaly/run-in-shell.py') ? supervised('exit ' + code, stderr) : undefined });
  const session = await api.sessions.shell({ language: 'linux' });
  const result = await api.sessions.runInShell(session.host, { language: 'linux', code: 'true', stdin: '', revision: 0 });
  assert.equal(result.exitCode, code);
  assert.equal(result.status, 'runtime_error', 'only the supervisor’s own deadline is a timeout');
  assert.equal(result.stderr, stderr, 'the outcome line is not shown to the learner');
  assert.equal(session.exited, null);
  assert.equal(api.runner.containers.size, 1);
  assert.equal(result.workspaceCommitted, false);
  assert.equal(result.warnings.some(warning => warning.includes('终端已关闭')), false);
});

test('the supervisor’s own deadline reports a timeout and keeps the terminal', async t => {
  const api = await fixture(t, { hook: args => args.includes('/opt/nanaly/run-in-shell.py') ? supervised('timeout', 'partial\n') : undefined });
  const session = await api.sessions.shell({ language: 'linux' });
  const result = await api.sessions.runInShell(session.host, { language: 'linux', code: 'sleep 60', stdin: '', revision: 0 });
  assert.deepEqual([result.status, result.exitCode, result.stderr], ['timeout', 124, 'partial\n']);
  assert.equal(session.exited, null);
});

test('a failed save after supervisor death reports the retained revision and warnings', async t => {
  const api = await fixture(t, { hook: args => args.includes('/opt/nanaly/run-in-shell.py') ? { ...output(), code: 137 }
    : args.includes('persist') ? { ...output(), code: 1 } : undefined });
  const session = await api.sessions.shell({ language: 'linux' });
  const result = await api.sessions.runInShell(session.host, { language: 'linux', code: 'true', stdin: '', revision: 0 });
  assert.equal(result.exitCode, 137);
  assert.equal(result.workspaceCommitted, false);
  assert.equal(result.workspaceRevision, 0);
  assert.equal(api.store.getWorkspace(result.workspaceId).revision, 0);
  assert.equal(api.runner.containers.size, 0);
  assert.ok(result.warnings.some(warning => warning.includes('没有保存')));
  assert.equal(result.warnings.some(warning => warning.includes('已保存并关闭')), false);
});

for (const killed of [false, true]) test(`cancellation ${killed ? 'with a killed supervisor finishes unsafe cleanup' : 'reported by the supervisor retains the shell'}`, async t => {
  const controller = new AbortController();
  const api = await fixture(t, { hook: args => {
    if (args.includes('/opt/nanaly/run-in-shell.py')) { controller.abort(); return killed ? { ...output(), code: 137 } : supervised('cancelled'); }
  } });
  const session = await api.sessions.shell({ language: 'linux' });
  await assert.rejects(api.sessions.runInShell(session.host, { language: 'linux', code: 'true', stdin: '', revision: 0 }, { signal: controller.signal }), { code: 'RUN_CANCELLED' });
  assert.equal(api.runner.containers.size, killed ? 0 : 1);
  assert.equal(session.exited === null, !killed);
});
