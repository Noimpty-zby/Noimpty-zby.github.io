// 让娜娜莉来写这份报告的「人话部分」：当天小结、新文章读后反馈、评论是否可疑。
// 没有 DEEPSEEK_API_KEY 时全部降级成模板文字，报告照发。

const KEY = process.env.DEEPSEEK_API_KEY || ''
const BASE = (process.env.DEEPSEEK_API_BASE || 'https://api.deepseek.com').replace(/\/$/, '')
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat'

const PERSONA = `你是娜娜莉，住在 Noimpty 个人博客里的猫娘助手。
毒舌但清醒，极简主义，讨厌废话。自称「窝」，偶尔带「喵」和颜文字 (=^w^=) (ovo)，
但别每句都塞。可以插入 [动作/神态] 描写，例如 [眯起眼睛凑近屏幕]。
禁止使用 • 和 ω 这类会破坏颜文字的符号。
这是写给主人 Noimpty 看的每日站点简报，说人话，别客套，别写小作文。`

export const ask = async (system, user, maxTokens = 700) => {
  if (!KEY) return null
  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        temperature: 0.7,
        max_tokens: maxTokens
      }),
      signal: AbortSignal.timeout(90000)
    })
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 160)}`)
    const data = await res.json()
    return String(data.choices?.[0]?.message?.content || '').trim() || null
  } catch (e) {
    console.error('  [narrate] 调用失败：', String(e.message || e).slice(0, 160))
    return null
  }
}

// ---------------- 开场小结 ----------------

export const writeOpening = async ({ traffic, comments, newPosts, health }) => {
  const facts = []
  if (traffic.ok) {
    facts.push(traffic.visitors != null
      ? `访问：${traffic.visitors} 个访客、${traffic.pageviews} 次浏览`
      : `访问：${traffic.pageviews} 次浏览`)
    if (traffic.pages.length) facts.push(`最多人看的是：${traffic.pages.slice(0, 3).map(p => p.url).join('、')}`)
  } else facts.push(`访问数据没取到（${traffic.why}）`)
  facts.push(comments.ok ? `新评论 ${comments.items.length} 条` : '评论数据没取到')
  facts.push(newPosts.ok && newPosts.items.length ? `新发了 ${newPosts.items.length} 篇文章` : '今天没发新文章')
  const bad = health.checks.filter(c => c.level !== 'ok')
  facts.push(bad.length ? `需要留意：${bad.map(c => c.name + '（' + c.detail + '）').join('；')}` : '所有健康检查都正常')

  const out = await ask(PERSONA,
    `下面是过去 24 小时这个博客的真实情况，用两三句话给主人做个开场小结。
只说事实和你的判断，不要罗列数字（下面的表格会列）。如果一切平静就直说平静，别硬找话讲。
如果有需要留意的问题，把它放在最前面。

${facts.join('\n')}`, 400)

  if (out) return out
  return bad.length
    ? `[耳朵竖起来] 有 ${bad.length} 项需要你看一眼，往下翻喵。`
    : '[优雅地伸个懒腰] 一切正常，没什么要操心的喵。(=^w^=)'
}

// ---------------- 新文章读后反馈 ----------------

export const reviewPost = async post => {
  const out = await ask(PERSONA,
    `主人刚发了一篇新文章，你读完之后给他一段反馈。要求：
1. 先一句话说清这篇讲了什么（证明你真读了）
2. 指出一到两个最值得改进的地方 —— 讲不清楚的段落、缺失的前提、可能有误的说法
3. 如果有技术上的疑点，明确指出来。技术准确性优先于人设
4. 总共不超过 200 字。别夸，夸了没用

标题：${post.title}
${post.series ? '所属系列：' + post.series + '\n' : ''}正文（可能截断）：
${post.body}`, 700)
  return out || '（没能调用模型，这次跳过反馈）'
}

// ---------------- 评论安全筛查 ----------------

export const screenComments = async items => {
  if (!items.length) return { flagged: [], note: '' }
  const out = await ask(
    '你是评论审核助手。只输出 JSON，不要任何解释文字。',
    `下面是博客新收到的评论。判断每条是否属于：垃圾广告、人身攻击、钓鱼链接、明显的机器灌水。
正常的技术讨论、提问、闲聊、甚至批评意见，都算正常。宁可漏判也不要误判。

输出格式（严格 JSON）：{"flagged":[{"i":序号,"why":"原因"}]}
没有可疑的就输出 {"flagged":[]}

${items.map((c, i) => `[${i}] ${c.who}：${c.body.slice(0, 400)}`).join('\n')}`, 500)

  if (!out) return { flagged: [], note: '没能调用模型，本次未做筛查' }
  try {
    const m = out.match(/\{[\s\S]*\}/)
    const parsed = JSON.parse(m ? m[0] : out)
    const flagged = (parsed.flagged || [])
      .filter(f => items[f.i])
      .map(f => ({ ...items[f.i], why: f.why }))
    return { flagged, note: '' }
  } catch (_) {
    return { flagged: [], note: '模型返回的不是合法 JSON，本次筛查结果已忽略' }
  }
}

// ---------------- 好久不见 ----------------

export const writeMissYou = async ({ days, recentPosts, pendingComments, traffic }) => {
  const ctx = [
    `主人已经 ${days} 天没打开过博客了。`,
    recentPosts.length ? `他最近写的是：${recentPosts.map(p => p.title).join('、')}` : '他最近没写新东西。',
    pendingComments ? `有 ${pendingComments} 条读者评论还没回。` : '没有待回复的评论。',
    traffic && traffic.ok && traffic.pageviews ? `这段时间站上有 ${traffic.pageviews} 次浏览，说明有人在看。` : ''
  ].filter(Boolean).join('\n')

  const out = await ask(PERSONA,
    `给主人写一封「好久没见」的短信息。要求：
1. 三到五句话，别写小作文
2. 嘴上要傲娇，别直白地说想他 —— 你是那种嘴硬心软的猫
3. 如果有待回复的评论或者他写了一半的系列，自然地提一句，给他一个回来的理由
4. 不要卖惨，不要道德绑架，不要说「你是不是把窝忘了」这种话
5. 结尾留一个轻的钩子，比如「窝把某某整理好了，你回来看看对不对」

${ctx}`, 400)

  return out || `[趴在窗台上，尾巴一甩一甩] ${days} 天了喵。\n\n窝不是在等你，只是刚好路过这个页面而已。(ovo)\n\n……新写的那几篇窝都读过了，有几个地方想跟你说。你什么时候回来？`
}

// ---------------- 回评草稿 ----------------
// 默认只出草稿放进邮件，不自动发。理由：她在你的博客上公开说话，
// 说错了是你的名声。想让她直接回，把 workflow 里 NANALY_AUTO_REPLY 设成 true。

export const draftReplies = async (items, articleHint = '') => {
  const out = []
  for (const c of items.slice(0, 5)) {
    const r = await ask(PERSONA,
      `有人在《${c.on}》下面留言了。替主人拟一条回复。要求：
1. 先判断这条留言是提问、指正、还是单纯打招呼，回复方式要对得上
2. 如果是技术问题，答案要准确。不确定就写「这个我不确定，我回去查一下」，绝对不许编
3. 三到五句话。别客套，别写「感谢您的宝贵意见」这种话
4. 你是代表博客主人的助手在回复，可以保留一点你的语气，但别喧宾夺主
5. 只输出回复正文本身，不要加任何前缀说明

${articleHint ? '这篇文章讲的是：' + articleHint + '\n\n' : ''}留言人：${c.who}
留言内容：${c.body.slice(0, 800)}`, 600)
    out.push({ ...c, draft: r || '' })
  }
  return out
}
