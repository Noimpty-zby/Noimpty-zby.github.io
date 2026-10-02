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
// 错题都在复习页（/review/）复习卡下面；原来的成长回放页 2026-10-03 合并进来了
function boot({ unlocked = true, list = async () => [record()], href = 'https://blog.test/review/' } = {}) {
  const root = new Element(), nodes = {}, window = new Element(), document = new Element()
  nodes['review-app'] = new Element(); nodes['learning-history-review'] = root
  Object.assign(document, { readyState: 'loading', createElement: tag => new Element(tag), getElementById: id => nodes[id], body: new Element() })
  Object.assign(window, { location: { href }, NOIMPTY_LEARNING_HISTORY: { unlocked: () => unlocked, list, listExplanations: async () => [] } })
  vm.runInNewContext(script, { window, document, URL, Blob, setTimeout })
  return { root, window, mount: window.NOIMPTY_LEARNING_HISTORY_UI.mount, leave: () => { delete nodes['review-app']; delete nodes['learning-history-review'] } }
}
await test('the full list hides old code until explicit comparison and compares exact saved attempts', async () => {
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
  const h = boot(); await h.mount()
  const links = h.root.all().filter(x => x.tagName === 'a')
  assert.ok(links.some(x => x.href === '/learn/?case=case%3Aa' && /开始重做/.test(x.textContent)))
  // 错题只能真的去练习台重做，不能像复习卡那样翻面就打分
  assert.deepEqual(h.root.all().filter(x => x.tagName === 'button' && /重来|困难|良好|简单/.test(x.textContent)), [])
  assert.doesNotMatch(h.root.textContent, /PRIVATE FAILED|PRIVATE FIXED/)
  assert.match(h.root.textContent, /全部错题（1）/)
  assert.equal(h.root.all().find(x => x.className === 'learning-history-all').open, false)
})

await test('with no saved mistakes the section says how to get one and still offers import', async () => {
  const h = boot({ list: async () => [] }); await h.mount()
  assert.match(h.root.textContent, /还没有保存过错题/)
  assert.ok(h.root.all().some(x => x.tagName === 'button' && x.textContent === '导入错题备份'))
  assert.equal(h.root.all().find(x => x.className === 'learning-history-all'), undefined)
})

await test('arriving from the lab with ?case= opens the full list with that case first', async () => {
  const other = { ...record(), id: 'case:b', title: '另一道', updatedAt: '2026-10-02T00:00:00.000Z' }
  const h = boot({ list: async () => [other, record()], href: 'https://blog.test/review/?case=case%3Aa' }); await h.mount()
  const all = h.root.all().find(x => x.className === 'learning-history-all')
  assert.equal(all.open, true)
  assert.equal(all.children.filter(x => x.className === 'growth-case')[0].id, 'case:a')
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
