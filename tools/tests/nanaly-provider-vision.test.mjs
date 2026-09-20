import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const providerSource = readFileSync(new URL('../../source/js/nanaly-provider.js', import.meta.url), 'utf8')
const visionSource = readFileSync(new URL('../../source/js/nanaly-vision.js', import.meta.url), 'utf8')
const coreSource = readFileSync(new URL('../../source/js/noimpty-ai.js', import.meta.url), 'utf8')
const window = {}
vm.runInNewContext(providerSource, { window, URL })
const provider = window.NANALY_PROVIDER
const cfg = { baseURL: 'https://api.deepseek.com', model: 'text', reasonModel: 'reason', reasonEffort: 'high', visionBaseURL: 'https://api.siliconflow.cn/v1', visionModel: 'vision' }
const secrets = { apiKey: 'text-only-placeholder', visionKey: 'vision-only-placeholder' }
const picture = { id: 'picture-001', name: 'notes.png' }
const dataURL = 'data:image/jpeg;base64,AA=='
let passed = 0
const check = async (name, fn) => {
  try { await fn(); passed++; console.log('  ✓ ' + name) }
  catch (error) { process.exitCode = 1; console.error('  ✗ ' + name, error) }
}
const vision = entries => {
  const data = new Map(entries)
  const database = { transaction() {
    const tx = { objectStore: () => ({ get(id) {
      const request = { result: data.get(id) }
      queueMicrotask(() => tx.oncomplete())
      return request
    } }) }
    return tx
  } }
  const indexedDB = { open() {
    const request = { result: database }
    queueMicrotask(() => request.onsuccess())
    return request
  } }
  const window = { indexedDB }
  vm.runInNewContext(visionSource, { window, indexedDB, URL })
  return window.NANALY_VISION
}

await check('text and image models use their own keys and never mutate credentials', () => {
  const before = JSON.stringify(secrets)
  const plain = provider.request({ cfg, secrets, messages: [{ role: 'user', content: '问题' }] })
  assert.equal(plain.key, secrets.apiKey)
  assert.equal(plain.url, 'https://api.deepseek.com/chat/completions')
  const visual = provider.request({ cfg, secrets, vision: true, messages: [] })
  assert.equal(visual.key, secrets.visionKey)
  assert.equal(visual.url, 'https://api.siliconflow.cn/v1/chat/completions')
  assert.equal(JSON.stringify(secrets), before)
})
await check('historical image content forces visual routing even if the caller passes vision:false', () => {
  const req = provider.request({ cfg, secrets, vision: false, messages: [
    { role: 'user', content: [{ type: 'text', text: '上张图' }, { type: 'image_url', image_url: { url: dataURL } }] },
    { role: 'assistant', content: '之前的解答' }, { role: 'user', content: '第二行呢？' }
  ] })
  assert.equal(req.key, secrets.visionKey)
  assert.equal(req.payload.model, cfg.visionModel)
  assert.equal(req.payload.messages[0].content[1].image_url.url, dataURL)
})
await check('a missing visual key never falls back to a text-provider key for images', () => {
  assert.throws(() => provider.request({ cfg, secrets: { apiKey: secrets.apiKey }, messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: dataURL } }] }] }), /视觉 API Key/)
  assert.equal(provider.request({ cfg, secrets: { visionKey: secrets.visionKey }, messages: [] }).key, secrets.visionKey)
})
await check('provider-specific parameters stay on the matching host', () => {
  const deep = provider.request({ cfg, secrets, deep: true, messages: [] }).payload
  assert.equal(deep.thinking.type, 'enabled')
  assert.equal(deep.reasoning_effort, 'high')
  assert.equal(deep.enable_thinking, undefined)
  const visionPayload = provider.request({ cfg, secrets, deep: true, vision: true, messages: [] }).payload
  assert.equal(visionPayload.enable_thinking, true)
  assert.equal(visionPayload.thinking, undefined)
  const custom = provider.request({ cfg: { ...cfg, baseURL: 'https://custom.test/v1' }, secrets, deep: true, messages: [] }).payload
  assert.equal(custom.thinking, undefined)
  assert.equal(custom.enable_thinking, undefined)
})
await check('unsafe endpoints are rejected before any credential can be sent', () => {
  for (const baseURL of ['http://remote.test', 'https://user:pass@remote.test', 'https://remote.test/?key=x', 'https://remote.test/#fragment', 'javascript:alert(1)']) {
    assert.throws(() => provider.request({ cfg: { ...cfg, baseURL }, secrets, messages: [] }))
  }
  assert.equal(provider.request({ cfg: { ...cfg, baseURL: 'http://localhost:3000/v1' }, secrets, messages: [] }).url, 'http://localhost:3000/v1/chat/completions')
})
await check('vision attachments enforce file types and per-file byte limits without decoding', () => {
  const api = vision([])
  for (const type of ['image/gif', 'image/svg+xml', 'text/html', '']) assert.throws(() => api.validateFile({ type, size: 1024 }), /PNG/)
  for (const size of [0, 10 * 1024 * 1024 + 1]) assert.throws(() => api.validateFile({ type: 'image/png', size }), /10 MB/)
  for (const type of ['image/png', 'image/jpeg', 'image/webp']) assert.doesNotThrow(() => api.validateFile({ type, size: 10 * 1024 * 1024 }))
})
await check('missing new images fail explicitly; missing historical images become an honest text marker', async () => {
  const api = vision([])
  await assert.rejects(api.imageContent('看图', [picture]), /重新附加/)
  const past = await api.imageContent('上次的问题', [picture], { strict: false })
  assert.equal(typeof past, 'string')
  assert.match(past, /历史图片.*已丢失/)
  assert.match(past, /不能假装看过/)
})
await check('image data stays local until constructing a model message and malformed stored URLs are rejected', async () => {
  const api = vision([[picture.id, { dataURL }]])
  const parts = await api.imageContent('分析一下', [picture])
  assert.equal(parts[0].text, '分析一下')
  assert.equal(parts[1].image_url.url, dataURL)
  const bad = vision([[picture.id, { dataURL: 'https://untrusted.test/image.jpg' }]])
  await assert.rejects(bad.imageContent('分析一下', [picture]), /重新附加/)
  assert.equal(await api.imageContent('纯文字', []), '纯文字')
})

const cut = (a, b) => coreSource.slice(coreSource.indexOf(a), coreSource.indexOf(b, coreSource.indexOf(a)))
const coreContext = (api, keys) => {
  const context = vm.createContext({
    window: { NANALY_VISION: api }, PERSONA: 'persona', TIME_RULES: 'time', currentArticle: () => null,
    postDigest: async () => 'posts', selfLog: async () => 'journal', research: { prepare: async () => ({ sources: [], context: '' }) },
    history: [], historyAnchor: 0, historyWindow: list => ({ list, anchorAt: 0 }),
    withTimeMarks: list => list.map(m => ({ role: m.role, content: m.content })), memoryDigest: () => '', nowLine: () => 'now',
    workspace: null, activeTurn: null, secrets: keys, setTimeout, clearTimeout, DOMException, AbortController
  })
  vm.runInContext(cut('  const abortable =', '  /* 忙的时候') + '\n' + cut('  const WEB_PREFIX', '  /* 这几条消息的') + '\n' + cut('  const attachmentContent =', '  const generateTopicTitle =') + '\n' + cut('  const buildMessages =', '  // 模型把指令') + '\nthis.buildMessages = buildMessages', context)
  return context.buildMessages
}
await check('a text follow-up with available historical images stays on the visual model', async () => {
  const build = coreContext(vision([[picture.id, { dataURL }]]), secrets)
  const messages = await build('第二行呢？', 'article', new AbortController().signal, [{ role: 'user', content: '看这张图', attachments: [picture] }])
  assert.ok(messages.some(m => Array.isArray(m.content)))
  const request = provider.request({ cfg, secrets, messages })
  assert.equal(request.key, secrets.visionKey)
})
await check('removing visual credentials keeps historical image questions readable but does not pretend to reread the image', async () => {
  const keys = { apiKey: secrets.apiKey }
  const build = coreContext(vision([[picture.id, { dataURL }]]), keys)
  const messages = await build('继续', 'article', new AbortController().signal, [{ role: 'user', content: '看这张图', attachments: [picture] }])
  assert.ok(messages.every(m => typeof m.content === 'string'))
  assert.ok(messages.some(m => m.content.includes('本轮未重新读取')))
  assert.equal(provider.request({ cfg, secrets: keys, messages }).key, secrets.apiKey)
})

console.log(`\n${passed} provider and vision regression cases passed`)
