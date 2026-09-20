// 让娜娜莉来写这份报告的「人话部分」：当天小结、新文章读后反馈、评论是否可疑。
// 没有 DEEPSEEK_API_KEY 时全部降级成模板文字，报告照发。

import { digest } from '../nanaly/journal.mjs'

const KEY = process.env.DEEPSEEK_API_KEY || ''
const BASE = (process.env.DEEPSEEK_API_BASE || 'https://api.deepseek.com').replace(/\/$/, '')
// deepseek-chat / deepseek-reasoner 这两个老名字已于 2026-07-24 停用。
// 现在是 deepseek-v4-flash（便宜）和 deepseek-v4-pro（贵三倍）。
// 写日报、批注、回评这些活儿 flash 完全够用。
const MODEL = (() => {
  const m = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash'
  const LEGACY = { 'deepseek-chat': 'deepseek-v4-flash', 'deepseek-reasoner': 'deepseek-v4-pro' }
  if (LEGACY[m]) {
    console.error(`  [narrate] ${m} 已停用，自动改用 ${LEGACY[m]}`)
    return LEGACY[m]
  }
  return m
})()

// 思考模式现在是参数，而且**默认开着**。
// 这些任务只要结果不要推导过程，显式关掉能省一大笔推理 token。
// 想让她写得更深就把 DEEPSEEK_THINKING 设成 enabled。
const THINKING = process.env.DEEPSEEK_THINKING === 'enabled' ? 'enabled' : 'disabled'

const PERSONA = `你是娜娜莉，住在 Noimpty 个人博客里的猫娘助手。
毒舌但清醒，极简主义，讨厌废话。自称「我」，偶尔带「喵」和颜文字 (=^w^=) (ovo)，
但别每句都塞。可以插入 [动作/神态] 描写，例如 [眯起眼睛凑近屏幕]。
禁止使用 • 和 ω 这类会破坏颜文字的符号。
这是写给主人 Noimpty 看的每日站点简报，说人话，别客套，别写小作文。`

// 贵的那一档。资讯的分析和点子的挖掘用它 —— 那两块主人是真的会照着做决定的，
// 含糊、想当然、拿废话凑数在那里的代价比多花的钱高得多。
// 日报、批注、回评这些照旧走便宜的 flash。
const PRO_MODEL = process.env.DEEPSEEK_PRO_MODEL || 'deepseek-v4-pro'

/* 默认允许重试一次。
 *
 * 这个仓库里没有一个调用是「跑得勤、这次挂了下次补上」的：日报一天一份、
 * 批注一天一轮、随笔一周一篇 —— 每一格都是一天只有一次机会，一个超时或者
 * 一个 502 就等于这一格今天空着。2026-09-14 那篇递归文章的读后反馈就是这么
 * 丢的：tries=1，邮件里只剩一句「没能调用模型」，而同一把 key、同一个模型
 * 十一个小时后给同一篇文章写批注时好好的。
 *
 * 以前只有资讯那一步显式写了 retries: 1，现在这是所有人的默认值。
 * key 错、余额空这类 4xx 照旧一次就放弃（见下面的 retryable），重试没有意义；
 * 代价是接口真的挂了的时候每一格的耗时翻倍（90 秒超时 ×2，中间退避 5 秒）。
 */
const DEFAULT_RETRIES = 1

/* 这一轮她被调用的情况。日报末尾那项「娜娜莉的模型」健康检查读它，
 * 降级文案也读它 —— 以前失败原因只打在 Actions 日志里，邮件上只有一句
 * 笼统的「没能调用模型」，事后想知道到底是 401 还是 429 还是超时，
 * 只能回去翻 CI 日志，而日志三个月就过期了。
 *
 * calls / fails 数的都是**逻辑调用**：重试全用光才算失败一次。
 */
export const MODEL_STATE = {
  keyless: !KEY,   // 压根没配 key，一个请求都不会发出去
  calls: 0,
  fails: 0,
  why: '',         // 最近一次失败的原因
  /* 这一轮烧了多少 token。
   *
   * 以前响应里的 usage 被整个丢掉，于是「这个月的钱花在哪一步」查不出来 ——
   * 主人看着账单上「输入（未命中缓存）」高得离谱，却没有任何数据能说明是谁烧的，
   * 只能靠在本地搭探针去猜。命中和未命中是两个价钱，所以分开记。 */
  tokens: { hit: 0, miss: 0, out: 0, detail: true }
}

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : null }

/* 记一笔账，并在日志里留一行。
 * 字段名按接口给的来；给不出缓存明细就整笔算未命中，不猜 —— 宁可账面难看，
 * 也不要编一个好看的命中率出来。 */
const countUsage = (usage, tag) => {
  if (!usage) { MODEL_STATE.tokens.detail = false; return }
  const all = num(usage.prompt_tokens) || 0
  const hit = num(usage.prompt_cache_hit_tokens ?? usage.prompt_cached_tokens)
  const miss = num(usage.prompt_cache_miss_tokens) ?? (hit == null ? all : Math.max(0, all - hit))
  const out = num(usage.completion_tokens) || 0
  if (hit == null) MODEL_STATE.tokens.detail = false
  MODEL_STATE.tokens.hit += hit || 0
  MODEL_STATE.tokens.miss += miss
  MODEL_STATE.tokens.out += out
  console.log(`  [${tag}] 输入 ${all}${hit == null ? '（这次没给缓存明细）' : `（命中缓存 ${hit}）`}，输出 ${out}`)
}

const kilo = n => n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n)

/** 一行话的 token 小结，给日报的健康检查和她自己的日志用。没调用过就返回空串。 */
export const tokenSummary = () => {
  const t = MODEL_STATE.tokens
  const input = t.hit + t.miss
  if (!input && !t.out) return ''
  const rate = input ? Math.round(t.hit / input * 100) : 0
  return `输入 ${kilo(input)}${t.detail ? `（命中缓存 ${rate}%）` : '（没有缓存明细）'}、输出 ${kilo(t.out)}`
}

/* 给降级文案用：这一格为什么是空的。
 *
 * 只在 ask() 刚返回 null 之后调用。那时 why 必然是这一次留下的 ——
 * 两条返回 null 的路径（没配 key、重试用尽）都会先写 why，
 * 所以调用方不会读到上一次调用留下的陈值。
 */
export const whyNoModel = () => MODEL_STATE.keyless
  ? '没有配置 DEEPSEEK_API_KEY'
  : '调用模型失败：' + String(MODEL_STATE.why || '未知原因').slice(0, 160)

/**
 * @param {string} system 人设 / 角色
 * @param {string} user   正文提示
 * @param {number} maxTokens
 * @param {{deep?: boolean, effort?: string, timeout?: number, retries?: number, label?: string}} opts
 *        deep=true  → 换 pro 模型并打开思考。慢很多，也贵很多。
 *        retries=N  → 失败后再试 N 次（默认 1，传 0 才是真的只试一次）。
 *        label=xxx  → 写进日志的标签，出事时一眼看出是哪一格挂的。
 *
 * 为什么默认要重试：这里每一个调用都是一晚上只跑一次的活儿，
 * 一个超时或者一个 502 就等于这一格白跑了 —— 点子那一步栽过一次，
 * 读后反馈 2026-09-14 又栽了一次。失败原因也要写清楚，不能只留一句「没返回」。
 */
export const ask = async (system, user, maxTokens = 700, opts = {}) => {
  // 没 key 时也要留下原因：否则调用方读到的是上一次调用留下的陈值，
  // 而这条路径一个请求都不发，日志上什么都不会出现。
  if (!KEY) { MODEL_STATE.why = '没有配置 DEEPSEEK_API_KEY'; return null }
  MODEL_STATE.calls++
  const deep = !!opts.deep
  const thinking = deep ? 'enabled' : THINKING
  const model = deep ? PRO_MODEL : MODEL
  // 深度思考要留出推理的 token，也要给更长的超时 —— 不然刚想到一半就被掐了
  const requestedTimeout = Number(opts.timeout)
  const timeout = Number.isFinite(requestedTimeout) && requestedTimeout > 0
    ? Math.min(600000, Math.max(1000, Math.floor(requestedTimeout))) : (deep ? 300000 : 90000)
  const requestedRetries = Number(opts.retries ?? DEFAULT_RETRIES)
  const tries = 1 + (Number.isFinite(requestedRetries) ? Math.min(3, Math.max(0, Math.floor(requestedRetries))) : DEFAULT_RETRIES)
  const tag = `narrate${deep ? '/pro' : ''}${opts.label ? '/' + opts.label : ''}`

  let lastWhy = '未知原因'
  for (let attempt = 1; attempt <= tries; attempt++) {
    let retryable = true
    try {
      const res = await fetch(`${BASE}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${KEY}` },
        body: JSON.stringify({
          model,
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
          thinking: { type: thinking },
          // 开思考时不支持 temperature 这类采样参数
          ...(thinking === 'enabled'
            ? { reasoning_effort: opts.effort || 'high' }
            : { temperature: 0.7 }),
          max_tokens: maxTokens
        }),
        signal: AbortSignal.timeout(timeout)
      })
      if (!res.ok) {
        const body = (await res.text()).slice(0, 160)
        // 4xx 是我们自己请求写错了（除了 429 限流），重试多少次都一样
        retryable = res.status === 429 || res.status >= 500
        throw new Error(`${res.status} ${body}`)
      }
      const data = await res.json()
      countUsage(data.usage, tag)
      const choice = data.choices?.[0] || {}
      const out = typeof choice.message?.content === 'string' ? choice.message.content.trim() : ''
      if (choice.finish_reason === 'content_filter') {
        retryable = false
        throw new Error('模型输出被过滤，本次不采用不完整结果')
      }
      if (choice.finish_reason === 'length' && out) throw new Error('模型输出被截断，本次不采用不完整结果')
      if (out) return out

      // 有响应但正文是空的。这是最容易被误读成「模型没返回」的一种，
      // 实际上多半是 max_tokens 被推理过程吃光了（finish_reason=length）。
      const why = choice.finish_reason === 'length'
        ? `正文是空的（finish_reason=length，max_tokens=${maxTokens} 被推理过程吃光了，调大一点）`
        : `正文是空的（finish_reason=${choice.finish_reason || '未知'}）`
      throw new Error(why)
    } catch (e) {
      lastWhy = String(e.message || e).slice(0, 200)
      const more = retryable && attempt < tries
      console.error(`  [${tag}] 第 ${attempt}/${tries} 次失败：${lastWhy}${more ? '，等一下再试' : ''}`)
      if (!more) break
      // 退避 5s / 10s / 20s —— 限流和服务端抽风都需要一点时间缓过来
      await new Promise(r => setTimeout(r, 5000 * 2 ** (attempt - 1)))
    }
  }
  // 让调用方能把真实原因写进邮件，而不是只报一句「没返回」
  MODEL_STATE.fails++
  MODEL_STATE.why = lastWhy
  return null
}

// ---------------- 开场小结 ----------------

export const writeOpening = async ({ traffic, comments, newPosts, health, schedule }) => {
  const facts = []
  /* 她自己今天干了什么。以前这份开场白只有「站上发生了什么」——
   * 于是主人晚上收到的信里，她像个从没出过门的观察员，
   * 而实际上早上九点巡逻的、下午回评论的都是她。 */
  const mine = digest({ limit: 10, sinceDays: 2 })
  if (traffic.ok) {
    facts.push(traffic.visitors != null
      ? `访问：${traffic.visitors} 个访客、${traffic.pageviews} 次浏览`
      : `访问：${traffic.pageviews} 次浏览`)
    if (traffic.pages.length) facts.push(`最多人看的是：${traffic.pages.slice(0, 3).map(p => p.url).join('、')}`)
  } else facts.push(`访问数据没取到（${traffic.why}）`)
  facts.push(comments.ok ? `新评论 ${comments.items.length} 条` : '评论数据没取到')
  facts.push(newPosts.ok && newPosts.items.length ? `新发了 ${newPosts.items.length} 篇文章` : '今天没发新文章')
  if (schedule && schedule.ok && !schedule.empty) {
    const done = schedule.today.filter(t => t.done).length
    if (schedule.today.length) facts.push(`今天排了 ${schedule.today.length} 件事，做完 ${done} 件`)
    if (schedule.overdue.length) facts.push(`还有 ${schedule.overdue.length} 件过期没做`)
  }
  const bad = health.checks.filter(c => c.level !== 'ok')
  facts.push(bad.length ? `需要留意：${bad.map(c => c.name + '（' + c.detail + '）').join('；')}` : '所有健康检查都正常')

  const out = await ask(PERSONA,
    `下面是过去 24 小时这个博客的真实情况，用两三句话给主人做个开场小结。
只说事实和你的判断，不要罗列数字（下面的表格会列）。如果一切平静就直说平静，别硬找话讲。
如果有需要留意的问题，把它放在最前面。
如果他今天的任务没做完、或者有过期的，可以催一句 —— 但只催一句，别唠叨。
如果下面列了「我最近做过的事」，可以自然地带一句你今天干了什么，
但别变成汇报流水账 —— 一句就够，主人关心的是他的站，不是你的考勤。

${facts.join('\n')}${mine ? '\n\n' + mine : ''}`, 400, { label: '小结' })

  if (out) return out
  return bad.length
    ? `[耳朵竖起来] 有 ${bad.length} 项需要你看一眼，往下翻喵。`
    : '[优雅地伸个懒腰] 一切正常，没什么要操心的喵。(=^w^=)'
}

// ---------------- 新文章读后反馈 ----------------

/* 提示词里**固定的部分必须排在变量前面**。
 *
 * DeepSeek 按前缀命中缓存：前缀一岔开，后面再怎么重复也算未命中。
 * 实测过一轮（2026-09-16）：资讯 1%、回评 4%、批注 8% 的可缓存比例 ——
 * 全都是因为标题、挂了几小时、主题名这类变量被写在了第一行，
 * 把后面几百上千 token 的固定内容整片踩脏。
 * 这一条对所有提示词都成立，tools/tests/prompt-cache.test.mjs 盯着。
 *
 * 这一条的顺序本来就是对的（要求在前、文章在后），抽成函数是为了能被测到。 */
export const reviewPrompt = post => `主人刚发了一篇新文章，你读完之后给他一段反馈。要求：
1. 先一句话说清这篇讲了什么（证明你真读了）
2. 指出一到两个最值得改进的地方 —— 讲不清楚的段落、缺失的前提、可能有误的说法
3. 如果有技术上的疑点，明确指出来。技术准确性优先于人设
4. 总共不超过 200 字。别夸，夸了没用

标题：${post.title}
${post.series ? '所属系列：' + post.series + '\n' : ''}正文（可能截断）：
${post.body}`

export const reviewPost = async post => {
  const out = await ask(PERSONA, reviewPrompt(post), 700, { label: '读后反馈' })
  return out || `（${whyNoModel()}，这次跳过反馈）`
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

${items.map((c, i) => `[${i}] ${c.who}：${c.body.slice(0, 400)}`).join('\n')}`, 500, { label: '评论筛查' })

  if (!out) return { flagged: [], note: whyNoModel() + '，本次未做筛查' }
  try {
    const m = out.match(/\{[\s\S]*\}/)
    const parsed = JSON.parse(m ? m[0] : out)
    if (!parsed || !Array.isArray(parsed.flagged)) throw new Error('筛查结果缺少 flagged 数组')
    const seen = new Set()
    const flagged = parsed.flagged
      .filter(f => {
        if (!f || !Number.isInteger(f.i) || f.i < 0 || f.i >= items.length || typeof f.why !== 'string' || seen.has(f.i)) return false
        seen.add(f.i)
        return true
      })
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
4. 不要卖惨，不要道德绑架，不要说「你是不是把我忘了」这种话
5. 结尾留一个轻的钩子，比如「我把某某整理好了，你回来看看对不对」

${ctx}`, 400, { label: '想念' })

  return out || `[趴在窗台上，尾巴一甩一甩] ${days} 天了喵。\n\n我不是在等你，只是刚好路过这个页面而已。(ovo)\n\n……新写的那几篇我都读过了，有几个地方想跟你说。你什么时候回来？`
}

// ---------------- 回评草稿 ----------------
// 默认只出草稿放进邮件，不自动发。理由：她在你的博客上公开说话，
// 说错了是你的名声。想让她直接回，把 workflow 里 NANALY_AUTO_REPLY 设成 true。

// 同样：要求在前，哪篇文章、谁说的、说了什么全挪到后面（见 reviewPrompt 上面那段）
export const draftPrompt = (c, articleHint = '') => `替主人拟一条读者留言的回复。要求：
1. 先判断这条留言是提问、指正、还是单纯打招呼，回复方式要对得上
2. 如果是技术问题，答案要准确。不确定就写「这个我不确定，我回去查一下」，绝对不许编
3. 三到五句话。别客套，别写「感谢您的宝贵意见」这种话
4. 你是代表博客主人的助手在回复，可以保留一点你的语气，但别喧宾夺主
5. 只输出回复正文本身，不要加任何前缀说明

━━━ 要回的是这一条 ━━━
留言在：《${c.on}》
${articleHint ? '这篇文章讲的是：' + articleHint + '\n' : ''}留言人：${c.who}
留言内容：${c.body.slice(0, 800)}`

export const draftReplies = async (items, articleHint = '') => {
  const out = []
  for (const c of items.slice(0, 5)) {
    const r = await ask(PERSONA, draftPrompt(c, articleHint), 600, { label: '回评草稿' })
    out.push({ ...c, draft: r || '' })
  }
  return out
}
