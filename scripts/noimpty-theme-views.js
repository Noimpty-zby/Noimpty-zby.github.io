'use strict'

// hexo-util 4.0.0 matches string patterns without a start anchor. Hexo's
// layout/*path processor can therefore register source/css/_layout/post.styl
// as the post view; asynchronous reads then choose Pug or Stylus unpredictably.
// Restrict only the affected theme processor before Hexo scans theme files.
const { Pattern } = require('hexo-util')

hexo.extend.filter.register('after_init', () => {
  const probe = '__noimpty_layout_probe__.pug'
  for (const processor of hexo.theme.processors) {
    const pattern = processor.pattern
    if (pattern.match(`layout/${probe}`)?.path !== probe ||
        pattern.match(`source/css/_layout/${probe}`)?.path !== probe) continue
    processor.pattern = new Pattern(path => path.startsWith('layout/') ? pattern.match(path) : undefined)
  }
})
