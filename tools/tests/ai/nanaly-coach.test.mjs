import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { evaluate } from '../../nanaly/quality-eval.mjs'
const require = createRequire(import.meta.url)
const knowledge = require('../../../source/js/nanaly-knowledge.js')
const identity = require('../../../source/js/nanaly-identity.js')
const script = readFileSync(new URL('../../../source/js/nanaly-coach.js', import.meta.url), 'utf8')

class Element {
  constructor(tag = 'div') { Object.assign(this, { tagName: tag.toUpperCase(), className: '', children: [], listeners: new Map(), dataset: {}, hidden: false, disabled: false, value: '', isConnected: true, text: '' }) }
  get textContent() { return this.text + this.children.map(n => n.textContent).join('') }
  set textContent(text) { this.text = String(text); this.children = [] }
  append(...kids) { for (const kid of kids) { kid.parentElement = this; this.children.push(kid) } }
  before(kid) { kid.parentElement = this.parentElement; this.parentElement.children.splice(this.parentElement.children.indexOf(this), 0, kid) }
  replaceChildren(...kids) { this.children = []; this.append(...kids) }
  setAttribute(key, value) { this[key] = value }
  all() { return this.children.flatMap(n => [n, ...n.all()]) }
  querySelector(selector) { return this.all().find(n => selector.startsWith('.') ? n.className === selector.slice(1) : n.tagName.toLowerCase() === selector) || null }
  addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(fn) }
  dispatchEvent(event) { return Promise.all((this.listeners.get(event.type) || []).map(fn => fn(event))) }
  click() { return this.disabled ? Promise.resolve() : this.dispatchEvent({ type: 'click', target: this }) }
  focus() { this.focused = true }
}
const tick = () => new Promise(resolve => setImmediate(resolve))
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
function boot({ record, corpus, withPage = false, evaluator } = {}) {
  let readable = true
  const saves = [], panel = new Element(), input = new Element('textarea'), foot = new Element('div'), page = withPage ? new Element('main') : null
  foot.className = 'nanaly-foot'; panel.append(foot)
  const document = new Element()
  Object.assign(document, { readyState: 'complete', createElement: tag => new Element(tag), getElementById: id => id === 'nanaly-coach-page' ? page : null })
  const window = new Element()
  Object.assign(window, { location: { origin: 'https://blog.test', href: 'https://blog.test/matrix/', pathname: '/matrix/' },
    NOIMPTY_LEARNING_HISTORY: { recordExplanation: async value => { saves.push(value); return record ? record(value) : { id: 'saved-1' } } } })
  const article = { title: '矩阵', url: 'https://blog.test/matrix/', text: '矩阵转置时行列互换。' }
  const context = vm.createContext({ window, document, URL, Event, AbortController, console })
  vm.runInContext(script, context)
  const api = window.NANALY_COACH
  api.create({ panel, input, openPanel() {}, currentArticle: () => article, loadCorpus: () => corpus ? corpus() : Promise.resolve([article]), canRead: () => readable,
    isBusy: () => false, connectionStatus: () => ({ configured: true, model: 'offline', reasonModel: 'offline-reason' }),
    evaluateQuality: evaluator || (() => Promise.resolve({ note: 'offline stub', results: [] })) })
  const button = label => [...panel.all(), ...(page ? page.all() : [])].find(n => n.tagName === 'BUTTON' && n.textContent === label)
  const h = { api, panel, input, page, document, window, saves, button, lock: () => { readable = false },
    async start() { await api.open(); await button('开始讲解').click(); assert.ok(api.context()) },
    complete(explanation = '我的理解是行列互换。', feedback = '准确。待复习问题：\n- 非方阵转置后形状是什么？') { api.complete({ context: api.context(), explanation, feedback, sources: [] }) },
    status: () => panel.querySelector('.nanaly-coach__status').textContent }
  return h
}

await test('coach uses original input, grounds prompts and never saves without explicit confirmation', async () => {
  const h = boot(); await h.start()
  assert.equal(h.input.focused, true)
  const prompt = h.api.prompt(h.api.context(), [])
  assert.match(prompt, /本轮未取得可引用原文/)
  assert.match(prompt, /一轮最多追问一个/)
  h.complete()
  assert.equal(h.saves.length, 0)
  await h.button('确认保存这次解释').click()
  assert.equal(h.saves.length, 1)
  assert.equal(h.saves[0].confirmed, true)
  assert.equal(h.saves[0].source.url, 'https://blog.test/matrix/')
  assert.equal(h.saves[0].reviewQuestions[0], '非方阵转置后形状是什么？')
  assert.match(h.status(), /已保存/)
})

await test('failed/locked save never reports success or discards the draft', async () => {
  const h = boot({ record: async () => { throw new Error('quota') } }); await h.start(); h.complete()
  await h.button('确认保存这次解释').click()
  assert.match(h.status(), /没有成功/)
  assert.equal(h.button('确认保存这次解释').hidden, false)
  h.lock(); await h.button('确认保存这次解释').click()
  assert.equal(h.saves.length, 1)
  assert.match(h.status(), /没有保存/)
})

await test('a save resolving after newer feedback does not erase the newer candidate', async () => {
  const pending = deferred(), h = boot({ record: () => pending.promise }); await h.start(); h.complete('第一版')
  const saving = h.button('确认保存这次解释').click()
  h.complete('修正后的第二版')
  pending.resolve({ id: 'first' }); await saving
  assert.equal(h.button('确认保存这次解释').hidden, false)
  assert.match(h.status(), /新收到的反馈尚未保存/)
  await h.button('确认保存这次解释').click()
  assert.equal(h.saves.length, 2)
  assert.match(h.saves[1].explanation, /修正后的第二版/)
})

await test('ending a session blocks late index work and obsolete model feedback', async () => {
  const loaded = deferred(), h = boot({ corpus: () => loaded.promise })
  const opening = h.api.open()
  h.api.stop()
  loaded.resolve([]); await opening
  assert.equal(h.panel.querySelector('.nanaly-coach').hidden, true)
  assert.notEqual(h.panel.querySelector('input').focused, true)
  assert.equal(h.api.context(), null)
})

await test('departing the teach page aborts live quality requests', async () => {
  let signal
  const h = boot({ withPage: true, evaluator: ({ signal: supplied }) => {
    signal = supplied
    return new Promise((resolve, reject) => supplied.addEventListener('abort', () => reject(new Error('aborted'))))
  } })
  const running = h.button('运行 6 题能力自检').click()
  assert.equal(signal.aborted, false)
  h.page.isConnected = false
  await h.document.dispatchEvent({ type: 'pjax:complete' })
  await running
  assert.equal(signal.aborted, true)
})

await test('knowledge is public, traceable and the six rubrics cover actual reported weaknesses', async () => {
  assert.equal(identity.version, 3)
  assert.deepEqual(knowledge.cases.map(c => c.id), ['natural', 'reference', 'counterexample', 'source', 'execution', 'attachment'])
  assert.equal(knowledge.intent('矩阵转置为什么成立').reasoning, true)
  assert.equal(knowledge.intent('你好').inventory, false)
  const report = await evaluate()
  assert.equal(report.kind, 'offline-contract')
  assert.equal(report.modelRequests, 0)
  assert.ok(report.checks.every(item => item.ok))
  // 猫娘口吻本身不扣分，只有「喵」塞得太满才提醒人工看一眼
  assert.equal(knowledge.assess(knowledge.cases[0], '[伸了个懒腰] 那就先歇一会儿喵 (ovo)').warnings.length, 0)
  assert.equal(knowledge.assess(knowledge.cases[0], '喵～歇会儿喵，喝口水喵').warnings.length > 0, true)
})

await test('live evaluator requires dedicated key and bounds calls without logging credentials', async () => {
  let calls = 0
  const absent = await evaluate({ live: true, env: {}, request: () => { calls++; throw new Error('should not run') } })
  assert.equal(absent.status, 'not-run'); assert.equal(calls, 0)
  const report = await evaluate({ live: true, limit: 1, env: { DEEPSEEK_API_KEY: 'offline-placeholder' }, request: async (url, options) => {
    calls++; assert.equal(url, 'https://api.deepseek.com/chat/completions')
    const payload = JSON.parse(options.body)
    assert.equal(payload.max_tokens, 1536)
    assert.ok(!options.body.includes('offline-placeholder'))
    return new Response(JSON.stringify({ choices: [{ message: { content: '先休息一下。' }, finish_reason: 'stop' }], usage: { completion_tokens: 8 } }))
  } })
  assert.equal(calls, 1)
  assert.equal(report.kind, 'live-model')
  assert.equal(report.results[0].needsHumanReview, true)
  assert.ok(!JSON.stringify(report).includes('offline-placeholder'))
})

await test('live quality prompts do not contain the worked answers from teaching examples', async () => {
  const payloads = []
  await evaluate({ live: true, limit: 3, env: { DEEPSEEK_API_KEY: 'offline-only' }, request: async (url, options) => {
    payloads.push(JSON.parse(options.body))
    return new Response(JSON.stringify({ choices: [{ message: { content: '评测输出占位' } }] }))
  } })
  const system = payloads[2].messages.filter(m => m.role === 'system').map(m => m.content).join('\n')
  assert.doesNotMatch(system, /表达示例|i = 0 且 n > 0/)
  assert.match(payloads[2].messages.at(-1).content, /i \*= 2/)
})
