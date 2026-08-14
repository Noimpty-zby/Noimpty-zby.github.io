/* 点子挖掘：为主人明年的腾讯游戏创作大赛找可借鉴的玩法。
 *
 * 这一块和资讯不一样 —— 资讯是「告诉他发生了什么」，点子是「帮他做决定」。
 * 他原话：「关于 ideas 十分重要，不能含糊，不然找一堆没用的东西就完蛋了。」
 * 所以整条链路都是按「宁可交白卷」设计的：
 *
 *   1. 全程 pro 模型 + 深度思考
 *   2. **先想清楚要找什么，再去搜。** 直接拿方案去搜必然搜回一堆
 *      「十大好玩的独立游戏」。所以第一步是让她从方案里抽出
 *      「还没解决的设计问题」，第二步才按那些问题去找
 *   3. 每个机制必须挂到一个**具体的、方案里写着的**待解问题上。
 *      挂不上的一律丢掉，不许「这个也挺有意思」
 *   4. 参考指数 1–5，1 星等于不该写。格式不对整篇丢掉
 *
 * 全部内容都在**私有仓库**里，不进博客仓库、不进构建产物。
 * 见 private-store.mjs 顶部的说明。
 */

import { ask } from '../daily-report/narrate.mjs'
import { readProfile } from './news.mjs'
import { stripAngles, sanitizeMd, stripOutboundLinks } from './git.mjs'
import { readPrivate, writePrivate, listPrivate, hasPrivateStore, IDEAS_REPO } from './private-store.mjs'

const DRY = process.argv.includes('--dry')
const TAVILY_KEY = process.env.TAVILY_API_KEY || ''

const BRIEF = 'brief.md'
const IDEAS_DIR = 'ideas'
const INDEX = 'index.json'

const beijingNow = () => new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
}).format(new Date())

// ---------------- 检索 ----------------

const searchWeb = async (query, maxResults = 8) => {
  if (!TAVILY_KEY) throw new Error('没有 TAVILY_API_KEY')
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TAVILY_KEY}` },
    body: JSON.stringify({
      query,
      // 点子不看时效 —— 十年前的机制照样能借鉴，所以用通用检索而不是新闻
      topic: 'general',
      max_results: maxResults,
      search_depth: 'advanced',
      include_answer: false,
      include_raw_content: false
    }),
    signal: AbortSignal.timeout(45000)
  })
  if (!res.ok) throw new Error(`Tavily ${res.status} ${(await res.text()).slice(0, 140)}`)
  const data = await res.json()
  return (data.results || []).map(r => ({
    title: stripAngles(String(r.title || '')).trim(),
    url: String(r.url || '').trim(),
    excerpt: stripAngles(String(r.content || '')).replace(/\s+/g, ' ').slice(0, 900)
  })).filter(r => r.url && r.title)
}

const dedupe = items => {
  const seen = new Set()
  return items.filter(r => {
    const k = r.url.replace(/[?#].*$/, '').replace(/\/$/, '').toLowerCase()
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

// ---------------- 第一步：想清楚要找什么 ----------------

/* 直接拿「我要做一个律动游戏」去搜，搜回来的一定是「十大音游推荐」。
 * 有用的检索词长这样：「音游 判定窗口 手感 设计 容错」「rhythm game input latency forgiveness」。
 * 差别在于前者搜的是「品类」，后者搜的是**一个具体的设计问题**。
 * 所以先让她从方案里把待解问题抽出来，再按问题去搜。 */
/* 小标题的写法千奇百怪，模型爱加粗、加井号、加书名号、加冒号、加编号。
 * 上线第一次就栽在这儿：她其实好好回答了，只因为写成 `**待解问题**`
 * 就被判成「方案太空」。所以匹配之前先把这些装饰全剥掉。 */
const bareHead = l => String(l)
  .replace(/[*_`#【】〔〕[\]（）()《》「」:：、.。\s]/g, '')
  .replace(/^\d+/, '')

export const parsePlan = raw => {
  const text = String(raw || '').trim()
  if (!text) return null
  const probs = []
  const queries = []
  let mode = null
  for (const line of text.split('\n')) {
    const l = line.trim()
    if (!l) continue
    const head = bareHead(l)
    // 小标题本身通常很短；正文里出现「待解问题」三个字不该被当成小标题
    if (head.length <= 12) {
      if (/^(待解问题|待决问题|问题清单|问题)$/.test(head)) { mode = 'p'; continue }
      if (/^(检索词|搜索词|查询词|查询|关键词)$/.test(head)) { mode = 'q'; continue }
    }
    // 碰到别的小标题、分隔线或表格就收工。
    // 少了这一条，直接从方案里兜底时会一路吃到下一节去 ——
    // 「## 已经试过并且已经否决的」会被当成一条检索词拿去搜。
    if (/^#{1,6}\s/.test(l) || /^(-{3,}|\*{3,}|={3,})$/.test(l) || /^\|/.test(l)) { mode = null; continue }
    if (!mode) continue

    const v = l.replace(/^[-*+\d.、）)\s]+/, '').replace(/^\*\*|\*\*$/g, '').trim()
    if (!v || v.length < 4) continue
    if (mode === 'p' && probs.length < 6) probs.push(v.slice(0, 160))
    // 检索词就该短。一整句话不是检索词，多半是正文串进来了
    else if (mode === 'q' && queries.length < 8 && v.length <= 70) queries.push(v)
  }
  if (!probs.length || queries.length < 3) return null
  return { problems: probs, queries }
}

/* 兜底：直接从方案里读。
 *
 * 方案里本来就写着「待解问题」和「检索词」两节（我让你在 brief.md 里明确列出来，
 * 就是为了这个）。模型的格式再怎么飘，这两节是你自己写的、稳定的。
 * 所以模型那边解析失败时，不该判「方案太空」—— 该回来读方案本身。
 * 何况提示词里本来就要求她「直接用那里面的，一条都别改写」。 */
export const parseBriefSections = brief => {
  const r = parsePlan(brief)
  if (!r) return null
  return { ...r, fromBrief: true }
}

const makePlan = async (profile, brief) => {
  const out = await ask(
    `你在帮一个学生为游戏创作比赛找玩法参考。你的任务不是给答案，是**想清楚该去找什么**。
只输出下面要求的两段，不要任何解释、不要开场白。
小标题就写「待解问题」和「检索词」，**前后不要加星号、井号或任何符号**。`,
    `下面是他的技术背景，和他这个比赛项目的方案。

【技术背景】
${profile || '（没提供）'}

【比赛方案】
${brief}

---

请输出两段，格式严格照抄：

待解问题
- （从方案里抽出来的、**他还没解决**的具体设计问题，一条一行，最多 5 条）

检索词
- （用来找这些问题的解法的检索词，一条一行，5 到 7 条）

**「待解问题」怎么写：**
必须是方案里真实存在的缺口，不许你自己发明一个问题。

**如果方案里已经有「待解问题」「待决问题清单」「还没想明白的」这样的小节，
就直接用那里面的，一条都别改写。** 那是他自己写下来的，比你重新提炼的准。
只有当方案里完全没有这样的小节时，你才自己从正文里提炼。

自己提炼时，要具体到能判断对错 —— 「怎么让游戏好玩」不算，
「单局 3 分钟的节奏怎么安排才不会中段乏味」才算。

方案里如果有「已经试过并否决」这样的小节，**那些方向不算待解问题** ——
它们是已经关掉的门，不要把它们重新写成问题去搜。

如果方案写得太空、抽不出任何具体问题，就只输出一行：
（方案太空，抽不出问题）

**「检索词」怎么写：**
- 搜的是**具体的设计问题的解法**，不是品类。
  ✗「好玩的音乐游戏推荐」✗「独立游戏 玩法」
  ✓「音游 判定窗口 容错 设计」✓「rhythm game difficulty curve design breakdown」
- 至少 3 条英文（英文的机制拆解资料多得多）
- 每条对应上面某一个待解问题
- 不要引号、不要编号、一行一条`,
    1500, { deep: true, effort: 'high', timeout: 300000 })

  if (!out) {
    console.log('  模型没返回（检查 DEEPSEEK_API_KEY 配了没有）')
    return null
  }
  if (/方案太空/.test(out)) {
    console.log('  她判断方案太空，抽不出问题')
    return null
  }
  const parsed = parsePlan(out)
  if (!parsed) {
    // 解析失败时必须把她真正说了什么打出来。以前这里静默返回 null，
    // 结果日志上只有一句「方案太空」—— 而方案其实一点都不空，
    // 只是她把小标题写成了 **待解问题**。那次谁都不知道发生了什么。
    console.log('  她的回答解析不出来。原样贴在下面，方便对照：')
    console.log(String(out).split('\n').slice(0, 40).map(l => '    | ' + l).join('\n'))
  }
  return parsed
}

// ---------------- 第二步：解析成文 ----------------

const BODY_MARK = '===正文==='

/** 输出格式是硬约定。解析不出来就整篇丢掉 —— 与其发一篇坏掉的，不如不发。 */
export const parseIdea = raw => {
  const text = String(raw || '').trim()
  if (!text) return null
  if (/^[（(]?\s*(这次|这轮|本轮)?没(有)?(找到|什么)/.test(text)) return { skip: true }

  const i = text.indexOf(BODY_MARK)
  if (i < 0) return null
  const head = text.slice(0, i)
  const body = text.slice(i + BODY_MARK.length).trim()
  if (body.length < 300) return null      // 太短说明她没想清楚

  const title = (head.match(/^\s*标题\s*[:：]\s*(.+)$/m) || [])[1]
  const starRaw = (head.match(/^\s*参考指数\s*[:：]\s*(\d)/m) || [])[1]
  if (!title || !starRaw) return null

  const stars = Math.min(5, Math.max(1, Number(starRaw)))
  return {
    title: title.trim().replace(/^["'「《]|["'」》]$/g, '').slice(0, 60),
    stars,
    body
  }
}

/* 把正文里的 [3] 换成真链接。她只写编号，链接由代码照着检索结果拼 ——
 * 她编不出网址，也写不坏格式。编号对不上就把角标删掉，不留死引用。 */
export const attachRefs = (md, hits) => {
  let text = sanitizeMd(String(md || ''))
  text = stripOutboundLinks(text).replace(/https?:\/\/\S+/g, '')
  const used = new Map()
  text = text.replace(/[[［【]\s*(\d{1,2})\s*[\]］】]/g, (whole, n) => {
    const h = hits[Number(n)]
    if (!h || !/^https?:\/\//i.test(h.url)) return ''
    if (!used.has(Number(n))) used.set(Number(n), h)
    const idx = [...used.keys()].indexOf(Number(n)) + 1
    return `[[${idx}]](${encodeURI(h.url)})`
  })
  if (!used.size) return text.trim()
  const refs = [...used.values()].map((h, i) =>
    `${i + 1}. [${sanitizeMd(h.title).slice(0, 90)}](${encodeURI(h.url)})`).join('\n')
  return `${text.trim()}\n\n---\n\n### 参考来源\n\n${refs}\n`
}

// ---------------- 主流程 ----------------

export const buildIdea = async () => {
  if (!hasPrivateStore()) {
    console.log('  没配私有仓库（IDEAS_REPO / IDEAS_TOKEN），点子这一步跳过')
    console.log('  —— 比赛方案是私密的，绝不能退回到往公开仓库里写')
    return null
  }
  console.log(`  私有仓库：${IDEAS_REPO}`)

  const brief = await readPrivate(BRIEF).catch(e => {
    console.log('  读方案失败：' + String(e.message || e).slice(0, 120)); return null
  })
  if (!brief || brief.text.replace(/\s/g, '').length < 120) {
    console.log(`  ${IDEAS_REPO} 里的 ${BRIEF} 还没写（或者太短）。`)
    console.log('  方案没写清楚，找出来的一定是废话 —— 这次不找。')
    return null
  }

  // 方案可能写得很长（好事）。给个上限，免得把提示词撑爆。
  const briefText = brief.text.slice(0, 30000)
  const profile = readProfile()
  const stamp = beijingNow()
  const date = stamp.slice(0, 10)

  const existing = await listPrivate(IDEAS_DIR).catch(() => [])
  if (existing.includes(`${date}.md`)) { console.log(`  ${date} 今天已经写过了`); return null }

  // —— 第一步：想清楚找什么
  console.log('  先想清楚要找什么…（深度思考）')
  let plan = await makePlan(profile, briefText)
  if (!plan) {
    // 模型的格式没对上。方案里本来就写着这两节，直接读它 ——
    // 这比「判定方案太空然后什么都不做」诚实得多。
    plan = parseBriefSections(briefText)
    if (plan) console.log('  （她给的格式没对上，改成直接读方案里写好的那两节）')
  }
  if (!plan) {
    console.log('  从方案里抽不出具体的待解问题 —— 说明方案还太空。')
    console.log('  这时候去搜只会搜回一堆「十大好玩的游戏」，所以这次不找。')
    console.log('  在 brief.md 里加两节就行，标题分别写「待解问题」和「检索词」，各列几条。')
    return null
  }
  console.log('  待解问题：')
  plan.problems.forEach(p => console.log('    · ' + p))
  console.log('  检索词：' + plan.queries.join(' / '))

  // —— 第二步：搜
  const old = await usedUrls(existing)
  let hits = []
  for (const q of plan.queries) {
    try { hits = hits.concat(await searchWeb(q)) }
    catch (e) { console.log(`  搜「${q.slice(0, 24)}…」失败：${String(e.message).slice(0, 80)}`) }
  }
  hits = dedupe(hits).filter(h => !old.has(h.url.replace(/[?#].*$/, '').replace(/\/$/, '').toLowerCase()))
  console.log(`  搜到 ${hits.length} 条可用素材`)
  if (hits.length < 4) { console.log('  素材太少，不硬凑，这次跳过'); return null }

  const listed = hits.slice(0, 24).map((h, i) =>
    `[${i}] ${h.title}\n    来源：${h.url}\n    ${h.excerpt}`).join('\n\n')

  // —— 第三步：深度分析
  console.log('  分析中…（深度思考，这一步慢，几分钟很正常）')
  const raw = await ask(
    `你是娜娜莉，住在 Noimpty 个人博客里的猫娘。
毒舌但清醒，极简，讨厌废话。自称「窝」，偶尔带「喵」和颜文字 (=^w^=) (ovo)，别每句都塞。
禁止使用 • 和 ω 这类会破坏颜文字的符号。

你在帮主人为**腾讯游戏创作大赛**找可以借鉴的玩法。
这份东西只有你和他两个人看得到，他会照着做取舍 —— 所以每一句都要经得起追问。
写得含糊、写一堆和他项目不沾边的东西，比什么都不写更糟：那会浪费他真正的时间。

【他的技术背景】
${profile || '（没提供）'}

【他的比赛方案】
${briefText}

【这次要解决的问题】（你自己从方案里抽出来的）
${plan.problems.map((p, i) => `${i + 1}. ${p}`).join('\n')}`,
    `下面是按上面那些问题搜回来的素材，每条前面有个编号。

**你的任务**：从里面找出**能真正推进上面那几个问题**的具体机制，写成一篇分析。

━━━ 第一道闸：对照他已经否决过的方案 ━━━

**上面的方案里如果写了「已经试过并且已经否决」这一节，先把它读透。**
那是他花了好几轮讨论才关掉的门。

对每一个你想推荐的机制，先问：**它会不会又踩回其中某一类？**

- 会踩回去 → **直接丢掉**，别推荐
- 你觉得「这次不一样」→ 那就必须在正文里**点名是哪一条**，
  并说清楚为什么这次不同。说不清楚就等于踩回去了，丢掉

这一条比什么都重要。给他推一个他三个月前就否掉的东西，比不给还糟 ——
那会让他觉得你根本没读他的方案。

同样，方案里如果写了「设计原则」「硬约束」「别推荐违反这些的东西」，
违反任何一条的机制一律丢掉。

━━━ 第二道闸：做减法 ━━━

对每一条素材问一句：**它能不能挂到上面某一个具体问题上？**

- 挂不上 → 丢掉。不许写「这个也挺有意思」「或许可以参考」
- 只是同一个品类、但没解决任何问题 → 丢掉
- 只有玩法描述、没有「为什么这样设计」→ 丢掉，那对他没用

如果整批素材里没有一条真的能推进任何一个问题，就**只输出一行**：
（这次没找到值得说的）
那是完全合格的输出。**交白卷远好过硬凑** —— 他明确说过，找一堆没用的东西就完蛋了。

━━━ 有的话，严格按这个格式 ━━━

标题：（一句话说清楚这篇讲的是什么机制、解决哪个问题。不要「游戏设计参考」这种空话）
参考指数：（1 到 5 的整数，只写数字）
${BODY_MARK}
（正文，markdown）

━━━ 正文怎么写 ━━━

**开头一段**：这次挑的这几个，分别对应上面第几个问题。一句话一个。

**然后每个机制一节**，小标题格式：\`## 机制名（出自《游戏名》）→ 解决问题 N\`

每一节必须讲清楚这五件事，缺一件都算不合格：

1. **它到底怎么运作** —— 具体规则和数值，不是感受。
   ✗「借鉴一下战斗手感」
   ✓「同一把武器有 4 种形态，改变的是攻击范围和起手帧，不是伤害数值 ——
     所以美术量只有一套，但玩起来像四把武器」
2. **它为什么解决了那个问题** —— 明确指回上面第 N 个问题，说清楚机制的哪一点起了作用
3. **搬到他的项目上会变成什么样** —— 结合他方案里写的具体设定说。
   不能改写成他的语境的，说明其实不适用，那就别写这一条
4. **在 UE5 里怎么实现、难在哪** —— 他一个人做，工作量是硬约束。
   要说到「大概用什么做、卡点在哪、粗估几天」。代价太大的直说「这个别碰」
5. **代价和风险** —— 抄这个机制会带来什么新问题。没有代价的机制不存在，
   写不出代价说明你没想透
6. **和他否决过的那些有什么不同** —— 如果这个机制和「已经试过并否决」里
   某一条长得像，必须点名是哪一条、这次为什么不一样。
   完全不沾边的话写一句「和已否决的几类不沾边」就行

**结尾一段**：如果只能先做一个，选哪个，为什么。以及**你觉得他方案里哪个问题这批素材没能解决** ——
这一条很重要，他需要知道哪里还是空的。

━━━ 别的规矩 ━━━

- 引用素材里的事实时，在句子后面写编号，比如 \`[3]\`。**不要自己写网址**，链接窝会挂
- 素材里没写的东西不许编。你自己的判断用「窝觉得」标出来
- 不许出现「值得关注」「值得学习」「可以参考一下」这类谁都能说的话

━━━ 参考指数怎么给（老实给，别给人情分）━━━

- **5 星**：直接命中他写的待解问题，实现代价可控，看完就能动手
- **4 星**：能推进问题，但要改造之后才能用
- **3 星**：有启发，但和他的问题只是间接相关
- **2 星**：关系不大，只是顺手一提
- **1 星**：基本没关系 —— 给得出 1 星就说明这篇不该存在，那就交白卷

素材：
${listed}`, 8000, { deep: true, effort: 'max', timeout: 600000 })

  if (!raw) { console.log('  模型没返回，这次跳过'); return null }

  const parsed = parseIdea(raw)
  if (!parsed) {
    console.log('  她输出的格式不对，整篇丢掉（宁可不发，也不发一篇坏掉的）')
    console.log('  开头 200 字：' + String(raw).slice(0, 200).replace(/\n/g, ' '))
    return null
  }
  if (parsed.skip) { console.log('  她判断这次没找到值得说的，交白卷'); return null }
  if (parsed.stars <= 1) { console.log(`  参考指数只有 ${parsed.stars} 星，不值得占一篇，跳过`); return null }

  const body = attachRefs(parsed.body, hits.slice(0, 24))
  const entry = {
    date,
    stamp,
    title: parsed.title,
    stars: parsed.stars,
    problems: plan.problems,
    file: `${IDEAS_DIR}/${date}.md`
  }

  const md = `---
title: ${JSON.stringify(parsed.title)}
date: ${stamp}
stars: ${parsed.stars}
problems:
${plan.problems.map(p => `  - ${JSON.stringify(p)}`).join('\n')}
---

${body}
`

  if (DRY) {
    console.log(`\n  [演练] 会写进私有仓库 ${IDEAS_REPO}/${entry.file}（参考指数 ${parsed.stars} 星）：\n`)
    console.log(md.split('\n').map(l => '    ' + l).join('\n'))
    return { ...entry, dry: true }
  }

  await writePrivate(entry.file, md, `娜娜莉：点子「${parsed.title.slice(0, 30)}」（${parsed.stars} 星）`)

  // 索引：给浏览器那边列清单用，免得每次都去列目录再逐个下载
  let index = []
  try {
    const cur = await readPrivate(INDEX)
    if (cur) index = JSON.parse(cur.text)
    if (!Array.isArray(index)) index = []
  } catch (_) { index = [] }
  index = index.filter(x => x && x.date !== date)
  index.unshift(entry)
  await writePrivate(INDEX, JSON.stringify(index, null, 2) + '\n', `娜娜莉：更新点子索引（${index.length} 篇）`)

  console.log(`  已写进私有仓库：${entry.file}（参考指数 ${parsed.stars} 星）`)
  console.log('  博客仓库一个字节都没动 —— 方案和点子不进公开仓库')
  return entry
}

// 之前几篇引用过什么，别来回炒同一个游戏
const usedUrls = async existing => {
  const urls = new Set()
  const recent = (existing || []).filter(f => f.endsWith('.md')).sort().slice(-6)
  for (const f of recent) {
    try {
      const r = await readPrivate(`${IDEAS_DIR}/${f}`)
      if (!r) continue
      ;[...r.text.matchAll(/\((https?:\/\/[^)]+)\)/g)]
        .forEach(m => urls.add(m[1].replace(/[?#].*$/, '').replace(/\/$/, '').toLowerCase()))
    } catch (_) {}
  }
  return urls
}
