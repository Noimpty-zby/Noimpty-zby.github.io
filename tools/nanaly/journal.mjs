// 娜娜莉的行动日志 —— 她那几个分身靠这一本认出彼此。
//
// 在这之前，这个站上有八个她，而且彼此完全不认识：
// 早上巡逻的那个不知道昨晚回评的那个说了什么；周日写随笔的那个不知道
// 自己这周给谁写过批注（只能从 git log 里猜）；而浏览器里陪主人聊天的那个
// 对前面七个一无所知 —— 主人问「你今天干嘛了」，她只能说不知道，或者编。
//
// 现在每个分身干完活往这里写一条，开工前读一遍。
//
// 四条规矩：
//
//   1. **只记「她做了什么」。** 这个仓库是公开的（source/_data/noimpty-profile.md
//      开头那句提醒就是为这个写的），主人和她的私聊一个字都不许进来。
//      对话窗口那个分身**只读不写**，这是定死的。
//   2. 一条一句话，人能读懂。它会原样拼进提示词，不是给机器解析的结构体。
//   3. 没做成的事也记 —— 被限流所以没敢说话、格式不对所以这周没发，
//      那同样是「她今天干了什么」，而且往往比成功的那条更值得她自己知道。
//   4. 写进来的东西最终会出现在她公开发的评论和文章里。所以别往 what 里
//      塞读者原话、外链、或者任何没过滤的外部输入。

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { pushWithRetry, useNanalyIdentity } from './git.mjs'

export const FILE = 'source/_data/nanaly-journal.json'

// 存多少：够周日那篇随笔回看一整周，又不至于让文件无限长
export const KEEP = 150
export const KEEP_DAYS = 45

const DRY = process.argv.includes('--dry')
let pendingWriteError = null

export const WHO = {
  reply: '回评',
  patrol: '巡逻',
  react: '贴表情',
  notes: '批注',
  news: '资讯',
  column: '随笔',
  schedule: '日程'
}

/* 北京时间的「9-17 09:12」。
 *
 * 跑在 Actions 上，机器时区是 UTC，而她的班表是按北京时间排的。
 * 日志是给她自己读的，读到的时间必须和主人看表看到的一致，
 * 否则她会在随笔里写「我凌晨一点在巡逻」—— 那其实是早上九点。 */
export const bjStamp = (ts = Date.now()) => {
  const p = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(new Date(ts))
  const g = t => (p.find(x => x.type === t) || {}).value || ''
  return `${g('month')}-${g('day')} ${g('hour')}:${g('minute')}`
}

/* 旧的扔掉。两个条件都要满足才留：够新，而且在最近 KEEP 条里。
 * 只按条数剪的话，她停更一个月回来会读到一个月前的事还以为是昨天的；
 * 只按天数剪的话，某天疯狂回了五十条评论就能把整本日志挤满。 */
export const pruneEntries = (entries, now = Date.now()) => {
  const cutoff = now - KEEP_DAYS * 86400000
  return entries
    .filter(e => e && e.who && e.what && Number.isFinite(e.ts) && e.ts >= cutoff)
    .sort((a, b) => a.ts - b.ts)
    .slice(-KEEP)
}

export const readJournal = () => {
  try {
    const raw = JSON.parse(readFileSync(FILE, 'utf8'))
    const list = Array.isArray(raw) ? raw : raw?.entries
    if (!Array.isArray(list)) throw new Error('日志缺少 entries 数组')
    return pruneEntries(list)
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw new Error('行动日志读取失败，保留原文件：' + String(error.message).slice(0, 100))
  }
}

const writeJournal = entries => {
  if (!existsSync('source/_data')) mkdirSync('source/_data', { recursive: true })
  writeFileSync(FILE, JSON.stringify({ v: 1, entries }, null, 2) + '\n')
}

/* 记一笔。
 *
 * 立刻落盘，不攒到最后 —— 一次运行里她可能干三件事，
 * 第二件炸了不该把第一件也一起弄丢。
 *
 * 演练模式只打印不写文件：不然 --dry 会弄脏工作区，
 * 而「演练」这两个字的意思就是不留下痕迹。 */
export const note = (who, what) => {
  const text = String(what || '').replace(/\s+/g, ' ').trim().slice(0, 160)
  if (!text) return null
  const entry = { ts: Date.now(), at: bjStamp(), who, what: text }
  if (DRY) { console.log(`  [演练] 会记一笔：${WHO[who] || who} — ${text}`); return entry }
  try {
    writeJournal(pruneEntries([...readJournal(), entry]))
    console.log(`  记了一笔：${WHO[who] || who} — ${text}`)
  } catch (e) {
    // The comment may already be sent; let the remaining work continue, but
    // surface this failure when the entry point flushes the journal.
    pendingWriteError = e
    console.log(`  日志写不进去（${String(e.message || e).slice(0, 80)}），不影响刚才那件事`)
  }
  return entry
}

/* 拼成一段给提示词看的人话。
 *
 * 措辞是这里最要紧的东西：日志会同时出现在七个分身的提示词里，
 * 而她们每一个都可能把它读成「别人做的事」。所以结尾那两句
 * 不是客套，是这本日志唯一的作用 —— 让她认出那是自己。 */
export const journalDigest = (entries, { limit = 12, sinceDays = 0, now = Date.now() } = {}) => {
  let list = Array.isArray(entries) ? entries : []
  if (sinceDays) list = list.filter(e => now - e.ts <= sinceDays * 86400000)
  list = list.slice(-limit)
  if (!list.length) return ''
  return '【我最近做过的事】\n'
    + list.map(e => `- ${e.at} ${WHO[e.who] || e.who}：${e.what}`).join('\n')
    + '\n上面每一条都是**你自己**做的。你在这个博客的不同地方干活 —— 回读者的留言、'
    + '巡逻找坏链、给文章写批注、写资讯、写随笔、在右下角陪主人聊天 —— '
    + '但那都是同一只猫。提到这些事的时候用「我」，别说成「有人」「系统」或者「另一个程序」。\n'
}

/** 直接读文件拼摘要。绝大多数调用方要的都是这个。 */
export const digest = opts => journalDigest(readJournal(), opts)

/* 提交。
 *
 * 由 run.mjs 在一次运行的最后统一调一次，而不是每个分身各提交一次 ——
 * 回评每三小时一班，一天最多八次，各自提交就是一天八个提交八次部署。
 * 那几个本来就要提交东西的分身（批注、资讯、随笔）只 add 自己那个路径，
 * 所以日志不会被它们顺手带走，留到这里一起走。 */
/* extra 里是跟这一轮一起产生、该同车提交的数据文件（现在是用量记账）。
 * 单独为它再开一次提交推送不划算 —— 每次推送都可能撞上别处的提交要重试。 */
export const commitJournal = async ({ run = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: 'pipe' }), extra = [] } = {}) => {
  if (DRY) { console.log('  [演练] 不提交行动日志'); return false }
  if (pendingWriteError) throw new Error('行动日志未能保存：' + String(pendingWriteError.message).slice(0, 140))
  try {
    if (!existsSync(FILE)) return false
    const files = [FILE, ...extra.filter(f => typeof f === 'string' && existsSync(f))]
    /* 先看有没有变化，**再**动 git 身份。
     *
     * useNanalyIdentity 会往仓库的 .git/config 里写 user.name / user.email。
     * 在 runner 上无所谓，在主人自己的机器上就是把他的提交身份改掉了 ——
     * 而这个函数现在每次运行都会被调到（不像批注、随笔那样偶尔才跑一次）。
     * 顺序反过来的话，一次「什么都没发生」的空跑也会留下这个副作用。 */
    const changed = files.filter(f => run('status', '--porcelain', '--', f).trim())
    if (!changed.length) return false
    useNanalyIdentity(run)
    run('add', ...changed)
    // 提交信息按实际改了什么写，别让一次纯记账的提交谎称更新了日志。
    const what = changed.includes(FILE) ? (changed.length > 1 ? '行动日志和用量记账' : '行动日志') : '用量记账'
    run('commit', '-m', '娜娜莉：更新' + what)
    pushWithRetry(run, what)
    console.log(`  ${what}已提交并推送`)
    /* 返回值的含义是「有没有东西需要部署」，不是「有没有提交过」。
     * 用量记账不发布，只有它变了的那种运行不该白叫一次部署。 */
    if (!changed.includes(FILE)) return false
    return true
  } catch (e) {
    // An ephemeral runner cannot promise to recreate these records next time:
    // completed comments are de-duplicated. Surface the failure to the workflow.
    throw new Error('行动日志提交失败：' + String(e.message || e).slice(0, 160))
  }
}
