/* global hexo */
'use strict'

const MarkdownRenderer = require('../tools/markdown-renderer.cjs')
const renderer = new MarkdownRenderer(hexo)
const render = (data, options) => renderer.render(data, options)
// Hexo reads this property from the registered rendering function.
render.disableNunjucks = renderer.disableNunjucks
for (const extension of ['md', 'markdown', 'mkd', 'mkdn', 'mdwn', 'mdtxt', 'mdtext']) {
  hexo.extend.renderer.register(extension, 'html', render, true)
}
