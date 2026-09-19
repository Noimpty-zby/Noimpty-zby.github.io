'use strict'

// 日程发布与日报必须接受同一份数据；校验不整理、不丢弃任务或扩展字段。
const isRecord = value => !!value && typeof value === 'object' && !Array.isArray(value)
const isCalendarDay = day => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false
  const ms = Date.parse(`${day}T00:00:00Z`)
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === day
}

const validateScheduleData = data => {
  if (!isRecord(data) || !isRecord(data.days)) throw new Error('日程必须含有效的 days 对象，不能当作空表')
  const ids = new Set()
  for (const [day, tasks] of Object.entries(data.days)) {
    if (!isCalendarDay(day)) throw new Error(`日程日期无效：${day}`)
    if (!Array.isArray(tasks)) throw new Error(`日程 ${day} 的任务必须是数组`)
    for (const task of tasks) {
      if (!isRecord(task) || typeof task.id !== 'string' || !task.id ||
          typeof task.text !== 'string' || typeof task.done !== 'boolean') {
        throw new Error(`日程 ${day} 含无效任务，必须有 id、text 和布尔 done`)
      }
      if (ids.has(task.id)) throw new Error(`日程任务 id 重复：${task.id}`)
      ids.add(task.id)
    }
  }
  return data
}

module.exports = { isCalendarDay, validateScheduleData }
