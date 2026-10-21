/* 她写完随笔和资讯以后那一道「数 AI 腔、让她改一次」（tools/nanaly/tone.mjs）。
 * 2026-10-21 他说「小猫不说人话了」，量下来破折号每千字 3 到 6 个，他自己的文章是 0。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { toneIssues, polish } from '../../nanaly/tone.mjs'

const W42 = '这个动作我很欣赏——很多人用 Git 用到熟练，却从没低头看过那个文件夹。'
  + '说穿了很单调：更新批注，发资讯速览。'
  + '真正的壁垒不是技术，而是认知。'

await test('抓得到破折号、对举句和套话开头', () => {
  const kinds = toneIssues(W42).map(it => it.kind)
  assert.deepEqual(kinds, ['破折号', '套话开头', '对举句'])
})

await test('正常的句子、「是不是」和代码里的破折号不算', () => {
  assert.equal(toneIssues('这个是最简单的，一个 for 循环就搞定了。是不是很方便？').length, 0)
  assert.equal(toneIssues('它不是 O(1)。').length, 0, '单独的否定不是对举')
  assert.equal(toneIssues('运行 `ls --all` 看看。\n```\necho —\n```').length, 0)
})

await test('资讯条目的编号和加粗标题不挡住套话开头', () => {
  const issues = toneIssues('- [3] **某公司裁员**。说到底还是钱的问题。')
  assert.equal(issues.length, 1)
  assert.equal(issues[0].kind, '套话开头')
})

await test('没毛病就不调用模型', async () => {
  let calls = 0
  const text = '这周主人把 Git 学完了。'
  assert.equal(await polish(text, async () => { calls++; return 'x' }), text)
  assert.equal(calls, 0)
})

await test('改好了就用改稿，提示词里带着要改的那几句', async () => {
  let prompt = ''
  const fixed = '这个动作我很欣赏，很多人用 Git 用到熟练，却从没低头看过那个文件夹。'
    + '这一周很单调，更新批注，发资讯速览。'
    + '真正的壁垒是认知。'
  const out = await polish(W42, async (system, user) => { prompt = user; return fixed })
  assert.equal(out, fixed)
  assert.match(prompt, /很多人用 Git 用到熟练/)
  assert.match(prompt, /破折号/)
})

await test('改坏了就照发原稿：截断、毛病没少、keep 不认', async () => {
  assert.equal(await polish(W42, async () => '很短'), W42, '截断的改稿不能用')
  assert.equal(await polish(W42, async () => W42), W42, '毛病一处没少')
  assert.equal(await polish(W42, async () => null), W42, '模型没返回')
  const fixed = W42.replace('——', '，').replace('说穿了', '其实').replace('不是技术，而是', '是')
  assert.equal(await polish(W42, async () => fixed, { keep: () => false }), W42, 'keep 不认就不用')
})
