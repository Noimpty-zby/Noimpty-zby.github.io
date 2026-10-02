'use strict'

/**
 * 终端录屏。
 *
 *   {% cast linux/ch6-ctrl-r 按 Ctrl+R 之后边打边搜 %}
 *
 * 第一个参数是 source/casts/ 下的录屏文件名（不带 .cast），后面的文字是图注。
 * 录屏由 tools/casts/record.mjs 按脚本自动录出来；播放器 asciinema-player 由
 * source/js/noimpty-cast.js 在页面上真有录屏时才去加载。
 * 封面停在录屏的最后一帧，没点播放也能看到这段操作的结果。
 */

const fs = require('fs')
const path = require('path')
const { escapeHTML } = require('hexo-util')

const castHeader = file => {
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
  const header = JSON.parse(lines[0])
  if (![2, 3].includes(header.version)) throw new Error(`cast: ${file} 不是 asciicast v2/v3`)
  const cols = header.width || header.term?.cols
  const rows = header.height || header.term?.rows
  // v2 的时间是从开头算起的秒数，v3 是相对上一条事件的间隔。
  let seconds = 0
  for (const line of lines.slice(1)) {
    const event = JSON.parse(line)
    seconds = header.version === 2 ? event[0] : seconds + event[0]
  }
  return { cols, rows, seconds }
}

hexo.extend.tag.register('cast', args => {
  const [name, ...words] = args
  if (!/^[a-z0-9][a-z0-9/_-]*$/.test(name || '')) throw new Error('cast: 录屏名只能用小写字母、数字、-、_ 和 /，现在是 ' + name)
  const file = path.join(hexo.source_dir, 'casts', name + '.cast')
  if (!fs.existsSync(file)) throw new Error('cast: 找不到 ' + path.relative(hexo.base_dir, file))
  const { cols, rows, seconds } = castHeader(file)
  const caption = words.join(' ').trim()
  const label = caption ? `终端录屏：${caption}` : '终端录屏'
  return `<figure class="noimpty-cast" data-src="/casts/${name}.cast" data-cols="${cols}" data-rows="${rows}" data-poster="${Math.max(0, Math.ceil(seconds))}">` +
    `<div class="noimpty-cast__player" role="region" aria-label="${escapeHTML(label)}">` +
    '<p class="noimpty-cast__fallback">这里是一段终端录屏，需要允许页面运行脚本才能播放。</p></div>' +
    (caption ? `<figcaption>${escapeHTML(caption)}</figcaption>` : '') + '</figure>'
})
