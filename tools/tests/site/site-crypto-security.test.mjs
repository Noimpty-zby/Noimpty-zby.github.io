import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { webcrypto, createHash, pbkdf2Sync, randomBytes, createCipheriv } from 'node:crypto'
import vm from 'node:vm'
import { encryptEnvelope } from '../../site-crypto.cjs'

const PASS = 'offline-test-only: correct horse 河流'
const gateSource = readFileSync('source/js/privacy-gate.js', 'utf8')
const searchSource = readFileSync('source/js/noimpty-search.js', 'utf8')
const buildSource = readFileSync('scripts/noimpty-lockdown.js', 'utf8')
const manifest = pass => {
  const generators = new Map(), filters = [], warnings = []
  const hexo = { config: { root: '/' }, log: { warn: message => warnings.push(message) },
    extend: { generator: { register: (name, fn) => generators.set(name, fn) }, filter: { register: (...args) => filters.push(args) } } }
  vm.runInNewContext(buildSource, { hexo, require: createRequire(resolve('scripts/noimpty-lockdown.js')),
    process: { env: pass ? { NOIMPTY_PASSPHRASE: pass } : {} } })
  const result = generators.get('noimpty-privacy-manifest')({ posts: [], pages: [], categories: [], tags: [] })
  const context = { window: {} }
  vm.runInNewContext(result.data, context)
  return { value: JSON.parse(JSON.stringify(context.window.NOIMPTY_PRIVACY)), raw: result.data, warnings, filters }
}
const current = manifest(PASS)
const storage = initial => {
  const values = new Map(Object.entries(initial || {}))
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key), dump: () => Object.fromEntries(values) }
}
const element = () => ({
  dataset: {}, classList: { add() {}, remove() {} }, listeners: new Map(), nodes: new Map(),
  addEventListener(type, fn) { this.listeners.set(type, fn) },
  querySelector(selector) { if (!this.nodes.has(selector)) this.nodes.set(selector, element()); return this.nodes.get(selector) },
  focus() {}, select() {}, remove() {}, textContent: '', disabled: false, value: ''
})
const boot = (privacy = current.value, session = {}) => {
  let gate
  const document = { readyState: 'complete', documentElement: element(), querySelector: () => null,
    querySelectorAll: () => [], createElement: () => element(), addEventListener() {},
    body: { appendChild: node => { gate = node } } }
  const window = { NOIMPTY_PRIVACY: privacy, sessionStorage: storage(session), crypto: webcrypto,
    location: { origin: 'https://blog.test', pathname: '/private/', reload() {} },
    addEventListener() {}, setTimeout: () => 0, fetch: () => { throw new Error('Unexpected network request') } }
  const context = vm.createContext({ window, document, crypto: webcrypto, TextEncoder, TextDecoder, atob, URL,
    Response, AbortController, setTimeout, clearTimeout })
  vm.runInContext(gateSource, context)
  return { window, context, gate, submit: async pass => {
    gate.querySelector('.noimpty-gate__input').value = pass
    await gate.querySelector('.noimpty-gate__form').listeners.get('submit')({ preventDefault() {} })
  } }
}

await test('builds publish randomized slow verification envelopes without a password digest', () => {
  const next = manifest(PASS)
  const a = current.value.unlock, b = next.value.unlock
  assert.notEqual(a.id, b.id)
  assert.notEqual(a.envelope.salt, b.envelope.salt)
  assert.notEqual(a.envelope.data, b.envelope.data)
  assert.equal(a.envelope.v, 2)
  assert.ok(a.envelope.iterations >= 600000)
  assert.equal(Buffer.from(a.envelope.salt, 'base64').length, 16)
  assert.equal(Object.hasOwn(current.value, 'passHash'), false)
  assert.ok(!current.raw.includes(PASS))
  assert.ok(!current.raw.includes(createHash('sha256').update(PASS).digest('hex')))
})

await test('gate authenticates before search loads; its session then decrypts a v2 search envelope', async () => {
  const app = boot()
  assert.equal(app.window.NOIMPTY_SEARCH, undefined)
  await app.submit(PASS)
  assert.equal(app.window.NOIMPTY_GATE.unlocked(), true)
  assert.equal(app.window.NOIMPTY_GATE.passphrase(), PASS)
  assert.equal(app.window.sessionStorage.getItem('noimpty-private-version'), current.value.unlock.id)
  vm.runInContext(searchSource, app.context)
  const envelope = JSON.parse(encryptEnvelope('offline private index 文本', PASS))
  assert.equal(await app.window.NOIMPTY_SEARCH.decryptPayload(envelope), 'offline private index 文本')
  const restored = boot(current.value, app.window.sessionStorage.dump())
  assert.equal(restored.window.NOIMPTY_GATE.unlocked(), true)
})

await test('wrong passwords, tampered authentication and a substituted session id never unlock', async () => {
  const wrong = boot()
  await wrong.submit(PASS + '-wrong')
  assert.equal(wrong.window.NOIMPTY_GATE.unlocked(), false)
  assert.equal(wrong.window.sessionStorage.getItem('noimpty-private-pass'), null)
  assert.match(wrong.gate.querySelector('.noimpty-gate__error').textContent, /输入错误/)
  const modified = structuredClone(current.value)
  const bytes = Buffer.from(modified.unlock.envelope.data, 'base64')
  bytes[bytes.length - 1] ^= 1
  modified.unlock.envelope.data = bytes.toString('base64')
  const tampered = boot(modified)
  await tampered.submit(PASS)
  assert.equal(tampered.window.NOIMPTY_GATE.unlocked(), false)
  const idChanged = structuredClone(current.value)
  idChanged.unlock.id = '0'.repeat(32)
  const swapped = boot(idChanged)
  await swapped.submit(PASS)
  assert.equal(swapped.window.NOIMPTY_GATE.unlocked(), false)
})

await test('a new build invalidates prior sessions and an unconfigured build has no fallback unlock', async () => {
  const oldSession = { 'noimpty-private-unlocked': 'true', 'noimpty-private-pass': PASS,
    'noimpty-private-version': current.value.unlock.id }
  const rotated = boot(manifest(PASS).value, oldSession)
  assert.equal(rotated.window.NOIMPTY_GATE.unlocked(), false)
  assert.equal(rotated.window.NOIMPTY_GATE.passphrase(), '')
  const absent = manifest('')
  assert.equal(absent.value.unlock, null)
  assert.equal(absent.value.searchEncrypted, false)
  for (const config of [absent.value, undefined]) {
    const app = boot(config === undefined ? {} : config, oldSession)
    await app.submit(PASS)
    assert.equal(app.window.NOIMPTY_GATE.unlocked(), false)
    assert.equal(app.window.NOIMPTY_GATE.passphrase(), '')
    assert.equal(app.gate.querySelector('.noimpty-gate__input').disabled, true)
    assert.equal(app.gate.querySelector('.noimpty-gate__button').disabled, true)
    assert.match(app.gate.querySelector('.noimpty-gate__error').textContent, /未配置有效暗号/)
  }
})

await test('browser decryptor rejects invalid KDF parameters, malformed envelopes and wrong keys', async () => {
  const app = boot()
  await app.submit(PASS)
  vm.runInContext(searchSource, app.context)
  const decrypt = app.window.NOIMPTY_SEARCH.decryptPayload
  const envelope = JSON.parse(encryptEnvelope('authenticated content', PASS))
  for (const invalid of [null, {}, { ...envelope, v: 3 }, { ...envelope, iterations: 1 },
    { ...envelope, iterations: 600000000 }, { ...envelope, salt: 'AAAA' }, { ...envelope, data: '!' },
    { ...envelope, kdf: 'unknown' }]) await assert.rejects(decrypt(invalid), /SEARCH_BAD_FORMAT/)
  const bytes = Buffer.from(envelope.data, 'base64'); bytes[0] ^= 1
  await assert.rejects(decrypt({ ...envelope, data: bytes.toString('base64') }), /SEARCH_BAD_KEY/)
  await assert.rejects(decrypt(JSON.parse(encryptEnvelope('wrong key', PASS + '-wrong'))), /SEARCH_BAD_KEY/)
})

await test('old v1 ciphertext remains readable but is never accepted as a gate verification envelope', async () => {
  const iv = randomBytes(12)
  const key = pbkdf2Sync(PASS, 'noimpty-search-v1', 120000, 32, 'sha256')
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const body = Buffer.concat([cipher.update('legacy content'), cipher.final()])
  const old = { v: 1, alg: 'AES-GCM', kdf: 'PBKDF2-SHA256/120000', data: Buffer.concat([iv, body, cipher.getAuthTag()]).toString('base64') }
  const app = boot()
  await app.submit(PASS)
  vm.runInContext(searchSource, app.context)
  assert.equal(await app.window.NOIMPTY_SEARCH.decryptPayload(old), 'legacy content')
  const legacyGate = boot({ ...current.value, unlock: { id: current.value.unlock.id, envelope: old } })
  await legacyGate.submit(PASS)
  assert.equal(legacyGate.window.NOIMPTY_GATE.unlocked(), false)
})

await test('static journal publication only removes an old route and never reads private source data', () => {
  const removed = [], routes = new Map([['nanaly-journal.json', 'stale artifact']])
  const registered = []
  const hexo = { config: {}, extend: { generator: { register() {} }, filter: { register: (...args) => registered.push(args) } },
    route: { get: key => routes.get(key), remove: key => { removed.push(key); routes.delete(key) } }, log: { warn() {} } }
  vm.runInNewContext(buildSource, { hexo, require: createRequire(resolve('scripts/noimpty-lockdown.js')), process: { env: {} } })
  // The first after_generate belongs to search and returns early without search.path.
  for (const [name, fn] of registered) if (name === 'after_generate') fn()
  assert.ok(removed.includes('nanaly-journal.json'))
  assert.equal(routes.has('nanaly-journal.json'), false)
})
