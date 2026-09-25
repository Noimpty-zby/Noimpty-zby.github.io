import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { vendorLive2D, validateRuntime, downloadCore } from '../../assets/vendor-live2d.mjs'

let passed = 0
const test = async (name, fn) => { await fn(); passed++; console.log('  ✓ ' + name) }
const core = '/* Redistributable Code */ var Live2DCubismCore = {};'
const pixi = 'var PIXI = {};'
const display = 'PIXI.Live2DModel = function () {};'
const root = mkdtempSync(join(tmpdir(), 'vendor-live2d-'))
const write = (path, value) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), value) }
const out = name => join(root, 'source/lib/l2d', name)
const snapshot = () => Object.fromEntries(readdirSync(dirname(out('x'))).sort().map(name => [name, readFileSync(out(name), 'utf8')]))
const setup = ({ cached = core } = {}) => {
  rmSync(root, { recursive: true, force: true })
  write('node_modules/pixi.js/package.json', JSON.stringify({ version: '7.4.3' }))
  write('node_modules/pixi.js/dist/pixi.min.js', pixi)
  write('node_modules/pixi-live2d-display-lipsyncpatch/package.json', JSON.stringify({ version: '0.5.0' }))
  write('node_modules/pixi-live2d-display-lipsyncpatch/dist/cubism4.min.js', display)
  write('node_modules/pixi-live2d-display-lipsyncpatch/LICENSE', 'MIT License')
  if (cached !== null) write('source/lib/l2d/cubismcore.min.js', cached)
  write('source/lib/l2d/pixi.min.js', 'existing pixi')
  write('source/lib/l2d/live2d-display.min.js', 'existing display')
  write('source/lib/l2d/LICENSE-live2d-display', 'existing license')
}
const offline = () => { throw new Error('test must not access the network') }
const run = options => vendorLive2D({ root, fetchImpl: offline, log: () => {}, ...options })

try {
  await test('valid cache is checked and all installed dependencies are copied without fetching', async () => {
    setup(); await run()
    assert.deepEqual(snapshot(), { 'LICENSE-live2d-display': 'MIT License', 'cubismcore.min.js': core, 'live2d-display.min.js': display, 'pixi.min.js': pixi })
    assert.deepEqual(readdirSync(join(root, 'source/lib')), ['l2d'])
  })
  await test('corrupt, truncated and foreign-URL caches fail without touching existing files', async () => {
    for (const cached of ['<html>bad gateway</html>', core + 'function broken(', core + ';fetch("https://unconfirmed.test/x")']) {
      setup({ cached }); const before = snapshot()
      await assert.rejects(run()); assert.deepEqual(snapshot(), before)
    }
  })
  await test('all local files are validated before fetch or destination writes', async () => {
    for (const [path, value] of [
      ['node_modules/pixi.js/dist/pixi.min.js', pixi + ';fetch("https://pixijs.com.evil.test/x")'],
      ['node_modules/pixi-live2d-display-lipsyncpatch/dist/cubism4.min.js', display + '('],
      ['node_modules/pixi-live2d-display-lipsyncpatch/LICENSE', ''],
      ['node_modules/pixi.js/package.json', '{']
    ]) {
      setup({ cached: null }); write(path, value); const before = snapshot(); let fetched = false
      await assert.rejects(run({ fetchImpl: () => { fetched = true; return new Response(core) } }))
      assert.equal(fetched, false); assert.deepEqual(snapshot(), before)
    }
  })
  await test('URL allowlist compares origins, excluding credentials, fake suffix hosts and ports', () => {
    for (const url of ['https://pixijs.com.evil.test/x', 'http://localhost.evil.test', 'https://pixijs.com:8443/x', 'https://pixijs.com@evil.test/x']) {
      assert.throws(() => validateRuntime('pixi.min.js', pixi + ';fetch(' + JSON.stringify(url) + ')'), /外部地址/)
    }
    assert.doesNotThrow(() => validateRuntime('pixi.min.js', pixi + ';/* https://pixijs.com http://www.w3.org/2000/svg */'))
  })
  await test('invalid fresh downloads and HTTP failures preserve every existing file', async () => {
    for (const fetchImpl of [async () => new Response('<html>no</html>'), async () => new Response('no', { status: 503 })]) {
      setup({ cached: null }); const before = snapshot()
      await assert.rejects(run({ fetchImpl })); assert.deepEqual(snapshot(), before)
    }
  })
  await test('valid fresh download is written only after all checks pass', async () => {
    setup({ cached: null }); let count = 0
    await run({ fetchImpl: async (_, options) => { count++; assert.ok(options.signal instanceof AbortSignal); return new Response(core) } })
    assert.equal(count, 1); assert.equal(readFileSync(out('cubismcore.min.js'), 'utf8'), core)
  })
  await test('timeout aborts a fetch that never resolves', async () => {
    let signal
    await assert.rejects(downloadCore((_, options) => { signal = options.signal; return new Promise(() => {}) }, 20), /超时/)
    assert.equal(signal.aborted, true)
  })
  await test('timeout covers a stalled response body and cancels its reader', async () => {
    let cancelled = false
    const body = new ReadableStream({ cancel() { cancelled = true } })
    await assert.rejects(downloadCore(async () => new Response(body), 20), /超时/)
    assert.equal(cancelled, true)
  })
  await test('oversized bodies are stopped before whole-response allocation', async () => {
    let pulls = 0, cancelled = false
    const body = new ReadableStream({ pull(controller) { pulls++; controller.enqueue(new Uint8Array(1024 * 1024)) }, cancel() { cancelled = true } })
    await assert.rejects(downloadCore(async () => new Response(body)), /8 MB/)
    assert.equal(cancelled, true); assert.ok(pulls <= 10)
  })
  await test('oversized Content-Length cancels before reading and empty responses fail', async () => {
    let cancelled = false
    const body = new ReadableStream({ cancel() { cancelled = true } })
    await assert.rejects(downloadCore(async () => new Response(body, { headers: { 'content-length': String(9 * 1024 * 1024) } })), /8 MB/)
    assert.equal(cancelled, true)
    await assert.rejects(downloadCore(async () => new Response(null)), /为空/)
  })
  await test('the actual checked-in runtimes pass validation without execution or writes', () => {
    for (const name of ['cubismcore.min.js', 'pixi.min.js', 'live2d-display.min.js']) {
      const source = readFileSync(new URL('../../../source/lib/l2d/' + name, import.meta.url), 'utf8')
      assert.doesNotThrow(() => validateRuntime(name, source))
    }
  })
} finally { rmSync(root, { recursive: true, force: true }) }
console.log(`\n${passed} Live2D vendor regression cases passed`)
