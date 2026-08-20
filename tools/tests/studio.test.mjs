/* 策划室的决策逻辑测试。
 *
 * 这一段是整套东西的大脑：每次跑只做一件事，做哪件由优先级决定。
 * 它必须有测试，因为它错了不会报错 —— 只会表现为「她怎么老在探索，
 * 我的反馈她根本没理」，而这种问题要好几周才看得出来。
 *
 * 优先级（从高到低）：
 *   0. 主人直接点名要立哪个方向 → 立项
 *   1. 有实验跑出了真实结果      → 修订（一手数据优先）
 *   2. 某个项目该停了            → 停更评估
 *   3. 有反馈没处理              → 修订
 *   4. 文档没写完                → 深化
 *   5. 有够格的候选              → 立项
 *   6. 候选攒够了但都不够格      → 横向评比
 *   7. 什么都没有                → 探索
 *
 * 这一版新增的几组测试，每一组都对应一个**真实发生过的**故障：
 *   · 赛道去重      —— 第一轮扫出来的三个方向是同一个念头的三种说法
 *   · 短板封顶      —— 星级曾经是模型给自己打的信心分，拦不住任何东西
 *   · 评比解死锁    —— 十个候选无一上 4 星，系统永远在探索
 *   · 孤儿反馈      —— 挂在已停更项目上的反馈永远悬着，红点消不掉
 */
import assert from 'node:assert/strict'
import { decide, exploreRounds, exploreFile, candidateFingerprint, reviseTarget } from '../studio/run.mjs'
import {
  DOC_PLAN, nextDoc, docByFile, SYSTEM, parseAudit, auditPrompt,
  explorePrompt, postmortemPrompt, shortlistPrompt, parseShortlist,
  parseDirections, parseExperiments
} from '../studio/prompts.mjs'
import { rollup, dedupeLanes, parseLane, parseDims, mainOk, coldLanes, LANE_IDS } from '../studio/lanes.mjs'
import { forExplore, sections, showcaseSection } from '../studio/charterlens.mjs'
import { parseColumn } from '../nanaly/column.mjs'   // 只为确认 tools 之间没有循环 import

let pass = 0
const check = (name, fn) => {
  try { fn(); console.log('  ✓ ' + name); pass++ }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + (e.message || e)); process.exitCode = 1 }
}

const ALL_DOCS = DOC_PLAN.map(d => d.file)
const project = (over = {}) => ({
  id: 'P01-x', name: '测试项目', status: 'active', docs: ['00-pitch.md'], negativeStreak: 0, ...over
})
const state = (over = {}) => ({
  projects: [], candidates: [], rejected: [], recentActions: [], laneHistory: [], lastShortlist: '', ...over
})
const fb = (over = {}) => ({ id: 'fb1', project: 'P01-x', file: '00-pitch.md', verdict: '一般', note: 'x', handled: false, ...over })

/* 候选必须带 from（哪一轮探索产出的）—— 立项门槛靠它数轮数。
 * scanned() 给每个候选分配一个**不同**的轮次，也就是「已经扫够了」的状态；
 * sameRound() 把它们全塞进同一轮，用来测那道门拦不拦得住。 */
const scanned = (...cs) => cs.map((c, i) => ({ ...c, from: `explore/2026-01-0${i + 1}.md` }))
const sameRound = (...cs) => cs.map(c => ({ ...c, from: 'explore/2026-01-01.md' }))

console.log('\n策划室 · 决策优先级')

check('★ 什么都没有 → 探索', () => {
  assert.equal(decide({ state: state(), pending: [] }).kind, 'explore')
})

check('★ 有 4 星候选、且扫够了轮数 → 立项', () => {
  const s = state({
    candidates: scanned({ title: '甲', stars: 4 }, { title: '乙', stars: 5 }, { title: '丙', stars: 2 })
  })
  const p = decide({ state: s, pending: [] })
  assert.equal(p.kind, 'charter')
  assert.equal(p.candidate.title, '乙', '应该挑星级最高的那个')
})

check('候选都不够格（3 星以下）且数量还不多 → 继续探索', () => {
  const s = state({ candidates: scanned({ title: '甲', stars: 3 }, { title: '乙', stars: 2 }) })
  assert.equal(decide({ state: s, pending: [] }).kind, 'explore')
})

check('★★ 只扫过一轮 → 就算有 5 星候选也不立项，接着扫', () => {
  const s = state({ candidates: sameRound({ title: '甲', stars: 5 }, { title: '乙', stars: 4 }) })
  const p = decide({ state: s, pending: [] })
  assert.equal(p.kind, 'explore', '一轮里的几个方向常常是同一个念头的几种说法，没得挑')
  assert.match(p.why || '', /轮/, '要说清为什么这次不立项，否则日志里看不出是被门槛拦的')
})

check('★★ 扫够三轮 → 才放行立项', () => {
  const two = state({ candidates: scanned({ title: '甲', stars: 5 }, { title: '乙', stars: 4 }) })
  assert.equal(decide({ state: two, pending: [] }).kind, 'explore', '两轮还不够')
  const three = state({
    candidates: scanned({ title: '甲', stars: 5 }, { title: '乙', stars: 4 }, { title: '丙', stars: 3 })
  })
  assert.equal(decide({ state: three, pending: [] }).kind, 'charter', '三轮就该放行了')
})

check('轮数按 from 去重，不是按候选个数', () => {
  assert.equal(exploreRounds({ candidates: sameRound({ title: 'a' }, { title: 'b' }, { title: 'c' }) }), 1)
  assert.equal(exploreRounds({ candidates: scanned({ title: 'a' }, { title: 'b' }) }), 2)
  assert.equal(exploreRounds({ candidates: [] }), 0)
  assert.equal(exploreRounds({ candidates: [{ title: '老数据没有 from' }] }), 0, '老 state.json 里没有 from，按 0 算 —— 宁可多扫一轮')
})

check('★ 活跃项目已满（2 个）→ 不再立项，去深化', () => {
  const s = state({
    projects: [project({ id: 'A' }), project({ id: 'B' })],
    candidates: scanned({ title: '甲', stars: 5 }, { title: '乙', stars: 5 }, { title: '丙', stars: 5 })
  })
  assert.equal(decide({ state: s, pending: [] }).kind, 'expand')
})

check('★ 有立项、文档没写完 → 深化，先做文档最少的那个', () => {
  const s = state({
    projects: [
      project({ id: 'A', docs: ALL_DOCS.slice(0, 3) }),
      project({ id: 'B', docs: ['00-pitch.md'] })
    ]
  })
  const p = decide({ state: s, pending: [] })
  assert.equal(p.kind, 'expand')
  assert.equal(p.project.id, 'B', '应该先补落后最多的那个')
})

check('文档全写完了、也没别的事 → 回到探索', () => {
  const s = state({ projects: [project({ docs: ALL_DOCS })] })
  assert.equal(decide({ state: s, pending: [] }).kind, 'explore')
})

check('★★ 有反馈没处理 → 优先级高于深化', () => {
  const s = state({ projects: [project()] })
  const p = decide({ state: s, pending: [fb()] })
  assert.equal(p.kind, 'revise')
  assert.equal(p.items.length, 1)
})

check('★★ 主人说「停掉」→ 立刻停更评估，优先级高于修订', () => {
  const s = state({ projects: [project()] })
  const p = decide({ state: s, pending: [fb({ verdict: '停掉' })] })
  assert.equal(p.kind, 'postmortem')
})

check('★★ 负面连击到阈值 → 即使没有新反馈也要停更评估', () => {
  const s = state({ projects: [project({ negativeStreak: 2 })] })
  assert.equal(decide({ state: s, pending: [] }).kind, 'postmortem')
})

check('负面连击没到阈值 → 照常干活', () => {
  const s = state({ projects: [project({ negativeStreak: 1 })] })
  assert.equal(decide({ state: s, pending: [] }).kind, 'expand')
})

check('已停更的项目不会再被排进任何动作', () => {
  const s = state({ projects: [project({ status: 'stopped' })] })
  assert.equal(decide({ state: s, pending: [] }).kind, 'explore')
})

check('给别的项目的反馈不会算到这个项目头上', () => {
  const s = state({ projects: [project({ id: 'A', docs: ALL_DOCS })] })
  const p = decide({ state: s, pending: [fb({ project: 'B' })] })
  assert.equal(p.kind, 'explore', '不该被一条挂在别处的反馈带偏')
})

console.log('\n策划室 · 一手证据优先')

check('★★ 实验跑出结果 → 修订，优先级高于停更评估', () => {
  const s = state({ projects: [project({ negativeStreak: 5 })] })
  const p = decide({
    state: s,
    pending: [fb({ id: 'e1', kind: 'experiment', expId: 'EXP-01', result: '不成立' })]
  })
  assert.equal(p.kind, 'revise', '一条实验结果可能正好推翻「该停」的理由 —— 先把数据吃进文档再谈停不停')
  assert.equal(p.items[0].kind, 'experiment')
  assert.match(p.why || '', /一手数据/)
})

check('★ 实验结果处理完了，才轮到停更评估', () => {
  const s = state({ projects: [project({ negativeStreak: 5 })] })
  assert.equal(decide({ state: s, pending: [] }).kind, 'postmortem')
})

console.log('\n策划室 · 主人直接拍板')

/* 「就它了」被 applyVotes 翻译成候选上的一个 pinned 标记，而不是一条待办。
 * 这个设计不是为了好看 —— 早一版把它留成待办，代价是：
 * 活跃项目满员时 decide 走不到 charter 分支，那条投票既没执行也没被标已处理，
 * 而它优先级最高，于是**每一轮都被它短路**，后面所有事情一起饿死。 */

check('★★ 置顶的候选 → 立刻立项，不再等轮数门槛', () => {
  const s = state({ candidates: sameRound({ title: '甲', stars: 5, pinned: true }) })
  const p = decide({ state: s, pending: [] })
  assert.equal(p.kind, 'charter', '门槛是用来拦模型自嗨的，不是用来拦他的')
  assert.equal(p.forced, true, '要标出这是他点的名 —— 校验没过时说法不一样')
  assert.equal(p.candidate.title, '甲')
})

check('★★ 置顶的候选优先于任何普通候选', () => {
  const s = state({
    candidates: scanned(
      { title: '模型看好的', stars: 5 },
      { title: '他点名的', stars: 3, pinned: true },
      { title: '别的', stars: 4 })
  })
  assert.equal(decide({ state: s, pending: [] }).candidate.title, '他点名的')
})

check('★★ 活跃项目已满时，置顶的候选安静排队，不会把后面的优先级饿死', () => {
  const s = state({
    projects: [project({ id: 'A' }), project({ id: 'B' })],
    candidates: sameRound({ title: '甲', stars: 5, pinned: true })
  })
  const p = decide({ state: s, pending: [fb({ project: 'A', verdict: '停掉' })] })
  assert.equal(p.kind, 'postmortem', '他点的名不该盖住他后来说的「停掉」')
})

check('★ 满员时置顶候选留在池子里，不会被丢掉', () => {
  const s = state({
    projects: [project({ id: 'A', docs: ALL_DOCS }), project({ id: 'B', docs: ALL_DOCS })],
    candidates: sameRound({ title: '甲', stars: 5, pinned: true })
  })
  decide({ state: s, pending: [] })
  assert.equal(s.candidates[0].pinned, true, '一有空位它就该自动排到最前面，不用他再点一次')
})

console.log('\n策划室 · 反馈落在哪一份文档上')

check('★★ 对 CHANGELOG 的反馈不会覆盖 CHANGELOG（那会把修订历史一次抹掉）', () => {
  const p = project({ docs: ['00-pitch.md', '01-showcase.md', '02-pillars.md'] })
  assert.notEqual(reviseTarget(p, 'CHANGELOG.md'), 'CHANGELOG.md')
  assert.equal(reviseTarget(p, 'CHANGELOG.md'), '02-pillars.md', '落到最近的一份正经策划文档上')
})

check('★ 对停更说明 / 校验记录的反馈同理', () => {
  const p = project({ docs: ['00-pitch.md'] })
  assert.equal(reviseTarget(p, 'POSTMORTEM.md'), '00-pitch.md')
  assert.equal(reviseTarget(p, 'AUDIT.md'), '00-pitch.md')
})

check('对正经策划文档的反馈照常落在它自己身上', () => {
  const p = project({ docs: ['00-pitch.md', '01-showcase.md'] })
  assert.equal(reviseTarget(p, '01-showcase.md'), '01-showcase.md')
})

check('一份策划文档都还没有时，兜底到立项书', () => {
  assert.equal(reviseTarget({ docs: [] }, 'CHANGELOG.md'), '00-pitch.md')
  assert.equal(reviseTarget({}, 'POSTMORTEM.md'), '00-pitch.md')
})

console.log('\n策划室 · 立项死锁（真实发生过：六轮，十个候选，一个也立不了）')

check('★★ 候选攒够了、轮数也够了、但没有 4 星 → 横向评比而不是继续探索', () => {
  const s = state({
    candidates: scanned(
      { title: 'a', stars: 3 }, { title: 'b', stars: 3 }, { title: 'c', stars: 3 },
      { title: 'd', stars: 2 }, { title: 'e', stars: 3 }, { title: 'f', stars: 3 })
  })
  const p = decide({ state: s, pending: [] })
  assert.equal(p.kind, 'shortlist', '绝对分做门槛必然卡死 ——「够不够好」没有锚点，「哪个最好」才有')
  assert.match(p.why || '', /比/)
})

check('★★ 同一批候选不重复评比 —— 否则就是一个更贵的新死循环', () => {
  const cs = scanned(
    { title: 'a', stars: 3 }, { title: 'b', stars: 3 }, { title: 'c', stars: 3 },
    { title: 'd', stars: 3 }, { title: 'e', stars: 3 }, { title: 'f', stars: 3 })
  const s = state({ candidates: cs, lastShortlist: candidateFingerprint(cs) })
  const p = decide({ state: s, pending: [] })
  assert.equal(p.kind, 'explore')
  assert.match(p.why || '', /刚比过/)
})

check('候选指纹与顺序无关（同一批只是排序变了，不该被当成新的一批）', () => {
  const a = candidateFingerprint([{ title: '甲' }, { title: '乙' }])
  const b = candidateFingerprint([{ title: '乙' }, { title: '甲' }])
  assert.equal(a, b)
})

check('★ 评比之后第一名上了 4 星 → 下一轮就立项', () => {
  const s = state({
    candidates: scanned({ title: 'a', stars: 4 }, { title: 'b', stars: 3 }, { title: 'c', stars: 3 }),
    lastShortlist: 'whatever'
  })
  assert.equal(decide({ state: s, pending: [] }).kind, 'charter')
})

check('评比不会在活跃项目满员时触发（立不了项，比了也没用）', () => {
  const s = state({
    projects: [project({ id: 'A', docs: ALL_DOCS }), project({ id: 'B', docs: ALL_DOCS })],
    candidates: scanned(...Array.from({ length: 6 }, (_, i) => ({ title: 't' + i, stars: 3 })))
  })
  assert.equal(decide({ state: s, pending: [] }).kind, 'explore')
})

console.log('\n策划室 · 赛道与打分（多样性靠代码，不靠提示词）')

check('★★ 短板封顶：三维满分 + 一维 1 分，上不了 4 星', () => {
  const r = rollup({ glance: 5, talk: 5, ship: 5, unique: 1 })
  assert.ok(r.stars <= 2, `实际 ${r.stars} 星 —— 截图里看不出差别的话，后面三项再高评委也翻页了`)
})

check('★ 四维都不错才拿得到高分', () => {
  assert.equal(rollup({ glance: 4, talk: 4, ship: 4, unique: 4 }).stars, 4)
  assert.ok(rollup({ glance: 5, talk: 5, ship: 4, unique: 5 }).stars >= 5)
})

check('打分越界会被夹回 1~5', () => {
  const r = rollup({ glance: 9, talk: 0, ship: -3, unique: 'x' })
  assert.ok(r.glance <= 5 && r.talk >= 1 && r.ship >= 1 && r.unique >= 1)
})

check('★★ 同一轮里赛道撞车 → 撞车的被压到 2 星（第一轮事故的直接修复）', () => {
  const { candidates, collisions } = dedupeLanes([
    { title: '甲', lane: 'physics', stars: 5 },
    { title: '乙', lane: 'physics', stars: 4 },
    { title: '丙', lane: 'proc-gen', stars: 4 }
  ])
  assert.equal(candidates[0].stars, 5, '同赛道里分最高的那个保留原分')
  assert.equal(candidates[1].stars, 2, '重复的那个等于白写')
  assert.equal(candidates[2].stars, 4, '不同赛道不受影响')
  assert.equal(collisions.length, 1, '要能报出撞了几次，否则日志里看不出来')
})

check('★ 没标赛道的按撞车处理 —— 不标就是绕过检查', () => {
  const { candidates } = dedupeLanes([
    { title: '甲', lane: null, stars: 5 },
    { title: '乙', lane: null, stars: 5 }
  ])
  assert.equal(candidates[1].stars, 2)
})

check('★★ 纯代码表现层不能当主赛道（振刀那一类就死在这条）', () => {
  assert.equal(mainOk('code-feel'), false, '截图里看不见 + 面试问三句就到底 = 两维同时归零')
  assert.equal(mainOk('geometry'), true)
})

check('赛道能从 id 或中文名里读出来', () => {
  assert.equal(parseLane('**赛道**：proc-gen\n后面是正文'), 'proc-gen')
  assert.equal(parseLane('赛道：运行时几何'), 'geometry')
  assert.equal(parseLane('这一段里什么都没写'), null)
})

check('四维分能从各种写法里读出来，缺的那几维会被点名', () => {
  const d = parseDims('- 一眼可辨：4 —— 理由\n- 技术讲点：5/5\n- 可完成：3 分\n- 独特：4')
  assert.equal(d.glance, 4)
  assert.equal(d.talk, 5)
  assert.equal(d.unique, 4)
  assert.equal(d.partial, null)
  const half = parseDims('一眼可辨：4')
  assert.ok(half.partial.includes('talk'), '缺了哪几维要报出来，不能默默按 3 分算完就算了')
})

check('★ 方向按块解析，少写一个字段不会让后面全体错位', () => {
  const out = `## 方向 1：甲
**赛道**：physics
**打分**
- 一眼可辨：5
- 技术讲点：4
- 可完成：4
- 独特：4

## 方向 2：乙
**赛道**：proc-gen
（这个方向忘了写打分）

## 方向 3：丙
**赛道**：shader
**打分**
- 一眼可辨：3
- 技术讲点：3
- 可完成：5
- 独特：2`
  const dirs = parseDirections(out, 'explore/x.md', 'now')
  assert.equal(dirs.length, 3)
  assert.equal(dirs[0].title, '甲')
  assert.equal(dirs[1].lane, 'proc-gen', '第二个缺分，但它的赛道不该串到第三个头上')
  assert.ok(dirs[1].partial, '缺分要标出来')
  assert.equal(dirs[2].lane, 'shader')
  assert.ok(dirs[2].stars <= 3, '独特只有 2 分，短板封顶')
})

check('没扫过的赛道能列出来（探索时要求覆盖）', () => {
  const cold = coldLanes(state({ laneHistory: ['physics', 'proc-gen'] }))
  assert.ok(!cold.includes('physics'))
  assert.ok(cold.includes('geometry'))
  assert.ok(!cold.includes('code-feel'), '纯代码表现层不该被当成「还没扫过、值得去扫」的赛道')
  assert.equal(coldLanes(state()).length, LANE_IDS.length - 1, '一张白纸时除了 code-feel 全是冷的')
})

console.log('\n策划室 · 探索时看不到他的个人口味')

check('★★ 口味那一节被整节删掉，不是加一句警告', () => {
  const charter = `# 总纲

## 一、我是谁
UE5 C++。

## 四、我的口味【探索时不看】
我欣赏《绝区零》的振刀：短窗口按对键，顿帧加特写。

## 五、硬约束
不产出原创美术。`
  const { text, dropped } = forExplore(charter)
  assert.doesNotMatch(text, /振刀/, '第一版反复写「别看这一节」，结果三个方向全是这一节的变体 —— 注意力不受指令控制')
  assert.doesNotMatch(text, /绝区零/)
  assert.match(text, /UE5 C\+\+/, '别的小节一个字都不能少')
  assert.match(text, /不产出原创美术/)
  assert.equal(dropped.length, 1)
})

check('★ 老总纲（标题叫「我的设计偏好」，没有显式标记）也认得出来', () => {
  const { dropped } = forExplore('# 总纲\n\n## 四、我的设计偏好\n\n我欣赏振刀。\n')
  assert.equal(dropped.length, 1, '不兜底的话，升级代码之后老仓库照样会被带偏')
})

check('设计阶段（立项之后）该看得到就看得到', () => {
  assert.match(sections('# T\n\n## 一、A\nx\n\n## 二、B\ny').map(s => s.title).join(','), /一、A/)
})

check('参赛与展示那一节能被单独拎出来（校验时权重最高）', () => {
  const s = showcaseSection('# 总纲\n\n## 二、参赛与展示目标\n\n目标是拿奖。\n\n## 三、硬约束\n\nx')
  assert.match(s, /目标是拿奖/)
  assert.doesNotMatch(s, /硬约束/, '只要那一节，不要把后面的也带出来')
})

console.log('\n策划室 · 文档序列')

check(`${DOC_PLAN.length} 份文档，编号即顺序，没有重名`, () => {
  assert.equal(DOC_PLAN.length, 9)
  assert.deepEqual([...new Set(ALL_DOCS)], ALL_DOCS)
  assert.deepEqual(ALL_DOCS, [...ALL_DOCS].sort(), '文件名排序必须等于阅读顺序')
})

check('★ 第一份永远是立项书', () => {
  assert.equal(nextDoc([]).file, '00-pitch.md')
})

check('★★ 参赛与展示排在支柱和玩法之前 —— 先钉死别人看到的样子', () => {
  assert.equal(ALL_DOCS[1], '01-showcase.md')
  assert.ok(ALL_DOCS.indexOf('01-showcase.md') < ALL_DOCS.indexOf('02-pillars.md'))
  assert.ok(ALL_DOCS.indexOf('01-showcase.md') < ALL_DOCS.indexOf('03-core-loop.md'),
    '放到最后写的话，它只能给已经做完的东西补一段说明')
})

check('nextDoc 返回第一个缺的，而不是简单地往后数', () => {
  assert.equal(nextDoc(['00-pitch.md', '03-core-loop.md']).file, '01-showcase.md')
})

check('写全之后 nextDoc 返回 null', () => {
  assert.equal(nextDoc(ALL_DOCS), null)
})

check('每份文档都有名字和写作规格（规格是提示词的主体，不能空）', () => {
  for (const d of DOC_PLAN) {
    assert.ok(d.name && d.name.length >= 2, `${d.file} 没有名字`)
    assert.ok(d.brief && d.brief.length >= 10, `${d.file} 没有一句话说明`)
    assert.ok(d.spec && d.spec.length >= 300, `${d.file} 的写作规格太短（${(d.spec || '').length} 字）`)
  }
})

check('docByFile 查得到，查不到的返回 undefined', () => {
  assert.equal(docByFile('04-systems.md').name, '系统设计')
  assert.equal(docByFile('01-showcase.md').name, '参赛与展示方案')
  assert.equal(docByFile('不存在.md'), undefined)
})

console.log('\n策划室 · 目标函数是参赛与简历，不是好玩')

check('★★ 人设里就写死了「不是做给他自己玩的」', () => {
  assert.match(SYSTEM, /不是做给他自己玩的|参赛作品/)
  assert.match(SYSTEM, /我喜欢什么不重要/, '这是他的原话，值得原样留着')
})

check('★★ 评审视角账本在 system 里，和 UE5 能力账本并列', () => {
  assert.match(SYSTEM, /评审视角账本/)
  assert.match(SYSTEM, /UE5 能力账本/)
  assert.match(SYSTEM, /简历/)
})

check('★ 三问出现在人设里（每份文档都要能当场回答）', () => {
  assert.match(SYSTEM, /评委第一眼看到什么/)
  assert.match(SYSTEM, /面试官会追问什么/)
})

check('★ 立项书里有「技术内核」和「简历一行」两节', () => {
  const pitch = DOC_PLAN[0].spec
  assert.match(pitch, /## 技术内核/)
  assert.match(pitch, /## 简历一行/)
  assert.match(pitch, /## 目标观众/, '不再是「目标玩家」—— 玩家排第三')
})

console.log('\n策划室 · 硬约束校验')

/* 校验是立项前唯一真正的门。它解析错了不会报错 ——
 * 只会表现为「怎么什么都放行」或者「怎么什么都立不了项」，都要很久才看得出来。 */

check('★ 三种判定都读得出来', () => {
  assert.equal(parseAudit('判定：通过\n致命冲突：无\n===正文===\nx').verdict, '通过')
  assert.equal(parseAudit('判定：否决\n致命冲突：撞了 ⭐ 第二条\n===正文===\nx').verdict, '否决')
  assert.equal(parseAudit('判定：存疑\n致命冲突：说不准\n===正文===\nx').verdict, '存疑')
})

check('★★ 只有「通过」算过，存疑不算', () => {
  assert.equal(parseAudit('判定：通过').passed, true)
  assert.equal(parseAudit('判定：否决').passed, false)
  assert.equal(parseAudit('判定：存疑').passed, false, '判断不了就是没过 —— 放行一个错方向的代价是他照着做一年')
})

check('★ 读不出判定 → 返回 null，由调用方拦下', () => {
  assert.equal(parseAudit('这个方向我觉得挺好的，可以做'), null, '含糊的输出不许被当成通过')
  assert.equal(parseAudit(''), null)
  assert.equal(parseAudit(null), null)
  assert.equal(parseAudit('判定：还行'), null, '不在三个词里的判定一律不认')
})

check('致命冲突那一行会被抓出来（日志和已否决清单要用）', () => {
  const r = parseAudit('判定：否决\n致命冲突：亮点落在美术资源质量上，撞总纲硬约束 ⭐ 第二条\n===正文===\n详细分析…')
  assert.match(r.why, /美术资源质量/)
  assert.equal(parseAudit('判定：通过\n致命冲突：无').why, '无')
})

check('★★ 校验的提示词里不许出现探索时打的分', () => {
  const p = auditPrompt({ charter: '总纲正文', subject: '某个方向', kind: '候选方向' })
  assert.doesNotMatch(p.user, /参考指数|几星|\d\s*星/, '让审查员看见上游的评分，等于告诉它标准答案')
  assert.match(p.system, /默认否决/, '审查员的默认立场必须是否决，不是「看起来还行」')
  assert.doesNotMatch(p.system, /主策划/, '审查员不能用策划的人设 —— 自己审自己一定过')
})

check('★★ 校验现在也查展示价值，不只查做不做得出来', () => {
  const p = auditPrompt({ charter: 'x', subject: 'y' })
  assert.match(p.user, /评委第一眼看到什么/)
  assert.match(p.user, /面试官会追问什么/)
  assert.match(p.user, /红海赛道/)
  assert.match(p.system, /做得出来但没人会记住/, '做得出来但没人记住，和做不出来一样是浪费一年')
})

check('★ 校验会拿到两本账本', () => {
  const p = auditPrompt({ charter: 'x', subject: 'y' })
  assert.match(p.system, /UE5 能力账本/)
  assert.match(p.system, /评审视角账本/)
})

console.log('\n策划室 · 探索的多样性')

check('★★ 赛道枚举出现在探索提示词里，并且说明了代码会查', () => {
  const p = explorePrompt({ charter: 'x', stateSummary: '', coveredTitles: [], material: '' })
  assert.match(p.user, /赛道/)
  assert.match(p.user, /代码在查|会被系统自动降到 2 星/, '软约束模型会点头答应然后照旧')
  assert.match(p.user, /主赛道不能是/, '振刀那一类必须在这里被点名挡掉')
})

check('★ 探索提示词里带上教训清单和已否决清单', () => {
  const p = explorePrompt({
    charter: 'x', stateSummary: '', coveredTitles: [],
    rejected: [{ title: '振刀战斗', why: '亮点取决于动画质量' }],
    lessons: '## 教训：只能靠调难度参数变化的方向，内容量在立项当天就封顶',
    material: ''
  })
  assert.match(p.user, /振刀战斗/)
  assert.match(p.user, /亮点取决于动画质量/, '只给名字不给原因的话，它会换个名字再端上来')
  assert.match(p.user, /调难度参数/, '死过的项目的教训必须进下一轮，否则同一个坑会反复挖')
})

check('★ 冷赛道会被点名要求覆盖', () => {
  const p = explorePrompt({ charter: 'x', stateSummary: '', coveredTitles: [], cold: ['geometry', 'time'], material: '' })
  assert.match(p.user, /运行时几何/)
  assert.match(p.user, /一次都没扫过/)
})

console.log('\n策划室 · 横向评比')

check('★★ 评比提示词强制选出第一名，不许交「都不够好」', () => {
  const p = shortlistPrompt({ charter: 'x', candidates: [{ title: '甲' }, { title: '乙' }] })
  assert.match(p.user, /必须选出一个第一名/)
  assert.match(p.user, /相对判断/, '「够不够好」没有锚点，「哪个最好」才有')
  assert.match(p.user, /第一名：/, '格式要能被程序读到')
})

check('★ 评比结果读得出第一名、四维分和淘汰名单', () => {
  const r = parseShortlist(`第一名：点击断杆的逆向桥梁
一眼可辨：5
技术讲点：4
可完成：4
独特：4
淘汰：音乐盒；生态干预
===正文===
详细分析`)
  assert.equal(r.winner, '点击断杆的逆向桥梁')
  assert.equal(r.dims.glance, 5)
  assert.deepEqual(r.dropped, ['音乐盒', '生态干预'])
})

check('评比没淘汰任何东西时，写「无」也读得对', () => {
  const r = parseShortlist('第一名：甲\n一眼可辨：4\n技术讲点：4\n可完成：4\n独特：4\n淘汰：无\n===正文===\nx')
  assert.deepEqual(r.dropped, [])
})

check('读不出第一名 → 返回 null，调用方不动候选池', () => {
  assert.equal(parseShortlist('我觉得都还不错'), null)
})

console.log('\n策划室 · 实验台')

check('★★ 文档末尾的实验块能被抽出来，并且不会留在正文里', () => {
  const { body, experiments } = parseExperiments(`# 核心循环

正文内容在这里。

===实验===
主张：玩家能在 3 秒内看懂断杆会导致什么 | 原型：一座 12 根杆的桥，点一根 | 观察：不知情的人第一次点完的反应 | 证伪：三个人里有两个说不出发生了什么 | 成本：2 人日
主张：结构崩塌的画面在静止截图里也认得出 | 原型：截 10 张崩塌中的帧 | 观察：给人看，问这是什么 | 证伪：多数人说看不出 | 成本：0.5 人日`)
  assert.equal(experiments.length, 2)
  assert.match(experiments[0].claim, /3 秒内看懂/)
  assert.match(experiments[0].cost, /2 人日/)
  assert.doesNotMatch(body, /===实验===/, '机器读的块不该留在给人看的文档里')
  assert.match(body, /正文内容在这里/)
})

check('没有实验块时，正文原样返回', () => {
  const { body, experiments } = parseExperiments('# 标题\n\n正文')
  assert.equal(experiments.length, 0)
  assert.match(body, /正文/)
})

check('格式跑偏的实验行会被丢掉，不会写进半条脏数据', () => {
  const { experiments } = parseExperiments('正文\n\n===实验===\n主张：只有主张没有原型\n（本篇无新增实验）')
  assert.equal(experiments.length, 0)
})

console.log('\n策划室 · 同一天跑两次')

check('★★ 探索记录的文件名带轮次号，同一天两次不会互相覆盖', () => {
  const a = exploreFile('2026-08-19', 7)
  const b = exploreFile('2026-08-19', 8)
  assert.notEqual(a, b, '只带日期的话，第二次会盖掉第一次的记录，而且轮数只算 1 轮')
  assert.match(a, /2026-08-19/, '日期还是要在文件名里，方便人翻')
})

check('cycle 缺失时也不炸（老 state.json 没有这个字段）', () => {
  assert.equal(typeof exploreFile('2026-08-19', undefined), 'string')
})

console.log('\n策划室 · 他说停掉的时候')

check('★★ 他明确说停掉 → 结论写死停更，模型没有投票权', () => {
  const p = postmortemPrompt({
    charter: 'C', project: { name: 'X' }, existingDocs: 'D', feedbacks: 'F', changelog: '', forced: true
  })
  assert.match(p.user, /没有投票权/, '他是甲方，说停就是停')
  assert.match(p.user, /结论：停更/)
  assert.doesNotMatch(p.user, /结论：继续 \/ 停更/, '强制停更时不许再给它二选一')
  assert.match(p.user, /保留意见/, '不同意可以写下来，但不能改结论')
})

check('★ 只是负面连击（他没明说）→ 仍然是判断题', () => {
  const p = postmortemPrompt({
    charter: 'C', project: { name: 'X' }, existingDocs: 'D', feedbacks: 'F', changelog: ''
  })
  assert.match(p.user, /结论：继续 \/ 停更/, '这种情况该由模型判断，不该一律停')
})

check('★★ 强制停更也要明说「写完整的正文」，不能只给个填好的模板', () => {
  const p = postmortemPrompt({
    charter: 'C', project: { name: 'X' }, existingDocs: 'D', feedbacks: 'F', changelog: '', forced: true
  })
  // 上一版把结论直接填好、底下贴个模板，模型读成了「没什么要做的」，
  // 于是东西全写在思考里，正式回答是空的（finish_reason=stop）
  assert.match(p.user, /写一份完整的停更说明/)
  assert.match(p.user, /不许敷衍|不许只留标题/)
  assert.match(p.user, /正式回答/, '要说死：写在正式回答里，不是写在思考里')
})

check('★★ 停更说明要产出一条「可以拿去检查别的方向」的教训', () => {
  const p = postmortemPrompt({ charter: 'C', project: { name: 'X' }, existingDocs: '', feedbacks: '', changelog: '', forced: true })
  assert.match(p.user, /## 一句话教训/)
  assert.match(p.user, /可以拿去检查别的方向/, '流水账式的复盘留不下任何东西')
})

check('★ 人设里就交代了「想完要写出来」，所有步骤都受用', () => {
  assert.match(SYSTEM, /思考过程是给你自己用的/)
})

check('两条路共用同一份停更说明规格', () => {
  const spec = /## 为什么停[\s\S]*## 什么时候这个想法会重新成立/
  const forced = postmortemPrompt({ charter: 'C', project: { name: 'X' }, existingDocs: '', feedbacks: '', changelog: '', forced: true })
  const judged = postmortemPrompt({ charter: 'C', project: { name: 'X' }, existingDocs: '', feedbacks: '', changelog: '' })
  assert.match(forced.user, spec)
  assert.match(judged.user, spec)
})

console.log('\n模块之间没有循环 import')
check('studio 和 nanaly 能同时加载', () => {
  assert.equal(typeof parseColumn, 'function')
  assert.equal(typeof decide, 'function')
})

console.log(`\n${pass} 项通过`)
