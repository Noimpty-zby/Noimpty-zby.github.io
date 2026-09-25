/* 自动回评该对谁开口。
 *
 * 她开口之前要过三关：满了冷静期、主人还没回、她自己也没回。
 * 但在这三关之前还有一道没人注意的筛子 —— 「这个讨论归不归她管」。
 * 那道筛子原来只认 /^\d{4}\// 开头的文章页，于是资讯页（/news/2026-09-16/）
 * 整页被跳过：那几页明明开着 comments: true，读者在那儿留言她永远不接手，
 * 而日报里却看得见那条评论（getComments 不按路径过滤）—— 两边对不上，
 * 而且没有任何日志会提到「有条评论被整页跳过了」。
 *
 * 这个文件同时守住那道筛子和后面三关。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

process.env.OWNER_LOGIN = 'noimpty-zby'
process.env.NANALY_REPLY_GRACE_HOURS = '4'
const { isReplyable, collect } = await import('../../nanaly/reply.mjs')
const { SIGN, marker } = await import('../../nanaly/github.mjs')

let pass = 0
const check = (name, fn) => {
  try { fn(); console.log('  ✓ ' + name); pass++ }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + (e.message || e)); process.exitCode = 1 }
}

const ago = h => new Date(Date.now() - h * 3600000).toISOString()
const comment = (who, hours, extra = {}) => ({
  id: extra.id || 'C-' + who + hours,
  author: { login: who },
  body: extra.body || '这里有个地方没看懂，能再讲讲吗',
  createdAt: ago(hours),
  replies: { nodes: extra.replies || [] }
})
const disc = (title, comments) => ({ id: 'D-' + title, title, comments: { nodes: comments } })

console.log('\n回评 · 哪些页面归她管')

check('★★ 资讯页归她管（它开着评论，以前整页被跳过）', () => {
  assert.equal(isReplyable('news/2026-09-16/'), true)
  const got = collect([disc('news/2026-09-16/', [comment('读者甲', 10)])])
  assert.equal(got.length, 1, '资讯页下面的留言又被整页跳过了')
})

check('文章页和她自己的随笔照常归她管', () => {
  assert.equal(isReplyable('2026/09/14/DSA-Chapter2-Recursion/'), true)
  assert.equal(isReplyable('/2026/09/13/nanaly-2026-w37/'), true)
})

check('没有评论区的页面不归她管', () => {
  assert.equal(isReplyable('categories/life/'), false)
  assert.equal(isReplyable('about/'), false)
  assert.equal(isReplyable(''), false)
  assert.equal(isReplyable(null), false)
})

console.log('\n回评 · 开口前的三关')

check('冷静期没过 → 先让主人有机会自己回（这里按 4 小时跑）', () => {
  assert.equal(collect([disc('2026/09/14/x/', [comment('读者甲', 3)])]).length, 0)
  assert.equal(collect([disc('2026/09/14/x/', [comment('读者甲', 5)])]).length, 1)
})

check('主人自己发的评论不用回', () => {
  assert.equal(collect([disc('2026/09/14/x/', [comment('Noimpty-zby', 10)])]).length, 0)
})

check('主人已经回过了就别插嘴', () => {
  const c = comment('读者甲', 10, { replies: [{ author: { login: 'noimpty-zby' }, body: '我来答' }] })
  assert.equal(collect([disc('2026/09/14/x/', [c])]).length, 0)
})

check('★ 她自己留的言不会被当成读者提问（巡逻发的是顶楼评论）', () => {
  const her = comment('随便谁', 10, { body: '我路过这篇，有几个链接坏了喵' + SIGN })
  assert.equal(collect([disc('2026/09/14/x/', [her])]).length, 0)
})

check('★ 她已经回过的那条不再回第二遍', () => {
  const c = comment('读者甲', 10, { id: 'C9', replies: [{ author: { login: '娜娜莉' }, body: '我先答一下' + marker('reply', 'C9') }] })
  assert.equal(collect([disc('2026/09/14/x/', [c])]).length, 0)
})

check('机器人和已注销用户的评论跳过', () => {
  assert.equal(collect([disc('2026/09/14/x/', [comment('github-actions[bot]', 10)])]).length, 0)
  assert.equal(collect([disc('2026/09/14/x/', [{ ...comment('x', 10), author: null }])]).length, 0)
})

check('多条一起来时，按时间从旧到新排（挂得最久的先答）', () => {
  const got = collect([disc('2026/09/14/x/', [
    comment('读者乙', 8, { id: 'new' }),
    comment('读者甲', 30, { id: 'old' })
  ])])
  assert.deepEqual(got.map(g => g.comment.id), ['old', 'new'])
})

console.log('\n回评 · 班次和冷静期是一起算的')

/* 这一节守的是一笔账，不是一段逻辑。
 *
 * 一条评论等的是「冷静期结束之后的第一班」，所以最坏等待 = 冷静期 + 一班间隔。
 * 上一版把班次调成和冷静期同步（都是 6 小时），理由是「同步之后就没有空跑」——
 * 那恰恰是最差的搭配，最坏要等 12 小时才有人理，而省下的不过是几次
 * 几十秒的空跑。两个数分别写在工作流和代码里，谁也看不见谁，很容易再走回去。 */
const yml = readFileSync(join(process.cwd(), '.github/workflows/nanaly.yml'), 'utf8')
const code = readFileSync(join(process.cwd(), 'tools/nanaly/reply.mjs'), 'utf8')
const every = Number((yml.match(/- cron: '(?:\d+) \*\/(\d+) \* \* \*'/) || [])[1])
const minute = Number((yml.match(/- cron: '(\d+) \*\/\d+ \* \* \*'/) || [])[1])
const grace = Number((yml.match(/NANALY_REPLY_GRACE_HOURS: '(\d+)'/) || [])[1])
const dflt = Number((code.match(/NANALY_REPLY_GRACE_HOURS \?\? (\d+)/) || [])[1])

check('★★ 最坏等待 = 冷静期 + 一班间隔，不许超过 8 小时', () => {
  assert.ok(every > 0 && grace > 0, `没从工作流里读出班次(${every})和冷静期(${grace})`)
  assert.ok(grace + every <= 8,
    `最坏要等 ${grace + every} 小时（冷静期 ${grace} + 班次 ${every}）—— 调一个就得重算另一个`)
})

check('冷静期别压到没有，那是留给主人自己先回的时间', () => {
  assert.ok(grace >= 2, `冷静期只剩 ${grace} 小时，主人还没看见就被她抢答了`)
})

check('★ 代码里的默认值和工作流里配的是同一个数', () => {
  assert.equal(dflt, grace, '不一致的话，本地演练算出来的「该接手几条」和线上不是一回事')
})

check('回评的班次错开整点 —— 整点最挤，这个仓库实测迟过 3 到 5 小时', () => {
  assert.ok(minute > 0, '又排回整点了')
})

console.log(`\n${pass} 项通过`)
