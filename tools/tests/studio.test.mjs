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
import { decide } from '../studio/run.mjs'
import { DOC_PLAN, nextDoc, docByFile } from '../studio/prompts.mjs'
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
const state = (over = {}) => ({ projects: [], candidates: [], recentActions: [], ...over })
const fb = (over = {}) => ({ id: 'fb1', project: 'P01-x', file: '00-pitch.md', verdict: '一般', note: 'x', handled: false, ...over })

console.log('\n策划室 · 决策优先级')

check('★ 什么都没有 → 探索', () => {
  assert.equal(decide({ state: state(), pending: [] }).kind, 'explore')
})

check('★ 有 4 星候选、还没立项 → 立项', () => {
  const s = state({ candidates: [{ title: '甲', stars: 3 }, { title: '乙', stars: 5 }] })
  const p = decide({ state: s, pending: [] })
  assert.equal(p.kind, 'charter')
  assert.equal(p.candidate.title, '乙', '应该挑星级最高的那个')
})

check('候选都不够格（3 星以下）→ 继续探索，不硬立项', () => {
  const s = state({ candidates: [{ title: '甲', stars: 3 }, { title: '乙', stars: 2 }] })
  assert.equal(decide({ state: s, pending: [] }).kind, 'explore')
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

console.log('\n模块之间没有循环 import')
check('studio 和 nanaly 能同时加载', () => {
  assert.equal(typeof parseColumn, 'function')
  assert.equal(typeof decide, 'function')
})

console.log(`\n${pass} 项通过`)
