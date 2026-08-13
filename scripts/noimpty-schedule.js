'use strict'

/**
 * 把日程数据发布成一个浏览器能读的文件。
 *
 * 数据源是 source/_data/schedule.json —— Hexo 的 _data 目录只供模板使用，
 * 不会被复制进 public，所以这里显式生成一份到 /schedule/data.json。
 *
 * 之所以不直接把 json 放进 source/schedule/，是为了让服务端（每晚的日报）
 * 和浏览器读的是同一份文件，避免两处数据各改各的。
 */

const fs = require('fs')
const path = require('path')

hexo.extend.generator.register('noimpty-schedule-data', () => {
  const file = path.join(hexo.source_dir, '_data', 'schedule.json')
  let data = '{"updatedAt":"","days":{}}'
  try {
    const raw = fs.readFileSync(file, 'utf8')
    JSON.parse(raw)            // 先验证一下，坏了的 json 别发出去
    data = raw
  } catch (e) {
    hexo.log.warn('日程数据读不到或格式不对，发布空表：' + e.message)
  }
  return { path: 'schedule/data.json', data }
})
