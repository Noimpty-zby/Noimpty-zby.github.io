/* Execute the browser module with offline corpus/model mocks, never a real API. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const SRC = readFileSync(new URL('../../../source/js/nanaly-research.js', import.meta.url), 'utf8')
const SEARCH = readFileSync(new URL('../../../source/js/noimpty-search.js', import.meta.url), 'utf8')
const origin = 'https://blog.test'
const boot = () => {
  const window = { location: { origin } }
  vm.runInNewContext(SRC, { window, URL, AbortController, setTimeout, clearTimeout })
  return window.NanalyResearch
}
const api = boot()
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
const article = { title: '矩阵笔记', url: '/matrix/', text: '引言。'.repeat(6000) + '转置矩阵要求交换行列。', sections: [
  { title: '引言', id: 'intro', text: '引言。'.repeat(6000) },
  { title: '矩阵转置', id: '真实-转置-2', text: '转置矩阵要求交换行列。对非方阵同样成立。' }
] }
const tool = (name, args, id = 'call1') => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } })
const base = extras => ({ origin, canRead: () => true, loadCorpus: async () => [article], ...extras })
let passed = 0
const check = async (name, fn) => {
  try { await fn(); console.log('  ✓ ' + name); passed++ }
  catch (error) { console.error('  ✗ ' + name); console.error(error); process.exitCode = 1 }
}

await check('article tail beyond the old 12000-character cap is retrievable with its real anchor', () => {
  const hits = api.search([article], '转置矩阵的条件', origin)
  assert.match(hits[0].quote, /交换行列/)
  assert.equal(decodeURIComponent(new URL(hits[0].url).hash), '#真实-转置-2')
})
await check('plain text retrieval finds later passages instead of the first common keyword', () => {
  const source = { title: '矩阵', url: '/long/', text: '矩阵是什么。' + '基础内容。'.repeat(3500) + '非方阵转置时必须交换行数和列数。' }
  const hits = api.search([source], '非方阵转置', origin)
  assert.ok(hits.some(h => h.quote.includes('交换行数')))
  assert.ok(hits.every(h => new URL(h.url).hash === ''), 'must not invent heading slugs')
})
await check('current heading and exact selection retain evidence without displacing all relevant passages', () => {
  const hits = api.selectArticle({ ...article, heading: 'intro', selection: '对非方阵同样成立。' }, '矩阵转置', origin)
  assert.equal(hits[0].quote, '对非方阵同样成立。')
  assert.ok(hits.some(h => h.anchor === 'intro'))
  assert.ok(hits.some(h => h.quote.includes('交换行列')))
  const fake = api.selectArticle({ ...article, selection: '不在文章中的虚构断言' }, '矩阵转置', origin)
  assert.ok(fake.every(h => !h.quote.includes('虚构断言')))
})
await check('real model tool loop searches without a prefix and replays tool content/reasoning faithfully', async () => {
  const snapshots = []
  const research = api.create(base({ complete: async request => {
    snapshots.push(structuredClone(request.messages))
    return snapshots.length === 1
      ? { role: 'assistant', content: '查找转置的依据', reasoning_content: '先查博客', tool_calls: [tool('search_blog', { query: '矩阵转置' })] }
      : { role: 'assistant', content: '资料足够' }
  } }))
  const result = await research.prepare({ query: '非方阵也能转置吗？', mode: 'auto' })
  assert.equal(result.calls, 1)
  assert.equal(result.rounds, 2)
  assert.match(result.context, /交换行列/)
  const assistant = snapshots[1].find(m => m.tool_calls)
  assert.equal(assistant.content, '查找转置的依据')
  assert.equal(assistant.reasoning_content, '先查博客')
  const receipt = snapshots[1].find(m => m.role === 'tool')
  assert.equal(receipt.tool_call_id, 'call1')
  assert.ok(JSON.parse(receipt.content).sources[0].id)
})
await check('read_article honors a real URL fragment and never fetches unknown/external URLs', async () => {
  const seen = []
  let step = 0
  const research = api.create(base({ complete: async ({ messages }) => {
    seen.push(messages)
    if (step++ === 0) return { tool_calls: [tool('read_article', { url: '/matrix/#真实-转置-2' }), tool('read_article', { url: 'https://evil.test/private/' }, 'bad')] }
    return { content: 'done' }
  } }))
  const result = await research.prepare({ query: '这一节说了什么' })
  assert.equal(result.sources.length, 1)
  assert.match(result.sources[0].quote, /交换行列/)
  assert.ok(result.diagnostics.some(x => /站内/.test(x)))
  assert.equal(JSON.parse(seen[1].filter(m => m.role === 'tool')[1].content).status, 'unavailable')
})
await check('follow-up retains source IDs and excerpts; casual noPlan does not invoke or erase research', async () => {
  const received = []
  const research = api.create(base({ complete: async ({ messages }) => { received.push(messages); return { content: 'done' } } }))
  const first = await research.prepare({ query: '转置', mode: 'site' })
  const id = first.sources[0].id
  const casual = await research.prepare({ query: '谢谢', noPlan: true })
  assert.equal(casual.context, '')
  assert.equal(received.length, 1)
  const next = await research.prepare({ query: '那非方阵呢？' })
  assert.equal(next.sources[0].id, id)
  assert.ok(received[1].some(m => m.content.includes('交换行列')))
  next.sources[0].quote = 'mutated'
  assert.ok(research.sources().every(s => s.quote !== 'mutated'))
})

await check('reload imports prior citations without renumbering and allocates fresh IDs above them', async () => {
  const prior = { id: 'S42', kind: 'blog', title: '旧依据', url: origin + '/older/', section: '', quote: '上轮已经取得的证据片段' }
  const research = api.create(base({ complete: async () => ({ content: 'done' }) }))
  const result = await research.prepare({ query: '转置', priorSources: [prior], article })
  assert.ok(result.sources.some(s => s.id === 'S42' && s.quote === prior.quote))
  assert.ok(result.sources.filter(s => s.id !== 'S42').every(s => Number(s.id.slice(1)) > 42))
  const previousMax = Math.max(...result.sources.map(s => Number(s.id.slice(1))))
  research.reset()
  const fresh = await research.prepare({ query: '转置', article })
  assert.ok(fresh.sources.every(s => Number(s.id.slice(1)) > previousMax))
})
await check('conflicting persisted source IDs never silently point at another document', async () => {
  const prior = { id: 'S9', kind: 'blog', title: '真实旧来源', url: origin + '/a/', quote: '原来的证据' }
  const research = api.create(base({ complete: async () => ({ content: 'done' }) }))
  const result = await research.prepare({ query: '依据', priorSources: [prior, { ...prior, url: origin + '/b/', quote: '另一来源' }] })
  assert.equal(result.sources.length, 1)
  assert.equal(result.sources[0].url, prior.url)
  assert.ok(result.diagnostics.some(d => /编号冲突/.test(d)))
})

await check('web citations come only from actual HTTP(S) search results', async () => {
  const research = api.create(base({ searchWeb: async () => [
    { title: '有效', url: 'https://docs.test/real', excerpt: '真实返回片段' },
    { title: '恶意', url: 'javascript:alert(1)', excerpt: '不是来源' },
    { title: '凭据', url: 'https://user:pass@docs.test/', excerpt: '不是来源' }
  ], complete: async () => ({ content: 'done' }) }))
  const result = await research.prepare({ query: '上网搜：矩阵', mode: 'web' })
  assert.equal(result.sources.length, 1)
  assert.equal(result.sources[0].url, 'https://docs.test/real')
  assert.equal(result.sources[0].kind, 'web')
})
await check('malformed/unknown tools yield explicit unavailable status without side effects', async () => {
  let n = 0
  let receipts
  const research = api.create(base({ complete: async ({ messages }) => {
    if (n++ === 0) return { tool_calls: [tool('navigate', { url: '/x/' }), { ...tool('search_blog', {}), id: 'broken', function: { name: 'search_blog', arguments: '{bad' } }] }
    receipts = messages.filter(m => m.role === 'tool')
    return { content: 'done' }
  } }))
  const result = await research.prepare({ query: '查一下' })
  assert.equal(result.diagnostics.length, 2)
  assert.ok(receipts.every(m => JSON.parse(m.content).status === 'unavailable'))
})
await check('request is bounded to at most three planning rounds and five tool calls', async () => {
  let planner = 0
  const research = api.create(base({ complete: async () => { planner++; return { tool_calls: Array.from({ length: 8 }, (_, i) => tool('search_blog', { query: '转置' }, 'same')) } } }))
  const result = await research.prepare({ query: '矩阵' })
  assert.equal(result.calls, 5)
  assert.equal(planner, 1)
  assert.ok(result.diagnostics.some(x => /上限/.test(x)))
  let rounds = 0
  const three = api.create(base({ complete: async () => { rounds++; return { tool_calls: [tool('search_blog', { query: '转置' })] } } }))
  assert.equal((await three.prepare({ query: '矩阵' })).rounds, 3)
  assert.equal(rounds, 3)
})
await check('provider/planning failures degrade to explicit diagnostics and retain local evidence', async () => {
  const research = api.create(base({ complete: async () => { throw new Error('provider unavailable') } }))
  const result = await research.prepare({ query: '矩阵转置', article })
  assert.ok(result.sources.length)
  assert.match(result.context, /provider unavailable/)
  assert.match(result.context, /不要把失败/)
})
await check('tool deadline releases a hanging corpus load and late success cannot rewrite sources', async () => {
  const pending = deferred()
  const research = api.create(base({ timeoutMs: 15, loadCorpus: () => pending.promise, complete: async () => ({ content: 'done' }) }))
  const result = await research.prepare({ query: '矩阵', mode: 'site' })
  assert.ok(result.diagnostics.some(x => /时限/.test(x)))
  pending.resolve([article])
  await Promise.resolve()
  assert.equal(research.sources().length, 0)
})
await check('caller abort rejects immediately even if the injected loader ignores its signal', async () => {
  const pending = deferred()
  const research = api.create(base({ loadCorpus: () => pending.promise, complete: async () => ({ content: 'done' }) }))
  const controller = new AbortController()
  const operation = research.prepare({ query: '矩阵', mode: 'site', signal: controller.signal })
  controller.abort()
  await assert.rejects(operation, e => e.name === 'AbortError')
  pending.resolve([article])
  await Promise.resolve()
  assert.equal(research.sources().length, 0)
})
await check('reset cancels an in-flight planner and prevents old evidence returning after relock', async () => {
  const pending = deferred()
  const started = deferred()
  const research = api.create(base({ complete: () => { started.resolve(); return pending.promise } }))
  const operation = research.prepare({ query: '转置', article })
  await started.promise
  research.reset()
  await assert.rejects(operation, e => e.name === 'AbortError')
  pending.resolve({ tool_calls: [tool('search_blog', { query: '矩阵' })] })
  await Promise.resolve()
  assert.equal(research.sources().length, 0)
})
await check('locked access never loads private data, including supplied article and previously saved evidence', async () => {
  let unlocked = true
  let loads = 0
  const research = api.create(base({ canRead: () => unlocked, loadCorpus: async () => { loads++; return [article] }, complete: async () => ({ content: 'done' }) }))
  await research.prepare({ query: '转置', article })
  unlocked = false
  const result = await research.prepare({ query: '转置', article, mode: 'site' })
  assert.equal(loads, 0)
  assert.equal(result.sources.length, 0)
  assert.match(result.context, /SEARCH_LOCKED/)
  assert.equal(research.sources().length, 0)
})
await check('all evidence is bounded and huge planner history stops before another model request', async () => {
  let calls = 0
  const research = api.create(base({ complete: async () => {
    calls++
    return { content: 'x'.repeat(27000), reasoning_content: 'why', tool_calls: [tool('search_blog', { query: '转置' })] }
  } }))
  const result = await research.prepare({ query: '矩阵', article })
  assert.equal(calls, 1)
  assert.ok(result.diagnostics.some(x => /预算/.test(x)))
  assert.ok(result.context.length < 13000)
})

// Exercise the real index helper against a DOM-shaped fixture. No guessed IDs.
await check('index section extraction preserves real nested heading IDs and ignores scripts', () => {
  const txt = textContent => ({ nodeType: 3, textContent })
  const element = (tagName, childNodes, id = '') => ({ nodeType: 1, tagName, childNodes, get textContent() { return childNodes.map(c => c.textContent).join('') }, getAttribute: name => name === 'id' ? id : null })
  const body = { childNodes: [element('P', [txt('开头说明')]), element('SECTION', [element('H2', [txt('同名标题')], 'same-2'), element('P', [txt('真实正文')]), element('SCRIPT', [txt('不该作为证据')]), element('H3', [txt('无id标题')]), element('P', [txt('末尾正文')])])] }
  const slice = SEARCH.slice(SEARCH.indexOf('  const parseSections ='), SEARCH.indexOf('\n  const parse = xml'))
  const parse = vm.runInNewContext(slice + '\nparseSections', { DOMParser: class { parseFromString() { return { body } } } })
  const sections = parse('<fixture>')
  assert.equal(sections[0].title, '')
  assert.equal(sections[1].id, 'same-2')
  assert.equal(sections[2].id, '')
  assert.ok(sections.every(s => !s.text.includes('不该作为证据')))
})
await check('journal TTL revalidates only journal, coalesces refresh, and expired failure is not an empty journal', async () => {
  let now = 100000
  let requests = 0
  let mode = 'ok'
  let pending
  const window = { location: { origin }, NOIMPTY_GATE: { passphrase: () => 'pass' }, fetch: async (url, init) => {
    requests++
    assert.equal(init.cache, 'no-cache')
    if (mode === 'wait') await pending.promise
    if (mode === 'error') throw new Error('network down')
    return { ok: true, status: 200, text: async () => JSON.stringify({ entries: [{ at: '9-19 10:00', who: 'reply', what: 'entry' + requests }] }) }
  } }
  vm.runInNewContext(SEARCH, { window, URL, Response, AbortController, setTimeout, clearTimeout, Date: { now: () => now } })
  const search = window.NOIMPTY_SEARCH
  assert.equal((await search.loadJournal())[0].what, 'entry1')
  now += 59999
  await search.loadJournal()
  assert.equal(requests, 1)
  now++
  pending = deferred(); mode = 'wait'
  const one = search.loadJournal(); const two = search.loadJournal()
  assert.equal(requests, 2)
  pending.resolve(); await Promise.all([one, two])
  now += 60000; mode = 'error'
  await assert.rejects(search.loadJournal(), /network down/)
  assert.equal(requests, 3)
  mode = 'ok'
  assert.equal((await search.loadJournal())[0].what, 'entry4')
})

console.log(`\n${passed} research regression cases passed`)
