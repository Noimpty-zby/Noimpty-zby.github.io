'use strict'

// 日程包含私密任务，和搜索/日志使用同一个加密信封。
// 缺暗号、数据损坏时不发布，不能用空表覆盖浏览器的未保存草稿。
const fs = require('node:fs')
const path = require('node:path')
const { encryptEnvelope } = require('../tools/site-crypto.cjs')
const { validateScheduleData } = require('../tools/schedule-data.cjs')

hexo.extend.generator.register('noimpty-schedule-data', () => {
  const pass = process.env.NOIMPTY_PASSPHRASE || ''
  if (!pass) {
    hexo.log.warn('没有 NOIMPTY_PASSPHRASE，日程数据不发布')
    return []
  }
  try {
    const raw = fs.readFileSync(path.join(hexo.source_dir, '_data', 'schedule.json'), 'utf8')
    const data = JSON.parse(raw)
    validateScheduleData(data)
    return { path: 'schedule/data.json', data: encryptEnvelope(raw, pass) }
  } catch (e) {
    hexo.log.warn('日程数据无效，这次不发布：' + e.message)
    return []
  }
})
