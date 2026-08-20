/* 策划室：在浏览器里直接读私有仓库，渲染出来，并把反馈写回去。
 *
 * 为什么要绕这一圈：
 *
 * 策划案不能外传，而这个博客仓库是公开的（免费的 GitHub Pages 只能从公开仓库发布）。
 * 所以任何写进博客仓库的东西都是公开的 —— 暗号锁挡的是眼睛，不是会看源代码的人。
 *
 * 于是这些内容根本不进这个仓库。它们在一个**私有仓库**里，这一页在你的浏览器里、
 * 用娜娜莉保险箱里那把 token 去取，取回来当场渲染。构建产物里没有一个字。
 *
 * 反馈也是同一条路反着走：你在页面上写，直接 PUT 回私有仓库的 feedback/inbox.json，
 * 策划 AI 下次跑的时候读到它，逐条回应。整条链路不经过任何第三方。
 *
 * ── 这一版加了什么，以及为什么 ──────────────────────────
 *
 * 第一版你唯一的入口是「读完某份文档给个评价」。也就是说
 * **必须先立项，你才说得上话** —— 而立项恰恰是最贵、最难回头的一步。
 * 实测的结果就是：你只能在事后连点两次「停掉」，不能在方向阶段拦一下。
 *
 * 所以这一版多了三条你能插手的通道：
 *
 *   候选投票   在方向还只是候选的时候就能「就它了 / 加一星 / 否掉」
 *   实验台     文档里那些「最小原型 → 观察什么 → 什么结果算推翻」
 *              变成可勾选的条目，你做完回填真实结果 ——
 *              那是这套系统能拿到的唯一一手证据，权重高于任何一轮推理
 *   下一轮预告 告诉你它下次醒来准备做什么，你才知道现在插队还来不来得及
 *
 * pjax 换页不会重新执行本脚本，所以入口是 mount() 并挂在 pjax:complete 上。
 */
(() => {
  'use strict'

  const REPO = () => (window.NOIMPTY_IDEAS_REPO || '').trim()
  const API = 'https://api.github.com'

  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

  let root = null
  let state = null            // state.json
  let inbox = null            // feedback/inbox.json（缓存一份，投票时增量追加）
  let view = { kind: 'list' } // list | project | doc | explore | experiments | lessons
  const cache = new Map()

  // ---------------- 取数据 ----------------

  const token = () => {
    try { return (window.NANALY && window.NANALY.githubToken && window.NANALY.githubToken()) || null }
    catch (_) { return null }
  }
  const hasVault = () => {
    try { return !!localStorage.getItem('nanaly-vault-v1') } catch (_) { return false }
  }
  const vaultLocked = () => {
    try { return !!(window.NANALY && window.NANALY.isLocked && window.NANALY.isLocked()) }
    catch (_) { return false }
  }

  /* 为什么先查仓库名再查 token：
   * 上一版反过来，于是「仓库名没填」这个问题永远被「保险箱没配」盖住 ——
   * 你按提示配好了保险箱，结果还是打不开，而且新的报错和旧的长得一样。
   * 配置类问题要先报，它是确定的；凭据类问题后报，它至少还有得救。 */
  const preflight = () => {
    if (!REPO()) return 'NO_REPO'
    if (!hasVault()) return 'NO_VAULT'
    if (vaultLocked()) return 'LOCKED'
    if (!token()) return 'NO_TOKEN'
    return null
  }

  const gh = async (path, init) => {
    const why = preflight()
    if (why) throw new Error(why)
    const res = await fetch(`${API}/repos/${REPO()}/contents/${encodeURI(path)}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token()}`,
        Accept: 'application/vnd.github+json',
        ...(init && init.headers)
      },
      signal: AbortSignal.timeout(30000)
    })
    if (res.status === 404) return null
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(`${res.status} ${body.message || ''}`.trim())
    return body
  }

  const readFile = async path => {
    const body = await gh(path)
    if (!body || body.encoding !== 'base64' || !body.content) return null
    const bin = atob(String(body.content).replace(/\s+/g, ''))
    return {
      text: new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))),
      sha: body.sha
    }
  }

  const readJson = async (path, fallback) => {
    try {
      const f = await readFile(path)
      return f ? JSON.parse(f.text) : fallback
    } catch (_) { return fallback }
  }

  /* 分块转 base64。
   *
   * 不能写成 `btoa(String.fromCharCode(...bytes))` —— 那是一次展开成
   * 几万个函数实参的调用，字节数一多就是 RangeError: Maximum call stack size exceeded。
   * 收件箱是**只增不减**的（跑完只是把条目标成已处理），中文注释又是一个字三字节，
   * 所以这个上限不是理论问题，攒够一两百条就会撞上 —— 撞上之后
   * 页面上所有的写入（反馈、投票、实验回填）会一起坏掉，而报错完全看不出原因。 */
  const toBase64 = text => {
    const bytes = new TextEncoder().encode(text)
    let bin = ''
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
    }
    return btoa(bin)
  }

  const writeFile = async (path, text, message, sha) => {
    const b64 = toBase64(text)
    return gh(path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, content: b64, ...(sha ? { sha } : {}) })
    })
  }

  const listDir = async dir => {
    try {
      const body = await gh(dir)
      return Array.isArray(body) ? body : []
    } catch (_) { return [] }
  }

  // ---------------- markdown 渲染 ----------------
  //
  // 策划文档比点子那批更规整（提示词把格式定死了），但仍然要能兜住走样的写法。

  // 占位符。写成转义而不是真的写一个空字节进来，
  // 否则整个 .js 会被当成二进制文件（grep 会拒绝、有些工具链会改坏它）。
  const HOLE = '\u0000'
  const ph = (k, i) => `${HOLE}${k}${i}${HOLE}`

  const normalize = src => String(src || '')
    .replace(/^﻿/, '')
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')       // front matter
    .replace(/^\s*={2,}\s*(正文|结束|完|END|end)\s*={2,}\s*$/gm, '')
    // 整行只有一个加粗 = 想写小标题但忘了井号
    .replace(/^\s*\*\*([^*\n]{2,40})\*\*\s*[:：]?\s*$/gm, '### $1')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()

  const HOST = url => {
    try { return new URL(url).hostname.replace(/^www\./, '') } catch (_) { return '' }
  }

  const inline = (s, codes) => s
    .replace(/`([^`\n]+)`/g, (_, c) => { codes.push(c); return ph('I', codes.length - 1) })
    .replace(/\[\[(\d{1,2})\]\]\((https?:\/\/[^)\s]+)\)/g,
      (_, n, u) => `<sup class="sd-cite"><a href="${u}" target="_blank" rel="noopener noreferrer" title="${HOST(u.replace(/&amp;/g, '&'))}">${n}</a></sup>`)
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?=[^*\w]|$)/g, '$1<em>$2</em>')
    .replace(/~~([^~\n]+)~~/g, '<del>$1</del>')

  let seq = 0
  const slug = () => 'sd-h' + (++seq)

  const md2html = source => {
    const codes = []
    const blocks = []
    let s = normalize(source)
    s = s.replace(/```([\w+-]*)\r?\n?([\s\S]*?)```/g, (_, lang, b) => {
      blocks.push({ lang, body: b.replace(/\r?\n$/, '') })
      return ph('C', blocks.length - 1)
    })
    s = esc(s)
    s = inline(s, codes)

    const out = []
    const toc = []
    let list = null, para = false, quote = false
    /* 段落不一定用 </p> 收尾 —— 「**标签** —— 正文」那种会被渲染成
     * 标签一行、正文一段的两层结构，收尾标签不一样。所以记着当前该收什么。 */
    let paraEnd = '</p>'

    const closePara = () => { if (para) { out[out.length - 1] += paraEnd; para = false } }
    const closeList = () => { if (list) { out.push('</' + list + '>'); list = null } }
    const closeQuote = () => { if (quote) { out.push('</blockquote>'); quote = false } }
    const closeAll = () => { closePara(); closeList(); closeQuote() }

    const lines = s.split(/\r?\n/)
    const isRow = l => /^\|.*\|$/.test(l)
    const isSep = l => /^\|[\s:|-]+\|$/.test(l) && l.includes('-')
    const cells = l => l.replace(/^\||\|$/g, '').split('|').map(c => c.trim())
    const isHole = l => l.length > 2 && l[0] === HOLE && l[l.length - 1] === HOLE

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line) { closeAll(); continue }
      if (isHole(line)) { closeAll(); out.push(line); continue }

      // 表格 —— 策划文档里到处是表格（风险登记、内容清单、90 秒分镜），这一块必须稳
      if (isRow(line) && isSep((lines[i + 1] || '').trim())) {
        closeAll()
        const head = cells(line)
        const rows = []
        i += 2
        while (i < lines.length && isRow(lines[i].trim())) { rows.push(cells(lines[i].trim())); i++ }
        i--
        out.push('<div class="sd-tablewrap"><table><thead><tr>' +
          head.map(c => `<th>${c}</th>`).join('') + '</tr></thead><tbody>' +
          rows.map(r => '<tr>' + r.map(c => `<td>${c}</td>`).join('') + '</tr>').join('') +
          '</tbody></table></div>')
        continue
      }

      const h = line.match(/^(#{1,6})\s+(.*)$/)
      if (h) {
        closeAll()
        const text = h[2].replace(/\s*#+\s*$/, '').trim()
        const bare = text.replace(/<[^>]+>/g, '').trim()
        const level = h[1].length
        const id = slug()
        if (level <= 2) toc.push({ id, name: bare, level })
        out.push(`<h${Math.min(6, level + 1)} class="sd-h sd-h--${level}" id="${id}">${text}</h${Math.min(6, level + 1)}>`)
        continue
      }

      if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) { closeAll(); out.push('<hr>'); continue }

      if (/^&gt;\s?/.test(line)) {
        closePara(); closeList()
        if (!quote) { out.push('<blockquote>'); quote = true }
        out.push(`<p>${line.replace(/^&gt;\s?/, '')}</p>`)
        continue
      }
      closeQuote()

      const ul = line.match(/^[-*+]\s+(.*)$/)
      const ol = line.match(/^\d+[.)]\s+(.*)$/)
      if (ul || ol) {
        closePara()
        const want = ul ? 'ul' : 'ol'
        if (list !== want) { closeList(); out.push('<' + want + '>'); list = want }
        const body = (ul || ol)[1]
        /* 「**它到底怎么运作** —— …」把标签拎出来，别和正文挤成一行。
         *
         * 只对无序列表做。有序列表里也这么干的话，被拎出来那条会因为
         * list-style:none 丢掉自己的序号，后面的项就从 2 开始 ——
         * 「最大的三个风险」渲染出来变成「(无号) / 2 / 3」，很难看，
         * 而策划文档里恰恰到处都是有序列表。 */
        const kv = ul && body.match(/^<strong>([^<]{2,28})<\/strong>\s*(?:——|—{1,2}|--|：|:)\s*([\s\S]+)$/)
        out.push(kv
          ? `<li class="sd-kv"><b class="sd-kv__k">${kv[1]}</b><span class="sd-kv__v">${kv[2]}</span></li>`
          : `<li>${body}</li>`)
        continue
      }
      closeList()

      if (para) { out[out.length - 1] += '<br>' + line; continue }

      /* 「**评委第一眼看到什么** —— 正文…」这种**独立成段**的带标签句子。
       *
       * 无序列表里的同一个形态早就特殊处理了（sd-kv），但段落形态一直没有，
       * 于是它渲染出来就是一整段普通文字，只是开头几个字是粗体 ——
       * 一份文档里七八个这样的段落连在一起，就是一堵墙，扫不出结构。
       *
       * 而这个写法恰恰是探索提示词里的模板写法，所以它到处都是。
       * 模型有时候会自己把它提升成 ### 小标题（那样很好看），有时候不会 ——
       * 好不好读不该取决于模型这一次的心情，所以在这里兜住。 */
      const kvp = line.match(/^<strong>([^<]{2,28})<\/strong>\s*(?:——|—{1,2}|--)\s*([\s\S]+)$/)
      if (kvp) {
        out.push(`<p class="sd-kvp"><b class="sd-kv__k">${kvp[1]}</b><span class="sd-kv__v">${kvp[2]}`)
        para = true
        paraEnd = '</span></p>'
        continue
      }

      out.push(`<p>${line}`)
      para = true
      paraEnd = '</p>'
    }
    closeAll()

    const nav = toc.length >= 3
      ? `<nav class="sd-toc"><b>这一份讲了什么</b><ol>${toc.filter(t => t.level <= 2).map(t =>
          `<li class="sd-toc__l${t.level}"><a href="#${t.id}">${esc(t.name)}</a></li>`).join('')}</ol></nav>`
      : ''

    return (nav + out.join(''))
      .replace(new RegExp(HOLE + 'C(\\d+)' + HOLE, 'g'), (whole, n) => {
        const c = blocks[n]
        return c ? `<pre><code>${esc(c.body)}</code></pre>` : whole
      })
      .replace(new RegExp(HOLE + 'I(\\d+)' + HOLE, 'g'), (whole, n) => {
        const c = codes[n]
        return c == null ? whole : `<code>${esc(c)}</code>`
      })
  }

  // ---------------- 常量 ----------------

  const note = (text, kind = '') =>
    `<div class="sd-note${kind ? ' is-' + kind : ''}">${esc(text)}</div>`

  const shell = inner => `<div class="sd-wrap">${inner}</div>`

  /* 文档名要和 tools/studio/prompts.mjs 里的 DOC_PLAN 保持一致。
   * 对不上不会报错，只会在列表里显示成文件名 —— 所以改那边的时候记得改这里。 */
  const DOC_NAMES = {
    '00-pitch.md': '立项书',
    '01-showcase.md': '参赛与展示方案',
    '02-pillars.md': '设计支柱',
    '03-core-loop.md': '核心循环',
    '04-systems.md': '系统设计',
    '05-content.md': '内容与进程',
    '06-tech.md': '技术方案',
    '07-production.md': '生产计划',
    '08-competitive.md': '竞品与风险',
    'CHANGELOG.md': '修订记录',
    'POSTMORTEM.md': '停更说明',
    'AUDIT.md': '硬约束校验'
  }
  /* 九份策划文档 —— 只有它们是可以被改写的。
   * CHANGELOG / POSTMORTEM / AUDIT 也能点开、也能留言，但对它们的反馈会被
   * 落到最近的一份策划文档上，而不是覆盖它们本身（那会把修订历史一次抹掉）。 */
  const PLAN_DOCS = ['00-pitch.md', '01-showcase.md', '02-pillars.md', '03-core-loop.md',
    '04-systems.md', '05-content.md', '06-tech.md', '07-production.md', '08-competitive.md']
  const isPlanDoc = f => PLAN_DOCS.includes(f)
  const TOTAL_DOCS = PLAN_DOCS.length

  // 赛道，和 tools/studio/lanes.mjs 的枚举一一对应
  const LANE_NAMES = {
    'proc-gen': '程序化生成', physics: '物理与破坏', geometry: '运行时几何',
    shader: '材质与后处理', simulation: '大规模模拟', time: '时间与因果',
    space: '空间与视角', emergence: '规则涌现', 'code-feel': '纯代码表现层'
  }
  const laneName = id => LANE_NAMES[id] || (id ? id : '未标注赛道')

  const DIMS = [
    ['glance', '一眼可辨', '截图里有没有一个没见过的画面'],
    ['talk', '技术讲点', '能撑起多久的技术追问'],
    ['ship', '可完成', '75 人日内能不能做到完整'],
    ['unique', '独特', '在评委那堆作品里是不是又一个']
  ]

  const stars = n => `<span class="sd-stars" title="${n} 星">${'★'.repeat(Math.max(0, n | 0))}${'☆'.repeat(Math.max(0, 5 - (n | 0)))}</span>`

  const dimBars = c => {
    if (!c || c.glance == null) return ''
    return `<div class="sd-dims">${DIMS.map(([k, name, hint]) => {
      const v = Number(c[k]) || 0
      return `<div class="sd-dim" title="${esc(name)}：${esc(hint)}">
        <b>${esc(name)}</b>
        <i class="sd-dim__bar"><u style="width:${v * 20}%"></u></i>
        <em class="${v <= 2 ? 'is-weak' : ''}">${v}</em>
      </div>`
    }).join('')}</div>`
  }

  // ---------------- 门口 ----------------

  const renderBlocked = why => {
    const msg = {
      NO_REPO: '还没配私有仓库。在 _config.butterfly.yml 里把 NOIMPTY_IDEAS_REPO 填成你那个私有仓库（用户名/仓库名），然后重新部署一次。',
      NO_VAULT: '这台浏览器还没配过娜娜莉的保险箱。点左下角猫爪 → 齿轮，设好密码并填上 GitHub Token。',
      LOCKED: '保险箱锁着。点左下角猫爪，输解锁密码。',
      NO_TOKEN: '保险箱开着，但里面没有 GitHub Token。点猫爪 → 齿轮把 token 填进去。',
      NO_ACCESS: '这把 token 读不到那个私有仓库。去 GitHub 的 token 设置里，把那个私有仓库勾上，权限给 Contents: Read and write（写权限是给反馈用的）。'
    }[why] || '读不到私有仓库。'
    root.innerHTML = shell(`
      ${note('这里的内容存在一个私有仓库里，不在这个博客的仓库中，也不在网站的任何文件里。别人打开这一页只会看到你现在看到的这段话。', 'info')}
      ${note(msg, 'warn')}
      <button class="sd-btn" data-act="unlock">解锁并加载</button>`)
  }

  const statusChip = p => ({
    stopped: '<span class="sd-chip sd-chip--stopped">已停更</span>',
    flagged: '<span class="sd-chip sd-chip--flagged">待定 · 校验没过</span>'
  }[p.status] || '<span class="sd-chip sd-chip--active">进行中</span>')

  // ---------------- 列表页 ----------------

  /* 下一轮预告。
   *
   * 这套东西一周只醒三次，中间那两天你能看到的只有一堆文档。
   * 写上一句「下次会做：深化《X》的核心循环」，你就知道现在给反馈还来不来得及插队 ——
   * 而反馈插队正是这套东西最关键的一条设计。 */
  const nextBanner = () => {
    const n = state && state.nextPlan
    if (!n || !n.kind) return ''
    const bits = [n.label, n.target, n.doc].filter(Boolean).join(' · ')
    return `<div class="sd-next">
      <b>下次醒来准备做</b>
      <span class="sd-next__what">${esc(bits)}</span>
      ${n.why ? `<i class="sd-next__why">${esc(n.why)}</i>` : ''}
      <i class="sd-next__hint">想改这个安排？在下面给反馈或者给候选投票，你的输入会插队。</i>
    </div>`
  }

  const pendingCount = () =>
    ((inbox && inbox.items) || []).filter(x => x && !x.handled).length

  const renderList = () => {
    const projects = (state && state.projects) || []
    const candidates = (state && state.candidates) || []
    const rejected = (state && state.rejected) || []
    const waiting = pendingCount()

    if (!projects.length && !candidates.length) {
      root.innerHTML = shell(`
        ${note('私有仓库连上了，但还没有任何立项。', 'info')}
        ${nextBanner()}
        <p class="sd-dim">策划室一周跑三次（周一 / 周四 / 周六晚上）。第一步是<strong>探索</strong> ——
        它会先判断在你的约束下哪一类东西能让评委停下来，再给出几个方向，
        每个方向按<strong>一眼可辨 / 技术讲点 / 可完成 / 独特</strong>四维打分。</p>
        <p class="sd-dim">如果它一直在探索却不立项，多半是 <code>charter.md</code> 写得太空 ——
        总纲是这套东西唯一的地基，填得含糊，产出就是通用废话。</p>
        <div class="sd-actions">
          <button class="sd-btn sd-btn--ghost" data-act="explore-list">看探索记录</button>
          <button class="sd-btn sd-btn--ghost" data-act="lessons">教训清单</button>
          <button class="sd-btn sd-btn--ghost" data-act="reload">重新加载</button>
        </div>`)
      return
    }

    root.innerHTML = shell(`
      ${note('这些内容存在私有仓库里，网站文件里没有一个字。', 'info')}
      ${nextBanner()}
      ${waiting ? note(`还有 ${waiting} 条你的输入没被处理 —— 下次跑的时候会优先吃掉它们。`, 'info') : ''}
      ${projects.length ? `
        <h2 class="sd-sectionhead">立项</h2>
        <div class="sd-grid">
          ${projects.map(p => {
            const done = (p.docs || []).length
            const pct = Math.round(done / TOTAL_DOCS * 100)
            return `
            <button class="sd-card ${p.status === 'stopped' ? 'is-stopped' : ''} ${p.status === 'flagged' ? 'is-flagged' : ''}" data-act="project" data-id="${esc(p.id)}">
              <div class="sd-card__top">${statusChip(p)}<span class="sd-card__id">${esc(p.id)}</span></div>
              <div class="sd-card__title">${esc(p.name)}</div>
              ${p.lane ? `<div class="sd-lane">${esc(laneName(p.lane))}</div>` : ''}
              <div class="sd-card__bar"><i style="width:${pct}%"></i></div>
              <div class="sd-card__meta">${done} / ${TOTAL_DOCS} 份文档${p.stoppedWhy ? ` · ${esc(p.stoppedWhy)}` : ''}${p.flaggedWhy ? ` · ${esc(p.flaggedWhy)}` : ''}</div>
            </button>`
          }).join('')}
        </div>` : ''}
      ${candidates.length ? `
        <h2 class="sd-sectionhead">候选方向</h2>
        <p class="sd-dim">探索扫出来的方向。四维分由代码汇总，<strong>短板决定上限</strong> ——
        任何一维给到 1 或 2，这个方向就上不了四星，其它三维再高也补不回来。
        四星以上才会自动进入立项。</p>
        <p class="sd-dim"><strong>你可以直接插手：</strong>「就它了」会跳过「扫够几轮」那道等待门槛直接立项（仍然要过一次硬约束校验；活跃项目满员的话它会置顶排队，一有空位自动立项），
        「加一星」是轻推，「否掉」会把它移出候选池并写进否决清单 —— 以后换个名字端上来也会被拦。</p>
        <div class="sd-cands">
          ${candidates.map(c => `
            <div class="sd-cand" data-title="${esc(c.title)}">
              <div class="sd-cand__head">
                ${stars(c.stars)}
                <span class="sd-cand__title">${esc(c.title)}</span>
              </div>
              <div class="sd-cand__meta">
                <span class="sd-lane">${esc(laneName(c.lane))}</span>
                ${c.pinned ? '<span class="sd-tag is-good">你点名要立 · 排队中</span>' : ''}
                ${c.laneCollision ? '<span class="sd-tag is-warn">赛道撞车，已降分</span>' : ''}
                ${c.shortlisted ? '<span class="sd-tag is-good">评比第一名</span>' : ''}
                ${c.boostedBy ? '<span class="sd-tag is-good">你加过星</span>' : ''}
                ${c.from ? `<button class="sd-linkish" data-act="explore-open" data-file="${esc(String(c.from).replace(/^explore\//, ''))}">看那一轮的分析</button>` : ''}
              </div>
              ${dimBars(c)}
              <div class="sd-cand__acts">
                <button class="sd-btn sd-btn--sm" data-act="vote" data-vote="pick" data-title="${esc(c.title)}" data-lane="${esc(c.lane || '')}"${c.pinned ? ' disabled' : ''}>${c.pinned ? '已排队立项' : '就它了，立项'}</button>
                <button class="sd-btn sd-btn--sm sd-btn--ghost" data-act="vote" data-vote="boost" data-title="${esc(c.title)}" data-lane="${esc(c.lane || '')}">加一星</button>
                <button class="sd-btn sd-btn--sm sd-btn--ghost" data-act="vote" data-vote="drop" data-title="${esc(c.title)}" data-lane="${esc(c.lane || '')}">否掉</button>
                <span class="sd-vote__status" role="status" aria-live="polite"></span>
              </div>
            </div>`).join('')}
        </div>` : ''}
      ${rejected.length ? `
        <h2 class="sd-sectionhead">已否决 <span class="sd-dim">（${rejected.length}）</span></h2>
        <p class="sd-dim">每一轮探索都会带上这份清单 —— 换个名字端上来一样会被否。</p>
        <ul class="sd-rejected">
          ${rejected.slice(0, 12).map(r => `<li><b>${esc(r.title)}</b><span>${esc(r.verdict || '否决')}｜${esc(r.why || '原因见审查记录')}</span></li>`).join('')}
        </ul>` : ''}
      <div class="sd-actions">
        <button class="sd-btn sd-btn--ghost" data-act="explore-list">探索与评比记录</button>
        <button class="sd-btn sd-btn--ghost" data-act="experiments">实验台</button>
        <button class="sd-btn sd-btn--ghost" data-act="lessons">教训清单</button>
        <button class="sd-btn sd-btn--ghost" data-act="reload">重新加载</button>
      </div>`)
  }

  // ---------------- 候选投票 ----------------

  const VOTE_LABEL = { pick: '就它了，立项', boost: '加一星', drop: '否掉' }

  const submitVote = async (btn) => {
    const box = btn.closest('.sd-cand')
    const status = box ? box.querySelector('.sd-vote__status') : null
    const action = btn.dataset.vote
    const title = btn.dataset.title
    // 投过就把这一张卡上的三个按钮全部锁掉。
    // 不锁的话很容易「否掉」之后手一抖又点「加一星」——
    // 那条加一星找不到对应候选，会变成一条永远处理不掉的输入。
    const buttons = box ? [...box.querySelectorAll('[data-act="vote"]')] : [btn]
    if (btn.disabled) return

    /* 「就它了」和「否掉」都不可逆（一个花掉一次立项，一个把方向写进否决清单），
     * 所以要确认一次。加一星是轻推，不打断。 */
    if (action !== 'boost') {
      const word = action === 'pick'
        ? `确定要立项《${title}》吗？\n\n它会跳过「扫够几轮」这道等待门槛，下次跑的时候直接进立项流程。\n（硬约束校验还是会跑 —— 撞了约束它仍然会拦下并告诉你否在哪一条。）`
        : `确定否掉《${title}》吗？\n\n它会被移出候选池，并写进否决清单。以后换个名字端上来也会被拦。`
      if (!window.confirm(word)) return
    }

    let note = ''
    if (action === 'drop') {
      note = window.prompt('一句话说说为什么否掉它（会写进否决清单，将来每一轮探索都会带着这句话跑）', '') || ''
    }

    buttons.forEach(b => { b.disabled = true })
    if (status) status.textContent = '正在写进私有仓库…'
    try {
      await appendInbox({
        kind: 'candidate',
        action,
        title,
        lane: btn.dataset.lane || null,
        note
      }, `候选投票：${VOTE_LABEL[action]}「${title.slice(0, 20)}」`)
      if (status) {
        status.textContent = action === 'pick'
          ? '收到。下次跑的时候会直接走立项。'
          : action === 'drop' ? '收到，已排队移出候选池。' : '收到，下次跑的时候会加上去。'
      }
      if (box) box.classList.add('is-voted')
    } catch (e) {
      // 没写进去就把按钮放开，让他能再点一次
      buttons.forEach(b => { b.disabled = false })
      if (status) status.textContent = writeError(e)
    }
  }

  // ---------------- 项目页 ----------------

  const renderProject = async id => {
    const p = ((state && state.projects) || []).find(x => x.id === id)
    if (!p) return renderList()
    root.innerHTML = shell(note('正在读取…'))

    const [files, exp] = await Promise.all([
      listDir(`projects/${id}`),
      readJson(`experiments/${id}.json`, { items: [] })
    ])
    const docs = files.filter(f => f.name.endsWith('.md')).map(f => f.name).sort()
    const openExp = (exp.items || []).filter(x => x.status !== 'done').length

    view = { kind: 'project', id }
    root.innerHTML = shell(`
      <button class="sd-btn sd-btn--ghost" data-act="back">← 回到列表</button>
      <div class="sd-head">
        <div class="sd-head__chips">${statusChip(p)}<span class="sd-card__id">${esc(p.id)}</span>${p.lane ? `<span class="sd-lane">${esc(laneName(p.lane))}</span>` : ''}</div>
        <h2 class="sd-head__title">${esc(p.name)}</h2>
        <div class="sd-head__meta">立项于 ${esc((p.createdAt || '').slice(0, 10))} · ${docs.length} 份文档</div>
      </div>
      ${p.status === 'flagged' ? note(`这个项目在硬约束校验里没过：${p.flaggedWhy || '见 AUDIT.md'}。它不会再被自动深化。想继续的话，把私有仓库里 projects/${id}/meta.json 的 status 改回 active。`, 'warn') : ''}
      ${p.status === 'stopped' ? note('这个项目已经停更。你仍然可以读它、也可以留反馈 —— 反馈会被归档进修订记录，正面的评价会进教训清单。', 'info') : ''}
      ${openExp ? `<button class="sd-callout" data-act="experiments" data-id="${esc(id)}">
        <b>${openExp} 条实验还没回填结果</b>
        <span>做完其中任何一条，回来填上结果 —— 那是这套系统唯一能拿到的一手证据，它的分量高于任何一轮推理。</span>
      </button>` : ''}
      <div class="sd-doclist">
        ${docs.map(name => `
          <button class="sd-doc" data-act="doc" data-id="${esc(id)}" data-file="${esc(name)}">
            <span class="sd-doc__no">${esc(name.slice(0, 2).replace(/\D/g, '') || '·')}</span>
            <span class="sd-doc__name">${esc(DOC_NAMES[name] || name)}</span>
            <span class="sd-doc__file">${esc(name)}</span>
          </button>`).join('')}
      </div>
      <div class="sd-actions">
        <button class="sd-btn sd-btn--ghost" data-act="experiments" data-id="${esc(id)}">实验台</button>
      </div>`)
  }

  const renderDoc = async (id, file) => {
    root.innerHTML = shell(note('正在读取…'))
    const key = `${id}/${file}`
    let text = cache.get(key)
    if (text == null) {
      const f = await readFile(`projects/${id}/${file}`)
      text = f ? f.text : ''
      cache.set(key, text)
    }
    const p = ((state && state.projects) || []).find(x => x.id === id) || { name: id }
    view = { kind: 'doc', id, file }

    // front matter 里的版本号，用来告诉你这是第几版
    const rev = (text.match(/^revision:\s*(\d+)/m) || [])[1]

    root.innerHTML = shell(`
      <button class="sd-btn sd-btn--ghost" data-act="project" data-id="${esc(id)}">← 回到《${esc(p.name)}》</button>
      <div class="sd-head">
        <div class="sd-head__chips"><span class="sd-chip">${esc(DOC_NAMES[file] || file)}</span>${rev ? `<span class="sd-chip">第 ${esc(rev)} 版</span>` : ''}</div>
        <h2 class="sd-head__title">${esc(p.name)}</h2>
      </div>
      <div class="sd-body">${md2html(text || '（这份文档是空的）')}</div>
      ${feedbackForm(id, file, p)}`)
  }

  // ---------------- 反馈 ----------------

  /* 反馈直接 PUT 回私有仓库。为什么不用 Issue、不用表单服务：
   * 那些都要把内容经过第三方。策划案不外传这条约束在这里同样成立。 */
  const VERDICTS = [
    ['很有搞头', '继续往下写，方向对'],
    ['一般', '有内容但没打动我'],
    ['可行性差', '想法可能行，但我做不出来'],
    ['停掉', '这个方向不值得继续']
  ]

  const feedbackForm = (id, file, p) => `
    <form class="sd-fb" data-id="${esc(id)}" data-file="${esc(file)}">
      <h3>读完了？给它一个反馈</h3>
      <p class="sd-dim">${isPlanDoc(file)
        ? '下次跑的时候它会逐条回应，并据此改写这一份。'
        : '这一份是记录，不是可改写的策划文档 —— 你的意见会被落到最近的一份策划文档上。'}
      最有价值的不是「好」或「不好」，是<strong>具体哪一句让你觉得不对</strong>。
      ${p && p.status !== 'active' ? '<br>这个项目已经不在推进中了，反馈会被归档进修订记录。' : ''}</p>
      <div class="sd-fb__verdicts">
        ${VERDICTS.map(([v, hint], i) => `
          <label class="sd-fb__v">
            <input type="radio" name="verdict" value="${esc(v)}"${i === 0 ? ' checked' : ''}>
            <span><b>${esc(v)}</b><i>${esc(hint)}</i></span>
          </label>`).join('')}
      </div>
      <textarea class="sd-fb__note" name="note" rows="5"
        placeholder="哪一节？哪一句？为什么？&#10;例：第三节那个「四种武器形态」我做不出来，光是动画就要四套，我不会做动画。"></textarea>
      <div class="sd-fb__row">
        <button class="sd-btn" type="submit">提交反馈</button>
        <span class="sd-fb__status" role="status" aria-live="polite"></span>
      </div>
    </form>`

  const writeError = e => {
    const m = String((e && e.message) || e)
    return /403|404/.test(m)
      ? '写不进去 —— token 需要 Contents: Read and write 权限（只读的话只能看不能反馈）'
      : '写入失败：' + m.slice(0, 80)
  }

  /* 往收件箱追加一条。
   *
   * 每次都重新读一遍再写，而不是用页面上缓存的那份 —— 中间可能跑过一次
   * Actions 把某些条目标成了已处理，拿旧的覆盖回去会让那些条目"复活"，
   * 于是同一条反馈被处理两次。多一次 GET 换掉这个，划算。 */
  const appendInbox = async (item, message) => {
    const cur = await readFile('feedback/inbox.json').catch(() => null)
    let box = { version: 1, items: [] }
    if (cur) { try { box = JSON.parse(cur.text) } catch (_) {} }
    if (!Array.isArray(box.items)) box.items = []

    const full = {
      id: `fb-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      at: new Date().toISOString(),
      handled: false,
      ...item
    }
    box.items.push(full)

    /* 已处理的条目留最近 60 条就够了。
     * 收件箱是**队列**不是档案 —— 真正的历史在每个项目的 CHANGELOG.md 里，
     * 那份是不会被裁的。不裁的话这个文件只会一直长，
     * 而它每次投票、每次反馈都要整份重写一遍。 */
    const done = box.items.filter(x => x && x.handled)
    if (done.length > 60) {
      const keep = new Set(done.slice(-60))
      box.items = box.items.filter(x => x && (!x.handled || keep.has(x)))
    }

    await writeFile('feedback/inbox.json', JSON.stringify(box, null, 2) + '\n',
      message, cur ? cur.sha : undefined)
    inbox = box
    return full
  }

  const submitFeedback = async (form) => {
    const status = form.querySelector('.sd-fb__status')
    const btn = form.querySelector('button[type=submit]')
    const verdict = (form.querySelector('input[name=verdict]:checked') || {}).value || '一般'
    const noteText = form.querySelector('.sd-fb__note').value.trim()

    if (!noteText && verdict !== '很有搞头') {
      status.textContent = '写一句吧 —— 只有评级的话它不知道该改什么'
      return
    }

    btn.disabled = true
    status.textContent = '正在写进私有仓库…'
    try {
      await appendInbox({
        kind: 'doc',
        project: form.dataset.id,
        file: form.dataset.file,
        verdict,
        note: noteText
      }, `反馈：${form.dataset.id}/${form.dataset.file}（${verdict}）`)
      form.querySelector('.sd-fb__note').value = ''
      status.textContent = '收到了。下次跑的时候它会处理这条。'
      form.classList.add('is-sent')
    } catch (e) {
      status.textContent = writeError(e)
    } finally {
      btn.disabled = false
    }
  }

  // ---------------- 实验台 ----------------

  /* 为什么要有这一页：
   *
   * 六条铁律里第三条一直要求「每个主张配一个可证伪的验证方案」，模型也一直照写。
   * 但写完就沉进文档里了 —— 没有人知道哪些做过、结果是什么。
   * 于是「验证」变成了一种文体，不是一个环节。
   *
   * 这一页把它们摆出来，让你能回填真实结果。回填之后那条结果会以
   * 「一手数据」的身份触发一次修订，而且提示词里明说了：
   * 数据面前不许辩论，直接按数据改。 */
  const RESULTS = [
    ['成立', '做出来了，和文档里写的一样'],
    ['部分成立', '大体对，但有出入 —— 说清出入在哪'],
    ['不成立', '做了，结果推翻了这条主张']
  ]

  const renderExperiments = async (onlyId) => {
    root.innerHTML = shell(note('正在读取…'))
    view = { kind: 'experiments', id: onlyId || '' }
    const projects = ((state && state.projects) || []).filter(p => !onlyId || p.id === onlyId)
    const sets = await Promise.all(projects.map(async p => ({
      project: p,
      data: await readJson(`experiments/${p.id}.json`, { items: [] })
    })))
    const any = sets.some(s => (s.data.items || []).length)

    root.innerHTML = shell(`
      <button class="sd-btn sd-btn--ghost" data-act="${onlyId ? 'project' : 'back'}" data-id="${esc(onlyId || '')}">← 回去</button>
      <h2 class="sd-sectionhead">实验台</h2>
      <p class="sd-dim">这些是从策划文档里抽出来的<strong>可证伪主张</strong>：做什么最小原型、看什么现象、
      什么结果算这条主张被推翻。它们是这套系统唯一能拿到的一手证据 ——
      你回填一条真实结果，下一轮修订就必须按它改，模型没有辩论的余地。</p>
      ${any ? sets.filter(s => (s.data.items || []).length).map(s => `
        <h3 class="sd-exp__proj">${esc(s.project.name)}</h3>
        <div class="sd-exps">
          ${(s.data.items || []).map(x => `
            <div class="sd-exp ${x.status === 'done' ? 'is-done' : ''}">
              <div class="sd-exp__top">
                <span class="sd-chip">${esc(x.id)}</span>
                <span class="sd-chip sd-chip--soft">${esc(DOC_NAMES[x.from] || x.from || '')}</span>
                ${x.cost ? `<span class="sd-chip sd-chip--soft">${esc(x.cost)}</span>` : ''}
                ${x.status === 'done' ? `<span class="sd-chip sd-chip--active">已回填：${esc(x.result || '')}</span>` : ''}
              </div>
              <div class="sd-exp__claim">${esc(x.claim)}</div>
              <dl class="sd-exp__body">
                <dt>做什么</dt><dd>${esc(x.prototype)}</dd>
                <dt>看什么</dt><dd>${esc(x.observe)}</dd>
                <dt>什么算推翻</dt><dd>${esc(x.falsify)}</dd>
                ${x.note ? `<dt>你写的</dt><dd>${esc(x.note)}</dd>` : ''}
              </dl>
              ${x.status === 'done' ? '' : `
              <form class="sd-expfb" data-id="${esc(s.project.id)}" data-exp="${esc(x.id)}" data-file="${esc(x.from || '')}">
                <div class="sd-fb__verdicts">
                  ${RESULTS.map(([v, hint], i) => `
                    <label class="sd-fb__v">
                      <input type="radio" name="result-${esc(x.id)}" value="${esc(v)}"${i === 0 ? ' checked' : ''}>
                      <span><b>${esc(v)}</b><i>${esc(hint)}</i></span>
                    </label>`).join('')}
                </div>
                <textarea class="sd-fb__note" rows="3" placeholder="实际看到了什么？数字、现象、你的判断。写具体一点 —— 这段会被当成硬数据用。"></textarea>
                <div class="sd-fb__row">
                  <button class="sd-btn sd-btn--sm" type="submit">回填结果</button>
                  <span class="sd-fb__status" role="status" aria-live="polite"></span>
                </div>
              </form>`}
            </div>`).join('')}
        </div>`).join('')
        : note('还没有登记任何实验。每写一份新文档，它会在末尾附上 1~3 条这一份新出现的可证伪主张。', 'info')}`)
  }

  const submitExperiment = async form => {
    const status = form.querySelector('.sd-fb__status')
    const btn = form.querySelector('button[type=submit]')
    const picked = form.querySelector('input[type=radio]:checked')
    const result = picked ? picked.value : '成立'
    const noteText = form.querySelector('.sd-fb__note').value.trim()

    if (!noteText) {
      status.textContent = '写一句实际看到了什么 —— 光一个结论没法拿来改文档'
      return
    }
    btn.disabled = true
    status.textContent = '正在写进私有仓库…'
    try {
      await appendInbox({
        kind: 'experiment',
        project: form.dataset.id,
        expId: form.dataset.exp,
        file: form.dataset.file || '',
        result,
        note: noteText
      }, `实验结果：${form.dataset.id}/${form.dataset.exp}（${result}）`)
      status.textContent = '收到。下次跑的时候会按这条数据改文档 —— 这条优先级排在所有意见前面。'
      form.classList.add('is-sent')
    } catch (e) {
      status.textContent = writeError(e)
    } finally {
      btn.disabled = false
    }
  }

  // ---------------- 探索 / 评比 / 教训 ----------------

  const exploreLabel = name => {
    if (name.startsWith('评比-')) return '候选评比 · ' + name.replace('评比-', '').replace('.md', '')
    if (name.startsWith('审查-')) return '硬约束校验 · ' + name.replace('审查-', '').replace('.md', '')
    return '探索 · ' + name.replace('.md', '')
  }
  const exploreIcon = name => name.startsWith('评比-') ? '⚖' : (name.startsWith('审查-') ? '⚑' : '✦')

  const renderExploreList = async () => {
    root.innerHTML = shell(note('正在读取…'))
    const files = (await listDir('explore')).filter(f => f.name.endsWith('.md')).map(f => f.name).sort().reverse()
    view = { kind: 'explore' }
    root.innerHTML = shell(`
      <button class="sd-btn sd-btn--ghost" data-act="back">← 回到列表</button>
      <h2 class="sd-sectionhead">探索与评比记录</h2>
      <p class="sd-dim">每次探索扫出的方向和判断、每次候选评比的排名、每次立项前的硬约束校验，都在这里。
      没被选上的方向也留着 —— 它们记录了「为什么当时没选」。</p>
      ${files.length
        ? `<div class="sd-doclist">${files.map(n => `
            <button class="sd-doc" data-act="explore-open" data-file="${esc(n)}">
              <span class="sd-doc__no">${exploreIcon(n)}</span>
              <span class="sd-doc__name">${esc(exploreLabel(n))}</span>
            </button>`).join('')}</div>`
        : note('还没有探索记录。', 'info')}`)
  }

  const renderExploreDoc = async file => {
    root.innerHTML = shell(note('正在读取…'))
    const f = await readFile(`explore/${file}`)
    view = { kind: 'explore-doc', file }
    root.innerHTML = shell(`
      <button class="sd-btn sd-btn--ghost" data-act="explore-list">← 回到记录列表</button>
      <div class="sd-head"><h2 class="sd-head__title">${esc(exploreLabel(file))}</h2></div>
      ${note('看完想对某个方向表态？回到列表页，在「候选方向」里点「就它了 / 加一星 / 否掉」—— 那是能直接改变下一轮走向的入口。', 'info')}
      <div class="sd-body">${md2html(f ? f.text : '（读不到）')}</div>`)
  }

  const renderLessons = async () => {
    root.innerHTML = shell(note('正在读取…'))
    const f = await readFile('lessons.md')
    view = { kind: 'lessons' }
    root.innerHTML = shell(`
      <button class="sd-btn sd-btn--ghost" data-act="back">← 回到列表</button>
      <div class="sd-head"><h2 class="sd-head__title">教训清单</h2></div>
      <p class="sd-dim">每次停更或否决，它会往这里追加一条<strong>可以拿去检查别的方向</strong>的规则。
      这份清单会进每一轮探索的上下文 —— 它是这套系统唯一的长期记忆。
      （它由 AI 自己维护，和你写的 <code>charter.md</code> 分开放，那份它只读不改。）</p>
      <div class="sd-body">${md2html(f ? f.text : '（还没有教训 —— 也就是还没有东西死掉。）')}</div>`)
  }

  // ---------------- 流程 ----------------

  const load = async () => {
    /* 先单独查一次配置和凭据。
     *
     * 不能指望下面那个 catch —— readJson 把所有异常都吞了（它要能兜住
     * 「文件还不存在」这种正常情况）。于是保险箱锁着的时候，
     * state.json 读回来是那个空对象兜底值，页面显示的是
     * **「私有仓库连上了，但还没有任何立项」** —— 一句彻头彻尾的假话，
     * 而真正该出现的「点猫爪解锁」那个按钮永远不会出现。 */
    const why = preflight()
    if (why) return renderBlocked(why)

    root.innerHTML = shell(note('正在从私有仓库读取…'))
    try {
      const raw = await readFile('state.json')   // 这一个不吞异常：403 要能冒上来
      state = raw ? JSON.parse(raw.text) : { projects: [], candidates: [] }
      if (!state || typeof state !== 'object') state = { projects: [], candidates: [] }
      state.projects = Array.isArray(state.projects) ? state.projects : []
      state.candidates = Array.isArray(state.candidates) ? state.candidates : []
      state.rejected = Array.isArray(state.rejected) ? state.rejected : []
      inbox = await readJson('feedback/inbox.json', { items: [] })
      view = { kind: 'list' }
      renderList()
      expose()
    } catch (e) {
      const m = String(e.message || e)
      if (/^40[34]/.test(m)) return renderBlocked('NO_ACCESS')
      if (/^(NO_VAULT|LOCKED|NO_TOKEN|NO_REPO)$/.test(m)) return renderBlocked(m)
      root.innerHTML = shell(note('读取失败：' + m, 'warn') + '<button class="sd-btn" data-act="reload">重试</button>')
    }
  }

  // 娜娜莉读当前文章走的是 #article-container 的纯文本，
  // 上面渲染出来的正文就在那里面，所以她在这一页答得上来，不需要额外接线。
  // 这里再挂一份结构化的，方便控制台核对。
  const expose = () => {
    window.NOIMPTY_STUDIO = Object.freeze({
      state: () => JSON.parse(JSON.stringify(state || {})),
      view: () => ({ ...view }),
      pending: () => pendingCount(),
      reload: () => load()
    })
  }

  const bind = node => {
    if (node.dataset.sdBound === '1') return
    node.dataset.sdBound = '1'

    node.addEventListener('click', e => {
      const b = e.target.closest('[data-act]')
      if (!b) return
      const act = b.dataset.act
      if (act === 'reload') return load()
      if (act === 'back') { view = { kind: 'list' }; return renderList() }
      if (act === 'project') return b.dataset.id ? renderProject(b.dataset.id) : renderList()
      if (act === 'doc') return renderDoc(b.dataset.id, b.dataset.file)
      if (act === 'explore-list') return renderExploreList()
      if (act === 'explore-open') return renderExploreDoc(b.dataset.file)
      if (act === 'experiments') return renderExperiments(b.dataset.id || '')
      if (act === 'lessons') return renderLessons()
      if (act === 'vote') return submitVote(b)
      if (act === 'unlock') {
        try { if (window.NANALY && window.NANALY.requestUnlock) window.NANALY.requestUnlock() } catch (_) {}
        setTimeout(load, 1200)
      }
    })

    node.addEventListener('submit', e => {
      const exp = e.target.closest('.sd-expfb')
      if (exp) { e.preventDefault(); return submitExperiment(exp) }
      const form = e.target.closest('.sd-fb')
      if (!form) return
      e.preventDefault()
      submitFeedback(form)
    })
  }

  const mount = () => {
    const node = document.getElementById('noimpty-studio')
    root = node || null
    if (!root) return
    bind(root)
    expose()
    load()
  }

  mount()
  window.addEventListener('pjax:complete', () => setTimeout(mount, 60))
})()
