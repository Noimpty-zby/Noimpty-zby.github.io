import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createPrivateContentClient, initializePrivateContent, readPrivateContent } from '../../private-content-client.mjs'
import { emptyPrivateContent, PRIVATE_CONTENT_NAMES } from '../../../server/lib/private-content.mjs'
import { privateFixture } from '../private-fixture.mjs'
import { note, digest, commitJournal } from '../../nanaly/journal.mjs'
import { profileInterests, newsSystem } from '../../nanaly/news.mjs'

function memoryBackend() {
  const values = Object.fromEntries(PRIVATE_CONTENT_NAMES.map(name => [name, { revision: 1, data: emptyPrivateContent(name) }]))
  let puts = 0, conflictCount = 0
  return {
    values, get puts() { return puts }, get conflicts() { return conflictCount },
    async get(name) { return structuredClone(values[name]) },
    async put(name, revision, data) {
      puts++
      if (values[name].revision !== revision) { conflictCount++; throw Object.assign(new Error('synthetic conflict'), { status: 409 }) }
      values[name] = { revision: revision + 1, data: structuredClone(data) }
      return structuredClone(values[name])
    }
  }
}
const entry = id => ({ id, ts: Date.now(), at: '9-27 12:00', who: 'synthetic', what: id })
const usage = id => ({ id, ts: Date.now(), at: '9-27 12:00', job: 'synthetic', tasks: { test: { calls: 1, hit: 0, miss: 2, out: 3 } } })

test('concurrent journal and usage appends retry CAS without losing or duplicating records', async () => {
  const transport = memoryBackend()
  const a = createPrivateContentClient({ transport }), b = createPrivateContentClient({ transport })
  await Promise.all([a.initialize(), b.initialize()])
  for (const name of ['journal', 'usage']) {
    const make = name === 'journal' ? entry : usage
    a.append(name, make('a')); b.append(name, make('b'))
    await Promise.all([a.flush(name), b.flush(name)])
    const rows = transport.values[name].data[name === 'journal' ? 'entries' : 'runs']
    assert.deepEqual(rows.map(row => row.id).sort(), ['a', 'b'])
    const count = transport.puts
    assert.equal(await a.flush(name), false)
    assert.equal(transport.puts, count)
  }
  assert.ok(transport.conflicts >= 2)
})

test('an ambiguous network result does not duplicate an already stored append on retry', async () => {
  const backend = memoryBackend(); let failOnce = true
  const transport = { get: name => backend.get(name), async put(...args) { const saved = await backend.put(...args); if (failOnce) { failOnce = false; throw new Error('synthetic connection lost after save') } return saved } }
  const client = createPrivateContentClient({ transport }); await client.initialize()
  client.append('journal', entry('one'))
  await assert.rejects(client.flush('journal'), /connection lost/)
  await client.flush('journal')
  assert.deepEqual(backend.values.journal.data.entries.map(row => row.id), ['one'])
})

test('schedule CAS conflict preserves owner edits and refreshes the local view', async () => {
  const transport = memoryBackend(), client = createPrivateContentClient({ transport }); await client.initialize()
  const local = { days: {}, privateExtension: 'local pending' }, owner = { days: {}, privateExtension: 'owner change' }
  client.replace('schedule', local)
  await transport.put('schedule', 1, owner)
  await assert.rejects(client.flush('schedule'), { status: 409 })
  assert.deepEqual(transport.values.schedule.data, owner)
  assert.deepEqual(client.read('schedule'), owner)
})

test('schedule replacements during a pending save retain the latest data and use its acknowledged revision', async () => {
  for (const queueNextSave of [false, true]) {
    const backend = memoryBackend(), started = Promise.withResolvers(), release = Promise.withResolvers(), writes = []
    const transport = { get: name => backend.get(name), async put(name, revision, data) {
      writes.push({ revision, data: structuredClone(data) })
      const saved = await backend.put(name, revision, data)
      if (writes.length === 1) { started.resolve(); await release.promise }
      return saved
    } }
    const client = createPrivateContentClient({ transport }); await client.initialize()
    const first = { days: {}, privateExtension: 'first' }, latest = { days: {}, privateExtension: 'latest' }
    client.replace('schedule', first)
    const saving = client.flush('schedule'); await started.promise
    client.replace('schedule', { days: {}, privateExtension: 'intermediate' })
    client.replace('schedule', latest)
    const queued = queueNextSave ? client.flush('schedule') : null
    release.resolve()
    assert.equal(await saving, true)
    assert.deepEqual(client.read('schedule'), latest)
    assert.equal(await (queued || client.flush('schedule')), true)
    assert.deepEqual(writes, [{ revision: 1, data: first }, { revision: 2, data: latest }])
    assert.deepEqual(backend.values.schedule, { revision: 3, data: latest })
    assert.equal(await client.flush('schedule'), false)
  }
})

test('a pending schedule conflict cancels queued replacements instead of overwriting owner data', async () => {
  const backend = memoryBackend(), started = Promise.withResolvers(), release = Promise.withResolvers()
  let attempts = 0
  const transport = { get: name => backend.get(name), async put(...args) {
    attempts++; started.resolve(); await release.promise
    return backend.put(...args)
  } }
  const client = createPrivateContentClient({ transport }); await client.initialize()
  client.replace('schedule', { days: {}, privateExtension: 'first' })
  const saving = client.flush('schedule'); await started.promise
  const owner = { days: {}, privateExtension: 'owner change' }
  await backend.put('schedule', 1, owner)
  client.replace('schedule', { days: {}, privateExtension: 'newer local change' })
  const queued = client.flush('schedule')
  const rejected = assert.rejects(saving, { status: 409 })
  release.resolve()
  await rejected
  assert.equal(await queued, false)
  assert.equal(attempts, 1)
  assert.deepEqual(client.read('schedule'), owner)
  assert.deepEqual(backend.values.schedule, { revision: 2, data: owner })
})

test('initialization rejects unmigrated or corrupt content and never exposes a partial mirror', async () => {
  for (const invalid of [{ revision: 0, data: { days: {} } }, { revision: 1, data: { days: null } }]) {
    const transport = memoryBackend(); transport.values.schedule = invalid
    const client = createPrivateContentClient({ transport })
    await assert.rejects(client.initialize())
    assert.throws(() => client.read('journal'), /尚未加载/)
    assert.equal(transport.puts, 0)
  }
})

test('private journal defaults to private and public summaries require explicit permission', async () => {
  const fixture = await privateFixture({ journal: { v: 1, entries: [{ ...entry('SYNTHETIC_PUBLIC'), publicAllowed: true }, entry('SYNTHETIC_SECRET')] } })
  const before = console.log, logs = []; console.log = (...values) => logs.push(values.join(' '))
  try {
    note('synthetic', 'SYNTHETIC_NEW_PRIVATE')
    assert.match(digest(), /SYNTHETIC_PUBLIC/)
    assert.doesNotMatch(digest(), /SYNTHETIC_SECRET|SYNTHETIC_NEW_PRIVATE/)
    assert.match(digest({ private: true }), /SYNTHETIC_SECRET/)
    await commitJournal()
    assert.equal(fixture.read('journal').data.entries.at(-1).publicAllowed, undefined)
    assert.doesNotMatch(logs.join('\n'), /SYNTHETIC_NEW_PRIVATE/)
  } finally { console.log = before; fixture.close() }
})

test('public news prompts contain fixed interests only, never private profile free text', () => {
  const secret = 'SYNTHETIC_ADDRESS phone=123456 personal circumstance; I study Linux and Go, backend 后端.'
  assert.deepEqual(profileInterests(secret), ['Linux', 'Go', '后端'])
  const system = newsSystem(secret)
  assert.doesNotMatch(system, /SYNTHETIC_ADDRESS|123456|personal circumstance/)
  assert.match(system, /Linux、Go、后端/)
})

test('missing private backend configuration stops both CLI entrypoints before network or writes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'nanaly-no-config-'))
  try {
    for (const route of ['../../nanaly/run.mjs', '../../daily-report/run.mjs']) {
      const entryUrl = new URL(route, import.meta.url).href
      const source = `globalThis.fetch=async()=>{throw new Error('UNEXPECTED_NETWORK')}; await import(${JSON.stringify(entryUrl)});`
      const env = { ...process.env, NANALY_AGENT_URL: '', NANALY_AGENT_TOKEN: '', NANALY_PRIVATE_TEST_DIR: '', NANALY_PRIVATE_TEST_MODE: '' }
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], { cwd: directory, env, encoding: 'utf8', timeout: 5000 })
      assert.equal(result.status, 1)
      assert.match(result.stderr, /缺少私密后端配置/)
      assert.doesNotMatch(result.stderr + result.stdout, /UNEXPECTED_NETWORK/)
    }
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('offline storage requires explicit test mode and refuses a directory inside the repository', async () => {
  const before = { mode: process.env.NANALY_PRIVATE_TEST_MODE, dir: process.env.NANALY_PRIVATE_TEST_DIR }
  try {
    process.env.NANALY_PRIVATE_TEST_DIR = process.cwd(); process.env.NANALY_PRIVATE_TEST_MODE = '1'
    await assert.rejects(initializePrivateContent({ force: true }), /仓库之外/)
    process.env.NANALY_PRIVATE_TEST_MODE = ''
    await assert.rejects(initializePrivateContent({ force: true }), /显式启用/)
  } finally {
    before.mode === undefined ? delete process.env.NANALY_PRIVATE_TEST_MODE : process.env.NANALY_PRIVATE_TEST_MODE = before.mode
    before.dir === undefined ? delete process.env.NANALY_PRIVATE_TEST_DIR : process.env.NANALY_PRIVATE_TEST_DIR = before.dir
  }
})

test('failed shared initialization can retry and simultaneous callers share one authenticated load', async () => {
  const saved = { mode: process.env.NANALY_PRIVATE_TEST_MODE, directory: process.env.NANALY_PRIVATE_TEST_DIR, url: process.env.NANALY_AGENT_URL, token: process.env.NANALY_AGENT_TOKEN, fetch: globalThis.fetch }
  let calls = 0, failFirst = true
  try {
    delete process.env.NANALY_PRIVATE_TEST_MODE; delete process.env.NANALY_PRIVATE_TEST_DIR
    process.env.NANALY_AGENT_URL = 'https://private.example'
    process.env.NANALY_AGENT_TOKEN = 'offline-fixture-token'
    globalThis.fetch = async (url, init) => {
      calls++
      assert.ok(url.startsWith('https://private.example/api/automation/private-content/'))
      assert.equal(init.headers.Authorization, 'Bearer offline-fixture-token')
      assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'no-store'); assert.equal(init.method, 'GET')
      if (failFirst) return Response.json({ error: 'SYNTHETIC_PRIVATE_FAILURE' }, { status: 503 })
      const name = url.split('/').at(-1)
      return Response.json({ revision: 1, data: emptyPrivateContent(name) })
    }
    await assert.rejects(initializePrivateContent({ force: true }), error => { assert.doesNotMatch(String(error), /SYNTHETIC_PRIVATE_FAILURE/); return true })
    assert.throws(() => readPrivateContent('schedule'), /尚未加载/)
    failFirst = false; calls = 0
    await Promise.all([initializePrivateContent(), initializePrivateContent()])
    assert.equal(calls, 4)
    assert.deepEqual(readPrivateContent('schedule'), { days: {} })
  } finally {
    for (const [key, value] of [['NANALY_PRIVATE_TEST_MODE', saved.mode], ['NANALY_PRIVATE_TEST_DIR', saved.directory], ['NANALY_AGENT_URL', saved.url], ['NANALY_AGENT_TOKEN', saved.token]]) value === undefined ? delete process.env[key] : process.env[key] = value
    globalThis.fetch = saved.fetch
  }
})
