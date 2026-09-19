import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { webcrypto } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { SALT, ITER, encryptEnvelope } from '../site-crypto.cjs'

const repo = process.cwd()
const runScript = (name, hexo) => new Function('hexo', 'require', readFileSync(name, 'utf8'))(
  hexo, createRequire(resolve(name)))
const box = () => mkdtempSync(join(tmpdir(), 'blog-build-'))

await test('private envelopes decrypt in WebCrypto and reject tampering / absent secrets', async () => {
  const pass = 'test-only-暗号'
  const plain = JSON.stringify({ days: { '2026-09-19': [{ id: 'a', text: '私人任务' }] } })
  const wrapped = JSON.parse(encryptEnvelope(plain, pass))
  assert.ok(!JSON.stringify(wrapped).includes('私人任务'))
  const material = await webcrypto.subtle.importKey('raw', Buffer.from(pass), 'PBKDF2', false, ['deriveKey'])
  const key = await webcrypto.subtle.deriveKey({ name: 'PBKDF2', salt: Buffer.from(SALT), iterations: ITER, hash: 'SHA-256' },
    material, { name: 'AES-GCM', length: 256 }, false, ['decrypt'])
  const data = Buffer.from(wrapped.data, 'base64')
  const decrypt = () => webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: data.subarray(0, 12) }, key, data.subarray(12))
  assert.equal(Buffer.from(await decrypt()).toString(), plain)
  data[data.length - 1] ^= 1
  await assert.rejects(decrypt)
  assert.throws(() => encryptEnvelope(plain, ''), /暗号/)
})

await test('schedule generator never falls back to publishing plaintext or a destructive empty table', () => {
  const dir = box(), old = process.env.NOIMPTY_PASSPHRASE
  try {
    mkdirSync(join(dir, '_data'))
    let generate
    const hexo = { source_dir: dir, log: { warn() {} }, extend: { generator: { register: (_, fn) => { generate = fn } } } }
    runScript('scripts/noimpty-schedule.js', hexo)
    writeFileSync(join(dir, '_data/schedule.json'), '{"days":{"2026-09-19":[]}}')
    delete process.env.NOIMPTY_PASSPHRASE
    assert.deepEqual(generate(), [])
    process.env.NOIMPTY_PASSPHRASE = 'test-only'
    assert.equal(JSON.parse(generate().data).alg, 'AES-GCM')
    for (const raw of ['null', '[]', '{"days":[]}', '{"days":{"2026-09-19":null}}', '{invalid']) {
      writeFileSync(join(dir, '_data/schedule.json'), raw)
      assert.deepEqual(generate(), [], raw)
    }
  } finally {
    old === undefined ? delete process.env.NOIMPTY_PASSPHRASE : process.env.NOIMPTY_PASSPHRASE = old
    rmSync(dir, { recursive: true, force: true })
  }
})

await test('watch builds invalidate changed files and generated privacy-manifest fingerprints', () => {
  const dir = box()
  try {
    mkdirSync(join(dir, 'js'))
    const file = join(dir, 'js/app.js')
    writeFileSync(file, 'one')
    const filters = {}
    const hexo = { source_dir: dir, extend: { filter: { register: (name, fn) => { filters[name] = fn } } } }
    runScript('scripts/noimpty-asset-version.js', hexo)
    const html = '<script src="/js/app.js"></script><script src="/js/protected-manifest.js"></script>'
    hexo.__noimptyPrivacyVersion = 'a123'
    const first = filters['after_render:html'](html)
    writeFileSync(file, 'two')
    hexo.__noimptyPrivacyVersion = 'b234'
    filters.before_generate()
    const next = filters['after_render:html'](html)
    assert.notEqual(first, next)
    assert.notEqual(first.match(/app.js\?v=([^"]+)/)[1], next.match(/app.js\?v=([^"]+)/)[1])
    assert.match(next, /protected-manifest.js\?v=b234/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

await test('project subpath redirects contain the root exactly once', () => {
  let generate
  runScript('scripts/noimpty-redirects.js', { config: { root: '/blog/', url: 'https://example.invalid/blog' },
    extend: { generator: { register: (_, fn) => { generate = fn } } } })
  const output = generate()[0].data
  assert.match(output, /canonical" href="https:\/\/example.invalid\/blog\/2026\//)
  assert.doesNotMatch(output, /\/blog\/blog\//)
})

await test('invalid annotations cannot take down an otherwise valid page', () => {
  const dir = box()
  try {
    mkdirSync(join(dir, '_data'))
    writeFileSync(join(dir, '_data/nanaly-notes.json'), JSON.stringify({ '/post/': { notes: [null, {},
      { anchor: '这段文字足够长，用于测试坏批注', text: '<unsafe>' }] } }))
    const filters = {}
    runScript('scripts/noimpty-nanaly-notes.js', { source_dir: dir, log: { info() {} },
      extend: { filter: { register: (n, fn) => { filters[n] = fn } } } })
    const result = filters.after_post_render({ path: 'post/', content: '<p>这段文字足够长，用于测试坏批注</p>' })
    assert.match(result.content, /&lt;unsafe&gt;/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

await test('daily round continues after failures and still returns failure to Actions', () => {
  const workflow = readFileSync('.github/workflows/nanaly.yml', 'utf8')
  const block = workflow.match(/            failed=0[\s\S]*?            exit "\$failed"/)[0]
    .replace(/\$\{\{ steps.pick.outputs.dry \}\}/g, '')
  let output = ''
  try {
    execFileSync('bash', ['-e', '-c', `node() { echo "$2"; [ "$2" != patrol ]; };\n${block}`], { encoding: 'utf8' })
    assert.fail('failed round must exit nonzero')
  } catch (e) {
    assert.equal(e.status, 1)
    output = String(e.stdout)
  }
  assert.deepEqual(output.trim().split('\n'), ['patrol', 'notes', 'react'])
})
