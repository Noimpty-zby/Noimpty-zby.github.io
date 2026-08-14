// 娜娜莉的巡逻：她自己在博客里逛，点开每篇文章、点每个链接、看每张图。
// 发现坏掉的东西，就到那篇文章的评论区留言提醒主人。
//
// 她只在「确实发现问题」时说话，而且同一个问题只说一次（靠评论里的隐藏标记判重）。
// 一个每天重复念叨的机器人只会让人把通知关掉。

import { listDiscussions, createDiscussion, addComment, addReaction, marker, hasMarker, SIGN, findDiscussion, giscusTitle } from './github.mjs'
import { ask } from '../daily-report/narrate.mjs'
import { createHash } from 'node:crypto'

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

const isInternal = u => u.startsWith(SITE)
const sleep = ms => new Promise(r => setTimeout(r, ms))

const hit = async (u, ms) => {
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
const verdictOf = (r, inside) => {
  if (r.err) return inside ? 'unreachable' : null
  if (inside) return r.status >= 400 ? 'http' : null
  return (r.status === 404 || r.status === 410) ? 'http' : null
}

// 两段式判定。第一遍只用来「怀疑」，定罪必须靠串行复核。
//
// 上一版就是死在这儿：并发扫自己的站会被 GitHub Pages 限流，
// 一大片请求直接连接失败，代码把它当成死链报了出去 ——
// 结果连首页 / 都被报成打不开。一次误报就够让人再也不信这个巡逻了。
const probe = async (u, kind) => {
  const label = kind === 'img' ? '图片' : '链接'
  const inside = isInternal(u)

  let r = await hit(u, 15000)
  let v = verdictOf(r, inside)
  if (!v) return null

  // 复核两次：串行、加延迟、超时放宽。任何一次通过就判无罪。
  for (let i = 0; i < 2; i++) {
    await sleep(1500 + i * 2000)
    r = await hit(u, 25000)
    v = verdictOf(r, inside)
    if (!v) return null
  }

  const shown = inside ? (u.replace(SITE, '') || '/') : u
  if (v === 'unreachable') {
    return { kind, what: `${label} ${shown} 连续三次都连不上`, url: u }
  }
  return inside
    ? { kind, what: `${label} ${shown} 返回 ${r.status}`, url: u }
    : { kind, what: `站外${label} ${u} 已经失效了（${r.status}）`, url: u }
}

// 并发压到很低。慢一点没关系，误报一次就没人信了。

const inspect = async pageUrl => {
  const issues = []
  const r = await getText(pageUrl).catch(e => ({ ok: false, status: String(e.message).slice(0, 60) }))
  if (!r.ok) {
    // 复核一次再说，别把一次抖动当成页面挂了
    await sleep(2000)
    const again = await getText(pageUrl).catch(e => ({ ok: false, status: String(e.message).slice(0, 60) }))
    if (!again.ok) {
      // 注意补上 title，否则下游模板会打印出「《undefined》」
      return { pageUrl, title: pageUrl.replace(SITE, '') || '/', issues: [{ kind: 'page', what: `这一页打不开（${again.status}）` }] }
    }
    Object.assign(r, again)
  }

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

  // 每页设上限。一条失败的探测最坏要花 15+25+25 秒超时再加 5 秒等待，
  // 不封顶的话「40 篇文章 × 每篇 30 个链接」在被限流时能跑几个小时。
  const PER_PAGE = 25
  const linkList = [...links].slice(0, PER_PAGE)
  const imgList = [...imgs].slice(0, PER_PAGE)
  const skipped = (links.size - linkList.length) + (imgs.size - imgList.length)
  if (skipped) console.log(`  ${title}：链接太多，本次只查前 ${PER_PAGE} 个，跳过 ${skipped} 个`)

  const found = [
    ...(await mapLimit(linkList, 3, u => probe(u, 'link'))),
    ...(await mapLimit(imgList, 3, u => probe(u, 'img')))
  ].filter(Boolean)

  return { pageUrl, title, issues: issues.concat(found) }
}

// ---------------- 主流程 ----------------

export const patrol = async () => {
  // 金丝雀：先单独、干净地测一次首页。
  // 首页要是都取不到，那问题一定在这次运行的网络上，不在主人的站上。
  // 这时候任何「死链」结论都不可信，直接闭嘴。
  const canary = await hit(`${SITE}/`, 20000)
  if (canary.err || canary.status >= 400) {
    console.log(`  首页都取不到（${canary.err || 'HTTP ' + canary.status}）`)
    console.log('  这说明是本次运行的网络问题，不是站点故障。本次不发言。')
    return { checked: 0, reported: 0, aborted: true }
  }

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
  const results = await mapLimit(pages, 2, inspect)
  const broken = results.filter(r => r.issues.length)

  // 闸门：坏掉的比例太高，几乎肯定是我们这边被限流，而不是主人一夜之间写坏了半个站。
  // 宁可这次什么都不说，也不要在他的博客上公开发一堆假警报。
  const RATE_LIMIT_SUSPECT = 0.35
  if (pages.length >= 4 && broken.length / pages.length > RATE_LIMIT_SUSPECT) {
    console.log(`  ${pages.length} 篇里有 ${broken.length} 篇报错（${Math.round(broken.length / pages.length * 100)}%）`)
    console.log('  比例高得不正常，判定为扫描把自己打限流了，不是真故障。本次不发言。')
    broken.forEach(b => console.log(`     （跳过）${b.pageUrl.replace(SITE, '')}：${b.issues.map(i => i.what).join('；')}`))
    return { checked: pages.length, reported: 0, throttled: true }
  }

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
    // 必须是摘要，不能是截断的原文。原文都以「链接 /2026/07/20/」开头，
    // 截到 18 字节后不同文章的不同问题会算出同一个键 ——
    // 第二个问题会被当成「已经报过了」永远沉掉。
    const key = createHash('sha256').update(item.issues.map(i => i.what).join('|')).digest('base64url').slice(0, 24)

    let disc = findDiscussion(discussions, path)
    if (disc && hasMarker(disc, 'patrol', key)) { continue }

    const shown = item.issues.slice(0, 8)
    const list = shown.map(i => `- ${i.what}`).join('\n')
      + (item.issues.length > shown.length ? `\n- …另外还有 ${item.issues.length - shown.length} 处` : '')
    const said = await ask(
      '你是娜娜莉，住在这个博客里的猫娘。毒舌但可靠，自称「窝」，说话简短。禁止使用 • 和 ω。',
      `你在博客里闲逛时，发现《${item.title}》这篇有问题。

问题清单（这是你**唯一**知道的事实）：
${list}

写一条评论提醒主人。两三句话，先说你是怎么发现的（比如顺手点了个链接），再把问题列清楚。

**硬性约束，违反了会给主人惹麻烦：**
1. 只能陈述上面清单里的内容。清单之外的任何问题都不许提，一个字都不行
2. **不许推测原因。** 你只知道它打不开，不知道为什么。
   禁止说「地址写错了」「应该是 xxx」「服务器抽风」「少了文件名」这类猜测 ——
   你没有依据，说了就是编
3. 不许评论文章内容本身有什么毛病，那不是这次巡逻的范围
4. 别啰嗦，别道歉，也别假装很严重

这条评论会公开发在主人的博客上，读者都看得到。说错了是他丢人。`, 400)

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
