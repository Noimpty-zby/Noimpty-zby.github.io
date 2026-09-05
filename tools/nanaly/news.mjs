// 三天一期的资讯。娜娜莉自己去搜、自己筛、自己写。
//
// 两条硬规矩，决定了这个板块是有用还是垃圾：
//   1. 每一条都必须挂来源链接。她转述的东西，你得能一键去核对
//   2. 宁可少写几条，也不要为了凑数把没信息量的东西塞进来。
//      「XX 公司发布了新产品」这种标题党，删掉比留着强
//
// 内容做成 Hexo 的 page 而不是 post，这样它天然不会出现在
// 首页、归档和 RSS 里，不会稀释主人那些几万字的原创复盘。

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { ask } from '../daily-report/narrate.mjs'
import { triggerDeploy } from './github.mjs'
import { pushWithRetry, safeGitEmail, sanitizeMd, stripAngles } from './git.mjs'

const DIR = 'source/news'
const DRY = process.argv.includes('--dry')
const TAVILY_KEY = process.env.TAVILY_API_KEY || ''

/* 四个主题。
 *
 * 前两个是主人明确说「最想知道」的，而且他是**真的会拿去做决定**的 ——
 * 所以这两块走深度思考（pro 模型），每条要写得足够长、必须落到
 * 「这对一个想进 AI Infra / 后端岗的学生意味着什么」。
 * 后两个是学习和动手性质的，flash 够用，短一点也没关系。
 *
 * ⚠️ 这张表是**搜索词的源头**，它决定了 Tavily 会捞回什么。
 * 光改 source/_data/noimpty-profile.md 是不够的 —— profile 只能让她
 * 「把捞回来的东西筛掉」，捞的动作还是照这里搜。
 * 2026-08-26 主人从游戏客户端转到 AI Infra，profile 当天就改了，
 * 但这张表一直留着「游戏客户端 面试 真题 UE C++ 八股 面经」这种查询，
 * 于是接下来每一期都在搜游戏、筛游戏、写游戏 —— 2026-09-04 那期三条全是
 * 米哈游 C++ 面经和多益的游戏客户端岗。搜索费和两次 pro 模型的钱全白花。
 * **以后再换方向，profile 和这张表必须一起改。** */
export const TOPICS = [
  {
    key: 'jobs',
    title: '岗位与行业动态',
    want: 3,
    deep: true,
    minWords: 120,
    angle: `他的目标是 **AI Infra / 后端开发**的实习和校招。
所以「和他有关」的判据是：这条消息能不能改变他投哪家、准备什么、或者对这条路的判断。
一条大模型融资、发布会、榜单的新闻对他没有意义；
「某家在扩招推理平台 / 基础设施」、「这类岗位现在到底要求会什么」才值得写 ——
而且要写清楚是哪条线。
**游戏行业的岗位一条都别写。方向 2026-08 已经转了，那一类现在是噪音。**`,
    queries: [
      'AI Infra 基础设施 后端 招聘 实习 校招 岗位',
      '推理平台 训练平台 工程师 招聘 要求 技能栈',
      'AI infrastructure platform engineer hiring requirements',
      '后端开发 校招 2026 要求 趋势 Go 云原生'
    ]
  },
  {
    key: 'interview',
    title: '面试与求职干货',
    want: 3,
    deep: true,
    minWords: 140,
    angle: `他要面的是 **AI Infra / 后端岗**，在补的基础是
Linux → Git → Go → MySQL → Docker → 推理机制，课内还有数据结构和 CSAPP。
**但他现在的水平很低，别高估**：Linux 命令行学到第三章，Git 到基本循环，
Go 一行没写过，数据结构刚开篇。
所以对他有用的是**入门到中段的真题和考点**，以及「项目怎么讲、简历怎么写」——
他简历上工程侧目前是空的。分布式共识、内核调优这种深水区的八股，
现在写给他等于白写。
如果素材里有具体的题目或考点，**必须把题目本身摘出来**，
并且用一两句说清楚考的是什么、以他现在的水平大概能不能答上。
「保持自信、好好准备」这种正确的废话一个字都别写。
**游戏客户端 / UE / 图形学的面经一条都别选。**`,
    queries: [
      '后端 面试 真题 面经 Go 并发 Linux 校招',
      'MySQL 索引 事务 慢查询 面试题 后端',
      'backend infrastructure interview questions kubernetes docker linux',
      '实习 简历 项目 怎么写 后端 没有经验'
    ]
  },
  {
    key: 'practice',
    title: '工程实践与踩坑',
    want: 2,
    minWords: 60,
    angle: `Linux、Git、Go、MySQL、Docker 这几门课里**能直接跟着做**的东西，
以及别人真实踩过的坑（权限、容器网络、慢查询、goroutine 泄漏这类）。
按他现在的水平挑：**一篇能跟着做完的入门实操，胜过一篇看不懂的先进阶资料。**
纯概念综述、营销通稿、"2026 年十大趋势"这种跳过。`,
    queries: [
      'Linux 命令行 权限 管道 实践 踩坑 入门',
      'Go 并发 goroutine channel 实践 踩坑 内存',
      'Docker 容器 入门 实操 网络 卷 踩坑',
      'MySQL 索引 慢查询 优化 实战 入门'
    ]
  },
  {
    key: 'project',
    title: '能上手的小项目',
    want: 2,
    minWords: 50,
    angle: `他现在最缺的是**工程侧的东西** —— 没写过服务、没碰过容器与编排、
没做过分布式，简历上这一块是空的。
所以这一栏只收「**一个人能做完、能写进简历**」的后端 / Infra 小项目：
步骤清晰、有仓库或教程、规模不大。
动辄几万字的系统设计大部头别选，他现在做不完，收藏了也是吃灰。`,
    queries: [
      '后端 小项目 练手 从零实现 教程 开源',
      'build your own database web server 从零实现',
      'side project backend golang build from scratch tutorial'
    ]
  }
]

// 主人自己维护的方向说明。她搜之前先读一遍，按上面写的标准筛。
const PROFILE_FILE = 'source/_data/noimpty-profile.md'
export const readProfile = () => {
  try { return readFileSync(PROFILE_FILE, 'utf8').slice(0, 6000) } catch (_) { return '' }
}

const searchWeb = async (query, maxResults = 8) => {
  if (!TAVILY_KEY) throw new Error('没有 TAVILY_API_KEY')
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TAVILY_KEY}` },
    body: JSON.stringify({
      query,
      topic: 'news',
      time_range: 'week',   // 三天一期，取一周留点余量，重复的靠去重处理
      max_results: maxResults,
      search_depth: 'basic',
      include_answer: false,
      include_raw_content: false
    }),
    signal: AbortSignal.timeout(40000)
  })
  if (!res.ok) throw new Error(`Tavily ${res.status} ${(await res.text()).slice(0, 140)}`)
  const data = await res.json()
  return (data.results || []).map(r => ({
    title: stripAngles(String(r.title || '')).trim(),
    url: String(r.url || '').trim(),
    date: String(r.published_date || '').slice(0, 10),
    excerpt: stripAngles(String(r.content || '')).replace(/\s+/g, ' ').slice(0, 700)
  })).filter(r => r.url && r.title)
}

// 跨主题去重：同一条新闻经常被多个查询搜到
const dedupe = items => {
  const seen = new Set()
  return items.filter(r => {
    const k = r.url.replace(/[?#].*$/, '').replace(/\/$/, '').toLowerCase()
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/* 把「[3]」换成真正的来源链接。
 *
 * 以前是让模型自己写 `[来源](URL)`。上线之后链接点不开 —— 因为中文模型写
 * markdown 时经常用全角括号 `（）`、把 URL 后面的句号吞进去、或者干脆把网址
 * 记岔了。链接是这个板块唯一的价值（「转述难免有偏差，请点原文核对」），
 * 一条点不开的链接比没有还糟。
 *
 * 所以现在只让她挑编号，链接由这边照着检索结果原样拼。她编不出来，也写不坏。
 */
/* ⚠️ 上面那一层挡住了「编造网址」，但挡不住另一种错，而它在线上真的发生了：
 *
 *   **编号张冠李戴。** 她写「A 公司裁了引擎组」，标的却是 [3]，
 *   而 [3] 是一条讲面试的。链接能点开、域名也真、看起来一切正常 ——
 *   点进去才发现文不对题。主人的原话：「来源链接根本无法指引到真正的出处」。
 *
 * 根源是模型在长素材列表里数错行，靠改提示词压不住。所以加一道内容校验：
 *
 *   条目文字和它标的那条素材对得上        → 照常挂
 *   对不上，但另一条明显更像              → 改挂那一条，日志里说明改过
 *   对不上，也没有更像的                  → 整条丢掉
 *
 * 顺带把域名写进链接文字（`[来源 · gamedeveloper.com]`）——
 * 万一还有漏网的，在页面上一眼就能看出不对劲，不用点进去才发现。
 */
const attachSources = (md, hits) => {
  // 中文没有空格分词，用 2-gram 粗略比。够用，不值得为这个上分词器。
  const bigrams = s => {
    const t = String(s || '').toLowerCase()
      .replace(/[\s　，。！？、；：""''「」《》（）()[\]{}<>·~!?,.:;"'\-_/\\|+*#@$%^&=]/g, '')
    const set = new Set()
    for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2))
    return set
  }

  // 条目文字有多少落在这条素材里。0 = 完全不沾边，1 = 全都对得上。
  const overlap = (text, hit) => {
    const a = bigrams(text)
    if (!a.size) return 0
    const b = bigrams(`${hit.title || ''} ${hit.excerpt || ''}`)
    if (!b.size) return 0
    let n = 0
    a.forEach(g => { if (b.has(g)) n++ })
    return n / a.size
  }

  /* 太短的条目没法判断 —— 三五个字的重合度纯属噪声，
   * 真按阈值一刀切会把正常条目误杀。真实条目都在一百字以上，
   * 所以短于这个长度的一律放行，交给编号本身兜着。 */
  const JUDGEABLE = 12
  const judgeable = text => bigrams(text).size >= JUDGEABLE

  /* 阈值 0.18。她是**转述**不是摘抄，重合度本来就不会高 ——
   * 正常条目大致落在 0.3 以上，标错的在 0.05 以下，中间是一片空白。
   * 0.18 落在那片空白里：往上抬会误伤转述得比较自由的条目，往下压则拦不住真错的。 */
  const MIN = 0.18
  // 改挂的门槛更高：必须明显更像，否则宁可丢掉也不猜
  const REMAP_MIN = 0.32

  const lines = String(md || '').split('\n')
  const out = []
  let kept = 0
  let remapped = 0
  let dropped = 0

  for (const raw of lines) {
    const line = raw.trimEnd()
    // 条目行：允许 - * + 开头，编号允许半角/全角方括号
    const m = line.match(/^(\s*[-*+]\s*)[[［【]\s*(\d+)\s*[\]］】]\s*(.*)$/)
    if (!m) {
      // 非条目行（空行、她多写的一句话）保留，但不允许出现裸网址
      out.push(line.replace(/https?:\/\/\S+/g, '').replace(/[（(]\s*来源\s*[）)]/g, ''))
      continue
    }
    // 她正文里若还是自己写了链接或网址，一律清掉，只留窝拼的这一个
    const text = sanitizeMd(m[3])
      .replace(/\[([^\]\n]*)\]\([^)\s]*\)/g, '$1')
      // 连着包住网址的括号一起清 —— URL 不能吃掉右括号，否则会剩一个孤零零的「（」
      .replace(/[[［【(（]?\s*https?:\/\/[^\s)）\]］】]*\s*[)）\]］】]?/g, '')
      // 她写的「来源 / 原文 / 链接」标签，各种括号形态一并清掉，只留窝拼的那个
      .replace(/[[［【(（]?\s*(来源|原文|链接|source)\s*[\]］】)）]?/gi, '')
      .replace(/[[［【(（]\s*[\]］】)）]/g, '')
      .replace(/[\s，、]+$/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim()
    if (!text) continue

    const usable = h => h && /^https?:\/\//i.test(h.url)
    let hit = usable(hits[Number(m[2])]) ? hits[Number(m[2])] : null

    // 编号本身就对不上（她编了一个超出范围的号）→ 直接丢，不留半截无源条目
    if (!hit) {
      console.log(`  [来源丢弃]「${text.replace(/\*/g, '').slice(0, 22)}…」标的 [${m[2]}] 根本不存在，整条丢掉`)
      dropped++
      continue
    }

    const score = judgeable(text) ? overlap(text, hit) : 1

    if (score < MIN) {
      // 有没有哪条素材明显更像？有就改挂它 —— 她想写的多半就是那条，只是数错了行
      let best = null
      let bestScore = 0
      for (const h of hits) {
        if (!usable(h)) continue
        const s = overlap(text, h)
        if (s > bestScore) { bestScore = s; best = h }
      }
      const label = text.replace(/\*/g, '').slice(0, 22)
      if (best && bestScore >= REMAP_MIN) {
        console.log(`  [来源校正]「${label}…」标的是 [${m[2]}]，内容其实对应《${String(best.title).slice(0, 24)}》，已改挂`)
        hit = best
        remapped++
      } else {
        console.log(`  [来源丢弃]「${label}…」标的 [${m[2]}] 和内容对不上（重合度 ${score.toFixed(2)}），也没有更像的，整条丢掉`)
        dropped++
        continue
      }
    }

    // 域名写进链接文字：万一还有漏网的，一眼能看出不对劲
    let host = ''
    try { host = new URL(hit.url).hostname.replace(/^www\./, '') } catch (_) {}
    out.push(`${m[1]}${text} [来源${host ? ' · ' + host : ''}](${encodeURI(hit.url)})`)
    kept++
  }

  if (remapped || dropped) {
    console.log(`  来源校验：保留 ${kept} 条，改挂 ${remapped} 条，丢弃 ${dropped} 条`)
  }
  return kept ? out.join('\n').replace(/\n{3,}/g, '\n\n').trim() : ''
}

// 最近几期写过什么，避免连着三期都在说同一件事
const recentUrls = (skipDate = null) => {
  const urls = new Set()
  try {
    readdirSync(DIR).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d) && d !== skipDate).sort().slice(-4).forEach(d => {
      const f = `${DIR}/${d}/index.md`
      if (!existsSync(f)) return
      ;[...readFileSync(f, 'utf8').matchAll(/\((https?:\/\/[^)]+)\)/g)]
        .forEach(m => urls.add(m[1].replace(/[?#].*$/, '').replace(/\/$/, '').toLowerCase()))
    })
  } catch (_) {}
  return urls
}

const pad = n => String(n).padStart(2, '0')
const beijingNow = () => new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
}).format(new Date())

export const buildNews = async () => {
  const stamp = beijingNow()
  const date = stamp.slice(0, 10)
  const dir = `${DIR}/${date}`
  // 「今天已经写过」这道防重复有两个例外，都是被实际用起来之后才发现的：
  //
  //   演练     —— 演练一个字都不写盘，它唯一的用途就是先看看会写成什么样。
  //               被这道判断挡住的话，一天只能看一次，那还叫什么演练。
  //   FORCE=1  —— 改了提示词想立刻看新效果时，不该逼你先去仓库里手动删文件夹。
  const already = existsSync(`${dir}/index.md`)
  const force = process.env.NANALY_FORCE === '1'
  if (already && !DRY && !force) {
    console.log(`  ${date} 这期已经写过了`)
    console.log('  想重写这一期：把工作流的「强制重写」勾上，或者删掉 source/news/' + date + '/')
    return null
  }
  if (already) {
    console.log(force
      ? `  ${date} 这期已经存在，但你要求强制重写 —— 会覆盖掉旧的那一期`
      : `  ${date} 这期已经存在 —— 正式跑会跳过，但演练照常给你看会写成什么样`)
  }

  const profile = readProfile()
  if (!profile) console.log('  （没找到 source/_data/noimpty-profile.md，这次只能按默认方向筛）')
  // 重写这一期时，要把这一期自己从去重里排除掉，
  // 否则她今天写过的链接全被滤掉，重写出来是空的
  const old = recentUrls(already ? date : null)
  const sections = []

  for (const t of TOPICS) {
    let hits = []
    for (const q of t.queries) {
      try { hits = hits.concat(await searchWeb(q)) }
      catch (e) { console.log(`  搜「${q.slice(0, 20)}…」失败：${String(e.message).slice(0, 80)}`) }
    }
    hits = dedupe(hits).filter(h => !old.has(h.url.replace(/[?#].*$/, '').replace(/\/$/, '').toLowerCase()))
    console.log(`  ${t.title}：搜到 ${hits.length} 条可用`)
    if (!hits.length) continue

    const POOL = t.deep ? 20 : 14
    const listed = hits.slice(0, POOL).map((h, i) =>
      `[${i}] ${h.title}\n    来源：${h.url}\n    ${h.date ? '日期：' + h.date + '\n    ' : ''}${h.excerpt}`).join('\n\n')

    const out = await ask(
      `你是娜娜莉，住在 Noimpty 个人博客里的猫娘。
毒舌但清醒，极简，讨厌废话。自称「窝」，偶尔带「喵」和颜文字 (=^w^=) (ovo)，别每句都塞。
禁止使用 • 和 ω 这类会破坏颜文字的符号。
你在给主人整理一份「${t.title}」的简报。

【主人的情况】
${profile || '（他是在补 Linux / Git / Go / MySQL、准备找 AI Infra 或后端实习的学生，水平还很低。）'}

【这一栏的角度】
${t.angle || ''}`,
      `下面是刚搜到的素材，每条前面有个编号。挑出**最多 ${t.want} 条**真正值得他知道的，写成简报。

**格式（严格照抄）：**
\`- [编号] **一句话标题** —— 正文\`
例如：\`- [3] **某公司裁了整个引擎组** —— ……\`
**不要自己写网址，不要写「来源」两个字**，链接窝这边会自动挂上去。
编号必须是素材里真实存在的那个数字，不许编。

**每一条的正文要包含这三层，缺一层都算不合格：**
1. **发生了什么** —— 具体的事实：谁、什么时候、多少人、什么版本、什么数字。
   只写素材里有的，素材没写的就说「没说」，不许补你自己知道的背景，不许推测后续
2. **对他意味着什么** —— 这是最重要的一层。结合上面【主人的情况】，
   说清楚这条消息改变了什么：该投哪家、该准备什么、该怎么调整判断。
   如果诚实地说「这条对他其实没什么直接影响」，那就别选这一条
3. **窝的看法** —— 一句你自己的判断，要说得具体，并且**明确标出这是你的看法**
   （用「窝觉得」开头）。不许写「值得关注」「值得学习」这种谁都能说的话

**篇幅：每条正文至少 ${t.minWords} 字。** 写不到这个长度，说明你没想清楚，
那就别选这一条 —— 少写一条永远好过写一条废话。

**宁缺毋滥。** 纯宣传稿、标题党、蹭热点、和他方向不沾边的，一条都别留。
实在没有值得写的就只输出「（这几天没什么值得说的）」，那也是合格的输出。

别写导语和总结，直接列条目。只输出 markdown 列表本身。

素材：
${listed}`, t.deep ? 5000 : 1600, { deep: !!t.deep, retries: 1, label: t.key })

    const body = out ? attachSources(out.trim(), hits.slice(0, t.deep ? 20 : 14)) : ''
    if (body && !/^（?这几天没什么/.test(out.trim())) {
      sections.push({ title: t.title, body })
    } else if (out && !/^（?这几天没什么/.test(out.trim())) {
      console.log(`  ${t.title}：她写的条目一条都没挂上来源，整段丢弃`)
    } else {
      console.log(`  ${t.title}：她觉得没什么值得写的，跳过`)
    }
  }

  if (!sections.length) {
    console.log('  这一期没有值得写的内容，不生成')
    return null
  }

  const intro = await ask(
    '你是娜娜莉，猫娘助手。自称「窝」，简短，禁止使用 • 和 ω。',
    `给这期资讯写一句开场白，一句话就够，别超过 40 字。这期包含这些板块：${sections.map(s => s.title).join('、')}。`, 200)

  // 注意：**绝对不要给这里加 layout: post**。
  // 这是 Hexo 的 page 不是 post，而 Butterfly 的 post 头部模板会去读
  // page.categories.data —— page 上没有这个字段，直接抛 TypeError。
  // 后果特别隐蔽：hexo generate 照常「成功」，只是把这个页面渲染成一个
  // 0 字节的 index.html。工作流全绿、文件也在仓库里，点进去却是一片空白。
  const md = `---
title: 资讯速览 · ${date}
date: ${stamp}
type: news
comments: true
description: 娜娜莉整理的三日资讯：${sections.map(s => s.title).join('、')}。
---

> ${sanitizeMd((intro || '窝把这三天值得看的都捞过来了喵。').trim())}
>
> **这一期由娜娜莉自动搜集整理，不是主人写的。** 每条都挂了来源，看到感兴趣的请点进原文核对 —— 转述难免有偏差。

${sections.map(s => `## ${s.title}\n\n${s.body}`).join('\n\n')}

---

<sub>整理时间：${stamp}（北京时间）· 素材来自 Tavily 检索 · 由娜娜莉筛选转述</sub>
`

  if (DRY) {
    console.log('\n  [演练] 会生成 ' + dir + '/index.md：\n')
    console.log(md.split('\n').map(l => '    ' + l).join('\n'))
    return { dir, date, dry: true }
  }

  mkdirSync(dir, { recursive: true })
  writeFileSync(`${dir}/index.md`, md)
  console.log(`  已写入 ${dir}/index.md（${sections.length} 个板块）`)
  console.log('  /news/ 列表页会在构建时自动带上这一期，不需要额外提交')
  return { dir, date }
}

/* 列表页不再由她维护 —— 交给 scripts/noimpty-news-index.js 在构建时现扫现生成。
 *
 * 以前这里会重写 source/news/index.md 再一起提交。只要那一步没走到
 * （她挂了 / 推送被拒 / 你本地覆盖回旧版 / 你手工删了一期），
 * 就会出现「内容页在线上、列表页却写着『还没有内容』」这种自相矛盾的状态。
 * 现在列表页里只有一个占位符，构建时按目录真实情况填 —— 不可能对不上。
 */
export const commitNews = async (label) => {
  const run = (...a) => execFileSync('git', a, { encoding: 'utf8', stdio: 'pipe' })
  run('config', 'user.name', process.env.NANALY_GIT_NAME || '娜娜莉')
  run('config', 'user.email', safeGitEmail())
  run('add', DIR)
  if (!run('status', '--porcelain', '--', DIR).trim()) { console.log('  没有变化，不提交'); return false }
  run('commit', '-m', `娜娜莉：资讯速览 ${label}`)
  pushWithRetry(run, '资讯')
  console.log('  已提交并推送')
  await triggerDeploy()
  return true
}
