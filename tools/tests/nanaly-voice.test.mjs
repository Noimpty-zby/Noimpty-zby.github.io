import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync('source/js/nanaly-voice.js', 'utf8')
const boot = ({ key = 'offline-siliconflow-key', fetcher, autoplay = false, fastTimeout = false } = {}) => {
  const values = new Map([['nanaly-voice-v1', JSON.stringify({ autoplay })]])
  const requests = [], notices = [], audio = [], urls = new Set()
  let needed = 0, nextUrl = 0
  const window = { localStorage: { getItem: k => values.get(k), setItem: (k, v) => values.set(k, v) }, addEventListener() {} }
  class ObjectURL extends URL {
    static createObjectURL() { const value = 'blob:test-' + (++nextUrl); urls.add(value); return value }
    static revokeObjectURL(value) { urls.delete(value) }
  }
  const document = { hidden: false }, connection = { key, baseURL: 'https://api.siliconflow.cn/v1' }
  const clock = (fn, delay) => setTimeout(fn, fastTimeout && delay === 60000 ? 5 : delay)
  vm.runInNewContext(source, { window, document, URL: ObjectURL, AbortController, DOMException, setTimeout: clock, clearTimeout })
  const api = window.NANALY_VOICE
  const controller = api.create({ getConnection: () => connection,
    notify: text => notices.push(text), onNeedKey: () => needed++,
    fetcher: async (url, init) => { requests.push({ url, init }); return fetcher ? fetcher(url, init) : new Response(new Blob(['offline audio'], { type: 'audio/mpeg' }), { headers: { 'content-type': 'audio/mpeg' } }) },
    makeAudio: () => { const item = { paused: false, play: async () => {}, pause() { this.paused = true }, removeAttribute() {}, load() {} }; audio.push(item); return item }
  })
  return { api, controller, requests, notices, values, document, audio, urls, connection, needed: () => needed }
}
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)) }
let passed = 0
const test = async (name, fn) => { await fn(); passed++; console.log('  ✓ ' + name) }

await test('speech uses only the configured SiliconFlow key and documented CosyVoice parameters', async () => {
  const h = boot(), states = []
  h.controller.subscribe(state => states.push(state))
  const job = h.controller.speak('你好喵。[S1]', { id: 'reply1' })
  await flush()
  assert.equal(h.requests.length, 1)
  const { url, init } = h.requests[0], payload = JSON.parse(init.body)
  assert.equal(url, 'https://api.siliconflow.cn/v1/audio/speech')
  assert.equal(init.headers.Authorization, 'Bearer offline-siliconflow-key')
  assert.equal(payload.model, 'FunAudioLLM/CosyVoice2-0.5B')
  assert.equal(payload.voice, payload.model + ':diana')
  assert.ok(payload.input.includes('<|endofprompt|>你好喵。'))
  assert.equal(payload.response_format, 'mp3')
  assert.ok(states.some(state => state?.phase === 'loading'))
  assert.equal(h.controller.state().phase, 'playing')
  h.audio[0].onended()
  assert.equal(await job, true)
  assert.equal(h.controller.state(), null)
  assert.equal(h.urls.size, 0)
  assert.ok([...h.values.values()].every(value => !value.includes('offline-siliconflow-key')))
})
await test('replaying cached audio does not make a second paid request and lock clears it', async () => {
  const h = boot()
  const first = h.controller.speak('这是一条短回复', { id: 'one' }); await flush(); h.audio[0].onended(); await first
  const replay = h.controller.speak('这是一条短回复', { id: 'one' }); await flush()
  assert.equal(h.requests.length, 1)
  h.controller.stop({ clearCache: true }); assert.equal(await replay, false)
  const again = h.controller.speak('这是一条短回复', { id: 'one' }); await flush()
  assert.equal(h.requests.length, 2)
  h.controller.stop(); await again
  assert.equal(h.urls.size, 0)
})
await test('switching the configured account never reuses the prior account audio', async () => {
  const h = boot()
  const first = h.controller.speak('同一句测试', { id: 'one' }); await flush(); h.audio[0].onended(); await first
  h.connection.key = 'second-offline-account'
  const next = h.controller.speak('同一句测试', { id: 'two' }); await flush()
  assert.equal(h.requests.length, 2)
  assert.equal(h.requests[1].init.headers.Authorization, 'Bearer second-offline-account')
  h.controller.stop(); await next
  assert.ok([...h.values.values()].every(value => !value.includes('second-offline-account')))
})
await test('a network timeout is reported even when fetch returns a generic AbortError', async () => {
  const h = boot({ fastTimeout: true, fetcher: (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
  }) })
  assert.equal(await h.controller.speak('超时测试'), false)
  assert.ok(h.notices.some(text => /声音生成超时/.test(text)))
  assert.equal(h.controller.state(), null)
  assert.equal(h.audio.length, 0)
})
await test('a stopped request cannot play late audio or replace a newer reply', async () => {
  let resolve
  const h = boot({ fetcher: () => new Promise(r => { resolve = r }) })
  const job = h.controller.speak('延迟的声音', { id: 'late' }); await flush()
  h.controller.stop()
  assert.equal(h.requests[0].init.signal.aborted, true)
  resolve(new Response(new Blob(['audio']), { headers: { 'content-type': 'audio/mpeg' } }))
  assert.equal(await job, false)
  assert.equal(h.audio.length, 0)
  assert.equal(h.urls.size, 0)
})
await test('missing credentials and default autoplay never send a synthesis request', async () => {
  const h = boot({ key: '' })
  assert.equal(await h.controller.speak('你好', { automatic: true }), false)
  assert.equal(h.needed(), 0)
  assert.equal(await h.controller.speak('你好'), false)
  assert.equal(h.needed(), 1)
  assert.equal(h.requests.length, 0)
  h.controller.configure({ autoplay: true }); h.document.hidden = true
  assert.equal(await h.controller.speak('后台回复', { automatic: true }), false)
  assert.equal(h.requests.length, 0)
})
await test('service and audio format errors remain visible without attempting playback', async () => {
  for (const response of [new Response('{}', { status: 429 }), new Response('{}', { headers: { 'content-type': 'application/json' } })]) {
    const h = boot({ fetcher: async () => response })
    assert.equal(await h.controller.speak('测试'), false)
    assert.equal(h.audio.length, 0)
    assert.ok(h.notices.some(text => /朗读未完成/.test(text)))
  }
})
await test('long speech is split without losing content and unsafe endpoint credentials are rejected', () => {
  const h = boot(), original = '这是一个可爱又清晰的回答喵。'.repeat(80)
  const parts = h.api.splitText(original)
  assert.ok(parts.length > 1)
  assert.ok(parts.every(part => part.length <= 450))
  assert.equal(parts.join(''), original)
  assert.doesNotMatch(h.api.cleanText('**你好** [S2] [眯起眼睛] <|endofprompt|> ```js\nsecret\n```'), /S2|眯起|secret|endofprompt/)
  assert.throws(() => h.api.endpoint('https://user:pass@example.com'))
  assert.throws(() => h.api.endpoint('http://example.com'))
  assert.equal(h.api.normalize({ speed: 8, style: 'unknown' }).speed, 1.3)
})
console.log('\n' + passed + ' speech behavior groups passed')
