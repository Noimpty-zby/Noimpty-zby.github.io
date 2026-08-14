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
