'use strict'

/**
 * 把娜娜莉的段落级批注嵌进正文。
 *
 * 批注内容存在 source/_data/nanaly-notes.json 里，由 tools/nanaly/notes.mjs 生成并提交。
 * 这里只负责「插进去」—— 构建时完成，页面上没有额外的 JS，也不会有闪烁。
 *
 * 两个刻意的设计：
 *
 * 1. 直接用 fs 读数据文件，不走 hexo.locals.get('data')。
 *    因为 after_post_render 在 Hexo 的加载阶段就触发了，而 data 目录要到
 *    generate 阶段才填好 —— 那时候再读就来不及了。
 *
 * 2. 定位用「锚点文字」而不是段落序号。
 *    序号会因为你在前面插一段话就全部错位，批注会贴到不相干的地方去。
 *    锚点匹配不上就干脆不插 —— 宁可少一条，也不要贴错位置。
 */

const fs = require('fs')
const path = require('path')

const DATA_FILE = path.join(hexo.source_dir, '_data', 'nanaly-notes.json')

let cache = null
let cacheAt = 0
const readNotes = () => {
  try {
    const stat = fs.statSync(DATA_FILE)
    if (cache && stat.mtimeMs === cacheAt) return cache
    cache = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
    cacheAt = stat.mtimeMs
    return cache
  } catch (_) {
    return null
  }
}

const stripTags = html => String(html || '')
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/\s+/g, ' ')
  .trim()

const escapeHtml = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

const normalizePath = p => ('/' + String(p || '').replace(/^\/+/, '')).replace(/index\.html$/, '')

const renderNote = text => '<aside class="nanaly-note" aria-label="娜娜莉的批注">'
  + '<span class="nanaly-note__paw" aria-hidden="true"><i class="fas fa-cat"></i></span>'
  + `<span class="nanaly-note__text">${escapeHtml(text)}</span>`
  + '</aside>'

let stats = { posts: 0, notes: 0 }

hexo.extend.filter.register('after_post_render', data => {
  const table = readNotes()
  if (!table) return data

  const entry = table[normalizePath(data.path)] || null
  if (!entry || !Array.isArray(entry.notes) || !entry.notes.length) return data

  let html = String(data.content || '')
  if (!html) return data

  const used = new Set()
  let inserted = 0

  html = html.replace(/<p(?:\s[^>]*)?>[\s\S]*?<\/p>/g, block => {
    if (inserted >= entry.notes.length) return block
    const text = stripTags(block)
    if (text.length < 12) return block

    for (let i = 0; i < entry.notes.length; i++) {
      if (used.has(i)) continue
      const anchor = stripTags(entry.notes[i].anchor || '')
      if (!anchor || anchor.length < 6) continue
      const head = anchor.slice(0, Math.min(anchor.length, 24))
      if (text.startsWith(head) || text.includes(anchor)) {
        used.add(i)
        inserted++
        return block + renderNote(entry.notes[i].text)
      }
    }
    return block
  })

  if (inserted) {
    stats.posts++
    stats.notes += inserted
    data.content = html
  }
  return data
})

hexo.extend.filter.register('before_exit', () => {
  if (stats.notes) hexo.log.info(`娜娜莉的批注：嵌入 ${stats.posts} 篇 / ${stats.notes} 条`)
})
