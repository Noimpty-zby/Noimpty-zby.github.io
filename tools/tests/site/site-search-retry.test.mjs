/* Run the project's index bridge with Butterfly's actual loader/open handler offline. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const bridge = readFileSync('source/js/noimpty-search.js', 'utf8')
const theme = readFileSync('node_modules/hexo-theme-butterfly/source/js/search/local-search.js', 'utf8')
const XML = '<search><entry><title>矩阵转置</title><url>/matrix/</url><content>交换行列</content></entry></search>'
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)) }
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
const element = () => ({
  children: [], textContent: '', disabled: false, style: {}, listeners: new Map(),
  addEventListener(type, handler) { this.listeners.set(type, handler) },
  replaceChildren(...children) { this.children = children },
  click() { if (!this.disabled) this.listeners.get('click')?.() },
  focus() {}
})
const boot = fetchImpl => {
  const loading = element(), input = element(), events = new EventTarget()
  let loaded = 0, requests = 0
  events.addEventListener('search:loaded', () => { loaded++ })
  const document = {
    getElementById: id => id === 'loading-database' ? loading : null,
    createElement: () => element(), addEventListener() {}, removeEventListener() {}
  }
  const window = {
    location: { origin: 'https://blog.test' }, NOIMPTY_GATE: { passphrase: () => 'test' },
    fetch: (...args) => { requests++; return fetchImpl(...args) },
    addEventListener: events.addEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events)
  }
  const ctx = vm.createContext({
    window, document, URL, Response, AbortController, Event, DOMException, setTimeout: (fn, ms) => ms === 300 ? 0 : setTimeout(fn, ms), clearTimeout,
    console: { error() {} },
    DOMParser: class {
      parseFromString(text) {
        const entries = [...text.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(match => ({
          querySelector: tag => ({ textContent: match[1].match(new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>'))?.[1] || '' })
        }))
        return { querySelector: () => null, querySelectorAll: () => entries }
      }
    }
  })
  // Match real injection order: bridge first, then the theme, then window.load.
  vm.runInContext(bridge, ctx)
  ctx.fetch = (...args) => window.fetch(...args)
  vm.runInContext(theme.slice(0, theme.indexOf("window.addEventListener('load'")) + '\nglobalThis.ThemeSearch = LocalSearch', ctx)
  window.dispatchEvent(new Event('load'))
  ctx.localSearch = new ctx.ThemeSearch({ path: '/search.xml' })
  Object.assign(ctx, {
    $input: input, $searchMask: element(), $searchDialog: element(),
    btf: { overflowPaddingR: { add() {} }, animateIn() {} },
    debouncedInputEvent() {}, handleEscape() {}, fixSafariHeight() {}, onResize() {}
  })
  const open = theme.slice(theme.indexOf('  const openSearch ='), theme.indexOf('  const closeSearch ='))
  vm.runInContext('let loadFlag = false\n' + open + '\nglobalThis.open = openSearch', ctx)
  return { ctx, loading, window, requests: () => requests, loaded: () => loaded }
}
let passed = 0
const check = async (name, fn) => {
  try { await fn(); passed++; console.log('  ✓ ' + name) }
  catch (error) { process.exitCode = 1; console.error('  ✗ ' + name, error) }
}

await check('temporary failure offers same-page retry without caching an empty theme index', async () => {
  const pending = deferred()
  let attempt = 0
  const h = boot(async () => {
    if (++attempt === 1) throw new Error('temporary network failure')
    await pending.promise
    return new Response(XML)
  })
  h.ctx.open()
  await flush()
  h.ctx.open()
  await flush()
  assert.equal(h.requests(), 1, 'the theme itself never retries when reopening')
  assert.equal(h.ctx.localSearch.isfetched, false, 'failure must not become a permanently fetched empty index')
  assert.equal(h.loaded(), 0)
  const retry = h.loading.children.find(child => child.textContent === '重试')
  assert.ok(retry, 'failed first load must leave a visible retry button')
  assert.match(h.loading.children.map(child => child.textContent).join(''), /读取|索引|搜索/)
  retry.click()
  retry.click()
  await flush()
  assert.equal(h.requests(), 2, 'repeated clicks share the retry request')
  pending.resolve()
  await flush()
  assert.equal(h.ctx.localSearch.isfetched, true)
  assert.equal(h.ctx.localSearch.datas[0].title, '矩阵转置')
  assert.equal(h.loaded(), 1, 'theme receives its normal successful-load event once')
  h.ctx.open()
  await flush()
  assert.equal(h.requests(), 2, 'reopening a successful search uses the index cache')
})

await check('a successful first load still uses one request and normal theme parsing', async () => {
  const h = boot(async () => new Response(XML))
  h.ctx.open()
  await flush()
  assert.equal(h.requests(), 1)
  assert.equal(h.loaded(), 1)
  assert.equal(h.ctx.localSearch.datas[0].content, '交换行列')
  assert.equal(h.ctx.localSearch.getResultItems(['unrelated']).length, 0)
})

await check('an HTTP failure remains retryable with its explanation instead of claiming no matches', async () => {
  let offline = true
  const h = boot(async () => offline ? new Response('', { status: 503 }) : new Response(XML))
  h.ctx.open()
  await flush()
  assert.equal(h.ctx.localSearch.isfetched, false)
  assert.equal(h.loaded(), 0)
  offline = false
  const retry = h.loading.children.find(child => child.textContent === '重试')
  assert.ok(retry)
  retry.click()
  await flush()
  assert.equal(h.ctx.localSearch.datas.length, 1)
  assert.equal(h.requests(), 2)
})

console.log('\n' + passed + ' theme search retry checks passed')
