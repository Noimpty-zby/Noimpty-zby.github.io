import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Exercise the actual entrypoint orchestration with deterministic time and resource
// handles. No listener, Docker daemon, credentials, or real process is involved.
const source = readFileSync(new URL('../../../server/index.mjs', import.meta.url), 'utf8')
  .replace(/^import .*;\n/gm, '')
  .replace(/^const repoRoot = .*;$/m, "const repoRoot = '/synthetic/blog';");
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
async function start({ finishSessions, finishRunner, finishRequests, startupError } = {}) {
  const events = [], exits = [], logs = [], signals = new Map(), timers = new Set();
  let clock = 0;
  class Store { async init() { events.push('store:init'); } async close() { events.push('store:close'); } }
  class Runner {
    async cleanAbandoned() { events.push('runner:startup'); if (startupError) throw startupError; }
    async close() { events.push('runner:close'); await finishRunner?.(); }
  }
  class Sessions { async close() { events.push('sessions:close'); await finishSessions?.(); events.push('sessions:saved'); } }
  class Terminals { close() { events.push('terminals:close'); } }
  const server = {
    once() {}, listen(_port, _host, ready) { events.push('server:listen'); ready(); },
    close(done) { events.push('server:close'); Promise.resolve(finishRequests?.()).then(() => { events.push('requests:done'); done(); }); }
  };
  vm.runInNewContext(source, {
    fs: { readFile: async () => 'abcdef123456' }, path: { join: (...parts) => parts.join('/') },
    PrivateStore: Store, DockerRunner: Runner, SessionManager: Sessions, TerminalManager: Terminals,
    createApp: () => server,
    process: { env: {}, on: (signal, fn) => signals.set(signal, fn), exit: code => exits.push(code) },
    console: { log() {}, error: text => logs.push(text) },
    setTimeout: (fn, delay) => { const timer = { fn, at: clock + delay, unref() {} }; timers.add(timer); return timer; },
    clearTimeout: timer => timers.delete(timer)
  });
  await flush();
  return { events, exits, logs, signal: () => signals.get('SIGTERM')(), advance(ms) {
    clock += ms; for (const timer of [...timers]) if (timer.at <= clock) { timers.delete(timer); timer.fn(); }
  } };
}

test('service shutdown allows a slow admitted terminal save and keeps storage locked until HTTP handlers drain', async () => {
  const saved = deferred(), requests = deferred();
  const h = await start({ finishSessions: () => saved.promise, finishRequests: () => requests.promise });
  h.signal(); h.signal(); await flush(); h.advance(16000);
  assert.deepEqual(h.exits, [], 'the former 15-second forced exit lost legitimate terminal saves');
  assert.equal(h.events.includes('runner:close'), false);
  assert.equal(h.events.includes('store:close'), false);
  saved.resolve(); await flush();
  assert.equal(h.events.includes('runner:close'), true);
  assert.equal(h.events.includes('store:close'), false, 'an admitted HTTP save still owns the storage lock');
  requests.resolve(); await flush();
  assert.equal(h.events.filter(x => x === 'sessions:close').length, 1);
  assert.ok(h.events.indexOf('sessions:saved') < h.events.indexOf('runner:close'));
  assert.ok(h.events.indexOf('requests:done') < h.events.indexOf('store:close'));
  assert.deepEqual(h.exits, [0]);
  h.advance(120000); assert.deepEqual(h.exits, [0], 'successful cleanup cancels the final deadline');
});

test('failed terminal or container cleanup still drains requests and closes storage, with a failure exit', async () => {
  for (const failure of ['finishSessions', 'finishRunner']) {
    const h = await start({ [failure]: async () => { throw new Error('must-not-log-sensitive-details'); } });
    h.signal(); await flush();
    assert.equal(h.events.includes('runner:close'), true);
    assert.equal(h.events.includes('store:close'), true);
    assert.deepEqual(h.exits, [1]);
    assert.equal(h.logs.length, 1);
    assert.doesNotMatch(h.logs.join('\n'), /must-not-log-sensitive-details/);
  }
});

test('failed startup runs the same resource cleanup and never reports a successful exit', async () => {
  const h = await start({ startupError: new Error('private startup details') });
  assert.equal(h.events.includes('server:listen'), false);
  assert.equal(h.events.includes('sessions:close'), true);
  assert.equal(h.events.includes('runner:close'), true);
  assert.equal(h.events.at(-1), 'store:close');
  assert.deepEqual(h.exits, [1]);
  assert.doesNotMatch(h.logs.join('\n'), /private startup details/);
});

test('a permanently stuck shutdown still has a bounded final deadline and retains its storage lock', async () => {
  const stuck = deferred();
  const h = await start({ finishSessions: () => stuck.promise });
  h.signal(); await flush(); h.advance(120000);
  assert.deepEqual(h.exits, [1]);
  assert.equal(h.events.includes('store:close'), false);
});
