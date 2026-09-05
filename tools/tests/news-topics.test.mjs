/* 资讯搜什么，必须跟着主人现在的方向走。
 *
 * 为什么需要它：2026-08-26 主人从「游戏客户端」转到「AI Infra / 后端」，
 * 当天就改了 source/_data/noimpty-profile.md —— 但 news.mjs 里那张 TOPICS
 * 表没人动，还留着「游戏客户端 面试 真题 UE C++ 八股 面经」这种查询。
 *
 * 后果是 profile 根本救不了：它只能让她把捞回来的东西**筛掉**，
 * 捞的动作还是照 TOPICS 搜。而每个主题的 angle 又紧跟在 profile 后面进提示词，
 * 里面白纸黑字写着「他的目标是游戏客户端开发」—— 于是她照办了。
 * 2026-09-04 那期三条全是米哈游 C++ 面经和多益的游戏客户端岗，
 * 十四次搜索加两次 pro 模型的钱全白花，而且一路全绿，没有任何东西会报警。
 *
 * 所以这里钉两条：
 *   1. 搜索词里不许出现已经放弃的方向（angle 不管 —— 那里面的「别选游戏」是对的）
 *   2. 栏目页上写的四个栏目名，要和代码里真正会搜的对得上
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { TOPICS } from '../nanaly/news.mjs'

let pass = 0
const check = (name, fn) => {
  try { fn(); console.log('  ✓ ' + name); pass++ }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + (e.message || e)); process.exitCode = 1 }
}

console.log('\n资讯搜索词 · 跟着现在的方向')

// profile 里 ❌ 那一栏点名的、已经放弃的方向
const DROPPED = ['游戏', 'UE5', 'Unreal', '图形学', '客户端', 'gameplay', 'game client']

check('★★ 搜索词里没有已经放弃的方向', () => {
  const bad = []
  for (const t of TOPICS) {
    for (const q of t.queries || []) {
      const hit = DROPPED.filter(w => q.toLowerCase().includes(w.toLowerCase()))
      if (hit.length) bad.push(`${t.key} → 「${q}」命中 ${hit.join('、')}`)
    }
  }
  assert.deepEqual(bad, [], '这些查询还在搜已经放弃的方向，捞回来的东西只会被筛掉，钱白花：\n      ' + bad.join('\n      '))
})

check('★★ 每个主题都有查询和角度，不会空搜', () => {
  for (const t of TOPICS) {
    assert.ok(t.queries?.length, `${t.key} 没有任何搜索词`)
    assert.ok(String(t.angle || '').trim().length > 40, `${t.key} 的 angle 太短，等于没给方向`)
    assert.ok(t.want > 0 && t.minWords > 0, `${t.key} 的 want / minWords 不对`)
  }
})

check('★★ 栏目页上写的栏目名和代码里的一致', () => {
  const page = readFileSync('source/news/index.md', 'utf8')
  const missing = TOPICS.map(t => t.title).filter(title => !page.includes(title))
  assert.deepEqual(missing, [], '这些栏目在 source/news/index.md 上没写（或者写的是旧名字）：' + missing.join('、'))
})

check('主人的方向说明还在，她搜之前读得到', () => {
  const profile = readFileSync('source/_data/noimpty-profile.md', 'utf8')
  assert.ok(profile.includes('AI Infra'), 'profile 里找不到现在的方向')
  assert.ok(/❌.*游戏/.test(profile), 'profile 里应该明确把游戏行业列进不要的那一栏')
})

console.log(`\n${pass} 项通过`)
