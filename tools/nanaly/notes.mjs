// 生成娜娜莉的段落批注。
//
// 她把每篇文章从头读一遍，挑两三个地方留一句旁注 —— 补一个前提、
// 指一处她觉得没讲清楚的、或者接一句自己的看法。
// 结果写进 source/_data/nanaly-notes.json，构建时由 scripts/noimpty-nanaly-notes.js 嵌进正文。
//
// 正文没改过就不重新生成（按内容哈希判断），省 token 也省得批注天天变。

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { ask } from '../daily-report/narrate.mjs'
import { triggerDeploy } from './github.mjs'
import { pushWithRetry } from './git.mjs'

const DATA = 'source/_data/nanaly-notes.json'
const POSTS = 'source/_posts'
const DRY = process.argv.includes('--dry')
const MAX_POSTS_PER_RUN = Number(process.env.NANALY_NOTES_MAX || 4)

const PERSONA = `你是娜娜莉，住在 Noimpty 个人博客里的猫娘。
毒舌但清醒，极简，讨厌废话。自称「窝」，偶尔带「喵」和颜文字 (=^w^=) (ovo)，但别每句都塞。
禁止使用 • 和 ω 这类会破坏颜文字的符号。
你现在在给主人的文章写旁注 —— 就像在别人的书页边上写字，短、准、有用。`

const hashOf = s => createHash('sha256').update(s).digest('hex').slice(0, 16)

/* 判「正文变没变」时只看正文，不看 front-matter。
 *
 * 以前是拿整个文件算哈希的，和上面那句「正文没改过就不重新生成」对不上：
 * 改个 tag、换张封面、调一次分类，哈希就变，那篇的批注会被整个重写一遍 ——
 * 白烧一次模型，而且好好的批注被换掉。2026-08-26 把 16 篇文章的分类
 * 从两级改成三级，一次就让全部文章重新排队，这个差别才暴露出来。 */
const bodyOf = raw => String(raw).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')

const readStore = () => {
  try { return JSON.parse(readFileSync(DATA, 'utf8')) } catch (_) { return {} }
}

// 从 md 里切出正文段落（跳过代码块、公式块、front-matter、引用、标题、列表）
const paragraphsOf = md => {
  const body = md.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
  const noCode = body
    .replace(/```[\s\S]*?```/g, '\n\n')
    .replace(/\$\$[\s\S]*?\$\$/g, ' 公式 ')
    .replace(/\{%[\s\S]*?%\}/g, '\n\n')
  return noCode.split(/\n{2,}/)
    .map(p => p.trim())
    .filter(p =>
      p.length >= 60 &&
      !/^[#>\-*+|]/.test(p) &&
      !/^\d+[.)]\s/.test(p) &&
      !/^!\[/.test(p) &&
      // 含行内公式的段落不选 —— 锚点取的是纯文本，而渲染后那里是 KaTeX 的 DOM，
      // 两边对不上，批注会静默丢失。含公式的段落直接排除，反正散文段落够用。
      !p.includes('$'))
    .map(p => p.replace(/\s+/g, ' '))
}

// 文章正文里的段落，和 Hexo 渲染出来的 <p> 要能对上，
// 所以锚点取的是「去掉 markdown 记号之后」的开头一小截
const anchorOf = p => p
  .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/[*_`~]/g, '')
  .replace(/\$([^$]*)\$/g, '$1')
  .trim()
  .slice(0, 30)

// source/_posts/homework-three.md → 它最终的 url path
// 直接从 front-matter 的 date 和文件名推，和 _config.yml 的 permalink 规则保持一致
export const pathOf = (file, raw) => {
  const d = (raw.match(/^date:\s*(.+)$/m) || [])[1]
  if (!d) return null
  const m = String(d).trim().match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  const slug = file.split('/').pop().replace(/\.md$/, '')
  return `/${m[1]}/${m[2]}/${m[3]}/${slug}/`
}

/* 扫一遍文章，同时得出两件事：哪些路径还活着，以及哪几篇需要新写批注。
 *
 * 这两件事必须在同一个循环里、按这个顺序算出来，原因见下面 live.add 那一行。
 */
export const planNotes = (files, store) => {
  const live = new Set()
  const todo = []
  let unresolved = 0

  for (const { file, raw } of files) {
    const p = pathOf(file, raw)
    if (!p) { unresolved++; continue }

    /* 先登记「这篇还在」，再判断要不要给它写新批注 —— 顺序不能反。
     *
     * 下面那行 privacy 判断是「不写新批注」，不是「这篇不存在」。
     * 要是把它提到 live.add 前面，全站上锁之后每篇文章都带 privacy: protected，
     * live 就成了空集，接着 pruneOrphans 会把整张批注表当成孤儿清掉。 */
    live.add(p)

    /* 这里曾经有一行 `if (privacy: protected) continue`。
     *
     * 它在只有少数文章上锁的年代是对的，但 2026-08-19 全站上锁之后
     * **每一篇**文章都带上了这个字段 —— 于是这行直接把整个功能关掉了：
     * 从那天起主人的文章一篇都没再拿到过新批注，工作流每天照跑、照样全绿，
     * 只是每次都提交不出东西。（她自己的随笔当时还没有 privacy 字段，
     * 所以又苟延残喘了几周，直到那边也补上。）
     *
     * 而且这道过滤本来就挡不住任何东西：批注表存的是正文开头 30 个字符
     * 当锚点，而**正文全文本来就在同一个公开仓库的 source/_posts/ 里**。
     * 上锁是前端软锁，从来不是「内容不进仓库」。所以删掉。 */
    const h = hashOf(bodyOf(raw))
    if (store[p] && store[p].hash === h) continue          // 正文没变，跳过
    todo.push({ file, path: p, raw, hash: h })
  }

  return { live, todo, unresolved }
}

/* 清掉贴不回任何文章的批注。
 *
 * 为什么需要这一步：批注表是按永久链接存的，而永久链接由 front-matter 的 date 生成 ——
 * 所以改一次文章日期或文件名，那篇的批注就留在表里、再也贴不上去。
 * 真发生过一次：作业二那篇日期从 8-15 改成 8-20，2 条批注就此失效。
 * 它不报错、不影响构建，只是构建日志里的「嵌入 N 篇」和表里的条数悄悄对不上，
 * 除非有人去数，否则永远发现不了。
 *
 * 判断只看路径对不对得上一篇真实存在的文章，别掺任何别的条件（尤其别掺 privacy）。
 */
export const pruneOrphans = (store, live) => {
  const orphans = Object.keys(store).filter(p => !live.has(p))
  orphans.forEach(p => { delete store[p] })
  return orphans
}

export const buildNotes = async () => {
  const store = readStore()
  const files = readdirSync(POSTS)
    .filter(f => f.endsWith('.md'))
    .map(f => `${POSTS}/${f}`)
    .map(file => ({ file, raw: readFileSync(file, 'utf8') }))

  const { live, todo, unresolved } = planNotes(files, store)

  console.log(`  ${files.length} 篇文章，需要新写批注的：${todo.length} 篇`)

  // 推不出路径的文章一旦存在，它的批注会被误判成孤儿 —— 那就整轮别删
  let orphans = []
  if (unresolved) {
    console.log(`  有 ${unresolved} 篇推不出路径（多半是 front-matter 里没有 date），本轮跳过孤儿清理`)
  } else {
    orphans = pruneOrphans(store, live)
    if (orphans.length) {
      console.log(`  清掉 ${orphans.length} 条贴不回去的旧批注（文章改过日期或文件名）：`)
      orphans.forEach(p => console.log(`      ${p}`))
    }
  }

  const batch = todo.slice(0, MAX_POSTS_PER_RUN)
  if (todo.length > batch.length) {
    console.log(`  单次最多处理 ${MAX_POSTS_PER_RUN} 篇，剩下 ${todo.length - batch.length} 篇下次再说`)
  }

  let wrote = 0
  for (const item of batch) {
    const title = (item.raw.match(/^title:\s*(.+)$/m) || [])[1] || item.path
    const paras = paragraphsOf(item.raw)
    if (paras.length < 3) { console.log(`  ${title.trim()} 段落太少，跳过`); continue }

    const listed = paras.slice(0, 40).map((p, i) => `[${i}] ${p.slice(0, 260)}`).join('\n\n')
    const out = await ask(PERSONA,
      `这是主人写的文章《${title.trim()}》，下面是它的正文段落，每段前面有编号。

请挑 2 到 3 个段落，各留一句旁注。要求：

1. 每条旁注 **不超过 60 字**，一句话说完
2. 内容必须是这几种之一：
   - 补一个原文没交代的前提或坑（最有价值）
   - 指出这里讲得不清楚、容易误解
   - 接一句你自己的观察，要具体，不许是「写得真好」这种空话
3. **不许编造技术细节**。不确定就别写那一条
4. 挑的段落要分散开，别都挤在开头
5. 严格只输出 JSON，不要任何解释文字：

{"notes":[{"i":段落编号,"text":"旁注内容"}]}

正文段落：
${listed}`, 900)

    if (!out) { console.log(`  ${title.trim()} 没能调用模型，跳过`); continue }
    let parsed
    try {
      const m = out.match(/\{[\s\S]*\}/)
      parsed = JSON.parse(m ? m[0] : out)
    } catch (_) {
      console.log(`  ${title.trim()} 返回的不是合法 JSON，跳过`)
      continue
    }

    const notes = (parsed.notes || [])
      .filter(n => paras[n.i] && String(n.text || '').trim())
      .map(n => ({ anchor: anchorOf(paras[n.i]), text: String(n.text).trim().slice(0, 120) }))
      .filter(n => n.anchor.length >= 6)

    if (!notes.length) { console.log(`  ${title.trim()} 没产出有效批注`); continue }

    store[item.path] = { hash: item.hash, title: title.trim(), notes }
    wrote++
    console.log(`  ${title.trim()} → ${notes.length} 条`)
    notes.forEach(n => console.log(`      「${n.anchor}…」→ ${n.text}`))
  }

  // 只清了孤儿、没写新批注，也是一次必须落盘并提交的改动
  if (!wrote && !orphans.length) { console.log('  没有新增批注，也没有要清的'); return { wrote: 0, pruned: 0 } }
  if (DRY) { console.log('\n  [演练] 不写文件'); return { wrote, pruned: orphans.length, dry: true } }

  if (!existsSync('source/_data')) mkdirSync('source/_data', { recursive: true })
  writeFileSync(DATA, JSON.stringify(store, null, 2) + '\n')
  console.log(`  已写入 ${DATA}`)
  return { wrote, pruned: orphans.length }
}

const GIT_NAME = process.env.NANALY_GIT_NAME || '娜娜莉'

// 提交用的邮箱。这里有个坑，踩过一次：
// `<用户名>@users.noreply.github.com` 是 GitHub 的旧版真实邮箱格式，
// 随手写一个「看起来不存在」的名字，会精确指向那个用户名的真人账号，
// 把陌生人挂到你仓库的 Contributors 里。
//
// 默认用你自己域名下的地址 —— GitHub 只会自动认领 @users.noreply.github.com，
// 别的域名除非有人验证过，否则不会关联到任何账号。
//
// 想让她的提交显示成你小号的头像：把 NANALY_GIT_EMAIL 设成小号的 noreply 邮箱，
// 用小号登录 https://github.com/settings/emails 就能看到，形如 12345678+用户名@users.noreply.github.com
const GIT_EMAIL = (() => {
  const v = process.env.NANALY_GIT_EMAIL
  if (!v) return 'nanaly@noimpty-zby.github.io'
  // 没有数字 ID 前缀的 noreply 地址会指向同名真人，拦下来
  if (/@users\.noreply\.github\.com$/i.test(v) && !/^\d+\+/.test(v)) {
    console.log(`  ⚠️ NANALY_GIT_EMAIL="${v}" 会关联到用户名为 ${v.split('@')[0]} 的真人账号，已忽略`)
    return 'nanaly@noimpty-zby.github.io'
  }
  return v
})()

export const commitNotes = async () => {
  const run = (...a) => execFileSync('git', a, { encoding: 'utf8', stdio: 'pipe' })
  run('config', 'user.name', GIT_NAME)
  run('config', 'user.email', GIT_EMAIL)
  run('add', DATA)
  if (!run('status', '--porcelain', '--', DATA).trim()) { console.log('  批注没有变化，不提交'); return false }
  run('commit', '-m', '娜娜莉：更新文章批注')
  pushWithRetry(run, '批注')
  console.log('  批注已提交并推送')
  // 用 GITHUB_TOKEN 推的提交不会自动触发部署，得自己叫一声
  await triggerDeploy()
  return true
}
