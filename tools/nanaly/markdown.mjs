import MarkdownIt from 'markdown-it'

const markdown = new MarkdownIt({ html: true })

// Only real code blocks/spans may retain literal HTML. A regex matching three
// backticks also accepts invalid fences and mismatched inline delimiters.
const transformInlineText = (text, transform) => {
  let result = ''
  let pending = ''
  let pos = 0
  while (pos < text.length) {
    if (text[pos] === '\\' && pos + 1 < text.length) {
      pending += text.slice(pos, pos + 2)
      pos += 2
      continue
    }
    if (text[pos] === '`') {
      const marker = text.slice(pos).match(/^`+/)[0]
      let end = pos + marker.length
      let close = -1
      while (end < text.length) {
        const next = text.indexOf('`', end)
        if (next < 0) break
        const run = text.slice(next).match(/^`+/)[0]
        end = next + run.length
        if (run.length === marker.length) { close = end; break }
      }
      if (close >= 0) {
        result += transform(pending) + text.slice(pos, close)
        pending = ''
        pos = close
        continue
      }
      pending += marker
      pos += marker.length
      continue
    }
    pending += text[pos]
    pos++
  }
  return result + transform(pending)
}

const escapeInline = text => transformInlineText(text, value => value.replace(/</g, '&lt;'))

const linesOf = text => text.match(/[^\n]*\n|[^\n]+$/g) || []

export const sanitizeMd = value => {
  const text = String(value ?? '')
  const lines = linesOf(text)
  const result = lines.map(line => line.replace(/</g, '&lt;'))
  for (const token of markdown.parse(text, {})) {
    if (!token.map) continue
    const [start, end] = token.map
    if (token.type === 'fence' || token.type === 'code_block') {
      for (let i = start; i < end; i++) result[i] = lines[i]
    } else if (token.type === 'inline') {
      const escaped = linesOf(escapeInline(lines.slice(start, end).join('')))
      for (let i = start; i < end; i++) result[i] = escaped[i - start]
    }
  }
  return result.join('')
}

const plain = tokens => tokens.map(token => token.children ? plain(token.children)
  : ['text', 'code_inline', 'image'].includes(token.type) ? token.content
    : ['softbreak', 'hardbreak'].includes(token.type) ? ' ' : '').join('')
const escapeLabel = text => text.replace(/[\\`*_\[\]<>]/g, '\\$&')

export const stripOutboundLinks = (value, site = process.env.SITE_URL || 'https://noimpty-zby.github.io') => {
  let base
  try { base = new URL(site) } catch (_) {}
  const inside = value => {
    try {
      const url = new URL(value, base)
      return !!base && /^https?:$/.test(url.protocol) && url.origin === base.origin
        && !url.username && !url.password
    } catch (_) { return false }
  }
  // Sanitize here as well: replies publish this result directly, unlike columns.
  const text = sanitizeMd(value)
  const parser = new MarkdownIt({ html: false })
  const env = {}
  const blocks = parser.parse(text, env)
  let activeSource = ''
  let edits = []
  for (const name of ['link', 'image', 'autolink']) {
    const rule = parser.inline.ruler.__rules__.find(rule => rule.name === name).fn
    parser.inline.ruler.at(name, (state, silent) => {
      const start = state.pos
      const tokenStart = state.tokens.length
      const matched = rule(state, silent)
      if (!matched || silent || state.src !== activeSource) return matched
      const tokens = state.tokens.slice(tokenStart)
      const firstIndex = tokens.findIndex(token => token.type === 'link_open' || token.type === 'image')
      const first = tokens[firstIndex]
      if (first && (first.type === 'image' || !inside(first.attrGet('href')))) {
        edits.push({ start, end: state.pos, text: escapeLabel(plain(tokens.slice(firstIndex))) })
      }
      return matched
    })
  }
  const lines = linesOf(text)
  const spans = blocks.filter(token => token.type === 'inline' && token.map).map(token => token.map)
  for (const [start, end] of spans.reverse()) {
    activeSource = lines.slice(start, end).join('')
    edits = []
    parser.parseInline(activeSource, env)
    // An outer link can contain an image. Apply only outermost replacements.
    edits.sort((a, b) => a.start - b.start || b.end - a.end)
    const selected = []
    for (const edit of edits) {
      if (!selected.length || edit.start >= selected[selected.length - 1].end) selected.push(edit)
    }
    let output = activeSource
    for (const edit of selected.reverse()) output = output.slice(0, edit.start) + edit.text + output.slice(edit.end)
    lines.splice(start, end - start, ...linesOf(output))
  }
  // Remove unused external reference definitions and bare URLs as well. Relative
  // destinations are resolved against the site, so //other.test is never internal.
  const cleaned = lines.join('')
    .replace(/^ {0,3}\[[^\]\n]+\]:[^\n]*(?:\n|$)/gm, definition => {
      const label = definition.match(/^ {0,3}\[([^\]]+)\]/)?.[1]
      const reference = env.references?.[parser.utils.normalizeReference(label || '')]
      return reference && !inside(reference.href) ? '' : definition
    })
  // Use the same URL/email recognizer as rendering, without touching code.
  // A global URL regex used to eat closing backticks and punctuation while
  // missing mailto links that Markdown creates automatically from plain text.
  const cleanedLines = linesOf(cleaned)
  const inline = parser.parse(cleaned, {}).filter(token => token.type === 'inline' && token.map)
  for (const { map: [start, end] } of inline.reverse()) {
    const output = transformInlineText(cleanedLines.slice(start, end).join(''), value => {
      for (const match of (parser.linkify.match(value) || []).reverse()) {
        if (!inside(match.url)) value = value.slice(0, match.index) + value.slice(match.lastIndex)
      }
      return value
    })
    cleanedLines.splice(start, end - start, ...linesOf(output))
  }
  return sanitizeMd(cleanedLines.join(''))
}
