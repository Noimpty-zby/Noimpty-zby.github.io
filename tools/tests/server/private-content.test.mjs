import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { PrivateStore } from '../../../server/lib/store.mjs';
import { createApp } from '../../../server/app.mjs';
import { PRIVATE_CONTENT_NAMES, validatePrivateContent } from '../../../server/lib/private-content.mjs';

const owner = 'offline-private-owner-0123456789';
const automation = 'offline-private-automation-0123456789';
const origin = 'https://blog.example';
const sample = () => ({
  schedule: { days: { '2026-09-27': [{ id: 'synthetic-task', text: 'SYNTHETIC_PRIVATE_SCHEDULE', done: false, when: { type: 'post', match: 'example' }, custom: { keep: true } }] }, extension: 'keep' },
  journal: { v: 1, entries: [{ ts: 1234, at: '9-27 12:00', who: 'patrol', what: 'SYNTHETIC_PRIVATE_JOURNAL' }] },
  profile: '# SYNTHETIC_PRIVATE_PROFILE\nOnly a test fixture.\n',
  usage: { v: 1, runs: [{ ts: 1234, at: '9-27 12:00', job: 'synthetic', tasks: { summary: { calls: 1, hit: 2, miss: 3, out: 4 } } }] }
});
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nanaly-private-content-'));
  const store = await new PrivateStore(path.join(root, 'private')).init();
  t.after(async () => { await store.close(); await fs.rm(root, { recursive: true, force: true }); });
  return { root, store };
}
async function apiFixture(t, options = {}) {
  const { store } = await fixture(t);
  const app = createApp({ store, runner: { health: async () => ({ ready: true }), busy: new Set() }, token: owner, automationToken: automation, origins: [origin], ...options });
  app.listen(0, '127.0.0.1'); await once(app, 'listening');
  t.after(async () => { app.closeAllConnections(); await new Promise(resolve => app.close(resolve)); });
  const base = `http://127.0.0.1:${app.address().port}`;
  const call = async (route, { token = owner, method = 'GET', body, headers = {} } = {}) => {
    const response = await fetch(base + route, { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, headers: response.headers, body: await response.json() };
  };
  return { store, call };
}

test('private documents preserve complete data and use independent CAS records', async t => {
  const { store } = await fixture(t);
  const data = sample();
  for (const name of PRIVATE_CONTENT_NAMES) {
    assert.equal(store.getPrivateContent(name).revision, 0);
    const written = await store.putPrivateContent(name, 0, data[name]);
    assert.deepEqual(written, { revision: 1, data: data[name] });
    assert.deepEqual(store.getPrivateContent(name), written);
    const disk = JSON.parse(await fs.readFile(path.join(store.directory, `private-${name}.json`), 'utf8'));
    assert.equal(disk.format, 1); assert.deepEqual(disk.value, written);
  }
  const first = { days: {}, extension: { value: 'first' } };
  const queued = store.putPrivateContent('schedule', 1, first);
  first.extension.value = 'mutated-after-validation';
  await queued;
  assert.equal(store.getPrivateContent('schedule').data.extension.value, 'first');
  const returned = store.getPrivateContent('schedule');
  returned.data.extension.value = 'mutated-return';
  assert.equal(store.getPrivateContent('schedule').data.extension.value, 'first');
  const writes = await Promise.allSettled([
    store.putPrivateContent('journal', 1, { v: 1, entries: [] }),
    store.putPrivateContent('journal', 1, data.journal)
  ]);
  assert.equal(writes.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(writes.find(result => result.status === 'rejected').reason.code, 'PRIVATE_CONTENT_CONFLICT');
  assert.equal(store.getPrivateContent('usage').revision, 1);
  assert.equal(store.getState().revision, 0);
});

test('private records recover verified backups and refuse corrupt storage', async t => {
  const { store } = await fixture(t);
  await store.putPrivateContent('profile', 0, 'synthetic original');
  await store.putPrivateContent('profile', 1, 'synthetic newer');
  await store.close();
  await fs.writeFile(path.join(store.directory, 'private-profile.json'), '{broken');
  await store.init();
  assert.equal(store.recovered, true);
  assert.deepEqual(store.getPrivateContent('profile'), { revision: 1, data: 'synthetic original' });
  await store.close();
  await fs.writeFile(path.join(store.directory, 'private-profile.json'), '{broken');
  await fs.writeFile(path.join(store.directory, 'private-profile.json.bak'), '{broken');
  await assert.rejects(store.init(), { code: 'STORE_CORRUPT' });
});

test('failed private saves leave the last committed in-memory value intact', async t => {
  const { store } = await fixture(t);
  await store.putPrivateContent('profile', 0, 'synthetic original');
  store.writeRecord = async () => { throw new Error('synthetic disk failure'); };
  await assert.rejects(store.putPrivateContent('profile', 1, 'synthetic newer'), /synthetic disk failure/);
  assert.deepEqual(store.getPrivateContent('profile'), { revision: 1, data: 'synthetic original' });
});

test('private schemas reject malformed, oversized and prototype-bearing content without trimming valid extensions', () => {
  const values = sample();
  for (const name of PRIVATE_CONTENT_NAMES) validatePrivateContent(name, values[name]);
  validatePrivateContent('journal', values.journal.entries); // Legacy file envelope.
  validatePrivateContent('usage', values.usage.runs);
  for (const [name, data] of [
    ['schedule', { days: { '2026-02-30': [] } }],
    ['schedule', { days: { '2026-09-27': [{ id: 'a', text: 'x', done: 'false' }] } }],
    ['schedule', { days: { '2026-09-27': [{ id: 'a', text: 'x', done: false }, { id: 'a', text: 'y', done: false }] } }],
    ['schedule', JSON.parse('{"days":{},"__proto__":{"polluted":true}}')],
    ['journal', { v: 1, entries: [{ ts: -1, who: 'test', what: 'x' }] }],
    ['journal', { v: 1, entries: [{ ts: 1, who: 'test', what: {} }] }],
    ['usage', { v: 1, runs: [{ ts: 1, job: 'test', tasks: { test: { calls: 1, hit: 0, miss: -1, out: 0 } } }] }],
    ['usage', { v: 1, runs: [{ ts: 1, job: 'test', tasks: { test: { calls: 1, hit: 0, miss: Infinity, out: 0 } } }] }],
    ['profile', {}], ['profile', 'synthetic\0profile'], ['profile', undefined]
  ]) assert.throws(() => validatePrivateContent(name, data), { code: 'INVALID_PRIVATE_CONTENT' });
  const deep = { days: {} }; let child = deep;
  for (let i = 0; i < 26; i++) child = child.nested = {};
  assert.throws(() => validatePrivateContent('schedule', deep), { code: 'INVALID_PRIVATE_CONTENT' });
  for (const [name, data] of [['profile', 'a'.repeat(128 * 1024)], ['schedule', { days: {}, extra: 'a'.repeat(1024 * 1024) }], ['journal', { entries: [], extra: 'a'.repeat(512 * 1024) }], ['usage', { runs: [], extra: 'a'.repeat(1024 * 1024) }]]) {
    assert.throws(() => validatePrivateContent(name, data), { code: 'PRIVATE_CONTENT_TOO_LARGE' });
  }
  assert.throws(() => validatePrivateContent('../state', {}), { code: 'PRIVATE_CONTENT_NOT_FOUND' });
  assert.equal({}.polluted, undefined);
});

test('private HTTP routes enforce authentication, distinct scopes, profile read-only automation and CAS', async t => {
  const { store, call } = await apiFixture(t);
  const data = sample();
  for (const name of PRIVATE_CONTENT_NAMES) {
    const route = '/api/private-content/' + name;
    assert.equal((await call(route, { token: null })).status, 401);
    assert.equal((await call(route, { token: automation })).status, 403);
    const written = await call(route, { method: 'PUT', body: { revision: 0, data: data[name] } });
    assert.equal(written.status, 200); assert.deepEqual(written.body, { revision: 1, data: data[name], identity: store.identity });
    const read = await call(route, { headers: { Origin: origin } });
    assert.equal(read.status, 200); assert.deepEqual(read.body, written.body);
    assert.equal(read.headers.get('cache-control'), 'no-store');
    assert.equal(read.headers.get('access-control-allow-origin'), origin);
    const autoRoute = '/api/automation/private-content/' + name;
    const autoRead = await call(autoRoute, { token: automation });
    assert.equal(autoRead.status, 200); assert.deepEqual(autoRead.body, written.body);
    const autoWrite = await call(autoRoute, { token: automation, method: 'PUT', body: { revision: 1, data: data[name] } });
    assert.equal(autoWrite.status, name === 'profile' ? 403 : 200);
    const stale = await call(route, { method: 'PUT', body: { revision: 0, data: data[name] } });
    assert.equal(stale.status, 409); assert.equal(stale.body.error.code, 'PRIVATE_CONTENT_CONFLICT');
    assert.deepEqual(stale.body.data, data[name]);
  }
  assert.equal((await call('/api/private-content/profile', { headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await call('/api/private-content/profile', { method: 'PUT', body: { data: 'x' } })).status, 400);
  assert.equal((await call('/api/private-content/profile', { method: 'PUT', body: { revision: 1, data: 'x' }, headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await call('/api/private-content/missing')).status, 404);
  assert.equal((await call('/api/private-content/__proto__')).status, 404);
  assert.equal((await call('/api/private-content/profile', { method: 'DELETE' })).status, 405);
  assert.equal((await call('/api/state', { token: automation })).status, 403);
  const context = await call('/api/automation/context', { token: automation });
  assert.deepEqual(context.body, { memories: [], strategies: [] });
  assert.equal(JSON.stringify(store.getState()).includes('SYNTHETIC_PRIVATE_'), false);
});

test('automation request budget cannot consume owner budget behind one proxy address', async t => {
  let stamp = 1000;
  const { call } = await apiFixture(t, { now: () => stamp });
  for (let i = 0; i < 180; i++) assert.equal((await call('/api/automation/private-content/schedule', { token: automation })).status, 200);
  assert.equal((await call('/api/automation/private-content/schedule', { token: automation })).status, 429);
  assert.equal((await call('/api/private-content/schedule')).status, 200);
  for (let i = 1; i < 180; i++) assert.equal((await call('/api/private-content/schedule')).status, 200);
  assert.equal((await call('/api/private-content/schedule')).status, 429);
  assert.equal((await call('/api/private-content/schedule', { token: null })).status, 401);
  stamp += 60001;
  assert.equal((await call('/api/automation/private-content/schedule', { token: automation })).status, 200);
  assert.equal((await call('/api/private-content/schedule')).status, 200);
});

test('random store identity survives restarts without modifying revisioned data or leaking credentials', async t => {
  const { store, call } = await apiFixture(t)
  const identity = store.identity
  assert.match(identity, /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/)
  const response = await call('/api/state')
  assert.equal(response.body.identity, identity)
  assert.equal(JSON.stringify(response.body).includes(owner), false)
  assert.equal(Object.hasOwn(response.body.data, 'identity'), false)
  assert.equal(Object.hasOwn(store.getState(), 'identity'), false)
  await store.close(); await store.init()
  assert.equal(store.identity, identity)
  assert.equal(store.getState().revision, 0)
  const other = await fixture(t)
  assert.notEqual(other.store.identity, identity)
})

test('private writes reject a replaced store identity even when the revision matches', async t => {
  const { store, call } = await apiFixture(t)
  const wrong = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  const denied = await call('/api/private-content/schedule', { method: 'PUT', body: { identity: wrong, revision: 0, data: sample().schedule } })
  assert.equal(denied.status, 409)
  assert.equal(denied.body.error.code, 'PRIVATE_CONTENT_IDENTITY_CHANGED')
  assert.equal(store.getPrivateContent('schedule').revision, 0)
  const accepted = await call('/api/private-content/schedule', { method: 'PUT', body: { identity: store.identity, revision: 0, data: sample().schedule } })
  assert.equal(accepted.status, 200)
  assert.equal(accepted.body.identity, store.identity)
})
