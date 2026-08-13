// 娜娜莉的巡逻：她自己在博客里逛，点开每篇文章、点每个链接、看每张图。
// 发现坏掉的东西，就到那篇文章的评论区留言提醒主人。
//
// 她只在「确实发现问题」时说话，而且同一个问题只说一次（靠评论里的隐藏标记判重）。
// 一个每天重复念叨的机器人只会让人把通知关掉。

import { listDiscussions, createDiscussion, addComment, addReaction, marker, hasMarker, SIGN, findDiscussion, giscusTitle } from './github.mjs'
import { ask } from '../daily-report/narrate.mjs'

const SITE = (process.env.SITE_URL || 'https://noimpty-zby.github.io').replace(/\/$/, '')
const T = (ms = 15000) => AbortSignal.timeout(ms)
const DRY = process.argv.includes('--dry')

const mapLimit = async (items, limit, fn) => {
  const out = []
  let i = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]) }
  }))
  return out
}

const getText = async url => {
  const res = await fetch(url, { signal: T(20000), redirect: 'follow' })
  return { status: res.status, ok: res.ok, body: res.ok ? await res.text() : '' }
}

// ---------------- 逐篇体检 ----------------

const inspect = async pageUrl => {
  const issues = []
  const r = await getText(pageUrl).catch(e => ({ ok: false, status: String(e.message).slice(0, 60) }))
  if (!r.ok) return { pageUrl, issues: [{ kind: 'page', what: `这一页打不开（${r.status}）` }] }

  const title = (r.body.match(/<meta property="og:title" content="([^"]*)"/) || [])[1]
    || (r.body.match(/<title>([^<]*)<\/title>/) || [])[1] || pageUrl

  // 公式渲染失败：KaTeX 出错时会留下 .katex-error
  const mathErr = (r.body.match(/class="[^"]*katex-error/g) || []).length
  if (mathErr) issues.push({ kind: 'math', what: `有 ${mathErr} 处公式没渲染出来（KaTeX 报错）` })

  // 收集本文里的链接与图片
  const grab = re => [...r.body.matchAll(re)].map(m => m[1])
  const main = (r.body.split('id="article-container"')[1] || r.body).split('id="post-comment"')[0]
  const links = new Set()
  const imgs = new Set()
  ;[...main.matchAll(/<a[^>]+href="([^"#]+)"/g)].forEach(m => {
    const h = m[1]
    if (/^(mailto:|javascript:|tel:|#)/.test(h)) return
    try { links.add(new URL(h, pageUrl).href.split('#')[0]) } catch (_) {}
  })
  ;[...main.matchAll(/<img[^>]+(?:src|data-src|data-lazy-src)="([^"]+)"/g)].forEach(m => {
    const h = m[1]
    if (h.startsWith('data:')) return
    try { imgs.add(new URL(h, pageUrl).href) } catch (_) {}
  })

  // 站外链接经常对爬虫返回 403 / 429（Cloudflare、Epic 文档都这样），
  // 那不是坏了。一个天天误报的巡逻只会被主人关掉通知，所以这里分开对待：
  //   站内：任何 4xx/5xx 都报
  //   站外：只报 404 和 410，其余（403/401/429/5xx/超时）一律当噪声忽略
  const isInternal = u => u.startsWith(SITE)
  const probe = async (u, kind) => {
    const label = kind === 'img' ? '图片' : '链接'
    const inside = isInternal(u)
    try {
      let res = await fetch(u, { method: 'HEAD', signal: T(12000) })
      if (res.status === 405 || res.status === 501) res = await fetch(u, { signal: T(12000) })
      if (inside) {
        if (res.status >= 400) return { kind, what: `${label} ${u.replace(SITE, '')} 返回 ${res.status}`, url: u }
      } else if (res.status === 404 || res.status === 410) {
        return { kind, what: `站外${label} ${u} 已经失效了（${res.status}）`, url: u }
      }
    } catch (_) {
      // 站外超时/DNS 抖动太常见，不报；站内连不上是真问题
      if (inside) return { kind, what: `${label} ${u.replace(SITE, '')} 连不上`, url: u }
    }
    return null
  }

  const found = [
    ...(await mapLimit([...links], 6, u => probe(u, 'link'))),
    ...(await mapLimit([...imgs], 6, u => probe(u, 'img')))
  ].filter(Boolean)

  return { pageUrl, title, issues: issues.concat(found) }
}

// ---------------- 主流程 ----------------

export const patrol = async () => {
  const sm = await getText(`${SITE}/sitemap.xml`)
  if (!sm.ok) { console.log('  取不到 sitemap，巡逻取消'); return { checked: 0, reported: 0 } }

  const pages = [...sm.body.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map(m => m[1])
    // sitemap 里存的是配置里的正式域名。把源统一成 SITE_URL，
    // 否则本地调试时会跑去打生产站，测的根本不是眼前这份构建。
    .map(u => { try { return SITE + new URL(u).pathname } catch (_) { return u } })
    .filter(u => /\/\d{4}\/\d{2}\/\d{2}\//.test(u))   // 只巡逻文章页
    .slice(0, 40)

  console.log(`  要巡逻 ${pages.length} 篇文章`)
  const results = await mapLimit(pages, 4, inspect)
  const broken = results.filter(r => r.issues.length)
  console.log(`  发现有问题的：${broken.length} 篇`)

  const discussions = await listDiscussions().catch(e => {
    console.log('  拉不到 Discussions：' + e.message)
    // 演练时没有 token 也应该能看到「她会说什么」，所以这里不直接退出
    return DRY ? [] : null
  })
  if (!discussions) return { checked: pages.length, reported: 0 }

  let reported = 0
  for (const item of broken) {
    const path = new URL(item.pageUrl).pathname
    // 同一篇文章的同一组问题只提醒一次
    const key = Buffer.from(item.issues.map(i => i.what).join('|')).toString('base64url').slice(0, 24)

    let disc = findDiscussion(discussions, path)
    if (disc && hasMarker(disc, 'patrol', key)) { continue }

    const shown = item.issues.slice(0, 8)
    const list = shown.map(i => `- ${i.what}`).join('\n')
      + (item.issues.length > shown.length ? `\n- …另外还有 ${item.issues.length - shown.length} 处` : '')
    const said = await ask(
      '你是娜娜莉，住在这个博客里的猫娘。毒舌但可靠，自称「窝」，说话简短。禁止使用 • 和 ω。',
      `你在博客里闲逛时，发现《${item.title}》这篇有问题：\n${list}\n\n` +
      '写一条评论提醒主人。两三句话，先说你是怎么发现的（比如顺手点了个链接），' +
      '再把问题列清楚。别啰嗦，别道歉，也别假装很严重。', 400)

    const body = (said || `[抖了抖耳朵] 窝路过这篇，顺手点了几个链接，有东西坏了喵：\n\n${list}`)
      + `\n\n<details><summary>具体是这些</summary>\n\n${list}\n\n</details>`
      + SIGN + marker('patrol', key)

    if (DRY) {
      console.log(`\n  [演练] 会在 ${path} 评论：\n${body.split('\n').map(l => '    ' + l).join('\n')}\n`)
      reported++
      continue
    }
    try {
      if (!disc) {
        try {
          disc = await createDiscussion(giscusTitle(path), `这条讨论对应文章 ${SITE}${path}`)
        } catch (e) {
          // 这篇还没人评论过，所以还没有对应的讨论；建不出来就只能跳过。
          // 不当成致命错误 —— 同样的问题每晚的日报「死链与坏图」那一格照样会报给你。
          console.log(`  ${path} 还没有讨论区，且建不出来（${String(e.message).slice(0, 80)}）`)
          console.log('     这篇的问题会出现在每晚日报的健康检查里，不会漏掉：')
          shown.forEach(i => console.log(`       - ${i.what}`))
          continue
        }
      }
      await addComment(disc.id, body)
      reported++
      console.log(`  已在 ${path} 留言`)
    } catch (e) {
      console.log(`  在 ${path} 留言失败：${e.message}`)
    }
  }
  return { checked: pages.length, reported }
}

// ---------------- 贴表情 ----------------
//
// 她读到喜欢的文章会顺手贴个表情。同一篇只贴一次。

const MOODS = ['HEART', 'HOORAY', 'ROCKET', 'EYES']

export const react = async (limit = 3) => {
  const discussions = await listDiscussions().catch(() => null)
  if (!discussions) return 0
  const mine = d => (d.reactions?.nodes || []).length > 0
  const targets = discussions.filter(d => /^\/?\d{4}\//.test(d.title) && !mine(d)).slice(0, limit)
  let n = 0
  for (const d of targets) {
    // 用标题算出固定的表情，避免每次跑结果都不一样
    const idx = [...d.title].reduce((a, c) => (a + c.charCodeAt(0)) % 997, 0) % MOODS.length
    if (DRY) { console.log(`  [演练] 会给 ${d.title} 贴 ${MOODS[idx]}`); n++; continue }
    try { if (await addReaction(d.id, MOODS[idx])) { n++; console.log(`  给 ${d.title} 贴了 ${MOODS[idx]}`) } }
    catch (e) { console.log(`  贴表情失败：${e.message}`) }
  }
  return n
}
