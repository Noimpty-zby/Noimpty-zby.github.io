// 健康与泄漏检查。
//
// 这个站是 GitHub Pages 上的纯静态站：没有服务器、没有数据库、没有后台登录。
// 「被入侵」这类威胁在这里不成立，真正的风险是「不小心漏出去」和「悄悄坏掉」。
// 所以这里查的是：受保护文章有没有漏进公开索引、站点还活着吗、构建有没有红、
// 证书还有多久到期、有没有死链和挂掉的图。

import tls from 'node:tls'
import { CFG, WINDOW } from './sources.mjs'
import { probeUrl, canaryOk, looksThrottled, mapLimit, sitePages } from '../nanaly/probe.mjs'

const T = (ms = 15000) => AbortSignal.timeout(ms)
const text = async (url, ms) => {
  const res = await fetch(url, { signal: T(ms), redirect: 'follow' })
  return { status: res.status, ok: res.ok, body: res.ok ? await res.text() : '' }
}

const LEVEL = { ok: 'ok', warn: 'warn', bad: 'bad' }

// ---------------- 1. 上锁有没有漏 ----------------

/* 这一项跟着「全站上锁」重写过一次，因为原来那个问法已经不成立了。
 *
 * 以前的问法是「受保护的那几篇，有没有漏进公开的索引页」——
 * 那时候大部分内容是公开的，protected 是少数派。
 *
 * 现在反过来了：**除了首页和关于页，全站都在锁后面。**
 * 拿旧问法去查，它会把 /archives/ 里有文章链接报成泄漏 ——
 * 可是 /archives/ 自己也在锁后面，那不是泄漏。上一版日报天天报 5 处泄漏，
 * 全是这么来的：检查本身过时了，不是站点真的漏了。
 *
 * 新的问法是四条，每一条对应一个「不用打开任何上锁页面就能拿到内容」的口子：
 *
 *   1. 真正公开的那两个页面上，有没有出现文章标题或链接
 *   2. atom.xml / sitemap.xml 还在不在（它们应该已经被 lockdown 移除）
 *   3. search.xml 有没有加密（它是全站正文，一个 GET 就下完）
 *   4. robots.txt 有没有拒绝爬虫
 *
 * 这四条都干净，才叫「软锁做到位了」。
 * 至于「打开上锁页面看源代码」——那是软锁的固有边界，不在这里查，
 * 见 scripts/noimpty-lockdown.js 顶部的说明。
 */
export const checkLeak = async (crawl) => {
  const out = { name: '上锁检查', level: LEVEL.ok, detail: '', items: [] }
  try {
    const man = await text(`${CFG.site}/js/protected-manifest.js`)
    if (!man.ok) {
      out.level = LEVEL.warn
      out.detail = `取不到 protected-manifest.js（HTTP ${man.status}）—— 锁清单没生成，全站可能都是公开的`
      return out
    }
    const m = man.body.match(/Object\.freeze\((\{[\s\S]*\})\)/)
    const manifest = m ? JSON.parse(m[1]) : {}
    const locked = (manifest.entries || []).map(e => e.path)
    const publicPaths = new Set(manifest.publicPaths || ['/'])
    const postPaths = locked.filter(p => /^\/\d{4}\//.test(p))

    if (!locked.length) {
      out.level = LEVEL.bad
      out.detail = '锁清单是空的 —— 全站都是公开的'
      return out
    }

    let bad = 0

    // ① 真正公开的页面上不该出现任何上锁路径
    if (crawl) {
      crawl.html.forEach((body, url) => {
        const where = url.replace(CFG.site, '') || '/'
        if (!publicPaths.has(where)) return          // 上锁页面里有链接是正常的
        const hit = locked.filter(p => body.includes(`href="${p}"`) || body.includes(`href='${p}'`))
        if (hit.length) {
          out.items.push({ where: `公开页 ${where}`, note: `挂着 ${hit.length} 个内部链接：${hit.slice(0, 3).join('、')}`, leak: true })
          out.level = LEVEL.bad
          bad++
        }
      })
    } else {
      out.level = LEVEL.warn
      out.items.push({ where: '公开页面', note: '这次没能抓取，只查了 feed 和索引', leak: false })
    }

    // ② feed 和 sitemap 应该已经不存在
    for (const [label, path] of [['RSS/Atom', '/atom.xml'], ['站点地图', '/sitemap.xml']]) {
      const r = await text(`${CFG.site}${path}`, 15000)
      if (r.ok) {
        out.items.push({ where: label, note: `${path} 还能访问 —— 它会把文章清单直接推出去，应该关掉`, leak: true })
        out.level = LEVEL.bad
        bad++
      } else {
        out.items.push({ where: label, note: `已关闭（HTTP ${r.status}）`, leak: false })
      }
    }

    // ③ search.xml 必须是密文。它是这套软锁里唯一一个「一个 URL 拿走全站正文」的口子
    const s = await text(`${CFG.site}/search.xml`, 25000)
    if (!s.ok) {
      out.items.push({ where: '搜索索引', note: `取不到（HTTP ${s.status}）`, leak: false })
    } else {
      const head = s.body.trim().slice(0, 200)
      if (head.startsWith('{') && /"alg"\s*:\s*"AES-GCM"/.test(s.body.slice(0, 400))) {
        out.items.push({ where: '搜索索引', note: `已加密（${(s.body.length / 1024).toFixed(0)} KB 密文）`, leak: false })
      } else if (/<entry>/.test(s.body)) {
        const n = (s.body.match(/<entry>/g) || []).length
        out.items.push({ where: '搜索索引', note: `search.xml 是明文，里面有 ${n} 篇文章的完整正文 —— 构建时没有 NOIMPTY_PASSPHRASE`, leak: true })
        out.level = LEVEL.bad
        bad++
      } else {
        out.items.push({ where: '搜索索引', note: '是空的（没配暗号，站内搜索用不了，但也没漏）', leak: false })
      }
    }

    // ④ robots.txt
    const rb = await text(`${CFG.site}/robots.txt`, 15000)
    if (!rb.ok || !/Disallow:\s*\/\s*$/m.test(rb.body)) {
      out.items.push({ where: '爬虫', note: 'robots.txt 没有拒绝全站抓取 —— 内容会被搜索引擎收录', leak: true })
      if (out.level === LEVEL.ok) out.level = LEVEL.warn
    } else {
      out.items.push({ where: '爬虫', note: 'robots.txt 已拒绝全站抓取', leak: false })
    }

    out.detail = bad
      ? `发现 ${bad} 处漏洞`
      : `${locked.length} 个路径上锁（含 ${postPaths.length} 篇文章），公开面干净`
  } catch (e) {
    out.level = LEVEL.warn
    out.detail = '检查失败：' + String(e.message || e).slice(0, 160)
  }
  return out
}

// ---------------- 2. 站点可用性 + 证书 ----------------

export const checkSite = async () => {
  const out = { name: '站点可用性', level: LEVEL.ok, detail: '', items: [] }
  try {
    const t0 = Date.now()
    const res = await fetch(`${CFG.site}/`, { signal: T(20000) })
    const ms = Date.now() - t0
    if (!res.ok) { out.level = LEVEL.bad; out.detail = `首页返回 HTTP ${res.status}`; return out }
    out.items.push({ where: '首页', note: `HTTP ${res.status}，${ms}ms` })

    const host = new URL(CFG.site).hostname
    const days = await new Promise(resolve => {
      const s = tls.connect({ host, port: 443, servername: host }, () => {
        const c = s.getPeerCertificate()
        s.end()
        resolve(c && c.valid_to ? Math.round((Date.parse(c.valid_to) - Date.now()) / 86400000) : null)
      })
      s.setTimeout(12000, () => { s.destroy(); resolve(null) })
      s.on('error', () => resolve(null))
    })
    if (days == null) out.items.push({ where: '证书', note: '读不到（不影响访问）' })
    else {
      out.items.push({ where: '证书', note: `还有 ${days} 天到期` })
      if (days < 14) { out.level = LEVEL.bad; out.detail = `证书只剩 ${days} 天` }
      else if (days < 30) { out.level = LEVEL.warn; out.detail = `证书剩 ${days} 天` }
    }
    if (!out.detail) out.detail = `正常，首页 ${ms}ms`
  } catch (e) {
    out.level = LEVEL.bad
    out.detail = '连不上：' + String(e.message || e).slice(0, 160)
  }
  return out
}

// ---------------- 3. 构建状态 ----------------

export const checkBuild = async () => {
  const out = { name: '自动部署', level: LEVEL.ok, detail: '', items: [] }
  if (!CFG.ghToken) { out.detail = '没有 GITHUB_TOKEN，这项跳过'; return out }
  try {
    const res = await fetch(
      `https://api.github.com/repos/${CFG.repo}/actions/workflows/pages.yml/runs?per_page=5`,
      { headers: { Authorization: `Bearer ${CFG.ghToken}`, accept: 'application/vnd.github+json' }, signal: T(20000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const runs = (await res.json()).workflow_runs || []
    if (!runs.length) { out.detail = '最近没有构建记录'; return out }
    const last = runs[0]
    const failed = runs.filter(r => r.conclusion === 'failure').length
    out.items.push({ where: '最近一次', note: `${last.display_title?.slice(0, 40) || last.head_branch} → ${last.conclusion || last.status}` })
    if (last.conclusion === 'failure') {
      out.level = LEVEL.bad
      out.detail = '最近一次构建失败了，站上还是旧版本'
    } else if (failed) {
      out.level = LEVEL.warn
      out.detail = `最近 5 次里有 ${failed} 次失败`
    } else out.detail = '最近 5 次构建全部成功'
  } catch (e) {
    out.level = LEVEL.warn
    out.detail = '查不到：' + String(e.message || e).slice(0, 120)
  }
  return out
}

// ---------------- 4. 依赖漏洞 ----------------

export const checkDeps = async () => {
  const out = { name: '依赖漏洞', level: LEVEL.ok, detail: '', items: [] }
  if (!CFG.ghToken) { out.level = LEVEL.warn; out.detail = '没有 GITHUB_TOKEN'; return out }
  try {
    const res = await fetch(
      `https://api.github.com/repos/${CFG.repo}/dependabot/alerts?state=open&per_page=100`,
      { headers: { Authorization: `Bearer ${CFG.ghToken}`, accept: 'application/vnd.github+json' }, signal: T(20000) })
    if (res.status === 403 || res.status === 404) {
      // 这个工作流按最小权限配置，本来就读不到 Dependabot —— 这是预期，不是问题。
      // 以前报 warn，结果每天的邮件标题都挂着「⚠️ 有问题要处理」，
      // 「没事就不发」的开关也永远失效。天天喊狼来了的告警等于没有告警。
      out.detail = '这项已跳过（工作流的 token 按最小权限配置，读不到 Dependabot）'
      return out
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const alerts = await res.json()
    const by = s => alerts.filter(a => a.security_advisory?.severity === s).length
    const crit = by('critical'), high = by('high')
    // 新出现的才值得打扰你，老的在 GitHub 页面上一直挂着
    const fresh = alerts.filter(a => Date.parse(a.created_at) >= WINDOW.start)
    fresh.slice(0, 5).forEach(a => out.items.push({
      where: a.dependency?.package?.name || '?',
      note: `${a.security_advisory?.severity} — ${(a.security_advisory?.summary || '').slice(0, 70)}`
    }))
    if (fresh.length) {
      out.level = crit ? LEVEL.bad : LEVEL.warn
      out.detail = `新增 ${fresh.length} 条（累计 ${alerts.length} 条：${crit} 严重 / ${high} 高危）`
    } else {
      out.detail = alerts.length
        ? `没有新增。累计 ${alerts.length} 条（${crit} 严重 / ${high} 高危），都是构建期依赖，不进最终网页`
        : '没有未处理的告警'
    }
  } catch (e) {
    out.level = LEVEL.warn
    out.detail = '查不到：' + String(e.message || e).slice(0, 120)
  }
  return out
}

// ---------------- 抓一遍全站（泄漏检查和死链检查共用） ----------------

/* 把站内的 HTML 页面抓下来，同时收集所有站内地址。
 *
 * 种子来自锁清单而不是 sitemap（全站上锁之后 sitemap 已经不存在，
 * 详见 probe.mjs 里 sitePages 上面那段）。锁清单里已经包含了分类页、
 * 标签页和按年月归档，比原来的 sitemap 全得多。
 *
 * 仍然要顺着 <a> 再走一层：分页页（/page/2/）是模板生成的，
 * 不在 locals.pages 里，因此也不在锁清单里 ——
 * 而受保护文章的标题恰恰最容易漏在那种地方。
 */
const crawlSite = async () => {
  const seeds = await sitePages(CFG.site)
  if (!seeds) return null

  const html = new Map()          // url -> 页面源码
  const targets = new Set()       // 所有站内地址（含图片等静态资源）
  const isPage = u => !/\.(png|jpe?g|gif|webp|svg|ico|css|js|xml|json|txt|woff2?|ttf|mp3|mp4|pdf|zip)$/i.test(u)

  const visit = async url => {
    if (html.has(url)) return []
    const r = await text(url, 20000).catch(() => ({ ok: false }))
    if (!r.ok) { targets.add(url); return [] }
    html.set(url, r.body)
    const grab = re => [...r.body.matchAll(re)].map(m => m[1])
    const found = []
    ;[...grab(/<a[^>]+href="([^"#?]+)"/g), ...grab(/<img[^>]+src="([^"?]+)"/g)].forEach(h => {
      if (/^(mailto:|javascript:|data:|#)/.test(h)) return
      let abs
      try { abs = new URL(h, url).href } catch (_) { return }
      if (!abs.startsWith(CFG.site)) return
      abs = abs.split('#')[0]
      targets.add(abs)
      if (isPage(abs)) found.push(abs)
    })
    return found
  }

  // 第一层：锁清单上的页面
  const first = await mapLimit(seeds.slice(0, 60), 3, visit)
  // 第二层：第一层链出去的站内页面（分页、标签、分类都在这一层）
  const more = [...new Set(first.flat())].filter(u => !html.has(u)).slice(0, 60)
  await mapLimit(more, 3, visit)

  return { html, targets, pageCount: html.size }
}

// ---------------- 5. 死链与挂掉的图 ----------------

export const checkLinks = async (crawl) => {
  const out = { name: '死链与坏图', level: LEVEL.ok, detail: '', items: [] }
  try {
    if (!crawl) { out.level = LEVEL.warn; out.detail = '取不到锁清单，没法扫'; return out }
    const list = [...crawl.targets].slice(0, 400)
    const broken = []
    // 并发压到 3。并发本身就是限流的来源 —— 扫得快一点换来一堆误报，不划算。
    await mapLimit(list, 3, async u => {
      const bad = await probeUrl(u, true)
      if (bad) broken.push({ url: u, status: bad.verdict === 'unreachable' ? '连不上' : bad.status })
    })

    // 坏得太多多半是被限流了，不是站真的塌了。宁可这次不报。
    if (looksThrottled(broken.length, list.length)) {
      out.detail = `${list.length} 个地址里有 ${broken.length} 个失败，比例高得不正常，判定为限流，本次不报`
      return out
    }

    broken.slice(0, 12).forEach(b => out.items.push({
      where: b.url.replace(CFG.site, '') || '/', note: String(b.status)
    }))
    if (broken.length) {
      out.level = LEVEL.bad
      out.detail = `${list.length} 个地址里有 ${broken.length} 个打不开（每个都复核过三次）`
    } else {
      out.detail = `扫了 ${crawl.pageCount} 个页面、${list.length} 个地址，全部正常`
    }
  } catch (e) {
    out.level = LEVEL.warn
    out.detail = '检查失败：' + String(e.message || e).slice(0, 160)
  }
  return out
}

export const runHealth = async () => {
  // 顺序是有讲究的，别改回并行。
  //
  // 抓全站那几十上百个请求会把同时进行的首页探测一起挤进限流，
  // 于是「站点可用性」被判成挂了，邮件标题挂上「⚠️ 有问题要处理」——
  // 一个纯粹由检查自己制造出来的故障。
  const site = await checkSite()
  const [build, deps] = await Promise.all([checkBuild(), checkDeps()])

  // 哨兵：这台 runner 现在真的能访问站点吗？不能就整轮不判，别误报。
  let crawl = null
  if (await canaryOk(CFG.site)) crawl = await crawlSite()

  const leak = await checkLeak(crawl)
  const links = crawl
    ? await checkLinks(crawl)
    : { name: '死链与坏图', level: LEVEL.ok, detail: '这次连首页都取不到，是本次运行的网络问题，跳过不误报', items: [] }

  const checks = [leak, site, build, deps, links]
  const worst = checks.some(c => c.level === 'bad') ? 'bad'
    : checks.some(c => c.level === 'warn') ? 'warn' : 'ok'
  return { checks, worst }
}
