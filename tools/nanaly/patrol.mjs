// 娜娜莉的巡逻：她自己在博客里逛，点开每篇文章、点每个链接、看每张图。
// 发现坏掉的东西，就到那篇文章的评论区留言提醒主人。
//
// 她只在「确实发现问题」时说话，而且同一个问题只说一次（靠评论里的隐藏标记判重）。
// 一个每天重复念叨的机器人只会让人把通知关掉。

import { listDiscussions, createDiscussion, addComment, addReaction, marker, hasMarker, SIGN, findDiscussion, giscusTitle } from './github.mjs'
import { ask } from '../daily-report/narrate.mjs'
import { hit, probeUrl, mapLimit, sleep, looksThrottled, sitePages, PAGE_RE } from './probe.mjs'
import { note, digest } from './journal.mjs'
import { createHash } from 'node:crypto'

const SITE = (process.env.SITE_URL || 'https://noimpty-zby.github.io').replace(/\/$/, '')
const T = (ms = 15000) => AbortSignal.timeout(ms)
const DRY = process.argv.includes('--dry')

const getText = async url => {
  const res = await fetch(url, { signal: T(20000), redirect: 'follow' })
  return { status: res.status, ok: res.ok, body: res.ok ? await res.text() : '' }
}

// ---------------- 逐篇体检 ----------------

export const isInternal = u => {
  try { return new URL(u).origin === new URL(SITE).origin } catch (_) { return false }
}

/* 探测结果 → 一句人话。
 *
 * 「怎么判一个地址是不是真坏了」那四道关在 probe.mjs 里，日报的健康检查
 * 用的是同一份 —— 这里曾经把整套（hit / verdictOf / 两段式复核 / 限流闸门）
 * 又抄了一遍，probe.mjs 开头那句「别再各写一套」就是为此写的。
 * 两份当时行为一致，但下次只会有一份被修。现在这里只剩措辞。
 *
 * 措辞值得单独抽出来测：它会原样出现在她公开发的评论里，
 * 而那条评论署的是主人博客的名。 */
export const issueOf = (u, kind, inside, bad) => {
  if (!bad) return null
  const label = kind === 'img' ? '图片' : '链接'
  const shown = inside ? (u.replace(SITE, '') || '/') : u
  if (bad.verdict === 'unreachable') {
    return { kind, what: `${label} ${shown} 连续三次都连不上`, url: u }
  }
  return inside
    ? { kind, what: `${label} ${shown} 返回 ${bad.status}`, url: u }
    : { kind, what: `站外${label} ${u} 已经失效了（${bad.status}）`, url: u }
}

const probe = async (u, kind) => {
  const inside = isInternal(u)
  return issueOf(u, kind, inside, await probeUrl(u, inside))
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

const PATROL_PERSONA = '你是娜娜莉，住在这个博客里的猫娘。毒舌但可靠，自称「窝」，说话简短。禁止使用 • 和 ω。'

// 固定的排前面，变量排后面 —— 规矩和原因见 narrate.mjs 里 reviewPrompt 上面那段。
// 原来第一行是《文章标题》，把下面那整块硬性约束（约 250 token）全踩脏了。
export const patrolPrompt = (title, list, recent = '') => `你在博客里闲逛时，发现有一篇文章出了问题。

写一条评论提醒主人。两三句话，先说你是怎么发现的（比如顺手点了个链接），再把问题列清楚。

**硬性约束，违反了会给主人惹麻烦：**
1. 只能陈述下面清单里的内容。清单之外的任何问题都不许提，一个字都不行
2. **不许推测原因。** 你只知道它打不开，不知道为什么。
   禁止说「地址写错了」「应该是 xxx」「服务器抽风」「少了文件名」这类猜测 ——
   你没有依据，说了就是编
3. 不许评论文章内容本身有什么毛病，那不是这次巡逻的范围
4. 别啰嗦，别道歉，也别假装很严重

这条评论会公开发在主人的博客上，读者都看得到。说错了是他丢人。
${recent ? `
━━━ 你最近干过的事（只为了让你知道自己是谁、别把自己说成外人）━━━
${recent}
⚠️ 上面这些**一条都不是这次发现的问题**。最多自然地带一句「窝昨天也路过这篇」，
把它们当成故障写进去就是编。
` : ''}
━━━ 这一篇 ━━━
《${title}》

问题清单（这是你**唯一**知道的事实）：
${list}`

export const patrolSummary = ({ checked, reported, alreadyReported, failed, broken, titles = [] }) => {
  const parts = [`巡逻了 ${checked} 篇`]
  if (!broken) parts.push('未发现本次检查范围内的问题')
  if (reported) parts.push(`成功留言 ${reported} 条${titles.length ? '，涉及' + titles.slice(0, 3).map(title => `《${title}》`).join('、') : ''}`)
  if (alreadyReported) parts.push(`${alreadyReported} 篇的问题此前已提醒，本次未重复留言`)
  if (failed) parts.push(`${failed} 篇的问题未能送达提醒，请查看运行日志重试`)
  return parts.join('；')
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
    // 没做成的事也要记：她自己得知道「今天不是没巡逻，是巡逻不成」
    note('patrol', '想去巡逻，可连首页都取不到 —— 判断是这次运行的网络有问题，没敢在站上说话')
    return { checked: 0, reported: 0, aborted: true }
  }

  // 页面清单来自锁清单，不是 sitemap —— 全站上锁之后 sitemap 已经不存在了，
  // 详见 probe.mjs 里 sitePages 上面那段。
  const all = await sitePages(SITE)
  if (!all) { console.log('  取不到锁清单，巡逻取消'); return { checked: 0, reported: 0 } }

  const pages = all
    .filter(u => PAGE_RE.test(u.slice(SITE.length)))   // 只巡逻文章页
    .slice(0, 40)

  console.log(`  要巡逻 ${pages.length} 篇文章`)
  const results = await mapLimit(pages, 2, inspect)
  const broken = results.filter(r => r.issues.length)

  // 闸门：坏掉的比例太高，几乎肯定是我们这边被限流，而不是主人一夜之间写坏了半个站。
  // 宁可这次什么都不说，也不要在他的博客上公开发一堆假警报。（阈值同样在 probe.mjs）
  if (looksThrottled(broken.length, pages.length)) {
    console.log(`  ${pages.length} 篇里有 ${broken.length} 篇报错（${Math.round(broken.length / pages.length * 100)}%）`)
    console.log('  比例高得不正常，判定为扫描把自己打限流了，不是真故障。本次不发言。')
    broken.forEach(b => console.log(`     （跳过）${b.pageUrl.replace(SITE, '')}：${b.issues.map(i => i.what).join('；')}`))
    note('patrol', `巡逻 ${pages.length} 篇时有 ${broken.length} 篇报错，比例高得不正常，判定是自己把自己打限流了，一句话都没说`)
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
  let alreadyReported = 0
  let failed = 0
  const toldAbout = []
  for (const item of broken) {
    const path = new URL(item.pageUrl).pathname
    // 同一篇文章的同一组问题只提醒一次
    // 必须是摘要，不能是截断的原文。原文都以「链接 /2026/07/20/」开头，
    // 截到 18 字节后不同文章的不同问题会算出同一个键 ——
    // 第二个问题会被当成「已经报过了」永远沉掉。
    const key = createHash('sha256').update(item.issues.map(i => i.what).join('|')).digest('base64url').slice(0, 24)

    let disc = findDiscussion(discussions, path)
    if (disc && hasMarker(disc, 'patrol', key)) { alreadyReported++; continue }

    const shown = item.issues.slice(0, 8)
    const list = shown.map(i => `- ${i.what}`).join('\n')
      + (item.issues.length > shown.length ? `\n- …另外还有 ${item.issues.length - shown.length} 处` : '')
    const said = await ask(PATROL_PERSONA, patrolPrompt(item.title, list, digest({ limit: 8 })), 400, { label: '巡逻' })


    const body = (said || `[抖了抖耳朵] 窝路过这篇，顺手点了几个链接，有东西坏了喵：\n\n${list}`)
      + `\n\n<details><summary>具体是这些</summary>\n\n${list}\n\n</details>`
      + SIGN + marker('patrol', key)

    if (DRY) {
      console.log(`\n  [演练] 会在 ${path} 评论：\n${body.split('\n').map(l => '    ' + l).join('\n')}\n`)
      reported++
      toldAbout.push(item.title)
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
          failed++
          continue
        }
      }
      await addComment(disc.id, body)
      reported++
      toldAbout.push(item.title)
      console.log(`  已在 ${path} 留言`)
    } catch (e) {
      failed++
      console.log(`  在 ${path} 留言失败：${e.message}`)
    }
  }
  note('patrol', patrolSummary({ checked: pages.length, reported, alreadyReported, failed, broken: broken.length, titles: toldAbout }))
  return { checked: pages.length, reported, alreadyReported, failed }
}

// ---------------- 贴表情 ----------------
//
// 她读到喜欢的文章会顺手贴个表情。同一篇只贴一次。

const MOODS = ['HEART', 'HOORAY', 'ROCKET', 'EYES']

/* 挑谁贴表情。
 *
 * 判据必须是「**她**贴过没有」，而不是「有没有人贴过」—— 老代码是后者：
 * 读者随手点一个 ❤️，她就永远不会再给那篇贴了。讨论的查询里本来就
 * 取了 user{login}，只是没用上。
 *
 * NANALY_LOGIN 没配时分不清谁贴的，那就退回旧行为（有人贴过就不碰）：
 * 宁可少贴一个，也不要在同一篇下面重复堆表情。 */
export const reactTargets = (discussions, limit = 3, login = process.env.NANALY_LOGIN) => {
  const her = String(login || '').toLowerCase()
  const hersAlready = d => {
    const rs = d.reactions?.nodes || []
    if (!rs.length) return false
    return her ? rs.some(r => String(r.user?.login || '').toLowerCase() === her) : true
  }
  return (discussions || [])
    .filter(d => /^\/?\d{4}\//.test(d.title) && !hersAlready(d))
    .slice(0, limit)
}

export const react = async (limit = 3) => {
  const discussions = await listDiscussions().catch(() => null)
  if (!discussions) return 0
  const targets = reactTargets(discussions, limit)
  let n = 0
  for (const d of targets) {
    // 用标题算出固定的表情，避免每次跑结果都不一样
    const idx = [...d.title].reduce((a, c) => (a + c.charCodeAt(0)) % 997, 0) % MOODS.length
    if (DRY) { console.log(`  [演练] 会给 ${d.title} 贴 ${MOODS[idx]}`); n++; continue }
    try { if (await addReaction(d.id, MOODS[idx])) { n++; console.log(`  给 ${d.title} 贴了 ${MOODS[idx]}`) } }
    catch (e) { console.log(`  贴表情失败：${e.message}`) }
  }
  if (n) note('react', `顺手给 ${n} 篇文章贴了表情`)
  return n
}
