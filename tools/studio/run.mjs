#!/usr/bin/env node
/* 策划室的入口。
 *
 * 一周三次（周一 / 周四 / 周六晚上），每次跑一件事。
 * 「跑哪一件」由代码决定，不交给模型 —— 模型没有记忆，
 * 每次都会倾向于选「再探索一个新方向」，那是最省力也最没积累的选择。
 *
 * 优先级（从高到低）：
 *
 *   0. 主人点名置顶的方向        → 立项。他拍板不是投票，是决定。
 *   1. 有实验跑出了真实结果      → 修订。一手数据的分量高于任何一轮推理。
 *   2. 某个项目该停了            → 停更评估。及时止损比继续产出重要。
 *   3. 有主人的反馈没处理        → 修订。人的输入排在产出前面。
 *   4. 有立项、文档没写完        → 深化。把手上的做完，别开新坑。
 *   5. 有够格的候选方向          → 立项（要先扫够轮数，且过独立校验）。
 *   6. 候选攒够了但都不够格      → 横向评比，选出最好的一个（解死锁，见下）。
 *   7. 什么都没有                → 探索。
 *
 * ── 这一版改了什么，以及为什么 ───────────────────────────
 *
 * 第一版跑了六轮，结果是：一个项目在纸面上死了，然后系统卡在探索循环里出不来。
 * 两个毛病都不是 bug，是设计错了。
 *
 * **毛病一：目标函数错了。**
 * 整套提示词在设计「一个好玩的游戏」。但主人说得很清楚：他是程序员不是策划，
 * 这个游戏不是给他玩的，是拿去比赛和写简历的，「我喜欢什么不重要」。
 * 于是加了 audience.mjs —— 评审视角账本，和 UE5 能力账本并列。
 *
 * **毛病二：多样性靠提示词，拦不住。**
 * 提示词里写了一屏的「方向必须互不相干」，第一轮扫出来的三个方向仍然是
 * 同一个念头（总纲里他随口举的「振刀」）的三种说法。
 * 于是：探索阶段把那一节从上下文里**物理删除**（charterlens.mjs），
 * 并要求每个方向声明一条赛道，由代码查重（lanes.mjs）。
 *
 * **毛病三：立项门槛是绝对分，会死锁。**
 * 门槛是「有 4 星候选」，而分是各轮独立打的绝对分。实测十个候选无一上 4 星，
 * 于是永远在探索。加了「横向评比」这个动作：把候选摆在一起做相对排序，
 * 必须选出第一名 —— 「哪个最好」有锚点，「够不够好」没有。
 *
 * 用法：
 *   node tools/studio/run.mjs             按上面的优先级自动决定
 *   node tools/studio/run.mjs explore     强制探索
 *   node tools/studio/run.mjs shortlist   强制把现有候选评比一次
 *   node tools/studio/run.mjs audit       重审已经立了的项目（补查老项目用）
 *   node tools/studio/run.mjs --dry       只演练，不往仓库写任何东西
 */

import * as S from './store.mjs'
import { ask, backend, describeBackend } from './llm.mjs'
import { gather, attachRefs, hasSearch } from './search.mjs'
import { forExplore, forDesign, showcaseSection } from './charterlens.mjs'
import { laneName, dedupeLanes, laneHistogram, coldLanes, mainOk, rollup } from './lanes.mjs'
import {
  DOC_PLAN, docByFile, nextDoc,
  explorePrompt, parseDirections,
  shortlistPrompt, parseShortlist,
  charterPrompt, expandPrompt, revisePrompt, postmortemPrompt,
  auditPrompt, parseAudit, parseExperiments
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

/* 立项之前至少要扫过几轮方向。
 *
 * 上一版没有这道门，结果是：第一轮探索给出四个方向，
 * 模型给自己最喜欢的那个打了 4 星，第二轮就立项了 ——
 * **第一个想法直接变成最终答案**，中间没有任何比较。
 *
 * 一轮里的几个方向往往是同一个念头的几种说法（同一次思考的产物）。
 * 要真的有得挑，候选池里必须有来自不同轮次的东西。 */
const MIN_EXPLORE_ROUNDS = Number(process.env.STUDIO_MIN_EXPLORES || 3)

/* 攒到多少个候选就该停下来比一比，而不是继续无限扫。
 *
 * 这个数配合 MIN_EXPLORE_ROUNDS 一起决定了「探索期有多长」。
 * 6 个候选 + 3 轮 ≈ 两周。再往上扫的边际收益很低 ——
 * 第七个方向不会比前六个好，只会让选择变难。 */
const SHORTLIST_AT = Number(process.env.STUDIO_SHORTLIST_AT || 6)

/* 候选池上限。超出的从最旧的开始掉。 */
const CANDIDATE_CAP = Number(process.env.STUDIO_CANDIDATE_CAP || 14)

/* 候选池里代表了几个不同的探索轮次。
 * 用 from（那一轮的记录文件名）去重，不用计数器 —— 老的 state.json 里没有计数器，
 * 而 from 是一开始就在写的，不需要迁移。 */
export const exploreRounds = state =>
  new Set((state.candidates || []).map(c => c.from).filter(Boolean)).size

/* 一轮探索记录的文件名。**必须带轮次号，不能只带日期。**
 *
 * 只带日期的话，同一天跑两次探索会有两个后果，都不轻：
 *   1. 第二次把第一次的记录**覆盖掉**，那一轮白跑
 *   2. 两批候选的 from 一样 → exploreRounds 只数出 1 轮 → 立项门槛永远卡着
 *
 * 定时任务落在一周三个不同日子上，撞不到；
 * 但手动连点几次就会撞上，而这套东西本来就是给人随手触发的。 */
export const exploreFile = (dateStr, cycle) =>
  `${S.EXPLORE_DIR}/${dateStr}-${cycle || 0}.md`

/* 一批候选的指纹。用来判断「这批候选评比过没有」——
 * 没有指纹的话，「没有 4 星 → 评比 → 第一名还是不到 4 星 → 再评比」
 * 会变成一个新的死循环，比原来那个还难看（它每轮都在烧钱）。 */
export const candidateFingerprint = candidates =>
  (candidates || []).map(c => c.title).sort().join('¦').slice(0, 400)

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

/* 「做不成也不该让整轮翻车」的那几步，包一层。
 *
 * 起因是一个很难查的故障模式：往私有仓库写东西是好几次独立的网络请求，
 * 不是一次事务。如果**主产出已经写完了**（比如 POSTMORTEM.md 落地了），
 * 而后面某一步收尾的写入炸了（记教训、登记实验、追加修订记录），
 * 那么 main() 会异常退出 —— state.json 来不及保存，于是下一轮读到的状态
 * 还停在「这个项目是 active」，它会**把整件事重做一遍**：
 * 覆盖 POSTMORTEM、重复追加修订记录、重复登记一批实验。
 *
 * 这些收尾步骤没一个值得让整轮回滚。所以它们失败就记一笔日志继续走，
 * 让 state.json 有机会落地 —— 缺一行修订记录，远好过整轮重做。 */
const soft = async (what, fn) => {
  try { return await fn() }
  catch (e) { log(`  ⚠️ ${what}没成功（${String(e.message || e).slice(0, 120)}）—— 不影响这一轮的主产出，继续`); return null }
}

// ---------------- 解析模型输出 ----------------

const splitBody = (raw, mark = '===正文===') => {
  const i = String(raw).indexOf(mark)
  if (i < 0) return { head: '', body: String(raw).trim() }
  return { head: String(raw).slice(0, i).trim(), body: String(raw).slice(i + mark.length).trim() }
}

const slugify = s => String(s || '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'project'

const clean = s => String(s || '').replace(/[*_`#]/g, '').replace(/\s+/g, ' ').trim()

// ---------------- 状态摘要（喂给模型） ----------------

const summarize = state => {
  const lines = []
  const active = state.projects.filter(p => p.status === 'active')
  const stopped = state.projects.filter(p => p.status === 'stopped')
  lines.push(`已立项：${state.projects.length} 个（进行中 ${active.length}，已停更 ${stopped.length}）`)
  active.forEach(p => lines.push(`  · 进行中《${p.name}》，已写 ${(p.docs || []).length}/${DOC_PLAN.length} 份文档`))
  stopped.forEach(p => lines.push(`  · 已停更《${p.name}》 —— ${p.stoppedWhy || '原因见 POSTMORTEM'}`))
  const flagged = state.projects.filter(p => p.status === 'flagged')
  flagged.forEach(p => lines.push(`  · 已标记待定《${p.name}》 —— 校验没过：${p.flaggedWhy || '见 AUDIT.md'}`))
  if (state.candidates.length) {
    lines.push(`候选方向 ${state.candidates.length} 个（来自 ${exploreRounds(state)} 轮探索）：`)
    state.candidates.forEach(c =>
      lines.push(`  · ${c.title}（${c.stars} 星｜赛道 ${laneName(c.lane)}）`))
  }
  if ((state.rejected || []).length) {
    lines.push(`已否决 ${state.rejected.length} 个：`)
    state.rejected.slice(0, 8).forEach(r => lines.push(`  · ${r.title} —— ${r.why || '撞了硬约束'}`))
  }
  if (state.recentActions.length) {
    lines.push(`最近做过：${state.recentActions.slice(-5).map(a => `${a.at.slice(5, 10)} ${a.action}`).join('、')}`)
  }
  return lines.join('\n') || '（还是一张白纸）'
}

// ---------------- 动作：探索 ----------------

const doExplore = async ({ charter, exploreView, state }) => {
  const covered = [
    ...state.candidates.map(c => c.title),
    ...state.projects.map(p => p.name)
  ].slice(0, 12)

  const file = exploreFile(today(), state.cycle)
  const cold = coldLanes(state)
  if (cold.length) log(`  没扫过的赛道：${cold.map(laneName).join('、')} —— 这一轮会要求覆盖`)

  // 先搜再判断。直接问模型「什么玩法有创新点」，它给的是所有人都会说的那几个。
  const { listed, hits, queries } = await gather(exploreView, covered, cold)

  log('  在扫方向…（深度思考，这一步慢，几分钟很正常）')
  const p = explorePrompt({
    charter: exploreView,
    stateSummary: summarize(state),
    coveredTitles: covered,
    rejected: state.rejected || [],
    lessons: await S.loadLessons() || '',
    laneCounts: laneHistogram(state),
    cold,
    material: listed
  })
  const out = await ask(p.system, p.user, p.opts)
  if (!out) { log(`  没拿到结果，这次跳过。原因：${ask.lastError}`); return null }

  const body = attachRefs(out, hits)
  const meta = `---\ndate: ${beijing()}\nqueries:\n${queries.map(q => `  - ${JSON.stringify(q)}`).join('\n') || '  []'}\nsources: ${hits.length}\n`

  if (/（这一轮没有值得立项的方向）/.test(out)) {
    log('  她判断这一轮没有值得立项的方向 —— 交白卷，这是允许的')
    await put(file,
      `${meta}result: blank\n---\n\n${body}\n`,
      '策划室：探索（这一轮交白卷）')
    return { action: 'explore', blank: true }
  }

  await put(file, `${meta}---\n\n${body}\n`, '策划室：探索记录')

  // 把方向抽成候选，进状态机。抽不出来不影响文档已经写下去。
  let fresh = parseDirections(out, file, beijing())

  fresh.forEach(f => {
    if (f.partial) log(`  ⚠️《${f.title}》缺了这几维的分：${f.partial.join('、')}，按 3 分算`)
    if (!f.lane) log(`  ⚠️《${f.title}》没标赛道 —— 按撞车处理，会被压到 2 星`)
    /* 主赛道不能是纯代码表现层。这一条是专门为「振刀」那一类留的：
     * 它们功能上都做得出来，但截图里看不见、面试时问三句就到底，
     * 两条评分维度同时归零。提示词里说过一遍，这里再拦一次 ——
     * 说过的话模型会忘，代码不会。 */
    if (f.lane && !mainOk(f.lane)) {
      log(`  ⚠️《${f.title}》主赛道是纯代码表现层 —— 压到 2 星（截图里看不见，面试问不深）`)
      f.stars = Math.min(f.stars, 2)
    }
  })

  const { candidates: checked, collisions } = dedupeLanes(fresh)
  collisions.forEach(c =>
    log(`  ⚠️ 赛道撞车：《${c.title}》和同轮另一个都是「${laneName(c.lane)}」，从 ${c.was} 星压到 2 星`))
  fresh = checked

  log(`  抽出 ${fresh.length} 个候选：`)
  fresh.forEach(f => log(`    · ${f.title}｜${laneName(f.lane)}｜${f.stars}★（辨 ${f.glance} 讲 ${f.talk} 完 ${f.ship} 独 ${f.unique}）`))
  if (!fresh.length) log('    （一个都没抽出来，去看原文 —— 多半是格式跑偏了）')

  state.candidates = [...fresh, ...state.candidates].slice(0, CANDIDATE_CAP)
  state.laneHistory = [...(state.laneHistory || []), ...fresh.map(f => f.lane).filter(Boolean)].slice(-60)
  return { action: 'explore', added: fresh.length }
}

// ---------------- 动作：横向评比 ----------------

/* 这一步是用来解死锁的，见文件头「毛病三」。
 *
 * 它不产出新方向，只做一件事：把攒下来的候选摆在一起排序，选出第一名。
 * 关键差别在于**相对判断**：「它够不够好」是个没有锚点的问题，
 * 模型会一直答「还差点」；「这十个里哪个最好」有锚点，必须有答案。 */
const doShortlist = async ({ charter, state }) => {
  const pool = state.candidates || []
  if (pool.length < 2) { log('  候选不够两个，没什么可比的'); return null }

  log(`  把 ${pool.length} 个候选摆在一起比一次 —— 相对排序，必须选出第一名`)
  const p = shortlistPrompt({
    charter,
    candidates: pool,
    rejected: state.rejected || [],
    lessons: await S.loadLessons() || ''
  })
  const out = await ask(p.system, p.user, p.opts)
  if (!out) { log(`  没拿到结果，这次跳过。原因：${ask.lastError}`); return null }

  const parsed = parseShortlist(out)
  const { body } = splitBody(out)
  await put(`${S.EXPLORE_DIR}/评比-${today()}-${state.cycle || 0}.md`,
    `---\ndate: ${beijing()}\nkind: shortlist\npool: ${pool.length}\nwinner: ${JSON.stringify(parsed?.winner || '')}\n---\n\n# 候选评比 · ${today()}\n\n${body || out}\n`,
    '策划室：候选横向评比')

  // 无论解析成不解析得出来，这批候选都算比过了 —— 否则下一轮又是同一批同一个结果
  state.lastShortlist = candidateFingerprint(pool)

  if (!parsed) {
    log('  读不出「第一名：」那一行，这次的评比只留了记录，没有改动候选池')
    return { action: 'shortlist', parsed: false }
  }

  /* 标题是模型照抄的，可能顺手改了个字。所以先精确匹配，
   * 匹配不上再退到「包含」——两头都试，比只试一头稳。 */
  const norm = s => clean(s).replace(/\s/g, '')
  const win = pool.find(c => norm(c.title) === norm(parsed.winner))
    || pool.find(c => norm(c.title).includes(norm(parsed.winner)) || norm(parsed.winner).includes(norm(c.title)))

  if (!win) {
    log(`  它选的第一名「${parsed.winner}」在候选池里找不到对应项，不动候选池`)
    return { action: 'shortlist', parsed: true, matched: false }
  }

  const rolled = rollup(parsed.dims)
  log(`  第一名：《${win.title}》 → 重打分 ${rolled.stars}★（辨 ${rolled.glance} 讲 ${rolled.talk} 完 ${rolled.ship} 独 ${rolled.unique}）`)

  const droppedTitles = new Set()
  ;(parsed.dropped || []).forEach(d => {
    const hit = pool.find(c => norm(c.title).includes(norm(d)) || norm(d).includes(norm(c.title)))
    if (hit) droppedTitles.add(hit.title)
  })
  if (droppedTitles.size) log(`  淘汰：${[...droppedTitles].join('、')}`)

  state.rejected = [
    ...[...droppedTitles].map(t => {
      const c = pool.find(x => x.title === t)
      return { title: t, lane: c?.lane || null, at: beijing(), verdict: '评比淘汰', why: '横向评比里排在后面，理由见评比记录' }
    }),
    ...(state.rejected || [])
  ].slice(0, 40)

  state.candidates = pool
    .filter(c => !droppedTitles.has(c.title))
    .map(c => c.title === win.title ? { ...c, ...rolled, shortlisted: beijing() } : c)
    /* 第一名排到最前面。decide 挑候选时按星级排序，但同星级时
     * 「评比选出来的那个」应该赢过「碰巧也是这个星级的那个」。 */
    .sort((a, b) => (b.title === win.title) - (a.title === win.title))

  return { action: 'shortlist', winner: win.title, stars: rolled.stars }
}

// ---------------- 动作：硬约束校验 ----------------

/* 立项前跑一次，也可以手动拿来重审已经立了的项目。
 *
 * 刻意做成独立的一次调用，而且换了审查员人设、不告诉它探索时给了几分 ——
 * 同一次生成里的自查等于没查，模型会检查出「没问题」。
 *
 * 返回 { verdict, why, text }。verdict 拿不到时返回 null，调用方按拦下处理
 * （解析不出来是工具的问题，但代价是让一个没校验过的方向进去，所以宁可拦）。 */
const runAudit = async ({ charter, subject, kind }) => {
  const p = auditPrompt({ charter, subject, kind, showcase: showcaseSection(charter) })
  const out = await ask(p.system, p.user, p.opts)
  if (!out) { log(`  校验没拿到结果。原因：${ask.lastError}`); return null }
  const parsed = parseAudit(out)
  if (!parsed) { log('  校验输出里找不到「判定：」那一行，按拦下处理'); return { verdict: '存疑', why: '校验输出格式不对，没能读出判定', text: out, passed: false } }
  return { ...parsed, text: out }
}

// ---------------- 动作：立项 ----------------

const doCharter = async ({ charter, state, candidate, forced = false }) => {
  log(`  立项候选：《${candidate.title}》${forced ? '（这是主人直接点的名）' : ''}`)
  log('  先过硬约束校验 —— 独立判断，不告诉它探索时给了几分')

  const audit = await runAudit({ charter, subject: candidate.title, kind: '候选方向' })
  if (!audit) { log('  校验跑不起来，这轮不立项（宁可不立，也不能立一个没校验过的）'); return null }

  /* 文件名带上轮次号：中文标题过 slugify 之后全被剥成 'project'，
   * 同一天否掉两个方向就会互相覆盖。 */
  await put(`${S.EXPLORE_DIR}/审查-${today()}-${state.cycle || 0}-${slugify(candidate.title)}.md`,
    `---\ndate: ${beijing()}\nsubject: ${JSON.stringify(candidate.title)}\nverdict: ${audit.verdict}\n---\n\n${audit.text}\n`,
    `策划室：校验「${candidate.title.slice(0, 20)}」→ ${audit.verdict}`)

  if (!audit.passed) {
    log(`\n  ✗ 校验${audit.verdict}：${audit.why || '（原因见审查记录）'}`)
    if (forced) {
      /* 他点名的方向也可能撞硬约束。这时候**不立**，但要把话说清楚 ——
       * 一声不吭地照办，等于把「审查」这一步废掉；一声不吭地拒绝，
       * 他会以为系统坏了。所以：不立，写清为什么，并告诉他怎么坚持。 */
      log('  这是你点名的方向，但它没过校验，所以这一轮不立项。')
      log('  校验记录已经写进 explore/ 了，去看看它否在哪一条。')
      log('  如果你看完仍然想做：把总纲里对应的那条硬约束改掉，再点一次。')
    } else {
      log('  这个方向不立项。它会从候选池里移除，并写进已否决清单 ——')
      log('  下次探索会带上它，换个名字端上来一样会被否。')
    }
    state.candidates = state.candidates.filter(c => c.title !== candidate.title)
    state.rejected = [
      { title: candidate.title, lane: candidate.lane || null, at: beijing(), verdict: audit.verdict, why: audit.why },
      ...(state.rejected || [])
    ].slice(0, 40)
    return { action: 'charter-rejected', title: candidate.title }
  }

  log(`  ✓ 校验通过。开始写立项书。`)
  const p = charterPrompt({
    charter,
    candidate: `${candidate.title}\n\n（赛道：${laneName(candidate.lane)}）\n（已通过硬约束校验。审查员的结论摘要：${audit.why || '未发现致命冲突'}）`
  })
  const out = await ask(p.system, p.user, p.opts)
  if (!out) { log(`  没拿到结果，这次跳过。原因：${ask.lastError}`); return null }

  const { head, body: rawBody } = splitBody(out)
  const { body, experiments } = parseExperiments(rawBody)
  const name = (head.match(/^\s*名称\s*[:：]\s*(.+)$/m) || [])[1] || candidate.title
  const rawSlug = (head.match(/^\s*标识\s*[:：]\s*(.+)$/m) || [])[1] || name
  const lane = (head.match(/^\s*赛道\s*[:：]\s*(.+)$/m) || [])[1]?.trim() || candidate.lane || null
  const seq = String(state.projects.length + 1).padStart(2, '0')
  const id = `P${seq}-${slugify(rawSlug)}`

  if (body.length < 600) { log('  产出太短，不像一份立项书，丢掉'); return null }

  await put(`${S.projectDir(id)}/00-pitch.md`,
    `---\ntitle: ${JSON.stringify(name.trim())}\ndoc: 立项书\ncreated: ${beijing()}\nrevision: 1\n---\n\n${body}\n`,
    `策划室：立项《${name.trim().slice(0, 24)}》`)

  await putJson(`${S.projectDir(id)}/meta.json`, {
    id, name: name.trim(), status: 'active', lane,
    createdAt: beijing(), updatedAt: beijing(),
    docs: ['00-pitch.md'],
    revisions: {}, negativeStreak: 0,
    fromCandidate: candidate.title
  }, `策划室：${id} 元数据`)

  await put(`${S.projectDir(id)}/CHANGELOG.md`,
    `# 修订记录 · ${name.trim()}\n\n## ${today()} · 立项\n\n从探索候选「${candidate.title}」立项。写了 00-pitch.md。\n`,
    `策划室：${id} 修订记录`)

  await soft('登记实验', () => registerExperiments(id, '00-pitch.md', experiments))

  state.projects.push({
    id, name: name.trim(), status: 'active', lane,
    docs: ['00-pitch.md'], createdAt: beijing(), negativeStreak: 0
  })
  state.candidates = state.candidates.filter(c => c.title !== candidate.title)
  return { action: 'charter', id, name: name.trim() }
}

/* 重审一个已经立了的项目。
 *
 * 判否决时**不自动停更** —— 停不停是主人的决定，不是审查员的。
 * 但会把状态标成 flagged，这样 decide() 不会再往里投入深化的成本，
 * 相当于先按下暂停。 */
const doAudit = async ({ charter, state, project }) => {
  log(`  重审《${project.name}》`)
  const full = await S.projectFullText(project.id, { limit: 40000 })
  if (!full || full.length < 200) { log('  读不到这个项目的文档，没法审'); return null }

  const audit = await runAudit({ charter, subject: full, kind: '已立项的项目' })
  if (!audit) return null

  await put(`${S.projectDir(project.id)}/AUDIT.md`,
    `---\ndate: ${beijing()}\nverdict: ${audit.verdict}\n---\n\n# 硬约束校验 · ${today()}\n\n${audit.text}\n`,
    `策划室：${project.id} 硬约束校验 → ${audit.verdict}`)

  if (audit.passed) {
    log(`\n  ✓ 校验通过 —— 这个项目在硬约束内成立，继续。`)
    return { action: 'audit', verdict: audit.verdict, id: project.id }
  }

  log(`\n  ✗ 校验${audit.verdict}：${audit.why || '（原因见 AUDIT.md）'}`)
  log('  已把它标成 flagged —— 不会再自动深化，省得继续往里砸文档。')
  log('  接下来是你的决定：')
  log(`    想停 → 手动跑一次 postmortem，会写一份停更说明`)
  log(`    想继续 → 把 projects/${project.id}/meta.json 里的 status 改回 active`)

  project.status = 'flagged'
  project.flaggedWhy = audit.why
  await syncMeta(project)
  return { action: 'audit', verdict: audit.verdict, id: project.id, flagged: true }
}

// ---------------- 动作：深化 ----------------

const doExpand = async ({ charter, state, project }) => {
  const existing = project.docs || []
  const doc = nextDoc(existing)
  if (!doc) { log(`  《${project.name}》${DOC_PLAN.length} 份文档已经写全了`); return null }

  log(`  深化《${project.name}》→ ${doc.name}（${doc.file}）`)
  const [existingDocs, changelog, evidence] = await Promise.all([
    S.projectFullText(project.id),
    S.readText(`${S.projectDir(project.id)}/CHANGELOG.md`),
    S.evidenceText(project.id)
  ])
  if (evidence) log('  带上了已经跑出结果的实验 —— 一手数据会压过之前的推理')

  const p = expandPrompt({ charter, project, doc, existingDocs, changelog, evidence })
  const out = await ask(p.system, p.user, p.opts)
  if (!out) { log(`  没拿到结果，这次跳过。原因：${ask.lastError}`); return null }
  const { body, experiments } = parseExperiments(out)
  if (body.length < 800) { log('  产出太短，不像一份正经文档，丢掉'); return null }

  await put(`${S.projectDir(project.id)}/${doc.file}`,
    `---\ntitle: ${JSON.stringify(doc.name)}\ndoc: ${doc.name}\ncreated: ${beijing()}\nrevision: 1\n---\n\n${body}\n`,
    `策划室：《${project.name.slice(0, 20)}》${doc.name}`)

  const added = await soft('登记实验', () => registerExperiments(project.id, doc.file, experiments))

  // 模型如果发现了和前文的冲突，会单开一节。把它抬到日志里，别让它埋在文档最后。
  const conflict = body.match(/##\s*与前文的冲突[\s\S]*/)
  if (conflict) {
    log('  ⚠️ 她发现这份文档和前面写过的东西有冲突：')
    log(conflict[0].split('\n').slice(0, 12).map(l => '     ' + l).join('\n'))
  }

  project.docs = [...existing, doc.file]
  await soft('追加修订记录', () => appendChangelog(project,
    `## ${today()} · 新增 ${doc.name}\n\n写了 ${doc.file}。` +
    `${added ? `\n\n登记了 ${added} 条待验证实验，去「实验台」看。` : ''}` +
    `${conflict ? '\n\n⚠️ 本次发现与前文有冲突，见文档末尾。' : ''}`))
  await syncMeta(project)
  return { action: 'expand', id: project.id, doc: doc.file, conflict: !!conflict }
}

// ---------------- 动作：修订 ----------------

/* 这条反馈到底该改哪一份文档。
 *
 * 反馈可能挂在**不是策划文档**的文件上：CHANGELOG.md、POSTMORTEM.md、AUDIT.md
 * 在页面上一样点得开、留得了言 —— 而且他真的对 POSTMORTEM 留过言。
 *
 * 这些文件绝对不能被当成修订目标覆盖掉：
 * CHANGELOG 是全部修订历史，一次覆盖就没了，
 * 而且 appendChangelog 接着还会往那片废墟上继续追加。
 * 所以遇到这种情况的处理是「意见收下，落到最近的一份正经策划文档上」。
 *
 * 导出是为了能单测 —— 这是个「错了不报错、只是历史悄悄没了」的地方。 */
export const reviseTarget = (project, requested) => {
  const inPlan = f => !!docByFile(f)
  if (inPlan(requested)) return requested
  return (project.docs || []).filter(inPlan).pop() || '00-pitch.md'
}

const doRevise = async ({ charter, state, project, items }) => {
  // 一次只改一份文档 —— 同一轮里改多份，很容易越改越不一致
  const requested = items[0].file || '00-pitch.md'
  const forThisFile = items.filter(x => (x.file || '00-pitch.md') === requested)

  const targetFile = reviseTarget(project, requested)
  if (targetFile !== requested) {
    log(`  这条反馈挂在 ${requested} 上 —— 那不是一份可改写的策划文档（改了会把历史覆盖掉）`)
    log(`  改成把这条意见落到 ${targetFile}`)
  }

  log(`  修订《${project.name}》的 ${targetFile}，处理 ${forThisFile.length} 条反馈`)
  const [targetText, existingDocs, changelog, evidence] = await Promise.all([
    S.readText(`${S.projectDir(project.id)}/${targetFile}`),
    S.projectFullText(project.id),
    S.readText(`${S.projectDir(project.id)}/CHANGELOG.md`),
    S.evidenceText(project.id)
  ])
  if (!targetText) { log(`  读不到 ${targetFile}，跳过`); return null }

  const feedbacks = forThisFile.map((x, i) => {
    const from = x.file && x.file !== targetFile ? `（他是在读 ${x.file} 的时候写的）` : ''
    return x.kind === 'experiment'
      ? `[${i + 1}] ${x.at || ''} **这是他真的做出来的实验结果，不是意见**${from}\n实验：${x.claim || ''}\n结果：${x.result || ''}\n他的说明：${x.note || '（没写）'}`
      : `[${i + 1}] ${x.at || ''} 评价：${x.verdict || '未评级'}${from}\n${x.note || '（没写文字说明）'}`
  }).join('\n\n')

  const p = revisePrompt({ charter, project, targetFile, targetText, feedbacks, existingDocs, changelog, evidence })
  const out = await ask(p.system, p.user, p.opts)
  if (!out) { log(`  没拿到结果，这次跳过。原因：${ask.lastError}`); return null }

  const { head, body: rawBody } = splitBody(out)
  const note = splitBody(head, '===修订说明===').body || head
  const { body } = parseExperiments(rawBody)
  if (body.length < 500) { log('  改出来的正文太短，不敢覆盖，丢掉'); return null }

  const rev = (project.revisions?.[targetFile] || 1) + 1
  await put(`${S.projectDir(project.id)}/${targetFile}`,
    `---\ntitle: ${JSON.stringify(docByFile(targetFile)?.name || targetFile)}\ndoc: ${docByFile(targetFile)?.name || targetFile}\nrevision: ${rev}\nrevisedAt: ${beijing()}\n---\n\n${body}\n`,
    `策划室：修订《${project.name.slice(0, 20)}》${targetFile}（第 ${rev} 版）`)

  await soft('追加修订记录', () => appendChangelog(project,
    `## ${today()} · 修订 ${targetFile}（第 ${rev} 版）\n\n**主人的输入**\n\n${forThisFile.map(x => x.kind === 'experiment'
      ? `- 实验结果（${x.result || ''}）：${(x.note || '').slice(0, 200)}`
      : `- ${x.verdict || ''}：${(x.note || '').slice(0, 200)}`).join('\n')}\n\n**怎么改的**\n\n${note}`))

  project.revisions = { ...(project.revisions || {}), [targetFile]: rev }

  /* 负面连击计数：连续负面到阈值就该考虑停了。
   * 实验结果不算「负面反馈」—— 一条被证伪的实验是**信息**，不是不满意。
   * 混在一起数的话，一个认真做验证的项目会因为诚实而被推向停更。 */
  const opinions = forThisFile.filter(x => x.kind !== 'experiment')
  if (opinions.length) {
    const negative = opinions.some(x => ['可行性差', '停掉', '一般'].includes(x.verdict))
    project.negativeStreak = negative ? (project.negativeStreak || 0) + 1 : 0
  }
  await syncMeta(project)

  return { action: 'revise', id: project.id, file: targetFile, handled: forThisFile.map(x => x.id) }
}

// ---------------- 动作：停更 ----------------

const doPostmortem = async ({ charter, state, project, items }) => {
  /* 主人有没有明确点过「停掉」。这个区别第一版没有，代价不小：
   *
   *   「负面连击到阈值」是**代码推断**他可能不想要了 —— 该不该停由模型判断。
   *   「他点了停掉」   是**他直接说的**       —— 那就不是判断题。
   *
   * 第一版把两种混成一种，于是出现了：他点停掉 → 模型回「结论：继续做」→
   * 这条反馈还被标成已处理。他的话被投票投掉了，而且投完就没了。 */
  const forced = items.some(x => x.verdict === '停掉')

  log(`  停更评估：《${project.name}》（负面连击 ${project.negativeStreak} 次${forced ? '，主人已明确说停掉' : ''}）`)
  if (forced) log('  这是他直接下的决定，不是判断题 —— 只写为什么走不通，不投票')

  const [existingDocs, changelog] = await Promise.all([
    S.projectFullText(project.id),
    S.readText(`${S.projectDir(project.id)}/CHANGELOG.md`)
  ])
  const feedbacks = items.map(x => `- ${x.at || ''} ${x.verdict || ''}：${x.note || ''}`).join('\n') || '（没有文字反馈，只是长期没有进展）'

  const p = postmortemPrompt({ charter, project, existingDocs, feedbacks, changelog, forced })
  const out = await ask(p.system, p.user, p.opts)
  if (!out) { log(`  没拿到结果，这次跳过。原因：${ask.lastError}`); return null }

  const { head, body } = splitBody(out)
  // 他说停就是停。模型的结论只在他没明说的时候才算数。
  const stop = forced || /停更/.test(head)

  if (!stop) {
    log('  结论：继续做。负面连击清零，接下来按她给的三步走')
    await soft('追加修订记录', () => appendChangelog(project, `## ${today()} · 停更评估：继续\n\n${body}`))
    project.negativeStreak = 0
    await syncMeta(project)
    return { action: 'postmortem-continue', id: project.id, handled: items.map(x => x.id) }
  }

  log('  结论：停更')
  await put(`${S.projectDir(project.id)}/POSTMORTEM.md`,
    `---\ntitle: 停更说明\ndoc: 停更说明\ncreated: ${beijing()}\n---\n\n${body}\n`,
    `策划室：《${project.name.slice(0, 20)}》停更`)
  await soft('追加修订记录', () => appendChangelog(project, `## ${today()} · 停更\n\n见 POSTMORTEM.md。`))

  /* 抽一句话当摘要。优先抓「一句话教训」那一节 ——
   * 第一版抓的是「为什么停」下面的第一行，抓出来是一整段带 ** 的粗体，
   * 截到 80 字之后是半句话，在列表里很难看，也不能拿去检查别的方向。 */
  const lesson = clean(
    (body.match(/##\s*一句话教训\s*\n+([^\n#]+)/) || [])[1] ||
    (body.match(/##\s*为什么停\s*\n+([^\n#]+)/) || [])[1] || ''
  ).slice(0, 120)

  project.status = 'stopped'
  project.stoppedAt = beijing()
  project.stoppedWhy = lesson
  await syncMeta(project)

  /* 死掉的项目必须进两个地方，第一版一个都没进：
   *
   *   rejected  —— 下一轮探索会带着它跑，防止换个名字再端上来
   *   lessons   —— 长期记忆。候选池会滚动淘汰，教训不该跟着一起被忘掉
   *
   * 第一版停更之后只改了 status，于是「居合」死了，但下一轮探索的
   * 已否决清单里没有它，模型完全可以再提一个近亲方向。 */
  state.rejected = [
    { title: project.name, lane: project.lane || null, at: beijing(), verdict: '做过并停更', why: lesson },
    ...(state.rejected || [])
  ].slice(0, 40)

  if (!DRY) {
    await soft('记教训', () => S.appendLesson(
      `## ${today()} · 《${project.name}》停更\n\n` +
      `**教训**：${lesson || '（模型没写出一句话教训，去 POSTMORTEM.md 里看）'}\n\n` +
      `赛道：${laneName(project.lane)}｜写到第 ${(project.docs || []).length} 份文档｜` +
      `详见 projects/${project.id}/POSTMORTEM.md`,
      `策划室：记下《${project.name.slice(0, 16)}》的教训`))
    log('  已经把这一条写进 lessons.md —— 以后每一轮探索都会带着它跑')
  }

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

/** 把一份文档末尾抽出来的实验条目登记进实验台。返回登记了几条。 */
const registerExperiments = async (projectId, file, experiments) => {
  if (!experiments?.length) return 0
  if (DRY) { log(`  [演练] 会登记 ${experiments.length} 条实验`); return experiments.length }
  const data = await S.loadExperiments(projectId)
  const items = data.items || []
  const fresh = experiments.map((e, i) => ({
    id: `EXP-${String(items.length + i + 1).padStart(2, '0')}`,
    from: file, ...e,
    status: 'pending', result: '', note: '', at: beijing(), doneAt: ''
  }))
  await S.saveExperiments(projectId, { ...data, project: projectId, items: [...items, ...fresh] },
    `策划室：${projectId} 登记 ${fresh.length} 条实验`)
  log(`  登记了 ${fresh.length} 条待验证实验：`)
  fresh.forEach(f => log(`    · ${f.id} ${f.claim.slice(0, 40)}（${f.cost || '成本未写'}）`))
  return fresh.length
}

// ---------------- 反馈的前置处理（不花模型钱的那几种） ----------------

/* 主人对候选方向的直接指令。
 *
 * 为什么要有这条通道：第一版里他唯一的入口是「读完某份文档给个评价」——
 * 也就是说**必须先立项，他才说得上话**。而立项恰恰是最贵、最难回头的一步。
 * 结果就是他只能在事后表达不满（连点两次「停掉」），而不能在方向阶段拦一下。
 *
 * ⚠️ 三种投票**全部**在这里当场消化掉，一条都不留给 decide。这一点很重要：
 *
 * 早一版的做法是「就它了」不在这里处理，留给 decide 变成一个 charter 计划。
 * 那样有个隐蔽的死法：活跃项目已经满员时，decide 走不到 charter 分支，
 * 于是这条投票既没被执行、也没被标已处理 —— 而它的优先级是最高的，
 * 结果**每一轮都会先被它短路**，实验结果、停掉、文档反馈全部饿死。
 * 一条点错的投票能把整套系统锁死，只能手改 inbox.json 才能救回来。
 *
 * 现在「就它了」被翻译成候选池里的一个状态（pinned），而不是一个动作：
 *   - 投票当场消化，绝不会卡住后面的优先级
 *   - 满员时它就在池子里等着，一有空位立刻立项，不用他再点一次
 *   - 连点两次只是重复置位，不会立出两个一模一样的项目
 */
const applyVotes = async (state, inbox) => {
  const votes = (inbox.items || []).filter(x => !x.handled && x.kind === 'candidate'
    && ['boost', 'drop', 'pick'].includes(x.action))
  if (!votes.length) return 0

  const norm = s => clean(s).replace(/\s/g, '')
  const find = title => (state.candidates || []).find(c => norm(c.title) === norm(title))
    || (state.candidates || []).find(c => norm(c.title).includes(norm(title)))

  votes.forEach(v => {
    const hit = find(v.title)

    if (v.action === 'pick') {
      /* 他点名的方向可以不在候选池里（他自己想的，或者刚被评比淘汰掉的）。
       * 这种情况直接给它造一条候选 —— 拒绝执行不是这套系统该有的态度，
       * 该拦的地方是立项前那次独立的硬约束校验，不是这里。 */
      const target = hit || {
        title: v.title, lane: v.lane || null, stars: 5,
        from: `主人指定 ${today()}`, at: beijing()
      }
      target.pinned = true
      target.pinnedAt = beijing()
      target.stars = 5
      if (!hit) state.candidates = [target, ...(state.candidates || [])].slice(0, CANDIDATE_CAP)
      log(`  主人点名要立《${target.title}》—— 已置顶，下一次有空位就立项`)
    } else if (!hit) {
      /* 找不到对应候选也要标已处理。
       * 不标的话它会永远挂在待处理里（页面上那个红点永远消不掉），
       * 而且每一轮都会重新打印一遍「找不到」。
       * 这种情况真实存在：先点否掉再点加一星、或者投的那个刚被评比淘汰。 */
      log(`  投票找不到对应候选：「${v.title}」（多半已经被淘汰或滚出候选池了），跳过`)
    } else if (v.action === 'boost') {
      hit.stars = Math.min(5, (hit.stars || 3) + 1)
      hit.boostedBy = '主人'
      log(`  主人给《${hit.title}》加了一星 → ${hit.stars}★`)
    } else {
      state.candidates = state.candidates.filter(c => c !== hit)
      state.rejected = [
        { title: hit.title, lane: hit.lane || null, at: beijing(), verdict: '主人否决', why: v.note || '主人在页面上直接否掉了' },
        ...(state.rejected || [])
      ].slice(0, 40)
      log(`  主人否掉了《${hit.title}》，已进否决清单`)
    }
    v.handled = true
    v.handledAt = beijing()
  })
  return votes.length
}

/* 实验结果回填。
 *
 * 这条不标已处理 —— 写进实验台之后，它还要以「一手证据」的身份
 * 触发一次修订（见 decide 第 1 优先级），修订完了才算处理完。 */
const ingestExperiments = async (state, inbox) => {
  const results = (inbox.items || []).filter(x => !x.handled && x.kind === 'experiment' && x.expId)
  if (!results.length) return 0
  const byProject = new Map()
  results.forEach(r => {
    if (!byProject.has(r.project)) byProject.set(r.project, [])
    byProject.get(r.project).push(r)
  })
  for (const [pid, items] of byProject) {
    const data = await S.loadExperiments(pid)
    let touched = 0
    data.items = (data.items || []).map(e => {
      const hit = items.find(r => r.expId === e.id)
      if (!hit) return e
      touched++
      // 反馈里没写目标文档时，用实验来自哪一份文档兜底 —— 修订要有个落点
      if (!hit.file) hit.file = e.from
      hit.claim = e.claim
      return { ...e, status: 'done', result: hit.result || '', note: hit.note || '', doneAt: beijing() }
    })
    if (touched && !DRY) await S.saveExperiments(pid, data, `策划室：${pid} 回填 ${touched} 条实验结果`)
    log(`  ${pid}：回填了 ${touched} 条实验结果 —— 这是一手数据，接下来会据此修订`)
  }
  return results.length
}

/* 挂在已停更 / 已标记项目上的反馈。
 *
 * 第一版这些反馈会**永远悬着**：decide 只遍历 active 项目，
 * 所以一条挂在 stopped 项目上的反馈既不会被处理，也不会消失，
 * 页面上永远显示「有 1 条待处理」。实测里就有这么一条 ——
 * 他对停更说明回了句「虽然停掉了，但依然有利用价值」，然后它就卡在那儿了。
 *
 * 处理方式是归档，不调模型：追加进那个项目的 CHANGELOG，
 * 正面评价额外抄进 lessons.md（对停更说明的肯定，是对判断方式的肯定，值得留）。 */
const absorbOrphans = async (state, inbox) => {
  const alive = new Set(state.projects.filter(p => p.status === 'active').map(p => p.id))
  const orphans = (inbox.items || []).filter(x => !x.handled
    && x.kind !== 'candidate'
    && x.project && !alive.has(x.project))
  if (!orphans.length) return 0

  const byProject = new Map()
  orphans.forEach(x => {
    if (!byProject.has(x.project)) byProject.set(x.project, [])
    byProject.get(x.project).push(x)
  })

  for (const [pid, items] of byProject) {
    const project = state.projects.find(p => p.id === pid)
    if (!project) { items.forEach(x => { x.handled = true; x.handledAt = beijing() }); continue }
    log(`  归档 ${items.length} 条挂在《${project.name}》（${project.status}）上的反馈 —— 这个项目已经不在推进中`)
    await soft('追加归档记录', () => appendChangelog(project,
      `## ${today()} · 归档反馈（项目已${project.status === 'stopped' ? '停更' : '标记待定'}）\n\n` +
      items.map(x => `- ${x.verdict || x.result || ''}：${(x.note || '').slice(0, 300)}`).join('\n')))
    const praise = items.filter(x => x.verdict === '很有搞头' && (x.note || '').length > 8)
    if (praise.length && !DRY) {
      await soft('记教训', () => S.appendLesson(
        `## ${today()} · 主人对《${project.name}》的收尾评价\n\n` +
        praise.map(x => `> ${x.note}`).join('\n>\n') +
        `\n\n（项目已停更。他仍然认可这次的判断方式 —— 说明「早停 + 写清为什么」这条路走对了。）`,
        `策划室：归档《${project.name.slice(0, 16)}》的收尾评价`))
    }
    items.forEach(x => { x.handled = true; x.handledAt = beijing() })
  }
  return orphans.length
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
  const active = state.projects.filter(p => p.status === 'active')
  const activeIds = new Set(active.map(p => p.id))

  /* 只看挂在活跃项目上的反馈。挂在别处的由 absorbOrphans 归档掉了，
   * 但单测会直接调 decide，所以这里也要挡一道 —— 两处都挡，
   * 是因为「一条反馈永远悬着」这个毛病的代价是页面上一个永不消失的红点。 */
  const live = pending.filter(x => x.project && activeIds.has(x.project))
  const byProject = new Map()
  live.forEach(x => {
    if (!byProject.has(x.project)) byProject.set(x.project, [])
    byProject.get(x.project).push(x)
  })

  /* 0. 主人点名置顶的方向 → 立刻立项（仍然要过一次独立的硬约束校验）。
   *
   * 置顶是 applyVotes 写进候选的一个状态，不是一条待办 —— 这个区别很关键：
   * 满员的时候它只是「暂时轮不到」，会安静地留在池子里等空位，
   * 而不会像一条永远处理不掉的待办那样把后面所有优先级饿死。
   *
   * 它跳过的是「扫够几轮」这道等待门槛。那道门是用来拦模型自嗨的，
   * 不是用来拦他的 —— 他有权直接下注。 */
  if (active.length < MAX_ACTIVE) {
    const pinned = (state.candidates || []).find(c => c.pinned)
    if (pinned) return { kind: 'charter', candidate: pinned, forced: true }
  }

  /* 1. 有实验跑出了真实结果 → 立刻据此修订。
   *
   * 排在停更评估前面是故意的：一条实验结果可能正好推翻了「该停」的理由，
   * 也可能坐实它。无论哪种，**先把数据吃进文档**，再谈停不停。
   * 反过来的话，一个项目可能在它自己的验证结果被读进去之前就被停掉了。 */
  for (const p of active) {
    const items = (byProject.get(p.id) || []).filter(x => x.kind === 'experiment')
    if (items.length) return { kind: 'revise', project: p, items, why: '有实验跑出了真实结果 —— 一手数据优先' }
  }

  // 2. 主人明确说停掉的，或者负面连击到阈值的 → 停更评估
  for (const p of active) {
    const items = byProject.get(p.id) || []
    const explicitStop = items.some(x => x.verdict === '停掉')
    if (explicitStop || (p.negativeStreak || 0) >= POSTMORTEM_THRESHOLD) {
      return { kind: 'postmortem', project: p, items }
    }
  }

  // 3. 有反馈没处理 → 修订
  for (const p of active) {
    const items = byProject.get(p.id) || []
    if (items.length) return { kind: 'revise', project: p, items }
  }

  // 4. 有立项、文档没写完 → 深化（先做文档最少的那个）
  const unfinished = active
    .filter(p => (p.docs || []).length < DOC_PLAN.length)
    .sort((a, b) => (a.docs || []).length - (b.docs || []).length)
  if (unfinished.length) return { kind: 'expand', project: unfinished[0] }

  const rounds = exploreRounds(state)
  const pool = state.candidates || []

  /* 5. 立项。
   *
   * 星级现在是四维分汇总出来的（短板封顶），不再是模型对自己的信心复读。
   * 但它仍然只是**排序依据**，不是唯一的门槛 ——
   * 真正的门槛是这里的「扫够了没有」和 doCharter 里那次独立的硬约束校验。 */
  if (active.length < MAX_ACTIVE) {
    const worthy = pool.filter(c => c.stars >= 4).sort((a, b) => b.stars - a.stars)
    if (worthy.length) {
      if (rounds < MIN_EXPLORE_ROUNDS) {
        return { kind: 'explore', why: `候选只来自 ${rounds} 轮探索，不足 ${MIN_EXPLORE_ROUNDS} 轮，先接着扫` }
      }
      return { kind: 'charter', candidate: worthy[0] }
    }

    /* 6. 候选攒够了、轮数也够了，但一个 4 星都没有 → 横向评比。
     *
     * 这一步是用来解死锁的。绝对分做门槛必然会卡住：
     * 「它够不够好」这个问题没有锚点，模型会一直答「还差点」，
     * 于是一周三次全都花在探索上，候选越攒越多，一个也立不了 ——
     * 实测就是这么卡住的（六轮，十个候选，最高 3 星）。
     *
     * 换成相对判断就有锚点了：「这十个里哪个最好」必须有答案。
     * 指纹是为了防止同一批候选被反复评比 —— 那会变成一个更贵的新死锁。 */
    if (pool.length >= SHORTLIST_AT && rounds >= MIN_EXPLORE_ROUNDS) {
      if (candidateFingerprint(pool) !== state.lastShortlist) {
        return { kind: 'shortlist', why: `攒了 ${pool.length} 个候选（${rounds} 轮）但没有一个够格 —— 别再扫了，摆一起比一次` }
      }
      return { kind: 'explore', why: '这批候选刚比过，第一名还是不够格 —— 补几个新的再比' }
    }
  }

  // 7. 兜底 → 探索
  return { kind: 'explore' }
}

const PLAN_LABEL = {
  explore: '探索新方向', charter: '立项', expand: '深化文档',
  revise: '处理反馈并修订', postmortem: '停更评估', audit: '硬约束校验',
  shortlist: '候选横向评比'
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

  const charterRaw = await S.readText(S.CHARTER)
  if (!charterRaw || charterRaw.replace(/\s/g, '').length < 200) {
    log(`\n  ${S.REPO} 里的 ${S.CHARTER} 还没写（或者太短）。`)
    log('  总纲是这套东西唯一的地基 —— 没有它，产出的一定是通用废话。')
    log('  仓库里应该有一份 charter.md 模板，照着填就行。')
    return
  }

  /* 探索阶段看到的总纲，和设计阶段看到的不是同一份。
   *
   * 探索时「他的个人口味」那一节被整节删掉 —— 不是加一句「别看这段」，
   * 是那段字根本不进上下文。原因见 charterlens.mjs 文件头：
   * 第一版在提示词里反复强调「那一节是用来排除的」，
   * 结果第一轮扫出来的三个方向全是那一节里那个例子的变体。
   * 注意力不受指令控制。 */
  const charter = forDesign(charterRaw)
  const { text: exploreView, dropped } = forExplore(charterRaw)
  if (dropped.length) log(`  探索视图：已摘掉「${dropped.join('、')}」${dropped.length ? '（这个作品不是做给他自己玩的）' : ''}`)

  const state = await S.loadState()
  const inbox = await S.loadInbox()

  log(`\n  当前状态：\n${summarize(state).split('\n').map(l => '    ' + l).join('\n')}`)

  // ── 前置处理：不需要花模型钱的那几种输入，先在这儿消化掉 ──
  const voted = await applyVotes(state, inbox)
  const ingested = await ingestExperiments(state, inbox)
  const archived = await absorbOrphans(state, inbox)
  if (voted || ingested || archived) {
    log(`  前置处理：候选投票 ${voted} 条、实验回填 ${ingested} 条、归档 ${archived} 条`)
  }

  const pending = S.pendingFeedback(inbox)
  if (pending.length) log(`  待处理反馈：${pending.length} 条`)

  /* 强制指定时，「拿哪个项目」也得跟着变。
   *
   * audit 是用来补查老项目的，postmortem 是用来给审查没过的项目收尾的 ——
   * 而校验没过的项目状态是 flagged。这两个只找 active 的话就永远够不着它，
   * 那 doAudit 里印的那句「想停就手动跑 postmortem」就成了句空话。 */
  const pickProject = () => (['audit', 'postmortem'].includes(FORCE)
    ? state.projects.find(p => p.status === 'active' || p.status === 'flagged')
    : state.projects.find(p => p.status === 'active'))

  let plan
  if (FORCE) {
    const forProject = pickProject()
    /* 强制模式下也只能拿**这个项目自己的**反馈。
     * 不过滤的话会出这种事：手动跑一次 revise，两个项目都活着，
     * 待处理的反馈全是给 P02 的 —— 它会拿 P02 的反馈去改 P01 的文档，
     * 然后把那些反馈标成已处理。他的输入没了，而且用错了地方。
     * postmortem 更严重：一条给 P02 的「停掉」会把 P01 停掉。 */
    const mine = forProject ? pending.filter(x => x.project === forProject.id) : []
    plan = {
      kind: FORCE, project: forProject, items: mine,
      candidate: (state.candidates || []).find(c => c.pinned) || state.candidates[0],
      forced: FORCE === 'charter'
    }
  } else {
    plan = decide({ state, pending })
  }

  // 置顶了但轮不上：说清楚，否则他会以为那一票没生效
  const waiting = (state.candidates || []).find(c => c.pinned)
  if (waiting && plan.kind !== 'charter') {
    log(`  （你点名的《${waiting.title}》已经置顶排着 —— 活跃项目满了，`)
    log(`    停掉或写完一个之后它会自动排到最前面，不用再点一次）`)
  }

  if (plan.kind === 'revise' && !(plan.items || []).length) {
    log('\n  强制了修订，但这个项目没有待处理的反馈 —— 没东西可改，这轮跳过。')
    return
  }

  log(`\n  这次做：${PLAN_LABEL[plan.kind] || plan.kind}${plan.why ? `\n  （${plan.why}）` : ''}\n`)

  let result = null
  if (plan.kind === 'explore') result = await doExplore({ charter, exploreView, state })
  else if (plan.kind === 'shortlist') result = await doShortlist({ charter, state })
  else if (plan.kind === 'charter' && plan.candidate) result = await doCharter({ charter, state, candidate: plan.candidate, forced: plan.forced })
  else if (plan.kind === 'expand' && plan.project) result = await doExpand({ charter, state, project: plan.project })
  else if (plan.kind === 'revise' && plan.project) result = await doRevise({ charter, state, project: plan.project, items: plan.items })
  else if (plan.kind === 'postmortem' && plan.project) result = await doPostmortem({ charter, state, project: plan.project, items: plan.items })
  else if (plan.kind === 'audit' && plan.project) result = await doAudit({ charter, state, project: plan.project })
  else { log('  没有可执行的动作（多半是强制了一个当前没条件跑的模式）'); return }

  // 前置处理动过 inbox 的话，即使这一轮的主动作没产出，也得把它存回去
  const handled = new Set(result?.handled || [])

  if (!DRY && (handled.size || voted || archived)) {
    inbox.items = (inbox.items || []).map(x =>
      handled.has(x.id) ? { ...x, handled: true, handledAt: beijing() } : x)
    await S.saveInbox(inbox, `策划室：处理了 ${handled.size + voted + archived} 条输入`)
  }

  if (!result) {
    log('\n  这一轮没有产出。状态不变，下次再来。')
    if (!DRY && (voted || archived)) await S.saveState(state, '策划室：处理了页面上的输入')
    return
  }

  state.cycle = (state.cycle || 0) + 1
  state.recentActions = [...(state.recentActions || []), { at: beijing(), action: plan.kind }].slice(-20)
  // 项目的最新状态回写进 state
  if (plan.project) {
    state.projects = state.projects.map(p => p.id === plan.project.id ? { ...p, ...plan.project } : p)
  }

  /* 算一次「下一轮会做什么」存进 state，页面上直接显示。
   *
   * 为什么值得多算这一次：这套东西一周只醒三次，中间那两天他能看到的
   * 只有一堆文档。写上一句「下次会做：深化《X》的核心循环」，
   * 他就知道现在给反馈还来不来得及插队 —— 而反馈插队正是这套东西的关键设计。 */
  try {
    const next = decide({ state, pending: S.pendingFeedback(inbox) })
    state.nextPlan = {
      kind: next.kind,
      label: PLAN_LABEL[next.kind] || next.kind,
      target: next.project?.name || next.candidate?.title || '',
      doc: next.kind === 'expand' && next.project ? (nextDoc(next.project.docs || [])?.name || '') : '',
      why: next.why || '',
      at: beijing()
    }
    log(`\n  下一轮预计：${state.nextPlan.label}${state.nextPlan.target ? ` · ${state.nextPlan.target}` : ''}${state.nextPlan.doc ? ` · ${state.nextPlan.doc}` : ''}`)
  } catch (e) {
    state.nextPlan = null
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
