/* 批注表的孤儿清理测试。
 *
 * 为什么需要它：批注是按永久链接存的，而永久链接由 front-matter 的 date 生成。
 * 改一次文章日期，那篇的批注就贴不回去了 —— 线上发生过一次（作业二从 8-15
 * 改到 8-20，2 条批注失效），不报错、不影响构建，只有去数条数才看得出来。
 *
 * 清理这件事本身又比它要解决的问题更危险：判断条件写错一点，
 * 删掉的就是整张表，而且是不可逆的。所以这里守的是「什么不能被删」，
 * 尤其是那条最容易写错的 —— 全站上锁之后每篇文章都带 privacy: protected，
 * 一旦拿 privacy 去筛「还活着的文章」，整张表会一次清空。
 */
import assert from 'node:assert/strict'
import { pathOf, planNotes, pruneOrphans } from '../nanaly/notes.mjs'

let pass = 0
const check = (name, fn) => {
  try { fn(); console.log('  ✓ ' + name); pass++ }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + (e.message || e)); process.exitCode = 1 }
}

const post = (date, extra = '') =>
  `---\ntitle: 随便什么标题\ndate: ${date}\n${extra}---\n\n正文。`

const noteFor = title => ({ hash: 'deadbeef', title, notes: [{ anchor: '某段开头', text: '某条批注' }] })

console.log('\n娜娜莉批注 · 路径推导')

check('从文件名和 date 推出永久链接', () => {
  assert.equal(
    pathOf('source/_posts/homework-three.md', post('2026-07-20 21:25:04')),
    '/2026/07/20/homework-three/')
})

check('没有 date 的文章推不出路径，返回 null', () => {
  assert.equal(pathOf('source/_posts/x.md', '---\ntitle: 没日期\n---\n正文。'), null)
})

console.log('\n娜娜莉批注 · 哪些文章算「还活着」')

check('★★ 上锁的文章不写新批注，但必须算「还活着」', () => {
  const files = [{ file: 'source/_posts/Geometry.md', raw: post('2026-07-22 15:09:02', 'privacy: protected\n') }]
  const { live, todo } = planNotes(files, {})
  assert.ok(live.has('/2026/07/22/Geometry/'), '上锁的文章没被算进 live —— 它的批注会被当孤儿删掉')
  assert.equal(todo.length, 0, '上锁的文章不该被排进「要写批注」')
})

check('★★ 整站都上锁时，live 不能是空集', () => {
  const files = [
    { file: 'source/_posts/a.md', raw: post('2026-07-22 10:00:00', 'privacy: protected\n') },
    { file: 'source/_posts/b.md', raw: post('2026-08-11 10:00:00', 'privacy: protected\n') }
  ]
  const { live } = planNotes(files, {})
  assert.equal(live.size, 2, '全站上锁之后 live 空了 —— 接下来那一步会清掉整张批注表')
})

check('正文没变过的文章不重复写批注', () => {
  const raw = post('2026-07-22 15:09:02')
  const { todo: first } = planNotes([{ file: 'source/_posts/a.md', raw }], {})
  assert.equal(first.length, 1)
  const store = { '/2026/07/22/a/': { hash: first[0].hash, title: 't', notes: [] } }
  const { todo: again } = planNotes([{ file: 'source/_posts/a.md', raw }], store)
  assert.equal(again.length, 0)
})

check('推不出路径的文章被记进 unresolved，而不是悄悄算作不存在', () => {
  const files = [{ file: 'source/_posts/x.md', raw: '---\ntitle: 没日期\n---\n正文。' }]
  const { live, unresolved } = planNotes(files, {})
  assert.equal(unresolved, 1)
  assert.equal(live.size, 0)
})

console.log('\n娜娜莉批注 · 清孤儿')

check('★★ 改过日期的文章，旧路径那条被清掉', () => {
  const store = {
    '/2026/08/15/UE5-ActionRoguelike-Assignment2/': noteFor('作业二（旧日期）'),
    '/2026/07/22/Geometry/': noteFor('几何')
  }
  const live = new Set(['/2026/08/20/UE5-ActionRoguelike-Assignment2/', '/2026/07/22/Geometry/'])
  assert.deepEqual(pruneOrphans(store, live), ['/2026/08/15/UE5-ActionRoguelike-Assignment2/'])
  assert.deepEqual(Object.keys(store), ['/2026/07/22/Geometry/'], '把不该删的也删了')
})

check('★★ 路径全对得上时，一条都不许动', () => {
  const store = { '/2026/07/22/Geometry/': noteFor('几何'), '/2026/07/19/shading-1/': noteFor('着色') }
  const live = new Set(Object.keys(store))
  assert.deepEqual(pruneOrphans(store, live), [])
  assert.equal(Object.keys(store).length, 2)
})

check('空表不炸', () => {
  const store = {}
  assert.deepEqual(pruneOrphans(store, new Set(['/2026/07/22/Geometry/'])), [])
  assert.deepEqual(store, {})
})

console.log(`\n${pass} 项通过`)
