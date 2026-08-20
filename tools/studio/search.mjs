/* 探索阶段的检索。
 *
 * 为什么必须有这一步：模型脑子里的游戏设计知识是**平均化**的 ——
 * 问它「什么玩法有创新点」，它给的是所有人都会说的那几个方向。
 * 主人要的恰恰相反：他要的是别人没在说、但他一个人做得出来的东西。
 *
 * 所以流程是「先想清楚搜什么，再去搜，最后才判断」，而不是直接让它答。
 * 这个顺序在上一版（找点子）上验证过：直接拿方案去搜，回来的一定是
 * 「十大好玩的独立游戏」；先抽出具体的设计问题再搜，回来的才是拆解文章。
 *
 * 没配 TAVILY_API_KEY 时整个检索静默跳过 —— 探索照常进行，
 * 只是它只能凭自己的知识判断，日志里会说清楚这一点。
 */

import { ask } from './llm.mjs'
import { LANES, laneName } from './lanes.mjs'

const KEY = () => process.env.TAVILY_API_KEY || ''

export const hasSearch = () => !!KEY()

const stripAngles = s => String(s || '').replace(/[<>]/g, '')

const searchOnce = async (query, maxResults = 6) => {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY()}` },
    body: JSON.stringify({
      query,
      // 设计资料不看时效 —— 十年前的机制拆解照样能用，所以用通用检索而不是新闻
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

/* 第一步：想清楚搜什么。
 *
 * 检索词的好坏几乎决定了整轮探索的质量。差的检索词搜的是**品类**
 * （「好玩的独立游戏」），好的检索词搜的是**一个具体的设计问题**
 * （「rhythm game input latency forgiveness design」）。
 * 让模型先读总纲、再据此出词，比人手写一批固定词好 ——
 * 总纲会变，固定词不会。 */
const makeQueries = async (charter, covered, cold = []) => {
  const out = await ask(
    `你在为一个独立游戏开发者规划检索。只输出检索词，一行一条，不要编号、不要解释、不要开场白。`,
    `下面是他的情况和约束。请给出 6 到 8 条检索词。

⚠️ 先说清楚要找什么，因为这决定了检索词的方向：

他做这个游戏**不是给自己玩的，是拿去参赛和写简历的**。
所以要找的不是「什么游戏好玩」，是 ——
**什么样的东西能让一个见过几十个学生作品的评委停下来，
并且背后有一个能在面试里讲十分钟的技术问题。**

【他的总纲】
${charter}

━━━ 检索词怎么写 ━━━

- 搜的是**具体的技术实现或机制拆解**，不是品类，也不是排行榜。
  ✗「好玩的独立游戏推荐」✗「2026 值得期待的游戏」✗「game design tips」
  ✓「runtime mesh boolean cutting unreal geometry script」
  ✓「wave function collapse level generation constraints」
  ✓「mass entity crowd simulation performance unreal」
  ✓「screen space effect stylized rendering breakdown」
- **至少 5 条英文** —— 技术拆解类的资料英文世界多得多
- 不要引号、不要编号、一行一条

━━━ 覆盖面（这一条是硬的）━━━

**每一条检索词必须打在一条不同的赛道上。** 赛道是固定的这几条：

${LANES.filter(l => l.id !== 'code-feel').map(l => `  - ${l.name}：${l.hint}`).join('\n')}

${cold.length ? `⭐ **这几条赛道一次都没搜过，这一轮必须覆盖：${cold.map(laneName).join('、')}**\n` : ''}
⛔ **不要出「打击感 / 手感 / 顿帧 / 连招 / 弹反 / 格挡」这一类检索词。**
那些东西截图里看不见、面试时问三句就到底，对他的两个目标都是零分。
${covered.length ? `
━━━ 这些方向最近已经扫过了，换一批角度 ━━━
${covered.map(t => '- ' + t).join('\n')}` : ''}`,
    { maxTokens: 900, retries: 1, label: '想检索词' })

  if (!out) return []
  return String(out).split('\n')
    .map(l => l.replace(/^[-*+\d.、）)\s]+/, '').replace(/^["'「]|["'」]$/g, '').trim())
    .filter(l => l.length >= 6 && l.length <= 90)
    .slice(0, 8)
}

/**
 * 跑一轮检索，返回可以直接塞进提示词的素材清单。
 * @returns {{listed: string, hits: Array, queries: Array}} listed 为空表示这轮没有素材
 */
export const gather = async (charter, covered = [], cold = []) => {
  if (!hasSearch()) {
    console.log('  没配 TAVILY_API_KEY —— 这一轮不检索，她只能凭自己的知识判断')
    console.log('  （去 tavily.com 拿一把 key 存成 TAVILY_API_KEY，探索质量会有明显差别）')
    return { listed: '', hits: [], queries: [] }
  }

  console.log('  先想清楚要搜什么…')
  const queries = await makeQueries(charter, covered, cold)
  if (!queries.length) {
    console.log('  没能出检索词，这一轮不检索')
    return { listed: '', hits: [], queries: [] }
  }
  console.log('  检索词：' + queries.join(' / '))

  let hits = []
  for (const q of queries) {
    try { hits = hits.concat(await searchOnce(q)) }
    catch (e) { console.log(`  搜「${q.slice(0, 28)}…」失败：${String(e.message).slice(0, 80)}`) }
  }
  hits = dedupe(hits)
  console.log(`  搜到 ${hits.length} 条素材`)
  if (hits.length < 4) return { listed: '', hits, queries }

  const capped = hits.slice(0, 28)
  const listed = capped.map((h, i) =>
    `[${i}] ${h.title}\n    来源：${h.url}\n    ${h.excerpt}`).join('\n\n')
  return { listed, hits: capped, queries }
}

/* 把正文里的 [3] 换成真链接。她只写编号，链接由代码照着检索结果拼 ——
 * 她编不出网址，也写不坏格式。编号对不上就把角标删掉，不留死引用。
 * （和资讯板块同一套思路，那边还额外做了内容校验；探索这边引用是辅助信息，
 *   标错的代价小得多，所以只做「不许编造」这一层。） */
export const attachRefs = (md, hits) => {
  let text = String(md || '').replace(/https?:\/\/\S+/g, '')
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
    `${i + 1}. [${String(h.title).replace(/[[\]]/g, '').slice(0, 90)}](${encodeURI(h.url)})`).join('\n')
  return `${text.trim()}\n\n---\n\n## 参考来源\n\n${refs}\n`
}
