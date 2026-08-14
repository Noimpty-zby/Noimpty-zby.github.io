/* 点子模块的测试。
 *
 * 这块的产物会自动写进私有仓库、无人复核，而主人明确说过
 * 「找一堆没用的东西就完蛋了」。所以要证明的全是「该不写的时候真的不写」：
 *
 *   - 方案太空抽不出具体问题 → 根本不去搜（否则只会搜回一堆推荐榜）
 *   - 她说「没找到」→ 什么都不发（交白卷是合格输出）
 *   - 输出格式坏掉 → 整篇丢掉，不发一篇坏的
 *   - 正文太短 → 说明没想清楚，丢掉
 *   - 角标 [3] 换成真链接；编号是编的就删掉，不留死引用
 */
import assert from 'node:assert/strict'
import { join } from 'node:path'

const { parseIdea, attachRefs, parsePlan } =
  await import('file://' + join(process.cwd(), 'tools/nanaly/ideas.mjs'))

let pass = 0
const check = (name, fn) => {
  try { fn(); console.log('  ✓ ' + name); pass++ }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + (e.message || e)); process.exitCode = 1 }
}

const LONG = '正文'.repeat(200)

console.log('\n点子：解析模型输出')

check('★ 正常格式：标题、星级、正文都拿到', () => {
  const r = parseIdea(`标题：把敌人的技能抢过来\n参考指数：4\n===正文===\n${LONG}`)
  assert.equal(r.title, '把敌人的技能抢过来')
  assert.equal(r.stars, 4)
  assert.ok(r.body.startsWith('正文'))
})

check('★ 她交白卷 → skip，不发', () => {
  assert.equal(parseIdea('（这次没找到值得说的）').skip, true)
  assert.equal(parseIdea('这次没找到值得说的').skip, true)
  assert.equal(parseIdea('（这轮没什么可写的）').skip, true)
})

check('★ 缺正文分隔符 → 整篇丢掉', () => {
  assert.equal(parseIdea(`标题：x\n参考指数：4\n${LONG}`), null)
})

check('★ 缺标题或星级 → 整篇丢掉', () => {
  assert.equal(parseIdea(`参考指数：4\n===正文===\n${LONG}`), null)
  assert.equal(parseIdea(`标题：x\n===正文===\n${LONG}`), null)
})

check('★ 正文太短（说明没想清楚）→ 丢掉', () => {
  assert.equal(parseIdea('标题：x\n参考指数：5\n===正文===\n就这么点'), null)
})

check('星级越界会被夹回 1–5', () => {
  assert.equal(parseIdea(`标题：x\n参考指数：9\n===正文===\n${LONG}`).stars, 5)
  assert.equal(parseIdea(`标题：x\n参考指数：0\n===正文===\n${LONG}`).stars, 1)
})

check('半角冒号、书名号包裹的标题都认', () => {
  const r = parseIdea(`标题:《武器形态切换》\n参考指数: 3\n===正文===\n${LONG}`)
  assert.equal(r.title, '武器形态切换')
  assert.equal(r.stars, 3)
})

check('空输入 / 垃圾输入 → null，不炸', () => {
  assert.equal(parseIdea(''), null)
  assert.equal(parseIdea(null), null)
  assert.equal(parseIdea('随便写点什么但没有格式'), null)
})

console.log('\n点子：角标换来源')

const HITS = [
  { title: '《哈迪斯》武器形态设计', url: 'https://a.example/hades' },
  { title: 'Roguelike 关卡生成', url: 'https://b.example/gen' },
  { title: 'UE5 GAS 入门', url: 'https://c.example/gas' }
]

check('★ [0] 换成真链接，并在文末列出来源', () => {
  const out = attachRefs('武器有四种形态 [0]，这一点很关键。', HITS)
  assert.ok(out.includes('](https://a.example/hades)'), '没挂上链接')
  assert.ok(out.includes('### 参考来源'), '没有来源清单')
  assert.ok(out.includes('《哈迪斯》武器形态设计'), '来源标题没写进去')
})

check('★ 编号对不上（她编的）→ 角标直接删掉，不留死引用', () => {
  const out = attachRefs('这个说法来自 [99]。', HITS)
  assert.ok(!out.includes('99'), '编造的角标还在')
  assert.ok(!out.includes('参考来源'), '一个有效来源都没有时不该有来源清单')
})

check('★ 她自己写的站外链接和裸网址被清掉', () => {
  const out = attachRefs('看 [这里](https://spam.example/x) 或 https://spam.example/y [1]', HITS)
  assert.ok(!out.includes('spam.example'), '她写的网址还在')
  assert.ok(out.includes('b.example'), '正经来源丢了')
})

check('HTML 标签被钝化', () => {
  const out = attachRefs('<img src=x onerror=alert(1)> [2]', HITS)
  assert.ok(!/<img/i.test(out))
  assert.ok(out.includes('&lt;img'))
})

check('同一个编号出现多次只列一条来源', () => {
  const out = attachRefs('前面说 [0]，后面又说 [0]。', HITS)
  assert.equal(out.split('### 参考来源')[1].trim().split('\n').filter(Boolean).length, 1)
})

console.log('\n点子：先想清楚要找什么')

check('★ 正常输出：待解问题和检索词都抽到', () => {
  const r = parsePlan(`待解问题
- 单局 3 分钟的节奏怎么安排才不会中段乏味
- 判定窗口给多宽才既有手感又不劝退新手

检索词
- 音游 判定窗口 容错 设计
- rhythm game difficulty curve design breakdown
- rhythm game input latency forgiveness
- 音游 节奏 编排 单局时长`)
  assert.equal(r.problems.length, 2)
  assert.equal(r.queries.length, 4)
  assert.ok(r.problems[0].includes('中段乏味'))
})

check('★ 方案太空 → 抽不出问题，返回 null（这时候去搜只会搜回一堆推荐榜）', () => {
  assert.equal(parsePlan('（方案太空，抽不出问题）'), null)
  assert.equal(parsePlan(''), null)
  assert.equal(parsePlan(null), null)
})

check('★ 有问题但检索词太少 → 也算失败，不硬着头皮搜', () => {
  assert.equal(parsePlan('待解问题\n- 一个具体问题\n\n检索词\n- 只有一条'), null)
})

check('只有检索词没有问题 → 失败（问题才是筛选的锚点）', () => {
  assert.equal(parsePlan('检索词\n- aaaa\n- bbbb\n- cccc\n- dddd'), null)
})

check('编号、星号、顿号开头的行都能正确剥掉前缀', () => {
  const r = parsePlan(`待解问题
1. 第一个具体问题写在这里
* 第二个具体问题写在这里

检索词
1) query one here
- query two here
* query three here`)
  assert.equal(r.problems[0], '第一个具体问题写在这里')
  assert.equal(r.queries.length, 3)
})

console.log(`\n${pass} 项通过`)
