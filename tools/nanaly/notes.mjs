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

const DATA = 'source/_data/nanaly-notes.json'
const POSTS = 'source/_posts'
const DRY = process.argv.includes('--dry')
const MAX_POSTS_PER_RUN = Number(process.env.NANALY_NOTES_MAX || 4)

const PERSONA = `你是娜娜莉，住在 Noimpty 个人博客里的猫娘。
毒舌但清醒，极简，讨厌废话。自称「窝」，偶尔带「喵」和颜文字 (=^w^=) (ovo)，但别每句都塞。
禁止使用 • 和 ω 这类会破坏颜文字的符号。
你现在在给主人的文章写旁注 —— 就像在别人的书页边上写字，短、准、有用。`

const hashOf = s => createHash('sha256').update(s).digest('hex').slice(0, 16)

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

const postPath = file => {
  // source/_posts/homework-three.md → 需要它最终的 url path
  // 直接从 front-matter 的 date 和文件名推，和 _config.yml 的 permalink 规则保持一致
  const raw = readFileSync(file, 'utf8')
  const d = (raw.match(/^date:\s*(.+)$/m) || [])[1]
  if (!d) return null
  const m = String(d).trim().match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  const slug = file.split('/').pop().replace(/\.md$/, '')
  return `/${m[1]}/${m[2]}/${m[3]}/${slug}/`
}

export const buildNotes = async () => {
  const store = readStore()
  const files = readdirSync(POSTS).filter(f => f.endsWith('.md')).map(f => `${POSTS}/${f}`)

  const todo = []
  for (const file of files) {
    const raw = readFileSync(file, 'utf8')
    if (/^privacy:\s*protected/m.test(raw)) continue      // 加密文章不写批注
    const p = postPath(file)
    if (!p) continue
    const h = hashOf(raw)
    if (store[p] && store[p].hash === h) continue          // 正文没变，跳过
    todo.push({ file, path: p, raw, hash: h })
  }

  console.log(`  ${files.length} 篇文章，需要新写批注的：${todo.length} 篇`)
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

  if (!wrote) { console.log('  没有新增批注'); return { wrote: 0 } }
  if (DRY) { console.log('\n  [演练] 不写文件'); return { wrote, dry: true } }

  if (!existsSync('source/_data')) mkdirSync('source/_data', { recursive: true })
  writeFileSync(DATA, JSON.stringify(store, null, 2) + '\n')
  console.log(`  已写入 ${DATA}`)
  return { wrote }
}

export const commitNotes = async () => {
  const run = (...a) => execFileSync('git', a, { encoding: 'utf8', stdio: 'pipe' })
  run('config', 'user.name', '娜娜莉')
  run('config', 'user.email', 'nanaly@users.noreply.github.com')
  run('add', DATA)
  if (!run('status', '--porcelain', '--', DATA).trim()) { console.log('  批注没有变化，不提交'); return false }
  run('commit', '-m', '娜娜莉：更新文章批注')
  run('push')
  console.log('  批注已提交并推送')
  // 用 GITHUB_TOKEN 推的提交不会自动触发部署，得自己叫一声
  await triggerDeploy()
  return true
}
