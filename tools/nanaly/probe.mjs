/* 判定一个地址是不是真的坏了。
 *
 * 这套东西是被一次难堪的误报逼出来的：并发扫自己的 GitHub Pages 会被限流，
 * 一大片请求直接连接失败，代码把它们当成死链报了出来 —— 连首页 `/` 都被
 * 报成打不开。一次这样的误报就够让人再也不信这个功能了。
 *
 * 所以定罪要过四道关：
 *   1. 第一遍只用来「怀疑」，不定罪
 *   2. 串行复核两次，加延迟、放宽超时，任何一次通过就判无罪
 *   3. 开工前先探一次首页当哨兵，首页都连不上就说明是本次网络的问题，整轮作废
 *   4. 坏的比例过高（多半是被限流了）也整轮作废
 *
 * patrol 和日报的健康检查共用这一份，别再各写一套。
 */

const T = ms => AbortSignal.timeout(ms)
export const sleep = ms => new Promise(r => setTimeout(r, ms))

export const hit = async (u, ms) => {
  try {
    let res = await fetch(u, { method: 'HEAD', signal: T(ms) })
    if (res.status === 405 || res.status === 501) res = await fetch(u, { signal: T(ms) })
    return { status: res.status, err: null }
  } catch (e) {
    return { status: 0, err: String(e.message || e).slice(0, 60) }
  }
}

// 什么算「有问题」：
//   站内：任何 4xx/5xx，或者连不上
//   站外：只认 404 / 410。403/429/超时都是反爬和抖动，不是坏了
export const verdictOf = (r, inside) => {
  if (r.err) return inside ? 'unreachable' : null
  if (inside) return r.status >= 400 ? 'http' : null
  return (r.status === 404 || r.status === 410) ? 'http' : null
}

// 两段式判定。返回 null = 无罪。
export const probeUrl = async (u, inside) => {
  let r = await hit(u, 15000)
  let v = verdictOf(r, inside)
  if (!v) return null
  for (let i = 0; i < 2; i++) {
    await sleep(1500 + i * 2000)
    r = await hit(u, 25000)
    v = verdictOf(r, inside)
    if (!v) return null
  }
  return { verdict: v, status: r.status, err: r.err }
}

/* 站内页面清单 —— 巡逻和日报的死链扫描都从这里拿种子。
 *
 * 以前这份清单取自 sitemap.xml。全站上锁之后 lockdown 把 sitemap 整个删掉了
 * （pages.yml 的上锁自检还会在它存在时直接让部署失败），于是这两个功能
 * 从 2026-08-19 起每天开工第一步就取不到东西：巡逻打一行「取不到 sitemap，
 * 巡逻取消」返回 0，日报的死链那格降级成「取不到 sitemap，没法扫」。
 * 工作流全绿、日报照发，只是里面什么都没有 —— 这种坏法没人会发现。
 *
 * 改用锁清单 /js/protected-manifest.js。拿它当索引反而更合适：
 *   - 构建时按 locals.posts + locals.pages 生成，比 sitemap 更全 ——
 *     分类页、标签页、按年月归档都在里面，而那些恰恰是最容易漏东西的地方
 *   - 必然存在且非空：pages.yml 的上锁自检第一条就是拿它当判据
 *   - 明文 JS，一个 GET 解析完，用的正则和 leakcheck.mjs 那份一致
 *
 * 解析不出来时返回 null（而不是空数组），好让调用方能区分
 * 「站上真的没有页面」和「这次没取到」—— 后者不该被当成结论。
 */
export const PAGE_RE = /^\/\d{4}\/\d{2}\/\d{2}\//

export const sitePages = async site => {
  const base = String(site).replace(/\/$/, '')
  try {
    const res = await fetch(`${base}/js/protected-manifest.js`, { signal: T(20000) })
    if (!res.ok) return null
    const body = await res.text()
    const m = body.match(/Object\.freeze\(([\s\S]*?)\);?\s*$/)
    if (!m) return null
    const data = JSON.parse(m[1].replace(/\)\s*$/, ''))
    /* 只留页面，滤掉资源。
     *
     * 锁清单里混着 17 条 /css/custom.css/ 这样的东西 —— Hexo 把 source/css、
     * source/js 底下的文件也算进 locals.pages，而 lockdown 的 normalizeWebPath
     * 会给每条路径补一个末尾斜杠。对锁清单自己没影响（没人会去访问
     * 「/css/custom.css/」这个地址），但当页面索引用就会出事：
     * 拿它去请求必然 404，日报会把这 17 条当成死链报出来。 */
    const paths = (data.entries || [])
      .map(e => e && e.path)
      .filter(Boolean)
      .filter(p => !/\.[a-z0-9]{2,5}\/?$/i.test(p))
    if (!paths.length) return null
    // 首页不在锁清单里（它是唯一的公开页），但它当然要一起扫
    const all = [...new Set(['/', ...paths, ...(data.publicPaths || [])])]
    return all.map(p => base + p)
  } catch (_) {
    return null
  }
}

// 哨兵：首页都取不到就别开工了
export const canaryOk = async site => {
  const r = await hit(`${String(site).replace(/\/$/, '')}/`, 20000)
  return !(r.err || r.status >= 400)
}

// 坏得太多 = 多半是被限流，不是站真的塌了
export const RATE_LIMIT_SUSPECT = 0.35
export const looksThrottled = (brokenCount, total) =>
  total >= 4 && brokenCount / total > RATE_LIMIT_SUSPECT

// 有并发上限的 map。并发太高就是限流的来源，所以默认给得很保守。
export const mapLimit = async (items, limit, fn) => {
  const out = []
  let i = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k) }
  }))
  return out
}
