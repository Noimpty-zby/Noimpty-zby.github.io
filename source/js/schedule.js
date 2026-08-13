/* 日程表：月视图日历 + 点某天写安排 + 保存回仓库
 *
 * 存储策略（这是这个页面唯一需要理解的地方）：
 *
 *   真身    source/_data/schedule.json     ← 仓库里的唯一真相，每晚的日报也读它
 *   浏览器读 /schedule/data.json            ← 构建时从真身生成的副本
 *   浏览器写 GitHub Contents API            ← 直接往真身提交，随后自动部署
 *
 * 写操作需要一个能改仓库的 token。它复用娜娜莉那套 AES-GCM 保险箱
 * （PBKDF2 派生密钥、要密码解锁、只存密文），不硬编码、不进代码仓库。
 *
 * 本地还留一份缓存：保存后到部署完成有一两分钟，这期间刷新页面
 * 远端拿到的还是旧数据，靠缓存里的时间戳来判断该用哪份。
 */
(() => {
  'use strict'

  const root = document.getElementById('noimpty-schedule')
  if (!root) return

  const REPO = (window.NOIMPTY_SCHEDULE_REPO || 'Noimpty-zby/Noimpty-zby.github.io')
  const DATA_PATH = 'source/_data/schedule.json'
  const LS_CACHE = 'noimpty-schedule-cache-v1'

  const el = (tag, cls, html) => {
    const e = document.createElement(tag)
    if (cls) e.className = cls
    if (html != null) e.innerHTML = html
    return e
  }
  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

  const pad = n => String(n).padStart(2, '0')
  // 一律按北京时间算「今天」，免得跨时区或半夜操作时差一天
  const beijingParts = (d = new Date()) => {
    const s = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(d)
    const [y, m, dd] = s.split('-').map(Number)
    return { y, m, d: dd, key: s }
  }
  const keyOf = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`
  const TODAY = beijingParts()

  const uid = () => 't' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36)

  // 完成条件。只列「有客观信号可查」的几类 ——
  // 像「复习光栅化」这种，世界上没有任何数据能证明你复习了，只能自己勾。
  const COND_TYPES = [
    { v: '', label: '手动勾（默认）', hint: '' },
    { v: 'post', label: '发布了文章', hint: '标题或文件名里包含…', need: true },
    { v: 'edit', label: '改动了文章', hint: '标题或文件名里包含…', need: true },
    { v: 'reply', label: '回复了评论', hint: '哪篇文章下的（留空 = 任意）', need: false }
  ]
  const condLabel = w => {
    if (!w || !w.type) return ''
    const t = COND_TYPES.find(x => x.v === w.type)
    if (!t) return ''
    return w.match ? `${t.label}：${w.match}` : t.label
  }

  // ---------------- 数据 ----------------

  let data = { updatedAt: '', days: {} }
  let dirty = false
  let viewY = TODAY.y
  let viewM = TODAY.m
  let picked = TODAY.key
  let condFor = null   // 正在编辑完成条件的任务 id

  const readCache = () => {
    try { return JSON.parse(localStorage.getItem(LS_CACHE) || 'null') } catch (_) { return null }
  }
  const writeCache = () => {
    try { localStorage.setItem(LS_CACHE, JSON.stringify(data)) } catch (_) {}
  }

  const loadData = async () => {
    let remote = null
    try {
      const res = await fetch('/schedule/data.json?t=' + Date.now(), { cache: 'no-store' })
      if (res.ok) remote = await res.json()
    } catch (_) {}
    const cached = readCache()

    // 刚保存完、部署还没跑完时，远端是旧的。比时间戳，谁新用谁。
    if (cached && (!remote || String(cached.updatedAt || '') > String(remote.updatedAt || ''))) {
      data = cached
      return remote ? 'cache-newer' : 'cache-only'
    }
    data = remote || { updatedAt: '', days: {} }
    writeCache()
    return 'remote'
  }

  const tasksOf = k => (data.days && Array.isArray(data.days[k])) ? data.days[k] : []
  const setTasks = (k, list) => {
    if (!data.days) data.days = {}
    if (list.length) data.days[k] = list
    else delete data.days[k]
    data.updatedAt = new Date().toISOString()
    dirty = true
    writeCache()
    render()
  }

  // ---------------- 保存到仓库 ----------------

  const token = () => {
    try { return (window.NANALY && window.NANALY.githubToken && window.NANALY.githubToken()) || null }
    catch (_) { return null }
  }

  const gh = async (path, init = {}) => {
    const t = token()
    if (!t) throw new Error('NO_TOKEN')
    const res = await fetch(`https://api.github.com/repos/${REPO}/${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${t}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        ...(init.headers || {})
      },
      signal: AbortSignal.timeout(30000)
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(`${res.status} ${body.message || ''}`.trim())
    return body
  }

  // btoa 只吃 latin1，中文要先转 UTF-8 字节
  const toBase64 = str => {
    const bytes = new TextEncoder().encode(str)
    let bin = ''
    bytes.forEach(b => { bin += String.fromCharCode(b) })
    return btoa(bin)
  }

  const save = async () => {
    const btn = root.querySelector('[data-act="save"]')
    const setBusy = (on, text) => {
      if (btn) { btn.disabled = on; }
      status(text)
    }
    try {
      setBusy(true, '正在读取远端版本…')
      const cur = await gh(`contents/${DATA_PATH}`)
      setBusy(true, '正在提交…')
      const payload = JSON.stringify({ updatedAt: new Date().toISOString(), days: data.days }, null, 2) + '\n'
      await gh(`contents/${DATA_PATH}`, {
        method: 'PUT',
        body: JSON.stringify({
          message: `日程更新 ${beijingParts().key}`,
          content: toBase64(payload),
          sha: cur.sha
        })
      })
      data = JSON.parse(payload)
      writeCache()
      dirty = false
      render()
      status('已保存。站点大约 1–2 分钟后更新，晚上的邮件就会带上这些安排了。', 'ok')
    } catch (e) {
      const msg = String(e.message || e)
      if (msg === 'NO_TOKEN') {
        status('还没解锁。点右上角的钥匙，先解锁娜娜莉的保险箱（里面存着 GitHub token）。', 'warn')
      } else if (/^409/.test(msg)) {
        status('远端有更新的版本，和你手上的对不上。刷新页面拿到最新的再改一次。', 'bad')
      } else if (/^40[13]/.test(msg)) {
        status(`GitHub 拒绝了：${msg}。多半是 token 权限不够 —— 需要这个仓库的 Contents 读写。`, 'bad')
      } else {
        status('保存失败：' + msg, 'bad')
      }
      if (btn) btn.disabled = false
    }
  }

  // ---------------- 渲染 ----------------

  let statusTimer = null
  const status = (text, kind = '') => {
    const bar = root.querySelector('[data-role="status"]')
    if (!bar) return
    bar.textContent = text
    bar.className = 'sch-status' + (kind ? ' is-' + kind : '')
    clearTimeout(statusTimer)
    if (kind === 'ok') statusTimer = setTimeout(() => { bar.textContent = ''; bar.className = 'sch-status' }, 8000)
  }

  const WEEK = ['一', '二', '三', '四', '五', '六', '日']

  const monthGrid = (y, m) => {
    const first = new Date(Date.UTC(y, m - 1, 1))
    // 让周一排在第一列
    const lead = (first.getUTCDay() + 6) % 7
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate()
    const cells = []
    for (let i = 0; i < lead; i++) cells.push(null)
    for (let d = 1; d <= days; d++) cells.push(d)
    while (cells.length % 7) cells.push(null)
    return cells
  }

  const condForm = t => {
    const w = t.when || { type: '', match: '' }
    const cur = COND_TYPES.find(x => x.v === w.type) || COND_TYPES[0]
    return `<form class="sch-condform" data-role="condform" data-id="${t.id}">
      <select data-role="ctype">
        ${COND_TYPES.map(x => `<option value="${x.v}"${x.v === w.type ? ' selected' : ''}>${x.label}</option>`).join('')}
      </select>
      <input type="text" data-role="cmatch" value="${esc(w.match || '')}"
             placeholder="${esc(cur.hint || '不需要填')}" ${cur.v ? '' : 'disabled'} maxlength="40">
      <button type="submit">确定</button>
      <button type="button" data-act="condcancel">取消</button>
      <div class="sch-condtip">
        满足条件时，每晚的定时任务会自动勾上它，并在邮件里说明依据。勾错了你去掉就行。
      </div>
    </form>`
  }

  const render = () => {
    const cells = monthGrid(viewY, viewM)
    const totalOpen = Object.values(data.days || {}).reduce((n, l) => n + l.filter(t => !t.done).length, 0)

    root.innerHTML = `
      <div class="sch-wrap">
        <div class="sch-head">
          <div class="sch-title">
            <button class="sch-nav" data-act="prev" title="上个月">‹</button>
            <span class="sch-month">${viewY} 年 ${viewM} 月</span>
            <button class="sch-nav" data-act="next" title="下个月">›</button>
            <button class="sch-today" data-act="today">回到今天</button>
          </div>
          <div class="sch-tools">
            <span class="sch-count">${totalOpen ? `还有 ${totalOpen} 件没做` : '全部做完了'}</span>
            <button class="sch-save${dirty ? ' is-dirty' : ''}" data-act="save" ${dirty ? '' : 'disabled'}>
              ${dirty ? '保存到仓库' : '已同步'}
            </button>
          </div>
        </div>

        <div class="sch-grid">
          ${WEEK.map(w => `<div class="sch-wd">${w}</div>`).join('')}
          ${cells.map(d => {
            if (!d) return '<div class="sch-cell is-blank"></div>'
            const k = keyOf(viewY, viewM, d)
            const list = tasksOf(k)
            const open = list.filter(t => !t.done).length
            const cls = ['sch-cell']
            if (k === TODAY.key) cls.push('is-today')
            if (k === picked) cls.push('is-picked')
            if (list.length) cls.push('has-task')
            if (k < TODAY.key && open) cls.push('is-overdue')
            return `<div class="${cls.join(' ')}" data-day="${k}">
              <div class="sch-d">${d}</div>
              ${list.slice(0, 2).map(t =>
                `<div class="sch-chip${t.done ? ' is-done' : ''}">${esc(t.text)}</div>`).join('')}
              ${list.length > 2 ? `<div class="sch-more">还有 ${list.length - 2} 条</div>` : ''}
            </div>`
          }).join('')}
        </div>

        <div class="sch-panel">
          <div class="sch-panel__head">
            <b>${picked}</b>
            <span>${picked === TODAY.key ? '今天' : ''}</span>
          </div>
          <div class="sch-list">
            ${tasksOf(picked).length
              ? tasksOf(picked).map(t => `
                <div class="sch-item${t.done ? ' is-done' : ''}" data-id="${t.id}">
                  <div class="sch-row">
                    <button class="sch-tick" data-act="toggle" data-id="${t.id}" aria-label="切换完成">
                      ${t.done ? '✓' : ''}
                    </button>
                    <span class="sch-text" data-act="edit" data-id="${t.id}" title="点一下改">${esc(t.text)}</span>
                    <button class="sch-del" data-act="del" data-id="${t.id}" aria-label="删除">×</button>
                  </div>
                  ${t.autoWhy
                    ? `<div class="sch-auto">窝替你勾的 —— ${esc(t.autoWhy)}</div>`
                    : ''}
                  ${condFor === t.id ? condForm(t) : `
                    <button class="sch-cond${t.when && t.when.type ? ' is-set' : ''}"
                            data-act="cond" data-id="${t.id}">
                      ${t.when && t.when.type ? '⛭ ' + esc(condLabel(t.when)) : '＋ 加个完成条件'}
                    </button>`}
                </div>`).join('')
              : '<div class="sch-empty">这天还什么都没安排。</div>'}
          </div>
          <form class="sch-add" data-role="add">
            <input type="text" data-role="new" placeholder="写点什么，回车添加" maxlength="120" autocomplete="off">
            <button type="submit">添加</button>
          </form>
        </div>

        <div class="sch-status" data-role="status"></div>
        <div class="sch-tip">
          安排改完要点「保存到仓库」才会生效。保存后站点约 1–2 分钟更新，
          当晚娜娜莉的邮件里就会带上当天的任务提醒。
        </div>
      </div>`
  }

  // ---------------- 交互 ----------------

  root.addEventListener('click', e => {
    const cell = e.target.closest('[data-day]')
    if (cell && !e.target.closest('[data-act]')) { picked = cell.dataset.day; render(); return }

    const btn = e.target.closest('[data-act]')
    if (!btn) return
    const act = btn.dataset.act

    if (act === 'prev') { viewM--; if (viewM < 1) { viewM = 12; viewY-- } render(); return }
    if (act === 'next') { viewM++; if (viewM > 12) { viewM = 1; viewY++ } render(); return }
    if (act === 'today') { viewY = TODAY.y; viewM = TODAY.m; picked = TODAY.key; render(); return }
    if (act === 'save') { save(); return }

    if (act === 'toggle') {
      setTasks(picked, tasksOf(picked).map(t => t.id === btn.dataset.id ? { ...t, done: !t.done } : t))
      return
    }
    if (act === 'del') {
      setTasks(picked, tasksOf(picked).filter(t => t.id !== btn.dataset.id))
      return
    }
    if (act === 'cond') { condFor = btn.dataset.id; render(); return }
    if (act === 'condcancel') { condFor = null; render(); return }

    if (act === 'edit') {
      const cur = tasksOf(picked).find(t => t.id === btn.dataset.id)
      if (!cur) return
      const next = prompt('改成：', cur.text)
      if (next == null) return
      const text = next.trim()
      setTasks(picked, text
        ? tasksOf(picked).map(t => t.id === cur.id ? { ...t, text: text.slice(0, 120) } : t)
        : tasksOf(picked).filter(t => t.id !== cur.id))
    }
  })

  // 换条件类型时，关键词框跟着启用/禁用
  root.addEventListener('change', e => {
    if (!e.target.matches('[data-role="ctype"]')) return
    const form = e.target.closest('[data-role="condform"]')
    const input = form.querySelector('[data-role="cmatch"]')
    const t = COND_TYPES.find(x => x.v === e.target.value) || COND_TYPES[0]
    input.disabled = !t.v
    input.placeholder = t.hint || '不需要填'
    if (t.v) input.focus()
  })

  root.addEventListener('submit', e => {
    if (e.target.matches('[data-role="condform"]')) {
      e.preventDefault()
      const id = e.target.dataset.id
      const type = e.target.querySelector('[data-role="ctype"]').value
      const match = e.target.querySelector('[data-role="cmatch"]').value.trim()
      const need = (COND_TYPES.find(x => x.v === type) || {}).need
      if (type && need && !match) {
        status('这个条件需要填一个关键词，不然没法判断。', 'warn')
        return
      }
      condFor = null
      setTasks(picked, tasksOf(picked).map(t => {
        if (t.id !== id) return t
        const next = { ...t }
        if (type) next.when = { type, match }
        else delete next.when
        return next
      }))
      return
    }
    if (!e.target.matches('[data-role="add"]')) return
    e.preventDefault()
    const input = e.target.querySelector('[data-role="new"]')
    const text = input.value.trim()
    if (!text) return
    setTasks(picked, tasksOf(picked).concat([{ id: uid(), text: text.slice(0, 120), done: false }]))
    // render 会重建 DOM，得重新拿一次输入框
    const again = root.querySelector('[data-role="new"]')
    if (again) again.focus()
  })

  // 有未保存的改动时离开页面提醒一下
  window.addEventListener('beforeunload', e => {
    if (!dirty) return
    e.preventDefault()
    e.returnValue = ''
  })

  // ---------------- 启动 ----------------

  render()
  loadData().then(src => {
    render()
    if (src === 'cache-newer') status('显示的是你本地还没部署完的版本，站点更新后会一致。', 'warn')
  })

  window.NOIMPTY_SCHEDULE = Object.freeze({
    data: () => JSON.parse(JSON.stringify(data)),
    reload: () => loadData().then(render),
    clearCache: () => { try { localStorage.removeItem(LS_CACHE) } catch (_) {} return '本地缓存已清' }
  })
})()
