import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const source = readFileSync(root + 'source/js/mao-controls.js', 'utf8')
const css = readFileSync(root + 'source/css/mao-controls.css', 'utf8')
const tick = () => new Promise(resolve => setImmediate(resolve))
let passed = 0
async function test (name, fn) {
  try { await fn(); passed++; console.log('  ✓ ' + name) }
  catch (error) { console.error('  ✗ ' + name, error); process.exitCode = 1 }
}

function boot ({ action, change, retry, width = 1440, height = 900, visual = null } = {}) {
  function events (target) {
    target.listeners = new Map()
    target.addEventListener = (type, fn, options) => {
      const list = target.listeners.get(type) || []
      list.push({ fn, options }); target.listeners.set(type, list)
    }
    target.removeEventListener = (type, fn, options) => {
      target.listeners.set(type, (target.listeners.get(type) || []).filter(item => item.fn !== fn || item.options !== options))
    }
    target.fire = (type, props = {}) => {
      const event = { target, key: '', preventDefault () { this.prevented = true }, stopPropagation () { this.stopped = true }, ...props }
      for (const { fn } of [...(target.listeners.get(type) || [])]) fn(event)
      return event
    }
    target.listenerCount = () => [...target.listeners.values()].reduce((sum, list) => sum + list.length, 0)
    return target
  }
  let document
  function make (tag) {
    const node = events({
      tagName: tag.toUpperCase(), children: [], parentElement: null, attrs: new Map(), dataset: {}, style: {},
      hidden: false, disabled: false, checked: false, value: '', textContent: '', className: '',
      setAttribute (key, value) { this.attrs.set(key, String(value)) },
      getAttribute (key) { return this.attrs.get(key) ?? null },
      appendChild (child) { child.parentElement = this; this.children.push(child); return child },
      contains (child) { return this === child || this.children.some(item => item.contains(child)) },
      remove () { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = null },
      focus () { document.activeElement = this },
      getBoundingClientRect () {
        if (this.id === 'mao-toggle') return { left: 20, top: 650, right: 74, bottom: 704, width: 54, height: 54 }
        const settings = this.children.find(child => child.className === 'mao-controls-settings')
        return { left: 0, top: 0, width: parseFloat(this.style.width) || 350, height: Math.min(settings?.hidden ? 310 : 900, parseFloat(this.style.maxHeight) || 900) }
      }
    })
    return node
  }
  function walk (node) { return [node, ...node.children.flatMap(walk)] }
  const body = make('body')
  document = events({ body, activeElement: body, createElement: make,
    contains: node => body.contains(node),
    getElementById: id => walk(body).find(node => node.id === id) || null })
  const button = make('button'); button.id = 'mao-toggle'; body.appendChild(button)
  const stage = make('div'); stage.id = 'mao-stage'; body.appendChild(stage)
  const canvas = make('canvas'); stage.appendChild(canvas)
  const article = make('p'); body.appendChild(article)
  let selected = '', anchorNode = article
  const window = events({ innerWidth: width, innerHeight: height,
    getSelection: () => ({ anchorNode, toString: () => selected }) })
  if (visual) window.visualViewport = events(visual)
  let current = { side: 'right', size: 'medium', bottomRatio: 0, compact: false, autoCompact: true, voice: false, chatSync: true, idleSeconds: 150, quiet: false, power: 'auto' }
  let status = { phase: 'idle', message: '' }
  const changes = [], actions = []
  let retries = 0
  const sandbox = { window, document, console }
  vm.runInNewContext(source, sandbox)
  const controls = window.MAO_CONTROLS.create({
    button, getSettings: () => current, getStatus: () => status,
    onSettingsChange: patch => { changes.push(patch); if (change) return change(patch); current = { ...current, ...patch } },
    onAction: (...args) => { actions.push(args); return action?.(...args) },
    onRetry: () => { retries++; return retry?.() }
  })
  const byClass = value => walk(body).find(node => node.className.split(' ').includes(value))
  return {
    controls, document, window, body, button, canvas, article, changes, actions,
    trigger: byClass('mao-controls-trigger'), panel: byClass('mao-controls-panel'),
    settings: byClass('mao-controls-settings'), notice: byClass('mao-controls-notice'),
    statusText: byClass('mao-controls-status').children[0], retryButton: byClass('mao-controls-retry'),
    closeButton: byClass('mao-controls-close'), selectionHint: byClass('mao-controls-hint'),
    settingsToggle: byClass('mao-controls-settings-toggle'),
    field: name => walk(body).find(node => node.name === name),
    action: name => walk(body).find(node => node.dataset.action === name),
    retries: () => retries,
    setStatus: value => { status = value; controls.refresh() },
    setSettings: value => { current = { ...current, ...value }; controls.refresh() },
    select: (text, node = article, emit = true) => { selected = text; anchorNode = node; if (emit) document.fire('selectionchange') },
    pointer: node => document.fire('pointerdown', { target: node }),
    all: () => walk(body)
  }
}

console.log('\nMao 控件 · 明确操作与选区')
await test('初始化、刷新和展开不会保存设置、发聊天或重试', () => {
  const env = boot()
  assert.equal(env.panel.hidden, true)
  env.controls.open(); env.controls.refresh(); env.controls.showActions()
  assert.equal(env.changes.length, 0); assert.equal(env.actions.length, 0); assert.equal(env.retries(), 0)
  assert.equal(env.settings.hidden, true)
  env.controls.open(); assert.equal(env.settings.hidden, false)
})
await test('齿轮 pointerdown 捕获选区，默认聚焦清空后仍将原文交给解释', async () => {
  const env = boot()
  env.select('  原文 <script>只是文字</script>  ')
  env.pointer(env.trigger)
  env.select('') // 浏览器在 click 前取消选区
  env.trigger.focus(); env.trigger.fire('click')
  env.action('explain-selection').fire('click')
  await tick()
  assert.equal(env.actions[0][0], 'explain-selection')
  assert.equal(env.actions[0][1].text, '原文 <script>只是文字</script>')
  assert.equal(env.panel.hidden, true)
})
await test('人物画布入口保留点击前选区且限制 6000 字，不切断代理对', async () => {
  const env = boot()
  env.select('猫😀'.repeat(4000)); env.pointer(env.canvas); env.select('')
  env.controls.showActions()
  assert.match(env.selectionHint.textContent, /选区已截断.*4000.*6000/)
  env.controls.refresh()
  assert.match(env.selectionHint.textContent, /已截断/, '聚焦清除实际选区后仍保留截断提示')
  env.action('explain-selection').fire('click'); await tick()
  const text = env.actions[0][1].text
  assert.equal(text.length, 6000)
  assert.equal(Array.from(text).length, 4000)
  assert.equal(text, '猫😀'.repeat(2000))
})
await test('截断不留下半个 emoji，提示跟随新选区更新', async () => {
  const env = boot()
  env.select('字'.repeat(5999) + '😀后文'); env.pointer(env.trigger); env.select('')
  env.controls.open()
  assert.match(env.selectionHint.textContent, /已截断.*5999/)
  env.action('explain-selection').fire('click'); await tick()
  assert.equal(env.actions[0][1].text, '字'.repeat(5999))
  env.select('新的短选区'); env.controls.open()
  assert.doesNotMatch(env.selectionHint.textContent, /截断/)
  assert.match(env.selectionHint.textContent, /已选中 5 字/)
})
await test('未选择时给出提示，不发空解释；普通页面点击清掉旧选区', async () => {
  const env = boot()
  env.select('旧内容'); env.pointer(env.canvas); env.select('')
  env.pointer(env.article); env.controls.showActions()
  env.action('explain-selection').fire('click'); await tick()
  assert.equal(env.actions.length, 0)
  assert.match(env.notice.textContent, /先在页面选中/)
  assert.equal(env.notice.hidden, false)
})
await test('打开后面板内选中文字不会替换正文快照', async () => {
  const env = boot()
  env.select('正文'); env.controls.showActions()
  env.select('菜单文字', env.closeButton); env.pointer(env.closeButton)
  env.action('explain-selection').fire('click'); await tick()
  assert.equal(env.actions[0][1].text, '正文')
})
await test('总结与日程仅从明确点击回调，不附带选区参数', async () => {
  const env = boot()
  for (const name of ['summarize', 'schedule']) { env.controls.showActions(); env.action(name).fire('click'); await tick() }
  assert.deepEqual(env.actions.map(args => [args[0], args[1]]), [['summarize', undefined], ['schedule', undefined]])
})
await test('成功动作恢复原焦点；外部已聚焦 Nana 时不抢回', async () => {
  const env = boot()
  env.button.focus(); env.controls.showActions()
  env.action('summarize').focus(); env.action('summarize').fire('click'); await tick()
  assert.equal(env.document.activeElement, env.button)
  let external
  const other = boot({ action: () => { external.focus() } })
  external = other.article
  other.button.focus(); other.controls.showActions()
  other.action('summarize').fire('click'); await tick()
  assert.equal(other.document.activeElement, external)
})
await test('异步动作抑制重复点击，失败后保持可操作', async () => {
  let reject
  const env = boot({ action: () => new Promise((_, no) => { reject = no }) })
  env.controls.showActions()
  env.action('summarize').fire('click'); env.action('summarize').fire('click')
  assert.equal(env.actions.length, 1); assert.equal(env.action('schedule').disabled, true)
  reject(new Error('offline')); await tick()
  assert.equal(env.action('schedule').disabled, false)
  assert.equal(env.panel.hidden, false); assert.match(env.notice.textContent, /没有完成/)
})

console.log('\nMao 控件 · 设置和状态')
await test('十项设置产生类型正确的局部 patch；滑动预览不保存', async () => {
  const env = boot(); env.controls.open()
  const changes = [
    ['side', 'left'], ['size', 'large'], ['bottomRatio', .37], ['compact', true], ['autoCompact', false],
    ['voice', true], ['chatSync', false], ['idleSeconds', 0], ['quiet', true], ['power', 'saving']
  ]
  for (const [name, value] of changes) {
    const field = env.field(name)
    if (typeof value === 'boolean') field.checked = value
    else field.value = name === 'bottomRatio' ? '37' : String(value)
    if (name === 'bottomRatio') { const before = env.changes.length; field.fire('input'); assert.equal(env.changes.length, before) }
    field.fire('change'); await tick()
    assert.deepEqual(JSON.parse(JSON.stringify(env.changes.at(-1))), { [name]: value })
  }
})
await test('外部更新可刷新控件；保存拒绝时回退并提示', async () => {
  const env = boot({ change: () => Promise.reject(new Error('denied')) })
  env.setSettings({ voice: true, bottomRatio: .5 })
  assert.equal(env.field('voice').checked, true); assert.equal(env.field('bottomRatio').value, '50')
  env.field('voice').checked = false; env.field('voice').fire('change'); await tick()
  assert.equal(env.field('voice').checked, true); assert.match(env.notice.textContent, /没有保存成功/)
})
await test('加载及错误状态明确可见，重试抑制重复，状态文本只按文本显示', async () => {
  let release
  const env = boot({ retry: () => new Promise(resolve => { release = resolve }) })
  env.setStatus({ phase: 'loading', message: '正在加载…' })
  assert.equal(env.statusText.textContent, '正在加载…'); assert.equal(env.retryButton.hidden, false)
  env.retryButton.fire('click'); env.retryButton.fire('click'); assert.equal(env.retries(), 1)
  assert.equal(env.retryButton.disabled, true)
  release(); await tick(); assert.equal(env.retryButton.disabled, false)
  env.setStatus({ phase: 'error', message: '<img src=x onerror=alert(1)>' })
  assert.equal(env.statusText.textContent, '<img src=x onerror=alert(1)>')
  assert.equal(env.statusText.children.length, 0)
  env.setStatus({ phase: 'ready', message: '' }); assert.equal(env.retryButton.hidden, true)
})

console.log('\nMao 控件 · 键盘、视口与销毁')
await test('Escape 关闭恢复原焦点；面板再次打开也保持唯一实例', () => {
  const env = boot()
  env.button.focus(); env.controls.showActions()
  assert.equal(env.document.activeElement, env.closeButton)
  const event = env.document.fire('keydown', { key: 'Escape' })
  assert.equal(env.panel.hidden, true); assert.equal(env.document.activeElement, env.button)
  assert.equal(event.prevented, true); assert.equal(event.stopped, true)
  env.controls.open(); env.controls.open()
  assert.equal(env.all().filter(node => node.className === 'mao-controls-panel').length, 1)
  assert.equal(env.trigger.getAttribute('aria-expanded'), 'true')
})
await test('点击外部关闭且不抢外部焦点；设置展开按钮可单独操作', () => {
  const env = boot(); env.controls.showActions()
  env.settingsToggle.fire('click'); assert.equal(env.settings.hidden, false)
  assert.equal(env.settingsToggle.getAttribute('aria-expanded'), 'true')
  env.article.focus(); env.pointer(env.article)
  assert.equal(env.panel.hidden, true); assert.equal(env.document.activeElement, env.article)
})
await test('窄屏及可视视口变化时，整个面板保持在可见范围内', () => {
  const env = boot({ width: 320, height: 480, visual: { width: 320, height: 280, offsetLeft: 5, offsetTop: 120 } })
  env.controls.open()
  const inside = () => {
    const { panel, window } = env; const v = window.visualViewport
    const x = parseFloat(panel.style.left), y = parseFloat(panel.style.top)
    assert.ok(x >= v.offsetLeft && x + parseFloat(panel.style.width) <= v.offsetLeft + v.width)
    assert.ok(y >= v.offsetTop && y + parseFloat(panel.style.maxHeight) <= v.offsetTop + v.height)
  }
  inside()
  Object.assign(env.window.visualViewport, { width: 240, height: 200, offsetLeft: 40, offsetTop: 180 })
  env.window.visualViewport.fire('resize'); inside()
})
await test('destroy 清理节点、全局监听，异步回调晚到不复活控件', async () => {
  let release
  const env = boot({ action: () => new Promise(resolve => { release = resolve }), visual: { width: 400, height: 600 } })
  env.trigger.focus(); env.controls.open(); env.action('summarize').fire('click')
  env.controls.destroy(); env.controls.destroy()
  assert.equal(env.document.contains(env.panel), false); assert.equal(env.document.contains(env.trigger), false)
  assert.equal(env.document.activeElement, env.button)
  assert.equal(env.document.listenerCount(), 0); assert.equal(env.window.listenerCount(), 0)
  assert.equal(env.window.visualViewport.listenerCount(), 0)
  release(); await tick(); env.controls.open(); env.controls.refresh()
  assert.equal(env.document.contains(env.panel), false)
})
await test('CSS 保留原角落间距、小入口、隐藏语义与减少动画偏好', () => {
  assert.match(css, /--corner-left/); assert.match(css, /--corner-slot-2/)
  assert.match(css, /width:\s*32px/); assert.match(css, /\[hidden\][^{]*\{\s*display:\s*none !important/)
  assert.match(css, /prefers-reduced-motion/); assert.match(css, /\.mao-controls-trigger\s*\{\s*translate:\s*0 -180px/)
})
console.log(`\n${passed} Mao 控件回归通过`)
