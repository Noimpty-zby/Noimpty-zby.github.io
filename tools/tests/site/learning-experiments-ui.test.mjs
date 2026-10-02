import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

// Small DOM fixture for interaction/lifecycle regression. Browser screenshots
// remain a separate visual check; this fixture does not pretend to lay out CSS.
class Element {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.style = {}; this.attributes = {}; this.events = {}; this.className = ''; this._text = ''; this._value = ''; this.disabled = false; this.captured = new Set(); this.classList = { toggle: (name, on) => { const all = new Set(this.className.split(' ').filter(Boolean)); on ? all.add(name) : all.delete(name); this.className = [...all].join(' ') } } }
  set textContent(value) { this._text = String(value); this.children = [] }
  get textContent() { return this._text + this.children.map(child => child.textContent ?? child).join('') }
  set value(value) { this._value = String(value) }
  get value() { return this.tagName === 'SELECT' && !this.children.some(child => child.value === this._value) ? this.children[0]?.value || '' : this._value }
  append(...children) { this.children.push(...children) }
  replaceChildren(...children) { this._text = ''; this.children = [...children] }
  setAttribute(name, value) { this.attributes[name] = String(value); if (name === 'class') this.className = String(value) }
  addEventListener(name, fn) { (this.events[name] ||= []).push(fn) }
  async emit(name, event = {}) { if (name === 'click' && this.disabled) return; for (const fn of this.events[name] || []) await fn(event) }
  querySelector(selector) { return selector === '[data-experiment-mount]' ? this.children.find(child => child.attributes?.['data-experiment-mount'] === '') : null }
  getContext() { return null }
  getBoundingClientRect() { return { left: 0, top: 0, width: 520, height: 340 } }
  setPointerCapture(id) { this.captured.add(id) }
  hasPointerCapture(id) { return this.captured.has(id) }
  releasePointerCapture(id) { this.captured.delete(id) }
  focus() { this.focused = true }
}
const descendants = root => [root, ...root.children.filter(child => child instanceof Element).flatMap(descendants)]
const withClass = (root, cls) => descendants(root).filter(item => item.className.split(' ').includes(cls))
const button = (root, text) => descendants(root).find(item => item.tagName === 'BUTTON' && item.textContent === text)
const click = async (root, text) => { const target = button(root, text); assert.ok(target, `button ${text}`); await target.emit('click') }
const section = kind => { const root = new Element('section'), host = new Element('div'); root.dataset.experiment = kind; host.setAttribute('data-experiment-mount', ''); root.append(host); return root }
const boot = () => {
  const roots = ['array', 'git', 'barycentric'].map(section), events = {}, sent = []
  const document = { readyState: 'complete', createElement: tag => new Element(tag), createElementNS: (_, tag) => new Element(tag), querySelectorAll: () => roots }
  const window = { location: { href: 'https://example.invalid/article/' }, addEventListener: (name, fn) => { (events[name] ||= []).push(fn) }, LEARNING_LAB: { openSnippet: async value => { sent.push(value); return { loaded: true } } } }
  vm.runInNewContext(readFileSync('source/js/learning-experiments.js', 'utf8'), { window, document, console })
  const event = name => { for (const fn of events[name] || []) fn({}) }
  return { roots, window, sent, event }
}

await test('array buttons expose physical movements and reject invalid parameter edits without losing the running experiment', async () => {
  const { roots } = boot(), root = roots[0]
  assert.equal(root.dataset.experimentMounted, 'yes')
  assert.match(withClass(root, 'le-metrics')[0].textContent, /移动 0 次/)
  await click(root, '下一步 →')
  assert.match(withClass(root, 'le-instruction')[0].textContent, /A\[5\] = A\[4\]/)
  assert.equal(withClass(root, 'is-source')[0].children[0].textContent, '[4]')
  assert.equal(withClass(root, 'is-target')[0].children[0].textContent, '[5]')
  const fields = withClass(root, 'le-field'), index = fields[2].children[1]
  index.value = '-1'
  await click(root, '应用参数，从头观察')
  assert.match(root.textContent, /插入下标应在/)
  assert.match(withClass(root, 'le-metrics')[0].textContent, /移动 1 次/)
  await click(root, '重置')
  assert.equal(index.value, '2')
  for (let i = 0; i < 5; i++) await click(root, '下一步 →')
  assert.match(withClass(root, 'le-metrics')[0].textContent, /length = 6.*移动 3 次/)
  assert.equal(button(root, '下一步 →').disabled, true)
})

await test('Git UI moves HEAD and branch labels, replays history, and resets without leaving stale SVG state', async () => {
  const { roots } = boot(), root = roots[1]
  await click(root, '创建分支')
  assert.match(withClass(root, 'le-head')[0].textContent, /HEAD → main → C0/)
  const branches = withClass(root, 'le-field')[1].children[1]; branches.value = 'feature'
  await click(root, '切换分支'); await click(root, '新建空提交')
  assert.match(withClass(root, 'le-head')[0].textContent, /HEAD → feature → C1/)
  await click(root, '← 回看上一步')
  assert.match(withClass(root, 'le-head')[0].textContent, /HEAD → feature → C0/)
  await click(root, '回看下一步 →')
  assert.match(withClass(root, 'le-head')[0].textContent, /HEAD → feature → C1/)
  await click(root, '重置')
  for (let i = 0; i < 8; i++) await click(root, '示范下一条')
  assert.match(withClass(root, 'le-head')[0].textContent, /HEAD → main → C2/)
  assert.equal(withClass(root, 'le-commit').length, 4)
  assert.equal(button(root, '示范下一条').disabled, true)
})

await test('barycentric UI supports keyboard, pointer capture, boundary colors and out-of-triangle feedback', async () => {
  const { roots } = boot(), root = roots[2]
  const svg = descendants(root).find(item => item.tagName === 'SVG')
  let prevented = false
  await svg.emit('keydown', { key: 'ArrowRight', shiftKey: true, preventDefault: () => { prevented = true } })
  assert.equal(prevented, true); assert.match(withClass(root, 'le-metrics')[0].textContent, /0\.550, 0\.400/)
  await click(root, '3. 插值颜色'); await click(root, '顶点 A')
  assert.match(withClass(root, 'le-color')[0].textContent, /RGB = \(255, 0, 0\)/)
  await svg.emit('pointerdown', { button: 0, pointerId: 1, clientX: 260, clientY: 200 })
  assert.equal(svg.hasPointerCapture(1), true)
  assert.match(withClass(root, 'le-color')[0].textContent, /RGB = \(85, 85, 85\)/)
  await svg.emit('pointercancel', { pointerId: 1 }); assert.equal(svg.hasPointerCapture(1), false)
  await click(root, '三角形外')
  assert.match(withClass(root, 'le-color')[0].textContent, /不着色/)
  assert.ok(withClass(root, 'is-negative').length > 0)
  await click(root, '重置'); assert.equal(withClass(root, 'le-weights')[0].hidden, true)
})

await test('PJAX cancellation preserves progress, replaced DOM mounts once, and code transfer remains explicit', async () => {
  const { roots, window, sent, event } = boot(), original = roots[0]
  await click(original, '下一步 →')
  const count = descendants(original).length
  event('pjax:cancel'); event('pjax:error'); event('pjax:complete')
  assert.equal(descendants(original).length, count)
  assert.match(withClass(original, 'le-metrics')[0].textContent, /移动 1 次/)
  assert.equal(sent.length, 0)
  await click(original, '把当前实验代码放进练习台 ↗')
  assert.equal(sent.length, 1); assert.equal(sent[0].language, 'python'); assert.equal(sent[0].sourceUrl, 'https://example.invalid/article/')
  assert.ok(sent[0].code.includes('A[index] = 99'))
  window.LEARNING_LAB.openSnippet = async () => ({ loaded: false })
  await click(original, '把当前实验代码放进练习台 ↗'); assert.match(original.textContent, /已取消，原草稿保留/)
  roots[0] = section('array'); event('pjax:complete')
  assert.equal(roots[0].dataset.experimentMounted, 'yes'); assert.match(withClass(roots[0], 'le-metrics')[0].textContent, /移动 0 次/)
})
