/* 站内页面清单的来源测试。
 *
 * 为什么需要它：巡逻和日报的死链扫描都要先拿到「站上有哪些页面」。
 * 这份清单原本取自 sitemap.xml —— 而 2026-08-19 全站上锁之后，
 * lockdown 会主动删掉 sitemap（pages.yml 的自检还会在它存在时让部署失败）。
 * 于是这两个功能每天开工第一步就取不到东西，各自打一行日志返回空：
 *
 *     巡逻   → 「取不到 sitemap，巡逻取消」，checked: 0
 *     死链   → 「取不到 sitemap，没法扫」，那一格降级成 warn
 *
 * 工作流全绿、日报照发，只是里面什么都没有。这种坏法不会报错、
 * 不会红、也不会有人发现 —— 所以它值得一个测试钉住。
 *
 * 现在清单改从锁清单 /js/protected-manifest.js 拿。这里用打桩的 fetch
 * 验证解析，不打真网络。
 */
import assert from 'node:assert/strict'
import { sitePages, PAGE_RE } from '../nanaly/probe.mjs'

let pass = 0
const check = async (name, fn) => {
  try { await fn(); console.log('  ✓ ' + name); pass++ }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + (e.message || e)); process.exitCode = 1 }
}

const SITE = 'https://example.invalid'

// 锁清单的真实形状：window.NOIMPTY_PRIVACY = Object.freeze({...});
const manifest = (entries, publicPaths = ['/']) =>
  'window.NOIMPTY_PRIVACY = Object.freeze(' +
  JSON.stringify({ entries, publicPaths, lockAllExceptPublic: true }) + ');\n'

const withFetch = async (impl, fn) => {
  const real = globalThis.fetch
  globalThis.fetch = impl
  try { return await fn() } finally { globalThis.fetch = real }
}

const serving = body => async url => {
  assert.ok(String(url).endsWith('/js/protected-manifest.js'), '取错了文件：' + url)
  return { ok: true, text: async () => body }
}

console.log('\n站内页面清单 · 从锁清单解析')

await check('★★ 解析出全部页面，并且带上首页', async () => {
  const body = manifest([
    { path: '/2026/08/25/Linux-Command-Line-Chapter1/', section: '内部' },
    { path: '/extra/ai-infra/', section: '课外' },
    { path: '/archives/2026/08/', section: '归档' }
  ])
  const out = await withFetch(serving(body), () => sitePages(SITE))
  assert.deepEqual(out, [
    `${SITE}/`,
    `${SITE}/2026/08/25/Linux-Command-Line-Chapter1/`,
    `${SITE}/extra/ai-infra/`,
    `${SITE}/archives/2026/08/`
  ])
})

await check('★★ 认得出哪些是文章页（巡逻只逛这些）', async () => {
  const body = manifest([
    { path: '/2026/08/25/Linux-Command-Line-Chapter1/', section: '内部' },
    { path: '/extra/ai-infra/', section: '课外' },
    { path: '/tags/Shell/', section: '标签' }
  ])
  const out = await withFetch(serving(body), () => sitePages(SITE))
  const posts = out.filter(u => PAGE_RE.test(u.slice(SITE.length)))
  assert.deepEqual(posts, [`${SITE}/2026/08/25/Linux-Command-Line-Chapter1/`])
})

/* 锁清单里混着 17 条 /css/custom.css/ 这样的条目 —— Hexo 把 source/css、
 * source/js 底下的文件也算进 locals.pages，lockdown 又给每条补了末尾斜杠。
 * 对锁清单自己无害，但当页面索引用就会出事：请求它们必然 404，
 * 日报会把这 17 条当成死链报出来（真发生过，改用锁清单当天就报了）。 */
await check('★★ 滤掉资源路径，不把 /css/x.css/ 当成页面', async () => {
  const body = manifest([
    { path: '/life/', section: 'Life' },
    { path: '/css/custom.css/', section: '内部' },
    { path: '/js/noimpty-ai.js/', section: '内部' },
    { path: '/img/covers/a.svg', section: '内部' }
  ])
  const out = await withFetch(serving(body), () => sitePages(SITE))
  assert.deepEqual(out, [`${SITE}/`, `${SITE}/life/`],
    '资源路径混进了页面清单 —— 它们必然 404，会被当成死链报出来')
})

await check('末尾带斜杠的站点地址不会拼出双斜杠', async () => {
  const body = manifest([{ path: '/life/', section: 'Life' }])
  const out = await withFetch(serving(body), () => sitePages(SITE + '/'))
  assert.deepEqual(out, [`${SITE}/`, `${SITE}/life/`])
})

console.log('\n站内页面清单 · 取不到的时候')

/* 下面四条都必须返回 null，不能返回 []。
 * 调用方靠这个区分「站上真的没有页面」和「这次没取到」——
 * 后者要放弃本轮，而不是当成「一个页面都没有」的结论去写进报告。 */

await check('★★ HTTP 不是 200 → null（不是空数组）', async () => {
  const out = await withFetch(async () => ({ ok: false, status: 404, text: async () => '' }), () => sitePages(SITE))
  assert.equal(out, null)
})

await check('★★ 清单是空的 → null', async () => {
  const out = await withFetch(serving(manifest([])), () => sitePages(SITE))
  assert.equal(out, null)
})

await check('文件在但不是预期格式 → null，不抛', async () => {
  const out = await withFetch(serving('console.log("这不是锁清单")'), () => sitePages(SITE))
  assert.equal(out, null)
})

await check('网络直接抛异常 → null，不把异常冒出去', async () => {
  const out = await withFetch(async () => { throw new Error('ECONNRESET') }, () => sitePages(SITE))
  assert.equal(out, null)
})

console.log(`\n${pass} 项通过`)
