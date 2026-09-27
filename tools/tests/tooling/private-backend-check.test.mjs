import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import yaml from 'js-yaml'

const script = fileURLToPath(new URL('../../checks/private-backend-check.mjs', import.meta.url))
const names = ['schedule', 'journal', 'profile', 'usage']
const marker = 'SYNTHETIC_PRIVATE_CONTENT_MUST_NOT_APPEAR'
const fixture = {
  schedule: { revision: 1, data: { days: {}, extension: marker } },
  journal: { revision: 2, data: { v: 1, entries: [{ ts: 1, who: 'test', what: marker }] } },
  profile: { revision: 3, data: marker },
  usage: { revision: 4, data: { v: 1, runs: [{ ts: 1, job: marker, tasks: { test: { calls: 1, hit: 0, miss: 0, out: 1 } } }] } }
}

// Exercise the actual CLI in an isolated process, with all network replaced.
// The stub rejects any new endpoint, write request, or unsafe fetch option.
function run({ env = {}, records = fixture, status = 200, failure, raw, oversized = false } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'private-backend-check-'))
  const requestsFile = join(directory, 'requests.json')
  try {
    const source = `
      import assert from 'node:assert/strict';
      import { writeFileSync } from 'node:fs';
      import { pathToFileURL } from 'node:url';
      const calls = [], records = ${JSON.stringify(records)};
      globalThis.fetch = async (url, options) => {
        const name = String(url).split('/').at(-1);
        calls.push({ name, method: options.method });
        assert.ok(${JSON.stringify(names)}.includes(name));
        assert.equal(url, 'https://private.example/api/automation/private-content/' + name);
        assert.equal(options.method, 'GET');
        assert.equal(options.body, undefined);
        assert.equal(options.headers.Authorization, 'Bearer SYNTHETIC_TOKEN');
        assert.equal(options.redirect, 'error');
        assert.equal(options.cache, 'no-store');
        assert.equal(options.credentials, 'omit');
        assert.ok(options.signal instanceof AbortSignal);
        if (${JSON.stringify(failure || '')}) throw new Error(${JSON.stringify(failure || '')});
        return ${oversized ? `new Response(JSON.stringify({ private: ${JSON.stringify(marker)}.repeat(40000) }))` : raw === undefined ? `Response.json(records[name], { status: ${status} })` : `new Response(${JSON.stringify(raw)}, { status: ${status} })`};
      };
      process.argv = [process.execPath, ${JSON.stringify(script)}];
      await import(pathToFileURL(process.argv[1]).href);
      writeFileSync(${JSON.stringify(requestsFile)}, JSON.stringify(calls));
    `
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
      cwd: directory, encoding: 'utf8', timeout: 5000,
      env: { ...process.env, NANALY_AGENT_URL: 'https://private.example', NANALY_AGENT_TOKEN: 'SYNTHETIC_TOKEN', NANALY_PRIVATE_TEST_MODE: '', NANALY_PRIVATE_TEST_DIR: '', ...env }
    })
    assert.equal(result.error, undefined)
    assert.equal(result.signal, null)
    // Only the test harness writes a request log. The CLI emits no artifacts.
    assert.deepEqual(readdirSync(directory), ['requests.json'])
    const calls = JSON.parse(readFileSync(requestsFile, 'utf8'))
    const output = result.stdout + result.stderr
    assert.doesNotMatch(output, /SYNTHETIC_PRIVATE|SYNTHETIC_TOKEN|private\.example|Bearer/)
    return { ...result, calls, output }
  } finally { rmSync(directory, { recursive: true, force: true }) }
}

test('readiness CLI validates all four migrated records using only bounded authenticated GETs', () => {
  const result = run()
  assert.equal(result.status, 0, result.output)
  assert.deepEqual(result.calls, names.map(name => ({ name, method: 'GET' })))
  assert.equal(result.stdout, 'Private backend ready: schedule, journal, profile, usage.\n')
  assert.equal(result.stderr, '')
})

test('missing secrets, unsafe origins, and offline fixtures fail before any request', async t => {
  for (const env of [
    { NANALY_AGENT_URL: '' },
    { NANALY_AGENT_TOKEN: '' },
    { NANALY_AGENT_TOKEN: '  ' },
    { NANALY_AGENT_URL: 'invalid SYNTHETIC_PRIVATE_URL' },
    { NANALY_AGENT_URL: 'http://127.0.0.1' },
    { NANALY_AGENT_URL: 'https://SYNTHETIC_TOKEN@private.example' },
    { NANALY_AGENT_URL: 'https://private.example/api?SYNTHETIC_PRIVATE_QUERY' },
    { NANALY_PRIVATE_TEST_MODE: '1', NANALY_PRIVATE_TEST_DIR: '/tmp/synthetic-fixture' }
  ]) await t.test(Object.keys(env).join(', '), () => {
    const result = run({ env })
    assert.equal(result.status, 1)
    assert.deepEqual(result.calls, [])
    assert.equal(result.stdout, '')
    assert.match(result.stderr, /^Private backend readiness failed\./)
  })
})

test('each unmigrated or invalid record fails the readiness check without logging content', async t => {
  for (const name of names) {
    await t.test(`${name}: not migrated`, () => {
      const records = structuredClone(fixture)
      records[name].revision = 0
      const result = run({ records })
      assert.equal(result.status, 1)
      assert.equal(result.stdout, '')
    })
    await t.test(`${name}: invalid schema`, () => {
      const records = structuredClone(fixture)
      records[name].data = { invalid: marker }
      const result = run({ records })
      assert.equal(result.status, 1)
      assert.equal(result.stdout, '')
    })
  }
})

test('authentication, connection, parsing, and response-size failures stay redacted', async t => {
  for (const [name, config] of [
    ['authentication', { status: 401 }],
    ['server error', { status: 503 }],
    ['connection', { failure: marker + ' SYNTHETIC_TOKEN' }],
    ['invalid JSON', { raw: marker }],
    ['oversized response', { oversized: true }]
  ]) await t.test(name, () => {
    const result = run(config)
    assert.equal(result.status, 1)
    assert.equal(result.stdout, '')
    assert.match(result.stderr, /^Private backend readiness failed\./)
  })
})

test('Pages isolates readiness secrets and failure from build artifacts and static deployment', () => {
  const workflow = yaml.load(readFileSync(new URL('../../../.github/workflows/pages.yml', import.meta.url), 'utf8'))
  const job = workflow.jobs['private-backend']
  assert.deepEqual(job.permissions, { contents: 'read' })
  assert.ok(job['timeout-minutes'] > 0 && job['timeout-minutes'] <= 3)
  assert.equal(job.steps.find(step => step.uses?.startsWith('actions/checkout@')).with['persist-credentials'], false)
  const check = job.steps.find(step => step.run === 'node tools/checks/private-backend-check.mjs')
  assert.deepEqual(check.env, {
    NANALY_AGENT_URL: '${{ secrets.NANALY_AGENT_URL }}',
    NANALY_AGENT_TOKEN: '${{ secrets.NANALY_AGENT_TOKEN }}'
  })
  assert.equal(job.steps.filter(step => step.run).length, 1)
  assert.doesNotMatch(JSON.stringify(job), /upload-artifact|upload-pages-artifact|npm |continue-on-error/)
  for (const [name, other] of Object.entries(workflow.jobs)) {
    if (name !== 'private-backend') assert.doesNotMatch(JSON.stringify(other), /NANALY_AGENT_URL|NANALY_AGENT_TOKEN|private-backend/)
  }
  assert.equal(workflow.jobs.deploy.needs, 'build')
})
