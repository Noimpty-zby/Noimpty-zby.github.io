import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync('source/js/nanaly-voice.js', 'utf8')
const audioSource = readFileSync('source/js/nanaly-audio.js', 'utf8')
const prosodySource = readFileSync('source/js/nanaly-prosody.js', 'utf8')
const providerSource = readFileSync('source/js/nanaly-provider.js', 'utf8')
const wave = () => {
  const bytes = Buffer.alloc(44 + 4800)
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8)
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(24000, 24); bytes.writeUInt32LE(48000, 28)
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(4800, 40)
  // The final sample is voiced: padding must keep it intact, not fade it away.
  for (let i = 44; i < bytes.length; i += 2) bytes.writeInt16LE(1234, i)
  return new Blob([bytes], { type: 'audio/wav' })
}
const boot = ({ key = 'offline-siliconflow-key', fetcher, autoplay = false, emotion = false, fastTimeout = false, manualDrain = false } = {}) => {
  const values = new Map([['nanaly-voice-v1', JSON.stringify({ autoplay, emotion })]])
  const requests = [], notices = [], audio = [], blobs = [], usages = [], urls = new Set(), drains = new Map()
  let needed = 0, nextUrl = 0
  const window = { localStorage: { getItem: k => values.get(k), setItem: (k, v) => values.set(k, v) }, addEventListener() {} }
  class ObjectURL extends URL {
    static createObjectURL(blob) { blobs.push(blob); const value = 'blob:test-' + (++nextUrl); urls.add(value); return value }
    static revokeObjectURL(value) { urls.delete(value) }
  }
  const document = { hidden: false }, connection = { key, baseURL: 'https://api.siliconflow.cn/v1', model: 'Pro/moonshotai/Kimi-K2.6' }
  const clock = (fn, delay) => {
    if (manualDrain && delay === 500) { const id = {}; drains.set(id, fn); return id }
    return setTimeout(fn, fastTimeout && [30000, 60000].includes(delay) ? 5 : delay)
  }
  const cancelTimer = id => { if (!drains.delete(id)) clearTimeout(id) }
  vm.runInNewContext(audioSource + ';\n' + providerSource + ';\n' + prosodySource + ';\n' + source, { window, document, Blob, URL: ObjectURL, AbortController, DOMException, setTimeout: clock, clearTimeout: cancelTimer })
  const api = window.NANALY_VOICE
  const controller = api.create({ getConnection: () => connection,
    notify: text => notices.push(text), onNeedKey: () => needed++, onUsage: usage => usages.push(usage),
    fetcher: async (url, init) => { requests.push({ url, init }); return fetcher ? fetcher(url, init) : new Response(wave(), { headers: { 'content-type': 'audio/wav' } }) },
    makeAudio: () => { const item = { paused: false, events: [], play: async () => { item.events.push('play') }, pause() { this.events.push('pause'); this.paused = true }, removeAttribute() { this.events.push('remove') }, load() { this.events.push('load') } }; audio.push(item); return item }
  })
  return { api, planner: window.NANALY_PROSODY, controller, requests, notices, values, document, audio, urls, blobs, drains, usages, connection, needed: () => needed,
    drain: async () => { for (const [id, fn] of [...drains]) { drains.delete(id); fn() }; await flush() } }
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
  assert.equal(payload.response_format, 'wav')
  assert.equal(payload.sample_rate, 24000)
  const rendered = new DataView(await h.blobs[0].arrayBuffer())
  assert.equal(rendered.getInt16(44 + 4798, true), 1234, 'the final voiced sample survives unchanged')
  assert.equal(rendered.getUint32(40, true), 4800 + 16800, '350ms silence follows all original speech')
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
await test('natural completion drains without resetting the player or releasing its URL immediately', async () => {
  const h = boot({ manualDrain: true })
  let done = false
  const job = h.controller.speak('最后一个字也要读完喵').then(value => { done = true; return value })
  await flush()
  assert.match(JSON.parse(h.requests[0].init.body).input, /最后一个字也要读完喵。$/)
  h.audio[0].onended(); h.audio[0].onended(); await flush()
  assert.equal(done, false)
  assert.equal(h.drains.size, 1)
  assert.equal(h.urls.size, 1)
  assert.deepEqual(h.audio[0].events, ['play'])
  await h.drain()
  assert.equal(await job, true)
  assert.deepEqual(h.audio[0].events, ['play'], 'natural completion never resets the decoder')
  assert.equal(h.urls.size, 0)
})
await test('stop during end-drain cleans once and stale completion cannot disturb newer audio', async () => {
  const h = boot({ manualDrain: true })
  const first = h.controller.speak('第一句喵', { id: 'first' }); await flush()
  h.audio[0].onended()
  const staleTimer = [...h.drains.values()][0]
  h.controller.stop()
  assert.equal(await first, false)
  assert.deepEqual(h.audio[0].events, ['play', 'pause', 'remove', 'load'])
  assert.equal(h.drains.size, 0)
  assert.equal(h.urls.size, 0)
  const next = h.controller.speak('第二句喵', { id: 'next' }); await flush()
  staleTimer()
  assert.equal(h.controller.state().id, 'next')
  assert.deepEqual(h.audio[1].events, ['play'])
  h.controller.stop(); assert.equal(await next, false)
})
await test('automatic replies do not interrupt an existing manual reading', async () => {
  const h = boot({ autoplay: true })
  const first = h.controller.speak('我还没有读完喵', { id: 'manual' }); await flush()
  assert.equal(await h.controller.speak('新回复', { id: 'auto', automatic: true }), false)
  assert.equal(h.requests.length, 1)
  assert.equal(h.controller.state().id, 'manual')
  assert.deepEqual(h.audio[0].events, ['play'])
  h.controller.stop(); assert.equal(await first, false)
})
await test('long reading waits for each segment tail before starting the next segment', async () => {
  const h = boot({ manualDrain: true }), text = '完整读完每一句话喵。'.repeat(50)
  const parts = h.api.splitText(text)
  assert.equal(parts.length, 2)
  const job = h.controller.speak(text); await flush()
  h.audio[0].onended(); await flush()
  assert.equal(h.requests.length, 1)
  await h.drain()
  assert.equal(h.requests.length, 2)
  assert.equal(h.audio.length, 2)
  h.audio[1].onended(); await h.drain()
  assert.equal(await job, true)
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
const audioResponse = () => new Response(wave(), { headers: { 'content-type': 'audio/wav' } })
const plannedResponse = (prepared, emotion = 'joy', confidence = .95) => new Response(JSON.stringify({
  choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ ranges: [{ from: 0, to: prepared.segments.length, emotion, intensity: .5, confidence }] }) } }],
  usage: { prompt_tokens: 180, completion_tokens: 35, total_tokens: 215 }
}), { headers: { 'content-type': 'application/json' } })

await test('semantic planning receives the correct context and stage cues while synthesis preserves spoken words', async () => {
  const text = '[开心地晃了晃尾巴] 太好了，成功啦！', context = '我通过面试啦！', states = []
  const h = boot({ emotion: true, fetcher: async url => url.endsWith('/chat/completions') ? plannedResponse(h.planner.prepare(text, { context })) : audioResponse() })
  h.controller.subscribe(state => states.push(state))
  const job = h.controller.speak(text, { id: 'happy', context }); await flush()
  assert.equal(h.requests.length, 2)
  const plan = JSON.parse(h.requests[0].init.body), speech = JSON.parse(h.requests[1].init.body)
  assert.equal(plan.model, h.connection.model)
  assert.equal(plan.enable_thinking, false)
  assert.equal(plan.stream, false)
  assert.equal(plan.response_format, undefined, 'do not assume forced JSON support in a vision model')
  assert.match(JSON.stringify(plan.messages), /开心地晃了晃尾巴/)
  assert.match(JSON.stringify(plan.messages), /我通过面试啦/)
  assert.match(speech.input, /开心|快乐|喜悦|高兴/)
  assert.equal(speech.input.split('<|endofprompt|>')[1], h.planner.prepare(text).spokenText.trim())
  assert.doesNotMatch(speech.input.split('<|endofprompt|>')[1], /尾巴/)
  assert.ok(states.some(state => state?.phase === 'planning'))
  assert.equal(h.usages[0].total_tokens, 215)
  h.controller.stop(); assert.equal(await job, false)
  assert.equal(h.api.normalize().emotion, true, 'existing preferences opt into the requested feature')
})
await test('a mixed reply changes delivery without changing voice or losing text, and drains each tail', async () => {
  const text = '你成功了！我陪你慢慢处理剩下的问题。'
  const h = boot({ emotion: true, manualDrain: true, fetcher: async url => {
    if (!url.endsWith('/chat/completions')) return audioResponse()
    const prepared = h.planner.prepare(text)
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ranges: prepared.segments.map((segment, index) => ({ from: index, to: index + 1, emotion: index ? 'comfort' : 'joy', intensity: .5, confidence: .95 })) }) } }] }))
  } })
  const job = h.controller.speak(text); await flush()
  h.audio[0].onended(); await flush()
  assert.equal(h.requests.length, 2)
  await h.drain()
  assert.equal(h.requests.length, 3)
  const parts = h.requests.slice(1).map(request => JSON.parse(request.init.body))
  assert.equal(parts[0].voice, parts[1].voice)
  assert.notEqual(parts[0].input.split('<|endofprompt|>')[0], parts[1].input.split('<|endofprompt|>')[0])
  assert.equal(parts.map(part => part.input.split('<|endofprompt|>')[1]).join(''), text)
  h.audio[1].onended(); await h.drain(); assert.equal(await job, true)
})
await test('replay caches plans, while new context and configured models force fresh interpretation', async () => {
  const text = '真好啊。'
  let emotion = 'joy'
  const h = boot({ emotion: true, fetcher: async url => url.endsWith('/chat/completions') ? plannedResponse(h.planner.prepare(text), emotion) : audioResponse() })
  const run = async context => { const job = h.controller.speak(text, { context }); await flush(); h.controller.stop(); await job }
  await run('成功了！'); assert.equal(h.requests.length, 2)
  await run('成功了！'); assert.equal(h.requests.length, 2)
  emotion = 'comfort'
  await run('其实我很难过。'); assert.equal(h.requests.length, 4)
  assert.notEqual(JSON.parse(h.requests[1].init.body).input, JSON.parse(h.requests[3].init.body).input, 'same words with different emotions cannot reuse the wrong audio')
  h.connection.model = 'configured-alternative'
  await run('其实我很难过。'); assert.equal(h.requests.length, 6)
  assert.equal(JSON.parse(h.requests[4].init.body).model, 'configured-alternative')
  h.controller.clearCache()
  await run('其实我很难过。'); assert.equal(h.requests.length, 8)
  assert.ok([...h.values.values()].every(value => !value.includes('其实我很难过')))
})
await test('ambiguous confidence uses neutral delivery, and malformed plans fall back visibly without invented emotions', async () => {
  const text = '他说自己很高兴，但我并不知道他的真实感受。'
  for (const invalid of [false, true]) {
    const h = boot({ emotion: true, fetcher: async url => url.endsWith('/chat/completions')
      ? invalid ? new Response(JSON.stringify({ choices: [{ message: { content: '{"ranges":[]}' } }] })) : plannedResponse(h.planner.prepare(text), 'joy', .3)
      : audioResponse() })
    const job = h.controller.speak(text); await flush()
    const payload = JSON.parse(h.requests[1].init.body)
    assert.match(payload.input, /平静|中性|平稳/)
    assert.doesNotMatch(payload.input.split('<|endofprompt|>')[0], /像开心的|嘴硬心软|语气可爱俏皮/)
    assert.equal(h.notices.some(message => /语气识别未完成/.test(message)), invalid)
    h.controller.stop(); await job
  }
})
await test('stopping or locking during interpretation aborts it and prevents late synthesis', async () => {
  for (const clearCache of [false, true]) {
    let release
    const text = '先别急。'
    const h = boot({ emotion: true, fetcher: () => new Promise(resolve => { release = resolve }) })
    const job = h.controller.speak(text); await flush()
    assert.equal(h.controller.state().phase, 'planning')
    h.controller.stop({ clearCache })
    assert.equal(h.requests[0].init.signal.aborted, true)
    release(plannedResponse(h.planner.prepare(text), 'comfort'))
    assert.equal(await job, false)
    assert.equal(h.requests.length, 1)
    assert.equal(h.audio.length, 0)
    assert.equal(h.notices.length, 0)
    assert.equal(h.usages.length, 0)
  }
})
await test('interpretation timeout falls back to neutral and keeps speech cancellation functional', async () => {
  const h = boot({ emotion: true, fastTimeout: true, fetcher: async (url, init) => {
    if (!url.endsWith('/chat/completions')) return audioResponse()
    return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }))
  } })
  const job = h.controller.speak('稍后重试。')
  await new Promise(resolve => setTimeout(resolve, 15)); await flush()
  assert.equal(h.requests.length, 2)
  assert.match(JSON.parse(h.requests[1].init.body).input, /平静/)
  assert.ok(h.notices.some(message => /语气识别未完成/.test(message)))
  h.controller.stop(); assert.equal(await job, false)
})
await test('manual and automatic reading share semantic inputs, while the emotion toggle disables planning', async () => {
  const text = '[松了一口气] 终于完成了。', context = '刚刚测试都通过了！'
  const h = boot({ emotion: true, autoplay: true, fetcher: async url => url.endsWith('/chat/completions') ? plannedResponse(h.planner.prepare(text), 'joy') : audioResponse() })
  const manual = h.controller.speak(text, { context }); await flush(); h.controller.stop({ clearCache: true }); await manual
  const automatic = h.controller.speak(text, { context, automatic: true }); await flush(); h.controller.stop(); await automatic
  assert.deepEqual(JSON.parse(h.requests[0].init.body).messages, JSON.parse(h.requests[2].init.body).messages)
  h.controller.configure({ emotion: false })
  const disabled = h.controller.speak(text, { context }); await flush()
  assert.equal(h.requests.length, 5)
  assert.match(h.requests[4].url, /audio\/speech$/)
  h.controller.stop(); await disabled
  assert.equal(JSON.parse(h.values.get('nanaly-voice-v1')).emotion, false)
})
await test('emotion changes at a comma preserve punctuation without inserting a second full stop', async () => {
  const text = '太好了，不过先检查一下。'
  const h = boot({ emotion: true, fetcher: async url => {
    if (!url.endsWith('/chat/completions')) return audioResponse()
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ranges: [
      { from: 0, to: 1, emotion: 'joy', intensity: .5, confidence: .95 },
      { from: 1, to: 2, emotion: 'serious', intensity: .5, confidence: .95 }
    ] }) } }] }))
  } })
  const job = h.controller.speak(text); await flush()
  assert.equal(JSON.parse(h.requests[1].init.body).input.split('<|endofprompt|>')[1], '太好了，')
  h.controller.stop(); await job
})
await test('neutral reading and service fallback both preserve literal code brackets through a single cleanup', async () => {
  for (const emotion of [false, true]) {
    const h = boot({ emotion, fetcher: async url => url.endsWith('/chat/completions') ? new Response('{}', { status: 503 }) : audioResponse() })
    const job = h.controller.speak('这个标识符是 `[叹气]`，下标是 arr[索引]。'); await flush()
    const speech = JSON.parse(h.requests.at(-1).init.body).input.split('<|endofprompt|>')[1]
    assert.match(speech, /\[叹气\]/)
    assert.match(speech, /arr\[索引\]/)
    h.controller.stop(); await job
  }
})
await test('a streaming WAV placeholder header is repaired before playback and retains the tail drain', async () => {
  const h = boot({ manualDrain: true, fetcher: async () => {
    const bytes = Buffer.from(await wave().arrayBuffer())
    bytes.writeUInt32LE(0x7fffffdb, 4); bytes.writeUInt32LE(0xffffffff, 40)
    return new Response(bytes, { headers: { 'content-type': 'audio/wav' } })
  } })
  const job = h.controller.speak('最后一个字要完整读完喵。'); await flush()
  assert.equal(h.audio.length, 1)
  assert.equal(h.notices.length, 0)
  const bytes = Buffer.from(await h.blobs[0].arrayBuffer())
  assert.equal(bytes.readUInt32LE(4), bytes.length - 8)
  assert.equal(bytes.readInt16LE(44 + 4798), 1234)
  assert.equal(bytes.readUInt32LE(40), 4800 + 16800)
  h.audio[0].onended(); assert.equal(h.drains.size, 1)
  await h.drain(); assert.equal(await job, true)
  assert.deepEqual(h.audio[0].events, ['play'])
})
await test('a genuinely truncated WAV reports failure without playing or caching the damaged response', async () => {
  let calls = 0
  const h = boot({ fetcher: async () => {
    const bytes = Buffer.from(await wave().arrayBuffer())
    if (++calls === 1) return new Response(bytes.subarray(0, bytes.length - 2), { headers: { 'content-type': 'audio/wav' } })
    return audioResponse()
  } })
  assert.equal(await h.controller.speak('完整音频才朗读。'), false)
  assert.equal(h.audio.length, 0)
  assert.ok(h.notices.some(message => /WAV 音频格式无效/.test(message)))
  const retry = h.controller.speak('完整音频才朗读。'); await flush()
  assert.equal(calls, 2)
  assert.equal(h.audio.length, 1)
  h.controller.stop(); await retry
})
console.log('\n' + passed + ' speech behavior groups passed')
