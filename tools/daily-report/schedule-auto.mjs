// 日程的自动完成。
//
// 只处理「有客观信号可查」的那几类。像「复习光栅化」这种，
// 世界上没有任何数据能证明你复习了，那就老老实实留给你自己勾。
//
// 四条原则：
//   1. 只勾挂了条件的任务。没挂条件的一律不碰
//   2. 判据是「任务日期当天或之后出现过这个信号」，往前不设限、往后一步不让 ——
//      未来的安排绝不能因为今天发了篇文章就被提前勾掉，因为「只勾不取消」
//      意味着勾错了就永久错着
//   3. 每次自动勾都要能说清依据，写进邮件让你复查
//   4. 只勾不取消。她判错了你自己去掉勾，她不会再勾回来
//
// 2026-09-17 大修了一次。原来的判据是「信号出现在最近 24 小时」+「只看今天和
// 昨天两格任务」，于是「8-21 的任务、8-25 才发文章」永远勾不上，错过一次就
// 永远错过。现在改成幂等的：任何一班跑起来，只要任务日期之后有过那个信号就勾。
// 同时新增 section 条件（某一栏多了一篇），它不需要你猜标题里会出现哪个词 ——
// 猜错了永远不命中而且界面上一声不吭，是这个功能最主要的失效方式。

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { pushWithRetry, useNanalyIdentity } from '../nanaly/git.mjs'
import { postPath } from '../nanaly/permalink.mjs'
import { note, FILE as JOURNAL } from '../nanaly/journal.mjs'
import { listPosts, POSTS_DIR } from '../nanaly/posts.mjs'

const FILE = 'source/_data/schedule.json'

const norm = t => String(t || '').toLowerCase().replace(/\s+/g, '')

// 北京时间的日期键，和前端 schedule.js 里那套完全一致
const bjKey = (d = new Date()) => new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
}).format(d)

/* 这个窗口内改动过的文章（带改动日期）。
 * 只跑一次 git log，按任务日期在内存里过滤 —— 每个任务跑一次 git 太蠢。 */
const editedSince = since => {
  let out
  try {
    out = execFileSync('git', ['log', `--since=${since}`, '--name-only',
      '--pretty=format:@%ad', '--date=short', '--', POSTS_DIR], { encoding: 'utf8' })
  } catch (_) { return [] }
  const rows = []
  let day = ''
  out.split('\n').forEach(line => {
    const t = line.trim()
    if (!t) return
    if (t.startsWith('@')) { day = t.slice(1); return }
    if (t.endsWith('.md')) rows.push({ file: t, day })
  })
  return rows
}

/* 支持的条件类型。前端的下拉框和这里一一对应。
 *
 * 每个 matcher 都拿得到**任务自己那天**（taskDay），判据一律是
 * 「任务日期当天或之后出现过这个信号」——
 *
 * 为什么这样改：原来的判据是「信号出现在最近 24 小时」，而且只看今天和昨天
 * 两格任务。于是「8-21 的任务、8-25 才发文章」永远勾不上：8-25 那天信号有了，
 * 可 8-21 早就不在那两格里。错过一次就永远错过，因为没有任何人会再看它一眼。
 *
 * 现在的判据是幂等的、能自愈的：任何一次运行，只要「任务日期之后有过这个信号」
 * 就勾上。日报那天挂了也没关系，下一班补上。
 *
 * 唯一没放宽的是未来：日期还没到的任务绝不提前勾 —— 「只勾不取消」意味着
 * 勾错了就永久错着。 */
const MATCHERS = {
  // 发布了标题或文件名含关键词的新文章
  post: (cond, ctx, taskDay) => {
    const k = norm(cond.match)
    if (!k) return null
    const hit = ctx.posts.find(p => p.day >= taskDay && !ctx.isHers(p)
      && (norm(p.title).includes(k) || norm(p.file).includes(k)))
    return hit ? `你发了《${hit.title}》（${hit.day}）` : null
  },

  /* 某一栏多了一篇。**比 post 可靠得多，优先用这个。**
   *
   * post 要你猜中标题里会出现哪个词，猜错了永远不会命中、界面上还一声不吭 ——
   * 「提交第六章博客」挂的是「优化」，而那篇的真实标题是
   * 《…把前五章欠的债还掉——准星、碰撞通道、控制台变量与弹道修正》，
   * 全站没有任何一篇标题含「优化」，所以那个条件从设下去的那天起就是死的。
   * 而「Go 这一栏多一篇」不需要猜任何词。 */
  section: (cond, ctx, taskDay) => {
    const leaf = String(cond.match || '').trim()
    if (!leaf) return null
    const hit = ctx.posts.find(p => p.leaf === leaf && p.day >= taskDay)
    return hit ? `「${leaf}」多了一篇：《${hit.title}》（${hit.day}）` : null
  },

  // 改动了标题或文件名含关键词的文章（补图、改公式这类）。
  // 必须同时认标题 —— 这个博客的文件名全是英文 slug，标题全是中文，
  // 只比文件名的话，中文关键词永远匹配不上。
  edit: (cond, ctx, taskDay) => {
    const k = norm(cond.match)
    if (!k) return null
    const hit = ctx.edited.find(e => e.day >= taskDay
      && (norm(e.file).includes(k) || norm(e.title).includes(k)))
    return hit ? `你改了《${hit.title}》（${hit.day}）` : null
  },

  // 回复了读者评论。留空 = 任意一条；填了就要评论所在文章含这个关键词。
  // c.on 是 giscus 讨论的标题，也就是文章的 url 路径（英文 slug），
  // 所以要先换回中文标题再比，不然中文关键词同样永远对不上。
  //
  // 这一条没法像上面几条那样自愈：评论要从 GitHub 拉，而拉回来的是一个
  // 时间窗口内的。窗口外的评论这里看不见，所以它仍然依赖「那一班跑到了」。
  reply: (cond, ctx) => {
    const k = norm(cond.match)
    const hit = ctx.ownerReplies.find(r => !k || norm(r.on).includes(k) || norm(r.title).includes(k))
    return hit ? `你回了《${hit.title || hit.on}》下面的评论` : null
  }
}

export const MATCHER_TYPES = Object.keys(MATCHERS)

/* url 路径 → 文章标题。
 *
 * 路径一律走 permalink.mjs 推 —— 别在这里自己抠年月日：
 * date 是北京挂钟，永久链接是 UTC 日期，凌晨发的文章两者差一天，
 * 那样这张表会对不上，「回复了某篇下面的评论」这类条件永远勾不上。 */
const pathTitleMap = posts => {
  const map = new Map()
  posts.forEach(p => {
    let raw
    try { raw = readFileSync(p.file, 'utf8') } catch (_) { return }
    const path = postPath(p.file, raw)
    if (path) map.set(path.replace(/^\/+|\/+$/g, ''), p.title)
  })
  return map
}
const lookupTitle = (map, on) => map.get(String(on || '').replace(/^\/+|\/+$/g, '')) || ''

/**
 * 把能判的都判了。
 *
 * comments 是可选的：只有 reply 类条件用得上它，拿不到就那一类不判
 * （下一次日报会补）。其余几类只看仓库里的文章，任何一班都能判。
 */
export const autoComplete = async ({ comments = { ok: false }, ownerLogin, dry = false } = {}) => {
  if (!existsSync(FILE)) return { changed: 0, done: [] }

  let data
  try { data = JSON.parse(readFileSync(FILE, 'utf8')) } catch (_) { return { changed: 0, done: [] } }
  const days = data.days || {}
  const todayKey = bjKey()

  // 还开着、日期已到、而且挂了条件的任务 —— 只有这些需要判
  const pending = []
  const skippedFuture = new Set()
  Object.keys(days).forEach(dayKey => {
    const list = days[dayKey]
    if (!Array.isArray(list)) return
    list.forEach(task => {
      if (!task || task.done) return
      if (!task.when || !task.when.type || !MATCHERS[task.when.type]) return
      if (dayKey > todayKey) { skippedFuture.add(dayKey); return }
      pending.push({ dayKey, task })
    })
  })

  if (skippedFuture.size) {
    console.log(`    （${skippedFuture.size} 个未来日期上挂了条件，按规矩没提前勾）`)
  }
  if (!pending.length) return { changed: 0, done: [] }

  const posts = listPosts()
  // git log 只从「最早那个待判任务」那天开始拉，别把整部历史都翻一遍
  const earliest = pending.map(p => p.dayKey).sort()[0]
  const titles = pathTitleMap(posts)
  const owner = String(ownerLogin || '').toLowerCase()
  const ownerReplies = []
  if (comments && comments.ok) {
    comments.items.forEach(c => {
      if (String(c.who || '').toLowerCase() === owner) {
        ownerReplies.push({ on: c.on, title: lookupTitle(titles, c.on) })
      }
    })
  }

  const byFile = new Map(posts.map(p => [p.file, p]))
  const ctx = {
    posts,
    // 她自己写的随笔不算「主人发了新文章」
    isHers: p => /(^|\/)nanaly-/.test(p.file) || p.author === '娜娜莉',
    edited: editedSince(earliest).map(e => ({ ...e, title: (byFile.get(e.file) || {}).title || e.file })),
    ownerReplies
  }

  const done = []
  pending.forEach(({ dayKey, task }) => {
    const why = MATCHERS[task.when.type](task.when, ctx, dayKey)
    if (!why) return
    task.done = true
    task.autoAt = new Date().toISOString()
    task.autoWhy = why
    done.push({ date: dayKey, text: task.text, why })
  })

  if (!done.length) return { changed: 0, done: [] }

  // 演练时只报告会勾什么，绝不落盘 —— 否则你在本地跑一次演练，
  // 日程就被真的改掉了，那不叫演练
  if (dry) return { changed: done.length, done, dry: true }

  data.updatedAt = new Date().toISOString()
  writeFileSync(FILE, JSON.stringify(data, null, 2) + '\n')
  return { changed: done.length, done }
}

export const commitSchedule = async (done) => {
  const run = (...a) => execFileSync('git', a, { encoding: 'utf8', stdio: 'pipe' })
  try {
    // 她替主人勾掉了任务，这也是「她今天干了什么」的一部分 ——
    // 周日那篇随笔和右下角对话窗口的她都读得到
    note('schedule', `替主人自动勾掉了 ${done.length} 项日程：${done.slice(0, 3).map(d => `「${d.text}」`).join('、')}`)
    useNanalyIdentity(run)
    run('add', FILE, JOURNAL)
    if (!run('status', '--porcelain', '--', FILE, JOURNAL).trim()) return false
    run('commit', '-m', `娜娜莉：自动完成 ${done.length} 项日程`)

    // 你可能正好在网页上按了保存 —— 那边直接往 main 提交，这边就会被拒。
    // 拒了要 rebase 之后重试，不能默默算了，不然这几个勾就永远消失了
    // （那天的信号已经过去，下次跑也不会再判出来）。
    pushWithRetry(run, '日程')
  } catch (e) {
    console.log('  日程提交失败：' + String(e.message || e).slice(0, 200))
    return false
  }

  /* 推上去了，这几个勾已经安全落地。
   *
   * 下面这步失败**不等于**提交失败，所以不能混进上面那个 catch ——
   * 那样日报会报「自动勾的结果没能提交到仓库，这几项会丢失」，而事实是
   * 提交好好的，只是线上的日程页还没更新。报错报得不对比不报更麻烦。
   * 但也不能默默算了：不触发部署，你在页面上会看到「明明勾了却没变」。 */
  try {
    const { triggerDeploy } = await import('../nanaly/github.mjs')
    await triggerDeploy()
  } catch (e) {
    console.error('  ⚠️ 日程已提交，但' + String(e.message || e).slice(0, 200))
    process.exitCode = 1
  }
  return true
}
