/* 无障碍补名字：分享按钮只补认识的站点、不覆盖已有的名字、PJAX 换页后重补、重复加载不重复挂监听；导航区各有名字；
 * 横向溢出的代码块能用 Tab 聚焦，没溢出的不加。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../../../source/js/a11y-labels.js', import.meta.url), 'utf8')
const link = site => {
  const attrs = new Map()
  return { classList: ['social-share-icon', 'icon-' + site], hasAttribute: n => attrs.has(n), setAttribute: (n, v) => attrs.set(n, v), getAttribute: n => attrs.get(n) ?? null }
}
const element = () => {
  const attrs = new Map()
  return { hasAttribute: n => attrs.has(n), setAttribute: (n, v) => attrs.set(n, v), getAttribute: n => attrs.get(n) ?? null }
}
const table = (scrollWidth, clientWidth) => Object.assign(element(), { scrollWidth, clientWidth })
const boot = (links, regions = {}, tables = []) => {
  const listeners = [], timers = []
  const doc = { readyState: 'complete', querySelectorAll: selector => selector.includes('figure.highlight') ? tables : links, querySelector: selector => regions[selector] || null, addEventListener: (type, fn) => listeners.push(['document', type, fn]) }
  const win = { addEventListener: (type, fn) => listeners.push(['window', type, fn]) }
  const context = vm.createContext({ window: win, document: doc, setTimeout: fn => timers.push(fn) })
  vm.runInContext(source, context)
  return { listeners, run: () => timers.splice(0).forEach(fn => fn()), again: () => vm.runInContext(source, context) }
}

test('known share icons get a spoken name and existing names are kept', () => {
  const links = [link('facebook'), link('wechat'), link('unknown-site'), link('x')]
  links[3].setAttribute('aria-label', '自定义')
  const h = boot(links)
  h.run()
  assert.equal(links[0].getAttribute('aria-label'), '分享到 Facebook')
  assert.equal(links[1].getAttribute('aria-label'), '分享到微信（扫码）')
  assert.equal(links[2].getAttribute('aria-label'), null)
  assert.equal(links[3].getAttribute('aria-label'), '自定义')
})

test('labels are applied again after a PJAX page change and the script installs once', () => {
  const links = []
  const h = boot(links)
  links.push(link('weibo'))
  const pjax = h.listeners.find(([target, type]) => target === 'document' && type === 'pjax:complete')
  assert.ok(pjax, 'pjax:complete 没有挂上')
  pjax[2](); h.run()
  assert.equal(links[0].getAttribute('aria-label'), '分享到微博')
  const count = h.listeners.length
  h.again()
  assert.equal(h.listeners.length, count)
})

test('theme navigation landmarks get distinct names and the sidebar becomes a navigation region', () => {
  const regions = { '#nav': element(), '#pagination': element(), '#sidebar-menus': element() }
  regions['#pagination'].setAttribute('aria-label', '已有名字')
  const h = boot([], regions)
  h.run()
  assert.equal(regions['#nav'].getAttribute('aria-label'), '站点导航')
  assert.equal(regions['#nav'].getAttribute('role'), null, '<nav> 本身就是导航区，不用再加 role')
  assert.equal(regions['#pagination'].getAttribute('aria-label'), '已有名字')
  assert.equal(regions['#sidebar-menus'].getAttribute('role'), 'navigation')
  assert.equal(regions['#sidebar-menus'].getAttribute('aria-label'), '侧边菜单')
})

test('only code blocks that actually scroll sideways become keyboard-focusable', () => {
  const wide = table(900, 600), fits = table(600, 600), kept = table(900, 600)
  kept.setAttribute('tabindex', '-1')
  const h = boot([], {}, [wide, fits, kept])
  h.run()
  assert.equal(wide.getAttribute('tabindex'), '0')
  assert.equal(wide.getAttribute('aria-label'), '代码，可以左右滚动')
  assert.equal(fits.getAttribute('tabindex'), null, '没溢出的代码块不该多一个 Tab 停顿')
  assert.equal(kept.getAttribute('tabindex'), '-1', '别人设过的 tabindex 不能覆盖')
})
