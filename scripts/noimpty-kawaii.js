'use strict'

/**
 * 内页的小角色（画在 tools/kawaii-art.cjs）。
 *
 *   {% kawaii core %}   页头右边的场景：彩虹 + 两三个长了脸的小物件
 *   {% kawaii tree %}   单个角色：课程页页头、课程卡片的图标
 *
 * 构建时直接嵌成 SVG，没有脚本也看得见；眨眼、弹跳在 interior.css，
 * 眼睛跟着鼠标、点一下说话在 interior-deco.js。
 * 另外每个角色也单独输出成 /img/kawaii/<名字>.svg，给归档、分类这些主题生成的页头当图用。
 */

const { render, names } = require('../tools/kawaii-art.cjs')

hexo.extend.tag.register('kawaii', args => render(args.join(' ').trim()))

hexo.extend.generator.register('noimpty-kawaii', () =>
  names().map(name => ({ path: `img/kawaii/${name}.svg`, data: render(name) })))
