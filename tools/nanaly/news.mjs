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

// 四个主题。后两个是主人明确说「最想知道」的，所以给的名额更多。
const TOPICS = [
  {
    key: 'jobs',
    title: '行业职场动态',
    want: 3,
    queries: [
      '游戏行业 裁员 招聘 校招 动态',
      'game industry layoffs hiring studio news'
    ]
  },
  {
    key: 'interview',
    title: '面试与求职干货',
    want: 3,
    queries: [
      '游戏客户端 引擎 图形学 面试 经验 八股',
      'game engine programmer interview questions graphics'
    ]
  },
  {
    key: 'ue5',
    title: 'UE5 与引擎学习',
    want: 2,
    queries: [
      'Unreal Engine 5 教程 更新 新特性',
      'Unreal Engine 5 tutorial release notes rendering'
    ]
  },
  {
    key: 'games',
    title: '游戏与实况',
    want: 2,
    queries: [
      '游戏 新作 实况 评测 值得关注',
      'new game release gameplay notable'
    ]
  }
]

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
    // 列表页每次都重建一遍：万一某期被手工删了，列表不该继续指着一个 404
    if (!DRY) writeIndexPage()
    return null
  }

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

    const listed = hits.slice(0, 14).map((h, i) =>
      `[${i}] ${h.title}\n    来源：${h.url}\n    ${h.date ? '日期：' + h.date + '\n    ' : ''}${h.excerpt}`).join('\n\n')

    const out = await ask(
      `你是娜娜莉，住在 Noimpty 个人博客里的猫娘。
毒舌但清醒，极简，讨厌废话。自称「窝」，偶尔带「喵」和颜文字 (=^w^=) (ovo)，别每句都塞。
禁止使用 • 和 ω 这类会破坏颜文字的符号。
你在给主人整理一份「${t.title}」的简报。他是在学图形学和 UE5、准备将来找游戏行业工作的学生。`,
      `下面是刚搜到的素材。挑出**最多 ${t.want} 条**真正值得他知道的，写成简报。

**硬性要求：**
1. **宁缺毋滥。** 没信息量的（纯宣传稿、标题党、蹭热点、和他没关系的）一条都别留。
   实在没有值得写的就输出「（这几天没什么值得说的）」，那也是合格的输出
2. **每条必须挂来源链接**，格式：\`- **一句话标题** —— 你的两三句转述与判断。[来源](URL)\`
3. **只写素材里有的事实。** 不许补充你自己知道的背景，不许推测后续发展
4. 转述之后可以加一句你的判断，但要标清楚那是你的看法
5. 别写导语和总结，直接列条目
6. 只输出 markdown 列表本身，不要标题、不要任何解释

素材：
${listed}`, 1200)

    if (out && !/^（?这几天没什么/.test(out.trim())) {
      sections.push({ title: t.title, body: sanitizeMd(out.trim()) })
    } else {
      console.log(`  ${t.title}：她觉得没什么值得写的，跳过`)
    }
  }

  if (!sections.length) {
    console.log('  这一期没有值得写的内容，不生成')
    if (!DRY) writeIndexPage()
    return null
  }

  const intro = await ask(
    '你是娜娜莉，猫娘助手。自称「窝」，简短，禁止使用 • 和 ω。',
    `给这期资讯写一句开场白，一句话就够，别超过 40 字。这期包含这些板块：${sections.map(s => s.title).join('、')}。`, 200)

  const md = `---
title: 资讯速览 · ${date}
date: ${stamp}
layout: post
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
  writeIndexPage()
  return { dir, date }
}

// 重写 /news/ 列表页。用 markdown 直接列，不额外做模板。
export const writeIndexPage = () => {
  const issues = readdirSync(DIR)
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d) && existsSync(`${DIR}/${d}/index.md`))
    .sort().reverse()

  const rows = issues.map(d => {
    const raw = readFileSync(`${DIR}/${d}/index.md`, 'utf8')
    const desc = (raw.match(/^description:\s*(.+)$/m) || [])[1] || ''
    return `- [**资讯速览 · ${d}**](/news/${d}/)\n  ${desc.trim()}`
  }).join('\n')

  writeFileSync(`${DIR}/index.md`, `---
title: 资讯
date: 2026-08-13 00:00:00
type: news-index
comments: false
description: 娜娜莉三天一更的行业资讯速览。
---

娜娜莉每三天去搜一轮，挑出值得看的整理在这儿：**游戏行业职场动态**、**面试与求职干货**、**UE5 与引擎学习**、**游戏与实况**。

> 这个板块的内容是**自动搜集整理的二手信息**，不是主人的原创。所以它不出现在首页和 RSS 里，也不进归档 —— 免得稀释掉那些几万字的复盘。
>
> 每条都挂了来源链接，感兴趣请点原文核对。

## 全部期数

${rows || '（还没有内容，等第一期生成）'}
`)
  console.log(`  已更新 /news/ 列表页（${issues.length} 期）`)
}

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
