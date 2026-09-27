import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { BoundedQueue } from '../../../server/lib/process.mjs';
import { DockerRunner } from '../../../server/lib/runner.mjs';
import { TerminalManager } from '../../../server/lib/terminal.mjs';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const output = (stdout = '') => ({ code: 0, stdout: Buffer.from(stdout), stderr: Buffer.alloc(0) });

test('host execution admission bounds concurrency and waiting, cancels queued work, and releases failures', async () => {
  const queue = new BoundedQueue({ concurrency: 1, maxQueued: 1 });
  const gate = deferred(), order = [], controller = new AbortController();
  const first = queue.run(() => { order.push('first'); return gate.promise; });
  const cancelled = queue.run(() => order.push('cancelled'), { signal: controller.signal });
  await assert.rejects(queue.run(() => order.push('overflow')), { code: 'EXEC_BUSY' });
  controller.abort(); await assert.rejects(cancelled, { code: 'RUN_CANCELLED' });
  const next = queue.run(() => { order.push('next'); throw new Error('command failed'); });
  const rejected = assert.rejects(next, /command failed/);
  assert.deepEqual(order, ['first']);
  gate.resolve(); await first; await rejected;
  assert.equal(await queue.run(() => 'recovered'), 'recovered');
  assert.deepEqual(order, ['first', 'next']);
  assert.equal(queue.active, 0); assert.equal(queue.pending.length, 0);
});

test('a queued command expires without starting and shutdown drains only admitted work', async () => {
  const queue = new BoundedQueue({ concurrency: 1, maxQueued: 1, wait: 10 });
  const gate = deferred(); let started = false;
  const first = queue.run(() => gate.promise);
  await assert.rejects(queue.run(() => { started = true; }), { code: 'EXEC_BUSY' });
  assert.equal(started, false);
  const queued = queue.run(() => { started = true; });
  const rejected = assert.rejects(queued, { code: 'EXEC_CLOSED' });
  let closed = false; const drained = queue.close().then(() => { closed = true; });
  await rejected; assert.equal(closed, false);
  gate.resolve(); await first; await drained;
  assert.equal(started, false); assert.equal(closed, true);
  await assert.rejects(queue.run(() => {}), { code: 'EXEC_CLOSED' });
});

test('Docker cleanup has reserved capacity while normal CLIs are full and duplicate kills share a process', async () => {
  const normal = deferred(), killed = deferred(), calls = [];
  const runner = new DockerRunner({ directory: '/test-only/private' }, {
    cliConcurrency: 1, cliQueueLimit: 1,
    execute: async (_command, args) => {
      calls.push(args.join(' '));
      if (args[0] === 'exec') await normal.promise;
      if (args[0] === 'kill') await killed.promise;
      return output();
    }
  });
  const running = runner.cli(['exec', 'container', 'read']);
  const waiting = runner.cli(['info']);
  await assert.rejects(runner.cli(['image', 'inspect']), { code: 'EXEC_BUSY' });
  const kill = runner.cli(['kill', 'container']);
  assert.equal(runner.cli(['kill', 'container']), kill);
  await runner.cli(['rm', '-f', 'other']);
  assert.deepEqual(calls, ['exec container read', 'kill container', 'rm -f other']);
  killed.resolve(); await kill; normal.resolve(); await running; await waiting;
  assert.equal(calls.at(-1), 'info');
  await runner.close();
});

class Socket extends EventEmitter {
  constructor() { super(); this.closed = false; this.closeSent = false; this.buffered = 0; this.messages = []; this.closeCodes = []; }
  send(value) { this.messages.push(typeof value === 'string' ? JSON.parse(value) : value); }
  close(code) { if (this.closed) return; this.closeCodes.push(code); this.closed = true; this.closeSent = true; this.emit('close'); }
  message(value) { this.emit('message', JSON.stringify(value), false); }
}
function shell(host) {
  const finished = deferred();
  const session = { kind: 'shell', id: 'test-session', host, done: finished.promise, clients: new Set(),
    replay: () => ({ reset: true, offset: 0, bytes: Buffer.alloc(0) }),
    attach(client) { this.clients.add(client); }, detach(client) { this.clients.delete(client); },
    resize() {}, pause() {}, resume() {}, write() {}, hangup: () => finished.promise };
  return { session, finished };
}

test('file requests share one shell queue across pages, reject overflow and cancel only disconnected work', async () => {
  const gate = deferred(), calls = []; let active = 0, peak = 0;
  const host = { exec: async (_args, options) => {
    active++; peak = Math.max(peak, active); calls.push(options.input);
    if (calls.length === 1) await gate.promise;
    active--; return output();
  } };
  const { session } = shell(host);
  const terminals = new TerminalManager({ shell: async () => session }, { fileQueueLimit: 2 });
  const first = new Socket(), other = new Socket();
  await terminals.attach(first, { kind: 'shell', language: 'linux' });
  await terminals.attach(other, { kind: 'shell', language: 'linux' });
  first.message({ type: 'write', id: 1, path: '/work/note', content: 'admitted' });
  first.message({ type: 'write', id: 2, path: '/work/note', content: 'cancelled' });
  other.message({ type: 'write', id: 3, path: '/work/note', content: 'other page' });
  other.message({ type: 'write', id: 4, path: '/work/note', content: 'overflow' });
  await tick();
  assert.ok(other.messages.find(message => message.id === 4)?.error);
  assert.deepEqual(calls, ['admitted']);
  first.close(1000); gate.resolve(); await tick(); await tick();
  assert.deepEqual(calls, ['admitted', 'other page']); assert.equal(peak, 1);
  assert.equal(other.messages.find(message => message.id === 3)?.error, undefined);
  assert.equal(first.messages.some(message => message.type === 'written'), false, 'closed sockets receive no delayed responses');
  other.close(1000);
});

test('invalid file protocol fields produce small scalar-only errors without running a command', async () => {
  let calls = 0;
  const host = { exec: async () => { calls++; return output('readme'); } };
  const terminals = new TerminalManager({});
  const cases = [
    { id: { nested: ['unsupported'] }, path: '/work/readme' },
    { id: 1, path: { nested: ['unsupported'] } },
    { id: [], path: '/work/readme' },
    { id: 'x'.repeat(129), path: '/work/readme' },
    { id: -1, path: '/work/readme' },
    { id: 1, path: '/work/readme', content: { text: 'invalid' } }
  ];
  for (const message of cases) {
    const response = await terminals.write(host, message);
    assert.ok(response.error); assert.ok(JSON.stringify(response).length < 300);
    assert.ok(response.id === null || typeof response.id === 'number' || typeof response.id === 'string');
    assert.equal(typeof response.path, 'string');
  }
  assert.equal(calls, 0);
  assert.equal((await terminals.read(host, { id: 'valid', path: '/work/readme' })).content, 'readme');
  assert.equal(calls, 1);
});

test('file responses close a backed-up socket and discard queued work without adding more output', async () => {
  const gate = deferred(); let calls = 0;
  const host = { exec: async () => { calls++; await gate.promise; return output('contents'); } };
  const { session } = shell(host);
  const terminals = new TerminalManager({ shell: async () => session });
  const ws = new Socket(); await terminals.attach(ws, { kind: 'shell', language: 'linux' });
  ws.message({ type: 'read', id: 1, path: '/work/readme' });
  ws.buffered = 8 * 1024 * 1024;
  const count = ws.messages.length;
  gate.resolve(); await tick();
  assert.deepEqual(ws.closeCodes, [1013]); assert.equal(ws.messages.length, count);
  ws.message({ type: 'read', id: 2, path: '/work/readme' }); await tick();
  assert.equal(calls, 1); assert.equal(terminals.sockets.size, 0); assert.equal(session.clients.size, 0);
});

test('terminal response send failures are contained and detach the client', async () => {
  const { session } = shell({ exec: async () => output('ok') });
  const terminals = new TerminalManager({ shell: async () => session });
  const ws = new Socket(); await terminals.attach(ws, { kind: 'shell', language: 'linux' });
  ws.send = () => { throw new Error('socket gone'); };
  ws.message({ type: 'read', id: 1, path: '/work/readme' }); await tick();
  assert.deepEqual(ws.closeCodes, [1011]); assert.equal(session.clients.size, 0);
});


test('runner shutdown waits for reserved cleanup commands after ordinary commands have drained', async () => {
  const release = deferred();
  const runner = new DockerRunner({ directory: '/test-only/private' }, { execute: async () => { await release.promise; return output(); } });
  const cleanup = runner.cli(['kill', 'test-container']);
  let closed = false;
  const closing = runner.close().then(() => { closed = true; });
  await tick(); assert.equal(closed, false);
  release.resolve(); await cleanup; await closing;
  assert.equal(closed, true);
  assert.equal(runner.controlQueue.active, 0); assert.equal(runner.controlQueue.pending.length, 0);
  assert.equal(runner.pendingControls.size, 0);
});


test('failed removal still drains outstanding cleanup and keeps the container tracked for retry', async () => {
  const release = deferred(); let fail = true;
  const runner = new DockerRunner({ directory: '/test-only/private' }, { execute: async (_command, args) => {
    if (args[0] === 'kill') await release.promise;
    if (args[0] === 'rm' && fail) throw new Error('synthetic removal failure');
    return output();
  } });
  runner.containers.add('test-container');
  const cleanup = runner.cli(['kill', 'test-container']);
  let closed = false;
  const closing = runner.close().catch(error => { closed = true; return error; });
  await tick(); assert.equal(closed, false);
  release.resolve(); await cleanup;
  assert.match((await closing).message, /synthetic removal failure/);
  assert.equal(runner.containers.has('test-container'), true);
  assert.equal(runner.controlQueue.active, 0); assert.equal(runner.pendingControls.size, 0);
  fail = false; await runner.close(); assert.equal(runner.containers.size, 0);
});
