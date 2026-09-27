import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { client, FILES, migrate, readSource } from '../../migrate-private-content.mjs';
import { PrivateStore } from '../../../server/lib/store.mjs';
import { createApp } from '../../../server/app.mjs';
import { PRIVATE_CONTENT_NAMES, emptyPrivateContent } from '../../../server/lib/private-content.mjs';

const owner = 'synthetic-migration-token-0123456789';
const sample = () => ({
  schedule: { days: { '2026-09-27': [{ id: 'synthetic', text: 'Synthetic schedule', done: false, when: { type: 'post', match: 'fixture' }, extension: { nested: ['keep', null, false] } }] }, custom: { z: 1, a: 2 } },
  journal: { v: 1, entries: [{ ts: 1234, at: 'test-time', who: 'test-only', what: 'Synthetic journal\n第二行', extra: { preserve: true } }], custom: 'journal extension' },
  profile: '\n# Synthetic profile\r\n保留 Unicode、换行和尾部空白。  \r\n\n',
  usage: { v: 1, runs: [{ ts: 1234, at: 'test-time', job: 'synthetic', tasks: { task: { calls: 1, hit: 2, miss: 3, out: 4, extension: true } }, extra: 'row extension' }], custom: 'usage extension' }
});

async function sourceFixture(t, values = sample()) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nanaly-migration-'));
  const source = path.join(root, 'source'); await fs.mkdir(source);
  for (const name of PRIVATE_CONTENT_NAMES) await fs.writeFile(path.join(source, FILES[name]), name === 'profile' ? values[name] : JSON.stringify(values[name], null, 2));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, source };
}
async function fixture(t) {
  const values = sample(), { root, source } = await sourceFixture(t, values);
  const store = await new PrivateStore(path.join(root, 'private')).init();
  const app = createApp({ store, runner: { health: async () => ({ ready: true }), busy: new Set() }, token: owner });
  app.listen(0, '127.0.0.1'); await once(app, 'listening');
  t.after(async () => { app.closeAllConnections(); await new Promise(resolve => app.close(resolve)); await store.close(); });
  const calls = [], base = `http://127.0.0.1:${app.address().port}`;
  const request = client(base, owner, (url, options) => {
    calls.push({ name: url.split('/').at(-1), method: options.method });
    return fetch(url, options);
  });
  return { root, source, store, values, request, calls, base };
}

test('migration reads all four complete synthetic sources and defaults to a read-only plan', async t => {
  const api = await fixture(t), source = await readSource(api.source);
  assert.deepEqual(source, api.values);
  assert.equal(source.profile, api.values.profile, 'Markdown whitespace must not be trimmed');
  const before = (await fs.readdir(api.store.directory)).sort();
  const plan = await migrate(source, api.request);
  assert.deepEqual(plan, PRIVATE_CONTENT_NAMES.map(name => ({ name, revision: 0, action: 'import' })));
  assert.deepEqual(api.calls, PRIVATE_CONTENT_NAMES.map(name => ({ name, method: 'GET' })));
  assert.deepEqual((await fs.readdir(api.store.directory)).sort(), before);
  for (const name of PRIVATE_CONTENT_NAMES) assert.equal(api.store.getPrivateContent(name).revision, 0);
});

test('migration preflights every record, imports without trimming extensions, and retries without advancing revisions', async t => {
  const api = await fixture(t), source = await readSource(api.source);
  const result = await migrate(source, api.request, { apply: true });
  assert.ok(result.every(item => item.verified));
  assert.deepEqual(api.calls.slice(0, 4), PRIVATE_CONTENT_NAMES.map(name => ({ name, method: 'GET' })));
  assert.deepEqual(api.calls.slice(4, 8), PRIVATE_CONTENT_NAMES.map(name => ({ name, method: 'PUT' })));
  assert.deepEqual(api.calls.slice(8), PRIVATE_CONTENT_NAMES.map(name => ({ name, method: 'GET' })));
  for (const name of PRIVATE_CONTENT_NAMES) {
    assert.deepEqual(api.store.getPrivateContent(name), { revision: 1, data: source[name] });
    const disk = JSON.parse(await fs.readFile(path.join(api.store.directory, `private-${name}.json`), 'utf8'));
    assert.deepEqual(disk.value.data, source[name]);
  }
  const fileBefore = await fs.readFile(path.join(api.store.directory, 'private-schedule.json'), 'utf8');
  source.schedule.custom = { a: 2, z: 1 }; // Key order is not a new document.
  api.calls.length = 0;
  const retried = await migrate(source, api.request, { apply: true });
  assert.ok(retried.every(item => item.action === 'already-migrated' && item.verified));
  assert.ok(api.calls.every(call => call.method === 'GET'));
  for (const name of PRIVATE_CONTENT_NAMES) assert.equal(api.store.getPrivateContent(name).revision, 1);
  assert.equal(await fs.readFile(path.join(api.store.directory, 'private-schedule.json'), 'utf8'), fileBefore);
});

test('a conflict or invalid final record aborts preflight before any import', async t => {
  const api = await fixture(t), source = await readSource(api.source);
  const other = { ...source.usage, custom: 'existing backend document' };
  await api.store.putPrivateContent('usage', 0, other);
  await assert.rejects(migrate(source, api.request, { apply: true }), /refusing to overwrite: usage/);
  assert.ok(api.calls.every(call => call.method === 'GET'));
  for (const name of ['schedule', 'journal', 'profile']) assert.equal(api.store.getPrivateContent(name).revision, 0);
  assert.deepEqual(api.store.getPrivateContent('usage').data, other);
  api.calls.length = 0;
  source.usage.runs[0].tasks.task.calls = -1;
  await assert.rejects(migrate(source, api.request, { apply: true }), { code: 'INVALID_PRIVATE_CONTENT' });
  assert.ok(api.calls.every(call => call.method === 'GET'));
  for (const name of ['schedule', 'journal', 'profile']) assert.equal(api.store.getPrivateContent(name).revision, 0);
});

test('a backend CAS change after preflight is not overwritten and later records stay untouched', async t => {
  const api = await fixture(t), source = await readSource(api.source);
  const concurrent = { days: {}, extension: 'a concurrent edit' };
  let changed = false;
  const request = async (name, body) => {
    if (body && !changed) { changed = true; await api.store.putPrivateContent(name, 0, concurrent); }
    return api.request(name, body);
  };
  await assert.rejects(migrate(source, request, { apply: true }), /schedule HTTP 409/);
  assert.deepEqual(api.store.getPrivateContent('schedule'), { revision: 1, data: concurrent });
  for (const name of ['journal', 'profile', 'usage']) assert.equal(api.store.getPrivateContent(name).revision, 0);
  assert.equal(api.calls.filter(call => call.method === 'PUT').length, 1);
});

test('migration validates backend fields at preflight, PUT acknowledgement, and final verification', async () => {
  for (const stage of ['preflight', 'write', 'verify']) {
    for (const invalid of ['missing revision', 'string revision', 'malformed data']) {
      const source = sample(), counts = new Map(); let writes = 0;
      const request = async (name, body) => {
        const getCount = (counts.get(name) || 0) + (body ? 0 : 1);
        counts.set(name, getCount);
        if (body) writes++;
        const response = { revision: body || getCount > 1 ? 1 : 0, data: body || getCount > 1 ? source[name] : emptyPrivateContent(name) };
        const phase = body ? 'write' : getCount === 1 ? 'preflight' : 'verify';
        if (phase === stage && name === 'usage') {
          if (invalid === 'missing revision') delete response.revision;
          else if (invalid === 'string revision') response.revision = '1';
          else response.data = { runs: 'not an array' };
        }
        return response;
      };
      await assert.rejects(migrate(source, request, { apply: true }), /Invalid backend (revision|data): usage/);
      if (stage === 'preflight') assert.equal(writes, 0);
    }
  }
});

test('migration checks acknowledgement content and refuses a changed final document', async () => {
  for (const stage of ['write', 'verify']) {
    const source = sample(), counts = new Map();
    const request = async (name, body) => {
      const getCount = (counts.get(name) || 0) + (body ? 0 : 1); counts.set(name, getCount);
      const response = { revision: body || getCount > 1 ? 1 : 0, data: body || getCount > 1 ? source[name] : emptyPrivateContent(name) };
      if (name === 'profile' && (stage === 'write' ? body : getCount > 1)) response.data = 'a different synthetic profile';
      return response;
    };
    await assert.rejects(migrate(source, request, { apply: true }), stage === 'write' ? /Import response did not match/ : /Migration verification failed/);
  }
});

test('source loading rejects missing, malformed, oversized and symlinked files without following them', async t => {
  const { source } = await sourceFixture(t);
  const usage = path.join(source, FILES.usage), original = await fs.readFile(usage);
  await fs.writeFile(usage, '{broken'); await assert.rejects(readSource(source), /Invalid migration source: usage/);
  await fs.writeFile(usage, JSON.stringify({ v: 1, runs: [], constructor: 'unsupported' }));
  await assert.rejects(readSource(source), /Invalid migration source: usage/);
  await fs.writeFile(usage, original); await fs.truncate(usage, 2 * 1024 * 1024 + 1);
  await assert.rejects(readSource(source), /bounded regular file: usage/);
  await fs.rm(usage); await assert.rejects(readSource(source), { code: 'ENOENT' });
  if (process.platform !== 'win32') {
    await fs.symlink(path.join(source, FILES.journal), usage);
    await assert.rejects(readSource(source), /bounded regular file: usage/);
  }
});

test('migration client bounds responses, cancels refused bodies and never exposes them in errors', async () => {
  let cancelled = false;
  const request = client('https://backend.example', owner, async () => ({ ok: false, status: 409, body: { cancel: async () => { cancelled = true; } } }));
  await assert.rejects(request('profile'), error => error.message === 'Backend refused migration request: profile HTTP 409');
  assert.equal(cancelled, true);
  const invalid = client('https://backend.example', owner, async () => new Response('synthetic non-JSON response'));
  await assert.rejects(invalid('profile'), error => error.message === 'Backend returned invalid JSON');
  let finished = false;
  const large = client('https://backend.example', owner, async () => ({ ok: true, body: (async function* () {
    try { yield Buffer.alloc(1024 * 1024); yield Buffer.alloc(1024 * 1024 + 1); yield Buffer.from('must not read'); }
    finally { finished = true; }
  })() }));
  await assert.rejects(large('profile'), /Backend response exceeded limit/);
  assert.equal(finished, true, 'oversized response iterator is closed');
});

test('migration client restricts origins, credentials and record names and sends safe fetch options', async () => {
  let calls = 0, seen;
  const fetchStub = async (url, options) => { calls++; seen = { url, options }; return new Response('{"revision":0,"data":""}'); };
  for (const origin of ['http://backend.example', 'https://backend.example/path', 'https://user:pass@backend.example', 'https://backend.example/']) {
    assert.throws(() => client(origin, owner, fetchStub));
  }
  for (const token of ['short', owner + '\r\ninvalid', 'x'.repeat(1025)]) assert.throws(() => client('https://backend.example', token, fetchStub), /Invalid token/);
  const request = client('https://backend.example', owner, fetchStub);
  await assert.rejects(request('../state'), /Invalid content name/); assert.equal(calls, 0);
  await request('profile');
  assert.equal(seen.url, 'https://backend.example/api/private-content/profile');
  assert.equal(seen.options.method, 'GET'); assert.equal(seen.options.redirect, 'error');
  assert.equal(seen.options.credentials, 'omit'); assert.equal(seen.options.cache, 'no-store');
  assert.ok(seen.options.signal instanceof AbortSignal); assert.equal(seen.options.headers.Authorization, 'Bearer ' + owner);
  for (const origin of ['http://127.0.0.1:4318', 'http://localhost:4318', 'http://[::1]:4318']) assert.doesNotThrow(() => client(origin, owner, fetchStub));
});


test('the migration CLI is dry by default and prints only plan metadata', async t => {
  const api = await fixture(t), tokenFile = path.join(api.root, 'synthetic-token');
  await fs.writeFile(tokenFile, owner, { mode: 0o600 });
  const tool = fileURLToPath(new URL('../../migrate-private-content.mjs', import.meta.url));
  const result = await promisify(execFile)(process.execPath, [tool, '--source', api.source, '--url', api.base, '--token-file', tokenFile], { timeout: 10000 });
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.applied, false); assert.equal(plan.records.length, 4);
  assert.equal(result.stderr, ''); assert.equal(result.stdout.includes(owner), false);
  assert.equal(result.stdout.includes('Synthetic'), false); assert.equal(result.stdout.includes('保留'), false);
  for (const name of PRIVATE_CONTENT_NAMES) assert.equal(api.store.getPrivateContent(name).revision, 0);
});

test('a zero revision with unexpected backend data is refused before any writes', async () => {
  const source = sample(); let writes = 0;
  await assert.rejects(migrate(source, async (name, body) => {
    if (body) writes++;
    return { revision: 0, data: name === 'usage' ? source.usage : emptyPrivateContent(name) };
  }, { apply: true }), /revision zero contains data; refusing to overwrite: usage/);
  assert.equal(writes, 0);
});
