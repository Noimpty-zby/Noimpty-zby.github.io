'use strict'

/**
 * 构建时就把正文里要用的东西摆好，不等脚本跑完再往页面里塞（那样会跳一下）。
 *
 *   - 代码块的标签栏：语言名 + 复制按钮。类名沿用 .highlight-tools / .copy-button，
 *     练习台（learning-lab.js）会把「运行」按钮插到复制按钮前面。
 *   - {% series %}：同一个 series 的全部文章，按时间排。
 *   - 404 页。
 */

const LANG = {
  c: 'C', cpp: 'C++', 'c++': 'C++', h: 'C', cs: 'C#', go: 'GO', golang: 'GO',
  python: 'PYTHON', py: 'PYTHON', js: 'JS', javascript: 'JS', ts: 'TS', typescript: 'TS', json: 'JSON',
  bash: 'SHELL', sh: 'SHELL', shell: 'SHELL', zsh: 'SHELL', console: 'SHELL',
  plaintext: 'TEXT', text: 'TEXT', txt: 'TEXT', sql: 'SQL', mysql: 'SQL', yaml: 'YAML', yml: 'YAML',
  ini: 'INI', toml: 'TOML', diff: 'DIFF', makefile: 'MAKE', cmake: 'CMAKE', html: 'HTML', css: 'CSS',
  dockerfile: 'DOCKER', glsl: 'GLSL', hlsl: 'HLSL', markdown: 'MD', md: 'MD', xml: 'XML'
}

const toolbar = lang => {
  const label = LANG[lang] || (lang ? lang.toUpperCase() : 'CODE')
  return `<div class="highlight-tools"><span class="code-lang">${label}</span><button class="copy-button" type="button" aria-label="复制这段代码">复制</button></div>`
}

hexo.extend.filter.register('after_post_render', data => {
  if (typeof data.content !== 'string' || !data.content.includes('<figure class="highlight')) return data
  data.content = data.content.replace(/<figure class="highlight(?: ([\w+#-]+))?">/g,
    (whole, lang) => whole + toolbar(String(lang || '').toLowerCase()))
  return data
})

const escapeHtml = value => String(value == null ? '' : value)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const toArray = collection => {
  if (!collection) return []
  if (Array.isArray(collection)) return collection
  if (typeof collection.toArray === 'function') return collection.toArray()
  return []
}

hexo.extend.tag.register('series', function (args) {
  const name = String(args.join(' ').trim() || this.series || '').trim()
  if (!name) return ''
  const isProtected = post => String(post.privacy || '').toLowerCase() === 'protected'
  const posts = toArray(hexo.locals.get('posts'))
    .filter(post => String(post.series || '').trim() === name && isProtected(post) === isProtected(this))
    .sort((a, b) => Number(a.date || 0) - Number(b.date || 0))
  if (!posts.length) return ''
  const items = posts.map((post, i) => {
    const current = post.path === this.path
    const link = '/' + String(post.path).replace(/^\/+/, '')
    return `<li${current ? ' aria-current="true"' : ''}><span class="series-list__no">${String(i + 1).padStart(2, '0')}</span>` +
      (current ? `<span>${escapeHtml(post.title)}</span>` : `<a href="${escapeHtml(link)}">${escapeHtml(post.title)}</a>`) + '</li>'
  }).join('')
  return `<nav class="series-list" aria-label="${escapeHtml(name)} 系列"><div class="series-list__head">${escapeHtml(name)} 系列 · ${posts.length} 篇</div><ol>${items}</ol></nav>`
})

hexo.extend.generator.register('noimpty-404', () => ({
  path: '404.html',
  layout: ['page'],
  data: { title: '找不到这一页', type: '404', path: '404.html', comments: false, content: '' }
}))
