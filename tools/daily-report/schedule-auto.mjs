// 日程的自动完成。
//
// 只处理「有客观信号可查」的那几类。像「复习光栅化」这种，
// 世界上没有任何数据能证明你复习了，那就老老实实留给你自己勾。
//
// 三条原则：
//   1. 只勾挂了条件的任务。没挂条件的一律不碰
//   2. 每次自动勾都要能说清依据，写进邮件让你复查
//   3. 只勾不取消。她判错了你自己去掉勾，她不会再勾回来（因为那天的信号已经过去了）

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const FILE = 'source/_data/schedule.json'

const norm = t => String(t || '').toLowerCase().replace(/\s+/g, '')

// 支持的条件类型。前端的下拉框和这里一一对应。
const MATCHERS = {
  // 发布了标题或文件名含关键词的新文章
  post: (cond, ctx) => {
    const k = norm(cond.match)
    if (!k) return null
    const hit = ctx.newPosts.find(p => norm(p.title).includes(k) || norm(p.file).includes(k))
    return hit ? `你发了《${hit.title}》` : null
  },
  // 改动了标题或文件名含关键词的文章（补图、改公式这类）
  edit: (cond, ctx) => {
    const k = norm(cond.match)
    if (!k) return null
    const hit = ctx.editedFiles.find(f => norm(f).includes(k))
    return hit ? `你改了 ${hit}` : null
  },
  // 回复了读者评论。留空 = 任意一条；填了就要评论所在文章含这个关键词
  reply: (cond, ctx) => {
    const k = norm(cond.match)
    const hit = ctx.ownerReplies.find(r => !k || norm(r.on).includes(k))
    return hit ? `你回了《${hit.on}》下面的评论` : null
  }
}

// 这个窗口内改动过的文章文件
const editedInWindow = since => {
  try {
    return [...new Set(execFileSync('git', [
      'log', `--since=${new Date(since).toISOString()}`, '--name-only', '--pretty=format:', '--', 'source/_posts/'
    ], { encoding: 'utf8' }).split('\n').map(s => s.trim()).filter(f => f.endsWith('.md')))]
  } catch (_) { return [] }
}

export const autoComplete = async ({ newPosts = [], comments = { ok: false }, windowStart, ownerLogin }) => {
  if (!existsSync(FILE)) return { changed: 0, done: [] }

  let data
  try { data = JSON.parse(readFileSync(FILE, 'utf8')) } catch (_) { return { changed: 0, done: [] } }
  const days = data.days || {}

  const owner = String(ownerLogin || '').toLowerCase()
  const ownerReplies = []
  if (comments.ok) {
    comments.items.forEach(c => {
      if (String(c.who || '').toLowerCase() === owner) ownerReplies.push({ on: c.on })
    })
  }

  const ctx = {
    newPosts: newPosts.map(p => ({ title: p.title || '', file: p.file || '' })),
    editedFiles: editedInWindow(windowStart),
    ownerReplies
  }

  const done = []
  Object.keys(days).forEach(dayKey => {
    const list = days[dayKey]
    if (!Array.isArray(list)) return
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

  if (!done.length) return { changed: 0, done: [] }

  data.updatedAt = new Date().toISOString()
  writeFileSync(FILE, JSON.stringify(data, null, 2) + '\n')
  return { changed: done.length, done }
}

export const commitSchedule = async (done) => {
  const run = (...a) => execFileSync('git', a, { encoding: 'utf8', stdio: 'pipe' })
  try {
    run('config', 'user.name', process.env.NANALY_GIT_NAME || '娜娜莉')
    run('config', 'user.email', process.env.NANALY_GIT_EMAIL || 'nanaly@noimpty-zby.github.io')
    run('add', FILE)
    if (!run('status', '--porcelain', '--', FILE).trim()) return false
    run('commit', '-m', `娜娜莉：自动完成 ${done.length} 项日程`)
    run('push')
    const { triggerDeploy } = await import('../nanaly/github.mjs')
    await triggerDeploy()
    return true
  } catch (e) {
    console.log('  日程提交失败：' + String(e.message || e).slice(0, 140))
    return false
  }
}
