// 娜娜莉的自主行动入口。
//
//   node tools/nanaly/run.mjs patrol   巡逻并在发现问题时留言
//   node tools/nanaly/run.mjs react    给文章贴表情
//   node tools/nanaly/run.mjs reply    替主人回复挂了太久没人管的评论
//   node tools/nanaly/run.mjs notes    给文章写段落批注并提交
//   node tools/nanaly/run.mjs news     搜一轮资讯，整理成一期并提交
//   node tools/nanaly/run.mjs column   写一篇她自己的随笔并提交
//   node tools/nanaly/run.mjs all      全做一遍
//
// 加 --dry 只演练不动真格（不发评论、不提交），把会做的事打印出来。

import { patrol, react } from './patrol.mjs'
import { autoReply } from './reply.mjs'
import { buildNotes, commitNotes } from './notes.mjs'
import { buildNews, commitNews } from './news.mjs'
import { writeColumn, commitAndPush } from './column.mjs'
import { getComments } from '../daily-report/sources.mjs'

const DRY = process.argv.includes('--dry')
const what = (process.argv[2] || 'all').replace(/^-+/, '')

const tasks = {
  async patrol () {
    console.log('巡逻中…')
    const r = await patrol()
    console.log(`  看了 ${r.checked} 篇，留言 ${r.reported} 条`)
    return r
  },
  async react () {
    console.log('贴表情中…')
    const n = await react(Number(process.env.NANALY_REACT_LIMIT || 3))
    console.log(`  贴了 ${n} 个`)
    return n
  },
  async reply () {
    console.log('看看有没有评论该接手…')
    const r = await autoReply()
    console.log(`  回了 ${r.replied} 条`)
    return r
  },
  async notes () {
    console.log('给文章写批注…')
    const r = await buildNotes()
    if (r.wrote && !r.dry && !DRY) await commitNotes()
    return r
  },
  async news () {
    console.log('去搜资讯…')
    const made = await buildNews()
    // indexOnly 也要走提交 —— commitNews 自己会用 git status 判断有没有变化
    if (made && !made.dry && !DRY) await commitNews(made.date)
    return made
  },
  async column () {
    console.log('写随笔中…')
    const cm = await getComments().catch(() => ({ ok: false }))
    const made = await writeColumn({ comments: cm.ok ? cm.items : [] })
    if (made && !made.dry && !DRY) await commitAndPush(made)
    return made
  }
}

const main = async () => {
  console.log(DRY ? '【演练模式，不会真的发评论或提交】\n' : '')
  const list = what === 'all' ? ['reply', 'patrol', 'notes', 'news', 'react', 'column'] : [what]
  for (const t of list) {
    if (!tasks[t]) { console.log(`不认识的动作：${t}`); continue }
    try {
      await tasks[t]()
    } catch (e) {
      // 这里必须把工作流染红。以前只打一行日志就过去了，
      // 结果是「资讯生成好了但推送失败」这种事全绿通过，你完全不会发现，
      // 而那一期的内容随着 runner 一起消失，下次跑日期变了也不会补。
      console.error(`  ${t} 失败：`, String(e.message || e).slice(0, 300))
      process.exitCode = 1
    }
  }
}

main().catch(e => { console.error('致命错误：', e); process.exit(1) })
