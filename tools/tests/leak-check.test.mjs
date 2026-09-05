/* 上锁检查的判据测试。
 *
 * 为什么需要它：这一项坏过两次，两次都是**同一种坏法**——
 * 把「链到一个上锁页面」当成了泄漏。
 *
 *   第一次（全站上锁之前的旧版）：/archives/ 里有文章链接 → 报泄漏。
 *   第二次（2026-08-19 重写之后）：首页导航栏上挂着 /archives/、/categories/、
 *   /tags/ → 报「发现 1 处漏洞」。它每天都报，一直报到 2026-09-05 才被发现。
 *
 * 两次都不会红、不会报错、构建照样全绿 —— 它只是每天在邮件里喊一声狼来了。
 * 而这一项恰恰是「真漏了必须听见」的那一项，天天误报等于把它关掉了。
 * 所以判据本身值得钉死：**只有文章路径出现在公开页上才算泄漏。**
 *
 * 还有一条同样钉在这里：子检查抛异常时不许覆盖已经查实的 bad。
 * 原来共用一个 try，catch 里无条件降成 warn —— 一次网络抖动就能把
 * 真漏洞盖成一行「检查失败：terminated」。
 *
 * 全部用打桩的 fetch，不打真网络。
 */
import assert from 'node:assert/strict'

process.env.SITE_URL = 'https://example.invalid'
const SITE = 'https://example.invalid'
const { checkLeak } = await import('../daily-report/health.mjs')

let pass = 0
const check = async (name, fn) => {
  try { await fn(); console.log('  ✓ ' + name); pass++ }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + (e.message || e)); process.exitCode = 1 }
}

const POSTS = ['/2026/08/25/Linux-Command-Line-Chapter1/', '/2026/09/05/Git-Chapter1-Repository-Basics/']
const NAV = ['/archives/', '/categories/', '/tags/', '/extra/', '/in-class/']

const manifest = () =>
  'window.NOIMPTY_PRIVACY = Object.freeze(' + JSON.stringify({
    entries: [...POSTS, ...NAV].map(path => ({ path, section: '内部' })),
    publicPaths: ['/'],
    lockAllExceptPublic: true
  }) + ');\n'

// 线上那份是 2 MB 上下，这里按 200 KB 造，好让「只读开头」和「整包拉」量级上分得开
const CIPHER = '{"v":1,"alg":"AES-GCM","kdf":"PBKDF2-SHA256/120000","data":"' + 'A'.repeat(200 * 1024) + '"}'
const PLAIN = '<?xml version="1.0"?><search><entry><title>x</title><content>正文</content></entry></search>'

/* 打桩的 fetch。opts.search 换 search.xml 的内容，opts.throwOn 让某个路径抛异常。
 * 返回真的 Response，好让被测代码走到 headers.get / body.getReader 那条路上。 */
const stubFetch = (opts = {}) => {
  const pulled = { bytes: 0 }
  const impl = async url => {
    const path = String(url).replace(SITE, '')
    if (opts.throwOn && path.startsWith(opts.throwOn)) throw new TypeError('terminated')
    if (path === '/js/protected-manifest.js') return new Response(manifest(), { status: 200 })
    if (path === '/atom.xml' || path === '/sitemap.xml') return new Response('', { status: 404 })
    if (path === '/robots.txt') return new Response('User-agent: *\nDisallow: /\n', { status: 200 })
    if (path === '/search.xml') {
      const body = opts.search === undefined ? CIPHER : opts.search
      const buf = new TextEncoder().encode(body)
      // 分块吐，并记下对方实际拉走了多少 —— 用来验证「只读开头一小截」
      let i = 0
      const stream = new ReadableStream({
        pull (c) {
          if (i >= buf.length) return c.close()
          const chunk = buf.subarray(i, i + 1024)
          i += chunk.length; pulled.bytes += chunk.length
          c.enqueue(chunk)
        }
      })
      return new Response(stream, { status: 200, headers: { 'content-length': String(buf.length) } })
    }
    return new Response('', { status: 404 })
  }
  return { impl, pulled }
}

const withFetch = async (impl, fn) => {
  const real = globalThis.fetch
  globalThis.fetch = impl
  try { return await fn() } finally { globalThis.fetch = real }
}

const crawlOf = homeBody => ({
  html: new Map([[SITE + '/', homeBody], [SITE + '/extra/', `<a href="${POSTS[0]}">文章</a>`]]),
  targets: new Set(),
  pageCount: 2
})

const NAV_ONLY = NAV.map(p => `<a href="${p}">导航</a>`).join('')

console.log('\n上锁检查 · 什么算泄漏')

await check('★★ 公开页上的导航链接不算泄漏（这次的回归）', async () => {
  const { impl } = stubFetch()
  const out = await withFetch(impl, () => checkLeak(crawlOf(NAV_ONLY)))
  assert.equal(out.level, 'ok', '导航链接被当成了泄漏：' + out.detail)
  assert.ok(!out.items.some(i => i.leak), '不该有任何 leak 项')
})

await check('★★ 公开页上出现文章链接 = 泄漏', async () => {
  const { impl } = stubFetch()
  const out = await withFetch(impl, () => checkLeak(crawlOf(NAV_ONLY + `<a href="${POSTS[0]}">x</a>`)))
  assert.equal(out.level, 'bad')
  assert.match(out.detail, /发现 1 处漏洞/)
  const hit = out.items.find(i => i.leak)
  assert.match(hit.note, /1 篇文章/)
})

await check('★★ 上锁页面里有文章链接是正常的', async () => {
  // crawlOf 里的 /extra/ 挂着一篇文章链接，但它自己也在锁后面
  const { impl } = stubFetch()
  const out = await withFetch(impl, () => checkLeak(crawlOf(NAV_ONLY)))
  assert.equal(out.level, 'ok')
})

console.log('\n上锁检查 · 出错的时候')

await check('★★ 子检查抛异常，不许把已查实的 bad 降级', async () => {
  const { impl } = stubFetch({ throwOn: '/search.xml' })
  const out = await withFetch(impl, () => checkLeak(crawlOf(NAV_ONLY + `<a href="${POSTS[1]}">x</a>`)))
  assert.equal(out.level, 'bad', '真漏洞被网络抖动盖成了 ' + out.level)
  assert.match(out.detail, /发现 1 处漏洞/)
  assert.ok(out.items.some(i => /没查成/.test(i.note)), '应当照实说有一项没查成')
})

await check('没查出漏洞但有子检查失败 → warn，并说清几项没查成', async () => {
  const { impl } = stubFetch({ throwOn: '/search.xml' })
  const out = await withFetch(impl, () => checkLeak(crawlOf(NAV_ONLY)))
  assert.equal(out.level, 'warn')
  assert.match(out.detail, /1 项没查成/)
})

await check('★★ 取不到锁清单 → warn，不是默认放行', async () => {
  const impl = async url => String(url).includes('protected-manifest')
    ? new Response('', { status: 404 })
    : new Response('', { status: 200 })
  const out = await withFetch(impl, () => checkLeak(crawlOf(NAV_ONLY)))
  assert.equal(out.level, 'warn')
  assert.match(out.detail, /锁清单没生成/)
})

console.log('\n上锁检查 · search.xml')

await check('★★ 明文的 search.xml = 泄漏', async () => {
  const { impl } = stubFetch({ search: PLAIN })
  const out = await withFetch(impl, () => checkLeak(crawlOf(NAV_ONLY)))
  assert.equal(out.level, 'bad')
  assert.ok(out.items.some(i => i.leak && /明文/.test(i.note)))
})

await check('密文的 search.xml 只读开头一小截，不整包拉', async () => {
  const { impl, pulled } = stubFetch()
  const out = await withFetch(impl, () => checkLeak(crawlOf(NAV_ONLY)))
  assert.equal(out.level, 'ok')
  // 判密文只用得着开头 2KB。流会预读一块，所以实际拉走的是 2-3 块，不是整包。
  assert.ok(pulled.bytes <= 8 * 1024,
    `拉得太多了：拉走 ${pulled.bytes} / 共 ${CIPHER.length} 字节`)
  assert.ok(out.items.some(i => /已加密/.test(i.note)))
})

await check('空的 search.xml 不算泄漏', async () => {
  const { impl } = stubFetch({ search: '<?xml version="1.0"?><search></search>' })
  const out = await withFetch(impl, () => checkLeak(crawlOf(NAV_ONLY)))
  assert.equal(out.level, 'ok')
  assert.ok(out.items.some(i => /是空的/.test(i.note)))
})

console.log(`\n${pass} 项通过`)
