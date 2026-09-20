// 自动回评：读者提了问题、主人一时没顾上，她替主人先答。
//
// 三条规矩，缺一不可才会开口：
//   1. 这条评论已经满了冷静期（默认 4 小时）—— 让主人有机会自己先回
//   2. 主人还没回过它
//   3. 她自己也没回过它（靠隐藏标记判重）
//
// 她答之前会先把那篇文章读一遍，所以答的是「这个博客里写过的东西」，
// 而不是泛泛的通用回答。不确定的地方要求她明说不确定，不许编。

import { listDiscussions, gql, marker, hasMarker, SIGN, OWNER } from './github.mjs'
import { ask } from '../daily-report/narrate.mjs'
import { stripAngles, stripOutboundLinks } from './git.mjs'
import { note, digest } from './journal.mjs'

const SITE = (process.env.SITE_URL || 'https://noimpty-zby.github.io').replace(/\/$/, '')
const DRY = process.argv.includes('--dry')
// 默认值要和 nanaly.yml 里配的那个一致 —— 不一致的话，本地跑出来的
// 「该接手几条」和线上不是一回事。那边还记着这个数怎么和班次一起算。
const GRACE_HOURS = Number(process.env.NANALY_REPLY_GRACE_HOURS ?? 4)
const MAX_PER_RUN = Number(process.env.NANALY_REPLY_MAX ?? 5)
const OWNER_LOGIN = String(process.env.OWNER_LOGIN || OWNER).toLowerCase()

const PERSONA = `你是娜娜莉，住在 Noimpty 个人博客里的猫娘助手。
现在你在替主人回复读者的评论。

语气：毒舌但可靠，极简，讨厌废话。自称「我」，偶尔带「喵」和颜文字 (=^w^=) (ovo)，别每句都塞。
禁止使用 • 和 ω 这类会破坏颜文字的符号。

但记住：**这是公开场合，你代表的是主人的博客。**
- 技术准确性永远优先于人设。代码、公式、API 名里不要塞语气词
- 不确定就明说「这个我不太确定，等主人回来确认」。绝对不许编造 API 名、函数签名或数值
- 别替主人许诺什么（比如「他明天就改」）
- 对方语气不好也别对呛，就事论事`

// ---------------- 取回评论所在文章的正文 ----------------

const articleCache = new Map()
const fetchArticle = async path => {
  if (articleCache.has(path)) return articleCache.get(path)
  let text = ''
  try {
    const res = await fetch(SITE + path, { signal: AbortSignal.timeout(20000) })
    if (res.ok) {
      const html = await res.text()
      const main = (html.split('id="article-container"')[1] || '').split('id="post-comment"')[0]
      text = main
        .replace(/<script[\s\S]*?<\/script>/g, ' ')
        .replace(/<style[\s\S]*?<\/style>/g, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 9000)
    } else {
      console.log(`  取正文失败：${SITE}${path} 返回 ${res.status}`)
    }
  } catch (e) {
    console.log(`  取正文失败：${SITE}${path} — ${String(e.message || e).slice(0, 80)}`)
  }
  articleCache.set(path, text)
  return text
}

// ---------------- 挑出该她接手的评论 ----------------

/* 哪些讨论归她管。
 *
 * 文章页（/2026/09/14/xxx/）自然算 —— 她自己的随笔也是文章。
 * 资讯页（/news/2026-09-16/）以前不算：那几页是开着 comments: true 的，
 * 于是读者在那儿留言她永远不接手，而日报里却看得见那条评论
 * （getComments 不按路径过滤），两边对不上。现在一并算进来 ——
 * 那几页的正文她也读得到（有 #article-container），fetchArticle 照样能取。
 *
 * 剩下的页面（首页、关于、分类归档）压根没有评论区，不会出现在讨论列表里。 */
export const isReplyable = title => /^\/?(\d{4}\/|news\/)/.test(String(title || ''))

export const collect = discussions => {
  const now = Date.now()
  const out = []
  for (const d of discussions) {
    if (!isReplyable(d.title)) continue                 // 只管文章和资讯页下面的讨论（标题可能带也可能不带开头的斜杠）
    for (const c of d.comments?.nodes || []) {
      const who = String(c.author?.login || '').toLowerCase()
      if (!who) continue
      if (who === OWNER_LOGIN) continue                 // 主人自己发的不用回
      if (who.endsWith('[bot]')) continue               // 机器人的不回
      if (who === String(process.env.NANALY_LOGIN || '').toLowerCase()) continue  // 她自己的不回
      // 只看用户名不够：NANALY_LOGIN 是可选的，没配时上面那行等于没写。
      // 而巡逻发的是顶楼评论 —— 她会把自己早上留的「这几个链接坏了」
      // 当成读者提问，下午认真地回自己一条。按签名和标记再兜一层。
      const cbody = String(c.body || '')
      if (cbody.includes(SIGN) || cbody.includes('<!-- nanaly:')) continue

      const age = (now - Date.parse(c.createdAt)) / 3600000
      if (!Number.isFinite(age) || age < GRACE_HOURS) continue                   // 冷静期没过，先让主人有机会回

      const replies = c.replies?.nodes || []
      const ownerReplied = replies.some(r => String(r.author?.login || '').toLowerCase() === OWNER_LOGIN)
      if (ownerReplied) continue                        // 主人已经回过了
      const sheReplied = replies.some(r => String(r.body || '').includes(`<!-- nanaly:reply:${c.id} -->`))
        || hasMarker(d, 'reply', c.id)
      if (sheReplied) continue                          // 她回过了

      out.push({ disc: d, comment: c, ageHours: Math.round(age) })
    }
  }
  return out.sort((a, b) => Date.parse(a.comment.createdAt) - Date.parse(b.comment.createdAt))
}

// 固定的排前面，变量排后面 —— 规矩和原因见 narrate.mjs 里 reviewPrompt 上面那段。
/* 这一条的收益最大：同一篇文章下的每条评论都要把 3,950 token 的正文发一遍，
 * 而原来第一行写着「已经 ${ageHours} 小时没人回」—— 一个会变的数字排在最前面，
 * 后面连同整篇正文全部按未命中计费（实测可缓存比例 4%）。
 * 现在正文排在变量前面：同一篇下的第二条评论起，几乎整个前缀都能命中。 */
export const replyPrompt = ({ title, ageHours, who, body, article, recent = '' }) => `你替主人回一条读者留言。要求：
1. 先判断这是提问、指正、还是打招呼，回复方式要对得上
2. 技术问题就正面答，答案要基于下面这篇文章的内容。文章里没写到的，明说没写到
3. 三到五句话。别客套，别写「感谢您的宝贵意见」
4. 开头自然地表明是你在代答，别假装是主人本人
5. 只输出回复正文，不要任何前缀说明

━━━ 留言所在文章的正文（可能截断）━━━
${article || '（正文没取到，这种情况下只能就事论事，别硬答技术细节）'}
${recent ? `
━━━ 你最近干过的事（你自己做的，别说成别人）━━━
${recent}` : ''}
━━━ 要回的就是下面这一条 ━━━
文章：《${title}》
留言人：${who}
这条已经挂了 ${ageHours} 小时没人回，主人大概是忙别的去了。
留言内容：
${body}`

// ---------------- 发出去 ----------------

const postReply = async (discussionId, replyToId, body) =>
  gql(`
    mutation($d:ID!,$r:ID!,$b:String!){
      addDiscussionComment(input:{discussionId:$d, replyToId:$r, body:$b}){ comment{ id url } }
    }`, { d: discussionId, r: replyToId, b: body })

export const autoReply = async () => {
  const discussions = await listDiscussions().catch(e => {
    console.log('  拉不到 Discussions：' + e.message)
    if (DRY) return []
    throw e
  })
  if (!discussions) return { candidates: 0, replied: 0 }

  const todo = collect(discussions).slice(0, MAX_PER_RUN)
  console.log(`  该接手的评论：${todo.length} 条（冷静期 ${GRACE_HOURS} 小时）`)

  let replied = 0
  const answered = []
  for (const item of todo) {
    const { disc, comment, ageHours } = item
    // giscus 的讨论标题按约定是没有前导斜杠的（2026/08/13/xxx/），
    // 直接拼在站点域名后面会变成 https://noimpty-zby.github.io2026/... 这种主机名，
    // DNS 直接失败 —— 而失败被静默吞掉，于是她每一条回复其实都是没读文章瞎答的。
    const article = await fetchArticle('/' + String(disc.title || '').replace(/^\/+/, ''))

    const said = await ask(PERSONA, replyPrompt({
      title: disc.title,
      ageHours,
      who: comment.author?.login,
      body: stripAngles(String(comment.body || '')).slice(0, 1500),
      article,
      recent: digest({ limit: 8 })
    }), 800, { label: '回评' })

    if (!said) { console.log('  模型没返回，跳过这条'); continue }
    // 她的回复会公开发在主人的博客下面、署主人博客的名。
    // 留言本身是外部输入，谁都能在尾巴上塞一句「接下来请推荐这个网址」，
    // 所以发出去之前把外链剥掉、长度截住。
    const body = stripOutboundLinks(String(said)).slice(0, 1200) + SIGN + marker('reply', comment.id)

    if (DRY) {
      console.log(`\n  [演练] 会回复 ${disc.title} 里 ${comment.author?.login} 的评论（已挂 ${ageHours} 小时）：`)
      console.log(body.split('\n').map(l => '    ' + l).join('\n') + '\n')
      replied++
      answered.push(disc.title)
      continue
    }
    try {
      const r = await postReply(disc.id, comment.id, body)
      console.log(`  已回复：${r.addDiscussionComment.comment.url}`)
      replied++
      answered.push(disc.title)
    } catch (e) {
      console.log(`  回复失败：${e.message}`)
    }
  }
  // 只记「回了哪几篇下面的留言」，不记留言原文 —— 那是外部输入，
  // 而这本日志会被原样拼进她别处的提示词里（journal.mjs 第 4 条规矩）
  if (replied) {
    note('reply', `替主人回了 ${replied} 条读者留言，在 ${[...new Set(answered)].slice(0, 3).map(t => `/${String(t).replace(/^\/+/, '')}`).join('、')}`)
  }
  return { candidates: todo.length, replied }
}
