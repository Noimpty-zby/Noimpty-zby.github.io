// 入口：采数据 → 跑检查 → 让娜娜莉写人话 → 生成邮件 → 发出去。
//
// 设计原则：任何一个环节挂了，报告照发，把失败原因写进报告里。
// 宁可收到一份「访问数据没取到」的邮件，也不要因为一个接口 500 就整晚没消息。
//
// 本地试跑（不发邮件，只生成 report.html）：
//   node tools/daily-report/run.mjs --dry

import { writeFileSync } from 'node:fs'
import { CFG, WINDOW, WINDOW_LABEL, getTraffic, getComments, getNewPosts, getOwnerHeartbeat, getSchedule } from './sources.mjs'
import { runHealth } from './health.mjs'
import { writeOpening, reviewPost, screenComments, writeMissYou, draftReplies } from './narrate.mjs'
import { renderEmail, renderSubject, renderMissYou } from './render.mjs'
import { autoComplete, commitSchedule } from './schedule-auto.mjs'

const DRY = process.argv.includes('--dry')
const QUIET = process.env.REPORT_ONLY_WHEN_NOTEWORTHY === 'true'

const step = async (name, fn, fallback) => {
  process.stdout.write(`  ${name} … `)
  try { const r = await fn(); console.log('ok'); return r }
  catch (e) { console.log('失败：' + String(e.message || e).slice(0, 120)); return fallback }
}

const main = async () => {
  console.log(`站点 ${CFG.site}｜窗口 ${WINDOW_LABEL}`)

  const [traffic, comments, newPosts, health, beat] = await Promise.all([
    step('访问统计', getTraffic, { ok: false, why: '采集异常' }),
    step('评论', getComments, { ok: false, why: '采集异常' }),
    step('新文章', getNewPosts, { ok: false, why: '采集异常' }),
    step('健康检查', runHealth, { checks: [], worst: 'warn' }),
    step('主人心跳', getOwnerHeartbeat, { ok: false, why: '采集异常' })
  ])

  // 先按客观信号自动勾一遍，再读日程 —— 这样邮件里看到的是最新状态，
  // 而不是「明明发了文章却还显示没做」
  const auto = await step('日程自动完成', () => autoComplete({
    newPosts: newPosts.ok ? newPosts.items : [],
    comments,
    windowStart: WINDOW.start,
    ownerLogin: process.env.OWNER_LOGIN || (CFG.repo.split('/')[0]),
    dry: DRY
  }), { changed: 0, done: [] })

  if (auto.changed) {
    auto.done.forEach(d => console.log(`    ${DRY ? '[演练] 会勾上' : '自动勾上'}「${d.text}」 —— ${d.why}`))
    if (!DRY) {
      const ok = await commitSchedule(auto.done)
      if (!ok) {
        // 勾了但没提交上去 = 这几个勾只活在这台马上就要销毁的 runner 上，
        // 而当天的信号窗口已经过去，明天再跑也判不出来。必须变红。
        console.error('    ⚠️ 自动勾的结果没能提交到仓库，这几项会丢失')
        process.exitCode = 1
      }
    } else console.log('    演练模式：不改数据、不提交')
  }

  const schedule = await step('日程', getSchedule, { ok: false, why: '读取异常' })
  if (schedule.ok) schedule.autoDone = auto.done

  // 好久没来 → 改发一封短的想念邮件，别拿数据表格砸他
  const after = Number(process.env.MISS_YOU_AFTER_DAYS ?? 4)
  const gap = beat.ok ? beat.days : null
  const shouldMiss = after > 0 && gap != null && gap >= after && (gap - after) % 3 === 0
  // 站点真出事的时候不能只发一封「4 天没见了」——
  // 证书快过期、构建挂了、首页 404，这些必须照常送到。
  if (shouldMiss && health.worst === 'bad') {
    console.log(`  主人 ${gap} 天没来了，但站点有问题，照常发日报`)
  } else if (shouldMiss) {
    console.log(`  主人 ${gap} 天没来了，改发想念邮件`)
    return sendMissYou({ days: gap, traffic, comments, newPosts })
  }

  const screen = comments.ok
    ? await step('评论筛查', () => screenComments(comments.items), { flagged: [], note: '筛查异常' })
    : { flagged: [], note: '' }

  // 给正常的评论拟回复草稿（可疑的不拟，那些应该删掉而不是回复）
  if (comments.ok && comments.items.length) {
    const spam = new Set(screen.flagged.map(f => f.url))
    const worth = comments.items.filter(c => !spam.has(c.url))
    if (worth.length) {
      const drafted = await step('拟回复草稿', () => draftReplies(worth), [])
      const byUrl = new Map(drafted.map(d => [d.url, d.draft]))
      comments.items.forEach(c => { if (byUrl.has(c.url)) c.draft = byUrl.get(c.url) })
    }
  }

  const feedbacks = []
  if (newPosts.ok) {
    for (const p of newPosts.items) {
      feedbacks.push(await step(`读《${p.title.slice(0, 18)}》`, () => reviewPost(p), '（读取失败）'))
    }
  }

  const opening = await step('写小结',
    () => writeOpening({ traffic, comments, newPosts, health, schedule }),
    '（小结生成失败，下面是原始数据）')

  const noteworthy =
    health.worst !== 'ok' ||
    (traffic.ok && traffic.pageviews > 0) ||
    (comments.ok && comments.items.length > 0) ||
    (newPosts.ok && newPosts.items.length > 0)

  const html = renderEmail({
    opening, traffic, comments, screen, newPosts, feedbacks, health, schedule,
    windowLabel: WINDOW_LABEL, site: CFG.site
  })
  const subject = renderSubject({ traffic, comments, newPosts, health })

  writeFileSync('report.html', html)
  writeFileSync('report-subject.txt', subject)
  console.log(`\n主题：${subject}`)
  console.log(`报告已写入 report.html（${(html.length / 1024).toFixed(1)} KB）`)

  if (QUIET && !noteworthy) {
    console.log('安静模式：今天没什么可报的，不发邮件。')
    writeFileSync('report-skip.txt', '1')
    return
  }
  if (DRY) { console.log('演练模式：不发邮件。'); return }
  await sendMail(subject, html)
}

const sendMail = async (subject, html) => {
  const user = process.env.GMAIL_USER
  const pass = process.env.GMAIL_APP_PASSWORD
  const to = process.env.REPORT_TO || user
  if (!user || !pass) { console.log('没有配置 Gmail 凭据，跳过发送。'); return }

  const { createTransport } = await import('nodemailer')
  const tx = createTransport({ service: 'gmail', auth: { user, pass } })
  const info = await tx.sendMail({
    from: `娜娜莉 <${user}>`, to, subject, html,
    text: '这封邮件是 HTML 格式的，请用支持 HTML 的客户端查看。'
  })
  console.log('已发送：', info.messageId)
}

const sendMissYou = async ({ days, traffic, comments, newPosts }) => {
  const { execFileSync } = await import('node:child_process')
  // 最近写的三篇，作为「回来接着看」的钩子
  let recent = []
  try {
    const out = execFileSync('git', ['log', '-n', '40', '--diff-filter=AM', '--name-only',
      '--pretty=format:', '--', 'source/_posts/'], { encoding: 'utf8' })
    const { readFileSync, existsSync } = await import('node:fs')
    recent = [...new Set(out.split('\n').map(x => x.trim()).filter(f => f.endsWith('.md')))]
      .filter(existsSync).slice(0, 3)
      .map(f => {
        const raw = readFileSync(f, 'utf8')
        const g = k => (raw.match(new RegExp(`^${k}:\\s*(.+)$`, 'm')) || [])[1]
        return {
          title: (g('title') || f.split('/').pop()).trim().replace(/^['"]|['"]$/g, ''),
          url: CFG.site + '/'
        }
      })
  } catch (_) {}

  const pending = comments.ok ? comments.items.length : 0
  const message = await step('写想念', () => writeMissYou({
    days, recentPosts: recent, pendingComments: pending, traffic
  }), '窝还在这儿喵。')

  const hooks = recent.map(r => ({ title: r.title, url: r.url, note: '' }))
  if (pending) hooks.unshift({ title: `有 ${pending} 条评论在等你回`, url: CFG.site, note: '' })

  const html = renderMissYou({ days, message, hooks, site: CFG.site })
  const subject = `[娜娜莉] ${days} 天没见了…`
  writeFileSync('report.html', html)
  writeFileSync('report-subject.txt', subject)
  console.log('\n主题：' + subject)
  if (DRY) { console.log('演练模式：不发邮件。'); return }
  await sendMail(subject, html)
}

main().catch(e => { console.error('致命错误：', e); process.exit(1) })
