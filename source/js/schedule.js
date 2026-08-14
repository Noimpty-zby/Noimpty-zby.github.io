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
 * 三个必须理解的坑（都踩过了，别再简化掉）：
 *
 * 1. 保存不是覆盖，是三方合并。
 *    每晚的定时任务会自动勾任务并提交，手机上也可能改过。如果这里直接
 *    「读最新 sha → 整个文件覆盖」，那个 sha 永远是最新的、永远不冲突，
 *    结果就是把别人的改动无声抹掉。所以记下打开页面时的基准版本，
 *    保存时和远端做三方合并：我动过的以我为准，我没动过的以远端为准。
 *
 * 2. 读不到远端就绝不允许保存。
 *    以前 fetch 失败会静默变成空日程，你加一条再保存 = 整个仓库的日程被清空。
 *
 * 3. pjax 不会重新执行本脚本。
 *    从首页点「日程」进来时，DOM 换了但脚本不再跑，页面会是空白的。
 *    所以入口必须是 mount()，并挂在 pjax:complete 上。
 */
(() => {
  'use strict'

  const REPO = (window.NOIMPTY_SCHEDULE_REPO || 'Noimpty-zby/Noimpty-zby.github.io')
  const DATA_PATH = 'source/_data/schedule.json'
  const LS_CACHE = 'noimpty-schedule-cache-v1'

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

  // ---------------- 状态 ----------------

  let root = null
  let today = beijingParts()
  let data = { updatedAt: '', days: {} }
  let baseline = null        // 打开页面时仓库里的样子，合并的基准。null = 没读到，不许保存
  let dirty = false
  let saving = false
  let viewY = today.y
  let viewM = today.m
  let picked = today.key
  let pickedByHand = false
  let condFor = null         // 正在编辑完成条件的任务 id
  let editFor = null         // 正在行内改文字的任务 id
  let changeCount = 0        // 这次打开页面之后改了几处（保存条上显示）
  let focusInput = false     // 下次 render 之后要不要把光标放进输入框
  let loaded = false

  const cloneDays = d => JSON.parse(JSON.stringify(d || {}))

  const readCache = () => {
    try { return JSON.parse(localStorage.getItem(LS_CACHE) || 'null') } catch (_) { return null }
  }
  // dirty 必须跟着缓存一起存。否则「加了几条 → 刷新」之后，
  // 内容还在但按钮显示「已同步」且点不动，那几条永远推不上去。
  const writeCache = () => {
    try {
      localStorage.setItem(LS_CACHE, JSON.stringify({
        updatedAt: data.updatedAt, days: data.days, _dirty: dirty, _base: baseline
      }))
    } catch (_) {}
  }

  const loadData = async () => {
    let remote = null
    let netFail = false
    try {
      const res = await fetch('/schedule/data.json?t=' + Date.now(), { cache: 'no-store' })
      if (res.ok) remote = await res.json()
      else netFail = true
    } catch (_) { netFail = true }
    if (remote && typeof remote !== 'object') { remote = null; netFail = true }

    const cached = readCache()
    loaded = true

    // 基准优先用远端 —— 它是仓库里真实存在过的一个版本，越新越好
    if (remote) baseline = cloneDays(remote.days)
    else if (cached && cached._base) baseline = cloneDays(cached._base)
    else baseline = null

    // 刚保存完、部署还没跑完时，远端是旧的。比时间戳，谁新用谁。
    if (cached && (!remote || String(cached.updatedAt || '') > String(remote.updatedAt || ''))) {
      data = { updatedAt: cached.updatedAt || '', days: cached.days || {} }
      dirty = !!cached._dirty
      return remote ? 'cache-newer' : (netFail ? 'cache-offline' : 'cache-only')
    }
    if (!remote) { data = { updatedAt: '', days: {} }; dirty = false; return 'failed' }
    data = { updatedAt: remote.updatedAt || '', days: remote.days || {} }
    dirty = false
    writeCache()
    return 'remote'
  }

  const nextDay = k => {
    const [y, m, d] = k.split('-').map(Number)
    const t = new Date(Date.UTC(y, m - 1, d + 1))
    return keyOf(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate())
  }

  const tasksOf = k => (data.days && Array.isArray(data.days[k])) ? data.days[k] : []
  const setTasks = (k, list) => {
    if (!data.days) data.days = {}
    if (list.length) data.days[k] = list
    else delete data.days[k]
    data.updatedAt = new Date().toISOString()
    dirty = true
    changeCount++
    writeCache()
    render()
  }

  // 把一条任务从一天挪到另一天。合并那边是按任务 id 认的，
  // 所以「换一天」会被正确识别成一次改动，不会变成删一条又加一条。
  const moveTask = (fromKey, toKey, id) => {
    const src = tasksOf(fromKey)
    const one = src.find(t => t.id === id)
    if (!one || fromKey === toKey) return
    if (!data.days) data.days = {}
    const rest = src.filter(t => t.id !== id)
    if (rest.length) data.days[fromKey] = rest
    else delete data.days[fromKey]
    data.days[toKey] = tasksOf(toKey).concat([one])
    data.updatedAt = new Date().toISOString()
    dirty = true
    changeCount++
    writeCache()
    render()
  }

  // ---------------- 三方合并 ----------------

  // 比较用的规范形式：和字段书写顺序无关，只看真正的内容
  const normTask = t => JSON.stringify({
    id: String(t.id || ''),
    text: String(t.text || ''),
    done: !!t.done,
    when: t.when && t.when.type ? { type: String(t.when.type), match: String(t.when.match || '') } : null,
    autoWhy: String(t.autoWhy || '')
  })

  // 和字段/键的书写顺序无关的整体比较，用来判断「远端变了没有」
  const normDays = days => {
    const o = {}
    Object.keys(days || {}).sort().forEach(k => {
      const list = Array.isArray(days[k]) ? days[k] : []
      const arr = list.filter(t => t && t.id).map(normTask).sort()
      if (arr.length) o[k] = arr
    })
    return JSON.stringify(o)
  }

  const indexTasks = days => {
    const m = new Map()
    Object.keys(days || {}).forEach(k => {
      const list = Array.isArray(days[k]) ? days[k] : []
      list.forEach(t => { if (t && t.id) m.set(String(t.id), { day: k, task: t }) })
    })
    return m
  }

  /* base = 我打开页面时仓库的样子；mine = 我现在手上的；theirs = 此刻仓库里的。
   * 规则：我动过的以我为准，我没动过的以远端为准。删除同理。 */
  const mergeDays = (base, mine, theirs) => {
    const B = indexTasks(base), M = indexTasks(mine), T = indexTasks(theirs)
    const out = {}
    const put = (day, task) => { (out[day] = out[day] || []).push(task) }
    const changed = (a, b) => !b || normTask(a.task) !== normTask(b.task) || a.day !== b.day

    new Set([...M.keys(), ...T.keys()]).forEach(id => {
      const b = B.get(id), m = M.get(id), t = T.get(id)
      if (m && t) {
        // 两边都有：我改过就用我的，否则用远端的（这样娜娜莉自动勾的 done 不会被顶掉）
        if (changed(m, b)) put(m.day, m.task)
        else put(t.day, t.task)
      } else if (m) {
        // 远端没有：我新加的，或者我改过而远端删了 —— 都保留；我没动而远端删了 —— 跟着删
        if (!b || changed(m, b)) put(m.day, m.task)
      } else if (t) {
        // 我这边没有：远端新加的，或者远端改过而我删了 —— 都保留；远端没动而我删了 —— 删掉
        if (!b || changed(t, b)) put(t.day, t.task)
      }
    })

    // 每天内部的顺序：以我这边为准，远端新增的排在后面
    Object.keys(out).forEach(day => {
      const order = new Map()
      const mineList = Array.isArray(mine[day]) ? mine[day] : []
      const theirList = Array.isArray(theirs[day]) ? theirs[day] : []
      mineList.forEach((t, i) => { if (t && t.id) order.set(String(t.id), i) })
      theirList.forEach((t, i) => { if (t && t.id && !order.has(String(t.id))) order.set(String(t.id), 1000 + i) })
      out[day].sort((a, b) => {
        const x = order.has(String(a.id)) ? order.get(String(a.id)) : 9999
        const y = order.has(String(b.id)) ? order.get(String(b.id)) : 9999
        return x - y
      })
    })
    return out
  }

  // ---------------- 保存到仓库 ----------------

  const token = () => {
    try { return (window.NANALY && window.NANALY.githubToken && window.NANALY.githubToken()) || null }
    catch (_) { return null }
  }
  // 三种「拿不到 token」是三件不同的事，提示必须分清楚，
  // 否则「保险箱明明开着却一直叫你去解锁」，你会陷在死循环里。
  const hasVault = () => {
    try { return !!localStorage.getItem('nanaly-vault-v1') } catch (_) { return false }
  }
  const vaultLocked = () => {
    try { return !!(window.NANALY && window.NANALY.isLocked && window.NANALY.isLocked()) }
    catch (_) { return false }
  }

  const gh = async (path, init = {}) => {
    const t = token()
    if (!t) throw new Error(!hasVault() ? 'NO_VAULT' : (vaultLocked() ? 'LOCKED' : 'NO_TOKEN'))
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
  const fromBase64 = b64 => {
    const bin = atob(String(b64 || '').replace(/\s+/g, ''))
    const bytes = Uint8Array.from(bin, c => c.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  }

  const save = async () => {
    if (saving) return
    if (!baseline) {
      status('刚才没能读到仓库里的日程，现在保存会把别的日子覆盖掉。先刷新页面，读到了再保存。', 'bad')
      return
    }
    saving = true
    render()
    try {
      status('正在读取远端版本…')
      const cur = await gh(`contents/${DATA_PATH}`)

      // 远端内容必须真的解得出来。解不出来就停手 ——
      // 把「读失败」当成「远端是空的」去合并，等于删光别人的东西。
      if (cur.encoding !== 'base64' || !cur.content) throw new Error('REMOTE_UNREADABLE')
      let theirs
      try {
        const obj = JSON.parse(fromBase64(cur.content))
        if (!obj || typeof obj !== 'object' || typeof obj.days !== 'object' || obj.days === null) {
          throw new Error('shape')
        }
        theirs = obj.days
      } catch (_) { throw new Error('REMOTE_UNREADABLE') }

      const theyMoved = normDays(theirs) !== normDays(baseline)
      const merged = mergeDays(baseline, data.days || {}, theirs)

      status('正在提交…')
      const payload = JSON.stringify({ updatedAt: new Date().toISOString(), days: merged }, null, 2) + '\n'
      await gh(`contents/${DATA_PATH}`, {
        method: 'PUT',
        body: JSON.stringify({
          message: `日程更新 ${beijingParts().key}`,
          content: toBase64(payload),
          sha: cur.sha
        })
      })

      data = JSON.parse(payload)
      baseline = cloneDays(merged)
      dirty = false
      changeCount = 0
      writeCache()
      status(theyMoved
        ? '已保存。你打开这页之后仓库里也有改动（多半是娜娜莉自动勾的），窝把两边合起来了，都在。'
        : '已保存。站点大约 1–2 分钟后更新，晚上的邮件就会带上这些安排了。', 'ok')
    } catch (e) {
      const msg = String(e.message || e)
      if (msg === 'NO_VAULT') {
        status('这台浏览器还没配过娜娜莉的保险箱。点左下角猫爪 → 齿轮，设好密码并填上 GitHub Token，才能从网页保存日程。', 'warn')
      } else if (msg === 'LOCKED') {
        status('还没解锁。点左下角猫爪，输解锁密码打开娜娜莉的保险箱（GitHub token 存在里面）。', 'warn')
        try { if (window.NANALY && window.NANALY.requestUnlock) window.NANALY.requestUnlock() } catch (_) {}
      } else if (msg === 'NO_TOKEN') {
        status('保险箱开着，但里面没有 GitHub Token。点猫爪 → 齿轮，把 token 填进去再保存。', 'warn')
      } else if (msg === 'REMOTE_UNREADABLE') {
        status('读不出仓库里那份日程的内容，为安全起见没有提交。刷新页面再试一次。', 'bad')
      } else if (/^409/.test(msg)) {
        status('远端刚好也在写，撞上了。再点一次「保存到仓库」就行。', 'warn')
      } else if (/^40[13]/.test(msg)) {
        status(`GitHub 拒绝了：${msg}。多半是 token 权限不够 —— 需要这个仓库的 Contents 读写。`, 'bad')
      } else {
        status('保存失败：' + msg + '（你写的东西还在，没有丢）', 'bad')
      }
    } finally {
      saving = false
      render()
    }
  }

  // ---------------- 渲染 ----------------

  let statusTimer = null
  let pendingStatus = null
  const status = (text, kind = '') => {
    pendingStatus = text ? { text, kind } : null
    const bar = root && root.querySelector('[data-role="status"]')
    if (!bar) return
    bar.textContent = text
    bar.className = 'sch-status' + (kind ? ' is-' + kind : '')
    clearTimeout(statusTimer)
    if (kind === 'ok') {
      statusTimer = setTimeout(() => {
        pendingStatus = null
        const b = root && root.querySelector('[data-role="status"]')
        if (b) { b.textContent = ''; b.className = 'sch-status' }
      }, 8000)
    }
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
    return `<form class="sch-condform" data-role="condform" data-id="${esc(t.id)}">
      <select data-role="ctype">
        ${COND_TYPES.map(x => `<option value="${esc(x.v)}"${x.v === w.type ? ' selected' : ''}>${esc(x.label)}</option>`).join('')}
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

  // 跨过午夜的时候「今天」要跟着走，否则半夜写的安排会落到昨天那一格
  const refreshToday = () => {
    const now = beijingParts()
    if (now.key === today.key) return
    const wasOnToday = picked === today.key && !pickedByHand
    today = now
    if (wasOnToday) { picked = now.key; viewY = now.y; viewM = now.m }
  }

  // 「8-15」这种日期本身没什么意义，加一句「明天 / 周三 / 3 天前」才好读
  const WD = ['日', '一', '二', '三', '四', '五', '六']
  const dayLabel = k => {
    if (k === today.key) return '今天'
    const [y, m, d] = k.split('-').map(Number)
    const diff = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(today.y, today.m - 1, today.d)) / 86400000)
    const wd = '周' + WD[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
    if (diff === 1) return '明天 · ' + wd
    if (diff === -1) return '昨天 · ' + wd
    if (diff > 1 && diff <= 7) return `${diff} 天后 · ${wd}`
    if (diff < -1) return `${-diff} 天前 · ${wd}`
    return wd
  }

  // 过期未完成的，单独拎出来。否则它们躺在上个月的格子里，你永远不会翻回去看。
  const overdueList = () => {
    const out = []
    Object.keys(data.days || {}).sort().forEach(k => {
      if (k >= today.key) return
      const list = Array.isArray(data.days[k]) ? data.days[k] : []
      list.forEach(t => { if (t && !t.done) out.push({ day: k, id: t.id, text: t.text }) })
    })
    return out
  }

  const render = () => {
    if (!root) return
    refreshToday()
    const cells = monthGrid(viewY, viewM)
    const totalOpen = Object.values(data.days || {})
      .reduce((n, l) => n + (Array.isArray(l) ? l.filter(t => !t.done).length : 0), 0)
    const overdue = overdueList()

    const saveText = saving ? '保存中…' : (dirty ? '保存到仓库' : '已同步')

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
            <button class="sch-save${dirty ? ' is-dirty' : ''}" data-act="save"
                    ${dirty && !saving ? '' : 'disabled'}>${saveText}</button>
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
            if (k === today.key) cls.push('is-today')
            if (k === picked) cls.push('is-picked')
            if (list.length) cls.push('has-task')
            if (k < today.key && open) cls.push('is-overdue')
            return `<div class="${cls.join(' ')}" data-day="${esc(k)}">
              <div class="sch-d">${d}${open ? `<i class="sch-dot" title="${open} 件没做"></i>` : ''}</div>
              ${list.slice(0, 3).map(t =>
                `<div class="sch-chip${t.done ? ' is-done' : ''}">${esc(t.text)}</div>`).join('')}
              ${list.length > 3 ? `<div class="sch-more">还有 ${list.length - 3} 条</div>` : ''}
            </div>`
          }).join('')}
        </div>

        <div class="sch-panel">
          <div class="sch-panel__head">
            <b>${esc(picked)}</b>
            <span>${esc(dayLabel(picked))}</span>
            ${picked !== today.key ? '<button class="sch-mini" data-act="today">回到今天</button>' : ''}
          </div>

          <form class="sch-add" data-role="add">
            <input type="text" data-role="new" placeholder="${picked === today.key ? '今天要做什么？回车添加' : '这天要做什么？回车添加'}"
                   maxlength="120" autocomplete="off">
            <button type="submit">添加</button>
          </form>

          <div class="sch-list">
            ${tasksOf(picked).length
              ? tasksOf(picked).map(t => `
                <div class="sch-item${t.done ? ' is-done' : ''}" data-id="${esc(t.id)}">
                  <div class="sch-row">
                    <button class="sch-tick" data-act="toggle" data-id="${esc(t.id)}" aria-label="切换完成">
                      ${t.done ? '✓' : ''}
                    </button>
                    ${editFor === t.id
                      ? `<input class="sch-edit" data-role="editbox" data-id="${esc(t.id)}"
                                value="${esc(t.text)}" maxlength="120" autocomplete="off">`
                      : `<span class="sch-text" data-act="edit" data-id="${esc(t.id)}" title="点一下改">${esc(t.text)}</span>`}
                    ${t.done ? '' : `<button class="sch-push" data-act="push" data-id="${esc(t.id)}" title="推到明天">→</button>`}
                    <button class="sch-del" data-act="del" data-id="${esc(t.id)}" aria-label="删除">×</button>
                  </div>
                  ${t.autoWhy
                    ? `<div class="sch-auto">窝替你勾的 —— ${esc(t.autoWhy)}</div>`
                    : ''}
                  ${condFor === t.id ? condForm(t) : `
                    <button class="sch-cond${t.when && t.when.type ? ' is-set' : ''}"
                            data-act="cond" data-id="${esc(t.id)}">
                      ${t.when && t.when.type ? '⛭ ' + esc(condLabel(t.when)) : '＋ 加个完成条件'}
                    </button>`}
                </div>`).join('')
              : '<div class="sch-empty">这天还什么都没安排。</div>'}
          </div>
        </div>

        ${overdue.length ? `
          <div class="sch-overdue">
            <div class="sch-overdue__head">之前没做完的（${overdue.length} 件）</div>
            ${overdue.slice(0, 6).map(o => `
              <div class="sch-overdue__row">
                <button class="sch-overdue__jump" data-act="jump" data-day="${esc(o.day)}">${esc(o.day.slice(5))}</button>
                <span>${esc(o.text)}</span>
                <button class="sch-mini" data-act="pulltoday" data-day="${esc(o.day)}" data-id="${esc(o.id)}">挪到今天</button>
              </div>`).join('')}
            ${overdue.length > 6 ? `<div class="sch-overdue__more">还有 ${overdue.length - 6} 件…</div>` : ''}
          </div>` : ''}

        <div class="sch-status" data-role="status"></div>

        ${dirty || saving ? `
          <div class="sch-savebar">
            <span>有 ${changeCount} 处改动还没保存到仓库</span>
            <button data-act="save" ${saving ? 'disabled' : ''}>${saving ? '保存中…' : '保存到仓库'}</button>
          </div>` : ''}

        <div class="sch-tip">
          安排改完要点「保存到仓库」才会生效。保存后站点约 1–2 分钟更新，
          当晚娜娜莉的邮件里就会带上当天的任务提醒。
        </div>
      </div>`

    // render 会重建 DOM，状态条得补回去，否则提示一闪就没
    if (pendingStatus) {
      const bar = root.querySelector('[data-role="status"]')
      if (bar) {
        bar.textContent = pendingStatus.text
        bar.className = 'sch-status' + (pendingStatus.kind ? ' is-' + pendingStatus.kind : '')
      }
    }

    // 行内编辑框：出现就把光标放进去并全选，直接打字就能覆盖
    const editBox = root.querySelector('[data-role="editbox"]')
    if (editBox) { editBox.focus(); editBox.select() }
    else if (focusInput) {
      const box = root.querySelector('[data-role="new"]')
      if (box) box.focus()
    }
    focusInput = false
  }

  // 提交行内编辑。文字清空 = 删掉这条（和以前 prompt 的行为一致）
  const commitEdit = (id, value) => {
    const text = String(value || '').trim()
    editFor = null
    const cur = tasksOf(picked).find(t => t.id === id)
    if (!cur) { render(); return }
    if (text === cur.text) { render(); return }
    setTasks(picked, text
      ? tasksOf(picked).map(t => (t.id === id ? { ...t, text: text.slice(0, 120) } : t))
      : tasksOf(picked).filter(t => t.id !== id))
  }

  // ---------------- 交互 ----------------

  const bindRoot = node => {
    if (node.dataset.schBound === '1') return
    node.dataset.schBound = '1'

    node.addEventListener('click', e => {
      const cell = e.target.closest('[data-day]')
      if (cell && !e.target.closest('[data-act]')) {
        // 点完一天光标就该在输入框里。以前要再点一次输入框才能打字，
        // 「点一下、移到下面、再点一下」这三步是这个页面最别扭的地方。
        picked = cell.dataset.day
        pickedByHand = true
        editFor = null
        condFor = null
        focusInput = true
        render()
        return
      }

      const btn = e.target.closest('[data-act]')
      if (!btn) return
      const act = btn.dataset.act

      if (act === 'prev') { viewM--; if (viewM < 1) { viewM = 12; viewY-- } render(); return }
      if (act === 'next') { viewM++; if (viewM > 12) { viewM = 1; viewY++ } render(); return }
      if (act === 'today') {
        refreshToday()
        viewY = today.y; viewM = today.m; picked = today.key; pickedByHand = false
        render(); return
      }
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

      // 就地改，不弹 prompt()。浏览器的原生弹窗又丑又打断节奏，
      // 手机上还会把整个页面顶掉。
      if (act === 'edit') { editFor = btn.dataset.id; condFor = null; render(); return }

      // 今天没做完 → 推到明天。以前只能删了到明天重新打一遍。
      if (act === 'push') {
        const cur = tasksOf(picked).find(t => t.id === btn.dataset.id)
        if (!cur) return
        moveTask(picked, nextDay(picked), cur.id)
        status(`「${cur.text}」推到 ${nextDay(picked).slice(5)} 了`, 'ok')
        return
      }

      // 过期清单里的两个动作
      if (act === 'jump') {
        picked = btn.dataset.day
        pickedByHand = true
        const [y, m] = picked.split('-').map(Number)
        viewY = y; viewM = m
        render(); return
      }
      if (act === 'pulltoday') {
        moveTask(btn.dataset.day, today.key, btn.dataset.id)
        return
      }
    })

    node.addEventListener('keydown', e => {
      if (e.target.matches('[data-role="editbox"]')) {
        if (e.key === 'Enter') { e.preventDefault(); commitEdit(e.target.dataset.id, e.target.value) }
        else if (e.key === 'Escape') { e.preventDefault(); editFor = null; render() }
        return
      }
      // 条件表单开着的时候按 Esc 收起来。没有这个的话只能去点「取消」。
      if (e.key === 'Escape' && condFor) { condFor = null; render() }
    })

    // 点到别处就当确认。半开的编辑框留在那儿是这个页面第二别扭的地方。
    node.addEventListener('focusout', e => {
      if (!e.target.matches('[data-role="editbox"]')) return
      const id = e.target.dataset.id
      const val = e.target.value
      setTimeout(() => { if (editFor === id) commitEdit(id, val) }, 120)
    })

    // 换条件类型时，关键词框跟着启用/禁用
    node.addEventListener('change', e => {
      if (!e.target.matches('[data-role="ctype"]')) return
      const form = e.target.closest('[data-role="condform"]')
      const input = form.querySelector('[data-role="cmatch"]')
      const t = COND_TYPES.find(x => x.v === e.target.value) || COND_TYPES[0]
      input.disabled = !t.v
      input.placeholder = t.hint || '不需要填'
      if (t.v) input.focus()
    })

    node.addEventListener('submit', e => {
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
      focusInput = true
      setTasks(picked, tasksOf(picked).concat([{ id: uid(), text: text.slice(0, 120), done: false }]))
    })
  }

  // 有未保存的改动时离开页面提醒一下。
  // 注意：dirty 已经写进 localStorage 了，所以就算硬关掉，回来内容也还在。
  window.addEventListener('beforeunload', e => {
    if (!dirty || !root) return
    e.preventDefault()
    e.returnValue = ''
  })
  // pjax 换页不触发 beforeunload，这里只提示一句，不拦（拦不干净）
  window.addEventListener('pjax:send', () => {
    if (dirty && root) {
      try { console.info('[日程] 有还没保存到仓库的改动，已存在本地，回到 /schedule/ 还能看到。') } catch (_) {}
    }
  })

  // ---------------- 挂载（pjax 换页要重来一次）----------------

  const mount = () => {
    const node = document.getElementById('noimpty-schedule')
    root = node || null
    if (!root) return
    bindRoot(root)
    render()
    if (!loaded) {
      loadData().then(src => {
        render()
        if (src === 'cache-newer' || src === 'cache-only') {
          status('显示的是你本地还没部署完的版本，站点更新后会一致。', 'warn')
        } else if (src === 'cache-offline') {
          status('没连上站点，显示的是本地缓存。保存前会先和仓库合并，不会覆盖别的日子。', 'warn')
        } else if (src === 'failed') {
          status('读不到仓库里的日程（网络或部署问题），现在不能保存 —— 否则会把已有安排冲掉。刷新试试。', 'bad')
        }
      })
    }
  }

  mount()
  window.addEventListener('pjax:complete', () => setTimeout(mount, 60))

  window.NOIMPTY_SCHEDULE = Object.freeze({
    data: () => JSON.parse(JSON.stringify(data)),
    baseline: () => (baseline ? JSON.parse(JSON.stringify(baseline)) : null),
    dirty: () => dirty,
    reload: () => { loaded = false; return loadData().then(r => { render(); return r }) },
    mergeDays,
    clearCache: () => { try { localStorage.removeItem(LS_CACHE) } catch (_) {} return '本地缓存已清' }
  })
})()
