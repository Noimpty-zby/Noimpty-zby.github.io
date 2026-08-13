// 健康与泄漏检查。
//
// 这个站是 GitHub Pages 上的纯静态站：没有服务器、没有数据库、没有后台登录。
// 「被入侵」这类威胁在这里不成立，真正的风险是「不小心漏出去」和「悄悄坏掉」。
// 所以这里查的是：受保护文章有没有漏进公开索引、站点还活着吗、构建有没有红、
// 证书还有多久到期、有没有死链和挂掉的图。

import tls from 'node:tls'
import { CFG, WINDOW } from './sources.mjs'

const T = (ms = 15000) => AbortSignal.timeout(ms)
const text = async (url, ms) => {
  const res = await fetch(url, { signal: T(ms), redirect: 'follow' })
  return { status: res.status, ok: res.ok, body: res.ok ? await res.text() : '' }
}

const LEVEL = { ok: 'ok', warn: 'warn', bad: 'bad' }

// ---------------- 1. 受保护文章有没有漏出去 ----------------

export const checkLeak = async () => {
  const out = { name: '加密文章泄漏', level: LEVEL.ok, detail: '', items: [] }
  try {
    const man = await text(`${CFG.site}/js/protected-manifest.js`)
    if (!man.ok) {
      out.level = LEVEL.warn
      out.detail = `取不到 protected-manifest.js（HTTP ${man.status}）`
      return out
    }
    const m = man.body.match(/Object\.freeze\((\{[\s\S]*\})\)/)
    const entries = m ? (JSON.parse(m[1]).entries || []) : []
    const paths = entries.map(e => e.path).filter(p => /^\/\d{4}\//.test(p))
    if (!paths.length) {
      out.detail = '没有标记为 protected 的文章，无需检查'
      return out
    }

    const feeds = [
      ['atom.xml', `${CFG.site}/atom.xml`],
      ['sitemap.xml', `${CFG.site}/sitemap.xml`],
      ['search.xml', `${CFG.site}/search.xml`],
      ['首页', `${CFG.site}/`],
      ['归档页', `${CFG.site}/archives/`]
    ]
    for (const [label, url] of feeds) {
      const r = await text(url, 20000)
      if (!r.ok) { out.items.push({ where: label, note: `取不到（HTTP ${r.status}）`, leak: false }); continue }
      const hit = paths.filter(p => r.body.includes(p))
      if (hit.length) {
        out.items.push({ where: label, note: hit.join('、'), leak: true })
        out.level = LEVEL.bad
      }
    }
    out.detail = out.level === LEVEL.ok
      ? `${paths.length} 篇受保护文章，5 处公开索引全部干净`
      : `发现 ${out.items.filter(i => i.leak).length} 处泄漏`
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
  if (!CFG.ghToken) { out.level = LEVEL.warn; out.detail = '没有 GITHUB_TOKEN'; return out }
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
      out.level = LEVEL.warn
      out.detail = '默认的 GITHUB_TOKEN 读不到 Dependabot 告警（需要额外权限），这项先跳过'
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

// ---------------- 5. 死链与挂掉的图 ----------------

const mapLimit = async (items, limit, fn) => {
  const out = []
  let i = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]) }
  }))
  return out
}

export const checkLinks = async () => {
  const out = { name: '死链与坏图', level: LEVEL.ok, detail: '', items: [] }
  try {
    const sm = await text(`${CFG.site}/sitemap.xml`, 20000)
    if (!sm.ok) { out.level = LEVEL.warn; out.detail = '取不到 sitemap'; return out }
    const pages = [...sm.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]).slice(0, 60)

    const targets = new Set()
    await mapLimit(pages, 6, async url => {
      const r = await text(url, 20000).catch(() => ({ ok: false }))
      if (!r.ok) { targets.add(url); return }
      const grab = re => [...r.body.matchAll(re)].map(m => m[1])
      const raw = [...grab(/<a[^>]+href="([^"#?]+)"/g), ...grab(/<img[^>]+src="([^"?]+)"/g)]
      raw.forEach(h => {
        if (/^(mailto:|javascript:|data:|#)/.test(h)) return
        let abs
        try { abs = new URL(h, url).href } catch (_) { return }
        if (abs.startsWith(CFG.site)) targets.add(abs.split('#')[0])
      })
    })

    const list = [...targets].slice(0, 400)
    const broken = []
    await mapLimit(list, 8, async u => {
      try {
        let r = await fetch(u, { method: 'HEAD', signal: T(12000) })
        if (r.status === 405 || r.status === 501) r = await fetch(u, { signal: T(12000) })
        if (r.status >= 400) broken.push({ url: u, status: r.status })
      } catch (_) { broken.push({ url: u, status: '连接失败' }) }
    })

    broken.slice(0, 12).forEach(b => out.items.push({
      where: b.url.replace(CFG.site, '') || '/', note: String(b.status)
    }))
    if (broken.length) {
      out.level = LEVEL.bad
      out.detail = `${list.length} 个地址里有 ${broken.length} 个打不开`
    } else {
      out.detail = `扫了 ${pages.length} 个页面、${list.length} 个地址，全部正常`
    }
  } catch (e) {
    out.level = LEVEL.warn
    out.detail = '检查失败：' + String(e.message || e).slice(0, 160)
  }
  return out
}

export const runHealth = async () => {
  const checks = await Promise.all([checkLeak(), checkSite(), checkBuild(), checkDeps(), checkLinks()])
  const worst = checks.some(c => c.level === 'bad') ? 'bad'
    : checks.some(c => c.level === 'warn') ? 'warn' : 'ok'
  return { checks, worst }
}
