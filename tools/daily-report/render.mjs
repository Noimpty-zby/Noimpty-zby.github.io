// 生成 HTML 邮件。邮件客户端对 CSS 支持很差，所以全部用内联样式 + 表格布局，
// 不用 flex/grid，不用外部字体。深色配色跟博客一致。

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const C = {
  bg: '#14101a', card: '#1e1826', line: '#332a3d',
  text: '#e8e2ec', dim: '#9b90a8', accent: '#e95978', soft: '#ff91a8',
  ok: '#7fc99a', warn: '#e8b04b', bad: '#ff6b6b'
}
const DOT = { ok: C.ok, warn: C.warn, bad: C.bad }
const WORD = { ok: '正常', warn: '留意', bad: '要处理' }

const card = (title, inner, extra = '') => `
<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;background:${C.card};border:1px solid ${C.line};border-radius:12px">
  <tr><td style="padding:16px 18px">
    <div style="font-size:15px;font-weight:600;color:${C.soft};margin:0 0 10px">${title}${extra}</div>
    ${inner}
  </td></tr>
</table>`

const kv = rows => `
<table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;color:${C.text}">
  ${rows.map(([k, v]) => `<tr>
    <td style="padding:5px 0;color:${C.dim};width:38%;vertical-align:top">${k}</td>
    <td style="padding:5px 0;vertical-align:top">${v}</td>
  </tr>`).join('')}
</table>`

const empty = t => `<div style="font-size:13px;color:${C.dim}">${esc(t)}</div>`

const trafficCard = t => {
  if (!t.ok) return card('访问情况', empty('没取到 —— ' + t.why))
  if (!t.pageviews) return card('访问情况', empty('过去 24 小时没有访问记录。（你自己的浏览已被排除，所以这代表确实没有别人来）'))
  const avg = t.visits ? Math.round(t.totaltime / t.visits) : 0
  const rows = []
  if (t.visitors != null) {
    rows.push(['访客 / 浏览量', `<b style="font-size:17px;color:${C.soft}">${t.visitors}</b> 人 · ${t.pageviews} 次`])
    if (t.visits) rows.push(['会话数', `${t.visits} 次${avg ? `，平均停留 ${Math.floor(avg / 60)} 分 ${avg % 60} 秒` : ''}`])
  } else {
    rows.push(['浏览量', `<b style="font-size:17px;color:${C.soft}">${t.pageviews}</b> 次`])
  }
  if (t.pages.length) rows.push(['看得最多的', t.pages.slice(0, 6)
    .map(p => `${esc(p.title || p.url)} <span style="color:${C.dim}">×${p.n}</span>`).join('<br>')])
  if (t.referrers.length) rows.push(['从哪来的', t.referrers.slice(0, 5)
    .map(r => `${esc(r.from)} <span style="color:${C.dim}">×${r.n}</span>`).join('<br>')])
  return card('访问情况', kv(rows), `<span style="color:${C.dim};font-weight:400"> · 来自 ${esc(t.source || '')}</span>`)
}

const commentCard = (c, screen) => {
  if (!c.ok) return card('新评论', empty('没取到 —— ' + c.why))
  if (!c.items.length) return card('新评论', empty('过去 24 小时没有新评论。'))
  const flaggedUrls = new Set(screen.flagged.map(f => f.url))
  const body = c.items.map(it => {
    const bad = flaggedUrls.has(it.url)
    const why = bad ? (screen.flagged.find(f => f.url === it.url) || {}).why : ''
    return `<div style="padding:10px 12px;margin:0 0 8px;background:${bad ? 'rgba(255,107,107,.1)' : 'rgba(255,255,255,.035)'};border-left:3px solid ${bad ? C.bad : C.line};border-radius:0 8px 8px 0">
      <div style="font-size:12px;color:${C.dim};margin:0 0 5px">
        <b style="color:${C.text}">${esc(it.who)}</b> 在《${esc(it.on)}》
        ${bad ? `<span style="color:${C.bad}">· 可疑：${esc(why)}</span>` : ''}
      </div>
      <div style="font-size:13px;color:${C.text};white-space:pre-wrap">${esc(it.body.slice(0, 600))}</div>
      ${it.draft ? `<div style="margin:8px 0 0;padding:8px 10px;background:rgba(233,89,120,.09);border-radius:8px">
        <div style="font-size:11px;color:${C.dim};margin:0 0 4px">娜娜莉替你拟的回复（复制粘贴即可）</div>
        <div style="font-size:12.5px;color:${C.text};white-space:pre-wrap">${esc(it.draft)}</div>
      </div>` : ''}
      <div style="margin:6px 0 0"><a href="${esc(it.url)}" style="color:${C.soft};font-size:12px">去回复 →</a></div>
    </div>`
  }).join('')
  return card('新评论', body + (screen.note ? empty(screen.note) : ''), `<span style="color:${C.dim};font-weight:400"> · ${c.items.length} 条</span>`)
}

const postCard = (p, feedbacks) => {
  if (!p.ok) return card('新文章', empty('没取到 —— ' + p.why))
  if (!p.items.length) return card('新文章', empty('过去 24 小时没有新文章。'))
  const body = p.items.map((post, i) => `
    <div style="padding:0 0 12px;margin:0 0 12px;border-bottom:1px solid ${C.line}">
      <div style="font-size:14px;font-weight:600;color:${C.text};margin:0 0 4px">${esc(post.title)}</div>
      <div style="font-size:12px;color:${C.dim};margin:0 0 8px">
        ${post.series ? esc(post.series) + ' · ' : ''}约 ${post.words} 字
      </div>
      <div style="padding:10px 12px;background:rgba(233,89,120,.08);border-left:3px solid ${C.accent};border-radius:0 8px 8px 0;font-size:13px;color:${C.text};white-space:pre-wrap">${esc(feedbacks[i] || '')}</div>
    </div>`).join('')
  return card('新文章 · 娜娜莉读后反馈', body.replace(/border-bottom:1px solid [^;]+;?/, (m, o) => m))
}

const healthCard = h => {
  const rows = h.checks.map(c => `
    <tr>
      <td style="padding:7px 0;width:16px;vertical-align:top">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${DOT[c.level]}"></span>
      </td>
      <td style="padding:7px 0;vertical-align:top">
        <div style="font-size:13px;color:${C.text}">${esc(c.name)}
          <span style="color:${DOT[c.level]};font-size:11px"> ${WORD[c.level]}</span></div>
        <div style="font-size:12px;color:${C.dim};margin:2px 0 0">${esc(c.detail)}</div>
        ${c.items.length ? `<div style="font-size:12px;color:${C.dim};margin:4px 0 0;padding-left:10px;border-left:2px solid ${C.line}">
          ${c.items.map(i => `${esc(i.where)} — ${esc(i.note)}`).join('<br>')}</div>` : ''}
      </td>
    </tr>`).join('')
  return card('健康检查', `<table width="100%" cellpadding="0" cellspacing="0">${rows}</table>`)
}

export const renderEmail = ({ opening, traffic, comments, screen, newPosts, feedbacks, health, windowLabel, site }) => `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${C.bg}">
<table width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg};padding:22px 12px">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans SC',sans-serif">

  <tr><td style="padding:0 0 6px">
    <div style="font-size:19px;font-weight:700;color:${C.text}">博客日报</div>
    <div style="font-size:12px;color:${C.dim};margin:4px 0 0">${esc(windowLabel)}</div>
  </td></tr>

  <tr><td style="padding:14px 0 16px">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(140deg,rgba(233,89,120,.16),rgba(255,145,168,.06));border:1px solid ${C.line};border-radius:12px">
      <tr><td style="padding:16px 18px;font-size:14px;line-height:1.72;color:${C.text};white-space:pre-wrap">${esc(opening)}</td></tr>
    </table>
  </td></tr>

  <tr><td>${trafficCard(traffic)}</td></tr>
  <tr><td>${commentCard(comments, screen)}</td></tr>
  <tr><td>${postCard(newPosts, feedbacks)}</td></tr>
  <tr><td>${healthCard(health)}</td></tr>

  <tr><td style="padding:6px 0 0;font-size:11px;color:${C.dim};line-height:1.7">
    这份报告由仓库里的定时任务生成，每晚北京时间 22:00 发出。<br>
    ${traffic.ok ? `访问数据来自 ${esc(traffic.source || '统计服务')}，已按你设定的方式排除自己的访问。<br>` : ''}
    <a href="${esc(site)}" style="color:${C.soft}">打开博客</a>
  </td></tr>

</table></td></tr></table></body></html>`

export const renderSubject = ({ traffic, comments, newPosts, health }) => {
  const bits = []
  if (health.worst === 'bad') bits.push('⚠️ 有问题要处理')
  if (traffic.ok && traffic.visitors) bits.push(`${traffic.visitors} 人来看`)
  if (comments.ok && comments.items.length) bits.push(`${comments.items.length} 条新评论`)
  if (newPosts.ok && newPosts.items.length) bits.push(`${newPosts.items.length} 篇新文章`)
  const d = new Date().toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric' })
  return `[博客日报] ${d} · ${bits.length ? bits.join(' · ') : '一切平静'}`
}

// ---------------- 想念邮件 ----------------
// 主人很久没来时发这封，短、暖、有钩子，不塞数据表格。

export const renderMissYou = ({ days, message, hooks, site }) => `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${C.bg}">
<table width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg};padding:28px 12px">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans SC',sans-serif">

  <tr><td style="padding:0 0 14px">
    <div style="font-size:17px;font-weight:700;color:${C.text}">娜娜莉</div>
    <div style="font-size:12px;color:${C.dim};margin:3px 0 0">你已经 ${days} 天没来过了</div>
  </td></tr>

  <tr><td>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(140deg,rgba(233,89,120,.18),rgba(255,145,168,.06));border:1px solid ${C.line};border-radius:14px">
      <tr><td style="padding:20px;font-size:14.5px;line-height:1.8;color:${C.text};white-space:pre-wrap">${esc(message)}</td></tr>
    </table>
  </td></tr>

  ${hooks && hooks.length ? `<tr><td style="padding:16px 0 0">
    ${card('要不要从这儿捡起来', `<table width="100%" cellpadding="0" cellspacing="0">
      ${hooks.map(h => `<tr><td style="padding:6px 0">
        <a href="${esc(h.url)}" style="color:${C.soft};font-size:13.5px;text-decoration:none">${esc(h.title)}</a>
        ${h.note ? `<div style="font-size:12px;color:${C.dim};margin:2px 0 0">${esc(h.note)}</div>` : ''}
      </td></tr>`).join('')}
    </table>`)}
  </td></tr>` : ''}

  <tr><td style="padding:8px 0 0;font-size:11px;color:${C.dim};line-height:1.7">
    <a href="${esc(site)}" style="color:${C.soft}">回博客看看</a><br>
    不想再收到这类提醒的话，把 workflow 里的 MISS_YOU_AFTER_DAYS 设成 0 就行。
  </td></tr>

</table></td></tr></table></body></html>`
