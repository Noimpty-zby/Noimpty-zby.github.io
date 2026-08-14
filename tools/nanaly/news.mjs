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

// 四个主题。
//
// 前两个是主人明确说「最想知道」的，而且他是**真的会拿去做决定**的 ——
// 所以这两块走深度思考（pro 模型），每条要写得足够长、必须落到
// 「这对一个想进游戏客户端岗的学生意味着什么」。
// 后两个是了解性质的，flash 够用，短一点也没关系。
const TOPICS = [
  {
    key: 'jobs',
    title: '行业职场动态',
    want: 3,
    deep: true,
    minWords: 120,
    // 他要的是客户端/引擎/Gameplay 岗位的动向，不是泛泛的行业新闻
    angle: `他的目标是**游戏客户端开发**（Gameplay / 引擎方向）的实习和校招。
所以「和他有关」的判据是：这条消息能不能改变他投哪家、准备什么、或者对行业的判断。
一条裁员新闻，如果裁的是发行和市场，对他几乎没意义；如果裁的是客户端/引擎组，
或者反过来某家在扩招客户端，那才值得写 —— 而且要写清楚是哪条线。`,
    queries: [
      '游戏 客户端 开发 招聘 校招 实习 岗位',
      '游戏公司 裁员 引擎组 技术中台 组织调整',
      'game client programmer hiring layoffs engine team',
      '游戏行业 校招 技术岗 趋势 2026'
    ]
  },
  {
    key: 'interview',
    title: '面试与求职干货',
    want: 3,
    deep: true,
    minWords: 140,
    angle: `他要面的是**游戏客户端 / Gameplay 岗**，技术栈是 UE5 + C++，
图形学在学 GAMES101 那条线，手上有一个 ActionRoguelike 的完整项目。
所以有用的是：真题和考点、项目怎么讲、简历怎么写、别人踩过的坑。
「保持自信、好好准备」这种正确的废话一个字都别写。
如果素材里有具体的题目或考点，**必须把题目本身摘出来**，
并且用一两句说清楚考的是什么、他现在的水平大概能不能答上。`,
    queries: [
      '游戏客户端 面试 真题 UE C++ 八股 面经',
      '游戏 引擎 开发 面试 经验 分享 校招',
      'game client programmer interview questions unreal c++',
      '图形学 面试 渲染管线 问题 校招'
    ]
  },
  {
    key: 'ue5',
    title: 'UE5 与引擎学习',
    want: 2,
    minWords: 60,
    angle: '偏向能直接写进项目、或者能在面试里说出来的东西。纯营销通稿跳过。',
    queries: [
      'Unreal Engine 5 教程 更新 新特性',
      'Unreal Engine 5 tutorial release notes rendering'
    ]
  },
  {
    key: 'games',
    title: '游戏与实况',
    want: 2,
    minWords: 50,
    angle: '轻松向。但如果某个新作的机制设计有值得拆解的地方，优先写那个。',
    queries: [
      '游戏 新作 实况 评测 值得关注',
      'new game release gameplay notable'
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
const attachSources = (md, hits) => {
  const lines = String(md || '').split('\n')
  const out = []
  let kept = 0
  for (const raw of lines) {
    const line = raw.trimEnd()
    // 条目行：允许 - * + 开头，编号允许半角/全角方括号
    const m = line.match(/^(\s*[-*+]\s*)[[［【]\s*(\d+)\s*[\]］】]\s*(.*)$/)
    if (!m) {
      // 非条目行（空行、她多写的一句话）保留，但不允许出现裸网址
      out.push(line.replace(/https?:\/\/\S+/g, '').replace(/[（(]\s*来源\s*[）)]/g, ''))
      continue
    }
    const hit = hits[Number(m[2])]
    if (!hit || !/^https?:\/\//i.test(hit.url)) continue   // 编号对不上就丢掉这条，不留半截
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
    out.push(`${m[1]}${text} [来源](${encodeURI(hit.url)})`)
    kept++
  }
  return kept ? out.join('\n').replace(/\n{3,}/g, '\n\n').trim() : ''
}

// 最近几期写过什么，避免连着三期都在说同一件事
const recentUrls = () => {
  const urls = new Set()
  try {
    readdirSync(DIR).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().slice(-4).forEach(d => {
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
  if (existsSync(`${dir}/index.md`)) {
    console.log(`  ${date} 这期已经写过了`)
    return null
  }

  const profile = readProfile()
  if (!profile) console.log('  （没找到 source/_data/noimpty-profile.md，这次只能按默认方向筛）')
  const old = recentUrls()
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
${profile || '（他是在学图形学和 UE5、准备找游戏客户端岗位的学生。）'}

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
${listed}`, t.deep ? 3000 : 1600, { deep: !!t.deep })

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
