// 日程的自动完成。
//
// 只处理「有客观信号可查」的那几类。像「复习光栅化」这种，
// 世界上没有任何数据能证明你复习了，那就老老实实留给你自己勾。
//
// 四条原则：
//   1. 只勾挂了条件的任务。没挂条件的一律不碰
//   2. 只看「今天和昨天」这两格。未来的安排绝不能因为今天发了篇文章就被提前勾掉 ——
//      「只勾不取消」意味着勾错了就永久错着，所以宁可漏也不能早
//   3. 每次自动勾都要能说清依据，写进邮件让你复查
//   4. 只勾不取消。她判错了你自己去掉勾，她不会再勾回来（因为那天的信号已经过去了）

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { pushWithRetry, useNanalyIdentity } from '../nanaly/git.mjs'
import { postPath } from '../nanaly/permalink.mjs'

const FILE = 'source/_data/schedule.json'
const POSTS = 'source/_posts'

const norm = t => String(t || '').toLowerCase().replace(/\s+/g, '')

// 北京时间的日期键，和前端 schedule.js 里那套完全一致
const bjKey = (d = new Date()) => new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
}).format(d)

// 支持的条件类型。前端的下拉框和这里一一对应。
const MATCHERS = {
  // 发布了标题或文件名含关键词的新文章
  post: (cond, ctx) => {
    const k = norm(cond.match)
    if (!k) return null
    const hit = ctx.newPosts.find(p => norm(p.title).includes(k) || norm(p.file).includes(k))
    return hit ? `你发了《${hit.title}》` : null
  },
  // 改动了标题或文件名含关键词的文章（补图、改公式这类）。
  // 必须同时认标题 —— 这个博客的文件名全是英文 slug，标题全是中文，
  // 只比文件名的话，中文关键词永远匹配不上。
  edit: (cond, ctx) => {
    const k = norm(cond.match)
    if (!k) return null
    const hit = ctx.editedFiles.find(f => norm(f.file).includes(k) || norm(f.title).includes(k))
    return hit ? `你改了《${hit.title}》` : null
  },
  // 回复了读者评论。留空 = 任意一条；填了就要评论所在文章含这个关键词。
  // c.on 是 giscus 讨论的标题，也就是文章的 url 路径（英文 slug），
  // 所以要先换回中文标题再比，不然中文关键词同样永远对不上。
  reply: (cond, ctx) => {
    const k = norm(cond.match)
    const hit = ctx.ownerReplies.find(r => !k || norm(r.on).includes(k) || norm(r.title).includes(k))
    return hit ? `你回了《${hit.title || hit.on}》下面的评论` : null
  }
}

// 从 front-matter 抠标题
const titleOf = file => {
  try {
    const raw = readFileSync(file, 'utf8')
    const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)
    const m = fm && fm[1].match(/^title:\s*(.+)$/m)
    return m ? m[1].trim().replace(/^['"]|['"]$/g, '') : ''
  } catch (_) { return '' }
}

/* url 路径 → 文章标题。
 *
 * 路径一律走 permalink.mjs 推 —— 别在这里自己抠年月日：
 * date 是北京挂钟，永久链接是 UTC 日期，凌晨发的文章两者差一天，
 * 那样这张表会对不上，「回复了某篇下面的评论」这类条件永远勾不上。 */
const pathTitleMap = () => {
  const map = new Map()
  try {
    readdirSync(POSTS).filter(f => f.endsWith('.md')).forEach(f => {
      const file = `${POSTS}/${f}`
      const raw = readFileSync(file, 'utf8')
      const p = postPath(file, raw)
      if (!p) return
      map.set(p.replace(/^\/+|\/+$/g, ''), titleOf(file) || f.replace(/\.md$/, ''))
    })
  } catch (_) {}
  return map
}
const lookupTitle = (map, on) => {
  const key = String(on || '').replace(/^\/+|\/+$/g, '')
  return map.get(key) || ''
}

// 这个窗口内改动过的文章（带标题）
const editedInWindow = since => {
  let files = []
  try {
    files = [...new Set(execFileSync('git', [
      'log', `--since=${new Date(since).toISOString()}`, '--name-only', '--pretty=format:', '--', 'source/_posts/'
    ], { encoding: 'utf8' }).split('\n').map(s => s.trim()).filter(f => f.endsWith('.md')))]
  } catch (_) { return [] }
  return files.map(f => ({ file: f, title: existsSync(f) ? (titleOf(f) || f) : f }))
}

export const autoComplete = async ({ newPosts = [], comments = { ok: false }, windowStart, ownerLogin, dry = false }) => {
  if (!existsSync(FILE)) return { changed: 0, done: [] }

  let data
  try { data = JSON.parse(readFileSync(FILE, 'utf8')) } catch (_) { return { changed: 0, done: [] } }
  const days = data.days || {}

  const titles = pathTitleMap()
  const owner = String(ownerLogin || '').toLowerCase()
  const ownerReplies = []
  if (comments.ok) {
    comments.items.forEach(c => {
      if (String(c.who || '').toLowerCase() === owner) {
        ownerReplies.push({ on: c.on, title: lookupTitle(titles, c.on) })
      }
    })
  }

  const ctx = {
    newPosts: newPosts.map(p => ({ title: p.title || '', file: p.file || '' })),
    editedFiles: editedInWindow(windowStart),
    ownerReplies
  }

  // 只看今天和昨天。日报在北京时间晚上 10 点跑，信号窗口是 24 小时，
  // 所以昨天的任务也可能是刚刚才完成的；再往前就过期了，再往后是未来。
  const todayKey = bjKey()
  const yesterdayKey = bjKey(new Date(Date.now() - 86400000))
  const inScope = k => k === todayKey || k === yesterdayKey

  const done = []
  const skippedFuture = []
  Object.keys(days).forEach(dayKey => {
    const list = days[dayKey]
    if (!Array.isArray(list)) return
    if (!inScope(dayKey)) {
      if (dayKey > todayKey && list.some(t => t && !t.done && t.when && t.when.type)) skippedFuture.push(dayKey)
      return
    }
    list.forEach(task => {
      if (task.done) return
      const cond = task.when
      if (!cond || !cond.type || !MATCHERS[cond.type]) return
      const why = MATCHERS[cond.type](cond, ctx)
      if (!why) return
      task.done = true
      task.autoAt = new Date().toISOString()
      task.autoWhy = why
      done.push({ date: dayKey, text: task.text, why })
    })
  })

  if (skippedFuture.length) {
    console.log(`    （${skippedFuture.length} 个未来日期上挂了条件，按规矩没提前勾）`)
  }
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
    useNanalyIdentity(run)
    run('add', FILE)
    if (!run('status', '--porcelain', '--', FILE).trim()) return false
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
