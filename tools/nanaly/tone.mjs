/* 写完先数一遍 AI 腔，有就让她自己改一次。
 *
 * 2026-10-21 他说「小猫不说人话了」。量下来她的随笔和资讯每千字有 3 到 6 个破折号，
 * 他自己的文章是 0。规矩已经写进了共享身份（source/js/nanaly-identity.js），
 * 但是 DeepSeek 默认就爱用破折号（lieflat-less-ai-tone 实测每千字 5.16 个，
 * 五个模型里最多），只靠提示词压不干净。
 *
 * 所以发出去的东西再过一道。这里只抓三类毛病，因为它们在语料实测里区分度高，
 * 用正则也能抓准；比喻、设问、排比这些实测下来真人用得更多，不在这里管。
 * 抓到以后把那几句原样贴给她，让她只改那几句，改坏了就用原稿。 */

const CODE = /```[\s\S]*?```|`[^`\n]*`/g

export const TONE_RULES = [
  { kind: '破折号', re: /—/, fix: '去掉破折号，用逗号接着说，或者拆成两句' },
  {
    kind: '对举句',
    re: /(?<!是)不是[^。！？\n]{1,24}[，,]\s*(?:而是|是)|并非[^。！？\n]{1,24}而是|与其说|看似[^。！？\n]{1,24}(?:实则|其实)/,
    fix: '别先说一个说法再推翻它，直接说后半句'
  },
  {
    kind: '套话开头',
    re: /^(?:说白了|说穿了|说到底|一句话[，：:]|值得注意的是|更重要的是)/,
    fix: '把这个开头删掉，直接说事'
  }
]

/* 按句子找。列表符号、引用符号、条目编号和加粗标题不算句子开头，
 * 不然「- [3] **标题**。说到底……」里的「说到底」就漏掉了。 */
export const toneIssues = text => {
  const found = []
  String(text || '').replace(CODE, ' ').split(/\n|(?<=[。！？!?])/).forEach(raw => {
    const sentence = raw.trim()
    if (!sentence) return
    const head = sentence.replace(/^[\s>*+-]*(?:[[［【]\s*\d+\s*[\]］】]\s*)?(?:\*\*[^*\n]*\*\*[。．.]?\s*)?/, '')
    for (const rule of TONE_RULES) {
      if (rule.re.test(rule.kind === '套话开头' ? head : sentence)) {
        found.push({ kind: rule.kind, fix: rule.fix, sentence: sentence.slice(0, 200) })
        break
      }
    }
  })
  return found
}

export const polishPrompt = (text, issues) => `下面是你刚写好的稿子。里面有几句读起来像 AI 写的，我把它们列出来了，每句后面写了怎么改。
只改这几句，其他的字一个都不要动。markdown 格式、条目编号、链接和标题都原样保留，意思也不能变。
直接输出改好的全文，不要加任何说明。

━━━ 要改的句子 ━━━
${issues.map((it, i) => `${i + 1}.「${it.sentence}」（${it.kind}，${it.fix}）`).join('\n')}

━━━ 稿子 ━━━
${text}`

/* 改一次，不循环。改出来的稿子要过三关才用，否则照发原稿：
 * 长度变化不超过两成（防止她顺手重写或者截断）、keep 回调认可（资讯要求条目编号不变，
 * 那是回查来源用的）、毛病确实变少了。
 * 多花的是一次 flash 调用，而且只在真有毛病的时候才花。 */
export const polish = async (text, ask, { label = '改稿', keep = () => true } = {}) => {
  const issues = toneIssues(text)
  if (!issues.length) return text
  const budget = Math.min(6000, Math.ceil(text.length * 1.5) + 200)
  const out = String(await ask('你是娜娜莉，住在 Noimpty 个人博客里的猫娘。你在改自己刚写好的稿子。',
    polishPrompt(text, issues), budget, { label }) || '').trim()
  const ratio = out.length / text.length
  const left = out ? toneIssues(out).length : issues.length
  if (!out || ratio < 0.8 || ratio > 1.2 || !keep(out) || left >= issues.length) {
    console.log(`  [${label}] 改出来的稿子没用上，照发原稿（原有 ${issues.length} 处）`)
    return text
  }
  console.log(`  [${label}] AI 腔从 ${issues.length} 处改到 ${left} 处`)
  return out
}
