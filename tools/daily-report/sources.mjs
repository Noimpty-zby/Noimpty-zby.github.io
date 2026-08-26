// 数据采集：访问统计、评论、新文章。
// 每一项都自带兜底 —— 取不到就返回 { ok:false, why }，不让整份报告因为一个接口挂掉而失败。

import { execFileSync } from 'node:child_process'

export const CFG = {
  site: (process.env.SITE_URL || 'https://noimpty-zby.github.io').replace(/\/$/, ''),
  repo: process.env.GITHUB_REPOSITORY || 'Noimpty-zby/Noimpty-zby.github.io',
  ghToken: process.env.GITHUB_TOKEN || '',
  umamiKey: process.env.UMAMI_API_KEY || '',
  umamiSite: process.env.UMAMI_WEBSITE_ID || '',
  umamiBase: (process.env.UMAMI_API_BASE || 'https://api.umami.is/v1').replace(/\/$/, ''),
  // GoatCounter：免费且开放 API。GC_CODE 是你注册时选的站点代号（<code>.goatcounter.com）
  gcCode: process.env.GOATCOUNTER_CODE || '',
  gcToken: process.env.GOATCOUNTER_TOKEN || '',
  windowHours: Number(process.env.REPORT_WINDOW_HOURS || 24)
}

export const WINDOW = (() => {
  const end = Date.now()
  return { start: end - CFG.windowHours * 3600 * 1000, end }
})()

const fmtCN = ms => new Date(ms).toLocaleString('zh-CN', {
  timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
})
export const WINDOW_LABEL = `${fmtCN(WINDOW.start)} — ${fmtCN(WINDOW.end)}（北京时间）`

const timeout = (ms = 20000) => AbortSignal.timeout(ms)

const jget = async (url, headers = {}, ms) => {
  const res = await fetch(url, { headers, signal: timeout(ms) })
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 160)}`)
  return res.json()
}

// ---------------- Umami ----------------

// 云版文档写的是 Authorization: Bearer，自建版历史上用 x-umami-api-key。
// 两个都试一遍，省得因为一个 header 名字白跑。
const umamiGet = async path => {
  const url = `${CFG.umamiBase}${path}`
  const tries = [
    { Authorization: `Bearer ${CFG.umamiKey}`, accept: 'application/json' },
    { 'x-umami-api-key': CFG.umamiKey, accept: 'application/json' }
  ]
  let last
  for (const h of tries) {
    try { return await jget(url, h) } catch (e) { last = e }
  }
  throw last
}

// ---------------- GoatCounter ----------------

const gcGet = async (path, params) => {
  const url = new URL(`https://${CFG.gcCode}.goatcounter.com/api/v0${path}`)
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  return jget(url.href, {
    Authorization: `Bearer ${CFG.gcToken}`,
    'Content-Type': 'application/json'
  }, 25000)
}

export const getTrafficGoatCounter = async () => {
  if (!CFG.gcCode || !CFG.gcToken) {
    return { ok: false, why: '没有配置 GOATCOUNTER_CODE / GOATCOUNTER_TOKEN' }
  }
  const range = { start: new Date(WINDOW.start).toISOString(), end: new Date(WINDOW.end).toISOString() }
  try {
    // 顺便查一次「有史以来」的总量：用来区分「今天没人来」和「统计根本没装上」
    const everRange = { start: '2020-01-01T00:00:00Z', end: range.end }
    const [total, hits, ever] = await Promise.all([
      gcGet('/stats/total', range),
      gcGet('/stats/hits', { ...range, limit: 10 }).catch(() => ({ hits: [] })),
      gcGet('/stats/total', everRange).catch(() => null)
    ])
    // 来源接口在不同版本里路径不一样，取不到就算了，不影响主体
    let referrers = []
    for (const p of ['/stats/toprefs', '/stats/refs']) {
      try {
        const r = await gcGet(p, { ...range, limit: 6 })
        referrers = (r.refs || r.hits || []).map(x => ({ from: x.name || x.path || '直接访问', n: x.count || 0 }))
        if (referrers.length) break
      } catch (_) { /* 换下一个候选路径 */ }
    }
    const list = Array.isArray(hits.hits) ? hits.hits : []
    return {
      ok: true,
      source: 'GoatCounter',
      pageviews: Number(total.total || 0),
      // null = 查不到，别据此下任何结论
      everRecorded: ever ? Number(ever.total || 0) > 0 : null,
      // GoatCounter 不提供和 Umami 同口径的「访客数」，不编造，留空由渲染层处理
      visitors: null,
      visits: null,
      bounces: null,
      totaltime: 0,
      pages: list.map(h => ({ url: h.path, title: h.title || '', n: Number(h.count || 0) })),
      referrers
    }
  } catch (e) {
    return { ok: false, why: String(e.message || e).slice(0, 220) }
  }
}

// ---------------- 分发：配了哪个用哪个 ----------------

export const getTraffic = async () => {
  if (CFG.gcCode && CFG.gcToken) return getTrafficGoatCounter()
  return getTrafficUmami()
}

export const getTrafficUmami = async () => {
  if (!CFG.umamiKey || !CFG.umamiSite) {
    return { ok: false, why: '没有配置访问统计的凭据（GoatCounter 或 Umami 二选一）' }
  }
  try {
    const q = `startAt=${WINDOW.start}&endAt=${WINDOW.end}`
    const [stats, pages, referrers] = await Promise.all([
      umamiGet(`/websites/${CFG.umamiSite}/stats?${q}`),
      umamiGet(`/websites/${CFG.umamiSite}/metrics?${q}&type=url&limit=8`).catch(() => []),
      umamiGet(`/websites/${CFG.umamiSite}/metrics?${q}&type=referrer&limit=6`).catch(() => [])
    ])
    const num = v => (v && typeof v === 'object' ? Number(v.value || 0) : Number(v || 0))
    return {
      ok: true,
      source: 'Umami',
      pageviews: num(stats.pageviews),
      visitors: num(stats.visitors),
      visits: num(stats.visits),
      bounces: num(stats.bounces),
      totaltime: num(stats.totaltime),
      pages: (Array.isArray(pages) ? pages : []).map(p => ({ url: p.x, n: p.y })),
      referrers: (Array.isArray(referrers) ? referrers : [])
        .map(p => ({ from: p.x || '直接访问', n: p.y }))
    }
  } catch (e) {
    return { ok: false, why: String(e.message || e).slice(0, 220) }
  }
}

// ---------------- 评论（Giscus 落在 GitHub Discussions） ----------------

export const getComments = async () => {
  if (!CFG.ghToken) return { ok: false, why: '没有 GITHUB_TOKEN' }
  const [owner, name] = CFG.repo.split('/')
  const query = `
    query($owner:String!,$name:String!){
      repository(owner:$owner,name:$name){
        discussions(first:30, orderBy:{field:UPDATED_AT, direction:DESC}){
          nodes{
            title url
            comments(last:30){
              nodes{
                body createdAt url
                author{ login url }
                replies(last:20){ nodes{ body createdAt url author{ login url } } }
              }
            }
          }
        }
      }
    }`
  try {
    const res = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: { Authorization: `bearer ${CFG.ghToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables: { owner, name } }),
      signal: timeout(25000)
    })
    const data = await res.json()
    if (data.errors) throw new Error(data.errors.map(e => e.message).join('; '))
    const fresh = []
    for (const d of data.data?.repository?.discussions?.nodes || []) {
      const push = c => {
        const t = Date.parse(c.createdAt)
        if (t >= WINDOW.start && t <= WINDOW.end) {
          fresh.push({
            on: d.title, onUrl: d.url, url: c.url,
            who: c.author?.login || '（已注销）', whoUrl: c.author?.url || '',
            at: c.createdAt, body: String(c.body || '').trim()
          })
        }
      }
      for (const c of d.comments?.nodes || []) {
        push(c)
        for (const r of c.replies?.nodes || []) push(r)
      }
    }
    fresh.sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    return { ok: true, items: fresh }
  } catch (e) {
    return { ok: false, why: String(e.message || e).slice(0, 220) }
  }
}

// ---------------- 新文章 ----------------

export const getNewPosts = async () => {
  try {
    const since = new Date(WINDOW.start).toISOString()
    const out = execFileSync('git', [
      'log', `--since=${since}`, '--diff-filter=AM', '--name-only',
      '--pretty=format:', '--', 'source/_posts/'
    ], { encoding: 'utf8' })
    const files = [...new Set(out.split('\n').map(s => s.trim()).filter(f => f.endsWith('.md')))]
    // 光看 git 改动不够：一次批量重构会把所有文章都算成「新文章」。
    // 真正的判据是 front-matter 里的发布日期落在最近两天内。
    const DATE_GRACE = 2 * 86400 * 1000
    const { readFileSync, existsSync } = await import('node:fs')
    const posts = files.filter(f => existsSync(f)).map(f => {
      const raw = readFileSync(f, 'utf8')
      const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)
      const field = k => {
        const m = fm && fm[1].match(new RegExp(`^${k}:\\s*(.+)$`, 'm'))
        return m ? m[1].trim().replace(/^['"]|['"]$/g, '') : ''
      }
      const body = raw.slice(fm ? fm[0].length : 0).trim()
      return {
        file: f,
        title: field('title') || f.split('/').pop().replace(/\.md$/, ''),
        privacy: field('privacy'),
        author: field('author'),
        series: field('series'),
        date: Date.parse(field('date')) || 0,
        words: body.replace(/\s/g, '').length,
        body: body.slice(0, 9000)
      }
    })
      /* 这里曾经有一行 `.filter(p => p.privacy !== 'protected')`。
       *
       * 全站上锁（2026-08-19）之后每篇文章都带这个字段，于是这一行让
       * getNewPosts 永远返回空数组，连带三件事一起静默失效：
       *   1. 日报的「新文章」永远是 0 篇
       *   2. 娜娜莉的读后反馈再也没触发过
       *   3. 日程里挂了 when:{type:'post'} 的任务永远不会被自动勾上
       *      —— 「提交第五章博客」至今还是未完成，文章八月就发了
       *
       * 报告是发给主人自己的邮件，不是公开页面，本来就不该按 privacy 过滤。
       * 下面那两条过滤（排掉她自己的随笔、排掉太旧的）才是真正需要的。 */
      // 她自己写的专栏不算「主人发了新文章」。否则每个周日：
      // 标题栏写「1 篇新文章」、烧一次模型让她给自己的随笔写读后感、
      // 日程里关键词恰好命中的任务还会被自动勾上。
      .filter(p => !/(^|\/)nanaly-/.test(p.file) && p.author !== '娜娜莉')
      .filter(p => !p.date || p.date >= WINDOW.start - DATE_GRACE)
      .sort((a, b) => b.date - a.date)

    // 单次最多点评 3 篇，避免一次批量提交把邮件撑爆、也避免烧太多 token
    const CAP = 3
    return { ok: true, items: posts.slice(0, CAP), skipped: Math.max(0, posts.length - CAP) }
  } catch (e) {
    return { ok: false, why: String(e.message || e).slice(0, 220) }
  }
}

// ---------------- 主人心跳 ----------------
//
// 前端在识别为主人的浏览器上，只发一条 owner-heartbeat 事件、不发正常浏览量。
// 这里回读那条事件，算出他多久没来过了。
// 拿不到就返回 null，调用方按「不知道」处理，绝不瞎猜。

export const OWNER_PATH = '/owner-heartbeat'

export const getOwnerHeartbeat = async (lookbackDays = 90) => {
  if (!CFG.gcCode || !CFG.gcToken) return { ok: false, why: '没有配置 GoatCounter' }
  const start = new Date(WINDOW.end - lookbackDays * 86400000).toISOString()
  const end = new Date(WINDOW.end).toISOString()
  try {
    const url = new URL(`https://${CFG.gcCode}.goatcounter.com/api/v0/stats/hits`)
    url.searchParams.set('start', start)
    url.searchParams.set('end', end)
    url.searchParams.set('daily', 'true')
    // /owner-heartbeat 每小时最多一条，是站上访问量最低的路径之一，
    // 而这个接口按访问量排序 —— 站点路径一多它就被挤出前 100，
    // 于是「查不到心跳」和「他真的没来过」变得无法区分，想念邮件从此永远不发。
    // 直接按路径过滤，不再靠排名。
    url.searchParams.set('limit', '100')
    url.searchParams.set('filter', OWNER_PATH)
    const data = await jget(url.href, {
      Authorization: `Bearer ${CFG.gcToken}`, 'Content-Type': 'application/json'
    }, 25000)

    const row = (data.hits || []).find(h => String(h.path || '').replace(/^\//, '') === OWNER_PATH.replace(/^\//, ''))
    if (!row) return { ok: true, lastSeen: null, days: null, note: '还没有记录到心跳' }

    const days = (row.stats || []).filter(d => Number(d.daily) > 0).map(d => d.day).sort()
    if (!days.length) return { ok: true, lastSeen: null, days: null, note: '窗口内没有心跳' }

    const last = days[days.length - 1]
    // 以「那天北京时间的结束」为锚点算间隔。
    // 以前锚在 12:00 UTC（= 北京 20:00），早上跑的时候锚点在未来，天数会少一天，
    // 想念邮件的节奏整体被推后。北京时间 = UTC+8，所以当天末尾是 UTC 的 15:59:59。
    const anchor = Date.parse(`${last}T15:59:59Z`)
    const gap = Number.isFinite(anchor) ? Math.floor((WINDOW.end - anchor) / 86400000) : 0
    return { ok: true, lastSeen: last, days: Math.max(0, gap), total: row.count || 0 }
  } catch (e) {
    return { ok: false, why: String(e.message || e).slice(0, 200) }
  }
}

// ---------------- 今天的日程 ----------------
//
// 读的是仓库里那份 source/_data/schedule.json —— 和网页上编辑的是同一份文件。
// 网页通过 GitHub API 直接改它，所以这里读到的一定是最新提交的版本。

export const getSchedule = async () => {
  try {
    const { readFileSync, existsSync } = await import('node:fs')
    const F = 'source/_data/schedule.json'
    if (!existsSync(F)) return { ok: true, today: [], tomorrow: [], overdue: [], empty: true }

    const data = JSON.parse(readFileSync(F, 'utf8'))
    const days = data.days || {}

    const cnKey = offset => {
      const d = new Date(WINDOW.end + offset * 86400000)
      return new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
      }).format(d)
    }
    const todayKey = cnKey(0)
    const tomorrowKey = cnKey(1)

    const list = k => Array.isArray(days[k]) ? days[k] : []

    // 逾期：今天之前、还没勾完成的。只回看两周，再久的就不提了 ——
    // 一直挂着的旧任务天天念，跟没提醒是一个效果。
    const overdue = []
    Object.keys(days).sort().forEach(k => {
      if (k >= todayKey) return
      if (k < cnKey(-14)) return
      list(k).filter(t => !t.done).forEach(t => overdue.push({ ...t, date: k }))
    })

    return {
      ok: true,
      today: list(todayKey),
      tomorrow: list(tomorrowKey),
      overdue,
      todayKey,
      empty: !Object.keys(days).length
    }
  } catch (e) {
    return { ok: false, why: String(e.message || e).slice(0, 160) }
  }
}
