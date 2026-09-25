import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { PrivateStore } from '../../../server/lib/store.mjs';
import { createApp } from '../../../server/app.mjs';
import { validateRun } from '../../../server/lib/validation.mjs';
import { DockerRunner } from '../../../server/lib/runner.mjs';
import { processResult } from '../../../server/lib/process.mjs';

const token = 'test-only-0123456789-abcdef-abcdef';
async function storeFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nanaly-test-'));
  const store = await new PrivateStore(path.join(root, 'private')).init();
  t.after(async () => { await store.close(); await fs.rm(root, { recursive: true, force: true }); });
  return { root, store };
}
test('state CAS serializes concurrent devices and recovers verified backup', async t => {
  const { store } = await storeFixture(t);
  assert.deepEqual(Object.keys(store.getState().data), ['memories', 'goals', 'notes', 'experiences', 'events']);
  const results = await Promise.allSettled([store.putState(0, { memories: ['first'] }), store.putState(0, { memories: ['second'] })]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'REVISION_CONFLICT');
  await store.putState(1, { memories: ['updated'] });
  await fs.writeFile(path.join(store.directory, 'state.json'), '{truncated');
  await store.close();
  await store.init();
  assert.equal(store.recovered, true); assert.equal(store.state.revision, 1);
  assert.deepEqual(store.state.data.memories, ['first']);
});
test('corrupt backup with absent primary fails closed; dangerous state keys rejected', async t => {
  const { store } = await storeFixture(t);
  assert.throws(() => store.putState(0, JSON.parse('{"__proto__":{"polluted":true}}')), { code: 'INVALID_STATE' });
  await fs.writeFile(path.join(store.directory, 'state.json.bak'), 'corrupt');
  await assert.rejects(store.readRecord('state', {}), { code: 'STORE_CORRUPT' });
  assert.equal({}.polluted, undefined);
});
test('store rejects public repository directory and a second writer', async t => {
  const { root, store } = await storeFixture(t);
  const second = new PrivateStore(store.directory);
  await assert.rejects(second.init(), { code: 'STORE_LOCKED' });
  const publicStore = new PrivateStore(path.join(root, 'public-data'), { repoRoot: root });
  await assert.rejects(publicStore.init(), { code: 'PRIVATE_PATH_REQUIRED' });
});
test('workspace snapshots are versioned, reset changes identity and busy mutations fail', async t => {
  const { store } = await storeFixture(t);
  const workspace = await store.resetWorkspace(null, 'git');
  const committed = await store.commitWorkspace(workspace, Buffer.from('snapshot'));
  assert.equal(committed.revision, 1);
  await assert.rejects(store.commitWorkspace(workspace, Buffer.from('old')), { code: 'WORKSPACE_CONFLICT' });
  store.busy = new Set([workspace.workspaceId]);
  await assert.rejects(store.resetWorkspace(workspace.workspaceId, 'git'), { code: 'WORKSPACE_BUSY' });
  store.busy.clear();
  const reset = await store.resetWorkspace(workspace.workspaceId, 'git');
  assert.notEqual(reset.workspaceId, workspace.workspaceId); assert.equal(reset.revision, 0);
  assert.throws(() => store.getWorkspace(workspace.workspaceId), { code: 'WORKSPACE_NOT_FOUND' });
  assert.deepEqual(await fs.readdir(path.join(store.directory, 'workspaces')), []);
});
test('HTTP authentication, origin policy, state conflicts and private run history', async t => {
  const { store } = await storeFixture(t);
  const runner = { busy: new Set(), health: async () => ({ ready: false }), run: async request => ({ runId: 'test', revision: request.revision, status: 'accepted', stdout: '2\n', stderr: '', tests: [], diagnostics: [] }) };
  const app = createApp({ store, runner, token, origins: ['https://blog.example'] });
  app.listen(0, '127.0.0.1'); await once(app, 'listening');
  t.after(() => { app.closeAllConnections(); app.close(); });
  const base = 'http://127.0.0.1:' + app.address().port;
  const call = (url, options = {}) => fetch(base + url, { ...options, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...(options.headers || {}) } });
  assert.equal((await fetch(base + '/api/state')).status, 401);
  assert.equal((await call('/api/state', { headers: { Origin: 'https://evil.example' } })).status, 403);
  const good = await call('/api/state', { headers: { Origin: 'https://blog.example' } });
  assert.equal(good.headers.get('access-control-allow-origin'), 'https://blog.example');
  assert.equal(good.headers.get('cache-control'), 'no-store');
  assert.equal((await call('/api/state', { method: 'PUT', body: JSON.stringify({ revision: 0, data: { notes: [] } }) })).status, 200);
  const conflict = await call('/api/state', { method: 'PUT', body: JSON.stringify({ revision: 0, data: {} }) });
  assert.equal(conflict.status, 409); assert.equal((await conflict.json()).revision, 1);
  assert.equal((await call('/api/run', { method: 'POST', body: '{' })).status, 400);
  const request = { language: 'cpp', code: 'int main(){}', revision: 2, tests: [{ input: '1', expectedOutput: '2' }] };
  assert.equal((await call('/api/run', { method: 'POST', body: JSON.stringify(request) })).status, 200);
  const history = await (await call('/api/runs')).json();
  assert.equal(history.runs.length, 1); assert.deepEqual(history.runs[0].testCases, request.tests);
  await call('/api/run', { method: 'POST', body: JSON.stringify({ ...request, saveHistory: false }) });
  assert.equal(store.history.runs.length, 1);
  await call('/api/runs', { method: 'DELETE' });
  assert.equal(store.history.runs.length, 0);
  assert.equal((await store.readRecord('history', null)).runs.length, 0);
  assert.equal((await fetch(base + '/api/health')).status, 200);
});
test('failed authentication behind one proxy cannot block the owner or health probes', async t => {
  const { store } = await storeFixture(t);
  let stamp = 1000;
  const runner = { health: async () => ({ ready: true }) };
  const app = createApp({ store, runner, token, now: () => stamp });
  app.listen(0, '127.0.0.1'); await once(app, 'listening');
  t.after(() => { app.closeAllConnections(); app.close(); });
  const base = 'http://127.0.0.1:' + app.address().port;
  const call = (url, headers = {}) => fetch(base + url, { headers });
  for (let i = 0; i < 12; i++) assert.equal((await call('/api/state')).status, 401);
  // Client-controlled proxy headers must not manufacture a fresh rate-limit bucket.
  const blocked = await call('/api/state', { 'X-Forwarded-For': '203.0.113.42', 'X-Real-IP': '203.0.113.42' });
  assert.equal(blocked.status, 429);
  assert.equal((await call('/api/state', { Authorization: 'Bearer ' + token })).status, 200);
  assert.equal((await call('/api/health')).status, 200);
  stamp += 60001;
  assert.equal((await call('/api/state')).status, 401);
  assert.equal((await call('/api/state', { Authorization: 'Bearer ' + token })).status, 200);
});
test('public health and authenticated requests have independent bounded budgets', async t => {
  const { store } = await storeFixture(t);
  const runner = { health: async () => ({ ready: true }) };
  const app = createApp({ store, runner, token, now: () => 1000 });
  app.listen(0, '127.0.0.1'); await once(app, 'listening');
  t.after(() => { app.closeAllConnections(); app.close(); });
  const base = 'http://127.0.0.1:' + app.address().port;
  const owner = { headers: { Authorization: 'Bearer ' + token } };
  for (let i = 0; i < 180; i++) assert.equal((await fetch(base + '/api/health')).status, 200);
  assert.equal((await fetch(base + '/api/health')).status, 429);
  for (let i = 0; i < 180; i++) assert.equal((await fetch(base + '/api/state', owner)).status, 200);
  assert.equal((await fetch(base + '/api/state', owner)).status, 429);
  assert.equal((await fetch(base + '/api/state')).status, 401);
});
test('input boundaries prevent oversized and stale workspace requests', () => {
  assert.throws(() => validateRun({ language: 'bash', code: 'id' }), { code: 'INVALID_LANGUAGE' });
  assert.throws(() => validateRun({ language: 'cpp', code: 'x'.repeat(65537) }), { code: 'INVALID_CODE' });
  assert.throws(() => validateRun({ language: 'git', code: 'git status', workspaceId: '11111111-1111-4111-8111-111111111111' }), { code: 'INVALID_WORKSPACE_REVISION' });
  assert.throws(() => validateRun({ language: 'mysql', code: 'select 1', tests: [{ input: '' }] }), { code: 'INVALID_TESTS' });
});
test('process timeout and byte limits actually stop host test subprocesses', async () => {
  const limited = await processResult(process.execPath, ['-e', 'process.stdout.write("a".repeat(30000))'], { limit: 1000 });
  assert.equal(limited.reason, 'output_limit'); assert.equal(limited.stdout.length, 1000);
  const timed = await processResult(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeout: 80 });
  assert.equal(timed.reason, 'timeout');
});
function fakeDocker(calls) {
  return async (command, args) => {
    calls.push({ command, args });
    let stdout = '';
    if (args[0] === 'info') stdout = JSON.stringify({ OSType: 'linux', CgroupVersion: '2', MemoryLimit: true, PidsLimit: true, CpuCfsQuota: true });
    if (args[0] === 'image') stdout = 'sha256:example';
    if (args.includes('/input/program')) stdout = '2\n';
    if (args.includes('/work/program') && args.includes('cat')) stdout = 'ELF-binary-placeholder';
    if (args.includes('tar') && args.includes('-czf')) stdout = 'snapshot';
    return { code: 0, stdout: Buffer.from(stdout), stderr: Buffer.alloc(0) };
  };
}
test('runner constructs constrained containers and gives every testcase its own sandbox', async t => {
  const { store } = await storeFixture(t); const calls = [];
  const runner = new DockerRunner(store, { execute: fakeDocker(calls) });
  const result = await runner.run(validateRun({ language: 'cpp', code: 'int main(){}', revision: 7, tests: [{ input: '1', expectedOutput: '2\n' }, { input: '3', expectedOutput: '3' }] }));
  assert.equal(result.status, 'wrong_answer'); assert.equal(result.tests.length, 2); assert.equal(result.revision, 7);
  const created = calls.filter(call => call.args[0] === 'create');
  assert.equal(created.length, 3);
  assert.equal(new Set(created.map(call => call.args[2])).size, 3);
  for (const call of created) {
    for (const flag of ['--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges:true', '--user=10001:10001', '--pids-limit=96', '--memory=1024m', '--memory-swap=1024m']) assert.ok(call.args.includes(flag), flag);
    assert.ok(!call.args.includes('--privileged')); assert.ok(!call.args.some(arg => arg.includes('docker.sock')));
  }
  assert.ok(calls.every(call => call.command === 'docker'));
  assert.equal(calls.filter(call => call.args[0] === 'rm').length, 3);
  assert.equal(runner.active.size, 0);
});
test('runner refuses missing limits/dependencies without executing a host fallback', async t => {
  const { store } = await storeFixture(t);
  const calls = [];
  const runner = new DockerRunner(store, { execute: async (command, args) => { calls.push({ command, args }); return { code: 1, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }; } });
  await assert.rejects(runner.run(validateRun({ language: 'linux', code: 'id' })), { code: 'RUNNER_UNAVAILABLE' });
  assert.ok(calls.every(call => call.command === 'docker'));
  assert.ok(calls.every(call => call.args[0] === 'info'));
  const mysql = await runner.run(validateRun({ language: 'mysql', code: 'DROP TABLE x', mode: 'check' }));
  assert.equal(mysql.status, 'unsupported_check'); assert.equal(Object.keys(store.workspaces.items).length, 0);
});
test('rejected concurrent workspace request does not release another run lock', async t => {
  const { store } = await storeFixture(t);
  const workspace = await store.resetWorkspace(null, 'git');
  const runner = new DockerRunner(store, { execute: fakeDocker([]) });
  runner.busy.add(workspace.workspaceId);
  await assert.rejects(runner.run(validateRun({ language: 'git', code: 'git status', workspaceId: workspace.workspaceId, workspaceRevision: 0 })), { code: 'WORKSPACE_BUSY' });
  assert.ok(runner.busy.has(workspace.workspaceId));
});
