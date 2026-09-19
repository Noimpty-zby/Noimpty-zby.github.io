/* front-matter 的日期 → 这篇文章在线上的永久链接。
 *
 * 看着只是把 date 里的年月日抠出来拼一下，中间却隔着一个时区陷阱，
 * 而且它已经在线上吃过一次亏了：
 *
 *   nanaly-2026-w35.md 的 front-matter 写的是 `date: 2026-08-31 00:05:53`，
 *   这篇在线上的真实地址却是 /2026/08/30/nanaly-2026-w35/ —— 差一天。
 *
 * 原因：_config.yml 里 timezone: 'Asia/Shanghai'，front-matter 里那串不带时区的
 * 时间被当成**北京挂钟**解析，而永久链接取的是那一刻的 **UTC 日期**。
 * 所以北京时间 00:00–07:59 发出去的文章，URL 比 front-matter 早一天。
 *
 * 坏起来一点都不显眼 —— 真实页面好好的，坏的是所有「照 front-matter 推路径」
 * 的代码，它们算出一个不存在的地址：
 *   - 批注表的键对不上 → 那篇的批注在页面上永远不出现。更糟的是推出来的路径
 *     「看起来还活着」，孤儿清理不会删它，哈希又对得上、不会重写 ——
 *     三条批注就此永久卡死，唯一的症状是「那篇随笔上没有猫爪」
 *   - 日程自动完成里「路径 → 标题」的查表落空
 *
 * 为什么会写出 00:05 这种时间：她的随笔 cron 是周日 12:00 UTC（北京 20:00），
 * 而 GitHub 的定时任务漂移几个小时是常态 —— 8-30 那次实际跑在 16:06 UTC，
 * 正好越过北京的午夜。9-13 那次跑在 15:39 UTC，差 21 分钟又要中一次。
 *
 * 所以这里统一按 Hexo 的真实行为算：北京挂钟 → 那一刻的 UTC 年月日。
 * 偏移写死 +8（Asia/Shanghai 自 1991 年起没有夏令时）。
 * 哪天真换了时区，_config.yml 的 timezone 和这里必须一起改。
 */

const BJ_OFFSET_MS = 8 * 3600 * 1000
const pad = n => String(n).padStart(2, '0')

/**
 * front-matter 的 date 值 → 那一刻的毫秒时间戳。推不出来返回 null。
 *
 * **不要用 `Date.parse('2026-09-19T14:46:00')` 代替它。** 不带时区的字符串
 * 按 ECMAScript 的规矩是按**运行机器的本地时区**解析的，而这串值是北京挂钟：
 * 在开发机（UTC+8）上两者碰巧一样，在 GitHub Actions（UTC）上差 8 小时。
 * 这就是「本地全绿、CI 红」的那类问题，2026-09-19 因为它掉过一次链子。
 */
export const wallClockMs = value => {
  const s = String(value == null ? '' : value).trim()
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?\s*(Z|[+-]\d{2}:?\d{2})?/)
  if (!m) return null
  const [, y, mo, d, hh, mi, ss, zone] = m

  const ms = hh == null
    // 只有日期没有时间：YAML 把这种值按 UTC 零点解析，本来就不是挂钟值，别再减 8 小时
    ? Date.UTC(+y, +mo - 1, +d)
    // 自己写了时区（Z 或 +08:00）的，交给标准解析 —— 那种写法里的时间也不是挂钟值
    : zone
      ? Date.parse(s)
      : Date.UTC(+y, +mo - 1, +d, +hh, +mi, +(ss || 0)) - BJ_OFFSET_MS

  return Number.isFinite(ms) ? ms : null
}

/**
 * front-matter 的 date 值 → 'YYYY/MM/DD'（UTC，也就是永久链接里的那一段）。
 * 推不出来返回 null —— 调用方靠这个区分「这篇没日期」和「这篇在某天」。
 */
export const utcDay = value => {
  const ms = wallClockMs(value)
  if (ms == null) return null
  const t = new Date(ms)
  return `${t.getUTCFullYear()}/${pad(t.getUTCMonth() + 1)}/${pad(t.getUTCDate())}`
}

/**
 * source/_posts/xxx.md + 文件全文 → '/YYYY/MM/DD/xxx/'。
 * 和 _config.yml 的 permalink: :year/:month/:day/:title/ 保持一致。
 */
export const postPath = (file, raw) => {
  const d = (String(raw).match(/^date:\s*(.+)$/m) || [])[1]
  const day = utcDay(d)
  if (!day) return null
  const slug = String(file).split('/').pop().replace(/\.md$/, '')
  return `/${day}/${slug}/`
}
