/* 总纲的取景器 —— 决定「这一步该让模型看总纲的哪几节」。
 *
 * 起因是一次很干净的失败：
 *
 * 总纲第四节里，主人举了《绝区零》的「振刀」当例子，并且在那一节里
 * 用三段引用块反复写了「这是用来排除的，不是用来指路的」「不要基于这一条提方向」。
 * 探索提示词里又写了一遍「至多一个方向可以和它相关」「拿掉第四节还站得住吗」。
 *
 * 结果第一轮扫出来的三个方向，全是近战 + 时机判定，也就是振刀的三种说法。
 * 系统照着立了项，主人连点两次「停掉」，一个项目在纸面上就死了。
 *
 * 结论很简单：**告诉模型「别看这段」，等于让它盯着这段看。**
 * 注意力不受指令控制 —— 只要那段文字在上下文里，它就在参与生成。
 *
 * 所以这一层做的事是物理的：**探索和检索词生成时，把那一节整节删掉再送进去。**
 * 不是加一句警告，是那段字根本不出现。
 *
 * 什么时候又把它放回来：立项之后的具体设计阶段（深化 / 修订）。
 * 那时候方向已经定了，「他喜欢短窗口强反馈」是有用的调味信息，
 * 不再有能力把整个方向带跑。
 */

/** 把 markdown 按二级标题切成小节。返回 [{ title, body, raw }]，body 不含标题行。 */
export const sections = md => {
  const text = String(md || '')
  const out = []
  const re = /^##\s+(.+)$/gm
  const marks = [...text.matchAll(re)]
  if (!marks.length) return [{ title: '', body: text, raw: text }]
  // 第一个二级标题之前的内容（一级标题、说明块）单独留着，永远保留
  if (marks[0].index > 0) {
    const head = text.slice(0, marks[0].index)
    out.push({ title: '', body: head, raw: head })
  }
  marks.forEach((m, i) => {
    const start = m.index
    const end = i + 1 < marks.length ? marks[i + 1].index : text.length
    const raw = text.slice(start, end)
    out.push({ title: m[1].trim(), body: raw.slice(m[0].length), raw })
  })
  return out
}

/* 判断一节是不是「口味节」—— 探索阶段要整节摘掉的那种。
 *
 * 两道识别，按顺序：
 *   1. 标题里带显式标记 `【探索时不看】` —— 新版总纲用这个，最稳，
 *      也让人一眼看得出这一节的地位，不需要读代码才知道。
 *   2. 关键词兜底 —— 老版总纲（第四节叫「我的设计偏好」）没有标记，
 *      不兜底的话升级代码之后老仓库照样会被带偏。
 */
const EXPLICIT = /【\s*探索时不看\s*】/
const KEYWORDS = /(设计偏好|我的口味|我喜欢的|欣赏的作品|个人偏好|审美偏好)/

export const isTasteSection = title => {
  const t = String(title || '')
  return EXPLICIT.test(t) || KEYWORDS.test(t)
}

/** 探索 / 检索词生成用的总纲：口味节被整节摘掉，只留一行占位说明。 */
export const forExplore = md => {
  const parts = sections(md)
  const dropped = []
  const kept = parts.map(s => {
    if (s.title && isTasteSection(s.title)) {
      dropped.push(s.title)
      return `## ${s.title}\n\n（这一节在探索阶段被系统整节移除。\n` +
        '它记的是他个人的口味，而这个作品不是做给他自己玩的 ——\n' +
        '目标是比赛评委和面试官。个人口味不构成任何方向依据，\n' +
        '所以你现在看不到它，也不需要看到。）\n'
    }
    return s.raw
  })
  return { text: kept.join('').trim(), dropped }
}

/** 立项之后的阶段用的总纲：全文，一个字不删。 */
export const forDesign = md => String(md || '')

/* 把总纲里「参赛与展示」那一节单独拎出来。
 *
 * 用途：校验、立项、参赛方案这几步里，这一节的权重要高于总纲其余部分 ——
 * 它是目标函数本身。单独拎出来放在提示词的显眼处，比指望模型在
 * 两千字的总纲里自己找到它可靠。找不到就返回空串，调用方会退回到通用规则。 */
const SHOWCASE = /(参赛|比赛|展示|评委|简历|目标场景)/
export const showcaseSection = md => {
  const hit = sections(md).find(s => s.title && SHOWCASE.test(s.title))
  return hit ? hit.raw.trim() : ''
}

/** 已否决方向那一节 —— 探索时必须带上，它是最值钱的一节。 */
const REJECTED = /(已经?否决|否决的方向|踩过的坑)/
export const rejectedSection = md => {
  const hit = sections(md).find(s => s.title && REJECTED.test(s.title))
  return hit ? hit.raw.trim() : ''
}
