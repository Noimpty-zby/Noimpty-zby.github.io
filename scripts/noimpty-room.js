'use strict'

/**
 * 首页「我的小房间」：一排长了脸的小物件，每个对应一个入口。
 *
 * 物件画在 tools/kawaii-art.cjs，和内页页头的小角色是同一套画法。这里在构建时把整块
 * 结构连同 SVG 写进首页底部的 <template>，只写首页，别的页面不用多下载这几十 KB。
 * 摆到哪里、唱片和聊天这两个按钮做什么，在 source/js/study-room.js。
 *
 * 首页是唯一不上锁的页面，这里的每个字都是公开的（tools/checks/leakcheck.mjs 会查）。
 * 所以只写功能入口的名字，不写课程和文章。
 */

const { render } = require('../tools/kawaii-art.cjs')

const ITEMS = [
  { id: 'books', art: 'books', label: '书架', hint: '挑一本笔记，接着往下读', href: '#private-sections' },
  { id: 'review', art: 'notebook', label: '复习本', hint: '翻一翻，看看哪些已经记住了', href: '/review/' },
  { id: 'desk', art: 'terminal', label: '练习台', hint: '把刚学的命令和代码亲手跑一遍', href: '/learn/' },
  { id: 'calendar', art: 'calendar', label: '日程', hint: '今天打算做的事都在这里', href: '/schedule/' },
  { id: 'teach', art: 'blackboard', label: '讲给我听', hint: '把刚学的讲一遍，看看哪里还说不清', href: '/teach/' },
  { id: 'growth', art: 'album', label: '成长回放', hint: '回头看看以前卡在哪里，现在又会了什么', href: '/growth/' },
  { id: 'music', art: 'record', label: '放张唱片', hint: '放一点音乐陪着', action: 'music' },
  { id: 'chat', art: 'bubble', label: '聊一会儿', hint: '有什么想说的，都可以聊聊', action: 'chat' }
]

const escape = value => String(value).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch])

// 名字已经写在下面的小标签上，图本身对读屏隐藏，免得一个入口念两遍
const art = name => render(name).replace(/ role="img" aria-label="[^"]*"/, ' aria-hidden="true"')

const item = it => {
  const attrs = `class="noimpty-room__item" data-room-id="${it.id}" data-hint="${escape(it.hint)}"`
  const inner = `<span class="noimpty-room__art">${art(it.art)}</span><span class="noimpty-room__tag">${escape(it.label)}</span>`
  return it.href
    ? `<li><a ${attrs} href="${it.href}">${inner}</a></li>`
    : `<li><button type="button" ${attrs} data-room-action="${it.action}" aria-pressed="false">${inner}</button></li>`
}

/* 彩旗：绳子是一条二次贝塞尔曲线 y = 4 + 48·t(1-t)（中间垂下 12px），
 * 每面旗子按它在横向上的位置 t 往下挂到绳子上 */
const FLAGS = 15
const bunting = () =>
  '<svg viewBox="0 0 100 30" preserveAspectRatio="none"><path d="M0 4Q50 28 100 4" fill="none" stroke="#d9a7b8" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>' +
  Array.from({ length: FLAGS }, (_, k) => {
    const t = k / (FLAGS - 1)
    return `<i style="--sag:${(3 + 48 * t * (1 - t)).toFixed(1)}px"></i>`
  }).join('')

const markup = () =>
  '<template id="noimpty-room-template">' +
  '<section class="noimpty-room" id="noimpty-room" aria-labelledby="noimpty-room-title">' +
  '<header class="noimpty-home-sections__intro noimpty-room__intro">' +
  '<p class="noimpty-home-sections__eyebrow">今天从哪里开始</p>' +
  '<h2 id="noimpty-room-title">我的小房间</h2>' +
  '<p class="noimpty-room__caption" aria-live="polite">点一点房间里的小东西。</p>' +
  '</header>' +
  '<div class="noimpty-room__wall">' +
  `<div class="noimpty-room__bunting" aria-hidden="true">${bunting()}</div>` +
  `<ul class="noimpty-room__items">${ITEMS.map(item).join('')}</ul>` +
  '</div>' +
  '<div class="noimpty-room__foot">' +
  '<button type="button" class="noimpty-room__focus" data-room-action="focus" aria-pressed="false"><span aria-hidden="true">☾</span><span class="noimpty-room__focus-label">专注一会儿</span></button>' +
  '<div class="room-progress" hidden></div>' +
  '</div>' +
  '</section></template>'

const readStream = async stream => {
  if (!stream) return null
  let out = ''
  for await (const chunk of stream) out += chunk.toString()
  return out
}

// 测试里直接 require 这个文件看生成的结构，那时没有 hexo
if (typeof hexo !== 'undefined') hexo.extend.filter.register('after_generate', async () => {
  const html = await readStream(hexo.route.get('index.html'))
  if (!html || html.includes('id="noimpty-room-template"')) return
  const at = html.lastIndexOf('</body>')
  if (at < 0) return
  hexo.route.set('index.html', html.slice(0, at) + markup() + html.slice(at))
})

module.exports = { ITEMS, markup }
