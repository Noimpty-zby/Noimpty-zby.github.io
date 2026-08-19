/* 策划室的决策逻辑测试。
 *
 * 这一段是整套东西的大脑：每次跑只做一件事，做哪件由优先级决定。
 * 它必须有测试，因为它错了不会报错 —— 只会表现为「她怎么老在探索，
 * 我的反馈她根本没理」，而这种问题要好几周才看得出来。
 *
 * 优先级（从高到低）：
 *   1. 有反馈没处理  → 修订
 *   2. 某个项目该停  → 停更评估
 *   3. 文档没写完    → 深化
 *   4. 有够格的候选  → 立项
 *   5. 什么都没有    → 探索
 */
import assert from 'node:assert/strict'
import { decide, exploreRounds } from '../studio/run.mjs'
import { DOC_PLAN, nextDoc, docByFile, SYSTEM, parseAudit, auditPrompt, explorePrompt } from '../studio/prompts.mjs'
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
const state = (over = {}) => ({ projects: [], candidates: [], rejected: [], recentActions: [], ...over })
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
    candidates: scanned({ title: '甲', stars: 3 }, { title: '乙', stars: 5 }, { title: '丙', stars: 4 })
  })
  const p = decide({ state: s, pending: [] })
  assert.equal(p.kind, 'charter')
  assert.equal(p.candidate.title, '乙', '应该挑星级最高的那个')
})

check('候选都不够格（3 星以下）→ 继续探索，不硬立项', () => {
  const s = state({ candidates: scanned({ title: '甲', stars: 3 }, { title: '乙', stars: 2 }) })
  assert.equal(decide({ state: s, pending: [] }).kind, 'explore')
})

/* ── 立项门槛（这一组就是振刀那次事故的回归测试）──
 *
 * 事故经过：第一轮探索给了四个方向，模型给自己最喜欢的打了 5 星，
 * 第二轮直接立项。整个过程只探索过一次，没有任何比较，
 * 而且立的那个方向撞了总纲里带 ⭐ 的硬约束，全程没有一步去检查。 */

check('★★ 只扫过一轮 → 就算有 5 星候选也不立项，接着扫', () => {
  const s = state({
    candidates: sameRound({ title: '甲', stars: 5 }, { title: '乙', stars: 4 }, { title: '丙', stars: 4 })
  })
  const p = decide({ state: s, pending: [] })
  assert.equal(p.kind, 'explore', '一轮里的几个方向常常是同一个念头的几种说法，没得挑')
  assert.match(p.why || '', /轮/, '要说清为什么这次不立项，否则日志里看不出是被门槛拦的')
})

check('★★ 扫够三轮 → 才放行立项', () => {
  const two = state({ candidates: scanned({ title: '甲', stars: 5 }, { title: '乙', stars: 5 }) })
  assert.equal(decide({ state: two, pending: [] }).kind, 'explore', '两轮还不够')

  const three = state({
    candidates: scanned({ title: '甲', stars: 5 }, { title: '乙', stars: 5 }, { title: '丙', stars: 5 })
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
    candidates: [{ title: '乙', stars: 5 }],
    projects: [project({ id: 'A' }), project({ id: 'B' })]
  })
  assert.equal(decide({ state: s, pending: [] }).kind, 'expand')
})

check('★ 有立项、文档没写完 → 深化，先做文档最少的那个', () => {
  const s = state({
    projects: [
      project({ id: 'A', docs: ALL_DOCS.slice(0, 5) }),
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
  const s = state({ projects: [project({ docs: ['00-pitch.md'] })] })
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
  const s = state({ projects: [project({ status: 'stopped', docs: ['00-pitch.md'] })] })
  assert.equal(decide({ state: s, pending: [] }).kind, 'explore')
})

check('给别的项目的反馈不会算到这个项目头上', () => {
  const s = state({ projects: [project({ id: 'A', docs: ALL_DOCS })] })
  const p = decide({ state: s, pending: [fb({ project: 'B-不存在' })] })
  assert.equal(p.kind, 'explore', '不该被一条挂在别处的反馈带偏')
})

console.log('\n策划室 · 文档序列')

check('八份文档，编号即顺序，没有重名', () => {
  assert.equal(DOC_PLAN.length, 8)
  assert.deepEqual([...new Set(ALL_DOCS)], ALL_DOCS)
  assert.deepEqual(ALL_DOCS, [...ALL_DOCS].sort(), '文件名排序必须等于阅读顺序')
})

check('★ 第一份永远是立项书', () => {
  assert.equal(nextDoc([]).file, '00-pitch.md')
})

check('nextDoc 返回第一个缺的，而不是简单地往后数', () => {
  // 中间缺了一份的话（比如某次跑失败了），下次应该回头补它
  assert.equal(nextDoc(['00-pitch.md', '02-core-loop.md']).file, '01-pillars.md')
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
  assert.equal(docByFile('03-systems.md').name, '系统设计')
  assert.equal(docByFile('不存在.md'), undefined)
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
  assert.equal(parseAudit('判定：存疑').passed, false, '判断不了就是没过 —— 放行一个错方向的代价是他照着做三个月')
})

check('★ 读不出判定 → 返回 null，由调用方拦下', () => {
  assert.equal(parseAudit('这个方向我觉得挺好的，可以做'), null, '含糊的输出不许被当成通过')
  assert.equal(parseAudit(''), null)
  assert.equal(parseAudit(null), null)
  assert.equal(parseAudit('判定：还行'), null, '不在三个词里的判定一律不认')
})

check('致命冲突那一行会被抓出来（日志和已否决清单要用）', () => {
  const r = parseAudit('判定：否决\n致命冲突：亮点落在美术资源质量上，撞总纲第三节 ⭐ 第二条\n===正文===\n详细分析…')
  assert.match(r.why, /美术资源质量/)
  assert.equal(parseAudit('判定：通过\n致命冲突：无').why, '无')
})

check('★★ 校验的提示词里不许出现探索时打的星级', () => {
  const p = auditPrompt({ charter: '总纲正文', subject: '某个方向', kind: '候选方向' })
  const all = p.system + p.user
  assert.doesNotMatch(all, /参考指数|几星|\d\s*星/, '让审查员看见上游的评分，等于告诉它标准答案')
  assert.match(p.system, /默认否决/, '审查员的默认立场必须是否决，不是「看起来还行」')
  assert.doesNotMatch(p.system, /主策划/, '审查员不能用策划的人设 —— 自己审自己一定过')
})

check('★ 校验会拿到 UE5 能力账本', () => {
  const p = auditPrompt({ charter: 'x', subject: 'y' })
  assert.match(p.system, /UE5 能力账本/)
  assert.match(SYSTEM, /UE5 能力账本/, '策划本人也要按这份账本估工作量')
})

console.log('\n策划室 · 探索的多样性')

check('★★ 探索提示词里写明第四节是用来排除的，不是用来指路的', () => {
  const p = explorePrompt({ charter: 'x', stateSummary: '', coveredTitles: [], material: '' })
  assert.match(p.user, /排除的[，,]?\s*不是用来指路/, '振刀那次事故的直接成因就是这句话没写')
  assert.match(p.user, /至多有一个方向可以和它直接相关/)
  assert.match(p.user, /亮点来源不同/, '几个方向必须互不相干，否则等于一个方向写了三遍')
})

check('★ 已否决的方向会带进下一轮探索', () => {
  const p = explorePrompt({
    charter: 'x', stateSummary: '', coveredTitles: [],
    rejected: [{ title: '振刀战斗', why: '亮点取决于动画质量' }], material: ''
  })
  assert.match(p.user, /振刀战斗/)
  assert.match(p.user, /亮点取决于动画质量/, '只给名字不给原因的话，它会换个名字再端上来')
})

console.log('\n模块之间没有循环 import')
check('studio 和 nanaly 能同时加载', () => {
  assert.equal(typeof parseColumn, 'function')
  assert.equal(typeof decide, 'function')
})

console.log(`\n${pass} 项通过`)
