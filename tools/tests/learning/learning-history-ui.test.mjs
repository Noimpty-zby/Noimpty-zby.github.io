import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
const script = readFileSync(new URL('../../../source/js/learning-history-ui.js', import.meta.url), 'utf8')
class Element {
  constructor(tag = 'div') { this.tagName = tag; this.children = []; this.hidden = false; this.value = ''; this.listeners = new Map(); this._text = '' }
  append(...values) { this.children.push(...values) }
  replaceChildren(...values) { this._text = ''; this.children = values }
  set textContent(value) { this._text = value; this.children = [] }
  get textContent() { return this._text + this.children.map(x => x.textContent).join('') }
  addEventListener(type, fn) { this.listeners.set(type, fn) }
  setAttribute() {}
  remove() {}
  all() { return this.children.flatMap(x => [x, ...x.all()]) }
  click() { return this.listeners.get('click')?.() }
}
const record = () => ({ id: 'case:a', title: '除零现场', due: '2020-01-01T00:00:00.000Z', createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', solved: true, reviews: [], attempts: [
  { language: 'python', code: 'PRIVATE FAILED CODE', stdin: '2\n', tests: [], problem: '算倒数', at: '2020-01-01T00:00:00.000Z', explanation: '忘了判断', source: { title: '文章', url: '/post/' }, result: { status: 'runtime_error', stdout: '', stderr: 'ZeroDivisionError', tests: [] } },
  { language: 'python', code: 'PRIVATE FIXED CODE', stdin: '2\n', tests: [], problem: '算倒数', at: '2020-01-02T00:00:00.000Z', explanation: '先判断输入', result: { status: 'accepted', stdout: '0.5', stderr: '', tests: [] } }
] })
function boot({ page = 'growth', unlocked = true, list = async () => [record()] } = {}) {
  const root = new Element(), nodes = {}, window = new Element(), document = new Element()
  if (page === 'growth') nodes['learning-growth'] = root
  else { nodes['review-app'] = new Element(); nodes['learning-history-review'] = root }
  Object.assign(document, { readyState: 'loading', createElement: tag => new Element(tag), getElementById: id => nodes[id], body: new Element() })
  Object.assign(window, { location: { href: 'https://blog.test/growth/' }, NOIMPTY_LEARNING_HISTORY: { unlocked: () => unlocked, list, listExplanations: async () => [] } })
  vm.runInNewContext(script, { window, document, URL, Blob, setTimeout })
  return { root, window, mount: window.NOIMPTY_LEARNING_HISTORY_UI.mount, leave: () => { delete nodes['learning-growth']; delete nodes['review-app']; delete nodes['learning-history-review'] } }
}
await test('growth hides old code until explicit comparison and compares exact saved attempts', async () => {
  const h = boot(); await h.mount()
  assert.doesNotMatch(h.root.textContent, /PRIVATE FAILED|PRIVATE FIXED/)
  assert.equal(h.root.all().find(x => x.className === 'growth-comparison').hidden, true)
  const redo = h.root.all().find(x => x.textContent === '先重做这道题 ↗')
  assert.equal(redo.href, '/learn/?case=case%3Aa')
  h.root.all().find(x => x.textContent === '重做后对照不同尝试').click()
  assert.match(h.root.textContent, /PRIVATE FAILED CODE/)
  assert.match(h.root.textContent, /PRIVATE FIXED CODE/)
  assert.match(h.root.textContent, /ZeroDivisionError/)
  assert.match(h.root.textContent, /先判断输入/)
})
await test('the review queue links to actual redos and offers no flip-card rating shortcut', async () => {
  const h = boot({ page: 'review' }); await h.mount()
  const links = h.root.all().filter(x => x.tagName === 'a')
  assert.ok(links.some(x => x.href === '/learn/?case=case%3Aa'))
  assert.equal(h.root.all().filter(x => x.tagName === 'button').length, 0)
  assert.doesNotMatch(h.root.textContent, /PRIVATE FAILED|PRIVATE FIXED/)
})
await test('locked growth never reads private records', async () => {
  let reads = 0
  const h = boot({ unlocked: false, list: async () => { reads++; return [record()] } }); await h.mount()
  assert.equal(reads, 0); assert.match(h.root.textContent, /解锁/)
})
await test('a late database response cannot repopulate a page after navigation', async () => {
  let resolve
  const h = boot({ list: () => new Promise(yes => { resolve = yes }) })
  const pending = h.mount(); h.leave(); await h.mount(); resolve([record()]); await pending
  assert.equal(h.root.textContent, '')
})

await test('successful import feedback survives its own storage-change repaint', async () => {
  const h = boot(); await h.mount()
  h.window.NOIMPTY_LEARNING_HISTORY.importData = async () => {
    h.window.listeners.get('learning-history:changed')()
    return { cases: 2, explanations: 1 }
  }
  const file = h.root.all().find(node => node.tagName === 'input')
  file.files = [{ size: 100, text: async () => '{}' }]
  await file.listeners.get('change')()
  assert.match(h.root.textContent, /已合并 2 个错题现场；/)
})
