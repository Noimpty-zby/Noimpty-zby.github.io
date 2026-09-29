import { randomUUID } from 'node:crypto'
import { readPrivateContent, appendPrivateContent, flushPrivateContent } from '../private-content-client.mjs'

export const FILE = 'journal' // Logical backend record; never a repository path.

// 存多少：够周日那篇随笔回看一整周，又不至于让文件无限长
export const KEEP = 150
export const KEEP_DAYS = 45

const DRY = process.argv.includes('--dry')

export const WHO = {
  reply: '回评',
  patrol: '巡逻',
  react: '贴表情',
  notes: '批注',
  news: '资讯',
  column: '随笔',
  schedule: '日程',
  report: '日报'
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
  const raw = readPrivateContent('journal')
  return pruneEntries(Array.isArray(raw) ? raw : raw.entries)
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
  const entry = { id: randomUUID(), ts: Date.now(), at: bjStamp(), who, what: text }
  if (DRY) { console.log('  [演练] 会增加一条私密行动记录'); return entry }
  appendPrivateContent('journal', entry, pruneEntries)
  console.log('  已暂存一条私密行动记录')
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
export const digest = (opts = {}) => journalDigest(readJournal().filter(entry => opts.private === true || entry.publicAllowed === true), opts)

// Flush pending additions against the latest backend revision; private records
// never enter git or trigger a static-site deployment.
export const commitJournal = async () => {
  if (DRY) return false
  return flushPrivateContent('journal')
}
