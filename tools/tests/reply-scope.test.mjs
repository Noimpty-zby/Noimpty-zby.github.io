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

process.env.OWNER_LOGIN = 'noimpty-zby'
process.env.NANALY_REPLY_GRACE_HOURS = '6'
const { isReplyable, collect } = await import('../nanaly/reply.mjs')
const { SIGN, marker } = await import('../nanaly/github.mjs')

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

check('冷静期没过 → 先让主人有机会自己回', () => {
  assert.equal(collect([disc('2026/09/14/x/', [comment('读者甲', 2)])]).length, 0)
  assert.equal(collect([disc('2026/09/14/x/', [comment('读者甲', 7)])]).length, 1)
})

check('主人自己发的评论不用回', () => {
  assert.equal(collect([disc('2026/09/14/x/', [comment('Noimpty-zby', 10)])]).length, 0)
})

check('主人已经回过了就别插嘴', () => {
  const c = comment('读者甲', 10, { replies: [{ author: { login: 'noimpty-zby' }, body: '我来答' }] })
  assert.equal(collect([disc('2026/09/14/x/', [c])]).length, 0)
})

check('★ 她自己留的言不会被当成读者提问（巡逻发的是顶楼评论）', () => {
  const her = comment('随便谁', 10, { body: '窝路过这篇，有几个链接坏了喵' + SIGN })
  assert.equal(collect([disc('2026/09/14/x/', [her])]).length, 0)
})

check('★ 她已经回过的那条不再回第二遍', () => {
  const c = comment('读者甲', 10, { id: 'C9', replies: [{ author: { login: '娜娜莉' }, body: '窝先答一下' + marker('reply', 'C9') }] })
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

console.log(`\n${pass} 项通过`)
