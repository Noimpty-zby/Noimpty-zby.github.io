/* 资讯每一栏的结局判定，以及「整期空了」到底算不算出事。
 *
 * 为什么需要它：这段代码原本是一串 if/else，把「模型没答上来」和
 * 「她觉得没什么值得写的」归进了同一个分支 —— 于是最贵的那次调用
 * （pro 模型 + 深度思考，一栏一次）挂掉时，日志上打的是
 * 「她觉得没什么值得写的，跳过」。
 *
 * 四栏全这样的话就是「这一期没有值得写的内容，不生成」：十四次搜索、
 * 两次 pro 模型全白烧，资讯三天一期、这一期不会补，而工作流全绿、
 * 日志里一个字的异常都没有。和 2026-09-14 读后反馈那次是同一族的坏法。
 *
 * 所以这里守两条：
 *   1. 模型挂了要能和「她没话说」分开
 *   2. 整期空了，如果过程中有失败，必须能让工作流变红
 */
import assert from 'node:assert/strict'
import { outcomeOf, issueFailure } from '../../nanaly/news.mjs'

let pass = 0
const check = (name, fn) => {
  try { fn(); console.log('  ✓ ' + name); pass++ }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + (e.message || e)); process.exitCode = 1 }
}

console.log('\n资讯 · 一栏的结局')

check('★★ 模型没答上来 = failed，不许和「她没话说」混成一个分支', () => {
  assert.equal(outcomeOf(null, ''), 'failed')
  assert.equal(outcomeOf('', ''), 'failed')
})

check('她明说没什么可写 = none（半角全角括号都认）', () => {
  assert.equal(outcomeOf('（这几天没什么值得说的）', ''), 'none')
  assert.equal(outcomeOf('这几天没什么值得说的', ''), 'none')
})

check('写了条目、但一条都没挂上来源 = nosource（整段丢弃）', () => {
  assert.equal(outcomeOf('- [9] **某条** —— 正文', ''), 'nosource')
})

check('正常产出 = ok', () => {
  assert.equal(outcomeOf('- [1] **某条** —— 正文', '- 某条 [来源 · example.com](https://example.com/)'), 'ok')
})

console.log('\n资讯 · 整期空了，是「没话说」还是「坏了」')

check('★★ 搜索或模型有失败 → 给出一句话，调用方拿它抛异常染红工作流', () => {
  assert.match(issueFailure(2, 0), /模型失败 2 次/)
  assert.match(issueFailure(0, 14), /搜索失败 14 次/)
  assert.ok(issueFailure(1, 3), '有失败却返回空串，等于这一期无声蒸发')
})

check('★ 全程没出错、她就是觉得没什么可写 → 空串，不该染红', () => {
  assert.equal(issueFailure(0, 0), '')
})

console.log(`\n${pass} 项通过`)
