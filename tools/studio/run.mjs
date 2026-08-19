#!/usr/bin/env node
/* 策划室的入口。
 *
 * 一周三次（周一 / 周四 / 周六晚上），每次跑一件事。
 * 「跑哪一件」由代码决定，不交给模型 —— 模型没有记忆，
 * 每次都会倾向于选「再探索一个新方向」，那是最省力也最没积累的选择。
 *
 * 优先级（从高到低）：
 *
 *   1. 有主人的反馈没处理  → 修订。人的输入永远排第一。
 *   2. 某个项目该停了      → 停更评估。及时止损比继续产出重要。
 *   3. 有立项、文档没写完  → 深化。把手上的做完，别开新坑。
 *   4. 有够格的候选方向    → 立项。
 *   5. 什么都没有          → 探索。
 *
 * 用法：
 *   node tools/studio/run.mjs            按上面的优先级自动决定
 *   node tools/studio/run.mjs explore    强制探索
 *   node tools/studio/run.mjs --dry      只演练，不往仓库写任何东西
 */

import * as S from './store.mjs'
import { ask, backend, describeBackend } from './llm.mjs'
import { gather, attachRefs, hasSearch } from './search.mjs'
import {
  DOC_PLAN, docByFile, nextDoc,
  explorePrompt, charterPrompt, expandPrompt, revisePrompt, postmortemPrompt
} from './prompts.mjs'

const ARGS = process.argv.slice(2)
const DRY = ARGS.includes('--dry')
const FORCE = ARGS.find(a => !a.startsWith('--')) || ''

/* 同时最多几个活跃项目。
 * 定成 2 是有理由的：一个人的注意力就这么多，三个并行等于三个都停在半路。
 * 但也不能只有 1 —— 一个方向卡住的时候得有地方去。 */
const MAX_ACTIVE = Number(process.env.STUDIO_MAX_ACTIVE || 2)
/* 一个项目连续多少条负面反馈触发停更评估。 */
const POSTMORTEM_THRESHOLD = Number(process.env.STUDIO_POSTMORTEM_AT || 2)

const beijing = () => new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
}).format(new Date())

const today = () => beijing().slice(0, 10)

const log = (...a) => console.log(...a)

// ---------------- 写入（演练时只打印） ----------------

const put = async (path, text, message) => {
  if (DRY) {
    log(`\n  [演练] 会写 ${path}（${text.length} 字）：`)
    log(text.split('\n').slice(0, 40).map(l => '    │ ' + l).join('\n'))
    if (text.split('\n').length > 40) log('    │ …（后面省略）')
    return
  }
  await S.write(path, text, message)
  log(`  已写入 ${path}`)
}

const putJson = async (path, value, message) => {
  if (DRY) { log(`  [演练] 会更新 ${path}`); return }
  await S.writeJson(path, value, message)
}

// ---------------- 解析模型输出 ----------------

const splitBody = (raw, mark = '===正文===') => {
  const i = String(raw).indexOf(mark)
  if (i < 0) return { head: '', body: String(raw).trim() }
  return { head: String(raw).slice(0, i).trim(), body: String(raw).slice(i + mark.length).trim() }
}

const slugify = s => String(s || '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'project'

// ---------------- 状态摘要（喂给模型） ----------------

const summarize = state => {
  const lines = []
  const active = state.projects.filter(p => p.status === 'active')
  const stopped = state.projects.filter(p => p.status === 'stopped')
  lines.push(`已立项：${state.projects.length} 个（进行中 ${active.length}，已停更 ${stopped.length}）`)
  active.forEach(p => lines.push(`  · 进行中《${p.name}》，已写 ${(p.docs || []).length}/${DOC_PLAN.length} 份文档`))
  stopped.forEach(p => lines.push(`  · 已停更《${p.name}》 —— ${p.stoppedWhy || '原因见 POSTMORTEM'}`))
  if (state.candidates.length) {
    lines.push(`候选方向 ${state.candidates.length} 个：`)
    state.candidates.forEach(c => lines.push(`  · ${c.title}（${c.stars} 星）`))
  }
  if (state.recentActions.length) {
    lines.push(`最近做过：${state.recentActions.slice(-5).map(a => `${a.at.slice(5, 10)} ${a.action}`).join('、')}`)
  }
  return lines.join('\n') || '（还是一张白纸）'
}

// ---------------- 动作 ----------------

const doExplore = async ({ charter, state }) => {
  const covered = [
    ...state.candidates.map(c => c.title),
    ...state.projects.map(p => p.name)
  ].slice(0, 12)

  // 先搜再判断。直接问模型「什么玩法有创新点」，它给的是所有人都会说的那几个。
  const { listed, hits, queries } = await gather(charter, covered)

  log('  在扫方向…（深度思考，这一步慢，几分钟很正常）')
  const p = explorePrompt({
    charter, stateSummary: summarize(state), coveredTitles: covered, material: listed
  })
  const out = await ask(p.system, p.user, p.opts)
  if (!out) { log(`  没拿到结果，这次跳过。原因：${ask.lastError}`); return null }

  const body = attachRefs(out, hits)
  const meta = `---\ndate: ${beijing()}\nqueries:\n${queries.map(q => `  - ${JSON.stringify(q)}`).join('\n') || '  []'}\nsources: ${hits.length}\n`

  if (/（这一轮没有值得立项的方向）/.test(out)) {
    log('  她判断这一轮没有值得立项的方向 —— 交白卷，这是允许的')
    await put(`${S.EXPLORE_DIR}/${today()}.md`,
      `${meta}result: blank\n---\n\n${body}\n`,
      '策划室：探索（这一轮交白卷）')
    return { action: 'explore', blank: true }
  }

  await put(`${S.EXPLORE_DIR}/${today()}.md`, `${meta}---\n\n${body}\n`, '策划室：探索记录')

  // 把方向抽成候选，进状态机。抽不出来不影响文档已经写下去。
  const found = [...out.matchAll(/^##\s*方向\s*\d+\s*[:：]?\s*(.+)$/gm)].map(m => m[1].trim())
  const stars = [...out.matchAll(/\*\*参考指数\*\*\s*[—\-：:]*\s*(\d)/g)].map(m => Number(m[1]))
  const fresh = found.map((title, i) => ({
    title: title.slice(0, 80),
    stars: stars[i] || 3,
    from: `${S.EXPLORE_DIR}/${today()}.md`,
    at: beijing()
  }))
  log(`  抽出 ${fresh.length} 个候选：${fresh.map(f => `${f.title}(${f.stars}星)`).join('、') || '（没抽出来，去看原文）'}`)
  state.candidates = [...fresh, ...state.candidates].slice(0, 12)
  return { action: 'explore', added: fresh.length }
}

const doCharter = async ({ charter, state, candidate }) => {
  log(`  立项：《${candidate.title}》`)
  const p = charterPrompt({ charter, candidate: `${candidate.title}（探索时给了 ${candidate.stars} 星）` })
  const out = await ask(p.system, p.user, p.opts)
  if (!out) { log(`  没拿到结果，这次跳过。原因：${ask.lastError}`); return null }

  const { head, body } = splitBody(out)
  const name = (head.match(/^\s*名称\s*[:：]\s*(.+)$/m) || [])[1] || candidate.title
  const rawSlug = (head.match(/^\s*标识\s*[:：]\s*(.+)$/m) || [])[1] || name
  const seq = String(state.projects.length + 1).padStart(2, '0')
  const id = `P${seq}-${slugify(rawSlug)}`

  if (body.length < 600) { log('  产出太短，不像一份立项书，丢掉'); return null }

  await put(`${S.projectDir(id)}/00-pitch.md`,
    `---\ntitle: ${JSON.stringify(name.trim())}\ndoc: 立项书\ncreated: ${beijing()}\nrevision: 1\n---\n\n${body}\n`,
    `策划室：立项《${name.trim().slice(0, 24)}》`)

  await putJson(`${S.projectDir(id)}/meta.json`, {
    id, name: name.trim(), status: 'active',
    createdAt: beijing(), updatedAt: beijing(),
    docs: ['00-pitch.md'],
    revisions: {}, negativeStreak: 0,
    fromCandidate: candidate.title
  }, `策划室：${id} 元数据`)

  await put(`${S.projectDir(id)}/CHANGELOG.md`,
    `# 修订记录 · ${name.trim()}\n\n## ${today()} · 立项\n\n从探索候选「${candidate.title}」立项。写了 00-pitch.md。\n`,
    `策划室：${id} 修订记录`)

  state.projects.push({
    id, name: name.trim(), status: 'active',
    docs: ['00-pitch.md'], createdAt: beijing(), negativeStreak: 0
  })
  state.candidates = state.candidates.filter(c => c.title !== candidate.title)
  return { action: 'charter', id, name: name.trim() }
}

const doExpand = async ({ charter, state, project }) => {
  const existing = project.docs || []
  const doc = nextDoc(existing)
  if (!doc) { log(`  《${project.name}》八份文档已经写全了`); return null }

  log(`  深化《${project.name}》→ ${doc.name}（${doc.file}）`)
  const [existingDocs, changelog] = await Promise.all([
    S.projectFullText(project.id),
    S.readText(`${S.projectDir(project.id)}/CHANGELOG.md`)
  ])

  const p = expandPrompt({ charter, project, doc, existingDocs, changelog })
  const out = await ask(p.system, p.user, p.opts)
  if (!out) { log(`  没拿到结果，这次跳过。原因：${ask.lastError}`); return null }
  if (out.length < 800) { log('  产出太短，不像一份正经文档，丢掉'); return null }

  await put(`${S.projectDir(project.id)}/${doc.file}`,
    `---\ntitle: ${JSON.stringify(doc.name)}\ndoc: ${doc.name}\ncreated: ${beijing()}\nrevision: 1\n---\n\n${out}\n`,
    `策划室：《${project.name.slice(0, 20)}》${doc.name}`)

  // 模型如果发现了和前文的冲突，会单开一节。把它抬到日志里，别让它埋在文档最后。
  const conflict = out.match(/##\s*与前文的冲突[\s\S]*/)
  if (conflict) {
    log('  ⚠️ 她发现这份文档和前面写过的东西有冲突：')
    log(conflict[0].split('\n').slice(0, 12).map(l => '     ' + l).join('\n'))
  }

  project.docs = [...existing, doc.file]
  await appendChangelog(project, `## ${today()} · 新增 ${doc.name}\n\n写了 ${doc.file}。${conflict ? '\n\n⚠️ 本次发现与前文有冲突，见文档末尾。' : ''}`)
  await syncMeta(project)
  return { action: 'expand', id: project.id, doc: doc.file, conflict: !!conflict }
}

const doRevise = async ({ charter, state, project, items }) => {
  // 一次只改一份文档 —— 同一轮里改多份，很容易越改越不一致
  const targetFile = items[0].file || '00-pitch.md'
  const forThisFile = items.filter(x => (x.file || '00-pitch.md') === targetFile)

  log(`  修订《${project.name}》的 ${targetFile}，处理 ${forThisFile.length} 条反馈`)
  const [targetText, existingDocs, changelog] = await Promise.all([
    S.readText(`${S.projectDir(project.id)}/${targetFile}`),
    S.projectFullText(project.id),
    S.readText(`${S.projectDir(project.id)}/CHANGELOG.md`)
  ])
  if (!targetText) { log(`  读不到 ${targetFile}，跳过`); return null }

  const feedbacks = forThisFile.map((x, i) =>
    `[${i + 1}] ${x.at || ''} 评价：${x.verdict || '未评级'}\n${x.note || '（没写文字说明）'}`
  ).join('\n\n')

  const p = revisePrompt({ charter, project, targetFile, targetText, feedbacks, existingDocs, changelog })
  const out = await ask(p.system, p.user, p.opts)
  if (!out) { log(`  没拿到结果，这次跳过。原因：${ask.lastError}`); return null }

  const { head, body } = splitBody(out)
  const note = splitBody(head, '===修订说明===').body || head
  if (body.length < 500) { log('  改出来的正文太短，不敢覆盖，丢掉'); return null }

  const rev = (project.revisions?.[targetFile] || 1) + 1
  await put(`${S.projectDir(project.id)}/${targetFile}`,
    `---\ntitle: ${JSON.stringify(docByFile(targetFile)?.name || targetFile)}\ndoc: ${docByFile(targetFile)?.name || targetFile}\nrevision: ${rev}\nrevisedAt: ${beijing()}\n---\n\n${body}\n`,
    `策划室：修订《${project.name.slice(0, 20)}》${targetFile}（第 ${rev} 版）`)

  await appendChangelog(project,
    `## ${today()} · 修订 ${targetFile}（第 ${rev} 版）\n\n**主人的反馈**\n\n${forThisFile.map(x => `- ${x.verdict || ''}：${(x.note || '').slice(0, 200)}`).join('\n')}\n\n**怎么改的**\n\n${note}`)

  project.revisions = { ...(project.revisions || {}), [targetFile]: rev }

  // 负面连击计数：连续负面到阈值就该考虑停了
  const negative = forThisFile.some(x => ['可行性差', '停掉', '一般'].includes(x.verdict))
  project.negativeStreak = negative ? (project.negativeStreak || 0) + 1 : 0
  await syncMeta(project)

  return { action: 'revise', id: project.id, file: targetFile, handled: forThisFile.map(x => x.id) }
}

const doPostmortem = async ({ charter, state, project, items }) => {
  log(`  停更评估：《${project.name}》（负面连击 ${project.negativeStreak} 次）`)
  const [existingDocs, changelog] = await Promise.all([
    S.projectFullText(project.id),
    S.readText(`${S.projectDir(project.id)}/CHANGELOG.md`)
  ])
  const feedbacks = items.map(x => `- ${x.at || ''} ${x.verdict || ''}：${x.note || ''}`).join('\n') || '（没有文字反馈，只是长期没有进展）'

  const p = postmortemPrompt({ charter, project, existingDocs, feedbacks, changelog })
  const out = await ask(p.system, p.user, p.opts)
  if (!out) { log(`  没拿到结果，这次跳过。原因：${ask.lastError}`); return null }

  const { head, body } = splitBody(out)
  const stop = /停更/.test(head)

  if (!stop) {
    log('  结论：继续做。负面连击清零，接下来按她给的三步走')
    await appendChangelog(project, `## ${today()} · 停更评估：继续\n\n${body}`)
    project.negativeStreak = 0
    await syncMeta(project)
    return { action: 'postmortem-continue', id: project.id, handled: items.map(x => x.id) }
  }

  log('  结论：停更')
  await put(`${S.projectDir(project.id)}/POSTMORTEM.md`,
    `---\ntitle: 停更说明\ndoc: 停更说明\ncreated: ${beijing()}\n---\n\n${body}\n`,
    `策划室：《${project.name.slice(0, 20)}》停更`)
  await appendChangelog(project, `## ${today()} · 停更\n\n见 POSTMORTEM.md。`)

  project.status = 'stopped'
  project.stoppedAt = beijing()
  project.stoppedWhy = (body.match(/##\s*为什么停\s*\n+([^\n]+)/) || [])[1]?.slice(0, 80) || ''
  await syncMeta(project)
  return { action: 'postmortem-stop', id: project.id, handled: items.map(x => x.id) }
}

// ---------------- 项目文件的小工具 ----------------

const appendChangelog = async (project, entry) => {
  const path = `${S.projectDir(project.id)}/CHANGELOG.md`
  const cur = await S.readText(path) || `# 修订记录 · ${project.name}\n`
  // 新的写在最前面（标题之后），最近发生的事不该要翻到底才看得到
  const [title, ...rest] = cur.split('\n')
  await put(path, `${title}\n\n${entry}\n\n${rest.join('\n').trim()}\n`, `策划室：${project.id} 修订记录`)
}

const syncMeta = async project => {
  const path = `${S.projectDir(project.id)}/meta.json`
  const cur = await S.readJson(path, {})
  await putJson(path, { ...cur, ...project, updatedAt: beijing() }, `策划室：${project.id} 元数据`)
}

// ---------------- 决策 ----------------

/* 这一段是整套东西的大脑，也是唯一一段「不交给模型」的判断。
 *
 * 为什么不交给模型：它没有记忆，每次都会倾向于选「再探索一个新方向」——
 * 那是最省力、看起来最有产出、实际最没有积累的选择。
 * 规则写在代码里，模型只负责在选定的动作里发挥。
 *
 * 导出是为了能单测（tools/tests/studio.test.mjs）。
 */
export const decide = ({ state, pending }) => {
  const byProject = new Map()
  pending.forEach(x => {
    const key = x.project || ''
    if (!byProject.has(key)) byProject.set(key, [])
    byProject.get(key).push(x)
  })

  const active = state.projects.filter(p => p.status === 'active')

  // 1. 主人明确说停掉的，或者负面连击到阈值的 → 停更评估
  for (const p of active) {
    const items = byProject.get(p.id) || []
    const explicitStop = items.some(x => x.verdict === '停掉')
    if (explicitStop || (p.negativeStreak || 0) >= POSTMORTEM_THRESHOLD) {
      return { kind: 'postmortem', project: p, items }
    }
  }

  // 2. 有反馈没处理 → 修订
  for (const p of active) {
    const items = byProject.get(p.id) || []
    if (items.length) return { kind: 'revise', project: p, items }
  }

  // 3. 有立项、文档没写完 → 深化（先做文档最少的那个）
  const unfinished = active
    .filter(p => (p.docs || []).length < DOC_PLAN.length)
    .sort((a, b) => (a.docs || []).length - (b.docs || []).length)
  if (unfinished.length) return { kind: 'expand', project: unfinished[0] }

  // 4. 有够格的候选、活跃项目还没满 → 立项
  const worthy = state.candidates.filter(c => c.stars >= 4).sort((a, b) => b.stars - a.stars)
  if (worthy.length && active.length < MAX_ACTIVE) return { kind: 'charter', candidate: worthy[0] }

  // 5. 兜底 → 探索
  return { kind: 'explore' }
}

// ---------------- 主流程 ----------------

const main = async () => {
  log('━━━ 策划室 ━━━')
  log(`  时间：${beijing()}（北京）`)
  log(`  模型：${describeBackend()}`)
  log(`  检索：${hasSearch() ? 'Tavily 已配置' : '没配 TAVILY_API_KEY，探索只能凭模型自己的知识'}`)
  if (DRY) log('  演练模式 —— 不会往仓库写任何东西')

  if (backend() === 'none') {
    log('\n  没有可用的模型。配一个：')
    log('    ANTHROPIC_API_KEY  （推荐，策划书这活儿值这个钱）')
    log('    DEEPSEEK_API_KEY   （兜底）')
    process.exit(1)
  }

  if (!S.hasStore()) {
    log('\n  没配私有仓库（IDEAS_REPO / IDEAS_TOKEN），这一步跳过。')
    log('  —— 策划案是私密的，绝不会退回到往公开仓库里写。')
    return
  }
  log(`  私有仓库：${S.REPO}`)

  const charter = await S.readText(S.CHARTER)
  if (!charter || charter.replace(/\s/g, '').length < 200) {
    log(`\n  ${S.REPO} 里的 ${S.CHARTER} 还没写（或者太短）。`)
    log('  总纲是这套东西唯一的地基 —— 没有它，产出的一定是通用废话。')
    log('  仓库里应该有一份 charter.md 模板，照着填就行。')
    return
  }

  const state = await S.loadState()
  const inbox = await S.loadInbox()
  const pending = S.pendingFeedback(inbox)

  log(`\n  当前状态：\n${summarize(state).split('\n').map(l => '    ' + l).join('\n')}`)
  if (pending.length) log(`  待处理反馈：${pending.length} 条`)

  const plan = FORCE
    ? { kind: FORCE, project: state.projects.find(p => p.status === 'active'), items: pending, candidate: state.candidates[0] }
    : decide({ state, pending })

  log(`\n  这次做：${{
    explore: '探索新方向', charter: '立项', expand: '深化文档',
    revise: '处理反馈并修订', postmortem: '停更评估'
  }[plan.kind] || plan.kind}\n`)

  let result = null
  if (plan.kind === 'explore') result = await doExplore({ charter, state })
  else if (plan.kind === 'charter' && plan.candidate) result = await doCharter({ charter, state, candidate: plan.candidate })
  else if (plan.kind === 'expand' && plan.project) result = await doExpand({ charter, state, project: plan.project })
  else if (plan.kind === 'revise' && plan.project) result = await doRevise({ charter, state, project: plan.project, items: plan.items })
  else if (plan.kind === 'postmortem' && plan.project) result = await doPostmortem({ charter, state, project: plan.project, items: plan.items })
  else { log('  没有可执行的动作（多半是强制了一个当前没条件跑的模式）'); return }

  if (!result) { log('\n  这一轮没有产出。状态不变，下次再来。'); return }

  // 标记反馈已处理
  if (result.handled?.length && !DRY) {
    const done = new Set(result.handled)
    inbox.items = (inbox.items || []).map(x => done.has(x.id) ? { ...x, handled: true, handledAt: beijing() } : x)
    await S.saveInbox(inbox, `策划室：处理了 ${done.size} 条反馈`)
  }

  state.cycle = (state.cycle || 0) + 1
  state.recentActions = [...(state.recentActions || []), { at: beijing(), action: plan.kind }].slice(-20)
  // 项目的最新状态回写进 state
  if (plan.project) {
    state.projects = state.projects.map(p => p.id === plan.project.id ? { ...p, ...plan.project } : p)
  }
  if (!DRY) await S.saveState(state, `策划室：第 ${state.cycle} 轮（${plan.kind}）`)

  log('\n  这一轮完成。博客仓库一个字节都没动 —— 策划案不进公开仓库。')
}

/* 只有被直接执行时才跑。
 * 单测要 import 这个文件拿 decide，不能顺手把整条流水线也启动了。 */
const isEntry = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href
if (isEntry) {
  main().catch(e => {
    console.error('\n  炸了：', e)
    process.exit(1)
  })
}
