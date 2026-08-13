// 自动回评：读者提了问题、主人一时没顾上，她替主人先答。
//
// 三条规矩，缺一不可才会开口：
//   1. 这条评论已经满了冷静期（默认 6 小时）—— 让主人有机会自己先回
//   2. 主人还没回过它
//   3. 她自己也没回过它（靠隐藏标记判重）
//
// 她答之前会先把那篇文章读一遍，所以答的是「这个博客里写过的东西」，
// 而不是泛泛的通用回答。不确定的地方要求她明说不确定，不许编。

import { listDiscussions, gql, marker, hasMarker, SIGN, OWNER } from './github.mjs'
import { ask } from '../daily-report/narrate.mjs'

const SITE = (process.env.SITE_URL || 'https://noimpty-zby.github.io').replace(/\/$/, '')
const DRY = process.argv.includes('--dry')
const GRACE_HOURS = Number(process.env.NANALY_REPLY_GRACE_HOURS ?? 6)
const MAX_PER_RUN = Number(process.env.NANALY_REPLY_MAX ?? 5)
const OWNER_LOGIN = String(process.env.OWNER_LOGIN || OWNER).toLowerCase()

const PERSONA = `你是娜娜莉，住在 Noimpty 个人博客里的猫娘助手。
现在你在替主人回复读者的评论。

语气：毒舌但可靠，极简，讨厌废话。自称「窝」，偶尔带「喵」和颜文字 (=^w^=) (ovo)，别每句都塞。
禁止使用 • 和 ω 这类会破坏颜文字的符号。

但记住：**这是公开场合，你代表的是主人的博客。**
- 技术准确性永远优先于人设。代码、公式、API 名里不要塞语气词
- 不确定就明说「这个窝不太确定，等主人回来确认」。绝对不许编造 API 名、函数签名或数值
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
    }
  } catch (_) {}
  articleCache.set(path, text)
  return text
}

// ---------------- 挑出该她接手的评论 ----------------

export const collect = discussions => {
  const now = Date.now()
  const out = []
  for (const d of discussions) {
    if (!/^\/\d{4}\//.test(d.title)) continue          // 只管文章下面的讨论
    for (const c of d.comments?.nodes || []) {
      const who = String(c.author?.login || '').toLowerCase()
      if (!who) continue
      if (who === OWNER_LOGIN) continue                 // 主人自己发的不用回
      if (who.endsWith('[bot]')) continue               // 机器人的不回
      if (who === String(process.env.NANALY_LOGIN || '').toLowerCase()) continue  // 她自己的不回

      const age = (now - Date.parse(c.createdAt)) / 3600000
      if (age < GRACE_HOURS) continue                   // 冷静期没过，先让主人有机会回

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

// ---------------- 发出去 ----------------

const postReply = async (discussionId, replyToId, body) =>
  gql(`
    mutation($d:ID!,$r:ID!,$b:String!){
      addDiscussionComment(input:{discussionId:$d, replyToId:$r, body:$b}){ comment{ id url } }
    }`, { d: discussionId, r: replyToId, b: body })

export const autoReply = async () => {
  const discussions = await listDiscussions().catch(e => {
    console.log('  拉不到 Discussions：' + e.message)
    return DRY ? [] : null
  })
  if (!discussions) return { candidates: 0, replied: 0 }

  const todo = collect(discussions).slice(0, MAX_PER_RUN)
  console.log(`  该接手的评论：${todo.length} 条（冷静期 ${GRACE_HOURS} 小时）`)

  let replied = 0
  for (const item of todo) {
    const { disc, comment, ageHours } = item
    const article = await fetchArticle(disc.title)

    const said = await ask(PERSONA,
      `读者在《${disc.title}》下面留言，已经 ${ageHours} 小时没人回了，主人大概是忙别的去了。你替他回一下。

要求：
1. 先判断这是提问、指正、还是打招呼，回复方式要对得上
2. 技术问题就正面答，答案要基于下面这篇文章的内容。文章里没写到的，明说没写到
3. 三到五句话。别客套，别写「感谢您的宝贵意见」
4. 开头自然地表明是你在代答，别假装是主人本人
5. 只输出回复正文，不要任何前缀说明

留言人：${comment.author?.login}
留言内容：
${String(comment.body || '').slice(0, 1500)}

这篇文章的正文（可能截断）：
${article || '（正文没取到，这种情况下只能就事论事，别硬答技术细节）'}`, 800)

    if (!said) { console.log('  模型没返回，跳过这条'); continue }
    const body = said + SIGN + marker('reply', comment.id)

    if (DRY) {
      console.log(`\n  [演练] 会回复 ${disc.title} 里 ${comment.author?.login} 的评论（已挂 ${ageHours} 小时）：`)
      console.log(body.split('\n').map(l => '    ' + l).join('\n') + '\n')
      replied++
      continue
    }
    try {
      const r = await postReply(disc.id, comment.id, body)
      console.log(`  已回复：${r.addDiscussionComment.comment.url}`)
      replied++
    } catch (e) {
      console.log(`  回复失败：${e.message}`)
    }
  }
  return { candidates: todo.length, replied }
}
